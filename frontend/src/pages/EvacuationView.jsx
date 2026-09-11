import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import MapContainer from "../components/MapContainer.jsx";
import { getEvacuationRoutes, getSafeZoneStatus } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

const fmt = v => v==null ? "—" : `${v}`;
const tone = p => p==="Critical" ? "critical" : p==="High" ? "high" : p==="Medium" ? "medium" : "low";

export default function EvacuationView({ onCitizenView, onNavigate }) {
  const [routes,setRoutes]=useState([]),[zones,setZones]=useState([]),[loading,setLoading]=useState(true);
  const load=async()=>{try{const [r,z]=await Promise.all([getEvacuationRoutes(false),getSafeZoneStatus()]);setRoutes(r.routes||[]);setZones(z||[])}catch{}finally{setLoading(false)}};
  const {refresh,refreshing,lastSync}=useTabRefresh(load);
  useEffect(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t)},[]);
  const reachable=useMemo(()=>routes.filter(x=>!x.error),[routes]);
  const activePeople=routes.reduce((a,x)=>a+(Number(x.people_count)||0),0);
  return <div className="dashboard">
    <Header view="evacuation" onChangeView={onCitizenView} onNavigate={onNavigate}/>
    <div className="full-page evacuation-page">
      <div className="page-heading">
        <div><span className="kicker">MULTI-VICTIM ROUTING</span><h2>Evacuation Network</h2><p>Every active incident with a location gets its own safe-zone recommendation and road route.</p></div>
        <div className="heading-tools"><span className="sync-label">{lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Ready"}</span><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh tab"}</button><div className="evac-summary"><b>{reachable.length}</b> routes active · <b>{zones.length}</b> safe zones · <b>{routes.reduce((n,r)=>n+(Number(r.people_count)||0),0)}</b> people</div></div>
      </div>
      <div className="evac-grid">
        <div className="ops-card evac-map-card"><div className="card-head"><div><span className="kicker">COMMON OPERATING PICTURE</span><h2>All evacuation routes</h2></div><span className="mini-live"><i/> LIVE</span></div><div className="evac-map"><MapContainer/></div></div>
        <div className="ops-card"><div className="card-head"><div><span className="kicker">SHELTER CAPACITY</span><h2>Safe-zone availability</h2></div></div><div className="safe-table">{zones.map(z=><div className="safe-table-row" key={z.shelter_id}><div><b>{z.name}</b><small>{z.shelter_id}</small></div><div><strong>{z.available_capacity??"—"}</strong><small>available</small></div><span className={`availability ${String(z.availability||"").toLowerCase()}`}>{z.availability}</span></div>)}</div></div>
      </div>
      <div className="ops-card route-table-card"><div className="card-head"><div><span className="kicker">ROUTE MANIFEST</span><h2>Victim → safe zone assignments</h2></div><button className="refresh-btn" onClick={load}>{loading?"Syncing…":"↻ Refresh"}</button></div>
        <div className="route-manifest">
          <div className="route-head"><span>Incident</span><span>Source</span><span>People</span><span>Safe zone</span><span>Road</span><span>ETA</span><span>Status</span></div>
          {routes.map(r=><div className="route-row" key={r.request_id}><b>{r.request_id}</b><span>{r.source}</span><span>{r.people_count??"—"}</span><span>{r.shelter_name||"Unavailable"}</span><span>{r.error?"Unavailable":`${fmt(r.distance_km)} km`}</span><span>{r.error?"—":`${fmt(r.duration_min)} min`}</span><span className={`status-chip ${r.error?"pending":tone(r.priority)}`}>{r.error?"ROUTE ERROR":r.priority||"High"}</span></div>)}
          {!routes.length&&<div className="empty large">No active, geolocated incidents yet.</div>}
        </div>
      </div>
    </div>
  </div>
}