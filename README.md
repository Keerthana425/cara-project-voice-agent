# 🏥 Cara — Voice AI Healthcare Agent

A full-stack multilingual voice agent for clinical appointment management.
Supports **English**, **हिंदी**, and **தமிழ்**.

---

## 📁 Project Structure

```
cara-project/
├── backend/
│   ├── main.py            ← FastAPI app, routes, WebSocket
│   ├── agent.py           ← Clinical AI agent (intent + multi-turn)
│   ├── database.py        ← In-memory DB with seed data
│   ├── models.py          ← Pydantic request/response models
│   ├── requirements.txt   ← Python dependencies
│   ├── .env.example       ← Environment variables template
│   └── .gitignore
│
├── frontend/
│   ├── index.html         ← Main dashboard UI
│   └── src/
│       ├── styles.css     ← All styling
│       ├── api.js         ← Backend API layer (REST + WebSocket)
│       ├── speech.js      ← STT/TTS engine (Web Speech + Whisper)
│       ├── ui.js          ← DOM rendering helpers
│       └── app.js         ← App state, agent logic, init
│
└── README.md
```

## 🚀 Quick Start

### 1. Backend Setup (Local)

```bash
cd backend

# Create a virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and edit env (optional)
cp .env.example .env

# Start the server locally
uvicorn main:app --host 0.0.0.0 --port 8000
```

* API available at: **[http://127.0.0.1:8000](http://127.0.0.1:8000)**
* Interactive docs: **[http://127.0.0.1:8000/docs#/](http://127.0.0.1:8000/docs#/)**

---

### 2. Backend Setup (Render Deployment)

1. Push your repo to GitHub.
2. Create a **Web Service** on Render.

   * **Root Directory:** `backend`
   * **Build Command:** `pip install -r requirements.txt`
   * **Start Command:** `uvicorn main:app --host 0.0.0.0 --port 10000`
3. Add `.env` variables via Render dashboard.
4. Render will provide a **public URL**, e.g., `https://cara-backend.onrender.com/`.

---

### 3. Frontend Setup

No build step required — pure HTML/CSS/JS.

**Option A — Open directly:**

```bash
open frontend/index.html
# or double-click the file
```

**Option B — Serve with Python (recommended, avoids CORS):**

```bash
cd frontend
python -m http.server 5500
# Open http://localhost:5500
# Update BACKEND_URL in api.js to local: http://127.0.0.1:8000 or Render URL
```

**Option C — Live Server (VS Code):**
Right-click `index.html` → "Open with Live Server"

---

### 4. Connect Frontend → Backend

1. Open the dashboard in Chrome/Edge.
2. Click **⚙️ Settings**.
3. Set **Backend URL**:

   * Local: `http://127.0.0.1:8000/`
   * Deployed: `https://cara-backend.onrender.com/`
4. Click **Test** — should show ✅ Connected
5. Click **Save & Connect**

---

## 🎙 Speech Recognition

| Mode | Requirement | Quality |
|------|-------------|---------|
| Web Speech API | Chrome / Edge (no key needed) | ⭐⭐⭐ Real-time |
| OpenAI Whisper | OpenAI API key in Settings | ⭐⭐⭐⭐ Best accuracy |
| Text input | Always available | — |

Add your OpenAI key in **⚙️ Settings** → OpenAI API Key.

---

## 🌐 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/` | Health check |
| POST   | `/api/patients/register` | Register/update patient |
| GET    | `/api/patients/{id}` | Get patient profile |
| POST   | `/api/appointments/book` | Book appointment |
| POST   | `/api/appointments/cancel` | Cancel appointment |
| POST   | `/api/appointments/reschedule` | Reschedule appointment |
| GET    | `/api/appointments/availability` | Check doctor availability |
| GET    | `/api/appointments/{patient_id}` | List patient appointments |
| POST   | `/api/agent/respond` | Text-based agent endpoint |
| POST   | `/api/campaigns/outbound` | Trigger outbound reminder |
| WS     | `/ws/voice/{patient_id}` | Real-time voice WebSocket |

---

## 🧑‍⚕️ Demo Patients

| ID   | Name         | Language |
|------|--------------|----------|
| P001 | Priya Singh  | English  |
| P002 | Rajan Kumar  | हिंदी    |
| P003 | Meena Iyer   | தமிழ்    |

---

## 💬 Example Voice Commands

**English:**
- "Book appointment with cardiologist tomorrow"
- "Cancel my next appointment"
- "Reschedule to Friday at 2 PM"
- "Show my upcoming appointments"
- "Check availability for dermatologist next Monday"

**हिंदी:**
- "कल कार्डियोलॉजिस्ट से अपॉइंटमेंट बुक करें"
- "मेरा अगला अपॉइंटमेंट रद्द करें"

**தமிழ்:**
- "நாளை இதய நிபுணரிடம் சந்திப்பு பதிவு செய்யுங்கள்"
- "என் சந்திப்பை ரத்து செய்யுங்கள்"

---

## 🛠 Production Upgrades

| Feature | Current | Production |
|---------|---------|------------|
| Database | In-memory | PostgreSQL / MongoDB |
| Sessions | Local dict | Redis |
| LLM | Rule-based | Claude / GPT-4 via API |
| TTS | Browser API | ElevenLabs / Google TTS |
| Auth | None | JWT / OAuth2 |
| Deploy | Local | Docker + Kubernetes |

---

## 📦 Tech Stack

**Backend:** FastAPI · Python 3.11 · WebSockets · Pydantic v2 · Uvicorn
**Frontend:** Vanilla JS · Web Speech API · OpenAI Whisper · CSS Grid
