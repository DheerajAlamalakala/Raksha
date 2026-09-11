import Header from "../components/Header.jsx";
import MapContainer from "../components/MapContainer.jsx";
import RiskPanel from "../components/RiskPanel.jsx";
import RoutePanel from "../components/RoutePanel.jsx";
import ResponderPanel from "../components/ResponderPanel.jsx";
import AssistancePanel from "../components/AssistancePanel.jsx";
import { getAssistanceRequests, getVictims } from "../services/api.js";
import { useEffect, useState } from "react";
import { useTabRefresh } from "../utils/useTabRefresh.js";

function ResponderView({ onCitizenView, onNavigate }) {
  const [requests,setRequests]=useState([]),[responders,setResponders]=useState([]);
  const load=async()=>{try{const [r,v]=await Promise.all([getAssistanceRequests(),getVictims()]);setRequests(r||[]);setResponders((v.features||[]).filter(x=>x.properties?.type==="responder"))}catch{}};
  const {refresh,refreshing}=useTabRefresh(load);
  useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t)},[]);
  return (
    <div className="dashboard">

      <Header
        view="responder"
        onChangeView={onCitizenView}
        onNavigate={onNavigate}
      />

      <div className="responder-page">

        <div className="page-heading">

          <div>
            <h2>Responder Dashboard</h2>

            <p>
              Monitor incidents and coordinate emergency
              response.
            </p>
          </div>

          <div className="heading-tools"><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh tab"}</button><div className="responder-online">🟢 {responders.length} units · {requests.filter(x=>x.status!=="Resolved").length} open incidents</div></div>

        </div>

        <div className="responder-map">
          <MapContainer />
        </div>

        <div className="responder-grid">

          <RiskPanel />

          <RoutePanel />

          <ResponderPanel />

          <AssistancePanel />

        </div>

      </div>

      <footer className="footer">
        <span>RAKSHA Disaster Response System</span>
        <span>Responder Operations</span>
        <span>System Operational</span>
      </footer>

    </div>
  );
}

export default ResponderView;