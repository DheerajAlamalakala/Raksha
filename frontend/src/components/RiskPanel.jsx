import { useEffect, useState } from "react";
import { getRiskData } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

export default function RiskPanel() {
 const [topRisk,setTopRisk]=useState(null),[status,setStatus]=useState("loading");
 const load=async()=>{setStatus("loading");try{const data=await getRiskData();const buildings=data.buildings||[];const highest=buildings.reduce((m,b)=>(b.risk_score>(m?.risk_score??-1)?b:m),null);setTopRisk(highest);setStatus("ready")}catch{setStatus("error")}};
 const {refresh}=useTabRefresh(load);
 useEffect(()=>{load()},[]);
 return <section className="panel" id="risk-panel">
  <div className="panel-title"><span>⚠️</span><h3>Risk Summary</h3><button className="panel-refresh" onClick={refresh}>↻</button></div>
  {status==="loading"&&<p>Loading risk data…</p>}{status==="error"&&<p>Could not reach the risk API.</p>}
  {status==="ready"&&topRisk&&<><div className="risk-summary"><div className="risk-circle"><strong>{topRisk.risk_score}</strong><span>/100</span></div><div className="risk-details"><span className="risk-level">{topRisk.risk_level}</span><p>Highest-Risk Building</p></div></div>
  <div className="area-info"><div><span>Building</span><strong>{topRisk.name}</strong></div><div><span>Building ID</span><strong>{topRisk.building_id}</strong></div><div><span>Occupancy</span><strong>{topRisk.occupancy??"Unknown"}</strong></div></div></>}
 </section>
}