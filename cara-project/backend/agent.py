"""
Cara Clinical Agent — handles intent detection, multi-turn booking flow,
and multilingual responses (English, Hindi, Tamil).

In production, replace simulate_llm_response() with a real LLM call
(e.g., Anthropic Claude, OpenAI GPT-4) via the API.
"""

import asyncio
import random
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from config import OPENAI_API_KEY 
from database import db


# ─── Multilingual response templates ──────────────────────────
RESPONSES = {
    "greeting": {
        "en": "Hello! I'm **Cara** 👋 — your healthcare assistant. I can help you **book**, **reschedule**, or **cancel** appointments. What would you like to do?",
        "hi": "नमस्ते! मैं **Cara** हूँ 👋 — आपकी स्वास्थ्य सहायक। **बुक**, **रिशेड्यूल** या **रद्द** करने में मदद कर सकती हूँ।",
        "ta": "வணக்கம்! நான் **Cara** 👋 — உமது மருத்துவ உதவியாளர். **பதிவு**, **மாற்றம்** அல்லது **ரத்து** செய்ய உதவுவேன்.",
    },
    "ask_specialty": {
        "en": "What's the reason for your visit? Describe your **symptoms** or name a **specialty**:\n\n• Chest pain / breathlessness → **Cardiologist**\n• Skin rash / acne / hair loss → **Dermatologist**\n• Fever / cold / checkup → **General Physician**\n• Joint / back / bone pain → **Orthopedist**\n• Headache / dizziness / seizures → **Neurologist**",
        "hi": "किस कारण से आना है? **लक्षण** बताएं या **विशेषता** का नाम लें:\n\n• सीने में दर्द → **हृदय रोग विशेषज्ञ**\n• त्वचा समस्या → **त्वचा रोग विशेषज्ञ**\n• बुखार / जुकाम → **सामान्य चिकित्सक**\n• जोड़ों में दर्द → **हड्डी रोग विशेषज्ञ**\n• सिरदर्द / चक्कर → **न्यूरोलॉजिस्ट**",
        "ta": "ஏன் வருகிறீர்கள்? **அறிகுறிகள்** அல்லது **சிறப்பு** பகுதியை சொல்லுங்கள்:\n\n• மார்பு வலி → **இதய நிபுணர்**\n• தோல் பிரச்சனை → **தோல் நிபுணர்**\n• காய்ச்சல் / இருமல் → **பொது மருத்துவர்**\n• மூட்டு வலி → **எலும்பு நிபுணர்**\n• தலைவலி / தலைசுற்றல் → **நரம்பியல் நிபுணர்**",
    },
    "ask_date": {
        "en": "What date works for you? Say **tomorrow**, **this Friday**, **next Monday**, or give a specific date.",
        "hi": "कौन सी तारीख चाहिए? **कल**, **इस शुक्रवार**, **अगले सोमवार** या कोई तारीख बताएं।",
        "ta": "எந்த நாளில் வேண்டும்? **நாளை**, **இந்த வெள்ளி**, **அடுத்த திங்கள்** அல்லது தேதி சொல்லுங்கள்.",
    },
    "no_appointments": {
        "en": "You have no upcoming appointments. Would you like to book one?",
        "hi": "कोई आने वाला अपॉइंटमेंट नहीं है। नया बुक करना है?",
        "ta": "வரவிருக்கும் சந்திப்புகள் இல்லை. புதியது பதிவு செய்யட்டுமா?",
    },
    "cancelled": {
        "en": "No active appointments found to cancel.",
        "hi": "रद्द करने के लिए कोई सक्रिय अपॉइंटमेंट नहीं मिला।",
        "ta": "ரத்து செய்ய எந்த சந்திப்பும் இல்லை.",
    },
    "default": {
        "en": "I can help you **book**, **cancel**, or **reschedule** appointments, or check **availability**. What would you like to do?",
        "hi": "मैं **बुकिंग**, **रद्द** या **रिशेड्यूल** करने में मदद कर सकती हूँ। क्या करना है?",
        "ta": "**பதிவு**, **ரத்து** அல்லது **மாற்றம்** செய்ய உதவுவேன். என்ன செய்யவேண்டும்?",
    }
}

SPECIALTY_MAP = {
    # English
    "cardiologist": "cardiologist", "cardiology": "cardiologist",
    "heart": "cardiologist", "chest pain": "cardiologist",
    "breathless": "cardiologist", "palpitation": "cardiologist",
    "dermatologist": "dermatologist", "dermatology": "dermatologist",
    "skin": "dermatologist", "rash": "dermatologist",
    "acne": "dermatologist", "hair loss": "dermatologist",
    "general physician": "general physician", "physician": "general physician",
    "general": "general physician", "fever": "general physician",
    "cold": "general physician", "cough": "general physician",
    "checkup": "general physician", "flu": "general physician",
    "orthopedist": "orthopedist", "orthopedics": "orthopedist",
    "joint": "orthopedist", "bone": "orthopedist",
    "knee": "orthopedist", "back pain": "orthopedist",
    "neurologist": "neurologist", "neurology": "neurologist",
    "headache": "neurologist", "migraine": "neurologist",
    "dizzy": "neurologist", "dizziness": "neurologist",
    "seizure": "neurologist",
    # Hindi
    "सीने में दर्द": "cardiologist", "दिल": "cardiologist",
    "त्वचा": "dermatologist", "चकत्ते": "dermatologist",
    "बुखार": "general physician", "सर्दी": "general physician",
    "जोड़": "orthopedist", "घुटना": "orthopedist", "पीठ दर्द": "orthopedist",
    "सिरदर्द": "neurologist", "चक्कर": "neurologist",
    # Tamil
    "மார்பு வலி": "cardiologist", "தோல்": "dermatologist",
    "காய்ச்சல்": "general physician", "மூட்டு": "orthopedist",
    "தலைவலி": "neurologist",
}


class ClinicalAgent:
    """
    Multi-turn clinical intent agent.

    Session context per patient tracks booking flow state.
    In production, store session context in Redis for horizontal scaling.
    """

    def __init__(self):
        self.sessions: Dict[str, Dict] = {}

    def _get_session(self, session_id: str) -> Dict:
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "booking": {"active": False},
                "turns": 0
            }
        return self.sessions[session_id]

    def _detect_language(self, text: str) -> str:
        if any('\u0900' <= c <= '\u097F' for c in text):
            return "hi"
        if any('\u0B80' <= c <= '\u0BFF' for c in text):
            return "ta"
        return "en"

    def _detect_intent(self, text: str) -> str:
        lower = text.lower()
        if any(k in lower for k in ["book", "schedule", "appointment", "see a doctor", "doctor", "specialist",
                                     "बुक", "मिलना", "अपॉइंटमेंट", "பதிவு", "சந்திப்பு"]):
            return "book"
        if any(k in lower for k in ["cancel", "रद्द", "ரத்து"]):
            return "cancel"
        if any(k in lower for k in ["reschedule", "move", "change", "shift", "postpone",
                                     "बदल", "रिशेड्यूल", "மாற்ற"]):
            return "reschedule"
        if any(k in lower for k in ["availability", "available", "slots", "free", "open",
                                     "उपलब்ध", "கிடைக்கும்"]):
            return "availability"
        if any(k in lower for k in ["my appointment", "upcoming", "list", "show",
                                     "मेरा अपॉइंटमेंट", "சந்திப்புகள்"]):
            return "list"
        if any(k in lower for k in ["hello", "hi", "hey", "namaste", "नमस्ते", "வணக்கம்"]):
            return "greeting"
        return "unknown"

    def _extract_specialty(self, text: str) -> Optional[str]:
        lower = text.lower()
        for keyword, specialty in SPECIALTY_MAP.items():
            if keyword in lower:
                return specialty
        return None

    def _extract_date(self, text: str) -> str:
        lower = text.lower()
        today = datetime.now()
        if "tomorrow" in lower or "कल" in lower or "நாளை" in lower:
            return (today + timedelta(days=1)).strftime("%Y-%m-%d")
        if "friday" in lower or "शुक्रवार" in lower or "வெள்ளி" in lower:
            days_ahead = (4 - today.weekday() + 7) % 7 or 7
            return (today + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        if "monday" in lower or "सोमवार" in lower or "திங்கள்" in lower:
            days_ahead = (0 - today.weekday() + 7) % 7 or 7
            return (today + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        # fallback: tomorrow
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")

    def _extract_slot(self, text: str) -> Optional[str]:
        import re
        lower = text.lower()
        m = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)', lower)
        if m:
            h, mn, period = int(m.group(1)), m.group(2) or "00", m.group(3).upper()
            return f"{h:02d}:{mn} {period}"
        slot_map = {
            "9": "09:00 AM", "nine": "09:00 AM",
            "10:30": "10:30 AM", "ten thirty": "10:30 AM",
            "12": "12:00 PM", "noon": "12:00 PM", "twelve": "12:00 PM",
            "2": "02:00 PM", "two": "02:00 PM",
            "4": "04:00 PM", "four": "04:00 PM",
        }
        for key, val in slot_map.items():
            if key in lower:
                return val
        return None

    def _t(self, key: str, lang: str) -> str:
        return RESPONSES.get(key, {}).get(lang) or RESPONSES.get(key, {}).get("en", "")

    async def process(
        self,
        text: str,
        language: str,
        patient_id: str,
        session_id: str,
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        await asyncio.sleep(0.05 + random.random() * 0.1)  # simulate processing

        detected_lang = self._detect_language(text) or language
        session = self._get_session(session_id)
        session["turns"] += 1
        lower = text.lower()

        # ── Mid-booking flow ────────────────────────────────────
        ctx = session.get("booking", {})
        if ctx.get("active"):
            result = await self._handle_booking_flow(text, lower, detected_lang, patient_id, ctx)
            session["booking"] = ctx
            return {**result, "language": detected_lang, "context": session}

        # ── Fresh intent detection ──────────────────────────────
        intent = self._detect_intent(text)

        if intent == "greeting":
            return {"response": self._t("greeting", detected_lang), "intent": "greeting", "language": detected_lang, "context": session}

        if intent == "book":
            ctx.update({"active": True, "specialty": None, "doctor": None, "date": None, "slot": None, "confirming": False})
            session["booking"] = ctx
            sp = self._extract_specialty(lower)
            date = self._extract_date(lower)
            slot = self._extract_slot(lower)
            if sp:
                ctx["specialty"] = sp
                ctx["doctor"] = db.get_doctor_by_specialty(sp)
            if date: ctx["date"] = date
            if slot: ctx["slot"] = slot
            result = await self._handle_booking_flow(text, lower, detected_lang, patient_id, ctx)
            session["booking"] = ctx
            return {**result, "language": detected_lang, "context": session}

        if intent == "cancel":
            return await self._handle_cancel(detected_lang, patient_id, session)

        if intent == "reschedule":
            return await self._handle_reschedule(text, lower, detected_lang, patient_id, session)

        if intent == "availability":
            return await self._handle_availability(lower, detected_lang)

        if intent == "list":
            return await self._handle_list(detected_lang, patient_id, session)

        return {"response": self._t("default", detected_lang), "intent": "unknown", "language": detected_lang, "context": session}

    async def _handle_booking_flow(self, text, lower, lang, patient_id, ctx):
        # Cancel mid-flow
        if any(k in lower for k in ["cancel", "stop", "no", "नहीं", "வேண்டாம்"]):
            ctx.update({"active": False})
            r = {"en": "No problem! Booking cancelled. Anything else?",
                 "hi": "ठीक है, रद्द कर दिया। और कुछ?",
                 "ta": "சரி, நிறுத்தியுள்ளேன். வேறு ஏதாவது?"}
            return {"response": r.get(lang, r["en"]), "intent": "conversation", "tool_name": None, "tool_result": None}

        # Collect specialty
        if not ctx.get("specialty"):
            sp = self._extract_specialty(lower)
            if not sp:
                return {"response": self._t("ask_specialty", lang), "intent": "collecting", "tool_name": None, "tool_result": None}
            ctx["specialty"] = sp
            ctx["doctor"] = db.get_doctor_by_specialty(sp)

        # Collect date
        if not ctx.get("date"):
            date = self._extract_date(lower)
            ctx["date"] = date
            if not ctx.get("slot"):
                return await self._ask_slot(lang, ctx)

        # Collect slot
        if not ctx.get("slot"):
            slot = self._extract_slot(lower)
            if not slot:
                return await self._ask_slot(lang, ctx)
            ctx["slot"] = slot

        # Confirmation step
        if not ctx.get("confirming"):
            ctx["confirming"] = True
            doc = ctx.get("doctor") or {}
            r = {
                "en": f"Please confirm your booking:\n\n👨‍⚕️ **{doc.get('name', 'Doctor')}**\n🏥 **{doc.get('hospital', '')}**\n🩺 **{ctx['specialty']}**\n📅 **{ctx['date']}**\n🕐 **{ctx['slot']}**\n\nSay **yes** to confirm or **no** to change.",
                "hi": f"बुकिंग की पुष्टि करें:\n\n👨‍⚕️ **{doc.get('name', '')}**\n🏥 **{doc.get('hospital', '')}**\n📅 **{ctx['date']}** को **{ctx['slot']}**\n\n**हाँ** = कनफर्म | **नहीं** = बदलें",
                "ta": f"முன்பதிவை உறுதிப்படுத்துங்கள்:\n\n👨‍⚕️ **{doc.get('name', '')}**\n🏥 **{doc.get('hospital', '')}**\n📅 **{ctx['date']}** அன்று **{ctx['slot']}**\n\n**ஆம்** = உறுதி | **இல்லை** = மாற்று",
            }
            return {"response": r.get(lang, r["en"]), "intent": "confirming", "tool_name": None, "tool_result": None}

        # Final yes/no
        is_yes = any(k in lower for k in ["yes", "confirm", "ok", "sure", "हाँ", "हां", "ஆம்", "சரி"])
        if is_yes:
            # Actually book via DB
            import random, string
            appt_id = "APT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
            doc = ctx.get("doctor") or {}
            appt = db.create_appointment(
                appt_id=appt_id,
                patient_id=patient_id,
                doctor_id=doc.get("id", "D001"),
                doctor_name=doc.get("name", "Doctor"),
                specialty=ctx["specialty"],
                hospital=doc.get("hospital", ""),
                date=ctx["date"],
                time_slot=ctx["slot"],
            )
            ctx.update({"active": False})
            r = {
                "en": f"✅ **Booking Confirmed!**\n\n👨‍⚕️ {doc.get('name')} ({ctx['specialty']})\n📅 {ctx['date']} at {ctx['slot']}\n🏥 {doc.get('hospital')}\n🔖 Appointment ID: **{appt_id}**\n\nIs there anything else I can help you with?",
                "hi": f"✅ **बुकिंग कनफर्म!**\n\n👨‍⚕️ {doc.get('name')}\n📅 {ctx['date']} को {ctx['slot']}\n🏥 {doc.get('hospital')}\n🔖 ID: **{appt_id}**",
                "ta": f"✅ **முன்பதிவு உறுதி!**\n\n👨‍⚕️ {doc.get('name')}\n📅 {ctx['date']} அன்று {ctx['slot']}\n🏥 {doc.get('hospital')}\n🔖 ID: **{appt_id}**",
            }
            return {
                "response": r.get(lang, r["en"]),
                "intent": "book",
                "tool_name": "bookAppointment",
                "tool_args": {"patient_id": patient_id, "doctor_specialty": ctx["specialty"], "date": ctx["date"], "time_slot": ctx["slot"]},
                "tool_result": {"success": True, "data": appt}
            }
        else:
            ctx.update({"active": False})
            r = {"en": "No problem! Let's start over. What type of doctor do you need?",
                 "hi": "ठीक है, फिर से शुरू करते हैं।",
                 "ta": "சரி, மீண்டும் தொடங்குவோம்."}
            return {"response": r.get(lang, r["en"]), "intent": "conversation", "tool_name": None, "tool_result": None}

    async def _ask_slot(self, lang, ctx):
        doc = ctx.get("doctor") or {}
        slots = db.get_available_slots(doc.get("id", "D001"), ctx.get("date", ""))
        if not slots:
            r = {"en": "No slots available on that date. Please try another date.",
                 "hi": "उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। दूसरी तारीख आज़माएं।",
                 "ta": "அந்த நாளில் நேரம் இல்லை. வேறு நாளை முயற்சியுங்கள்."}
            return {"response": r.get(lang, r["en"]), "intent": "collecting", "tool_name": None, "tool_result": None}
        slot_list = "\n".join(f"• **{s}**" for s in slots)
        r = {
            "en": f"Available slots with **{doc.get('name', 'Doctor')}** on **{ctx.get('date', '')}**:\n{slot_list}\n\nWhich time works for you?",
            "hi": f"**{doc.get('name', '')}** के साथ **{ctx.get('date', '')}** को उपलब्ध समय:\n{slot_list}\n\nकौन सा समय ठीक रहेगा?",
            "ta": f"**{doc.get('name', '')}** உமது **{ctx.get('date', '')}** அன்று நேரங்கள்:\n{slot_list}\n\nஎந்த நேரம்?",
        }
        return {"response": r.get(lang, r["en"]), "intent": "collecting", "tool_name": None, "tool_result": None}

    async def _handle_cancel(self, lang, patient_id, session):
        appointments = db.get_patient_appointments(patient_id, status="confirmed")
        if not appointments:
            return {"response": self._t("cancelled", lang), "intent": "cancel", "language": lang, "tool_name": "cancelAppointment", "tool_result": {"success": False}, "context": session}

        appt = appointments[0]
        db.update_appointment_status(appt["id"], "cancelled")
        r = {
            "en": f"❌ Your appointment with **{appt['doctor_name']}** on **{appt['date']} at {appt['time']}** has been cancelled.",
            "hi": f"❌ **{appt['doctor_name']}** के साथ **{appt['date']} को {appt['time']}** रद्द कर दिया गया।",
            "ta": f"❌ **{appt['doctor_name']}** உமது **{appt['date']} அன்று {appt['time']}** ரத்து செய்யப்பட்டது.",
        }
        return {"response": r.get(lang, r["en"]), "intent": "cancel", "language": lang, "tool_name": "cancelAppointment", "tool_result": {"success": True, "data": appt}, "context": session}

    async def _handle_reschedule(self, text, lower, lang, patient_id, session):
        appointments = db.get_patient_appointments(patient_id, status="confirmed")
        if not appointments:
            r = {"en": "You have no confirmed appointments to reschedule.", "hi": "रिशेड्यूल करने के लिए कोई अपॉइंटमेंट नहीं है।", "ta": "மாற்ற எந்த சந்திப்பும் இல்லை."}
            return {"response": r.get(lang, r["en"]), "intent": "reschedule", "language": lang, "tool_name": None, "tool_result": None, "context": session}

        appt = appointments[0]
        new_date = self._extract_date(lower)
        new_slot = self._extract_slot(lower)
        if new_date and new_slot:
            db.reschedule_appointment(appt["id"], new_date, new_slot)
            r = {
                "en": f"🔄 **Rescheduled!** Your appointment with **{appt['doctor_name']}** has been moved to **{new_date} at {new_slot}**.",
                "hi": f"🔄 **{appt['doctor_name']}** के साथ **{new_date} को {new_slot}** कर दिया गया।",
                "ta": f"🔄 **{appt['doctor_name']}** உமது **{new_date} அன்று {new_slot}** க்கு மாற்றப்பட்டது.",
            }
            return {"response": r.get(lang, r["en"]), "intent": "reschedule", "language": lang, "tool_name": "rescheduleAppointment", "tool_result": {"success": True}, "context": session}

        r = {
            "en": f"Your current appointment is with **{appt['doctor_name']}** on **{appt['date']} at {appt['time']}**. What new date and time would you like?",
            "hi": f"आपका अपॉइंटमेंट **{appt['doctor_name']}** के साथ **{appt['date']} को {appt['time']}** है। नई तारीख और समय?",
            "ta": f"தற்போது **{appt['doctor_name']}** உமது **{appt['date']} அன்று {appt['time']}**. புதிய நாள் மற்றும் நேரம்?",
        }
        return {"response": r.get(lang, r["en"]), "intent": "reschedule", "language": lang, "tool_name": None, "tool_result": None, "context": session}

    async def _handle_availability(self, lower, lang):
        specialty = self._extract_specialty(lower) or "cardiologist"
        date = self._extract_date(lower)
        doctors = db.get_doctors_by_specialty(specialty)
        if not doctors:
            return {"response": f"No {specialty} found.", "intent": "availability", "language": lang, "tool_name": "checkAvailability", "tool_result": {"success": False}}

        doc = doctors[0]
        slots = db.get_available_slots(doc["id"], date)
        slot_list = "\n".join(f"• **{s}**" for s in slots) if slots else "No slots available"
        r = {
            "en": f"📅 **{doc['name']}** ({specialty}) on {date}:\n{slot_list}\n\nWould you like to book one?",
            "hi": f"📅 **{doc['name']}** ({specialty}) {date} को:\n{slot_list}\n\nकोई बुक करना है?",
            "ta": f"📅 **{doc['name']}** ({specialty}) {date} அன்று:\n{slot_list}\n\nபதிவு செய்யவா?",
        }
        return {"response": r.get(lang, r["en"]), "intent": "availability", "language": lang, "tool_name": "checkAvailability", "tool_result": {"success": True, "data": {"doctor": doc, "slots": slots, "date": date}}}

    async def _handle_list(self, lang, patient_id, session):
        appointments = db.get_patient_appointments(patient_id, status="confirmed")
        if not appointments:
            return {"response": self._t("no_appointments", lang), "intent": "list", "language": lang, "tool_name": "getPatientAppointments", "tool_result": {"success": True, "data": []}, "context": session}

        lines = "\n".join(f"• **{a['doctor_name']}** ({a['specialty']}) — {a['date']} at {a['time']} [{a['id']}]" for a in appointments)
        r = {
            "en": f"📋 **Your upcoming appointments:**\n{lines}",
            "hi": f"📋 **आपके आने वाले अपॉइंटमेंट:**\n{lines}",
            "ta": f"📋 **உமது வரவிருக்கும் சந்திப்புகள்:**\n{lines}",
        }
        return {"response": r.get(lang, r["en"]), "intent": "list", "language": lang, "tool_name": "getPatientAppointments", "tool_result": {"success": True, "data": appointments}, "context": session}
