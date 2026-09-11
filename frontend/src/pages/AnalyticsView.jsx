import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import { getActivity, getDashboardStats, getEvacuationRoutes, getHotspots, getReports, getResponseMetrics, getRiskData, getSafeZoneStatus } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

export default function AnalyticsView({ onCitizenView, onNavigate }) {
  const [s,setS]=useState({}),[risk,setRisk]=useState([]),[routes,setRoutes]=useState([]),[zones,setZones]=useState([]),[activity,setActivity]=useState([]),[hotspots,setHotspots]=useState([]),[reports,setReports]=useState([]),[metrics,setMetrics]=useState({});
  const load=async()=>{try{
    const [a,b,d,e,f,g,h,i]=await Promise.all([
      getDashboardStats(),getRiskData(),getEvacuationRoutes(false),getSafeZoneStatus(),getActivity(20),getHotspots(),getReports(300),getResponseMetrics()
    ]);
    setS(a);setRisk(b.buildings||[]);setRoutes(d.routes||[]);setZones(e||[]);setActivity(f||[]);setHotspots(g.hotspots||[]);setReports(h||[]);setMetrics(i||{});
  }catch{}};
  const {refresh,refreshing,lastSync}=useTabRefresh(load);
  useEffect(()=>{load();const t=setInterval(load,10000);return()=>clearInterval(t)},[]);
  const levels={Critical:0,High:0,Medium:0,Low:0}; risk.forEach(x=>levels[x.risk_level]=(levels[x.risk_level]||0)+1);
  const sources=useMemo(()=>{const m={};reports.forEach(x=>m[x.source||"Unknown"]=(m[x.source||"Unknown"]||0)+1);return m},[reports]);
  const repeatRate=reports.length?Math.round(reports.filter((x,i,a)=>a.some((y,j)=>j!==i&&y.incident_id===x.incident_id)).length/reports.length*100):0;
  const disasterAreas=hotspots.filter(x=>x.area_status==="Disaster Prone");
  return <div className="dashboard"><Header view="analytics" onChangeView={onCitizenView} onNavigate={onNavigate}/><div className="full-page">
    <div className="page-heading"><div><span className="kicker">LIVE DATA PRODUCTS</span><h2>Risk & Response Analytics</h2><p>Repeated reports raise area-level risk while incident records remain deduplicated.</p></div><div className="heading-tools"><span className="sync-label">{lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Ready"}</span><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh tab"}</button></div></div>
    <div className="analytics-grid">
      <div className="analytics-hero"><span className="kicker">AVERAGE BUILDING RISK</span><strong>{risk.length?Math.round(risk.reduce((a,x)=>a+x.risk_score,0)/risk.length):0}</strong><span>{risk.length} buildings in supplied GIS risk dataset</span></div>
      <div className="analytics-card"><span>Raw reports</span><strong>{reports.length}</strong><small>retained intake events</small></div>
      <div className="analytics-card"><span>Incidents</span><strong>{s.requests||0}</strong><small>deduplicated active/history records</small></div>
      <div className="analytics-card"><span>Repeat-report rate</span><strong>{repeatRate}%</strong><small>reports linked to existing incidents</small></div>
      <div className="analytics-card"><span>Disaster-prone areas</span><strong>{disasterAreas.length}</strong><small>repeated localized reporting</small></div>
      <div className="analytics-card"><span>Avg acknowledge</span><strong>{metrics.average_minutes_to_acknowledge!=null?`${metrics.average_minutes_to_acknowledge}m`:"—"}</strong><small>from report intake</small></div>
      <div className="analytics-card"><span>Avg dispatch</span><strong>{metrics.average_minutes_to_dispatch!=null?`${metrics.average_minutes_to_dispatch}m`:"—"}</strong><small>from report intake</small></div>
      {Object.entries(levels).map(([k,v])=><div className="analytics-card" key={k}><span>{k}</span><strong>{v}</strong><div className="bar"><i style={{width:`${risk.length?v/risk.length*100:0}%`}}/></div></div>)}
      <div className="analytics-card wide"><span>Report channels</span><div className="source-grid">{Object.entries(sources).map(([k,v])=><div key={k}><b>{v}</b><small>{k}</small></div>)}</div></div>
    </div>

    <div className="analytics-table-grid">
      <div className="ops-card"><div className="card-head"><div><span className="kicker">AREA INTELLIGENCE</span><h2>Emerging / disaster-prone areas</h2></div><span className="count-pill">{hotspots.length}</span></div>
        <div className="simple-table hotspot-table"><div className="simple-head"><span>Area</span><span>Reports</span><span>People</span><span>Score</span><span>Signal</span></div>
          {hotspots.map(x=><div key={x.cluster_id}><span><b>{x.cluster_id}</b><small>{x.incident_ids.join(", ")} · {x.whatsapp_reports} WhatsApp</small></span><span>{x.report_count}</span><span>{x.people_affected}</span><span>{x.hotspot_score}</span><span className={`hotspot-badge ${String(x.area_status).toLowerCase().replace(" ","-")}`}>{x.area_status}</span></div>)}
          {!hotspots.length&&<div className="empty">No geolocated hotspots.</div>}
        </div>
      </div>
      <div className="ops-card"><div className="card-head"><div><span className="kicker">EVACUATION</span><h2>Route performance</h2></div></div>
        <div className="simple-table"><div className="simple-head"><span>Incident</span><span>Safe zone</span><span>People</span><span>ETA</span><span>Priority</span></div>
          {routes.map(r=><div key={r.request_id}><span><b>{r.request_id}</b><small>{r.source}</small></span><span>{r.shelter_name||"Unavailable"}</span><span>{r.people_count??"—"}</span><span>{r.duration_min!=null?`${r.duration_min} min`:"—"}</span><span className={`status-chip ${String(r.priority||"High").toLowerCase()}`}>{r.priority||"High"}</span></div>)}
        </div>
      </div>
    </div>

    <div className="ops-card"><div className="card-head"><div><span className="kicker">CAPACITY</span><h2>Safe-zone utilization</h2></div></div>
      <div className="simple-table"><div className="simple-head"><span>Zone</span><span>Capacity</span><span>Allocated</span><span>Open</span></div>
        {zones.map(z=><div key={z.shelter_id}><span><b>{z.name}</b><small>{z.shelter_id} · {z.availability}</small></span><span>{z.capacity??"—"}</span><span>{z.allocated_people??0}</span><span>{z.available_capacity??"—"}</span></div>)}
      </div>
    </div>

    <div className="ops-card sla-card"><div className="card-head"><div><span className="kicker">SERVICE LEVEL</span><h2>Response SLA</h2></div></div><div className="sla-grid"><div><b>{metrics.response_sla?.acknowledge_under_10m??0}</b><span>acknowledged &lt; 10m</span></div><div><b>{metrics.response_sla?.dispatch_under_20m??0}</b><span>dispatched &lt; 20m</span></div><div><b>{metrics.pending_incidents??0}</b><span>still pending</span></div><div><b>{metrics.resolved_incidents??0}</b><span>resolved</span></div></div></div>
  <div className="ops-card analytics-activity"><div className="card-head"><div><span className="kicker">AUDIT</span><h2>Recent operational events</h2></div></div><div className="activity-feed">{activity.slice(0,12).map(x=><div key={x.id}><span className="activity-time">{new Date(x.timestamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span>{x.message}</span></div>)}</div></div>
  </div></div>
}
