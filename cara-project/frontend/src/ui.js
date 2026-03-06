/**
 * Cara Frontend — UI Layer
 * All DOM rendering: messages, appointments, latency, tool logs, toasts, modals.
 */

const PATIENTS = {
  P001: { name: 'Priya Singh',  avatar: '👩', lang: 'English', langCode: 'en', lastDoctor: 'Dr. Priya Sharma', hospital: 'Apollo',  sessions: 3 },
  P002: { name: 'Rajan Kumar',  avatar: '👨', lang: 'हिंदी',   langCode: 'hi', lastDoctor: 'Dr. Rajan Kumar',  hospital: 'Fortis',  sessions: 7 },
  P003: { name: 'Meena Iyer',   avatar: '👩', lang: 'தமிழ்',   langCode: 'ta', lastDoctor: 'Dr. Sunita Rao',   hospital: 'AIIMS',   sessions: 2 },
};

// ── Messages ──────────────────────────────────────────────────
function addMessage(role, text, meta = {}) {
  const container = document.getElementById('messagesContainer');
  const empty = document.getElementById('emptyState');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;

  const rendered = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const langLabel = meta.language
    ? `<span class="msg-lang">${meta.language.toUpperCase()}</span>`
    : '';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatar = role === 'agent' ? '🤖' : '👤';

  div.innerHTML = `
    <div class="msg-avatar ${role}">${avatar}</div>
    <div>
      <div class="msg-bubble">${rendered}</div>
      <div class="msg-meta">${timeStr} ${langLabel}</div>
    </div>`;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  STATE.turns++;
  document.getElementById('sessTurns').textContent = STATE.turns;
}

function showTyping() {
  document.getElementById('typingIndicator').classList.remove('hidden');
}

function hideTyping() {
  document.getElementById('typingIndicator').classList.add('hidden');
}

// ── Appointments ──────────────────────────────────────────────
function renderAppointments() {
  const list = document.getElementById('appointmentList');
  if (!STATE.appointments || STATE.appointments.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px 0">No appointments</div>';
    return;
  }
  list.innerHTML = STATE.appointments.map(a => `
    <div class="appt-item ${a.status}">
      <div class="appt-doctor">${a.doctor_name || a.doctor}</div>
      <div class="appt-specialty">${a.specialty} · ${a.hospital}</div>
      <div class="appt-datetime">📅 ${a.date} · ${a.time || a.time_slot}</div>
      <span class="appt-status ${a.status}">${a.status}</span>
    </div>`).join('');
}

async function refreshAppointments() {
  if (backendOnline) {
    try {
      const res = await apiGetAppointments(STATE.currentPatientId, 'confirmed');
      if (res?.data) STATE.appointments = res.data;
    } catch (e) {}
  }
  renderAppointments();
  showToast('success', 'Appointments refreshed');
}

// ── Patient profile ───────────────────────────────────────────
function renderPatientProfile(id) {
  const p = PATIENTS[id];
  if (!p) return;
  document.getElementById('patientAvatar').textContent = p.avatar;
  document.getElementById('patientName').textContent = p.name;
  document.getElementById('patientId').textContent = 'ID: ' + id;
  document.getElementById('patientLang').textContent = p.lang;
  document.getElementById('lastDoctor').textContent = p.lastDoctor;
  document.getElementById('preferredHospital').textContent = p.hospital;
  document.getElementById('sessionCount').textContent = p.sessions;
}

// ── Latency meters ────────────────────────────────────────────
function updateLatency(latency) {
  const MAX = 500;
  const { stt_ms, lang_ms, agent_ms, tts_ms, total_ms } = latency;

  document.getElementById('sttMs').textContent   = stt_ms   + ' ms';
  document.getElementById('langMs').textContent  = lang_ms  + ' ms';
  document.getElementById('agentMs').textContent = agent_ms + ' ms';
  document.getElementById('ttsMs').textContent   = tts_ms   + ' ms';

  document.getElementById('sttBar').style.width   = Math.min(100, (stt_ms   / MAX) * 100) + '%';
  document.getElementById('langBar').style.width  = Math.min(100, (lang_ms  / MAX) * 100) + '%';
  document.getElementById('agentBar').style.width = Math.min(100, (agent_ms / MAX) * 100) + '%';
  document.getElementById('ttsBar').style.width   = Math.min(100, (tts_ms   / MAX) * 100) + '%';

  const el = document.getElementById('totalMs');
  el.textContent = total_ms + ' ms';
  el.className = 'latency-total-val' + (total_ms < 450 ? '' : total_ms < 650 ? ' warn' : ' fail');
  document.getElementById('headerLatency').textContent = total_ms + ' ms';

  // Rolling average
  STATE.latencySamples.push(total_ms);
  if (STATE.latencySamples.length > 10) STATE.latencySamples.shift();
  const avg = Math.round(STATE.latencySamples.reduce((a, b) => a + b, 0) / STATE.latencySamples.length);
  document.getElementById('avgStats').innerHTML =
    `<span style="color:var(--accent);font-family:var(--font-mono)">${avg}ms avg</span> ` +
    (avg < 450 ? '✅' : '⚠️') +
    ` <span style="color:var(--muted)">(${STATE.latencySamples.length} samples)</span>`;
}

// ── Tool call log ─────────────────────────────────────────────
function addToolLog(toolName, args, result) {
  if (!toolName) return;
  const log = document.getElementById('toolLog');

  // Clear placeholder
  const placeholder = log.querySelector('[style*="No tool"]');
  if (placeholder) log.innerHTML = '';

  const success = result?.success !== false;
  const div = document.createElement('div');
  div.className = `tool-entry ${success ? 'success' : 'error'}`;

  const argsStr = args
    ? JSON.stringify(args).slice(0, 70) + (JSON.stringify(args).length > 70 ? '…' : '')
    : '';
  const resultStr = result
    ? (success
        ? '✓ ' + (result.data?.id || result.message || 'Success')
        : '✗ ' + (result.error || 'Failed'))
    : '';

  div.innerHTML = `
    <div class="tool-name">${toolName}()</div>
    <div class="tool-args">${argsStr}</div>
    <div class="tool-result ${success ? 'ok' : 'err'}">${resultStr}</div>`;

  log.prepend(div);
  // Keep last 5
  while (log.children.length > 5) log.removeChild(log.lastChild);
}

// ── Session context ───────────────────────────────────────────
function updateSessionInfo(intent, language) {
  document.getElementById('sessId').textContent     = STATE.sessionId.slice(0, 12);
  document.getElementById('sessIntent').textContent = intent   || '—';
  document.getElementById('sessLang').textContent   = language || STATE.currentLanguage;
}

// ── Language selector ─────────────────────────────────────────
function setLanguage(code) {
  STATE.currentLanguage = code;
  ['en', 'hi', 'ta'].forEach(l => {
    document.getElementById('lang-' + l).className = 'lang-btn' + (l === code ? ' active' : '');
  });
  document.getElementById('sessLang').textContent = code;
}

// ── Toast notifications ───────────────────────────────────────
function showToast(type, message) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'opacity 0.3s, transform 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Book Modal ────────────────────────────────────────────────
function openBookModal() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  document.getElementById('bookDate').value = dateStr;
  document.getElementById('bookDate').min   = dateStr;
  document.getElementById('bookModal').classList.remove('hidden');
}
function closeBookModal() {
  document.getElementById('bookModal').classList.add('hidden');
}
async function bookFromModal() {
  const specialty = document.getElementById('bookSpecialty').value;
  const date      = document.getElementById('bookDate').value;
  const time      = document.getElementById('bookTime').value;
  closeBookModal();
  await handleUserMessage(`Book appointment with ${specialty} on ${date} at ${time}`, false);
}
document.getElementById('bookModal').addEventListener('click', function(e) {
  if (e.target === this) closeBookModal();
});

// ── Settings Modal ────────────────────────────────────────────
function openSettingsModal() {
  document.getElementById('apiKeyInput').value    = STATE.openaiKey;
  document.getElementById('backendUrlInput').value = BACKEND_URL;

  const mode = getSttMode();
  const modeDescs = {
    webspeech: '✅ <strong style="color:var(--green)">Web Speech API</strong> — Real-time mic, free, Chrome/Edge only.',
    whisper:   '🔑 <strong style="color:var(--amber)">Whisper API</strong> — OpenAI Whisper key detected.',
    none:      '⚠️ <strong style="color:var(--red)">No speech engine</strong> — Open in Chrome or add an OpenAI API key.',
  };
  document.getElementById('sttModeDesc').innerHTML = modeDescs[mode];

  const box = document.getElementById('backendStatusBox');
  const txt = document.getElementById('backendStatusText');
  if (backendOnline) {
    box.style.background   = 'rgba(0,229,160,0.07)';
    box.style.borderColor  = 'rgba(0,229,160,0.3)';
    txt.innerHTML = `<strong style="color:var(--green)">✅ Connected</strong> — ${BACKEND_URL}`;
  } else {
    box.style.background   = 'rgba(255,190,11,0.07)';
    box.style.borderColor  = 'rgba(255,190,11,0.3)';
    txt.innerHTML = `<strong style="color:var(--amber)">⚠️ Offline</strong> — Running in simulation mode`;
  }
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}
async function saveSettings() {
  const url = document.getElementById('backendUrlInput').value.trim().replace(/\/+$/, '');
  const key = document.getElementById('apiKeyInput').value.trim();

  STATE.openaiKey = key;
  if (key) localStorage.setItem('cara_openai_key', key);
  else     localStorage.removeItem('cara_openai_key');

  if (url && url !== BACKEND_URL) {
    BACKEND_URL = url;
    localStorage.setItem('cara_backend_url', url);
    await testBackendConnection();
  }
  closeSettingsModal();
  updateSttStatusBadge();
  showToast('success', '✅ Settings saved!');
}
document.getElementById('settingsModal').addEventListener('click', function(e) {
  if (e.target === this) closeSettingsModal();
});

// ── Switch patient ────────────────────────────────────────────
async function switchPatient(id) {
  STATE.currentPatientId  = id;
  STATE.appointments      = [];
  STATE.bookingContext     = { active: false };
  STATE.turns             = 0;
  STATE.sessionId         = 'sess_' + Math.random().toString(36).slice(2, 9);

  renderPatientProfile(id);
  renderAppointments();
  setLanguage(PATIENTS[id]?.langCode || 'en');
  showToast('info', `Switched to ${PATIENTS[id]?.name || id}`);

  if (backendOnline) {
    await apiRegisterPatient(id, PATIENTS[id]?.name, PATIENTS[id]?.langCode);
    connectWebSocket(id);
    const appts = await apiGetAppointments(id, 'confirmed');
    if (appts?.data) { STATE.appointments = appts.data; renderAppointments(); }
  }
}
