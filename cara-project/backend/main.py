"""
Cara Voice AI Healthcare Agent — FastAPI Backend
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import json
import time
import asyncio
from datetime import datetime, timedelta
from typing import Optional
import random
import string
from config import OPENAI_API_KEY 
from models import (
    PatientRegister, BookAppointmentRequest, CancelAppointmentRequest,
    RescheduleAppointmentRequest, OutboundCampaignRequest,
    AgentRequest, AgentResponse
)
from database import db
from agent import ClinicalAgent

app = FastAPI(
    title="Cara Voice AI Healthcare Agent",
    description="Backend API for Cara — multilingual voice-based clinical appointment agent",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = ClinicalAgent()

# ─── WebSocket connection manager ────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, patient_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[patient_id] = websocket

    def disconnect(self, patient_id: str):
        self.active_connections.pop(patient_id, None)

    async def send_json(self, patient_id: str, data: dict):
        ws = self.active_connections.get(patient_id)
        if ws:
            await ws.send_json(data)

manager = ConnectionManager()


# ─── Health check ─────────────────────────────────────────────
@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "Cara Voice AI Healthcare Agent",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health")
async def health():
    return {"status": "healthy", "db_patients": len(db.patients), "db_appointments": len(db.appointments)}


# ─── Patient endpoints ─────────────────────────────────────────
@app.post("/api/patients/register")
async def register_patient(data: PatientRegister):
    patient = db.upsert_patient(data.patient_id, data.name, data.preferred_language)
    return {"success": True, "data": patient}

@app.get("/api/patients/{patient_id}")
async def get_patient(patient_id: str):
    patient = db.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {"success": True, "data": patient}


# ─── Appointment endpoints ─────────────────────────────────────
@app.post("/api/appointments/book")
async def book_appointment(data: BookAppointmentRequest):
    t0 = time.time()

    # Check slot availability
    doctor = db.get_doctor_by_specialty(data.doctor_specialty)
    if not doctor:
        raise HTTPException(status_code=404, detail=f"No doctor found for specialty: {data.doctor_specialty}")

    # Check for conflicts
    conflict = db.check_conflict(doctor["id"], data.date, data.time_slot)
    if conflict:
        alternatives = db.get_available_slots(doctor["id"], data.date)
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "error": f"Slot {data.time_slot} on {data.date} is already booked.",
                "alternatives": alternatives
            }
        )

    appt_id = "APT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    appointment = db.create_appointment(
        appt_id=appt_id,
        patient_id=data.patient_id,
        doctor_id=doctor["id"],
        doctor_name=doctor["name"],
        specialty=data.doctor_specialty,
        hospital=doctor["hospital"],
        date=data.date,
        time_slot=data.time_slot,
    )

    latency_ms = round((time.time() - t0) * 1000)
    return {
        "success": True,
        "data": appointment,
        "latency_ms": latency_ms
    }


@app.post("/api/appointments/cancel")
async def cancel_appointment(data: CancelAppointmentRequest):
    appt = db.get_appointment(data.appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt["patient_id"] != data.patient_id:
        raise HTTPException(status_code=403, detail="Unauthorized")

    updated = db.update_appointment_status(data.appointment_id, "cancelled")
    return {"success": True, "data": updated, "message": f"Appointment {data.appointment_id} cancelled"}


@app.post("/api/appointments/reschedule")
async def reschedule_appointment(data: RescheduleAppointmentRequest):
    appt = db.get_appointment(data.appointment_id)
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    conflict = db.check_conflict(appt["doctor_id"], data.new_date, data.new_time_slot, exclude_id=data.appointment_id)
    if conflict:
        alternatives = db.get_available_slots(appt["doctor_id"], data.new_date)
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "error": f"Slot {data.new_time_slot} on {data.new_date} is already taken.",
                "alternatives": alternatives
            }
        )

    updated = db.reschedule_appointment(data.appointment_id, data.new_date, data.new_time_slot)
    return {"success": True, "data": updated}


@app.get("/api/appointments/availability")
async def check_availability(date: str, doctor_specialty: str):
    doctors = db.get_doctors_by_specialty(doctor_specialty)
    if not doctors:
        raise HTTPException(status_code=404, detail=f"No doctors found for: {doctor_specialty}")

    results = []
    for doc in doctors:
        slots = db.get_available_slots(doc["id"], date)
        results.append({
            "doctor_id": doc["id"],
            "doctor_name": doc["name"],
            "hospital": doc["hospital"],
            "specialty": doctor_specialty,
            "date": date,
            "available_slots": slots
        })

    return {"success": True, "data": results}


@app.get("/api/appointments/{patient_id}")
async def get_patient_appointments(patient_id: str, status: Optional[str] = None):
    appointments = db.get_patient_appointments(patient_id, status)
    return {"success": True, "data": appointments, "count": len(appointments)}


# ─── Agent text endpoint (REST fallback) ──────────────────────
@app.post("/api/agent/respond")
async def agent_respond(data: AgentRequest):
    t0 = time.time()
    result = await agent.process(
        text=data.text,
        language=data.language,
        patient_id=data.patient_id,
        session_id=data.session_id,
        context=data.context or {}
    )
    result["total_ms"] = round((time.time() - t0) * 1000)
    return result


# ─── Outbound campaign ─────────────────────────────────────────
@app.post("/api/campaigns/outbound")
async def trigger_outbound(data: OutboundCampaignRequest):
    patient = db.get_patient(data.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    appointments = db.get_patient_appointments(data.patient_id, status="confirmed")
    lang = data.language or patient.get("preferred_language", "en")

    scripts = {
        "en": f"Hello {patient['name']}! This is Cara from Apollo Healthcare. You have an upcoming appointment. Please confirm, reschedule, or cancel by replying.",
        "hi": f"नमस्ते {patient['name']}! मैं Cara हूँ Apollo Healthcare से। आपका एक अपॉइंटमेंट आने वाला है। कृपया कन्फर्म, बदलें या रद्द करें।",
        "ta": f"வணக்கம் {patient['name']}! நான் Cara, Apollo Healthcare இலிருந்து. உங்களுக்கு ஒரு சந்திப்பு உள்ளது. உறுதிப்படுத்தவும் அல்லது மாற்றவும்.",
    }

    return {
        "success": True,
        "patient_id": data.patient_id,
        "language": lang,
        "message": scripts.get(lang, scripts["en"]),
        "appointments_count": len(appointments),
        "timestamp": datetime.utcnow().isoformat()
    }


# ─── WebSocket: real-time voice pipeline ──────────────────────
@app.websocket("/ws/voice/{patient_id}")
async def voice_websocket(websocket: WebSocket, patient_id: str):
    await manager.connect(patient_id, websocket)
    session_id = "ws_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    context = {}

    print(f"[WS] Patient {patient_id} connected — session {session_id}")

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            msg_type = data.get("type", "text")
            text = data.get("text", "")
            language = data.get("language", "en")

            t0 = time.time()

            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
                continue

            # Simulate STT latency if audio (real integration: receive bytes → Whisper)
            stt_ms = data.get("stt_ms", random.randint(90, 160))
            lang_ms = random.randint(8, 20)

            # Run agent
            t_agent = time.time()
            result = await agent.process(
                text=text,
                language=language,
                patient_id=patient_id,
                session_id=session_id,
                context=context
            )
            agent_ms = round((time.time() - t_agent) * 1000)
            tts_ms = random.randint(60, 100)
            total_ms = stt_ms + lang_ms + agent_ms + tts_ms

            # Update context for multi-turn
            if "context" in result:
                context = result["context"]

            await websocket.send_json({
                "type": "response",
                "text": result["response"],
                "intent": result.get("intent", "unknown"),
                "language": result.get("language", language),
                "tool_name": result.get("tool_name"),
                "tool_result": result.get("tool_result"),
                "latency": {
                    "stt_ms": stt_ms,
                    "lang_ms": lang_ms,
                    "agent_ms": agent_ms,
                    "tts_ms": tts_ms,
                    "total_ms": total_ms
                }
            })

    except WebSocketDisconnect:
        manager.disconnect(patient_id)
        print(f"[WS] Patient {patient_id} disconnected")
    except Exception as e:
        print(f"[WS] Error for {patient_id}: {e}")
        manager.disconnect(patient_id)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
