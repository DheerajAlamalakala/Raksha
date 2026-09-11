import { useEffect, useState } from "react";
import Header from "../components/Header.jsx";
import { createDrillReport, getHotspots, getOperationsSnapshot } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

const scenarios=[
 ["LB Nagar cluster",17.352,78.548,"LB Nagar Junction Shopping Complex","FIRE","Critical",4],
 ["Begumpet cluster",17.4435,78.4735,"Begumpet Commercial Plaza","EVACUATION","High",5],
 ["Charminar cluster",17.3616,78.4744,"Charminar Heritage Zone Commercial Complex","BUILDING EMERGENCY","Critical",3],
 ["HITEC City",17.4486,78.3812,"HITEC City Cyber Towers Annexe","MEDICAL","Medium",2],
];
export default function DrillView({onCitizenView,onNavigate}){
 const [ops,setOps]=useState({}),[hotspots,setHotspots]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const load=async()=>{try{const [a,b]=await Promise.all([getOperationsSnapshot(),getHotspots()]);setOps(a);setHotspots(b.hotspots||[])}catch{}};
 const {refresh,refreshing}=useTabRefresh(load); useEffect(()=>{load()},[]);
 async function fire(s){setBusy(true);try{const r=await createDrillReport({name:"RAKSHA Drill User",latitude:s[1],longitude:s[2],address_text:s[3],type:s[4],priority:s[5],people_count:s[6],injured:s[4]==="MEDICAL"?"yes":"no",notes:"Synthetic integration test report"});setMessage(`${r.request.id} created. Run it again to increase report density and observe hotspot escalation.`);await load()}catch{setMessage("Drill report failed.")}finally{setBusy(false)}}
 return <div className="dashboard"><Header view="drill" onChangeView={onCitizenView} onNavigate={onNavigate}/><div className="full-page">
  <div className="page-heading"><div><span className="kicker">CONTROLLED TESTING</span><h2>Drill Mode</h2><p>Exercises the same backend intake, hotspot, safe-zone, evacuation and analytics pipeline without contacting WhatsApp.</p></div><button className="refresh-btn" onClick={refresh}>{refreshing?"Syncing…":"↻ Refresh tab"}</button></div>
  {message&&<div className="notice">{message}</div>}
  <div className="drill-grid">{scenarios.map(s=><button className="drill-card" key={s[0]} disabled={busy} onClick={()=>fire(s)}><span>RUN SCENARIO</span><b>{s[0]}</b><small>{s[4]} · {s[5]} · {s[6]} people</small><em>Inject report →</em></button>)}</div>
  <div className="ops-grid lower"><div className="ops-card"><div className="card-head"><div><span className="kicker">CURRENT STATE</span><h2>Pipeline check</h2></div></div><div className="checks"><div><i/> Incidents <b>{ops.request_counts?.active||0} ACTIVE</b></div><div><i/> Reports <b>{ops.request_counts?.total||0} INCIDENT RECORDS</b></div><div><i/> Hotspots <b>{hotspots.length} AREAS</b></div><div><i/> Disaster prone <b>{hotspots.filter(x=>x.area_status==="Disaster Prone").length} AREAS</b></div></div></div>
  <div className="ops-card"><div className="card-head"><div><span className="kicker">HOTSPOT RESPONSE</span><h2>Escalation signals</h2></div></div><div className="risk-site-list">{hotspots.slice(0,6).map(h=><div key={h.cluster_id}><div><b>{h.cluster_id} · {h.trend}</b><small>{h.report_count} reports · {h.whatsapp_reports} WhatsApp</small></div><span className={`risk-score ${h.area_status==="Disaster Prone"?"critical":h.area_status==="High Alert"?"high":"medium"}`}>{h.hotspot_score}</span></div>)}</div></div></div>
 </div></div>
}
