"""
routers/whatsapp.py

FastAPI router for WhatsApp Web notification service:
- GET /api/whatsapp/status
- POST /api/whatsapp/send
- POST /api/whatsapp/send-recommendation
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from app.config import get_settings
from app.database import get_supabase_client
from app.dependencies import _decode_token
from app.services import whatsapp_service

logger = logging.getLogger("nutripalm.whatsapp")

router = APIRouter(
    prefix="/api/whatsapp",
    tags=["whatsapp"],
)


class WhatsAppDirectSendRequest(BaseModel):
    phone: str
    message: str


class WhatsAppRecommendationRequest(BaseModel):
    phone: Optional[str] = None
    farmer_name: Optional[str] = "Farmer"
    plot_name: Optional[str] = "Plot"
    crop: Optional[str] = "Oil Palm"
    severity: Optional[str] = "normal"
    soil_data: Optional[dict[str, Any]] = None
    fertilizer_plan: Optional[list[dict[str, Any]]] = None
    advice: Optional[str] = None
    expected_yield: Optional[float] = None
    custom_message: Optional[str] = None


@router.get("/status")
def get_status() -> dict[str, Any]:
    """
    Check the current connection status of the WhatsApp Web client.
    """
    return whatsapp_service.get_whatsapp_status()


@router.post("/send")
def send_message(req: WhatsAppDirectSendRequest) -> dict[str, Any]:
    """
    Send a direct text message to a WhatsApp recipient.
    """
    res = whatsapp_service.send_whatsapp_message(
        phone=req.phone,
        message=req.message,
    )
    return res


@router.post("/send-recommendation")
def send_recommendation(
    req: WhatsAppRecommendationRequest,
    authorization: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    """
    Dispatch a structured digital twin recommendation note to a farmer's WhatsApp.
    If phone is not provided, attempts to resolve it from the authenticated user's profile.
    """
    phone = req.phone
    farmer_name = req.farmer_name or "Farmer"

    # Attempt to resolve phone from user profile if not directly provided
    if not phone and authorization and authorization.lower().startswith("bearer "):
        try:
            token = authorization.split(" ", 1)[1].strip()
            settings = get_settings()
            payload = _decode_token(token, settings)
            user_id = payload.get("sub")
            if user_id:
                client = get_supabase_client()
                profile_res = client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
                if profile_res.data and len(profile_res.data) > 0:
                    profile = profile_res.data[0]
                    phone = profile.get("phone") or profile.get("phone_number")
                    if not req.farmer_name or req.farmer_name == "Farmer":
                        farmer_name = profile.get("name") or profile.get("full_name") or farmer_name
        except Exception as exc:
            logger.warning("Could not auto-resolve phone from auth token: %s", exc)

    if not phone:
        return {
            "success": False,
            "status": "missing_phone",
            "error": "Phone number is required. Please provide a phone number or configure your profile in Settings.",
        }

    res = whatsapp_service.send_whatsapp_recommendation(
        phone=phone,
        farmer_name=farmer_name,
        plot_name=req.plot_name or "Plot",
        crop=req.crop or "Oil Palm",
        severity=req.severity or "normal",
        soil_data=req.soil_data,
        fertilizer_plan=req.fertilizer_plan,
        advice=req.advice,
        expected_yield=req.expected_yield,
        custom_message=req.custom_message,
    )
    return res
