import { useEffect, useState } from "react";
import { getVictims } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

export default function ResponderPanel() {
 const [responders,setResponders]=useState([]),[status,setStatus]=useState("loading");
 const load=async()=>{setStatus("loading");try{const geojson=await getVictims();setResponders((geojson.features||[]).filter(f=>f.properties?.type==="responder").map(f=>({responder_id:f.properties.responder_id||f.properties.name,name:f.properties.name,status:"Available"})));setStatus("ready")}catch{setStatus("error")}};
 const {refresh}=useTabRefresh(load); useEffect(()=>{load()},[]);
 return <section className="panel" id="responders-panel"><div className="panel-title"><span>🚑</span><h3>Active Responders</h3><button className="panel-refresh" onClick={refresh}>↻</button></div>
 {status==="loading"&&<p>Loading responders…</p>}{status==="error"&&<p>Could not reach the responder feed.</p>}{status==="ready"&&<div className="responder-list">{responders.map(r=><div className="responder-item" key={r.responder_id}><div className="responder-avatar">🚑</div><div className="responder-info"><strong>{r.name}</strong><span>{r.responder_id}</span></div><span className="responder-status available">{r.status}</span></div>)}{!responders.length&&<p className="empty">No responders in the live feed.</p>}</div>}
 </section>
}