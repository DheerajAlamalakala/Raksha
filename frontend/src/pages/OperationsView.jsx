import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import MapContainer from "../components/MapContainer.jsx";
import IncidentDetailView from "./IncidentDetailView.jsx";
import {
  dispatchResponder, getActivity, getAssistanceRequests, getDashboardStats,
  getOperationsSnapshot, getVictims, updateAssistanceRequest
} from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";
import { usePersistentState } from "../utils/usePersistentState.js";

const fmtTime = (v) => v ? new Date(v).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "—";
function Stat({label,value,tone}){return <div className={`ops-stat ${tone||""}`}><span>{label}</span><strong>{value ?? "—"}</strong></div>}
function statusClass(s){return String(s||"").toLowerCase().replace(/\s+/g,"-")}

export function CommandView({ onResponderView, onNavigate }) {
  const [stats,setStats]=useState({}),[requests,setRequests]=useState([]),[victims,setVictims]=useState([]),[activity,setActivity]=useState([]),[ops,setOps]=useState({}),[loading,setLoading]=useState(true);
  const refresh=async()=>{try{
    const [s,r,v,a,o]=await Promise.all([getDashboardStats(),getAssistanceRequests(),getVictims(),getActivity(10),getOperationsSnapshot()]);
    setStats(s);setRequests(r);setVictims(v.features||[]);setActivity(a);setOps(o);
  }catch{}finally{setLoading(false)}};
  const {refresh: refreshTab, refreshing}=useTabRefresh(refresh);
  useEffect(()=>{refresh();const t=setInterval(refresh,5000);return()=>clearInterval(t)},[]);
  const trapped=useMemo(()=>victims.filter(x=>x.properties?.type==="victim"&&x.properties?.status==="Trapped"),[victims]);
  return <div className="dashboard">
    <Header view="command" onChangeView={onResponderView} onNavigate={onNavigate}/>
    <div className="ops-shell">
      <section className="ops-hero"><div><span className="kicker">NATIONAL DISASTER RESPONSE / LIVE</span><h1>Operational Command Center</h1><p>A common operating picture for risk, public assistance, evacuation, dispatch and responder coordination.</p></div><div className="live-badge"><i/> Backend synchronized<small>Auto-refresh every 5 seconds</small></div></section>
      <div className="tab-toolbar"><span>{stats.reports_received||0} reports received · {stats.whatsapp_reports||0} from WhatsApp · {stats.disaster_prone_areas||0} disaster-prone areas</span><button className="refresh-btn" onClick={refreshTab}>{refreshing?"Syncing…":"↻ Refresh tab"}</button></div><section className="ops-stats">
        <Stat label="Critical buildings" value={stats.critical} tone="red"/><Stat label="High risk" value={stats.high} tone="orange"/><Stat label="Active victims" value={stats.victims} tone="pink"/><Stat label="Responders" value={stats.responders} tone="purple"/><Stat label="Safe zones" value={stats.shelters} tone="green"/><Stat label="Pending requests" value={stats.pending_requests} tone="cyan"/>
      </section>
      <section className="ops-grid">
        <div className="ops-map-card"><div className="card-head"><div><span className="kicker">SITUATIONAL AWARENESS</span><h2>Live incident map</h2></div><span className="mini-live"><i/> LIVE</span></div><div className="ops-map"><MapContainer/></div></div>
        <div className="ops-card"><div className="card-head"><div><span className="kicker">RESPONSE QUEUE</span><h2>Incoming requests</h2></div><span className="count-pill">{requests.length}</span></div><div className="request-feed">{loading?<p className="empty">Synchronizing…</p>:requests.length===0?<p className="empty">No requests yet.</p>:requests.slice(0,8).map(r=>
          <button className="request-row request-row-button" key={r.id} onClick={()=>onNavigate?.("incidents")}><div className="request-main"><span className={`severity-dot ${statusClass(r.status)}`}/><div><b>{r.type}</b><small>{r.address_text||"Coordinates available"}</small><small>{r.report_count||1} report(s) · {r.source||"Unknown"} · {r.area_status||"Watch"}</small></div></div><div className="request-side"><span className={`status-chip ${statusClass(r.status)}`}>{r.status}</span><small>{fmtTime(r.timestamp)}</small></div></button>)}</div></div>
      </section>
      <section className="ops-grid lower">
        <div className="ops-card"><div className="card-head"><div><span className="kicker">THREAT PICTURE</span><h2>Immediate attention</h2></div><span className="count-pill">{trapped.length}</span></div>
          <div className="attention-list">{trapped.slice(0,5).map(x=><div key={x.properties.victim_id}><b>{x.properties.victim_id}</b><span>Trapped at {x.properties.building_id}</span><button onClick={()=>onNavigate?.("incidents")}>Open incident</button></div>)}{!trapped.length&&<p className="empty">No trapped victims in the live feed.</p>}</div>
        </div>
        <div className="ops-card"><div className="card-head"><div><span className="kicker">LIVE AUDIT</span><h2>Recent activity</h2></div><button className="text-button" onClick={()=>onNavigate?.("activity")}>View all →</button></div>
          <div className="activity-feed compact">{activity.slice(0,6).map(a=><div key={a.id}><span className="activity-time">{fmtTime(a.timestamp)}</span><span>{a.message}</span></div>)}</div>
        </div>
      </section>
      <section className="ops-grid lower">
        <div className="ops-card"><div className="card-head"><div><span className="kicker">SYSTEM</span><h2>Operational checks</h2></div></div><div className="checks"><div><i/> GIS data stream <b>ONLINE</b></div><div><i/> Risk intelligence <b>ONLINE</b></div><div><i/> Routing service <b>ONLINE</b></div><div><i/> Assistance intake <b>ONLINE</b></div></div></div>
        <div className="ops-card"><div className="card-head"><div><span className="kicker">THREAT PICTURE</span><h2>Top risk sites</h2></div></div><div className="risk-site-list">{(ops.critical_sites||[]).slice(0,5).map(x=><div key={x.building_id}><div><b>{x.name||x.building_id}</b><small>{x.building_id}</small></div><span className={`risk-score ${statusClass(x.risk_level)}`}>{x.risk_score}</span></div>)}</div></div>
      </section>
    </div>
  </div>
}

export function IncidentsView({ onCitizenView, onNavigate }) {
 const [items,setItems]=useState([]),[busy,setBusy]=useState(null),[filter,setFilter]=usePersistentState("incident-filter","All"),[detailId,setDetailId]=useState(null),[query,setQuery]=usePersistentState("incident-search","");
 const load=()=>getAssistanceRequests().then(setItems).catch(()=>{});
 const {refresh: refreshTab, refreshing}=useTabRefresh(load);
 useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t)},[]);
 if(detailId)return <IncidentDetailView requestId={detailId} onBack={()=>setDetailId(null)} onNavigate={onNavigate}/>;
 const filtered=items.filter(x=>(filter==="All"||x.status===filter)&&(!query||`${x.id} ${x.type} ${x.address_text}`.toLowerCase().includes(query.toLowerCase())));
 async function status(id,s){setBusy(id);try{await updateAssistanceRequest(id,s);await load()}catch{}finally{setBusy(null)}}
 return <div className="dashboard"><Header view="incidents" onChangeView={onCitizenView} onNavigate={onNavigate}/><div className="full-page"><div className="page-heading"><div><span className="kicker">LIVE OPERATIONS</span><h2>Incident Operations</h2><p>Unified intake from web and WhatsApp, with persistent state and an audit trail.</p></div><div className="heading-tools"><button className="refresh-btn" onClick={refreshTab}>{refreshing?"Syncing…":"↻ Refresh tab"}</button><input className="page-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search incidents…"/><div className="filter-pills">{["All","Pending","Acknowledged","Dispatched","On Scene","Resolved"].map(x=><button className={filter===x?"active":""} onClick={()=>setFilter(x)} key={x}>{x}</button>)}</div></div></div>
 <div className="incident-table"><div className="incident-head"><span>ID</span><span>Type / location</span><span>Priority</span><span>People</span><span>Status</span><span>Action</span></div>{filtered.map(r=><div className="incident-row" key={r.id}><b>{r.id}</b><div><strong>{r.type}</strong><small>{r.address_text||"Coordinates available"} · {r.source||"Unknown source"}</small></div><span>{r.priority||"High"}</span><span>{r.people_count??"—"}</span><span className={`status-chip ${statusClass(r.status)}`}>{r.status}</span><div className="row-actions"><button onClick={()=>setDetailId(r.id)}>Open</button>{r.status==="Pending"&&<button disabled={busy===r.id} onClick={()=>status(r.id,"Acknowledged")}>Acknowledge</button>}{!["Resolved","Cancelled"].includes(r.status)&&<button disabled={busy===r.id} onClick={()=>status(r.id,"Resolved")}>Resolve</button>}</div></div>)}{!filtered.length&&<div className="empty large">No incidents match the current filter.</div>}</div></div></div>
}

export function ResponderOpsView({ onCitizenView, onNavigate }) {
 const [people,setPeople]=useState([]),[requests,setRequests]=useState([]),[selected,setSelected]=useState(null),[message,setMessage]=useState("");
 const load=async()=>{try{
   const [v,r]=await Promise.all([getResponderStatus(),getAssistanceRequests()]);
   setPeople(v.units||[]);setRequests(r.filter(x=>!["Resolved","Cancelled"].includes(x.status)));
 }catch{}};
 const {refresh:refreshTab,refreshing}=useTabRefresh(load);
 useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t)},[]);
 async function assign(req,resp){
   setSelected(`${req.id}:${resp.responder_id}`);
   try{await dispatchResponder({requestId:req.id,responderId:resp.responder_id});setMessage(`${resp.name} assigned to ${req.id}`);await load()}
   catch{setMessage("Dispatch failed. Check backend connection.")} finally{setSelected(null)}
 }
 const available=people.filter(x=>x.status==="Available"), deployed=people.filter(x=>x.status==="Deployed");
 return <div className="dashboard"><Header view="responders" onChangeView={onCitizenView} onNavigate={onNavigate}/><div className="full-page responder-ops">
   <div className="page-heading"><div><span className="kicker">RESOURCE CONTROL</span><h2>Responder Operations</h2><p>Live unit state, dispatch assignments and incident workload from the same backend state machine.</p></div><div className="heading-tools"><button className="refresh-btn" onClick={refreshTab}>{refreshing?"Syncing…":"↻ Refresh tab"}</button><div className="responder-online">● {available.length} available · {deployed.length} deployed</div></div></div>
   <div className="ops-stats"><Stat label="Available units" value={available.length} tone="green"/><Stat label="Deployed units" value={deployed.length} tone="purple"/><Stat label="Open incidents" value={requests.length} tone="orange"/><Stat label="Pending dispatch" value={requests.filter(x=>x.status==="Pending").length} tone="red"/></div>
   <div className="responder-layout">
     <div className="ops-card"><div className="card-head"><div><span className="kicker">LIVE UNIT BOARD</span><h2>Response teams</h2></div><span className="count-pill">{people.length}</span></div>
       {people.map(x=><div className={`unit-card ${x.status.toLowerCase()}`} key={x.responder_id}><div className="unit-icon">🚑</div><div><b>{x.name}</b><small>{x.responder_id}</small>{x.assigned_incident&&<small>Assigned: {x.assigned_incident}</small>}</div><span>{x.status}</span></div>)}
       {!people.length&&<div className="empty">No responder units in the shared live feed.</div>}
     </div>
     <div className="ops-card"><div className="card-head"><div><span className="kicker">DISPATCH BOARD</span><h2>Open incidents</h2></div></div>
       {message&&<div className="notice">{message}</div>}
       {requests.map(r=><div className="dispatch-row" key={r.id}>
         <div><button className="dispatch-link" onClick={()=>onNavigate?.("incidents")}>{r.id} · {r.type}</button><small>{r.address_text||"Coordinates received"} · {r.people_count||1} people · {r.report_count||1} report(s)</small></div>
         <select value={r.assigned_responder||""} disabled={selected?.startsWith(r.id)} onChange={e=>{const x=people.find(p=>p.responder_id===e.target.value);if(x)assign(r,x)}}><option value="">Assign available unit…</option>{available.map(p=><option key={p.responder_id} value={p.responder_id}>{p.name}</option>)}</select>
         <span className={`status-chip ${statusClass(r.status)}`}>{r.status}</span>
       </div>)}{!requests.length&&<div className="empty">No open incidents.</div>}
     </div>
   </div>
 </div></div>
}
