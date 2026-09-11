import logging
from flask import current_app, jsonify
import json
import requests
import re
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

import google.generativeai as genai
import os

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.5-flash")

SESSION_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "whatsapp_sessions.json")

def _load_sessions():
    try:
        with open(SESSION_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}

def _save_sessions():
    os.makedirs(os.path.dirname(SESSION_PATH), exist_ok=True)
    tmp = SESSION_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(active_emergencies, f, indent=2)
    os.replace(tmp, SESSION_PATH)

# Shared routing engine: WhatsApp uses the same safe-zone/routing logic as the dashboard.
try:
    from routing.router import recommend_safe_zone
except Exception:
    recommend_safe_zone = None


def log_http_response(response):
    logging.info(f"Status: {response.status_code}")
    logging.info(f"Content-type: {response.headers.get('content-type')}")
    logging.info(f"Body: {response.text}")


def get_text_message_input(recipient, text):
    return json.dumps(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "text",
            "text": {"preview_url": False, "body": text},
        }
    )


def generate_response(user_message: str, is_emergency: bool = False, history: list | None = None) -> str:
    try:
        if is_emergency:
            system_context = (
                "You are RAKSHA, a calm disaster-response WhatsApp assistant "
                "talking to someone who just reported an emergency. Have a "
                "short, natural conversation. Keep every reply to 1-2 short "
                "sentences. Stay calm and reassuring. Do not invent facts "
                "about rescue timing or specific responder actions."
            )
        else:
            system_context = (
                "You are RAKSHA, a disaster-response WhatsApp assistant. Keep "
                "replies short and natural. If the message describes any kind "
                "of emergency or danger, tell them to reply HELP to start an "
                "emergency report."
            )

        convo_text = ""
        if history:
            for turn in history[-6:]:
                convo_text += f"{turn['role']}: {turn['text']}\n"

        prompt = f"{system_context}\n\n{convo_text}User: {user_message}\nRAKSHA:"

        result = model.generate_content(prompt, request_options={"timeout": 6})
        return result.text.strip()
    except Exception as e:
        print(f"Error occurred: {e}")
        if is_emergency:
            return "Please share your location so responders can find you."
        return "This is the RAKSHA emergency line. Reply HELP if you need assistance."


def send_message(data):
    phone_number_id = current_app.config.get("PHONE_NUMBER_ID")
    if not phone_number_id:
        logging.error(
            "PHONE_NUMBER_ID is not set — cannot send WhatsApp messages. "
            "Set PHONE_NUMBER_ID in .env to your WhatsApp Business phone "
            "number ID from the Meta App Dashboard (API Setup page)."
        )
        return jsonify({
            "status": "error",
            "message": "Server is not configured with a WhatsApp PHONE_NUMBER_ID",
        }), 500

    headers = {
        "Content-type": "application/json",
        "Authorization": f"Bearer {current_app.config['ACCESS_TOKEN']}",
    }
    url = f"https://graph.facebook.com/{current_app.config['VERSION']}/{phone_number_id}/messages"

    try:
        response = requests.post(url, data=data, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.Timeout:
        logging.error("Timeout occurred while sending message")
        return jsonify({"status": "error", "message": "Request timed out"}), 408
    except requests.RequestException as e:
        logging.error(f"Request failed due to: {e}")
        if e.response is not None:
            logging.error(f"Response body: {e.response.text}")
        return jsonify({"status": "error", "message": "Failed to send message"}), 500
    else:
        log_http_response(response)
        return response


def process_text_for_whatsapp(text):
    pattern = r"\【.*?\】"
    text = re.sub(pattern, "", text).strip()
    pattern = r"\*\*(.*?)\*\*"
    replacement = r"*\1*"
    return re.sub(pattern, replacement, text)


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

_seen_message_ids = set()

# active_emergencies[wa_id] = {
#     "name", "status", "latitude", "longitude", "address_text",
#     "injured": None | "yes" | "no",
#     "people_count": None | int,
#     "history": [...],
# }
active_emergencies = _load_sessions()

PINCODE_RE = re.compile(r"\b\d{6}\b")
NUMBER_RE = re.compile(r"\b(\d{1,2})\b")
LOCATION_HINT_WORDS = {
    "near", "street", "road", "colony", "nagar", "village", "town",
    "building", "block", "sector", "area", "pincode", "pin", "landmark",
}


def _looks_like_location(text: str) -> bool:
    if PINCODE_RE.search(text):
        return True
    lower = text.lower()
    return any(word in lower for word in LOCATION_HINT_WORDS)


def _parse_yes_no(text: str):
    lower = text.lower()
    if any(w in lower for w in ("yes", "yeah", "injured", "hurt", "bleeding")):
        return "yes"
    if any(w in lower for w in ("no", "not injured", "fine", "okay", "ok")):
        return "no"
    return None


def _parse_people_count(text: str):
    match = NUMBER_RE.search(text)
    if match:
        return int(match.group(1))
    if "alone" in text.lower() or "just me" in text.lower():
        return 1
    return None


# ---------------------------------------------------------------------------
# Multi-responder alerting - reads a comma-separated list from .env instead
# of a single hardcoded number.
# ---------------------------------------------------------------------------

def _get_responder_numbers() -> list[str]:
    raw = current_app.config.get("RESPONDER_NUMBERS") or os.getenv("RESPONDER_NUMBERS", "")
    return [n.strip() for n in raw.split(",") if n.strip()]


def _notify_all_responders() -> bool:
    raw = current_app.config.get("NOTIFY_ALL_RESPONDERS")
    if raw is None:
        raw = os.getenv("NOTIFY_ALL_RESPONDERS", "false")
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}

def _get_admin_number() -> str | None:
    return current_app.config.get("ADMIN_NUMBER") or os.getenv("ADMIN_NUMBER")


def _display_number(number: str) -> str:
    """Cosmetic only - adds a + prefix for display in alert text.
    Does NOT change what's sent to the WhatsApp API (that still uses
    the raw number without +)."""
    number = number.strip()
    return number if number.startswith("+") else f"+{number}"


def _push_to_dashboard(payload: dict):
    dashboard_url = os.getenv("DASHBOARD_API_URL")
    if not dashboard_url:
        print(f"[DASHBOARD] No DASHBOARD_API_URL set - would have sent: {payload}")
        return None
    try:
        response = requests.post(dashboard_url, json=payload, timeout=8)
        response.raise_for_status()
        try:
            return response.json()
        except ValueError:
            return None
    except requests.RequestException as e:
        print(f"[DASHBOARD ERROR] Could not reach dashboard: {e}")
        return None



def _geocode_address(text: str):
    """Best-effort geocoding for typed WhatsApp addresses when GPS coordinates
    were not shared. Location sharing remains the preferred, more precise path."""
    if not text:
        return None, None
    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": text + ", Hyderabad, India", "format": "json", "limit": 1},
            headers={"User-Agent": "RAKSHA-emergency-dashboard/1.0"},
            timeout=5,
        )
        response.raise_for_status()
        results = response.json()
        if results:
            return float(results[0]["lat"]), float(results[0]["lon"])
    except (requests.RequestException, ValueError, KeyError, TypeError):
        pass
    return None, None


def _route_guidance(record: dict):
    """Return a recommended shelter + road route for the shared victim location."""
    if recommend_safe_zone is None or record.get("latitude") is None or record.get("longitude") is None:
        return None
    try:
        result = recommend_safe_zone(
            float(record["latitude"]), float(record["longitude"]), k_candidates=5
        )
        return None if "error" in result else result
    except Exception as exc:
        logging.exception("Safe-zone recommendation failed: %s", exc)
        return None


def _build_victim_route_message(record: dict, route: dict | None) -> str:
    if not route:
        return (
            "Your emergency report is active. We could not calculate the road route right now. "
            "Please stay in a safe place and follow local emergency instructions."
        )
    maps_url = (
        f"https://www.google.com/maps/dir/?api=1"
        f"&destination={route['latitude']},{route['longitude']}&travelmode=driving"
    )
    return (
        f"Your safest available evacuation point is {route.get('name', route['shelter_id'])}. "
        f"Estimated road distance: {route['distance_km']} km; about {route['duration_min']} min. "
        f"Navigation: {maps_url}"
    )

def _notify_dashboard(wa_id: str, record: dict, send_alerts: bool = True) -> dict | None:
    # Push first so the unified backend applies the same capacity-aware
    # safe-zone selection used by the dashboard. Use its returned record for
    # the message sent back to the victim.
    payload = {
        "name": record["name"],
        "phone": wa_id,
        "latitude": record["latitude"],
        "longitude": record["longitude"],
        "address_text": record["address_text"],
        "injured": record["injured"],
        "people_count": record["people_count"],
        "type": record.get("type", "SOS"),
        "priority": "Critical" if record.get("injured") == "yes" else "High",
        "source": "WhatsApp",
        "notes": "Emergency report received through WhatsApp.",
        "recommended_shelter_id": record.get("recommended_shelter_id"),
        "recommended_shelter_name": record.get("recommended_shelter_name"),
        "evacuation_distance_km": record.get("evacuation_distance_km"),
        "evacuation_duration_min": record.get("evacuation_duration_min"),
        "timestamp": datetime.now().isoformat(),
    }
    dashboard_result = _push_to_dashboard(payload)
    backend_record = (dashboard_result or {}).get("request") if isinstance(dashboard_result, dict) else None
    if backend_record:
        record.update({k: v for k, v in backend_record.items() if v not in (None, "")})

    route = None
    if record.get("recommended_shelter_id"):
        try:
            from routing.safe_zones_loader import load_safe_zones
            zone = next(
                (z for z in load_safe_zones() if z["shelter_id"] == record["recommended_shelter_id"]),
                None,
            )
            if zone:
                route = {
                    "shelter_id": record["recommended_shelter_id"],
                    "name": record.get("recommended_shelter_name") or zone["name"],
                    "latitude": zone["latitude"],
                    "longitude": zone["longitude"],
                    "distance_km": record.get("evacuation_distance_km"),
                    "duration_min": record.get("evacuation_duration_min"),
                    "reasoning": record.get("evacuation_reason"),
                }
        except Exception:
            route = None
    if route is None:
        route = _route_guidance(record)

    if record["latitude"] is not None:
        loc_line = f"https://maps.google.com/?q={record['latitude']},{record['longitude']}"
    else:
        loc_line = record["address_text"] or "not provided"

    if send_alerts:
        admin_number = _get_admin_number()
        if admin_number:
            full_alert = (
                f"NEW EMERGENCY\n"
                f"From: {record['name']} ({_display_number(wa_id)})\n"
                f"Location: {loc_line}\n"
                f"Injured: {record['injured'] or 'unknown'}\n"
                f"People: {record['people_count'] or 'unknown'}\n"
                f"Reports from this caller: {record.get('report_count', 1)}\n"
                f"Area status: {record.get('area_status') or 'Watch'}\n"
                f"Safe zone: {record.get('recommended_shelter_name') or 'pending'}\n"
                f"ETA: {record.get('evacuation_duration_min') or 'pending'} min"
            )
            send_message(get_text_message_input(admin_number, full_alert))
        else:
            logging.warning("No ADMIN_NUMBER set - full alert not sent")

        if _notify_all_responders():
            responder_numbers = [n for n in _get_responder_numbers() if n != admin_number]
            for number in responder_numbers:
                send_message(
                    get_text_message_input(
                        number, "New emergency intake is available in RAKSHA. Check the dashboard for live location and response details."
                    )
                )
    return route


# ---------------------------------------------------------------------------
# Main handler
# ---------------------------------------------------------------------------

def process_whatsapp_message(body):
    wa_id = body["entry"][0]["changes"][0]["value"]["contacts"][0]["wa_id"]
    name = body["entry"][0]["changes"][0]["value"]["contacts"][0]["profile"]["name"]
    message = body["entry"][0]["changes"][0]["value"]["messages"][0]

    msg_id = message.get("id")
    if msg_id in _seen_message_ids:
        return
    _seen_message_ids.add(msg_id)

    msg_type = message.get("type")
    in_emergency = wa_id in active_emergencies

    if msg_type == "text":
        message_body = message["text"]["body"].strip()

        if message_body.upper().startswith("HELP") and not in_emergency:
            active_emergencies[wa_id] = {
                "name": name,
                "status": "awaiting_location",
                "latitude": None,
                "longitude": None,
                "address_text": None,
                "injured": None,
                "people_count": None,
                "history": [],
            }
            _save_sessions()
            response = "Emergency noted. Please share your location (type an address or use WhatsApp's location share)."

        elif in_emergency:
            record = active_emergencies[wa_id]

            if record["status"] == "awaiting_location" and _looks_like_location(message_body):
                record["address_text"] = message_body
                if record.get("latitude") is None:
                    lat, lon = _geocode_address(message_body)
                    record["latitude"], record["longitude"] = lat, lon
                record["status"] = "awaiting_injury"
                route = _notify_dashboard(wa_id, record, send_alerts=False)
                guidance = _build_victim_route_message(record, route)
                response = "Location noted. " + guidance + " Is anyone injured? (yes/no)"

            elif record["status"] == "awaiting_injury":
                parsed = _parse_yes_no(message_body)
                record["injured"] = parsed if parsed else message_body[:50]
                record["status"] = "awaiting_people_count"
                response = "How many people are with you right now?"

            elif record["status"] == "awaiting_people_count":
                count = _parse_people_count(message_body)
                record["people_count"] = count if count else message_body[:20]
                record["status"] = "location_received"
                route = _notify_dashboard(wa_id, record)
                guidance = _build_victim_route_message(record, route)
                response = (
                    "Your emergency report is active. Responders have been alerted. "
                    + guidance
                    + " Stay safe and follow responder instructions."
                )

            else:
                response = generate_response(message_body, is_emergency=True, history=record["history"])

            record["history"].append({"role": "User", "text": message_body})
            record["history"].append({"role": "RAKSHA", "text": response})
            _save_sessions()

        else:
            response = generate_response(message_body, is_emergency=False)

        data = get_text_message_input(wa_id, response)
        send_message(data)

    elif msg_type == "location":
        location = message["location"]
        lat = location.get("latitude")
        lon = location.get("longitude")

        if in_emergency:
            record = active_emergencies[wa_id]
            record["latitude"] = lat
            record["longitude"] = lon
            if record["status"] == "awaiting_location":
                record["status"] = "awaiting_injury"
                route = _notify_dashboard(wa_id, record, send_alerts=False)
                guidance = _build_victim_route_message(record, route)
                response = "Location received. " + guidance + " Is anyone injured? (yes/no)"
            elif record["status"] in {"awaiting_injury", "awaiting_people_count", "location_received"}:
                route = _route_guidance(record)
                response = "Updated location received. " + (_build_victim_route_message(record, route) if route else "Your location is now attached to the active emergency.")
            else:
                response = "Updated location received."
        else:
            response = "Location received, but no active emergency is linked to this. If this is urgent, reply HELP."

        _save_sessions()
        data = get_text_message_input(wa_id, response)
        send_message(data)

    else:
        response = "This message type isn't supported yet. Please send text or your location."
        data = get_text_message_input(wa_id, response)
        send_message(data)


def is_valid_whatsapp_message(body):
    return (
        body.get("object")
        and body.get("entry")
        and body["entry"][0].get("changes")
        and body["entry"][0]["changes"][0].get("value")
        and body["entry"][0]["changes"][0]["value"].get("messages")
        and body["entry"][0]["changes"][0]["value"]["messages"][0]
    )