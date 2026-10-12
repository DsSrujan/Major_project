"""
services/whatsapp_service.py

Client interface to the local WhatsApp Web Node microservice (running on port 5001).
Handles:
- Status / Readiness queries
- Recommendation message formatting
- Sending messages via WhatsApp Web
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional
import httpx

logger = logging.getLogger("nutripalm.whatsapp")

WHATSAPP_SERVICE_URL = os.getenv("WHATSAPP_SERVICE_URL", "http://localhost:5001")


def get_whatsapp_status() -> dict[str, Any]:
    """
    Checks the status of the local whatsapp-web.js microservice.
    Returns status dict, handling disconnected or uninitialized states gracefully.
    """
    try:
        with httpx.Client(timeout=3.0) as client:
            resp = client.get(f"{WHATSAPP_SERVICE_URL}/status")
            if resp.status_code == 200:
                return resp.json()
            return {
                "status": "error",
                "isReady": False,
                "error": f"WhatsApp service returned HTTP {resp.status_code}",
            }
    except Exception as exc:
        logger.warning("WhatsApp microservice unreachable: %s", exc)
        return {
            "status": "service_offline",
            "isReady": False,
            "error": "WhatsApp notification service is offline. Please launch via 'npm run whatsapp'.",
        }


def send_whatsapp_message(phone: str, message: str) -> dict[str, Any]:
    """
    Sends a text message to the given phone number via the WhatsApp service.
    """
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                f"{WHATSAPP_SERVICE_URL}/send",
                json={"phone": phone, "message": message},
            )
            data = resp.json()
            if resp.status_code == 200:
                return data
            return {
                "success": False,
                "status": data.get("status", "failed"),
                "error": data.get("error", f"HTTP {resp.status_code}"),
            }
    except httpx.ConnectError:
        return {
            "success": False,
            "status": "service_offline",
            "error": "WhatsApp service is not running on port 5001. Please run 'npm run whatsapp'.",
        }
    except Exception as exc:
        logger.error("Error sending WhatsApp message: %s", exc)
        return {
            "success": False,
            "status": "failed",
            "error": str(exc),
        }


def send_whatsapp_recommendation(
    phone: str,
    farmer_name: str = "Farmer",
    plot_name: str = "Plot",
    crop: str = "Oil Palm",
    severity: str = "normal",
    soil_data: Optional[dict[str, Any]] = None,
    fertilizer_plan: Optional[list[dict[str, Any]]] = None,
    advice: Optional[str] = None,
    expected_yield: Optional[float] = None,
    custom_message: Optional[str] = None,
) -> dict[str, Any]:
    """
    Sends a formatted recommendation message to a farmer's WhatsApp number.
    """
    payload = {
        "phone": phone,
        "farmerName": farmer_name,
        "plotName": plot_name,
        "crop": crop,
        "severity": severity,
        "soilData": soil_data,
        "fertilizerPlan": fertilizer_plan,
        "advice": advice,
        "expectedYield": expected_yield,
        "customMessage": custom_message,
    }

    try:
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(
                f"{WHATSAPP_SERVICE_URL}/send-recommendation",
                json=payload,
            )
            data = resp.json()
            if resp.status_code == 200:
                return data
            return {
                "success": False,
                "status": data.get("status", "failed"),
                "error": data.get("error", f"HTTP {resp.status_code}"),
            }
    except httpx.ConnectError:
        return {
            "success": False,
            "status": "service_offline",
            "error": "WhatsApp service is not running on port 5001. Please start via 'npm run whatsapp'.",
        }
    except Exception as exc:
        logger.error("Error sending WhatsApp recommendation: %s", exc)
        return {
            "success": False,
            "status": "failed",
            "error": str(exc),
        }
