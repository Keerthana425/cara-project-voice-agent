/**
 * Cara Frontend — API Layer
 * Handles all communication with the FastAPI backend.
 * Falls back to local simulation when backend is offline.
 */

let BACKEND_URL = localStorage.getItem('cara_backend_url') || 'https://127.0.0.1:8000';
let backendOnline = true;
let wsConnection = null;
let wsMessageHandler = null; // Set by app.js

// ── Health check ──────────────────────────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(BACKEND_URL + '/', { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    backendOnline = data.status === 'running';
  } catch (e) {
    backendOnline = false;
  }
  updateBackendStatusUI();
  return backendOnline;
}

function updateBackendStatusUI() {
  const dot = document.getElementById('connectionDot');
  const label = document.getElementById('connectionLabel');
  const wsEl = document.getElementById('wsStatus');
  if (backendOnline) {
    dot.style.background = 'var(--green)';
    label.textContent = 'Backend Online';
    if (wsEl) { wsEl.textContent = 'FastAPI Connected'; wsEl.style.color = 'var(--green)'; }
  } else {
    dot.style.background = 'var(--amber)';
    label.textContent = 'Offline Mode';
    if (wsEl) { wsEl.textContent = 'Simulation Mode'; wsEl.style.color = 'var(--amber)'; }
  }
}

// ── WebSocket ─────────────────────────────────────────────────
function connectWebSocket(patientId) {
  if (!backendOnline) return;
  if (wsConnection) { try { wsConnection.close(); } catch(e) {} wsConnection = null; }

  const wsUrl = BACKEND_URL.replace('http', 'ws') + '/ws/voice/' + patientId;
  try {
    wsConnection = new WebSocket(wsUrl);
    wsConnection.onopen = () => {
      console.log('[WS] Connected:', wsUrl);
      const el = document.getElementById('wsStatus');
      if (el) { el.textContent = 'WS Live'; el.style.color = 'var(--green)'; }
    };
    wsConnection.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') return;
        if (msg.type === 'response' && wsMessageHandler) wsMessageHandler(msg);
      } catch (e) { console.error('[WS] Parse error:', e); }
    };
    wsConnection.onclose = () => {
      wsConnection = null;
      const el = document.getElementById('wsStatus');
      if (el) { el.textContent = 'WS Closed'; el.style.color = 'var(--amber)'; }
    };
    wsConnection.onerror = () => { wsConnection = null; };
  } catch (e) { wsConnection = null; }
}

function sendViaWebSocket(text, language, patientId) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return false;
  wsConnection.send(JSON.stringify({ type: 'text', text, language, patient_id: patientId }));
  return true;
}

// ── REST API calls ────────────────────────────────────────────
async function apiRegisterPatient(patientId, name, language) {
  if (!backendOnline) return null;
  try {
    const res = await fetch(BACKEND_URL + '/api/patients/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id: patientId, name, preferred_language: language }),
    });
    return await res.json();
  } catch (e) { return null; }
}

async function apiGetAppointments(patientId, status = 'upcoming') {
  if (!backendOnline) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/appointments/${patientId}?status=${status}`);
    return await res.json();
  } catch (e) { return null; }
}

async function apiBookAppointment(patientId, specialty, date, timeSlot) {
  const res = await fetch(BACKEND_URL + '/api/appointments/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_id: patientId, doctor_specialty: specialty, date, time_slot: timeSlot }),
  });
  return await res.json();
}

async function apiCancelAppointment(patientId, appointmentId) {
  const res = await fetch(BACKEND_URL + '/api/appointments/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_id: patientId, appointment_id: appointmentId }),
  });
  return await res.json();
}

async function apiRescheduleAppointment(patientId, appointmentId, newDate, newTime) {
  const res = await fetch(BACKEND_URL + '/api/appointments/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_id: patientId, appointment_id: appointmentId, new_date: newDate, new_time_slot: newTime }),
  });
  return await res.json();
}

async function apiCheckAvailability(specialty, date) {
  const res = await fetch(`${BACKEND_URL}/api/appointments/availability?date=${date}&doctor_specialty=${encodeURIComponent(specialty)}`);
  return await res.json();
}

async function apiAgentRespond(text, language, patientId, sessionId, context = {}) {
  const res = await fetch(BACKEND_URL + '/api/agent/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, patient_id: patientId, session_id: sessionId, context }),
  });
  return await res.json();
}

async function apiOutboundCampaign(patientId, language) {
  const res = await fetch(BACKEND_URL + '/api/campaigns/outbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient_id: patientId, language }),
  });
  return await res.json();
}

// ── Backend test + settings ────────────────────────────────────
async function testBackendConnection() {
  const url = document.getElementById('backendUrlInput').value.trim().replace(/\/+$/, '');
  const txt = document.getElementById('backendStatusText');
  const box = document.getElementById('backendStatusBox');
  txt.innerHTML = `🔄 Testing <code>${url}</code>...`;
  try {
    const res = await fetch(url + '/', { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data.status === 'running') {
      BACKEND_URL = url;
      localStorage.setItem('cara_backend_url', url);
      backendOnline = true;
      updateBackendStatusUI();
      box.style.background = 'rgba(0,229,160,0.07)'; box.style.borderColor = 'rgba(0,229,160,0.3)';
      txt.innerHTML = `<strong style="color:var(--green)">✅ Connected!</strong> — ${url} (v${data.version || '1.0'})`;
      connectWebSocket(STATE.currentPatientId);
      const appts = await apiGetAppointments(STATE.currentPatientId, 'confirmed');
      if (appts?.data) { STATE.appointments = appts.data; renderAppointments(); }
    } else throw new Error('Bad response');
  } catch (e) {
    backendOnline = false; updateBackendStatusUI();
    box.style.background = 'rgba(255,77,109,0.07)'; box.style.borderColor = 'rgba(255,77,109,0.3)';
    txt.innerHTML = `<strong style="color:var(--red)">❌ Failed</strong> — Cannot reach ${url}. Start the server with <code>uvicorn main:app --reload</code>`;
  }
}

async function pingEndpoints() {
  if (!backendOnline) { showToast('error', 'Backend is offline. Start your server first.'); return; }
  const endpoints = [
    { id: 'ep1', method: 'POST', path: '/api/appointments/book' },
    { id: 'ep2', method: 'POST', path: '/api/appointments/cancel' },
    { id: 'ep3', method: 'POST', path: '/api/appointments/reschedule' },
    { id: 'ep4', method: 'GET', path: '/api/appointments/availability?date=2025-01-01&doctor_specialty=cardiologist' },
    { id: 'ep5', method: 'WS', path: '/ws/voice/test' },
  ];
  for (const ep of endpoints) {
    const el = document.getElementById(ep.id);
    el.textContent = '⏳'; el.style.color = 'var(--muted)';
    try {
      if (ep.method === 'WS') {
        el.textContent = wsConnection?.readyState === WebSocket.OPEN ? '✅ Live' : '⚠️ Closed';
        el.style.color = wsConnection?.readyState === WebSocket.OPEN ? 'var(--green)' : 'var(--amber)';
      } else {
        const t0 = performance.now();
        const res = await fetch(BACKEND_URL + ep.path, {
          method: ep.method,
          headers: ep.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
          body: ep.method === 'POST' ? JSON.stringify({}) : undefined,
          signal: AbortSignal.timeout(3000),
        });
        const ms = Math.round(performance.now() - t0);
        el.textContent = (res.status < 500 ? '✅' : '⚠️') + ' ' + ms + 'ms';
        el.style.color = res.status < 500 ? 'var(--green)' : 'var(--amber)';
      }
    } catch (e) { el.textContent = '❌'; el.style.color = 'var(--red)'; }
  }
  showToast('success', 'Endpoint ping complete');
}

// Auto-reconnect every 30s if offline
setInterval(async () => {
  if (!backendOnline) {
    const ok = await checkBackend();
    if (ok) {
      connectWebSocket(STATE.currentPatientId);
      showToast('success', '✅ Backend reconnected!');
    }
  }
}, 30000);
