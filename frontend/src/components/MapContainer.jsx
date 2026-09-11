import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getReroute, getRiskData, getRoute, getSafeZones, getVictims, getEvacuationRoutes, getHotspots } from "../services/api.js";

// Hyderabad city center — used only as a fallback if the browser denies
// geolocation, matching the fallback used across the other panels.
const FALLBACK_LOCATION = { latitude: 17.385, longitude: 78.4867 };

// Stable default so MapContainer works standalone (e.g. in ResponderView,
// which has no layer checkboxes) without creating a new object every render.
const ALL_LAYERS_VISIBLE = {
  risk: true,
  safeZones: true,
  victims: true,
  responders: true,
  route: true,
  evacuation: true,
  hotspots: true,
  roadBlocks: true,
};

const ROUTE_COLOR = "#3b82f6";
const REROUTE_COLOR = "#f97316";

const RISK_COLORS = {
  Critical: "#ef4444",
  High: "#f97316",
  Medium: "#eab308",
  Low: "#22c55e",
};

function riskColor(level) {
  return RISK_COLORS[level] || "#64748b";
}

function emojiIcon(emoji, className) {
  return L.divIcon({
    html: `<div class="leaflet-emoji-pin ${className || ""}">${emoji}</div>`,
    className: "leaflet-emoji-wrapper",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

function MapContainer({ visibleLayers = ALL_LAYERS_VISIBLE }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [refreshSignal, setRefreshSignal] = useState(0);

  // Road-blockage reporting: click-to-report mode + the live status banner.
  const [blockMode, setBlockMode] = useState(false);
  const [blockageNote, setBlockageNote] = useState(null);
  const blockModeRef = useRef(false);
  const routeContextRef = useRef(null); // { origin: {lat,lon}, shelter: {lat,lon,shelter_id} }

  useEffect(() => {
    blockModeRef.current = blockMode;
  }, [blockMode]);

  // Initialize the map once, and tear it down when the component unmounts
  // (CitizenView/ResponderView each mount their own instance).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [FALLBACK_LOCATION.latitude, FALLBACK_LOCATION.longitude],
      zoom: 12,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    layersRef.current = {
      risk: L.layerGroup().addTo(map),
      safeZones: L.layerGroup().addTo(map),
      victims: L.layerGroup().addTo(map),
      responders: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      evacuation: L.layerGroup().addTo(map),
      hotspots: L.layerGroup().addTo(map),
      roadBlocks: L.layerGroup().addTo(map),
    };

    mapRef.current = map;

    // Click-to-report: only acts while "Report Road Block" mode is on, so
    // normal map panning/marker-clicking is unaffected the rest of the time.
    function handleMapClick(event) {
      if (!blockModeRef.current) return;
      reportBlockage(event.latlng.lat, event.latlng.lng);
    }
    map.on("click", handleMapClick);
    const refreshHandler = () => setRefreshSignal((value) => value + 1);
    window.addEventListener("raksha:refresh", refreshHandler);

    return () => {
      window.removeEventListener("raksha:refresh", refreshHandler);
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  // Show/hide each layer group to match the sidebar "Map Layers" checkboxes
  // (or ALL_LAYERS_VISIBLE, for views that don't expose the controls).
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    Object.entries(layers).forEach(([key, group]) => {
      const shouldShow = visibleLayers[key] !== false;
      const isShown = map.hasLayer(group);
      if (shouldShow && !isShown) group.addTo(map);
      if (!shouldShow && isShown) map.removeLayer(group);
    });
  }, [visibleLayers]);

  // Load risk-scored buildings (Task 4 data) as colored circle markers.
  useEffect(() => {
    getRiskData()
      .then((data) => {
        const layer = layersRef.current?.risk;
        if (!layer) return;
        layer.clearLayers();
        (data.geojson?.features || []).forEach((feature) => {
          const [lon, lat] = feature.geometry.coordinates;
          const props = feature.properties || {};
          L.circleMarker([lat, lon], {
            radius: 8 + Math.min(props.risk_score || 0, 100) / 12,
            color: riskColor(props.risk_level),
            fillColor: riskColor(props.risk_level),
            fillOpacity: 0.45,
            weight: 2,
          })
            .bindPopup(
              `<strong>${props.name || props.building_id}</strong><br/>` +
                `Risk: ${props.risk_level ?? "Unknown"} (${props.risk_score ?? "?"}/100)<br/>` +
                `Occupancy: ${props.occupancy ?? "Unknown"}`
            )
            .addTo(layer);
        });
      })
      .catch(() => {});
  }, [refreshSignal]);

  // Load safe zones / shelters (Task 5 + Task 3 data) as green pins.
  useEffect(() => {
    getSafeZones()
      .then((zones) => {
        const layer = layersRef.current?.safeZones;
        if (!layer) return;
        layer.clearLayers();
        (zones || []).forEach((zone) => {
          L.marker([zone.latitude, zone.longitude], {
            icon: emojiIcon("🟢", "pin-safe"),
          })
            .bindPopup(
              `<strong>${zone.name}</strong><br/>` +
                `${zone.shelter_id}<br/>` +
                `Capacity: ${zone.capacity ?? "Unknown"}<br/>` +
                `Status: ${zone.status ?? "Active"}`
            )
            .addTo(layer);
        });
      })
      .catch(() => {});
  }, [refreshSignal]);

  // Live victims/responders feed (Task 3 data + Task 2/6 SOS reports).
  // Re-polled periodically so new reports appear without a page reload.
  useEffect(() => {
    let cancelled = false;

    function refreshVictims() {
      getVictims()
        .then((geojson) => {
          if (cancelled) return;
          const victimLayer = layersRef.current?.victims;
          const responderLayer = layersRef.current?.responders;
          if (!victimLayer || !responderLayer) return;

          victimLayer.clearLayers();
          responderLayer.clearLayers();

          (geojson.features || []).forEach((feature) => {
            const [lon, lat] = feature.geometry.coordinates;
            const props = feature.properties || {};

            if (props.type === "responder") {
              L.marker([lat, lon], { icon: emojiIcon("🚑", "pin-responder") })
                .bindPopup(`<strong>${props.name || props.responder_id}</strong><br/>Responder unit`)
                .addTo(responderLayer);
            } else {
              L.marker([lat, lon], { icon: emojiIcon("📍", "pin-victim") })
                .bindPopup(
                  `<strong>${props.victim_id || "Victim"}</strong><br/>Status: ${props.status || "Reported"}`
                )
                .addTo(victimLayer);
            }
          });

          setStatus("ready");
        })
        .catch(() => !cancelled && setStatus("error"));
    }

    refreshVictims();
    const interval = setInterval(refreshVictims, 8000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshSignal]);

  // Area-level signal driven by the report ledger. Repeated reports in a
  // 1 km cluster become a visual hotspot instead of creating duplicate pins.
  useEffect(() => {
    let cancelled = false;
    async function refreshHotspots() {
      try {
        const data = await getHotspots();
        if (cancelled) return;
        const layer = layersRef.current?.hotspots;
        if (!layer) return;
        layer.clearLayers();
        (data.hotspots || []).forEach((h) => {
          const color =
            h.area_status === "Disaster Prone" ? "#ff4f63" :
            h.area_status === "High Alert" ? "#ff984d" : "#f1c75b";
          L.circle([h.latitude, h.longitude], {
            radius: 1000,
            color,
            weight: 2,
            dashArray: "7 7",
            fillColor: color,
            fillOpacity: 0.08,
          }).bindPopup(
            `<strong>${h.cluster_id} · ${h.area_status}</strong><br/>` +
            `Hotspot score: ${h.hotspot_score}/100<br/>` +
            `Reports: ${h.report_count} · People: ${h.people_affected}<br/>` +
            `WhatsApp reports: ${h.whatsapp_reports}<br/>` +
            `Trend: ${h.trend}`
          ).addTo(layer);
        });
      } catch {}
    }
    refreshHotspots();
    const interval = setInterval(refreshHotspots, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Render one distinct evacuation route for EVERY active, geolocated incident.
  // These are not decorative lines: each route comes from the backend's safe-zone
  // recommendation for that incident.
  useEffect(() => {
    let cancelled = false;
    async function refreshEvacuationRoutes() {
      try {
        const data = await getEvacuationRoutes(false);
        if (cancelled) return;
        const layer = layersRef.current?.evacuation;
        if (!layer) return;
        layer.clearLayers();
        const palette = ["#ff5f6d", "#42d9ff", "#ad7bff", "#36d399", "#ff934f", "#f5c451"];
        (data.routes || []).forEach((r, index) => {
          if (!r.geometry?.coordinates) return;
          const latlngs = r.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
          const color = palette[index % palette.length];
          const line = L.polyline(latlngs, {
            color, weight: 4, opacity: 0.84, dashArray: "9 6",
          }).bindPopup(
            `<strong>${r.request_id}</strong><br/>` +
            `${r.name || "Victim"} → ${r.shelter_name || r.shelter_id}<br/>` +
            `Road: ${r.distance_km ?? "?"} km · ETA: ${r.duration_min ?? "?"} min<br/>` +
            `Source: ${r.source || "Unknown"}`
          );
          line.addTo(layer);
          L.marker([r.latitude, r.longitude], {
            icon: emojiIcon("🆘", "pin-evac-victim"),
          }).bindPopup(
            `<strong>${r.request_id}</strong><br/>` +
            `Evacuate to: ${r.shelter_name || "safe zone"}<br/>` +
            `${r.error ? "Route unavailable" : `${r.duration_min} min · ${r.distance_km} km`}`
          ).addTo(layer);
        });
      } catch {
        // Keep the last successful route picture visible.
      }
    }
    refreshEvacuationRoutes();
    const interval = setInterval(refreshEvacuationRoutes, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [refreshSignal]);

  // Draw the current recommended route (fresh OSRM route, or the last
  // rerouted one) onto the map, and remember the user/shelter points so a
  // reported blockage can trigger a live reroute later.
  function renderRoute(latitude, longitude, data, color) {
    const layer = layersRef.current?.route;
    const map = mapRef.current;
    if (!layer || !map) return;

    layer.clearLayers();

    const userIcon = emojiIcon("🧍", "pin-user");
    L.marker([latitude, longitude], { icon: userIcon }).bindPopup("Your location").addTo(layer);

    const coords = data.geometry?.coordinates;
    if (coords) {
      const latlngs = coords.map(([lon, lat]) => [lat, lon]);
      const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.85 }).addTo(layer);
      map.fitBounds(line.getBounds(), { padding: [30, 30] });
    }

    routeContextRef.current = {
      origin: { lat: latitude, lon: longitude },
      shelter: { lat: data.latitude, lon: data.longitude, shelter_id: data.shelter_id },
    };
  }

  // Recommended evacuation route (Task 5 routing) from the user's current
  // location (or the Hyderabad fallback) to the best reachable safe zone.
  useEffect(() => {
    function drawRoute({ latitude, longitude }) {
      getRoute(latitude, longitude)
        .then((data) => renderRoute(latitude, longitude, data, ROUTE_COLOR))
        .catch(() => {
          // OSRM/network unavailable — the risk/safe-zone/victim layers still work offline.
        });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => drawRoute({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => drawRoute(FALLBACK_LOCATION),
        { timeout: 4000 }
      );
    } else {
      drawRoute(FALLBACK_LOCATION);
    }
  }, [refreshSignal]);

  // Report a road blockage at (lat, lon): drop a marker on the roadBlocks
  // layer, then ask the backend to recalculate the route around it.
  function reportBlockage(lat, lon) {
    const roadBlockLayer = layersRef.current?.roadBlocks;
    if (roadBlockLayer) {
      L.marker([lat, lon], { icon: emojiIcon("🚧", "pin-block") })
        .bindPopup("Reported road blockage")
        .addTo(roadBlockLayer);
    }

    const context = routeContextRef.current;
    if (!context?.shelter?.lat) {
      setBlockageNote({ tone: "error", text: "Blockage marked, but no active route to recalculate yet." });
      return;
    }

    setBlockageNote({ tone: "pending", text: "Blockage reported — recalculating route..." });

    getReroute({
      latitude: context.origin.lat,
      longitude: context.origin.lon,
      shelterLat: context.shelter.lat,
      shelterLon: context.shelter.lon,
      blockedLat: lat,
      blockedLon: lon,
    })
      .then((data) => {
        renderRoute(context.origin.lat, context.origin.lon, data, REROUTE_COLOR);
        const method = data.bypass_method === "osrm_alternative" ? "an alternative road" : "a bypass detour";
        setBlockageNote({ tone: "success", text: `Route recalculated via ${method} around the blockage.` });
      })
      .catch(() => {
        setBlockageNote({ tone: "error", text: "Could not recalculate a route around that blockage." });
      });
  }

  function zoomIn() {
    mapRef.current?.zoomIn();
  }

  function zoomOut() {
    mapRef.current?.zoomOut();
  }

  function fitToData() {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    const bounds = L.latLngBounds([]);
    Object.values(layers).forEach((group) => {
      group.eachLayer((l) => {
        if (l.getLatLng) bounds.extend(l.getLatLng());
        else if (l.getBounds) bounds.extend(l.getBounds());
      });
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  }

  function toggleBlockMode() {
    setBlockMode((prev) => {
      const next = !prev;
      setBlockageNote(
        next ? { tone: "pending", text: "Click anywhere on the map to report a road blockage." } : null
      );
      return next;
    });
  }

  return (
    <div className="map-container" id="map-section">
      <div className="map-toolbar">
        <div>🗺️ Risk Map</div>

        <div className="map-controls">
          <button onClick={zoomIn} title="Zoom in">+</button>
          <button onClick={zoomOut} title="Zoom out">−</button>
          <button onClick={fitToData} title="Fit to data">⛶</button>
          <button
            className={blockMode ? "active" : ""}
            onClick={toggleBlockMode}
            title="Report a road blockage"
          >
            🚧
          </button>
        </div>
      </div>

      <div className="map-area">
        {status === "error" && (
          <div className="map-offline-banner">Live victim feed unreachable — showing last known layout.</div>
        )}
        {blockageNote && (
          <div className={`map-hint map-hint-${blockageNote.tone}`}>{blockageNote.text}</div>
        )}
        <div ref={containerRef} className="leaflet-map-root" />
      </div>
    </div>
  );
}

export default MapContainer;
