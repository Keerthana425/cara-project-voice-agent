"""
In-memory database for Cara backend.
Replace with PostgreSQL/MongoDB in production using SQLAlchemy or Motor.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any


ALL_SLOTS = ["09:00 AM", "10:30 AM", "12:00 PM", "02:00 PM", "04:00 PM", "04:30 PM"]

SEED_DOCTORS = [
    {"id": "D001", "name": "Dr. Priya Sharma",   "specialty": "cardiologist",      "hospital": "Apollo"},
    {"id": "D002", "name": "Dr. Rajan Kumar",    "specialty": "dermatologist",     "hospital": "Fortis"},
    {"id": "D003", "name": "Dr. Meena Iyer",     "specialty": "general physician", "hospital": "Apollo"},
    {"id": "D004", "name": "Dr. Arjun Patel",    "specialty": "orthopedist",       "hospital": "Max"},
    {"id": "D005", "name": "Dr. Sunita Rao",     "specialty": "neurologist",       "hospital": "AIIMS"},
    {"id": "D006", "name": "Dr. Kavita Menon",   "specialty": "cardiologist",      "hospital": "Fortis"},
    {"id": "D007", "name": "Dr. Asha Nair",      "specialty": "dermatologist",     "hospital": "AIIMS"},
    {"id": "D008", "name": "Dr. Vikram Singh",   "specialty": "orthopedist",       "hospital": "Apollo"},
]

SEED_PATIENTS = [
    {"patient_id": "P001", "name": "Priya Singh",  "preferred_language": "en"},
    {"patient_id": "P002", "name": "Rajan Kumar",  "preferred_language": "hi"},
    {"patient_id": "P003", "name": "Meena Iyer",   "preferred_language": "ta"},
]


class InMemoryDB:
    def __init__(self):
        self.doctors: Dict[str, Dict] = {d["id"]: d for d in SEED_DOCTORS}
        self.patients: Dict[str, Dict] = {}
        self.appointments: Dict[str, Dict] = {}

        # Seed patients
        for p in SEED_PATIENTS:
            self.patients[p["patient_id"]] = {
                **p,
                "sessions": 0,
                "created_at": datetime.utcnow().isoformat()
            }

    # ── Patients ──────────────────────────────────────────────
    def upsert_patient(self, patient_id: str, name: str, language: str = "en") -> Dict:
        if patient_id not in self.patients:
            self.patients[patient_id] = {
                "patient_id": patient_id,
                "name": name,
                "preferred_language": language,
                "sessions": 0,
                "created_at": datetime.utcnow().isoformat()
            }
        else:
            self.patients[patient_id]["name"] = name
            self.patients[patient_id]["preferred_language"] = language
            self.patients[patient_id]["sessions"] += 1
        return self.patients[patient_id]

    def get_patient(self, patient_id: str) -> Optional[Dict]:
        return self.patients.get(patient_id)

    # ── Doctors ───────────────────────────────────────────────
    def get_doctor_by_specialty(self, specialty: str) -> Optional[Dict]:
        for doc in self.doctors.values():
            if doc["specialty"].lower() == specialty.lower():
                return doc
        return None

    def get_doctors_by_specialty(self, specialty: str) -> List[Dict]:
        return [d for d in self.doctors.values() if d["specialty"].lower() == specialty.lower()]

    # ── Appointments ──────────────────────────────────────────
    def create_appointment(
        self, appt_id: str, patient_id: str, doctor_id: str,
        doctor_name: str, specialty: str, hospital: str,
        date: str, time_slot: str
    ) -> Dict:
        appt = {
            "id": appt_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "doctor_name": doctor_name,
            "specialty": specialty,
            "hospital": hospital,
            "date": date,
            "time": time_slot,
            "status": "confirmed",
            "created_at": datetime.utcnow().isoformat()
        }
        self.appointments[appt_id] = appt
        return appt

    def get_appointment(self, appt_id: str) -> Optional[Dict]:
        return self.appointments.get(appt_id)

    def update_appointment_status(self, appt_id: str, status: str) -> Optional[Dict]:
        if appt_id in self.appointments:
            self.appointments[appt_id]["status"] = status
            self.appointments[appt_id]["updated_at"] = datetime.utcnow().isoformat()
            return self.appointments[appt_id]
        return None

    def reschedule_appointment(self, appt_id: str, new_date: str, new_time: str) -> Optional[Dict]:
        if appt_id in self.appointments:
            self.appointments[appt_id]["date"] = new_date
            self.appointments[appt_id]["time"] = new_time
            self.appointments[appt_id]["updated_at"] = datetime.utcnow().isoformat()
            return self.appointments[appt_id]
        return None

    def get_patient_appointments(self, patient_id: str, status: Optional[str] = None) -> List[Dict]:
        results = [a for a in self.appointments.values() if a["patient_id"] == patient_id]
        if status:
            results = [a for a in results if a["status"] == status]
        return sorted(results, key=lambda x: (x["date"], x["time"]))

    def check_conflict(
        self, doctor_id: str, date: str, time_slot: str,
        exclude_id: Optional[str] = None
    ) -> bool:
        for appt in self.appointments.values():
            if exclude_id and appt["id"] == exclude_id:
                continue
            if (
                appt["doctor_id"] == doctor_id and
                appt["date"] == date and
                appt["time"] == time_slot and
                appt["status"] == "confirmed"
            ):
                return True
        return False

    def get_available_slots(self, doctor_id: str, date: str) -> List[str]:
        booked = {
            a["time"] for a in self.appointments.values()
            if a["doctor_id"] == doctor_id and a["date"] == date and a["status"] == "confirmed"
        }
        return [s for s in ALL_SLOTS if s not in booked]


# Global singleton
db = InMemoryDB()
