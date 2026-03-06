/**
 * Cara Frontend — Speech Engine
 * Handles Speech-to-Text (Web Speech API + OpenAI Whisper fallback)
 * and Text-to-Speech (Web Speech Synthesis).
 */

let webSpeechRecognition = null;

// ── STT Mode Detection ────────────────────────────────────────
function getSttMode() {
  const hasWebSpeech = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  const hasWhisperKey = !!(STATE?.openaiKey);
  if (hasWebSpeech) return 'webspeech';
  if (hasWhisperKey) return 'whisper';
  return 'none';
}

function updateSttStatusBadge() {
  const mode = getSttMode();
  const lbl = document.getElementById('sttModeLabel');
  const wsEl = document.getElementById('wsStatus');

  const labels = {
    webspeech: '✅ <strong style="color:var(--green)">Web Speech API</strong> — Real-time mic active (Chrome/Edge)',
    whisper:   '🔑 <strong style="color:var(--amber)">Whisper API</strong> — OpenAI transcription enabled',
    none:      '⚠️ <strong style="color:var(--red)">No speech engine</strong> — Open in Chrome or add OpenAI key',
  };
  if (lbl) lbl.innerHTML = labels[mode];

  if (wsEl && !backendOnline) {
    const ws = { webspeech: 'Web Speech', whisper: 'Whisper API', none: 'Text only ⚠️' };
    const colors = { webspeech: 'var(--green)', whisper: 'var(--amber)', none: 'var(--red)' };
    wsEl.textContent = ws[mode];
    wsEl.style.color = colors[mode];
  }
}

// ── Main Toggle ───────────────────────────────────────────────
async function toggleRecording() {
  if (STATE.isProcessing) return;
  if (STATE.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  const mode = getSttMode();
  if (mode === 'webspeech') {
    startWebSpeech();
  } else if (mode === 'whisper') {
    await startWhisperRecording();
  } else {
    showToast('error', 'No speech engine available. Type your message or open in Chrome.');
    document.getElementById('textInput').focus();
  }
}

function stopRecording() {
  if (webSpeechRecognition) {
    webSpeechRecognition.stop();
    webSpeechRecognition = null;
    return;
  }
  if (STATE.mediaRecorder && STATE.mediaRecorder.state !== 'inactive') {
    STATE.mediaRecorder.stop();
  } else {
    STATE.isRecording = false;
    setMicState('idle');
  }
}

// ── Web Speech API ────────────────────────────────────────────
function startWebSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  webSpeechRecognition = recognition;

  const langMap = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };
  recognition.lang = langMap[STATE.currentLanguage] || 'en-IN';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  STATE.isRecording = true;
  STATE._finalTranscript = '';
  setMicState('recording');

  recognition.onstart = () => {
    document.getElementById('transcriptPreview').textContent = '🎙 Listening...';
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += t;
      else interimTranscript += t;
    }
    const displayed = finalTranscript || interimTranscript;
    document.getElementById('transcriptPreview').textContent = displayed;
    if (finalTranscript) STATE._finalTranscript = finalTranscript;
  };

  recognition.onerror = (event) => {
    STATE.isRecording = false;
    setMicState('idle');
    document.getElementById('transcriptPreview').textContent = '';
    const errorMessages = {
      'not-allowed': '🔒 Microphone access denied. Please allow mic permissions.',
      'no-speech': '🔇 No speech detected. Please try again.',
      'network': '🌐 Network error during recognition.',
      'aborted': null, // user cancelled, no toast needed
    };
    const msg = errorMessages[event.error];
    if (msg) showToast('error', msg);
  };

  recognition.onend = async () => {
    STATE.isRecording = false;
    const transcript = (STATE._finalTranscript || '').trim();
    STATE._finalTranscript = '';

    if (!transcript) {
      setMicState('idle');
      document.getElementById('transcriptPreview').textContent = '';
      showToast('error', '🔇 Nothing heard. Try speaking again.');
      return;
    }

    setMicState('processing');
    document.getElementById('transcriptPreview').textContent = `"${transcript}"`;
    await handleUserMessage(transcript, true);
    setMicState('idle');
    document.getElementById('transcriptPreview').textContent = '';
  };

  try {
    recognition.start();
  } catch (e) {
    STATE.isRecording = false;
    setMicState('idle');
    showToast('error', 'Could not start speech recognition: ' + e.message);
  }
}

// ── Whisper API (fallback) ────────────────────────────────────
async function startWhisperRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    STATE.mediaRecorder = new MediaRecorder(stream, { mimeType });
    STATE.audioChunks = [];

    STATE.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) STATE.audioChunks.push(e.data);
    };

    STATE.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      STATE.isRecording = false;
      setMicState('processing');
      document.getElementById('transcriptPreview').textContent = '⏳ Transcribing with Whisper...';

      try {
        const audioBlob = new Blob(STATE.audioChunks, { type: mimeType });
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'whisper-1');
        const langMap = { en: 'en', hi: 'hi', ta: 'ta' };
        if (langMap[STATE.currentLanguage]) {
          formData.append('language', langMap[STATE.currentLanguage]);
        }

        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + STATE.openaiKey },
          body: formData,
        });

        if (!res.ok) throw new Error(`Whisper API error: ${res.status}`);
        const data = await res.json();
        const transcript = (data.text || '').trim();

        if (transcript) {
          document.getElementById('transcriptPreview').textContent = `"${transcript}"`;
          await handleUserMessage(transcript, true);
        } else {
          showToast('error', '🔇 Could not transcribe. Please try again.');
        }
      } catch (err) {
        console.error('[Whisper]', err);
        showToast('error', 'Transcription failed. Check your OpenAI API key in Settings.');
      }

      setMicState('idle');
      document.getElementById('transcriptPreview').textContent = '';
    };

    STATE.mediaRecorder.start(100);
    STATE.isRecording = true;
    setMicState('recording');
  } catch (e) {
    const msg = e.name === 'NotAllowedError'
      ? '🔒 Microphone access denied.'
      : `Could not access microphone: ${e.message}`;
    showToast('error', msg);
    setMicState('idle');
  }
}

// ── Mic button state ──────────────────────────────────────────
function setMicState(state) {
  const btn = document.getElementById('micBtn');
  const icon = document.getElementById('micIcon');
  const wf = document.getElementById('waveformContainer');

  btn.className = 'mic-btn' + (state === 'recording' ? ' recording' : state === 'processing' ? ' processing' : '');
  icon.textContent = state === 'recording' ? '⏹' : state === 'processing' ? '⟳' : '🎙️';
  wf.className = 'waveform-container' + (state === 'recording' ? ' active' : '');
}

// ── Waveform bars ─────────────────────────────────────────────
function initWaveform() {
  const container = document.getElementById('waveformBars');
  let html = '';
  for (let i = 0; i < 40; i++) {
    const delay = (i * 0.05).toFixed(2);
    html += `<div class="waveform-bar" style="height:4px;animation-delay:${delay}s"></div>`;
  }
  container.innerHTML = html;
}

// ── TTS (Text-to-Speech) ──────────────────────────────────────
function speakText(text, language = 'en') {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();

  // Strip markdown
  const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\n/g, ' ').replace(/[#*_~`]/g, '');

  const utterance = new SpeechSynthesisUtterance(clean);
  const langMap = { en: 'en-IN', hi: 'hi-IN', ta: 'ta-IN' };
  utterance.lang = langMap[language] || 'en-IN';
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  utterance.volume = 0.85;

  // Try to find a matching voice
  const voices = window.speechSynthesis.getVoices();
  const match = voices.find(v => v.lang.startsWith(langMap[language]?.slice(0, 2) || 'en'));
  if (match) utterance.voice = match;

  window.speechSynthesis.speak(utterance);
}
