
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


def contains_keyword(text, keyword):
    pattern = r"(?<!\w)" + re.escape(keyword.lower()) + r"(?!\w)"
    return re.search(pattern, text) is not None


def classify_disaster(text, submitted_type="Other"):
    text = str(text or "").lower()

    scores = {
        disaster: sum(
            1 for keyword in keywords
            if contains_keyword(text, keyword)
        )
        for disaster, keywords in DISASTER_KEYWORDS.items()
    }

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
    text = str(text or "").lower()

    detected = "Low"

    for severity in ["Critical", "High", "Medium", "Low"]:
        if any(
            contains_keyword(text, keyword)
            for keyword in SEVERITY_KEYWORDS[severity]
        ):
            detected = severity
            break

    submitted = str(submitted_severity or "Medium").title()

    if submitted not in SEVERITY_LEVELS:
        submitted = "Medium"

    # Never reduce citizen-submitted severity.
    if SEVERITY_LEVELS[submitted] > SEVERITY_LEVELS[detected]:
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

    text = str(text or "").lower()

    urgent_keywords = [
        "trapped", "missing", "injured", "children",
        "elderly", "hospital", "rescue needed",
        "families stranded", "life threatening"
    ]

    urgency_bonus = sum(
        3 for keyword in urgent_keywords
        if contains_keyword(text, keyword)
    )

    score += min(urgency_bonus, 15)

    if disaster_type in ["Earthquake", "Fire", "Flood"]:
        score += 5

    return min(score, 100)


# -----------------------------------------
# COMPLETE INCIDENT ANALYSIS
# -----------------------------------------

def analyze_incident(title, description, incident_type, severity):
    title = str(title or "")
    description = str(description or "")

    text = f"{title} {description}"

    predicted_type = classify_disaster(
        text, incident_type
    )

    predicted_severity = detect_severity(
        text, severity
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
    text = str(text or "").lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def similarity_score(text1, text2):
    text1 = normalize_text(text1)
    text2 = normalize_text(text2)

    if not text1 or not text2:
        return 0.0

    return SequenceMatcher(
        None, text1, text2
    ).ratio()


def detect_duplicate(
    new_title,
    new_description,
    new_location,
    existing_incidents
):
    new_text = f"{new_title or ''} {new_description or ''}"
    current_location = normalize_text(new_location)

    best_match = None
    best_similarity = 0.0

    for incident in existing_incidents:
        old_location = normalize_text(
            incident.get("location", "")
        )

        # Compare only reports from the same normalized location.
        if not current_location or old_location != current_location:
            continue

        old_text = (
            f"{incident.get('title', '')} "
            f"{incident.get('description', '')}"
        )

        similarity = similarity_score(new_text, old_text)

        if similarity > best_similarity:
            best_similarity = similarity
            best_match = incident

    if best_match and best_similarity >= 0.65:
        return {
            "is_duplicate": True,
            "duplicate_of": best_match.get("id"),
            "similarity": round(best_similarity * 100, 2)
        }

    return {
        "is_duplicate": False,
        "duplicate_of": None,
        "similarity": round(best_similarity * 100, 2)
    }
