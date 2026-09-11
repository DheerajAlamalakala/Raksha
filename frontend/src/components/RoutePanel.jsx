import { useEffect, useState } from "react";
import { getEvacuationRoutes, getRoute } from "../services/api.js";
import { useTabRefresh } from "../utils/useTabRefresh.js";

const FALLBACK_LOCATION = { latitude: 17.385, longitude: 78.4867 };

export default function RoutePanel() {
  const [route,setRoute]=useState(null),[routes,setRoutes]=useState([]),[state,setState]=useState("loading");
  async function load({latitude,longitude}) {
    try {
      const [mine, network] = await Promise.all([getRoute(latitude,longitude), getEvacuationRoutes(false)]);
      setRoute(mine); setRoutes(network.routes||[]); setState("ready");
    } catch { setState("error"); }
  }
  const {refresh}=useTabRefresh(()=>navigator.geolocation ? new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(p=>{load({latitude:p.coords.latitude,longitude:p.coords.longitude}).then(resolve)},()=>{load(FALLBACK_LOCATION).then(resolve)},{timeout:4000})
  }) : load(FALLBACK_LOCATION));
  useEffect(()=>{
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(p=>load({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>load(FALLBACK_LOCATION),{timeout:4000});
    } else load(FALLBACK_LOCATION);
    const t=setInterval(()=>getEvacuationRoutes(false).then(x=>setRoutes(x.routes||[])).catch(()=>{}),15000);
    return()=>clearInterval(t);
  },[]);
  return <section className="panel" id="evacuation-panel">
    <div className="panel-title"><span>🧭</span><h3>Evacuation Routes</h3><button className="panel-refresh" onClick={refresh}>↻</button></div>
    {state==="loading"&&<p>Calculating safe route…</p>}
    {state==="error"&&<p>Route service unavailable.</p>}
    {route&&<div className="route-preview"><div className="route-point"><span className="point current"/><div><strong>Your location</strong><small>Current GPS / fallback position</small></div></div><div className="route-connector"/><div className="route-point"><span className="point destination"/><div><strong>{route.name||route.shelter_id}</strong><small>{route.distance_km} km · {route.duration_min} min</small></div></div></div>}
    <div className="network-route-mini"><div><b>{routes.filter(r=>!r.error).length}</b><span>active routes</span></div><div><b>{routes.length}</b><span>geolocated incidents</span></div></div>
  </section>
}