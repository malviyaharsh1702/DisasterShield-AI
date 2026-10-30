
import os
import sqlite3
import hashlib
import secrets

from ai_engine import analyze_incident, detect_duplicate
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel, Field


# --------------------------------------------------
# APP CONFIGURATION
# --------------------------------------------------

app = FastAPI(
    title="DisasterShield AI",
    description="Intelligent Disaster Response System API",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).with_name("disastershield.db")

# Set JWT_SECRET_KEY in your environment before deployment.
SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "LOCAL-ONLY-CHANGE-THIS-SECRET-BEFORE-DEPLOYMENT"
)
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12

security = HTTPBearer(auto_error=False)


# --------------------------------------------------
# DATABASE
# --------------------------------------------------

def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with get_connection() as connection:

        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                incident_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                location TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                status TEXT NOT NULL DEFAULT 'Reported',
                created_at TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS resources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                location TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                total_capacity INTEGER NOT NULL DEFAULT 0,
                available_capacity INTEGER NOT NULL DEFAULT 0,
                contact TEXT,
                status TEXT NOT NULL DEFAULT 'Available',
                updated_at TEXT NOT NULL
            )
        """)

        # Safe migration: add new columns without deleting old records.
        columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(incidents)"
            ).fetchall()
        }

        migrations = {
    "reporter_id": "INTEGER REFERENCES users(id)",
    "assigned_team": "TEXT",
    "reviewed_by": "INTEGER",
    "priority_score": "REAL",
    "is_duplicate": "INTEGER NOT NULL DEFAULT 0",
    "duplicate_of": "INTEGER",
    "duplicate_similarity": "REAL",
    "ai_analysis_method": "TEXT"
}

        for column, definition in migrations.items():
            if column not in columns:
                connection.execute(
                    f"ALTER TABLE incidents ADD COLUMN {column} {definition}"
                )


initialize_database()


# --------------------------------------------------
# REQUEST MODELS
# --------------------------------------------------

class CitizenRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=8, max_length=128)


class RescueRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=8, max_length=128)
    invitation_code: str


class LoginRequest(BaseModel):
    email: str
    password: str


class Incident(BaseModel):
    title: str
    description: str
    incident_type: str
    severity: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class StatusUpdate(BaseModel):
    status: str


class AssignmentRequest(BaseModel):
    assigned_team: str = Field(min_length=2, max_length=100)

class ResourceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    resource_type: str
    location: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    total_capacity: int = Field(ge=0)
    available_capacity: int = Field(ge=0)
    contact: Optional[str] = None


class ResourceUpdate(BaseModel):
    available_capacity: int = Field(ge=0)
    status: str


# --------------------------------------------------
# PASSWORD SECURITY
# --------------------------------------------------

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)

    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        310000
    )

    return salt.hex() + ":" + password_hash.hex()


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, hash_hex = stored_hash.split(":")
        salt = bytes.fromhex(salt_hex)

        new_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            310000
        )

        return secrets.compare_digest(new_hash.hex(), hash_hex)

    except (ValueError, TypeError):
        return False


# --------------------------------------------------
# JWT AUTHENTICATION
# --------------------------------------------------

def create_access_token(user_id: int, role: str):
    expires = datetime.now(timezone.utc) + timedelta(
        hours=TOKEN_EXPIRE_HOURS
    )

    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": expires
    }

    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Please login first"
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )

        user_id = int(payload.get("sub"))
        role = payload.get("role")

        if role not in ("citizen", "rescue"):
            raise HTTPException(
                status_code=401,
                detail="Invalid account role"
            )

    except (JWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired login token"
        )

    with get_connection() as connection:
        user = connection.execute(
            "SELECT id, full_name, email, role FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()

    if user is None or user["role"] != role:
        raise HTTPException(
            status_code=401,
            detail="Account not found or role changed"
        )

    return dict(user)


def require_role(required_role: str):
    def role_checker(user=Depends(get_current_user)):
        if user["role"] != required_role:
            raise HTTPException(
                status_code=403,
                detail="You do not have permission for this action"
            )
        return user

    return role_checker


get_citizen = require_role("citizen")
get_rescue = require_role("rescue")


# --------------------------------------------------
# HOME
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "DisasterShield AI Backend is Running!",
        "status": "success"
    }


# --------------------------------------------------
# CITIZEN REGISTRATION
# --------------------------------------------------

@app.post("/api/auth/register", status_code=201)
def register_citizen(data: CitizenRegister):

    email = data.email.strip().lower()
    full_name = data.full_name.strip()

    if not full_name or not email:
        raise HTTPException(400, "Name and email are required")

    with get_connection() as connection:

        existing = connection.execute(
            "SELECT id FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Email is already registered"
            )

        cursor = connection.execute(
            """
            INSERT INTO users (
                full_name, email, password_hash, role, created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                full_name,
                email,
                hash_password(data.password),
                "citizen",
                datetime.now(timezone.utc).isoformat()
            )
        )

        user_id = cursor.lastrowid

    return {
        "message": "Citizen account created successfully",
        "user_id": user_id,
        "role": "citizen"
    }


# --------------------------------------------------
# AUTHORIZED RESCUE REGISTRATION
# --------------------------------------------------

@app.post("/api/auth/register-rescue", status_code=201)
def register_rescue(data: RescueRegister):

    invitation_code = os.getenv("RESCUE_INVITE_CODE")

    if not invitation_code:
        raise HTTPException(
            status_code=503,
            detail="Rescue registration is not configured"
        )

    if not secrets.compare_digest(
        data.invitation_code,
        invitation_code
    ):
        raise HTTPException(
            status_code=403,
            detail="Invalid rescue invitation code"
        )

    email = data.email.strip().lower()
    full_name = data.full_name.strip()

    if not email or not full_name:
        raise HTTPException(400, "Name and email are required")

    with get_connection() as connection:

        existing = connection.execute(
            "SELECT id FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Email is already registered"
            )

        cursor = connection.execute(
            """
            INSERT INTO users (
                full_name, email, password_hash, role, created_at
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                full_name,
                email,
                hash_password(data.password),
                "rescue",
                datetime.now(timezone.utc).isoformat()
            )
        )

        user_id = cursor.lastrowid

    return {
        "message": "Rescue account created successfully",
        "user_id": user_id,
        "role": "rescue"
    }


# --------------------------------------------------
# LOGIN
# --------------------------------------------------

@app.post("/api/auth/login")
def login(data: LoginRequest):

    email = data.email.strip().lower()

    with get_connection() as connection:
        user = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

    if user is None or not verify_password(
        data.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password"
        )

    token = create_access_token(
        user["id"],
        user["role"]
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "full_name": user["full_name"],
            "email": user["email"],
            "role": user["role"]
        }
    }


# --------------------------------------------------
# CURRENT LOGGED-IN USER
# --------------------------------------------------

@app.get("/api/auth/me")
def current_user(user=Depends(get_current_user)):
    return user


# --------------------------------------------------
# DASHBOARD
# --------------------------------------------------

@app.get("/api/dashboard")
def dashboard(user=Depends(get_current_user)):

    with get_connection() as connection:

        if user["role"] == "rescue":
            where_clause = ""
            parameters = ()
        else:
            where_clause = "WHERE reporter_id = ?"
            parameters = (user["id"],)

        total = connection.execute(
            f"SELECT COUNT(*) FROM incidents {where_clause}",
            parameters
        ).fetchone()[0]

        critical = connection.execute(
            f"""
            SELECT COUNT(*) FROM incidents
            {where_clause}
            {"AND" if where_clause else "WHERE"} severity = ?
            """,
            parameters + ("Critical",)
        ).fetchone()[0]

        resolved = connection.execute(
            f"""
            SELECT COUNT(*) FROM incidents
            {where_clause}
            {"AND" if where_clause else "WHERE"} status = ?
            """,
            parameters + ("Resolved",)
        ).fetchone()[0]

    return {
        "total_incidents": total,
        "critical_incidents": critical,
        "resolved_incidents": resolved,
        "role": user["role"]
    }


# --------------------------------------------------
# GET INCIDENTS
# Citizens see their reports; rescue sees all reports.
# --------------------------------------------------

@app.get("/api/incidents")
def get_incidents(user=Depends(get_current_user)):

    with get_connection() as connection:

        if user["role"] == "rescue":
            rows = connection.execute(
                "SELECT * FROM incidents ORDER BY id DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT * FROM incidents
                WHERE reporter_id = ?
                ORDER BY id DESC
                """,
                (user["id"],)
            ).fetchall()

    return [dict(row) for row in rows]

# --------------------------------------------------
# RESCUE PRIORITY INCIDENTS
# --------------------------------------------------

@app.get("/api/rescue/priority")
def get_priority_incidents(user=Depends(get_rescue)):

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM incidents
            ORDER BY
                is_duplicate ASC,
                priority_score DESC,
                id DESC
            """
        ).fetchall()

    return {
        "total": len(rows),
        "incidents": [dict(row) for row in rows]
    }

# --------------------------------------------------
# CITIZEN CREATES INCIDENT
# --------------------------------------------------


@app.post("/api/incidents", status_code=201)
def create_incident(
    incident: Incident,
    user=Depends(get_citizen)
):
    with get_connection() as connection:

        # Step 1: Run AI analysis
        analysis = analyze_incident(
            incident.title,
            incident.description,
            incident.incident_type,
            incident.severity
        )

        # Step 2: Fetch existing incidents for duplicate checking
        existing_incidents = connection.execute(
            """
            SELECT id, title, description, location
            FROM incidents
            ORDER BY id DESC
            LIMIT 500
            """
        ).fetchall()

        # Step 3: Detect possible duplicate
        duplicate_result = detect_duplicate(
            incident.title,
            incident.description,
            incident.location,
            existing_incidents
        )

        # Step 4: Save AI results
        cursor = connection.execute(
            """
            INSERT INTO incidents (
                title,
                description,
                incident_type,
                severity,
                location,
                latitude,
                longitude,
                status,
                created_at,
                reporter_id,
                priority_score,
                is_duplicate,
                duplicate_of,
                duplicate_similarity,
                ai_analysis_method
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                incident.title,
                incident.description,
                analysis["predicted_type"],
                analysis["predicted_severity"],
                incident.location,
                incident.latitude,
                incident.longitude,
                "Reported",
                datetime.now(timezone.utc).isoformat(),
                user["id"],
                analysis["priority_score"],
                1 if duplicate_result["is_duplicate"] else 0,
                duplicate_result["duplicate_of"],
                duplicate_result["similarity"],
                analysis["analysis_method"]
            )
        )

        incident_id = cursor.lastrowid

        row = connection.execute(
            "SELECT * FROM incidents WHERE id = ?",
            (incident_id,)
        ).fetchone()

    return {
        "message": "Incident saved and analyzed successfully",
        "incident": dict(row),
        "ai_analysis": analysis,
        "duplicate_check": duplicate_result
    }


# --------------------------------------------------
# RESCUE TEAM UPDATES INCIDENT STATUS
# --------------------------------------------------

@app.patch("/api/incidents/{incident_id}/status")
def update_incident_status(
    incident_id: int,
    data: StatusUpdate,
    user=Depends(get_rescue)
):

    allowed_statuses = [
        "Reported",
        "Under Review",
        "Verified",
        "Rescue Assigned",
        "Resolved"
    ]

    if data.status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid incident status"
        )

    with get_connection() as connection:

        result = connection.execute(
            """
            UPDATE incidents
            SET status = ?, reviewed_by = ?
            WHERE id = ?
            """,
            (data.status, user["id"], incident_id)
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

    return {
        "message": "Incident status updated",
        "incident_id": incident_id,
        "status": data.status
    }


# --------------------------------------------------
# RESCUE TEAM ASSIGNMENT
# --------------------------------------------------

@app.patch("/api/incidents/{incident_id}/assign")
def assign_rescue_team(
    incident_id: int,
    data: AssignmentRequest,
    user=Depends(get_rescue)
):

    with get_connection() as connection:

        result = connection.execute(
            """
            UPDATE incidents
            SET assigned_team = ?, status = ?
            WHERE id = ?
            """,
            (
                data.assigned_team.strip(),
                "Rescue Assigned",
                incident_id
            )
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Incident not found"
            )

    return {
        "message": "Rescue team assigned successfully",
        "incident_id": incident_id,
        "assigned_team": data.assigned_team
    }

# --------------------------------------------------
# HOSPITAL & SHELTER RESOURCE MANAGEMENT
# --------------------------------------------------

@app.get("/api/resources")
def get_resources(user=Depends(get_current_user)):

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM resources
            ORDER BY resource_type, name
            """
        ).fetchall()

    return {
        "total": len(rows),
        "resources": [dict(row) for row in rows]
    }


# RESCUE TEAM ADDS A RESOURCE
@app.post("/api/resources", status_code=201)
def add_resource(
    data: ResourceCreate,
    user=Depends(get_rescue)
):

    resource_type = data.resource_type.strip().lower()

    if resource_type not in ("hospital", "shelter"):
        raise HTTPException(
            status_code=400,
            detail="Resource type must be hospital or shelter"
        )

    if data.available_capacity > data.total_capacity:
        raise HTTPException(
            status_code=400,
            detail="Available capacity cannot exceed total capacity"
        )

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO resources (
                name, resource_type, location,
                latitude, longitude,
                total_capacity, available_capacity,
                contact, status, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                data.name.strip(),
                resource_type,
                data.location.strip(),
                data.latitude,
                data.longitude,
                data.total_capacity,
                data.available_capacity,
                data.contact,
                "Available" if data.available_capacity > 0 else "Full",
                datetime.now(timezone.utc).isoformat()
            )
        )

        resource_id = cursor.lastrowid

    return {
        "message": "Resource added successfully",
        "resource_id": resource_id
    }


# RESCUE TEAM UPDATES RESOURCE AVAILABILITY

@app.patch("/api/resources/{resource_id}")
def update_resource(
    resource_id: int,
    data: ResourceUpdate,
    user=Depends(get_rescue)
):
    allowed_statuses = (
        "Available",
        "Limited",
        "Full",
        "Unavailable"
    )

    if data.status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid resource status"
        )

    with get_connection() as connection:
        # Check whether resource exists and get its total capacity
        resource = connection.execute(
            """
            SELECT total_capacity
            FROM resources
            WHERE id = ?
            """,
            (resource_id,)
        ).fetchone()

        if resource is None:
            raise HTTPException(
                status_code=404,
                detail="Resource not found"
            )

        if data.available_capacity > resource["total_capacity"]:
            raise HTTPException(
                status_code=400,
                detail="Available capacity cannot exceed total capacity"
            )

        connection.execute(
            """
            UPDATE resources
            SET available_capacity = ?,
                status = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                data.available_capacity,
                data.status,
                datetime.now(timezone.utc).isoformat(),
                resource_id
            )
        )

    return {
        "message": "Resource availability updated",
        "resource_id": resource_id
    }


# RESCUE TEAM DELETES A RESOURCE
@app.delete("/api/resources/{resource_id}")
def delete_resource(
    resource_id: int,
    user=Depends(get_rescue)
):

    with get_connection() as connection:
        result = connection.execute(
            "DELETE FROM resources WHERE id = ?",
            (resource_id,)
        )

        if result.rowcount == 0:
            raise HTTPException(
                status_code=404,
                detail="Resource not found"
            )

    return {
        "message": "Resource deleted successfully",
        "resource_id": resource_id
    }
class ResourceDetailsUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    resource_type: str
    location: str = Field(min_length=2, max_length=250)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact: Optional[str] = None
    total_capacity: int = Field(ge=0)

    # --------------------------------------------------
# RESCUE TEAM EDITS RESOURCE DETAILS
# --------------------------------------------------

@app.put("/api/resources/{resource_id}")
def edit_resource(
    resource_id: int,
    data: ResourceDetailsUpdate,
    user=Depends(get_rescue)
):
    resource_type = data.resource_type.strip().lower()

    if resource_type not in ("hospital", "shelter"):
        raise HTTPException(
            status_code=400,
            detail="Resource type must be hospital or shelter"
        )

    if not data.name.strip() or not data.location.strip():
        raise HTTPException(
            status_code=400,
            detail="Resource name and location are required"
        )

    with get_connection() as connection:
        resource = connection.execute(
            """
            SELECT available_capacity
            FROM resources
            WHERE id = ?
            """,
            (resource_id,)
        ).fetchone()

        if resource is None:
            raise HTTPException(404, "Resource not found")

        if data.total_capacity < resource["available_capacity"]:
            raise HTTPException(
                400,
                "Total capacity cannot be less than available capacity"
            )

        connection.execute(
            """
            UPDATE resources
            SET name = ?,
                resource_type = ?,
                location = ?,
                latitude = ?,
                longitude = ?,
                contact = ?,
                total_capacity = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                data.name.strip(),
                resource_type,
                data.location.strip(),
                data.latitude,
                data.longitude,
                data.contact.strip() if data.contact else None,
                data.total_capacity,
                datetime.now(timezone.utc).isoformat(),
                resource_id
            )
        )

    return {
        "message": "Resource details updated successfully",
        "resource_id": resource_id
    }