import { useEffect, useState } from "react";
import Header from "../components/Header.jsx";
import MapContainer from "../components/MapContainer.jsx";
import RiskPanel from "../components/RiskPanel.jsx";
import SafeZonePanel from "../components/SafeZonePanel.jsx";
import RoutePanel from "../components/RoutePanel.jsx";
import AssistancePanel from "../components/AssistancePanel.jsx";
import ResponderPanel from "../components/ResponderPanel.jsx";
import { getAssistanceRequests } from "../services/api.js";
import { scrollToSection } from "../utils/scrollTo.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

const SIDEBAR_ITEMS = [
  { key: "dashboard", label: "🏠 Dashboard", sectionId: null },
  { key: "map", label: "🗺️ Risk Map", sectionId: "map-section" },
  { key: "safezones", label: "🟢 Safe Zones", sectionId: "safezone-panel" },
  { key: "evacuation", label: "🧭 Evacuation", sectionId: "evacuation-panel" },
  { key: "network", label: "⇢ Evacuation Network", sectionId: null },
  { key: "sos", label: "🆘 Help / SOS", sectionId: "sos-panel" },
];

// Each entry's key must match a layer name in MapContainer's layersRef.
const LAYER_TOGGLES = [
  { key: "risk", label: "Risk Areas" },
  { key: "safeZones", label: "Safe Zones" },
  { key: "victims", label: "Victim Location" },
  { key: "responders", label: "Responders" },
  { key: "route", label: "My Route" },
  { key: "evacuation", label: "All Evacuation Routes" },
  { key: "hotspots", label: "Disaster Hotspots" },
  { key: "roadBlocks", label: "Road Blocks" },
];

const DEFAULT_VISIBLE_LAYERS = {
  risk: true,
  safeZones: true,
  victims: true,
  responders: true,
  route: true,
  evacuation: true,
  hotspots: true,
  roadBlocks: true,
};

function CitizenView({ onResponderView, onNavigate }) {
  const [assistanceRequests, setAssistanceRequests] = useState([]);
  const [activeSidebarItem, setActiveSidebarItem] = useState("dashboard");
  const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE_LAYERS);

  function toggleLayer(key) {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const loadRequests = () => getAssistanceRequests().then(setAssistanceRequests).catch(()=>{});
  const {refresh: refreshTab, refreshing}=useTabRefresh(loadRequests);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      loadRequests();
    }

    poll();
    const interval = setInterval(poll, 5000); // re-poll so new SOS/WhatsApp reports show up live

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="dashboard">

      <Header
        view="citizen"
        onChangeView={onResponderView}
        onNavigate={onNavigate}
      />

      <div className="dashboard-body">

        <aside className="sidebar">

          <div className="sidebar-section">
            <h4>Main Menu</h4>

            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.key}
                className={`sidebar-item${activeSidebarItem === item.key ? " active" : ""}`}
                onClick={() => {
                  setActiveSidebarItem(item.key);
                  if (item.key === "network" || item.key === "evacuation") { onNavigate?.("evacuation"); return; }
                  if (item.key === "hotspots") { onNavigate?.("analytics"); return; }
                  scrollToSection(item.sectionId);
                }}
              >
                {item.label}
              </button>
            ))}

            <button
              className="sidebar-item"
              onClick={onResponderView}
            >
              🚑 Responder View
            </button>
          </div>

          <div className="sidebar-section">

            <h4>Map Layers</h4>

            {LAYER_TOGGLES.map((layer) => (
              <label key={layer.key}>
                <input
                  type="checkbox"
                  checked={visibleLayers[layer.key]}
                  onChange={() => toggleLayer(layer.key)}
                />
                {layer.label}
              </label>
            ))}

          </div>

          <div className="sidebar-section legend">

            <h4>Risk Legend</h4>

            <div>
              <span className="legend-color high"></span>
              High Risk
            </div>

            <div>
              <span className="legend-color medium"></span>
              Medium Risk
            </div>

            <div>
              <span className="legend-color low"></span>
              Low Risk
            </div>

            <div>
              <span className="legend-color safe"></span>
              Safe Zone
            </div>

          </div>

        </aside>

        <main className="main-content">

          <div className="page-heading">

            <div>
              <h2>Disaster Response Dashboard</h2>

              <p>
                Monitor risk, safety zones and evacuation
                routes.
              </p>
            </div>

            <div className="heading-tools"><button className="refresh-btn" onClick={refreshTab}>{refreshing?"Syncing…":"↻ Refresh tab"}</button><div className="location-status">📍 Old City Zone A</div></div>

          </div>

          <MapContainer visibleLayers={visibleLayers} />

          <div className="dashboard-grid">

            <RiskPanel />

            <SafeZonePanel />

            <RoutePanel />

          </div>

        </main>

        <aside className="right-panel">

          <AssistancePanel />

          <section className="panel" id="requests-panel">

            <div className="panel-title">
              <span>📋</span>
              <h3>Recent Requests</h3>
            </div>

            <div className="request-list">

              {assistanceRequests.map((request) => (
                <div
                  className="request-item"
                  key={request.id}
                >

                  <div>
                    <strong>{request.type}</strong>
                    <span>{request.address_text || "Location pending"}</span>
                  </div>

                  <small
                    className={
                      request.status.toLowerCase()
                    }
                  >
                    {request.status}
                  </small>

                </div>
              ))}

            </div>

          </section>

          <ResponderPanel />

        </aside>

      </div>

      <footer className="footer">
        <span>RAKSHA Disaster Response System</span>
        <span>Task 2 — Frontend</span>
        <span>System Operational</span>
      </footer>

    </div>
  );
}

export default CitizenView;
