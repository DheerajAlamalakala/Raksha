import { useEffect, useMemo, useState } from "react";
import Header from "../components/Header.jsx";
import { getActivity } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";
import { usePersistentState } from "../utils/usePersistentState.js";

export default function ActivityView({ onBack, onNavigate }) {
 const [items,setItems]=useState([]),[filter,setFilter]=usePersistentState("activity-filter","All"),[query,setQuery]=usePersistentState("activity-search","");
 const load=()=>getActivity(50).then(setItems).catch(()=>{});
 const {refresh,refreshing,lastSync}=useTabRefresh(load);
 useEffect(()=>{load();const t=setInterval(load,5000);return()=>clearInterval(t)},[]);
 const filtered=useMemo(()=>items.filter(x=>(filter==="All"||x.kind===filter)&&(!query||`${x.message} ${x.request_id||""}`.toLowerCase().includes(query.toLowerCase()))),[items,filter,query]);
 const kinds=[...new Set(items.map(x=>x.kind))];
 return <div className="dashboard"><Header view="activity" onNavigate={onNavigate} /><div className="full-page"><div className="page-heading"><div><span className="kicker">AUDIT + LIVE FEED</span><h2>Operational Activity</h2><p>State changes are persisted and survive page/browser refreshes.</p></div><div className="heading-tools"><span className="sync-label">{lastSync?`Synced ${lastSync.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`:"Ready"}</span><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh tab"}</button></div></div>
   <div className="activity-controls"><input className="page-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search activity…"/><select className="inline-select" value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{kinds.map(k=><option key={k}>{k}</option>)}</select></div>
   <div className="ops-card activity-board">{filtered.map(x=><div className="activity-row" key={x.id}><div className={`activity-icon ${x.kind?.split(".")[0]}`}><i className={x.kind?.startsWith("dispatch")?"fa-solid fa-truck-medical":x.kind?.startsWith("incident")?"fa-solid fa-triangle-exclamation":x.kind?.startsWith("victim")?"fa-solid fa-location-dot":"fa-solid fa-circle-info"}/></div><div><b>{x.message}</b><small>{x.request_id||"SYSTEM"} · {new Date(x.timestamp).toLocaleString()}</small></div><span>{x.kind}</span></div>)}{!filtered.length&&<div className="empty large">No events match the filter.</div>}</div>
 </div></div>
}
