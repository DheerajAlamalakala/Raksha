import { useState } from "react";
import { sendAssistanceRequest } from "../services/api.js";

const FALLBACK_LOCATION = { latitude: 17.385, longitude: 78.4867 };

function AssistancePanel() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [type, setType] = useState("SOS");
  const [people, setPeople] = useState(1);
  const [injured, setInjured] = useState("no");

  function submit({ latitude, longitude }) {
    setSending(true);
    sendAssistanceRequest({
      name: "Citizen (web dashboard)",
      latitude, longitude, type,
      people_count: Number(people) || 1,
      injured,
      priority: type === "SOS" ? "Critical" : "High",
      source: "Web",
    }).then((result) => {
      setMessage(`${result.request?.id || "Emergency"} received. Dispatch control has been notified.`);
      setOpenForm(false);
    }).catch(() => {
      setMessage("Could not reach the backend. Please try again or use WhatsApp.")
    }).finally(() => setSending(false));
  }

  function sendSOS() {
    if (sending) return;
    setMessage("");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => submit({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => submit(FALLBACK_LOCATION),
        { timeout: 4000 }
      );
    } else submit(FALLBACK_LOCATION);
  }

  return (
    <section className="panel" id="sos-panel">
      <div className="panel-title"><span>🆘</span><h3>Emergency Help</h3></div>
      <div className="help-buttons">
        <button className="whatsapp-button" onClick={sendSOS} disabled={sending}>
          {sending ? "Sending…" : "🆘 Send SOS"}
        </button>
        <button className="secondary-help-button" onClick={() => setOpenForm(v => !v)}>
          {openForm ? "Close intake" : "Report incident"}
        </button>
      </div>

      {openForm && (
        <div className="incident-intake">
          <label>Incident type
            <select value={type} onChange={e => setType(e.target.value)}>
              <option>SOS</option><option>MEDICAL</option><option>FIRE</option><option>EVACUATION</option><option>BUILDING EMERGENCY</option>
            </select>
          </label>
          <label>People affected
            <input min="1" type="number" value={people} onChange={e => setPeople(e.target.value)} />
          </label>
          <label>Injury reported
            <select value={injured} onChange={e => setInjured(e.target.value)}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </label>
          <button className="primary-action" onClick={sendSOS} disabled={sending}>Submit with current location</button>
        </div>
      )}
      {message && <div className="help-message">{message}</div>}
    </section>
  );
}
export default AssistancePanel;
