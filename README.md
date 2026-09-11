# RAKSHA — Emergency Response Application v6

v6 is a control-room oriented upgrade of the supplied RAKSHA GIS/risk/routing/WhatsApp application.

## Operational design

### 1. Reports are evidence; incidents are cases
A single incident can accumulate many reports. Repeated WhatsApp reports from the same caller update the active incident instead of creating duplicates. Reports from different users are retained individually and spatially clustered.

### 2. Area intelligence
Geolocated reports within a 1 km cluster create an area hotspot. The system exposes:
- report count
- WhatsApp report count
- people affected
- nearby critical/high-risk buildings
- hotspot score
- trend
- Watch / High Alert / Disaster Prone classification

Three or more localized reports escalates the area to Disaster Prone. A single report can trigger High Alert when it occurs near a critical building, but it is not treated as repeated evidence.

### 3. Multi-user evacuation
Every active geolocated incident is assigned a capacity-aware safe zone and a road route. The Evacuation Network and map can show all active routes together.

Safe zones are loaded from the supplied `safe_zones.geojson`; capacity is calculated from live active incident allocations.

### 4. Responder lifecycle
Responder Operations now derives unit availability/deployment from actual incident assignments.

Incident state transitions:
Pending → Acknowledged → Dispatched → On Scene → Resolved

Each transition is persisted with timestamp/note and exposed in the Incident Detail audit trail.

### 5. Analytics
Analytics now combines:
- supplied building risk scores
- raw report count
- incident count
- WhatsApp report volume
- repeated-report rate
- hotspot escalation
- safe-zone capacity/utilization
- evacuation route performance
- response SLA metrics
- recent operational activity

### 6. Refresh and persistence
Every operational page has a Refresh tab control. The global header also has Refresh.

Refresh is non-destructive:
- incident state remains
- report history remains
- dispatch assignments remain
- activity remains
- safe-zone allocations remain
- map zoom/layer state remains
- search/filter selections are persisted in local storage

### 7. Drill Mode
Drill Mode injects a synthetic report into the same backend intake pipeline without sending any WhatsApp message. It is intended for testing:
report intake → incident → hotspot → safe zone → evacuation → analytics.

`RAKSHA_DRILL_MODE=false` disables it.

## WhatsApp

WhatsApp Cloud API remains connected to the same incident intake.

A HELP conversation can:
1. create a session,
2. receive a shared WhatsApp location,
3. synchronize the location to RAKSHA immediately,
4. select an available safe zone,
5. calculate a road evacuation route when routing is available,
6. return safe-zone and navigation guidance to the victim,
7. collect injury and people count,
8. update the same incident,
9. retain the WhatsApp conversation state across backend restarts.

New-emergency outbound notification is **admin-only by default**.

```text
NOTIFY_ALL_RESPONDERS=false
```

Only set `true` intentionally if broad notification is desired. Responder assignment is handled through the dispatch workflow.

Real WhatsApp deployment still requires Meta credentials, a public HTTPS webhook, and all dependencies in `backend/requirements.txt`.

## Backend endpoints

```text
GET    /api/health
GET    /api/dashboard
GET    /api/operations
GET    /api/activity
GET    /api/reports
GET    /api/hotspots
GET    /api/responders/status
GET    /api/response-metrics
GET    /api/victims
GET    /api/risk
GET    /api/safe-zones
GET    /api/safe-zones/status
GET    /api/route
GET    /api/reroute
GET    /api/evacuation-routes
GET    /api/assistance
GET    /api/assistance/{id}
GET    /api/assistance/{id}/history

POST   /api/assistance
POST   /api/drill/report
POST   /api/dispatch
POST   /api/clear_victim
PATCH  /api/assistance/{id}

GET/POST /webhook
```

## Supplied data

The `backend/data` folder remains the operational GIS source:
- `buildings_risk.geojson`
- `safe_zones.geojson`
- `live_victims.json`
- `responders_victims.geojson`
- `sample_route.geojson`

Operational state:
- `assistance_requests.json`
- `activity_log.json`
- `whatsapp_sessions.json`

## Run

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

```bash
cd frontend
npm install
npm run dev
```

Frontend:
```text
VITE_API_BASE_URL=http://localhost:8000/api
```
