/**
 * Cara Frontend — App Core
 * Main application state, agent logic (local simulation + backend routing),
 * and input handling.
 */

// ── Global State ──────────────────────────────────────────────
const STATE = {
  currentPatientId:  'P001',
  currentLanguage:   'en',
  isRecording:       false,
  isProcessing:      false,
  turns:             0,
  sessionId:         'sess_' + Math.random().toString(36).slice(2, 9),
  latencySamples:    [],
  mediaRecorder:     null,
  audioChunks:       [],
  appointments:      [],
  bookingContext:    { active: false },
  openaiKey:         localStorage.getItem('cara_openai_key') || '',
  _finalTranscript:  '',
};

const DOCTORS = {
  cardiologist:        { name: 'Dr. Priya Sharma',  hospital: 'Apollo'  },
  dermatologist:       { name: 'Dr. Rajan Kumar',   hospital: 'Fortis'  },
  'general physician': { name: 'Dr. Meena Iyer',    hospital: 'Apollo'  },
  orthopedist:         { name: 'Dr. Arjun Patel',   hospital: 'Max'     },
  neurologist:         { name: 'Dr. Sunita Rao',    hospital: 'AIIMS'   },
};

const ALL_SLOTS = ['09:00 AM', '10:30 AM', '12:00 PM', '02:00 PM', '04:00 PM'];

// ── Input Handlers ────────────────────────────────────────────
function sendTextMessage() {
  const input = document.getElementById('textInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = '48px';
  handleUserMessage(text, false);
}

function handleTextKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage();
  }
}

function quickSend(text) {
  handleUserMessage(text, false);
}

// ── Core message handler ──────────────────────────────────────
async function handleUserMessage(text, fromVoice = false) {
  if (!text.trim() || STATE.isProcessing) return;
  STATE.isProcessing = true;

  addMessage('user', text, { language: STATE.currentLanguage });
  showTyping();

  try {
    let result;

    // Route to backend WebSocket if live
    if (backendOnline && wsConnection?.readyState === WebSocket.OPEN) {
      result = await sendViaWsAndWait(text);
    }
    // Route to backend REST agent
    else if (backendOnline) {
      const t0 = performance.now();
      const raw = await apiAgentRespond(
        text, STATE.currentLanguage, STATE.currentPatientId,
        STATE.sessionId, STATE.bookingContext
      );
      const elapsed = Math.round(performance.now() - t0);
      result = {
        ...raw,
        latency: raw.latency || {
          stt_ms: fromVoice ? 110 : 0,
          lang_ms: 12,
          agent_ms: elapsed,
          tts_ms: 80,
          total_ms: (fromVoice ? 110 : 0) + 12 + elapsed + 80,
        }
      };
      // Sync appointments if booking happened
      if (result.intent === 'book' || result.intent === 'cancel' || result.intent === 'reschedule') {
        const appts = await apiGetAppointments(STATE.currentPatientId, 'confirmed');
        if (appts?.data) { STATE.appointments = appts.data; renderAppointments(); }
      }
    }
    // Local simulation (offline)
    else {
      result = await localAgent(text, STATE.currentLanguage);
    }

    hideTyping();
    addMessage('agent', result.response, { language: result.language || STATE.currentLanguage });
    updateLatency(result.latency);
    updateSessionInfo(result.intent, result.language);
    addToolLog(result.tool_name || result.toolName, result.tool_args || result.toolArgs, result.tool_result || result.toolResult);

    if (result.language && result.language !== STATE.currentLanguage) {
      setLanguage(result.language);
    }

    // TTS
    // speakText(result.response, result.language || STATE.currentLanguage); // Uncomment to enable TTS

  } catch (err) {
    console.error('[Agent]', err);
    hideTyping();
    addMessage('agent', "I'm having trouble right now. Please try again.", { language: STATE.currentLanguage });
  } finally {
    STATE.isProcessing = false;
  }
}

// ── WebSocket await helper ────────────────────────────────────
function sendViaWsAndWait(text) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS timeout')), 8000);
    wsMessageHandler = (msg) => {
      clearTimeout(timeout);
      wsMessageHandler = null;
      resolve(msg);
    };
    const sent = sendViaWebSocket(text, STATE.currentLanguage, STATE.currentPatientId);
    if (!sent) {
      clearTimeout(timeout);
      wsMessageHandler = null;
      reject(new Error('WS not ready'));
    }
  });
}

// ── Local Simulation Agent ────────────────────────────────────
// Used when backend is offline. Mirrors the backend agent.py logic.
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function _detectLang(text) {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  return 'en';
}

function _extractSpecialty(text) {
  const t = text.toLowerCase();
  const map = [
    [['cardio', 'heart', 'chest pain', 'breathless', 'palpitation', 'सीने में दर्द', 'மார்பு வலி'], 'cardiologist'],
    [['derma', 'skin', 'rash', 'acne', 'eczema', 'hair loss', 'त्वचा', 'தோல்'], 'dermatologist'],
    [['ortho', 'bone', 'joint', 'knee', 'back pain', 'spine', 'जोड़', 'மூட்டு'], 'orthopedist'],
    [['neuro', 'headache', 'migraine', 'dizzy', 'seizure', 'सिरदर्द', 'தலைவலி'], 'neurologist'],
    [['fever', 'cold', 'cough', 'checkup', 'general', 'physician', 'flu', 'बुखार', 'காய்ச்சல்'], 'general physician'],
  ];
  for (const [kws, sp] of map) { if (kws.some(k => t.includes(k))) return sp; }
  return null;
}

function _extractDate(text) {
  const t = text.toLowerCase(), today = new Date();
  if (t.includes('tomorrow') || t.includes('कल') || t.includes('நாளை')) {
    const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
  }
  if (t.includes('friday') || t.includes('शुक्रवार') || t.includes('வெள்ளி')) {
    const d = new Date(today); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return d.toISOString().split('T')[0];
  }
  if (t.includes('monday') || t.includes('सोमवार') || t.includes('திங்கள்')) {
    const d = new Date(today); d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7)); return d.toISOString().split('T')[0];
  }
  const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0];
}

function _extractSlot(text) {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m) {
    const h = parseInt(m[1]), mn = m[2] || '00', p = m[3].toUpperCase();
    return `${String(h).padStart(2,'0')}:${mn} ${p}`;
  }
  const quick = { '9': '09:00 AM', 'nine': '09:00 AM', '10:30': '10:30 AM', 'noon': '12:00 PM', '12': '12:00 PM', '2': '02:00 PM', 'two': '02:00 PM', '4': '04:00 PM', 'four': '04:00 PM' };
  for (const [k, v] of Object.entries(quick)) { if (t.includes(k)) return v; }
  return null;
}

function _t(key, lang, vars = {}) {
  const templates = {
    greeting: {
      en: "Hello! I'm **Cara** 👋 — your healthcare assistant. I can help you **book**, **reschedule**, or **cancel** appointments. What would you like to do?",
      hi: "नमस्ते! मैं **Cara** हूँ 👋 — आपकी स्वास्थ्य सहायक। **बुक**, **रिशेड्यूल** या **रद्द** करने में मदद कर सकती हूँ।",
      ta: "வணக்கம்! நான் **Cara** 👋 — உமது மருத்துவ உதவியாளர். **பதிவு**, **மாற்றம்** அல்லது **ரத்து** செய்ய உதவுவேன்.",
    },
    ask_specialty: {
      en: "What's the reason for your visit? Describe your **symptoms** or name a **specialty**:\n\n• Chest pain / breathlessness → **Cardiologist**\n• Skin rash / acne / hair loss → **Dermatologist**\n• Fever / cold / checkup → **General Physician**\n• Joint / back / bone pain → **Orthopedist**\n• Headache / dizziness / seizures → **Neurologist**",
      hi: "किस कारण से आना है?\n\n• सीने में दर्द → **हृदय रोग विशेषज्ञ**\n• त्वचा समस्या → **त्वचा रोग विशेषज्ञ**\n• बुखार / जुकाम → **सामान्य चिकित्सक**\n• जोड़ों में दर्द → **हड्डी रोग विशेषज्ञ**\n• सिरदर्द / चक्कर → **न्यूरोलॉजिस्ट**",
      ta: "ஏன் வருகிறீர்கள்?\n\n• மார்பு வலி → **இதய நிபுணர்**\n• தோல் பிரச்சனை → **தோல் நிபுணர்**\n• காய்ச்சல் → **பொது மருத்துவர்**\n• மூட்டு வலி → **எலும்பு நிபுணர்**\n• தலைவலி → **நரம்பியல் நிபுணர்**",
    },
    ask_date: {
      en: `Got it — **${vars.sp}** (${vars.docName}). What date works for you? Say **tomorrow**, **this Friday**, or **next Monday**.`,
      hi: `समझ गया — **${vars.sp}** (${vars.docName}). किस दिन मिलना है?`,
      ta: `புரிந்தது — **${vars.sp}** (${vars.docName}). எந்த நாளில் வேண்டும்?`,
    },
    cancelled_ok: {
      en: "No problem! Booking cancelled. Is there anything else I can help you with?",
      hi: "ठीक है, रद्द कर दिया। और कुछ सहायता चाहिए?",
      ta: "சரி, நிறுத்தியுள்ளேன். வேறு ஏதாவது உதவி வேண்டுமா?",
    },
    default: {
      en: "I can help you **book**, **cancel**, or **reschedule** appointments, or check **availability**. What would you like to do?",
      hi: "मैं **बुकिंग**, **रद्द** या **रिशेड्यूल** करने में मदद कर सकती हूँ। क्या करना है?",
      ta: "**பதிவு**, **ரத்து** அல்லது **மாற்றம்** செய்ய உதவுவேன். என்ன செய்யவேண்டும்?",
    },
  };
  const t = templates[key];
  if (!t) return key;
  return t[lang] || t['en'];
}

function _makeLatency(fromVoice = false) {
  const stt   = fromVoice ? Math.round(90  + Math.random() * 70)  : 0;
  const lang  = Math.round(8   + Math.random() * 15);
  const agent = Math.round(120 + Math.random() * 100);
  const tts   = Math.round(60  + Math.random() * 50);
  return { stt_ms: stt, lang_ms: lang, agent_ms: agent, tts_ms: tts, total_ms: stt + lang + agent + tts };
}

async function localAgent(text, language) {
  await _delay(180 + Math.random() * 120);
  const lower    = text.toLowerCase();
  const lang     = _detectLang(text) || language;
  const ctx      = STATE.bookingContext;
  const latency  = _makeLatency(false);

  function ok(response, intent, toolName = null, toolArgs = null, toolResult = null) {
    return { response, intent, language: lang, latency, tool_name: toolName, tool_args: toolArgs, tool_result: toolResult };
  }

  function slotList(docName, date) {
    const lines = ALL_SLOTS.map(s => `• **${s}**`).join('\n');
    const r = {
      en: `Available slots with **${docName}** on **${date}**:\n${lines}\n\nWhich time works for you?`,
      hi: `**${docName}** के साथ **${date}** को उपलब्ध समय:\n${lines}\n\nकौन सा समय ठीक रहेगा?`,
      ta: `**${docName}** உமது **${date}** அன்று கிடைக்கும் நேரங்கள்:\n${lines}\n\nஎந்த நேரம்?`,
    };
    return r[lang] || r.en;
  }

  // ── Mid-booking flow ──────────────────────────────────────
  if (ctx.active) {
    const isNo = /cancel|stop|no\b|नहीं|வேண்டாம்/.test(lower);
    if (isNo) {
      STATE.bookingContext = { active: false };
      return ok(_t('cancelled_ok', lang), 'conversation');
    }

    if (!ctx.specialty) {
      const sp = _extractSpecialty(lower);
      if (!sp) return ok(_t('ask_specialty', lang), 'collecting');
      ctx.specialty = sp;
      ctx.doctor = DOCTORS[sp];
    }

    if (!ctx.date) {
      ctx.date = _extractDate(lower);
    }

    if (!ctx.slot) {
      const slot = _extractSlot(lower);
      if (!slot) return ok(slotList(ctx.doctor.name, ctx.date), 'collecting');
      ctx.slot = slot;
    }

    if (!ctx.confirming) {
      ctx.confirming = true;
      const r = {
        en: `Please confirm your booking:\n\n👨‍⚕️ **${ctx.doctor.name}**\n🏥 **${ctx.doctor.hospital}**\n🩺 **${ctx.specialty}**\n📅 **${ctx.date}**\n🕐 **${ctx.slot}**\n\nSay **yes** to confirm or **no** to change.`,
        hi: `बुकिंग की पुष्टि करें:\n\n👨‍⚕️ **${ctx.doctor.name}**\n🏥 **${ctx.doctor.hospital}**\n📅 **${ctx.date}** को **${ctx.slot}**\n\n**हाँ** = कनफर्म | **नहीं** = बदलें`,
        ta: `முன்பதிவை உறுதிப்படுத்துங்கள்:\n\n👨‍⚕️ **${ctx.doctor.name}**\n🏥 **${ctx.doctor.hospital}**\n📅 **${ctx.date}** அன்று **${ctx.slot}**\n\n**ஆம்** = உறுதி | **இல்லை** = மாற்று`,
      };
      return ok(r[lang] || r.en, 'confirming');
    }

    // Yes / No
    const isYes = /\byes\b|confirm|ok\b|sure|हाँ|हां|ஆம்|சரி/.test(lower);
    if (isYes) {
      const apptId = 'APT-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const appt = { id: apptId, patient_id: STATE.currentPatientId, doctor_name: ctx.doctor.name, specialty: ctx.specialty, hospital: ctx.doctor.hospital, date: ctx.date, time: ctx.slot, status: 'confirmed' };
      STATE.appointments.unshift(appt);
      renderAppointments();
      const toolArgs = { patient_id: STATE.currentPatientId, doctor_specialty: ctx.specialty, date: ctx.date, time_slot: ctx.slot };
      const toolResult = { success: true, data: appt };
      STATE.bookingContext = { active: false };
      const r = {
        en: `✅ **Booking Confirmed!**\n\n👨‍⚕️ ${ctx.doctor.name} (${ctx.specialty})\n📅 ${ctx.date} at ${ctx.slot}\n🏥 ${ctx.doctor.hospital}\n🔖 Appointment ID: **${apptId}**\n\nIs there anything else I can help you with?`,
        hi: `✅ **बुकिंग कनफर्म!**\n\n👨‍⚕️ ${ctx.doctor.name}\n📅 ${ctx.date} को ${ctx.slot}\n🏥 ${ctx.doctor.hospital}\n🔖 ID: **${apptId}**`,
        ta: `✅ **முன்பதிவு உறுதி!**\n\n👨‍⚕️ ${ctx.doctor.name}\n📅 ${ctx.date} அன்று ${ctx.slot}\n🏥 ${ctx.doctor.hospital}\n🔖 ID: **${apptId}**`,
      };
      return ok(r[lang] || r.en, 'book', 'bookAppointment', toolArgs, toolResult);
    } else {
      STATE.bookingContext = { active: false };
      const r = { en: "No problem! Let's start over. What type of doctor do you need?", hi: "ठीक है, फिर से शुरू करते हैं। किस विशेषज्ञ से मिलना है?", ta: "சரி, மீண்டும் தொடங்குவோம். எந்த மருத்துவர் வேண்டும்?" };
      return ok(r[lang] || r.en, 'conversation');
    }
  }

  // ── Greeting ──────────────────────────────────────────────
  if (/hello|hi\b|hey|namaste|नमस्ते|வணக்கம்/.test(lower)) {
    return ok(_t('greeting', lang), 'greeting');
  }

  // ── Cancel ────────────────────────────────────────────────
  if (/cancel|रद्द|ரத்து/.test(lower)) {
    const appt = STATE.appointments.find(a => a.status === 'confirmed');
    if (appt) {
      appt.status = 'cancelled';
      renderAppointments();
      const r = {
        en: `❌ Your appointment with **${appt.doctor_name}** on **${appt.date} at ${appt.time}** has been cancelled. Is there anything else?`,
        hi: `❌ **${appt.doctor_name}** के साथ **${appt.date} को ${appt.time}** रद्द कर दिया गया।`,
        ta: `❌ **${appt.doctor_name}** உமது **${appt.date} அன்று ${appt.time}** ரத்து செய்யப்பட்டது.`,
      };
      return ok(r[lang] || r.en, 'cancel', 'cancelAppointment', { patient_id: STATE.currentPatientId }, { success: true });
    }
    const r = { en: "You have no active appointments to cancel. Would you like to book one?", hi: "रद्द करने के लिए कोई सक्रिय अपॉइंटमेंट नहीं है।", ta: "ரத்து செய்ய எந்த சந்திப்பும் இல்லை." };
    return ok(r[lang] || r.en, 'cancel', 'cancelAppointment', {}, { success: false });
  }

  // ── Reschedule ────────────────────────────────────────────
  if (/reschedule|move|change|shift|बदल|மாற்ற/.test(lower)) {
    const appt = STATE.appointments.find(a => a.status === 'confirmed');
    if (!appt) {
      const r = { en: "You have no confirmed appointments to reschedule.", hi: "रिशेड्यूल करने के लिए कोई अपॉइंटमेंट नहीं है।", ta: "மாற்ற எந்த சந்திப்பும் இல்லை." };
      return ok(r[lang] || r.en, 'reschedule');
    }
    const nd = _extractDate(lower), nt = _extractSlot(lower);
    if (nd && nt) {
      appt.date = nd; appt.time = nt; appt.time_slot = nt;
      renderAppointments();
      const r = {
        en: `🔄 **Rescheduled!** Your appointment with **${appt.doctor_name}** has been moved to **${nd} at ${nt}**.`,
        hi: `🔄 **${appt.doctor_name}** के साथ **${nd} को ${nt}** कर दिया गया।`,
        ta: `🔄 **${appt.doctor_name}** உமது **${nd} அன்று ${nt}** க்கு மாற்றப்பட்டது.`,
      };
      return ok(r[lang] || r.en, 'reschedule', 'rescheduleAppointment', { new_date: nd, new_time_slot: nt }, { success: true });
    }
    const r = {
      en: `Your current appointment is with **${appt.doctor_name}** on **${appt.date} at ${appt.time}**. What new date and time would you like?`,
      hi: `आपका अपॉइंटमेंट **${appt.doctor_name}** के साथ **${appt.date} को ${appt.time}** है। नई तारीख और समय?`,
      ta: `தற்போது **${appt.doctor_name}** உமது **${appt.date} அன்று ${appt.time}**. புதிய நாள் மற்றும் நேரம்?`,
    };
    return ok(r[lang] || r.en, 'reschedule');
  }

  // ── Book ──────────────────────────────────────────────────
  if (/book|schedule|appointment|see a doctor|specialist|doctor|मिलना|बुक|பதிவு|சந்திப்பு/.test(lower)) {
    STATE.bookingContext = { active: true, specialty: null, doctor: null, date: null, slot: null, confirming: false };
    const ctx2 = STATE.bookingContext;
    const sp = _extractSpecialty(lower);
    if (sp) { ctx2.specialty = sp; ctx2.doctor = DOCTORS[sp]; }
    const date = _extractDate(lower);
    const slot = _extractSlot(lower);
    if (date) ctx2.date = date;
    if (slot) ctx2.slot = slot;

    if (!ctx2.specialty) return ok(_t('ask_specialty', lang), 'collecting');
    if (!ctx2.date) {
      const r = {
        en: `Got it — **${ctx2.specialty}** (${ctx2.doctor.name} at ${ctx2.doctor.hospital}). What date works for you? Say **tomorrow**, **this Friday**, or **next Monday**.`,
        hi: `समझ गया — **${ctx2.specialty}** (${ctx2.doctor.name}). किस दिन मिलना है?`,
        ta: `புரிந்தது — **${ctx2.specialty}** (${ctx2.doctor.name}). எந்த நாளில் வேண்டும்?`,
      };
      return ok(r[lang] || r.en, 'collecting');
    }
    if (!ctx2.slot) return ok(slotList(ctx2.doctor.name, ctx2.date), 'collecting');
  }

  // ── Availability ──────────────────────────────────────────
  if (/availability|available|slots|free slot|check/.test(lower)) {
    const sp = _extractSpecialty(lower) || 'cardiologist';
    const doc = DOCTORS[sp];
    const date = _extractDate(lower);
    const lines = ALL_SLOTS.map(s => `• **${s}**`).join('\n');
    const r = {
      en: `📅 **${doc.name}** (${sp}) on ${date}:\n${lines}\n\nWould you like to book one?`,
      hi: `📅 **${doc.name}** (${sp}) ${date} को:\n${lines}\n\nकोई बुक करना है?`,
      ta: `📅 **${doc.name}** (${sp}) ${date} அன்று:\n${lines}\n\nபதிவு செய்யவா?`,
    };
    return ok(r[lang] || r.en, 'availability', 'checkAvailability', { specialty: sp, date }, { success: true });
  }

  // ── List appointments ─────────────────────────────────────
  if (/my appointment|upcoming|show|list|அப்பாய்ண்ட்|சந்திப்பு/.test(lower)) {
    const upcoming = STATE.appointments.filter(a => a.status === 'confirmed');
    if (!upcoming.length) {
      const r = { en: "You have no upcoming appointments. Would you like to book one?", hi: "कोई आने वाला अपॉइंटमेंट नहीं है। नया बुक करना है?", ta: "வரவிருக்கும் சந்திப்புகள் இல்லை. புதியது பதிவு செய்யட்டுமா?" };
      return ok(r[lang] || r.en, 'list', 'getPatientAppointments', {}, { success: true, data: [] });
    }
    const lines = upcoming.map(a => `• **${a.doctor_name}** (${a.specialty}) — ${a.date} at ${a.time}`).join('\n');
    const r = { en: `📋 **Your upcoming appointments:**\n${lines}`, hi: `📋 **आपके आने वाले अपॉइंटमेंट:**\n${lines}`, ta: `📋 **உமது வரவிருக்கும் சந்திப்புகள்:**\n${lines}` };
    return ok(r[lang] || r.en, 'list', 'getPatientAppointments', {}, { success: true, data: upcoming });
  }

  // ── Default ───────────────────────────────────────────────
  return ok(_t('default', lang), 'unknown');
}

// ── Outbound campaign ─────────────────────────────────────────
async function triggerCampaign() {
  const p = PATIENTS[STATE.currentPatientId];
  showToast('info', `📞 Initiating reminder call for ${p.name}...`);
  await _delay(800);

  if (backendOnline) {
    try {
      const res = await apiOutboundCampaign(STATE.currentPatientId, STATE.currentLanguage);
      addMessage('agent', res.message, { language: res.language });
      showToast('success', 'Outbound reminder sent via backend');
      return;
    } catch (e) {}
  }

  const appt = STATE.appointments.find(a => a.status === 'confirmed');
  const info = appt ? `on **${appt.date} at ${appt.time}** with **${appt.doctor_name}**` : 'coming up soon';
  const r = {
    en: `📞 **Outbound Reminder** — Hello ${p.name}! This is Cara from Apollo Healthcare. You have an appointment ${info}. Reply **confirm**, **reschedule**, or **cancel**.`,
    hi: `📞 **आउटबाउंड रिमाइंडर** — नमस्ते ${p.name}! मैं Cara हूँ Apollo Healthcare से। आपका अपॉइंटमेंट ${info} है। **कनफर्म**, **रिशेड्यूल** या **रद्द** करें।`,
    ta: `📞 **அவுட்பவுண்ட் ரிமைண்டர்** — வணக்கம் ${p.name}! நான் Cara, Apollo Healthcare. உங்களுக்கு ${info} சந்திப்பு உள்ளது. **உறுதி**, **மாற்றம்** அல்லது **ரத்து** செய்யுங்கள்.`,
  };
  addMessage('agent', r[STATE.currentLanguage] || r.en, { language: STATE.currentLanguage });
  showToast('success', 'Outbound reminder sent');
}

// ── Keyboard shortcut ─────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (
    e.code === 'Space' &&
    e.target.tagName !== 'TEXTAREA' &&
    e.target.tagName !== 'INPUT' &&
    e.target.tagName !== 'SELECT' &&
    e.target.tagName !== 'BUTTON'
  ) {
    e.preventDefault();
    toggleRecording();
  }
});

// ── App Init ──────────────────────────────────────────────────
async function init() {
  initWaveform();
  renderPatientProfile(STATE.currentPatientId);
  renderAppointments();
  document.getElementById('sessId').textContent = STATE.sessionId.slice(0, 12);
  updateSttStatusBadge();

  // Backend check
  await checkBackend();

  if (backendOnline) {
    await apiRegisterPatient('P001', 'Priya Singh', 'en');
    connectWebSocket(STATE.currentPatientId);
    const appts = await apiGetAppointments(STATE.currentPatientId, 'confirmed');
    if (appts?.data) { STATE.appointments = appts.data; renderAppointments(); }
  }

  // Welcome message
  setTimeout(() => {
    const msg = backendOnline
      ? "Hello! I'm **Cara** 👋 — connected to your **FastAPI backend** ✅\n\nI can help you **book**, **reschedule**, or **cancel** clinical appointments in English, हिंदी, or தமிழ். Try the quick actions below or just speak!"
      : "Hello! I'm **Cara** 👋\n\n⚠️ **Running in offline simulation mode** — the FastAPI backend is not detected.\n\nAll features still work locally! Click **⚙️ Settings** to connect your backend, or use the quick action buttons to get started.";
    addMessage('agent', msg, { language: 'en' });
  }, 300);

  // STT hint if no engine
  if (getSttMode() === 'none') {
    setTimeout(() => {
      addMessage('agent', "🎙 **Speech tip:** Open this page in **Chrome** or **Edge** for free real-time voice input — no API key needed. Or go to **⚙️ Settings** and add your OpenAI key for Whisper transcription.", { language: 'en' });
    }, 1500);
  }
}

init();
