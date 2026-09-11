"""
RAKSHA Unified Backend
Persistent incident/dispatch state + GIS/risk/routing + WhatsApp webhook bridge.
"""
import json
import os
import re
import math
import threading
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LIVE_VICTIMS_PATH = DATA_DIR / "live_victims.json"
ASSISTANCE_PATH = DATA_DIR / "assistance_requests.json"
ACTIVITY_PATH = DATA_DIR / "activity_log.json"

os.environ.setdefault("RAKSHA_SAFE_ZONES_PATH", str(DATA_DIR / "safe_zones.geojson"))

from routing.router import recommend_safe_zone, get_alternative_route
from routing.safe_zones_loader import load_safe_zones

WHATSAPP_WEBHOOK_MOUNTED = False
app = FastAPI(title="RAKSHA Unified Backend", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")

def load_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    tmp.replace(path)

assistance_requests = load_json(ASSISTANCE_PATH, [])
activity_log = load_json(ACTIVITY_PATH, [])
_evacuation_cache = {}
_evacuation_cache_lock = threading.Lock()

def log_activity(kind, message, request_id=None, meta=None):
    item = {
        "id": f"ACT-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
        "kind": kind,
        "message": message,
        "request_id": request_id,
        "timestamp": datetime.now().isoformat(),
        "meta": meta or {},
    }
    activity_log.insert(0, item)
    del activity_log[50:]
    save_json(ACTIVITY_PATH, activity_log)

def persist_requests():
    save_json(ASSISTANCE_PATH, assistance_requests)

def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0088
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    dp = math.radians(float(lat2) - float(lat1))
    dl = math.radians(float(lon2) - float(lon1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))

def _parse_people(value):
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1

def _ensure_record_fields(item):
    item.setdefault("report_count", 1)
    item.setdefault("first_report_at", item.get("timestamp"))
    item.setdefault("last_report_at", item.get("timestamp"))
    item.setdefault("report_history", [{
        "timestamp": item.get("timestamp"),
        "source": item.get("source", "Unknown"),
        "phone": item.get("phone"),
        "latitude": item.get("latitude"),
        "longitude": item.get("longitude"),
    }])
    item.setdefault("area_status", "Watch")
    return item

for _item in assistance_requests:
    _ensure_record_fields(_item)

def _record_status(item, status, note=None):
    _ensure_record_fields(item)
    history = item.setdefault("status_history", [])
    event = {
        "from": item.get("status"),
        "to": status,
        "timestamp": datetime.now().isoformat(),
        "note": note or "",
    }
    history.append(event)
    item["status"] = status
    item["updated_at"] = event["timestamp"]
    return event

for _item in assistance_requests:
    _ensure_record_fields(_item)
    _item.setdefault("status_history", [{
        "from": None,
        "to": _item.get("status", "Pending"),
        "timestamp": _item.get("timestamp"),
        "note": "Initial state",
    }])

def _responder_state():
    geojson = load_json(LIVE_VICTIMS_PATH, {"features": []})
    assignments = {x.get("assigned_responder"): x for x in assistance_requests
                   if x.get("assigned_responder") and x.get("status") not in {"Resolved","Cancelled"}}
    result = []
    for f in geojson.get("features", []):
        props = f.get("properties", {})
        if props.get("type") != "responder":
            continue
        rid = props.get("responder_id") or props.get("name")
        assignment = assignments.get(rid)
        result.append({
            "responder_id": rid,
            "name": props.get("name") or rid,
            "latitude": f.get("geometry", {}).get("coordinates", [None,None])[1],
            "longitude": f.get("geometry", {}).get("coordinates", [None,None])[0],
            "status": "Deployed" if assignment else "Available",
            "assigned_incident": assignment.get("id") if assignment else None,
            "assigned_type": assignment.get("type") if assignment else None,
            "assigned_at": assignment.get("updated_at") if assignment else None,
        })
    return result

def _area_hotspots():
    points = []
    now = datetime.now()
    for item in assistance_requests:
        _ensure_record_fields(item)
        if item.get("latitude") is None or item.get("longitude") is None:
            continue
        try:
            ts = datetime.fromisoformat(str(item.get("last_report_at") or item.get("timestamp")).replace("Z", "+00:00"))
            if ts.tzinfo:
                ts = ts.replace(tzinfo=None)
        except (TypeError, ValueError):
            ts = now
        age_hours = max(0.0, (now - ts).total_seconds() / 3600.0)
        # Keep operational hotspot intelligence focused on recent reports.
        if age_hours > 72 and item.get("status") in {"Resolved", "Cancelled"}:
            continue
        points.append(item)

    clusters = []
    for item in points:
        lat, lon = float(item["latitude"]), float(item["longitude"])
        target = next((c for c in clusters if _haversine_km(lat, lon, c["latitude"], c["longitude"]) <= 1.0), None)
        if target is None:
            target = {
                "cluster_id": f"AREA-{len(clusters)+1:03d}",
                "latitude": lat,
                "longitude": lon,
                "incident_ids": [],
                "report_count": 0,
                "people_affected": 0,
                "whatsapp_reports": 0,
                "web_reports": 0,
                "critical_buildings": 0,
                "first_report_at": item.get("first_report_at"),
                "last_report_at": item.get("last_report_at"),
            }
            clusters.append(target)

        target["incident_ids"].append(item["id"])
        rc = max(1, int(item.get("report_count") or 1))
        target["report_count"] += rc
        target["people_affected"] += _parse_people(item.get("people_count"))
        if str(item.get("source", "")).lower() == "whatsapp":
            target["whatsapp_reports"] += rc
        else:
            target["web_reports"] += rc

    buildings = load_json(DATA_DIR / "buildings_risk.geojson", {"features": []}).get("features", [])
    for cluster in clusters:
        nearby = []
        for f in buildings:
            props = f.get("properties", {})
            coords = f.get("geometry", {}).get("coordinates", [None, None])
            if coords[0] is None:
                continue
            if _haversine_km(cluster["latitude"], cluster["longitude"], coords[1], coords[0]) <= 1.0:
                nearby.append(props)
        cluster["critical_buildings"] = sum(1 for p in nearby if p.get("risk_score", 0) >= 80)
        cluster["nearby_highest_risk"] = max([p.get("risk_score", 0) for p in nearby] or [0])

        score = min(100, cluster["report_count"] * 18 + cluster["people_affected"] * 4 + cluster["critical_buildings"] * 18 + min(25, cluster["whatsapp_reports"] * 3))
        cluster["hotspot_score"] = int(round(score))
        # Repeated independent reports are the escalation trigger. A single
        # report near a critical building is a high-priority incident, but is
        # not automatically reclassified as a disaster-prone AREA.
        cluster["area_status"] = (
            "Disaster Prone" if cluster["report_count"] >= 3 else
            "High Alert" if cluster["report_count"] >= 2 or cluster["critical_buildings"] >= 1 else
            "Watch"
        )
        cluster["trend"] = (
            "Escalating" if cluster["report_count"] >= 3 else
            "Emerging" if cluster["report_count"] == 2 else
            "Single report"
        )
        cluster["primary_incident"] = cluster["incident_ids"][0]

    clusters.sort(key=lambda x: (x["hotspot_score"], x["report_count"]), reverse=True)
    return clusters

def _sync_area_flags():
    clusters = _area_hotspots()
    by_incident = {}
    for cluster in clusters:
        for incident_id in cluster["incident_ids"]:
            by_incident[incident_id] = cluster["area_status"]
    changed = False
    for item in assistance_requests:
        status = by_incident.get(item.get("id"), item.get("area_status", "Watch"))
        if item.get("area_status") != status:
            item["area_status"] = status
            changed = True
    if changed:
        persist_requests()
    return clusters

def next_request_id():
    nums = []
    for item in assistance_requests:
        found = re.search(r"(\d+)$", str(item.get("id", "")))
        if found:
            nums.append(int(found.group(1)))
    return f"REQ-{max(nums + [100]) + 1}"

@app.get("/")
def root():
    return {
        "service": "RAKSHA Unified Backend",
        "version": "2.1.0",
        "status": "operational",
        "api": "/api",
        "gis": "/map",
    }

@app.get("/map")
def gis_dashboard():
    return FileResponse(BASE_DIR / "gis_dashboard.html")

@app.get("/api/dashboard")
def dashboard():
    clusters = _sync_area_flags()
    buildings = load_json(DATA_DIR / "buildings_risk.geojson", {"features": []}).get("features", [])
    people = load_json(LIVE_VICTIMS_PATH, {"features": []}).get("features", [])
    return {
        "critical": sum(x.get("properties", {}).get("risk_score", 0) >= 80 for x in buildings),
        "high": sum(60 <= x.get("properties", {}).get("risk_score", 0) < 80 for x in buildings),
        "victims": sum(x.get("properties", {}).get("type") == "victim" for x in people),
        "responders": sum(x.get("properties", {}).get("type") == "responder" for x in people),
        "shelters": len(load_safe_zones()),
        "requests": len(assistance_requests),
        "pending_requests": sum(x.get("status") == "Pending" for x in assistance_requests),
        "active_requests": sum(x.get("status") not in {"Resolved", "Cancelled"} for x in assistance_requests),
        "reports_received": sum(int(x.get("report_count") or 1) for x in assistance_requests),
        "whatsapp_reports": sum(int(x.get("report_count") or 1) for x in assistance_requests if str(x.get("source", "")).lower() == "whatsapp"),
        "hotspots": len(clusters),
        "disaster_prone_areas": sum(x.get("area_status") == "Disaster Prone" for x in clusters),
    }

@app.get("/api/health")
def health():
    return {
        "status": "operational",
        "service": "RAKSHA Unified Backend",
        "timestamp": datetime.now().isoformat(),
        "integrations": {
            "gis": "online",
            "routing": "online",
            "risk": "online",
            "assistance": "online",
            "activity_store": "online",
            "operational_metrics": "online",
            "whatsapp": (
                "online"
                if WHATSAPP_WEBHOOK_MOUNTED and all(os.getenv(k) for k in ("ACCESS_TOKEN", "PHONE_NUMBER_ID", "VERIFY_TOKEN", "VERSION"))
                else (
                    "configuration_missing"
                    if not all(os.getenv(k) for k in ("ACCESS_TOKEN", "PHONE_NUMBER_ID", "VERIFY_TOKEN", "VERSION"))
                    else "dependency_missing"
                )
            ),
        },
    }

@app.get("/api/victims")
def get_victims():
    return load_json(LIVE_VICTIMS_PATH, {"type": "FeatureCollection", "features": []})

@app.post("/api/clear_victim")
async def clear_victim(request: Request):
    body = await request.json()
    victim_id = body.get("victim_id")
    geojson = load_json(LIVE_VICTIMS_PATH, {"type": "FeatureCollection", "features": []})
    before = len(geojson.get("features", []))
    geojson["features"] = [
        f for f in geojson.get("features", [])
        if str(f.get("properties", {}).get("victim_id")) != str(victim_id)
    ]
    if not victim_id or len(geojson["features"]) == before:
        return JSONResponse({"status": "error", "message": "Victim not found"}, status_code=404)
    save_json(LIVE_VICTIMS_PATH, geojson)
    log_activity("victim.cleared", f"Victim {victim_id} cleared from live feed", victim_id)
    return {"status": "success", "message": f"Victim {victim_id} cleared"}

@app.get("/api/risk")
def get_risk_data():
    geojson = load_json(DATA_DIR / "buildings_risk.geojson", {"type": "FeatureCollection", "features": []})
    return {"geojson": geojson, "buildings": [f.get("properties", {}) for f in geojson.get("features", [])]}

@app.get("/api/safe-zones")
def get_safe_zones():
    return load_safe_zones()

@app.get("/api/route")
def get_route(latitude: float, longitude: float, k: int = 3):
    zones = _available_safe_zones()
    if not zones:
        raise HTTPException(status_code=409, detail="No safe zones currently have available capacity.")
    result = recommend_safe_zone(latitude, longitude, k_candidates=min(k, len(zones)), safe_zones=zones)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result

@app.get("/api/reroute")
def reroute(
    latitude: float, longitude: float, shelter_lat: float, shelter_lon: float,
    blocked_lat: float, blocked_lon: float,
):
    result = get_alternative_route(latitude, longitude, shelter_lat, shelter_lon, blocked_lat, blocked_lon)
    if "error" in result:
        raise HTTPException(status_code=502, detail=result["error"])
    return result



def _available_safe_zones():
    zones = load_safe_zones()
    active = [x for x in assistance_requests if x.get("status") not in {"Resolved", "Cancelled"}]
    allocated = {}
    for item in active:
        sid = item.get("recommended_shelter_id")
        if sid:
            allocated[sid] = allocated.get(sid, 0) + int(item.get("people_count") or 1)
    available = []
    for zone in zones:
        capacity = int(zone.get("capacity") or 0)
        used = allocated.get(zone["shelter_id"], 0)
        if capacity and used >= capacity:
            continue
        available.append(zone)
    return available

@app.get("/api/safe-zones/status")
def safe_zone_status():
    zones = load_safe_zones()
    active = [x for x in assistance_requests if x.get("status") not in {"Resolved", "Cancelled"}]
    # Incidents that have already been recommended a shelter count toward that shelter.
    allocated = {}
    for item in active:
        sid = item.get("recommended_shelter_id")
        if sid:
            allocated[sid] = allocated.get(sid, 0) + int(item.get("people_count") or 1)
    result = []
    for zone in zones:
        capacity = int(zone.get("capacity") or 0)
        used = allocated.get(zone["shelter_id"], 0)
        result.append({
            **zone,
            "allocated_people": used,
            "available_capacity": max(capacity - used, 0) if capacity else None,
            "availability": "Limited" if capacity and used >= capacity * 0.8 else "Available",
        })
    return result

def _evacuation_routes_payload(force=False):
    now = datetime.now().timestamp()
    cache_key = "active"
    with _evacuation_cache_lock:
        cached = _evacuation_cache.get(cache_key)
        if not force and cached and now - cached["time"] < 20:
            return cached["data"]

    active = [
        x for x in assistance_requests
        if x.get("status") not in {"Resolved", "Cancelled"}
        and x.get("latitude") is not None and x.get("longitude") is not None
    ]
    routes = []
    zones = _available_safe_zones()
    for item in active:
        lat, lon = float(item["latitude"]), float(item["longitude"])
        try:
            route = recommend_safe_zone(lat, lon, k_candidates=min(5, max(1, len(zones))), safe_zones=zones)
        except Exception as exc:
            route = {"error": str(exc)}
        if "error" not in route:
            routes.append({
                "request_id": item["id"],
                "name": item.get("name") or item["id"],
                "source": item.get("source", "Unknown"),
                "status": item.get("status", "Pending"),
                "priority": item.get("priority", "High"),
                "people_count": item.get("people_count", 1),
                "injured": item.get("injured"),
                "latitude": lat,
                "longitude": lon,
                "shelter_id": route["shelter_id"],
                "shelter_name": route.get("name", route["shelter_id"]),
                "shelter_latitude": route["latitude"],
                "shelter_longitude": route["longitude"],
                "distance_km": route["distance_km"],
                "duration_min": route["duration_min"],
                "reasoning": route.get("reasoning"),
                "geometry": route.get("geometry"),
            })
        else:
            routes.append({
                "request_id": item["id"], "name": item.get("name") or item["id"],
                "source": item.get("source", "Unknown"), "status": item.get("status", "Pending"),
                "priority": item.get("priority", "High"), "people_count": item.get("people_count", 1),
                "injured": item.get("injured"), "latitude": lat, "longitude": lon,
                "error": route["error"],
            })
    data={"generated_at":datetime.now().isoformat(),"routes":routes,"route_count":len(routes)}
    with _evacuation_cache_lock:
        _evacuation_cache[cache_key]={"time":now,"data":data}
    return data

@app.get("/api/evacuation-routes")
def evacuation_routes(force: bool = False):
    return _evacuation_routes_payload(force=force)

@app.get("/api/assistance")
def list_assistance(status: str = "All"):
    _sync_area_flags()
    items = assistance_requests
    if status != "All":
        items = [x for x in items if x.get("status") == status]
    return sorted(items, key=lambda x: x.get("timestamp", ""), reverse=True)

@app.get("/api/assistance/{request_id}")
def get_assistance(request_id: str):
    _sync_area_flags()
    for item in assistance_requests:
        if item["id"] == request_id:
            return item
    raise HTTPException(status_code=404, detail="Request not found")

@app.post("/api/assistance")
async def create_assistance(request: Request):
    body = await request.json()
    source = body.get("source", "Web")
    latitude, longitude = body.get("latitude"), body.get("longitude")
    timestamp = body.get("timestamp") or datetime.now().isoformat()
    priority = body.get("priority", "High")

    # Same phone + active incident = additional report, not a new emergency.
    existing = None
    if str(source).lower() == "whatsapp" and body.get("phone"):
        existing = next(
            (
                x for x in assistance_requests
                if x.get("phone") == body.get("phone")
                and x.get("status") not in {"Resolved", "Cancelled"}
            ),
            None,
        )

    if existing:
        _ensure_record_fields(existing)
        existing["report_count"] = int(existing.get("report_count") or 1) + 1
        existing["last_report_at"] = timestamp
        if latitude is not None and longitude is not None:
            existing["latitude"] = latitude
            existing["longitude"] = longitude
        for key in ("name", "address_text", "injured", "people_count", "type", "priority", "notes"):
            if body.get(key) not in (None, ""):
                existing[key] = body.get(key)
        existing["report_history"].append({
            "timestamp": timestamp,
            "source": source,
            "phone": body.get("phone"),
            "latitude": latitude,
            "longitude": longitude,
        })
        record = existing
        event_kind = "incident.repeat_report"
        event_message = f"{record['id']} received repeat report #{record['report_count']}"
    else:
        record = {
            "id": next_request_id(),
            "name": body.get("name", "Unknown"),
            "phone": body.get("phone"),
            "latitude": latitude,
            "longitude": longitude,
            "address_text": body.get("address_text") or body.get("location"),
            "injured": body.get("injured"),
            "people_count": body.get("people_count") or 1,
            "type": body.get("type", "SOS"),
            "priority": priority,
            "status": "Pending",
            "source": source,
            "notes": body.get("notes", ""),
            "timestamp": timestamp,
            "report_count": 1,
            "first_report_at": timestamp,
            "last_report_at": timestamp,
            "report_history": [{
                "timestamp": timestamp,
                "source": source,
                "phone": body.get("phone"),
                "latitude": latitude,
                "longitude": longitude,
            }],
        }
        assistance_requests.append(record)
        event_kind = "incident.created"
        event_message = f"{record['id']} received from {source}"

    _ensure_record_fields(record)
    record.setdefault("status_history", [{"from": None, "to": "Pending", "timestamp": record["timestamp"], "note": "Initial intake"}])

    # Capacity-aware safe zone recommendation. On failure, retain the incident.
    if record.get("latitude") is not None and record.get("longitude") is not None:
        try:
            available_zones = _available_safe_zones()
            recommendation = recommend_safe_zone(
                float(record["latitude"]), float(record["longitude"]),
                k_candidates=min(5, max(1, len(available_zones))),
                safe_zones=available_zones
            ) if available_zones else {"error": "No safe zones have available capacity"}
            if "error" not in recommendation:
                record["recommended_shelter_id"] = recommendation["shelter_id"]
                record["recommended_shelter_name"] = recommendation.get("name", recommendation["shelter_id"])
                record["evacuation_distance_km"] = recommendation.get("distance_km")
                record["evacuation_duration_min"] = recommendation.get("duration_min")
                record["evacuation_reason"] = recommendation.get("reasoning")
                record.pop("route_error", None)
            else:
                record["route_error"] = recommendation["error"]
        except Exception as exc:
            record["route_error"] = str(exc)

    # Estimate the current hotspot status for this incident.
    persist_requests()
    _evacuation_cache.clear()
    cluster = next(
        (
            h for h in _area_hotspots()
            if record.get("latitude") is not None
            and _haversine_km(record["latitude"], record["longitude"], h["latitude"], h["longitude"]) <= 1.0
            and record["id"] in h["incident_ids"]
        ),
        None,
    )
    record["area_status"] = cluster["area_status"] if cluster else "Watch"

    persist_requests()
    log_activity(event_kind, event_message, record["id"], {
        "source": source, "report_count": record["report_count"],
        "area_status": record["area_status"],
    })

    # Add/update one GIS victim point for this incident.
    if record["latitude"] is not None and record["longitude"] is not None:
        geojson = load_json(LIVE_VICTIMS_PATH, {"type": "FeatureCollection", "features": []})
        existing_feature = next(
            (f for f in geojson.get("features", []) if str(f.get("properties", {}).get("victim_id")) == str(record["id"])),
            None,
        )
        props = {
            "type": "victim", "victim_id": record["id"],
            "status": "Trapped" if record.get("injured") == "yes" else "Reported",
            "people_count": _parse_people(record.get("people_count")),
            "source": record.get("source"),
            "report_count": record.get("report_count", 1),
            "area_status": record.get("area_status", "Watch"),
        }
        if existing_feature:
            existing_feature["geometry"] = {"type":"Point","coordinates":[record["longitude"],record["latitude"]]}
            existing_feature.setdefault("properties", {}).update(props)
        else:
            geojson.setdefault("features", []).append({
                "type":"Feature",
                "geometry":{"type":"Point","coordinates":[record["longitude"],record["latitude"]]},
                "properties":props,
            })
        save_json(LIVE_VICTIMS_PATH, geojson)

    return {"status": "ok", "request": record}

@app.patch("/api/assistance/{request_id}")
async def update_assistance(request_id: str, request: Request):
    body = await request.json()
    new_status = body.get("status")
    allowed = {"Pending", "Acknowledged", "Dispatched", "On Scene", "Resolved", "Cancelled"}
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status")
    for item in assistance_requests:
        if item["id"] == request_id:
            old = item.get("status")
            event = _record_status(item, new_status, body.get("note") or body.get("notes"))

            if body.get("notes") is not None:
                item["notes"] = body.get("notes")
            persist_requests()
            _evacuation_cache.clear()
            log_activity("incident.updated", f"{request_id}: {old} → {new_status}", request_id,
                         {"previous": old, "status": new_status, "note": event.get("note", "")})
            return {"status": "ok", "request": item}
    raise HTTPException(status_code=404, detail="Request not found")

@app.post("/api/dispatch")
async def dispatch_responder(request: Request):
    body = await request.json()
    request_id = body.get("request_id")
    responder_id = body.get("responder_id")
    if not request_id or not responder_id:
        raise HTTPException(status_code=400, detail="request_id and responder_id are required")
    for item in assistance_requests:
        if item["id"] == request_id:
            _record_status(item, "Dispatched", f"Assigned to {responder_id}")
            item["assigned_responder"] = responder_id
            persist_requests()
            _evacuation_cache.clear()
            log_activity("dispatch.created", f"{responder_id} dispatched to {request_id}", request_id,
                         {"responder_id": responder_id})
            return {"status": "ok", "assignment": {"request_id": request_id, "responder_id": responder_id}}
    raise HTTPException(status_code=404, detail="Request not found")

@app.get("/api/activity")
def activity(limit: int = 25):
    return activity_log[:max(1, min(limit, 50))]

@app.get("/api/hotspots")
def hotspots():
    clusters = _sync_area_flags()
    return {"generated_at": datetime.now().isoformat(), "hotspots": clusters, "count": len(clusters)}

@app.get("/api/reports")
def reports(limit: int = 100):
    events = []
    for item in assistance_requests:
        _ensure_record_fields(item)
        history = item.get("report_history", [])
        for i, event in enumerate(history, 1):
            events.append({
                "report_id": f"{item['id']}-R{i:02d}",
                "incident_id": item["id"],
                "timestamp": event.get("timestamp") or item.get("timestamp"),
                "source": event.get("source") or item.get("source"),
                "phone": event.get("phone") or item.get("phone"),
                "latitude": event.get("latitude") if event.get("latitude") is not None else item.get("latitude"),
                "longitude": event.get("longitude") if event.get("longitude") is not None else item.get("longitude"),
                "report_count": item.get("report_count", 1),
                "area_status": item.get("area_status", "Watch"),
            })
    return sorted(events, key=lambda x: x.get("timestamp", ""), reverse=True)[:max(1, min(limit, 500))]

@app.get("/api/operations")
def operations():
    clusters = _sync_area_flags()
    buildings = load_json(DATA_DIR / "buildings_risk.geojson", {"features": []}).get("features", [])
    people = load_json(LIVE_VICTIMS_PATH, {"features": []}).get("features", [])
    active = [x for x in assistance_requests if x.get("status") not in {"Resolved", "Cancelled"}]
    return {
        "timestamp": datetime.now().isoformat(),
        "request_counts": {
            "total": len(assistance_requests),
            "active": len(active),
            "pending": sum(x.get("status") == "Pending" for x in assistance_requests),
            "acknowledged": sum(x.get("status") == "Acknowledged" for x in assistance_requests),
            "dispatched": sum(x.get("status") == "Dispatched" for x in assistance_requests),
            "on_scene": sum(x.get("status") == "On Scene" for x in assistance_requests),
        },
        "people": {
            "victims": sum(x.get("properties", {}).get("type") == "victim" for x in people),
            "responders": sum(x.get("properties", {}).get("type") == "responder" for x in people),
        },
        "critical_sites": [
            x.get("properties", {}) for x in sorted(
                buildings,
                key=lambda x: x.get("properties", {}).get("risk_score", 0),
                reverse=True
            )[:6]
        ],
        "recent_activity": activity_log[:10],
        "hotspots": clusters[:10],
        "responders_state": _responder_state(),
        "response_metrics": response_metrics(),
    }

@app.post("/api/drill/report")
async def drill_report(request: Request):
    """Controlled synthetic report for demonstrations and integration testing.
    Never sends a WhatsApp message; it exercises the same incident pipeline."""
    if os.getenv("RAKSHA_DRILL_MODE", "true").lower() not in {"1","true","yes","on"}:
        raise HTTPException(status_code=403, detail="Drill mode is disabled.")
    body = await request.json()
    # Reuse the production intake path by constructing a small request-like adapter.
    class _Body:
        async def json(self):
            return body | {"source": body.get("source", "Drill")}
    return await create_assistance(_Body())

@app.get("/api/responders/status")
def responders_status():
    units = _responder_state()
    return {"units": units, "available": sum(x["status"] == "Available" for x in units), "deployed": sum(x["status"] == "Deployed" for x in units)}

@app.get("/api/assistance/{request_id}/history")
def assistance_history(request_id: str):
    for item in assistance_requests:
        if item["id"] == request_id:
            _ensure_record_fields(item)
            return {
                "request_id": request_id,
                "report_history": item.get("report_history", []),
                "status_history": item.get("status_history", []),
            }
    raise HTTPException(status_code=404, detail="Request not found")

@app.get("/api/response-metrics")
def response_metrics():
    active = [x for x in assistance_requests if x.get("status") not in {"Resolved", "Cancelled"}]
    resolved = [x for x in assistance_requests if x.get("status") == "Resolved"]
    pending = [x for x in assistance_requests if x.get("status") == "Pending"]

    acknowledge_minutes = []
    dispatch_minutes = []
    resolution_minutes = []
    for item in assistance_requests:
        hist = item.get("status_history", [])
        starts = {h.get("to"): h.get("timestamp") for h in hist if h.get("timestamp")}
        try:
            t0 = datetime.fromisoformat(str(starts.get(item.get("status_history", [{}])[0].get("to"))).replace("Z","+00:00"))
            if t0.tzinfo: t0=t0.replace(tzinfo=None)
        except Exception:
            t0=None
        for stage, bucket in [("Acknowledged", acknowledge_minutes),("Dispatched",dispatch_minutes),("Resolved",resolution_minutes)]:
            if starts.get(stage) and item.get("timestamp"):
                try:
                    a=datetime.fromisoformat(str(item["timestamp"]).replace("Z","+00:00")); b=datetime.fromisoformat(str(starts[stage]).replace("Z","+00:00"))
                    if a.tzinfo: a=a.replace(tzinfo=None)
                    if b.tzinfo: b=b.replace(tzinfo=None)
                    if b>=a: bucket.append((b-a).total_seconds()/60)
                except Exception: pass
    avg=lambda xs: round(sum(xs)/len(xs),1) if xs else None
    return {
        "active_incidents": len(active),
        "pending_incidents": len(pending),
        "resolved_incidents": len(resolved),
        "average_minutes_to_acknowledge": avg(acknowledge_minutes),
        "average_minutes_to_dispatch": avg(dispatch_minutes),
        "average_minutes_to_resolve": avg(resolution_minutes),
        "response_sla": {
            "acknowledge_under_10m": sum(1 for x in acknowledge_minutes if x <= 10),
            "dispatch_under_20m": sum(1 for x in dispatch_minutes if x <= 20),
        },
    }

@app.get("/api/incidents/timeline")
def incident_timeline():
    return sorted(assistance_requests, key=lambda x: x.get("timestamp", ""), reverse=True)[:20]

try:
    from a2wsgi import WSGIMiddleware
    from app import create_app as create_whatsapp_app
    os.environ.setdefault("DASHBOARD_API_URL", "http://localhost:8000/api/assistance")
    app.mount("/", WSGIMiddleware(create_whatsapp_app()), name="whatsapp_webhook")
except Exception as exc:
    print(f"[startup] WhatsApp webhook not mounted: {exc}")
