const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

export const getRiskData = () => request("/risk");
export const getSafeZones = () => request("/safe-zones");
export const getSafeZoneStatus = () => request("/safe-zones/status");
export const getEvacuationRoutes = (force=false) => request(`/evacuation-routes?force=${force}`);
export const getHotspots = () => request("/hotspots");
export const getReports = (limit=100) => request(`/reports?limit=${limit}`);
export const getRoute = (latitude, longitude) => request(`/route?latitude=${latitude}&longitude=${longitude}`);
export const getVictims = () => request("/victims");
export const getAssistanceRequests = () => request("/assistance");
export const getDashboardStats = () => request("/dashboard");
export const getSystemHealth = () => request("/health");
export const getIncidentTimeline = () => request("/incidents/timeline");
export const getOperationsSnapshot = () => request("/operations");
export const getResponderStatus = () => request("/responders/status");
export const getResponseMetrics = () => request("/response-metrics");
export const getIncidentHistory = (id) => request(`/assistance/${encodeURIComponent(id)}/history`);
export const getActivity = (limit = 25) => request(`/activity?limit=${limit}`);
export const getIncident = (id) => request(`/assistance/${encodeURIComponent(id)}`);

export function getReroute({ latitude, longitude, shelterLat, shelterLon, blockedLat, blockedLon }) {
  const params = new URLSearchParams({ latitude, longitude, shelter_lat: shelterLat, shelter_lon: shelterLon, blocked_lat: blockedLat, blocked_lon: blockedLon });
  return request(`/reroute?${params.toString()}`);
}

export function sendAssistanceRequest(requestData) {
  return request("/assistance", { method: "POST", body: JSON.stringify(requestData) });
}

export function updateAssistanceRequest(id, status, note="") {
  return request(`/assistance/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status, note }) });
}

export function dispatchResponder({ requestId, responderId }) {
  return request("/dispatch", { method: "POST", body: JSON.stringify({ request_id: requestId, responder_id: responderId }) });
}

export function createDrillReport(data) { return request("/drill/report", { method: "POST", body: JSON.stringify(data) }); }
