function Header({ view, onChangeView, onNavigate }) {
  const nav = (key) => {
    if (key === "citizen") onNavigate?.("command");
    else if (key === "map") onNavigate?.("citizen");
    else onNavigate?.(key);
  };

  return (
    <header className="header" role="banner">
      <div className="brand">
        <div className="brand-icon" aria-hidden="true">🛡️</div>
        <div><h1>RAKSHA</h1><span>EMERGENCY GIS COMMAND</span></div>
      </div>
      <nav className="top-nav" aria-label="Primary navigation">
        <button className={`nav-item ${view === "citizen" || view === "command" ? "active" : ""}`} onClick={() => nav("citizen")}>⌂ Command</button>
        <button className="nav-item" onClick={() => nav("map")}>◈ Live Map</button>
        <button className={`nav-item ${view === "incidents" ? "active" : ""}`} onClick={() => nav("incidents")}>⚠ Incidents</button>
        <button className={`nav-item ${view === "responders" ? "active" : ""}`} onClick={() => nav("responders")}>🚑 Responders</button>
        <button className={`nav-item ${view === "analytics" ? "active" : ""}`} onClick={() => nav("analytics")}>▥ Analytics</button>
        <button className={`nav-item ${view === "activity" ? "active" : ""}`} onClick={() => nav("activity")}>◉ Activity</button>
        <button className={`nav-item ${view === "evacuation" ? "active" : ""}`} onClick={() => nav("evacuation")}>⇢ Evacuation</button>
        <button className={`nav-item ${view === "reports" ? "active" : ""}`} onClick={() => nav("reports")}>▤ Reports</button>
        <button className={`nav-item ${view === "drill" ? "active" : ""}`} onClick={() => nav("drill")}>◌ Drill</button>
      </nav>
      <div className="header-actions">
        <button className="header-refresh" onClick={() => window.dispatchEvent(new CustomEvent("raksha:refresh"))} aria-label="Refresh current tab">↻ Refresh</button>
        <span className="system-status"><span className="status-dot"/>Backend Online</span>
        <button className="view-button" onClick={onChangeView}>
          {view === "responder" ? "Citizen View" : "Responder View"}
        </button>
      </div>
    </header>
  );
}
export default Header;
