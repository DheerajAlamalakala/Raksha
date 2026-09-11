import { useEffect, useState } from "react";
import CitizenView from "./pages/CitizenView.jsx";
import ResponderView from "./pages/ResponderView.jsx";
import AnalyticsView from "./pages/AnalyticsView.jsx";
import { CommandView, IncidentsView, ResponderOpsView } from "./pages/OperationsView.jsx";
import ActivityView from "./pages/ActivityView.jsx";
import EvacuationView from "./pages/EvacuationView.jsx";
import ReportsView from "./pages/ReportsView.jsx";
import DrillView from "./pages/DrillView.jsx";

export default function App() {
  const [view, setView] = useState("command");

  useEffect(() => {
    const onNavigate = (event) => event.detail && setView(event.detail);
    window.addEventListener("raksha:navigate", onNavigate);
    return () => window.removeEventListener("raksha:navigate", onNavigate);
  }, []);

  const go = (next) => setView(next);
  const responder = () => setView("responder");
  const citizen = () => setView("command");

  if (view === "citizen") return <CitizenView onResponderView={responder} onNavigate={go}/>;
  if (view === "responder") return <ResponderView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "incidents") return <IncidentsView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "responders") return <ResponderOpsView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "analytics") return <AnalyticsView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "activity") return <ActivityView onBack={citizen} onNavigate={go}/>;
  if (view === "evacuation") return <EvacuationView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "reports") return <ReportsView onCitizenView={citizen} onNavigate={go}/>;
  if (view === "drill") return <DrillView onCitizenView={citizen} onNavigate={go}/>;
  return <CommandView onResponderView={responder} onNavigate={go}/>;
}
