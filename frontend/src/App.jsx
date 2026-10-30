
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8001";

const OFFLINE_STORAGE_KEY = "disasterShieldOfflineReports";

const api = axios.create({ baseURL: API_URL });

const getSavedUser = () => {
  try {
    return JSON.parse(localStorage.getItem("ds_user"));
  } catch {
    return null;
  }
};

const getOfflineReports = () => {
  try {
    const reports = JSON.parse(
      localStorage.getItem(OFFLINE_STORAGE_KEY) || "[]"
    );
    return Array.isArray(reports) ? reports : [];
  } catch {
    return [];
  }
};

function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    localStorage.setItem("ds_token", token);
  } else {
    delete api.defaults.headers.common.Authorization;
    localStorage.removeItem("ds_token");
  }
}

// Normalize incidents, including duplicate detection fields
function normalizeIncidents(data) {
  const list = Array.isArray(data)
    ? data
    : data?.incidents || data?.items || [];

  return list.map((item, index) => ({
    ...item,
    id: item.id ?? item._id ?? index + 1,
    title: item.title || "Emergency report",
    type: item.incident_type || item.type || "Other",
    location: item.location || "Unknown location",
    description: item.description || "",
    severity: item.severity || "Medium",
    status: item.status || "Reported",
    latitude: Number(item.latitude ?? item.lat),
    longitude: Number(item.longitude ?? item.lng),
    assigned_team: item.assigned_team || "",

    // Duplicate detection fields
    is_duplicate:
      item.is_duplicate === true ||
      item.is_duplicate === 1 ||
      item.is_duplicate === "true",

    duplicate_of: item.duplicate_of ?? null,

    duplicate_similarity: Number(
      item.duplicate_similarity || 0
    ),

    ai_analysis_method:
      item.ai_analysis_method || "Rule-based AI engine",
  }));
}

function analyzeIncident(item) {
  const text =
    `${item.title} ${item.description} ${item.type}`.toLowerCase();

  let score = Number(item.priority_score);
  const reasons = [];

  if (!Number.isFinite(score)) {
    score = 25;

    const rules = [
      {
        words: ["trapped", "stranded", "injured", "missing", "collapse"],
        points: 35,
        reason: "Possible people in immediate danger",
      },
      {
        words: ["fire", "earthquake", "explosion", "building damage"],
        points: 25,
        reason: "Potentially dangerous hazard",
      },
      {
        words: ["flood", "waterlogging", "heavy rain"],
        points: 20,
        reason: "Flood-related disruption",
      },
      {
        words: ["blocked", "debris", "road closed"],
        points: 12,
        reason: "Emergency access may be affected",
      },
      {
        words: ["hospital", "school", "families", "residential"],
        points: 10,
        reason: "Potential impact on populated areas",
      },
    ];

    rules.forEach((rule) => {
      if (rule.words.some((word) => text.includes(word))) {
        score += rule.points;
        reasons.push(rule.reason);
      }
    });

    if (item.severity.toLowerCase() === "critical") score += 15;
    else if (item.severity.toLowerCase() === "high") score += 8;

    score = Math.min(score, 99);
  } else {
    score = Math.min(score, 100);
  }

  return {
    score: Math.round(score),
    priority:
      score >= 75
        ? "Critical"
        : score >= 55
        ? "High"
        : score >= 38
        ? "Medium"
        : "Low",
    reasons: reasons.length
      ? reasons.slice(0, 2)
      : ["Coordinator review recommended"],
  };
}

function MapResize() {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 150);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}

function StatCard({ icon, label, value, detail, tone }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-topline">
        <span className="stat-icon">{icon}</span>
        <span className="stat-live">LIVE</span>
      </div>
      <p>{label}</p>
      <div className="stat-value">{value}</div>
      <small>{detail}</small>
    </article>
  );
}

const INCIDENT_STATUSES = [
  "Reported",
  "Under Review",
  "Verified",
  "Rescue Assigned",
  "Resolved",
];

const RESOURCE_STATUSES = [
  "Available",
  "Limited",
  "Full",
  "Unavailable",
];

const EMPTY_INCIDENT_FORM = {
  title: "",
  description: "",
  incident_type: "Flood",
  severity: "High",
  location: "",
  latitude: "26.4499",
  longitude: "80.3319",
};

const EMPTY_RESOURCE_FORM = {
  name: "",
  resource_type: "hospital",
  location: "",
  latitude: "",
  longitude: "",
  total_capacity: "",
  available_capacity: "",
  contact: "",
};

export default function App() {
  const [user, setUser] = useState(getSavedUser);
  const [token, setToken] = useState(
    () => localStorage.getItem("ds_token")
  );

  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    full_name: "",
    email: "",
    password: "",
    invitation_code: "",
  });

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [mapMode, setMapMode] = useState("street");
  const [teamInputs, setTeamInputs] = useState({});

  const [resources, setResources] = useState([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [resourceUpdates, setResourceUpdates] = useState({});
  const [resourceForm, setResourceForm] = useState(EMPTY_RESOURCE_FORM);

  const [offlineReports, setOfflineReports] = useState(getOfflineReports);
  const [isOnline, setIsOnline] = useState(
    () => navigator.onLine
  );
  const [syncingReports, setSyncingReports] = useState(false);

  const [form, setForm] = useState(EMPTY_INCIDENT_FORM);

  const isRescue = user?.role === "rescue";
  const isCitizen = user?.role === "citizen";

  function updateOfflineQueue(queue) {
    localStorage.setItem(
      OFFLINE_STORAGE_KEY,
      JSON.stringify(queue)
    );
    setOfflineReports(queue);
  }

  // Restore login session
  useEffect(() => {
    async function restoreSession() {
      if (!token) {
        setLoading(false);
        return;
      }

      setAuthToken(token);

      try {
        const response = await api.get("/api/auth/me");
        setUser(response.data);
        localStorage.setItem("ds_user", JSON.stringify(response.data));
      } catch (error) {
        console.error(error);
        setAuthToken(null);
        localStorage.removeItem("ds_user");
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    restoreSession();
  }, []);

  // Monitor internet connection
  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      setNotice("Internet connection restored. Checking offline reports...");
    }

    function handleOffline() {
      setIsOnline(false);
      setNotice("You are offline. New reports will be saved on this device.");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  async function loadIncidents() {
    if (!token || !user) return;

    try {
      const response = await api.get("/api/incidents");
      setIncidents(normalizeIncidents(response.data));
      setConnected(true);
    } catch (error) {
      console.error(error);
      setConnected(false);
      setNotice(
        error.response?.data?.detail || "Unable to load incident reports."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadResources() {
    if (!token || !user) return;

    setResourceLoading(true);
    setResourceError("");

    try {
      const response = await api.get("/api/resources");
      const list = Array.isArray(response.data)
        ? response.data
        : response.data?.resources || [];

      setResources(list);
    } catch (error) {
      console.error(error);
      setResourceError(
        error.response?.data?.detail || "Unable to load resources."
      );
    } finally {
      setResourceLoading(false);
    }
  }

  useEffect(() => {
    if (token && user) {
      loadIncidents();
      loadResources();
    }
  }, [token, user]);

  // Save report locally when offline
  function saveOfflineReport(report) {
    const queue = getOfflineReports();

    const newReport = {
      ...report,
      offlineId: `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
      savedAt: new Date().toISOString(),
    };

    updateOfflineQueue([...queue, newReport]);

    setNotice(
      "Report saved on this device. It will sync when internet returns."
    );

    setShowForm(false);
    setForm(EMPTY_INCIDENT_FORM);
  }

  // Sync queued reports
  async function syncOfflineReports() {
    if (
      !navigator.onLine ||
      !token ||
      !user ||
      syncingReports ||
      getOfflineReports().length === 0
    ) {
      return;
    }

    setSyncingReports(true);

    const queue = getOfflineReports();
    let syncedCount = 0;

    try {
      while (queue.length > 0) {
        if (!navigator.onLine) break;

        const report = queue[0];
        const { offlineId, savedAt, ...payload } = report;

        await api.post("/api/incidents", payload);

        queue.shift();
        syncedCount += 1;

        updateOfflineQueue([...queue]);
      }

      if (syncedCount > 0) {
        setNotice(
          `${syncedCount} offline report(s) synced successfully.`
        );
        await loadIncidents();
      } else if (queue.length > 0) {
        setNotice(
          "Offline reports are waiting for a working connection."
        );
      }
    } catch (error) {
      console.error("Offline sync error:", error);
      setNotice(
        "Some reports are still waiting to sync. They have been kept on this device."
      );
    } finally {
      setSyncingReports(false);
    }
  }

  useEffect(() => {
    if (isOnline && token && user && offlineReports.length > 0) {
      syncOfflineReports();
    }
  }, [isOnline, token, user, offlineReports.length]);

  function logout() {
    setAuthToken(null);
    localStorage.removeItem("ds_user");
    setToken(null);
    setUser(null);
    setIncidents([]);
    setResources([]);
    setNotice("");
    setLoading(false);
  }

  function updateAuthForm(event) {
    setAuthForm({
      ...authForm,
      [event.target.name]: event.target.value,
    });
  }

  async function handleAuth(event) {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      if (authMode === "register" || authMode === "rescue-register") {
        const rescue = authMode === "rescue-register";

        const payload = {
          full_name: authForm.full_name,
          email: authForm.email,
          password: authForm.password,
        };

        if (rescue) {
          payload.invitation_code = authForm.invitation_code;
        }

        await api.post(
          rescue
            ? "/api/auth/register-rescue"
            : "/api/auth/register",
          payload
        );

        setAuthMode("login");
        setAuthError("Registration successful! Please log in.");
        setAuthForm({
          full_name: "",
          email: authForm.email,
          password: "",
          invitation_code: "",
        });
      } else {
        const response = await api.post("/api/auth/login", {
          email: authForm.email,
          password: authForm.password,
        });

        const accessToken = response.data.access_token;
        const loggedInUser = response.data.user;

        setAuthToken(accessToken);
        localStorage.setItem("ds_user", JSON.stringify(loggedInUser));

        setToken(accessToken);
        setUser(loggedInUser);
        setLoading(true);
        setNotice("Welcome to DisasterShield AI.");
      }
    } catch (error) {
      console.error(error);
      setAuthError(
        error.response?.data?.detail ||
        "Authentication failed. Please try again."
      );
    } finally {
      setAuthLoading(false);
    }
  }

  const analyzed = useMemo(
    () =>
      incidents.map((item) => ({
        ...item,
        ai: analyzeIncident(item),
      })),
    [incidents]
  );

  const filtered = analyzed.filter((item) => {
    const query = search.toLowerCase();

    const matchesSearch =
      `${item.title} ${item.location} ${item.type}`
        .toLowerCase()
        .includes(query);

    const matchesFilter =
      filter === "All" || item.ai.priority === filter;

    return matchesSearch && matchesFilter;
  });

  // Non-duplicate incidents appear before duplicate reports
  const shortlist = [...analyzed]
    .filter((item) => item.status.toLowerCase() !== "resolved")
    .sort((a, b) => {
      if (a.is_duplicate !== b.is_duplicate) {
        return a.is_duplicate ? 1 : -1;
      }

      return b.ai.score - a.ai.score;
    })
    .slice(0, 4);

  const stats = [
    {
      label: "Total Incidents",
      value: incidents.length,
      icon: "◈",
      detail: "Reports received",
      tone: "blue",
    },
    {
      label: "Critical Cases",
      value: analyzed.filter((x) => x.ai.priority === "Critical").length,
      icon: "⚠",
      detail: "AI recommended",
      tone: "red",
    },
    {
      label: "Active Rescues",
      value: incidents.filter(
        (x) => x.status === "Rescue Assigned"
      ).length,
      icon: "⌁",
      detail: "Teams assigned",
      tone: "purple",
    },
    {
      label: "Resolved Cases",
      value: incidents.filter(
        (x) => x.status === "Resolved"
      ).length,
      icon: "✓",
      detail: "Marked resolved",
      tone: "teal",
    },
  ];

  const hospitalCount = resources.filter(
    (r) => r.resource_type?.toLowerCase() === "hospital"
  ).length;

  const shelterCount = resources.filter(
    (r) => r.resource_type?.toLowerCase() === "shelter"
  ).length;

  const totalAvailable = resources.reduce(
    (sum, resource) =>
      sum + Number(resource.available_capacity || 0),
    0
  );

  function colorFor(priority) {
    return {
      Critical: "#ff5268",
      High: "#ff9b54",
      Medium: "#f4c45e",
      Low: "#38cda5",
    }[priority] || "#8b9bb4";
  }

  // Convert similarity into percentage
  function getSimilarityPercentage(value) {
    const similarity = Number(value || 0);

    return Math.round(
      similarity <= 1 ? similarity * 100 : similarity
    );
  }

  function updateReportForm(event) {
    setForm({
      ...form,
      [event.target.name]: event.target.value,
    });
  }

  async function submitIncident(event) {
    event.preventDefault();

    const payload = {
      ...form,
      latitude: form.latitude === "" ? null : Number(form.latitude),
      longitude: form.longitude === "" ? null : Number(form.longitude),
    };

    if (!navigator.onLine) {
      saveOfflineReport(payload);
      return;
    }

    try {
      await api.post("/api/incidents", payload);

      setNotice("Emergency report submitted successfully.");
      setShowForm(false);
      setForm(EMPTY_INCIDENT_FORM);

      await loadIncidents();
    } catch (error) {
      console.error(error);

      if (!error.response) {
        saveOfflineReport(payload);
        return;
      }

      setNotice(
        error.response?.data?.detail || "Unable to submit report."
      );
    }
  }

  async function updateStatus(item, status) {
    try {
      await api.patch(`/api/incidents/${item.id}/status`, { status });
      setNotice(`Incident status updated to ${status}.`);
      await loadIncidents();
    } catch (error) {
      console.error(error);
      setNotice(
        error.response?.data?.detail || "Unable to update incident status."
      );
    }
  }

  async function assignTeam(item) {
    const assigned_team = teamInputs[item.id]?.trim();

    if (!assigned_team) {
      setNotice("Enter a rescue team name first.");
      return;
    }

    try {
      await api.patch(`/api/incidents/${item.id}/assign`, {
        assigned_team,
      });

      setNotice(`Rescue team assigned to ${item.title}.`);
      await loadIncidents();
    } catch (error) {
      console.error(error);
      setNotice(
        error.response?.data?.detail || "Unable to assign rescue team."
      );
    }
  }

  function openStreetView(item) {
    if (
      !item ||
      !Number.isFinite(item.latitude) ||
      !Number.isFinite(item.longitude)
    ) {
      setNotice("Coordinates are unavailable for this incident.");
      return;
    }

    const url =
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${item.latitude},${item.longitude}`;

    window.open(url, "_blank", "noopener,noreferrer");
  }

  // Resource form handling
  function updateResourceForm(event) {
    setResourceForm({
      ...resourceForm,
      [event.target.name]: event.target.value,
    });
  }

  async function submitResource(event) {
    event.preventDefault();

    const total = Number(resourceForm.total_capacity);
    const available = Number(resourceForm.available_capacity);

    if (available > total) {
      setNotice("Available capacity cannot exceed total capacity.");
      return;
    }

    const payload = {
      name: resourceForm.name.trim(),
      resource_type: resourceForm.resource_type,
      location: resourceForm.location.trim(),
      latitude: resourceForm.latitude === ""
        ? null
        : Number(resourceForm.latitude),
      longitude: resourceForm.longitude === ""
        ? null
        : Number(resourceForm.longitude),
      total_capacity: total,
      available_capacity: available,
      contact: resourceForm.contact.trim() || null,
    };

    setResourceSaving(true);

    try {
      await api.post("/api/resources", payload);

      setNotice("Resource added successfully.");
      setShowResourceForm(false);
      setResourceForm(EMPTY_RESOURCE_FORM);

      await loadResources();
    } catch (error) {
      console.error(error);
      setNotice(
        error.response?.data?.detail || "Unable to add resource."
      );
    } finally {
      setResourceSaving(false);
    }
  }

  function updateResourceDraft(resource, field, value) {
    setResourceUpdates((previous) => ({
      ...previous,
      [resource.id]: {
        ...previous[resource.id],
        [field]: value,
      },
    }));
  }

  async function saveResource(resource) {
    const draft = resourceUpdates[resource.id] || {};

    const available = Number(
      draft.available_capacity ?? resource.available_capacity
    );

    const status = draft.status ?? resource.status;

    if (
      !Number.isInteger(available) ||
      available < 0 ||
      available > Number(resource.total_capacity)
    ) {
      setNotice("Enter a valid available capacity.");
      return;
    }

    try {
      await api.patch(`/api/resources/${resource.id}`, {
        available_capacity: available,
        status,
      });

      setNotice("Resource updated successfully.");

      setResourceUpdates((previous) => {
        const updated = { ...previous };
        delete updated[resource.id];
        return updated;
      });

      await loadResources();
    } catch (error) {
      console.error(error);
      setNotice(
        error.response?.data?.detail || "Unable to update resource."
      );
    }
  }

  async function removeResource(resource) {
    const confirmed = window.confirm(
      `Delete ${resource.name}? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await api.delete(`/api/resources/${resource.id}`);
      setNotice("Resource deleted successfully.");
      await loadResources();
    } catch (error) {
      console.error(error);
      setNotice(
        error.response?.data?.detail || "Unable to delete resource."
      );
    }
  }

  // Authentication screen
  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="brand auth-brand">
            <span className="brand-icon">⬡</span>
            <div>
              <h2>DisasterShield</h2>
              <small>AI RESPONSE NETWORK</small>
            </div>
          </div>

          <div className="auth-heading">
            <span className="section-kicker">
              INTELLIGENT DISASTER RESPONSE
            </span>
            <h1>
              {authMode === "login"
                ? "Welcome back"
                : authMode === "register"
                ? "Citizen Registration"
                : "Rescue Team Registration"}
            </h1>
            <p>Sign in to access your DisasterShield workspace.</p>
          </div>

          <div className="auth-tabs">
            <button
              className={authMode === "login" ? "selected" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Login
            </button>
            <button
              className={authMode === "register" ? "selected" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Citizen
            </button>
            <button
              className={authMode === "rescue-register" ? "selected" : ""}
              onClick={() => {
                setAuthMode("rescue-register");
                setAuthError("");
              }}
            >
              Rescue
            </button>
          </div>

          <form className="auth-form" onSubmit={handleAuth}>
            {authMode !== "login" && (
              <label>
                Full Name
                <input
                  name="full_name"
                  placeholder="Enter your full name"
                  value={authForm.full_name}
                  onChange={updateAuthForm}
                  required
                />
              </label>
            )}

            <label>
              Email Address
              <input
                name="email"
                type="email"
                placeholder="Enter your email"
                value={authForm.email}
                onChange={updateAuthForm}
                required
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                placeholder="Enter your password"
                value={authForm.password}
                onChange={updateAuthForm}
                required
                minLength={6}
              />
            </label>

            {authMode === "rescue-register" && (
              <label>
                Rescue Invitation Code
                <input
                  name="invitation_code"
                  type="password"
                  placeholder="Enter invitation code"
                  value={authForm.invitation_code}
                  onChange={updateAuthForm}
                  required
                />
              </label>
            )}

            {authError && <div className="auth-message">{authError}</div>}

            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>

          <p className="auth-switch">
            {authMode === "login" ? (
              <>
                New citizen?{" "}
                <button onClick={() => setAuthMode("register")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button onClick={() => setAuthMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>

          <p className="auth-footer">
            DISASTERSHIELD AI · HACKATHON PROTOTYPE
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="loading-screen">Loading your workspace...</div>;
  }

  const tile =
    mapMode === "satellite"
      ? {
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attribution: "Tiles &copy; Esri",
        }
      : {
          url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        };

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">⬡</span>
          <div>
            <h2>DisasterShield</h2>
            <small>AI RESPONSE NETWORK</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav>
          <a className="active" href="#dashboard">▦ &nbsp; Overview</a>
          <a href="#incidents">
            ⚠ &nbsp; {isRescue ? "All Incidents" : "My Reports"}
          </a>

          {isRescue && (
            <>
              <a href="#intelligence">✧ &nbsp; AI Intelligence</a>
              <a href="#map">◎ &nbsp; Operations Map</a>
            </>
          )}

          <a href="#resources">▣ &nbsp; Hospitals & Shelters</a>
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon">✦</div>
          <strong>
            {isRescue ? "AI assistance active" : "Citizen portal"}
          </strong>
          <p>
            {isRescue
              ? "Review reports and coordinate response operations."
              : "Submit emergency reports and track their progress."}
          </p>
          <span className="mini-live">
            ● {user.role.toUpperCase()} ACCOUNT
          </span>
        </div>

        <div className="sidebar-bottom">
          <span className="status-dot" />{" "}
          {connected ? "Response network online" : "Connecting to backend"}
          <small>DISASTERSHIELD · HACKATHON BUILD</small>
        </div>
      </aside>

      <main className="main-content" id="dashboard">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              — EMERGENCY OPERATIONS /{" "}
              {isRescue ? "COMMAND CENTER" : "CITIZEN PORTAL"}
            </div>
            <h1>
              {isRescue ? "Rescue Operations" : "Citizen"}{" "}
              <span>Dashboard</span>
            </h1>
            <p>
              Welcome, {user.full_name}.{" "}
              {isRescue
                ? "Monitor reports and coordinate emergency response."
                : "Report emergencies and track your submitted reports."}
            </p>
          </div>

          <div className="topbar-right">
            <span className={`connection ${connected ? "online" : "offline"}`}>
              ● {connected ? "Backend connected" : "Backend disconnected"}
            </span>

            <button className="secondary-button" onClick={logout}>
              Sign Out
            </button>

            {isCitizen && (
              <button
                className="primary-button"
                onClick={() => setShowForm(!showForm)}
              >
                ＋ Report Incident
              </button>
            )}
          </div>
        </header>

        <div className={`connection-status ${isOnline ? "online" : "offline"}`}>
          <span className="connection-dot" />
          {isOnline
            ? "Internet Connected"
            : "Offline Mode — Reports will be saved locally"}
        </div>

        {offlineReports.length > 0 && (
          <div className="sync-status">
            {syncingReports
              ? `Syncing ${offlineReports.length} offline report(s)...`
              : `${offlineReports.length} report(s) waiting to sync.`}

            {isOnline && !syncingReports && (
              <button
                className="table-review"
                onClick={syncOfflineReports}
              >
                Sync Now
              </button>
            )}
          </div>
        )}

        {notice && (
          <div className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}

        {showForm && isCitizen && (
          <section className="panel report-panel">
            <div className="section-heading">
              <div>
                <span className="section-kicker">NEW FIELD REPORT</span>
                <h2>Report an emergency</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowForm(false)}
              >
                ×
              </button>
            </div>

            <form className="report-form" onSubmit={submitIncident}>
              <input
                name="title"
                placeholder="Incident title"
                value={form.title}
                onChange={updateReportForm}
                required
              />

              <select
                name="incident_type"
                value={form.incident_type}
                onChange={updateReportForm}
              >
                <option>Flood</option>
                <option>Earthquake</option>
                <option>Fire</option>
                <option>Infrastructure</option>
                <option>Rescue</option>
                <option>Other</option>
              </select>

              <select
                name="severity"
                value={form.severity}
                onChange={updateReportForm}
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Critical</option>
              </select>

              <input
                name="location"
                placeholder="Incident location"
                value={form.location}
                onChange={updateReportForm}
                required
              />

              <textarea
                name="description"
                placeholder="Describe the emergency"
                value={form.description}
                onChange={updateReportForm}
                rows="3"
              />

              <input
                name="latitude"
                type="number"
                step="any"
                placeholder="Latitude"
                value={form.latitude}
                onChange={updateReportForm}
              />

              <input
                name="longitude"
                type="number"
                step="any"
                placeholder="Longitude"
                value={form.longitude}
                onChange={updateReportForm}
              />

              <div className="form-actions">
                <button className="primary-button" type="submit">
                  {isOnline ? "Submit Report" : "Save Report Offline"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {isRescue ? (
          <>
            <section className="stats-grid">
              {stats.map((stat) => (
                <StatCard key={stat.label} {...stat} />
              ))}
            </section>

            <section className="main-grid">
              <div className="panel map-panel" id="map">
                <div className="section-heading map-heading">
                  <div>
                    <span className="section-kicker">
                      GEOSPATIAL MONITORING
                    </span>
                    <h2>Live Operations Map</h2>
                    <p>Incident locations and field activity overview</p>
                  </div>

                  <div className="map-mode-switch">
                    <button
                      className={mapMode === "street" ? "selected" : ""}
                      onClick={() => setMapMode("street")}
                    >
                      Map
                    </button>
                    <button
                      className={mapMode === "satellite" ? "selected" : ""}
                      onClick={() => setMapMode("satellite")}
                    >
                      Satellite
                    </button>
                  </div>
                </div>

                <div className="map-wrap">
                  <MapContainer
                    center={[26.55, 80.55]}
                    zoom={7}
                    scrollWheelZoom
                    className="incident-map"
                  >
                    <MapResize />
                    <TileLayer url={tile.url} attribution={tile.attribution} />

                    {analyzed.map((item) =>
                      Number.isFinite(item.latitude) &&
                      Number.isFinite(item.longitude) ? (
                        <CircleMarker
                          key={item.id}
                          center={[item.latitude, item.longitude]}
                          radius={item.ai.priority === "Critical" ? 11 : 8}
                          pathOptions={{
                            color: colorFor(item.ai.priority),
                            fillColor: colorFor(item.ai.priority),
                            fillOpacity: 0.85,
                          }}
                        >
                          <Popup>
                            <strong>{item.title}</strong>
                            <br />
                            {item.location}
                            <br />
                            AI priority: {item.ai.priority}
                            <br />
                            {item.is_duplicate && (
                              <>
                                <strong>Duplicate report</strong>
                                <br />
                              </>
                            )}
                            <button
                              className="popup-link"
                              onClick={() => openStreetView(item)}
                            >
                              Open Street View ↗
                            </button>
                          </Popup>
                        </CircleMarker>
                      ) : null
                    )}
                  </MapContainer>

                  <div className="map-legend">
                    <span><i className="critical-dot" /> Critical</span>
                    <span><i className="high-dot" /> High</span>
                    <span><i className="medium-dot" /> Medium</span>
                    <span><i className="low-dot" /> Low</span>
                  </div>
                </div>

                <div className="map-footer">
                  <span>● {incidents.length} mapped reports</span>
                </div>
              </div>

              <aside className="right-column">
                <div className="panel intelligence-panel" id="intelligence">
                  <div className="section-heading">
                    <div>
                      <span className="section-kicker">
                        MACHINE-ASSISTED TRIAGE
                      </span>
                      <h2>AI Intelligence</h2>
                    </div>
                    <span className="ai-orb">✧</span>
                  </div>

                  <div className="ai-status">● Screening reports</div>

                  <div className="ai-summary">
                    <strong>{String(shortlist.length).padStart(2, "0")}</strong>
                    <div>
                      <b>Priority Shortlist</b>
                      <small>Awaiting coordinator review</small>
                    </div>
                  </div>

                  <div className="shortlist">
                    {shortlist.length ? (
                      shortlist.map((item) => (
                        <article className="shortlist-item" key={item.id}>
                          <div className="shortlist-top">
                            <span
                              className="priority-tag"
                              style={{ color: colorFor(item.ai.priority) }}
                            >
                              {item.ai.priority}
                            </span>
                            <span className="ai-score">
                              {item.ai.score}% score
                            </span>
                          </div>

                          <strong>{item.title}</strong>

                          {item.is_duplicate && (
                            <div className="duplicate-info">
                              <span className="duplicate-badge">
                                ⚠ DUPLICATE REPORT
                              </span>

                              <p>
                                Original Report: #
                                {item.duplicate_of ?? "Reference unavailable"}
                              </p>

                              <p>
                                Similarity:{" "}
                                {getSimilarityPercentage(
                                  item.duplicate_similarity
                                )}%
                              </p>
                            </div>
                          )}

                          <small>{item.location}</small>

                          <ul>
                            {item.ai.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </article>
                      ))
                    ) : (
                      <p className="empty-state">No active reports.</p>
                    )}
                  </div>

                  <p className="ai-disclaimer">
                    AI suggestions are indicative only. A human coordinator
                    must verify reports and decide final priority.
                  </p>
                </div>
              </aside>
            </section>
          </>
        ) : (
          <section className="stats-grid">
            <StatCard
              icon="◈"
              label="My Reports"
              value={incidents.length}
              detail="Reports submitted by you"
              tone="blue"
            />
            <StatCard
              icon="⌁"
              label="Rescue Assigned"
              value={incidents.filter(
                (x) => x.status === "Rescue Assigned"
              ).length}
              detail="Teams assigned"
              tone="purple"
            />
            <StatCard
              icon="✓"
              label="Resolved"
              value={incidents.filter(
                (x) => x.status === "Resolved"
              ).length}
              detail="Completed reports"
              tone="teal"
            />
            <StatCard
              icon="◷"
              label="Awaiting Review"
              value={incidents.filter(
                (x) =>
                  x.status === "Reported" ||
                  x.status === "Under Review"
              ).length}
              detail="Pending verification"
              tone="red"
            />
          </section>
        )}

        {/* HOSPITAL AND SHELTER RESOURCES */}
        <section className="panel resource-management" id="resources">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                EMERGENCY SUPPORT NETWORK
              </span>
              <h2>Hospitals & Shelters</h2>
              <p>Resource capacity from the response database.</p>
            </div>

            <div className="resource-heading-actions">
              <button
                className="secondary-button"
                onClick={loadResources}
                disabled={resourceLoading}
              >
                ↻ Refresh
              </button>

              {isRescue && (
                <button
                  className="primary-button"
                  onClick={() => setShowResourceForm(!showResourceForm)}
                >
                  ＋ Add Resource
                </button>
              )}
            </div>
          </div>

          {showResourceForm && isRescue && (
            <form
              className="report-form resource-form"
              onSubmit={submitResource}
            >
              <input
                name="name"
                placeholder="Hospital or shelter name"
                value={resourceForm.name}
                onChange={updateResourceForm}
                required
                minLength={2}
              />

              <select
                name="resource_type"
                value={resourceForm.resource_type}
                onChange={updateResourceForm}
              >
                <option value="hospital">Hospital</option>
                <option value="shelter">Relief Shelter</option>
              </select>

              <input
                name="location"
                placeholder="Location / address"
                value={resourceForm.location}
                onChange={updateResourceForm}
                required
              />

              <input
                name="latitude"
                type="number"
                step="any"
                placeholder="Latitude (optional)"
                value={resourceForm.latitude}
                onChange={updateResourceForm}
              />

              <input
                name="longitude"
                type="number"
                step="any"
                placeholder="Longitude (optional)"
                value={resourceForm.longitude}
                onChange={updateResourceForm}
              />

              <input
                name="total_capacity"
                type="number"
                min="0"
                placeholder="Total capacity"
                value={resourceForm.total_capacity}
                onChange={updateResourceForm}
                required
              />

              <input
                name="available_capacity"
                type="number"
                min="0"
                placeholder="Available capacity"
                value={resourceForm.available_capacity}
                onChange={updateResourceForm}
                required
              />

              <input
                name="contact"
                placeholder="Contact details (optional)"
                value={resourceForm.contact}
                onChange={updateResourceForm}
              />

              <div className="form-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={resourceSaving}
                >
                  {resourceSaving ? "Saving..." : "Save Resource"}
                </button>

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowResourceForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="resource-summary">
            <div className="resource-summary-card">
              <span>🏥</span>
              <div>
                <strong>{hospitalCount}</strong>
                <small>Hospitals</small>
              </div>
            </div>

            <div className="resource-summary-card">
              <span>🏠</span>
              <div>
                <strong>{shelterCount}</strong>
                <small>Relief Shelters</small>
              </div>
            </div>

            <div className="resource-summary-card">
              <span>＋</span>
              <div>
                <strong>{totalAvailable}</strong>
                <small>Available Capacity</small>
              </div>
            </div>
          </div>

          {resourceError && (
            <p className="resource-error">{resourceError}</p>
          )}

          {resourceLoading ? (
            <p className="empty-state">Loading resources...</p>
          ) : resources.length === 0 ? (
            <p className="empty-state">
              No hospitals or shelters have been added yet.
              {isRescue && " Use Add Resource to register the first resource."}
            </p>
          ) : (
            <div className="resource-grid">
              {resources.map((resource) => {
                const draft = resourceUpdates[resource.id] || {};
                const available = Number(
                  draft.available_capacity ??
                  resource.available_capacity ??
                  0
                );

                const status = draft.status ?? resource.status ?? "Available";

                const total = Number(resource.total_capacity || 0);
                const percentage = total > 0
                  ? Math.min((available / total) * 100, 100)
                  : 0;

                return (
                  <article className="resource-card" key={resource.id}>
                    <div className="resource-card-top">
                      <span className="resource-icon">
                        {resource.resource_type?.toLowerCase() === "hospital"
                          ? "🏥"
                          : "🏠"}
                      </span>

                      <span
                        className={`resource-status ${status.toLowerCase()}`}
                      >
                        {status}
                      </span>
                    </div>

                    <span className="section-kicker">
                      {resource.resource_type?.toUpperCase() || "RESOURCE"}
                    </span>

                    <h3>{resource.name}</h3>
                    <p className="resource-location">
                      <span>⌖</span> {resource.location}
                    </p>

                    <div className="resource-capacity">
                      <div>
                        <strong>{available}</strong>
                        <span> / {total} available</span>
                      </div>
                      <span>{Math.round(percentage)}%</span>
                    </div>

                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>

                    {resource.contact && (
                      <p className="resource-contact">
                        Contact: {resource.contact}
                      </p>
                    )}

                    {isRescue && (
                      <div className="resource-admin-controls">
                        <label>
                          Available capacity
                          <input
                            type="number"
                            min="0"
                            max={total}
                            value={
                              draft.available_capacity ??
                              resource.available_capacity
                            }
                            onChange={(event) =>
                              updateResourceDraft(
                                resource,
                                "available_capacity",
                                event.target.value
                              )
                            }
                          />
                        </label>

                        <label>
                          Status
                          <select
                            value={status}
                            onChange={(event) =>
                              updateResourceDraft(
                                resource,
                                "status",
                                event.target.value
                              )
                            }
                          >
                            {RESOURCE_STATUSES.map((value) => (
                              <option key={value}>{value}</option>
                            ))}
                          </select>
                        </label>

                        <div className="resource-actions">
                          <button
                            className="primary-button"
                            onClick={() => saveResource(resource)}
                          >
                            Update
                          </button>

                          <button
                            className="secondary-button"
                            onClick={() => removeResource(resource)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* INCIDENT MANAGEMENT */}
        <section className="panel incidents-panel" id="incidents">
          <div className="section-heading incidents-heading">
            <div>
              <span className="section-kicker">FIELD INTELLIGENCE</span>
              <h2>{isRescue ? "All Incidents" : "My Emergency Reports"}</h2>
              <p>
                {isRescue
                  ? "Review incoming reports and coordinate response."
                  : "Track the status of your submitted emergency reports."}
              </p>
            </div>

            <button className="secondary-button" onClick={loadIncidents}>
              ↻ Refresh Data
            </button>
          </div>

          <div className="table-controls">
            <input
              type="search"
              placeholder="Search incident or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option>All</option>
              <option>Critical</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
          </div>

          {loading ? (
            <p className="empty-state">Loading reports...</p>
          ) : filtered.length === 0 ? (
            <p className="empty-state">No incidents found.</p>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Type</th>
                    <th>Location</th>
                    {isRescue && <th>AI Priority</th>}
                    {isRescue && <th>Score</th>}
                    <th>Status</th>
                    {isRescue && <th>Response Management</th>}
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>

                        {item.is_duplicate && (
                          <div className="duplicate-table-info">
                            <span className="duplicate-badge">
                              DUPLICATE
                            </span>
                            <small>
                              Original: #{item.duplicate_of ?? "Unavailable"}
                              {" · "}
                              {getSimilarityPercentage(
                                item.duplicate_similarity
                              )}% match
                            </small>
                          </div>
                        )}

                        <small>{item.description}</small>
                      </td>

                      <td>{item.type}</td>
                      <td>{item.location}</td>

                      {isRescue && (
                        <td>
                          <span
                            className="priority-badge"
                            style={{
                              color: colorFor(item.ai.priority),
                              background: `${colorFor(item.ai.priority)}20`,
                            }}
                          >
                            {item.ai.priority}
                          </span>
                        </td>
                      )}

                      {isRescue && (
                        <td className="score-cell">{item.ai.score}%</td>
                      )}

                      <td>
                        <span className="status-label">{item.status}</span>
                        {item.assigned_team && (
                          <small>Team: {item.assigned_team}</small>
                        )}
                      </td>

                      {isRescue && (
                        <td>
                          <div className="management-controls">
                            <select
                              value={item.status}
                              onChange={(e) =>
                                updateStatus(item, e.target.value)
                              }
                            >
                              {INCIDENT_STATUSES.map((status) => (
                                <option key={status}>{status}</option>
                              ))}
                            </select>

                            <input
                              placeholder="Rescue team name"
                              value={
                                teamInputs[item.id] ?? item.assigned_team
                              }
                              onChange={(e) =>
                                setTeamInputs({
                                  ...teamInputs,
                                  [item.id]: e.target.value,
                                })
                              }
                            />

                            <button
                              className="table-review"
                              onClick={() => assignTeam(item)}
                            >
                              Assign
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="footer">
          DISASTERSHIELD AI · Intelligent Disaster Response System ·
          Hackathon Prototype
        </footer>
      </main>
    </div>
  );
}
