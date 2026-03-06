"""
Pydantic models for Cara API request/response validation
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class PatientRegister(BaseModel):
    patient_id: str = Field(..., example="P001")
    name: str = Field(..., example="Priya Singh")
    preferred_language: str = Field(default="en", example="en")


class BookAppointmentRequest(BaseModel):
    patient_id: str = Field(..., example="P001")
    doctor_specialty: str = Field(..., example="cardiologist")
    date: str = Field(..., example="2025-02-15")
    time_slot: str = Field(..., example="10:30 AM")


class CancelAppointmentRequest(BaseModel):
    patient_id: str = Field(..., example="P001")
    appointment_id: str = Field(..., example="APT-ABC123")


class RescheduleAppointmentRequest(BaseModel):
    patient_id: str = Field(..., example="P001")
    appointment_id: str = Field(..., example="APT-ABC123")
    new_date: str = Field(..., example="2025-02-20")
    new_time_slot: str = Field(..., example="02:00 PM")


class OutboundCampaignRequest(BaseModel):
    patient_id: str = Field(..., example="P001")
    language: Optional[str] = Field(default=None, example="en")


class AgentRequest(BaseModel):
    text: str = Field(..., example="Book appointment with cardiologist tomorrow")
    language: str = Field(default="en", example="en")
    patient_id: str = Field(..., example="P001")
    session_id: Optional[str] = Field(default=None)
    context: Optional[Dict[str, Any]] = Field(default_factory=dict)


class AgentResponse(BaseModel):
    response: str
    intent: str
    language: str
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None
    total_ms: Optional[int] = None


class AppointmentOut(BaseModel):
    id: str
    patient_id: str
    doctor_id: str
    doctor_name: str
    specialty: str
    hospital: str
    date: str
    time: str
    status: str
    created_at: str


class DoctorOut(BaseModel):
    id: str
    name: str
    specialty: str
    hospital: str
    available_slots: List[str]
