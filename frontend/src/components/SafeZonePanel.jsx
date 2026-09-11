import { useEffect, useState } from "react";
import { getRoute, getSafeZoneStatus } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

const FALLBACK_LOCATION = { latitude: 17.385, longitude: 78.4867 };

export default function SafeZonePanel() {
  const [recommended,setRecommended]=useState(null),[zones,setZones]=useState([]),[state,setState]=useState("loading");
  async function load({latitude,longitude}) {
    try {
      const [route,status] = await Promise.all([getRoute(latitude,longitude),getSafeZoneStatus()]);
      setRecommended(route); setZones(status); setState("ready");
    } catch {
      try { setZones(await getSafeZoneStatus()); setState("ready"); } catch { setState("error"); }
    }
  }
  const {refresh}=useTabRefresh(()=>navigator.geolocation ? new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(p=>{load({latitude:p.coords.latitude,longitude:p.coords.longitude}).then(resolve)},()=>{load(FALLBACK_LOCATION).then(resolve)},{timeout:4000})
  }) : load(FALLBACK_LOCATION));
  useEffect(()=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(p=>load({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>load(FALLBACK_LOCATION),{timeout:4000});
    } else load(FALLBACK_LOCATION);
  },[]);
  return <section className="panel" id="safezone-panel">
    <div className="panel-title"><span>🟢</span><h3>Safe Zones & Availability</h3><button className="panel-refresh" onClick={refresh}>↻</button></div>
    {state==="loading"&&<p>Checking safe zones and road access…</p>}
    {state==="error"&&<p>Safe-zone service unavailable.</p>}
    {state==="ready"&&<><div className="recommended-zone"><div><span>RECOMMENDED FOR YOUR LOCATION</span><strong>{recommended?.name||recommended?.shelter_id||"Nearest available zone"}</strong>{recommended&&<small>{recommended.distance_km} km · {recommended.duration_min} min by road</small>}</div><b>SAFE</b></div>
      <div className="safe-zone-table">{zones.map(z=><div key={z.shelter_id}><div><strong>{z.name}</strong><small>{z.shelter_id}</small></div><span>{z.available_capacity??"—"} open</span><em className={String(z.availability||"").toLowerCase()}>{z.availability}</em></div>)}</div>
    </>}
  </section>
}