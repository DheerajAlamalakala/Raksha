import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import { getReports, getHotspots } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";
import { usePersistentState } from "../utils/usePersistentState.js";

export default function ReportsView({ onCitizenView, onNavigate }) {
  const [items,setItems]=useState([]),[hotspots,setHotspots]=useState([]),[query,setQuery]=usePersistentState("report-search",""),[source,setSource]=usePersistentState("report-source","All");
  const load=async()=>{const [r,h]=await Promise.all([getReports(200),getHotspots()]);setItems(r||[]);setHotspots(h.hotspots||[])};
  const {refresh,refreshing,lastSync}=useTabRefresh(load);
  useEffect(()=>{refresh();},[]);
  const filtered=useMemo(()=>items.filter(x=>(source==="All"||x.source===source)&&(!query||`${x.report_id} ${x.incident_id} ${x.source}`.toLowerCase().includes(query.toLowerCase()))),[items,query,source]);
  return <div className="dashboard"><Header view="reports" onChangeView={onCitizenView} onNavigate={onNavigate}/><div className="full-page">
    <div className="page-heading"><div><span className="kicker">RAW INTAKE EVENTS</span><h2>Reports Ledger</h2><p>Every report is retained. Repeated messages strengthen the parent incident and the area hotspot instead of creating blind duplicate incidents.</p></div><div className="heading-tools"><span className="sync-label">{lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Ready"}</span><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh"}</button></div></div>
    <div className="ops-stats report-summary"><div className="ops-stat"><span>Total reports</span><strong>{items.length}</strong></div><div className="ops-stat"><span>WhatsApp reports</span><strong>{items.filter(x=>x.source==="WhatsApp").length}</strong></div><div className="ops-stat"><span>Hotspots</span><strong>{hotspots.length}</strong></div><div className="ops-stat red"><span>Disaster-prone areas</span><strong>{hotspots.filter(x=>x.area_status==="Disaster Prone").length}</strong></div></div>
    <div className="ops-card"><div className="card-head"><div><span className="kicker">REPORT STREAM</span><h2>All intake events</h2></div><div className="heading-tools"><input className="page-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search reports…"/><select className="inline-select" value={source} onChange={e=>setSource(e.target.value)}><option>All</option><option>WhatsApp</option><option>Web</option><option>GIS</option><option>Scenario Data</option></select></div></div>
      <div className="report-table"><div className="report-head"><span>Report</span><span>Incident</span><span>Source</span><span>Location</span><span>Time</span></div>{filtered.map(x=><div className="report-row" key={x.report_id}><b>{x.report_id}</b><span>{x.incident_id}</span><span className={`source-badge ${String(x.source).toLowerCase().replace(/\s+/g,"-")}`}>{x.source}</span><span>{x.latitude!=null?`${Number(x.latitude).toFixed(4)}, ${Number(x.longitude).toFixed(4)}`:"Location pending"}</span><small>{new Date(x.timestamp).toLocaleString()}</small></div>)}{!filtered.length&&<div className="empty large">No reports match the current filters.</div>}</div></div>
  </div></div>
}