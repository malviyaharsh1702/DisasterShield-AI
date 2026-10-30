
import re
from difflib import SequenceMatcher


# -----------------------------------------
# DISASTER CLASSIFICATION
# -----------------------------------------

DISASTER_KEYWORDS = {
    "Flood": [
        "flood", "flooding", "waterlogging", "water level",
        "heavy rainfall", "overflow", "submerged", "drowning"
    ],
    "Earthquake": [
        "earthquake", "tremor", "seismic", "building shaking",
        "collapsed building", "aftershock"
    ],
    "Fire": [
        "fire", "flames", "burning", "smoke", "explosion",
        "short circuit"
    ],
    "Landslide": [
        "landslide", "mudslide", "rockfall", "soil collapse"
    ],
    "Cyclone": [
        "cyclone", "hurricane", "storm", "strong winds",
        "tornado"
    ],
    "Medical Emergency": [
        "injured", "injury", "medical emergency", "ambulance",
        "unconscious", "trapped", "bleeding"
    ]
}


def classify_disaster(text, submitted_type="Other"):
    text = text.lower()

    scores = {}

    for disaster, keywords in DISASTER_KEYWORDS.items():
        scores[disaster] = sum(
            1 for keyword in keywords if keyword in text
        )

    best_type = max(scores, key=scores.get)

    if scores[best_type] == 0:
        return submitted_type or "Other"

    return best_type


# -----------------------------------------
# SEVERITY DETECTION
# -----------------------------------------

SEVERITY_LEVELS = {
    "Low": 1,
    "Medium": 2,
    "High": 3,
    "Critical": 4
}

SEVERITY_KEYWORDS = {
    "Critical": [
        "multiple deaths", "people trapped", "building collapsed",
        "life threatening", "many injured", "mass casualty",
        "people missing", "severe destruction"
    ],
    "High": [
        "trapped", "injured", "rescue needed", "families stranded",
        "major damage", "hospital emergency", "people stranded"
    ],
    "Medium": [
        "road blocked", "power outage", "waterlogging",
        "property damage", "moderate damage"
    ],
    "Low": [
        "minor damage", "small incident", "no injuries"
    ]
}


def detect_severity(text, submitted_severity="Medium"):
    text = text.lower()

    detected = "Low"

    for severity in ["Critical", "High", "Medium", "Low"]:
        if any(
            keyword in text
            for keyword in SEVERITY_KEYWORDS[severity]
        ):
            detected = severity
            break

    # Never reduce the severity submitted by the citizen.
    submitted = submitted_severity.title()

    if submitted not in SEVERITY_LEVELS:
        submitted = "Medium"

    if (
        SEVERITY_LEVELS[submitted]
        > SEVERITY_LEVELS[detected]
    ):
        detected = submitted

    return detected


# -----------------------------------------
# PRIORITY SCORING (0-100)
# -----------------------------------------

def calculate_priority(severity, disaster_type, text):

    score = {
        "Low": 20,
        "Medium": 40,
        "High": 65,
        "Critical": 85
    }.get(severity, 40)

    text = text.lower()

    urgent_keywords = [
        "trapped", "missing", "injured", "children",
        "elderly", "hospital", "rescue needed",
        "families stranded", "life threatening"
    ]

    urgency_bonus = sum(
        3 for keyword in urgent_keywords if keyword in text
    )

    score += min(urgency_bonus, 15)

    if disaster_type in ["Earthquake", "Fire", "Flood"]:
        score += 5

    return min(score, 100)


# -----------------------------------------
# COMPLETE INCIDENT ANALYSIS
# -----------------------------------------

def analyze_incident(
    title,
    description,
    incident_type,
    severity
):

    text = f"{title} {description}"

    predicted_type = classify_disaster(
        text,
        incident_type
    )

    predicted_severity = detect_severity(
        text,
        severity
    )

    priority = calculate_priority(
        predicted_severity,
        predicted_type,
        text
    )

    return {
        "predicted_type": predicted_type,
        "predicted_severity": predicted_severity,
        "priority_score": priority,
        "analysis_method": "Rule-based AI engine"
    }


# -----------------------------------------
# DUPLICATE REPORT DETECTION
# -----------------------------------------

def normalize_text(text):
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def similarity_score(text1, text2):
    return SequenceMatcher(
        None,
        normalize_text(text1),
        normalize_text(text2)
    ).ratio()


def detect_duplicate(
    new_title,
    new_description,
    new_location,
    existing_incidents
):

    new_text = f"{new_title} {new_description}"

    for incident in existing_incidents:

        old_location = normalize_text(
            incident["location"]
        )

        current_location = normalize_text(
            new_location
        )

        # Compare reports only when their locations match.
        if old_location != current_location:
            continue

        old_text = (
            f"{incident['title']} "
            f"{incident['description']}"
        )

        similarity = similarity_score(
            new_text,
            old_text
        )

        if similarity >= 0.65:
            return {
                "is_duplicate": True,
                "duplicate_of": incident["id"],
                "similarity": round(similarity * 100, 2)
            }

    return {
        "is_duplicate": False,
        "duplicate_of": None,
        "similarity": 0
    }
