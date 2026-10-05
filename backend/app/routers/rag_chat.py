"""
routers/rag_chat.py

FastAPI router for:
1. Diagnostic Explanation Endpoint: POST /api/recommendations/{plot_id}/explain
   Pulls plot soil data, live Open-Meteo weather, and Supabase RAG context to explain
   nutrient deficiency significance and application safety.
2. Dashboard Chat Endpoint: POST /api/chat
   Multi-turn agronomy conversational assistant combining telemetry, weather, and
   Package of Practices vector search.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import requests
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.database import get_supabase_client
from app.services.rag_service import (
    generate_rag_explanation,
    parse_groq_error,
    retrieve_context,
)

logger = logging.getLogger("nutripalm.routers.rag_chat")

router = APIRouter(
    tags=["rag_chat"],
)


# ---------------------------------------------------------------------------
# Pydantic Request & Response Schemas
# ---------------------------------------------------------------------------

class DiagnosticExplainRequest(BaseModel):
    nutrient: Optional[str] = Field(None, description="Nutrient key, e.g. 'nitrogen', 'ph', 'zinc'.")
    nutrient_label: Optional[str] = Field(None, description="Human readable nutrient label.")
    current_value: Optional[float] = Field(None, description="Current measured soil value.")
    unit: Optional[str] = Field(None, description="Measurement unit (e.g. 'kg/ha', 'pH', 'mg/kg').")
    crop: Optional[str] = Field(None, description="Crop name (e.g. 'Oil Palm', 'Arecanut', 'Coconut').")
    soil_report_id: Optional[str] = Field(None, description="Optional associated soil report ID.")
    is_baseline: Optional[bool] = Field(None, description="True if no laboratory soil report is attached (baseline calibration mode).")


class DiagnosticExplainResponse(BaseModel):
    success: bool
    plot_id: str
    nutrient: Optional[str] = None
    explanation: Optional[str] = None
    weather_summary: Optional[str] = None
    pop_message: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    context_retrieved: bool = False
    is_baseline: bool = False


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user', 'assistant', or 'system'")
    content: str = Field(..., description="Message text")


class ChatRequest(BaseModel):
    plot_id: Optional[str] = Field(None, description="Current selected plot ID")
    message: str = Field(..., description="User's query")
    crop: Optional[str] = Field(None, description="Crop type")
    history: Optional[list[ChatMessage]] = Field(default_factory=list, description="Past conversation history")


class ChatResponse(BaseModel):
    success: bool
    response: Optional[str] = None
    pop_message: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    context_retrieved: bool = False


# ---------------------------------------------------------------------------
# Helper: Fetch Live Open-Meteo Weather with Fallback
# ---------------------------------------------------------------------------

def fetch_live_weather(lat: Optional[float] = None, lon: Optional[float] = None) -> str:
    """
    Fetches real-time weather and 3-day precipitation forecast from Open-Meteo (100% free).
    Gracefully falls back to localized climatology if coordinates are absent or network fails.
    """
    latitude = lat if lat is not None else 12.9716  # Default: Karnataka / South India coordinate
    longitude = lon if lon is not None else 77.5946

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code",
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Asia/Kolkata",
        "forecast_days": 3,
    }

    try:
        resp = requests.get(url, params=params, timeout=5)
        resp.raise_for_status()
        data = resp.json()

        curr = data.get("current", {})
        temp = curr.get("temperature_2m", 28.0)
        humidity = curr.get("relative_humidity_2m", 70.0)
        precip_now = curr.get("precipitation", 0.0)

        daily = data.get("daily", {})
        precip_days = daily.get("precipitation_sum", [0.0, 0.0, 0.0])
        total_forecast_rain = sum(precip_days[:3])

        weather_desc = (
            f"Current Temp: {temp}°C, Humidity: {humidity}%, Current Rain: {precip_now} mm. "
            f"3-Day Forecasted Rainfall: {total_forecast_rain:.1f} mm."
        )

        if total_forecast_rain > 25.0:
            weather_desc += " [WARNING: Heavy rainfall forecasted within 72h. Avoid immediate broadcast fertilization to prevent nutrient leaching.]"
        elif total_forecast_rain > 5.0:
            weather_desc += " [NOTE: Moderate showers forecasted. Ideal moisture for basal incorporation, but avoid surface runoff.]"
        else:
            weather_desc += " [NOTE: Dry weather window. Ensure irrigation follows fertilizer application.]"

        return weather_desc

    except Exception as exc:
        logger.warning(f"Open-Meteo weather fetch failed: {exc}. Using standard advisory fallback.")
        return (
            "Current Temp: 30°C, Humidity: 65%. 3-Day Forecast: Moderate showers expected. "
            "Ensure fertilizers are incorporated into the root zone before heavy rainfall."
        )


# ---------------------------------------------------------------------------
# Helper: Fetch Plot & Soil Telemetry from Supabase
# ---------------------------------------------------------------------------

def get_plot_and_soil_context(
    plot_id: str,
    soil_report_id: Optional[str] = None,
    crop_hint: Optional[str] = None,
) -> tuple[dict[str, Any], Optional[tuple[float, float]]]:
    """
    Attempts to read plot details & latest soil report from Supabase.
    Returns (telemetry_dict, (lat, lon) or None).
    """
    coords = None
    telemetry: dict[str, Any] = {
        "plot_id": plot_id,
        "crop": crop_hint or "Oil Palm",
        "has_soil_report": False,
    }

    try:
        client = get_supabase_client()
        # 1. Fetch plot
        if not plot_id.startswith("plot-"):
            plot_res = (
                client.table("plots")
                .select("id, name, crop, area, area_unit, latitude, longitude")
                .eq("id", plot_id)
                .maybe_single()
                .execute()
            )
            plot_row = getattr(plot_res, "data", None)
            if plot_row:
                telemetry["crop"] = plot_row.get("crop") or telemetry["crop"]
                telemetry["plot_name"] = plot_row.get("name", plot_id)
                telemetry["area"] = f"{plot_row.get('area', 5)} {plot_row.get('area_unit', 'acres')}"
                lat = plot_row.get("latitude")
                lon = plot_row.get("longitude")
                if lat is not None and lon is not None:
                    coords = (float(lat), float(lon))

        # 2. Fetch soil report
        query = client.table("soil_reports").select("*")
        if soil_report_id and not soil_report_id.startswith("sr-"):
            query = query.eq("id", soil_report_id)
        elif not plot_id.startswith("plot-"):
            query = query.eq("plot_id", plot_id).order("created_at", { "ascending": False }).limit(1)
        else:
            query = None

        if query:
            soil_res = query.maybe_single().execute()
            soil_row = getattr(soil_res, "data", None)
            if soil_row:
                telemetry["has_soil_report"] = True
                telemetry["nitrogen_kg_ha"] = soil_row.get("nitrogen_kg_ha")
                telemetry["phosphorus_kg_ha"] = soil_row.get("phosphorus_kg_ha")
                telemetry["potassium_kg_ha"] = soil_row.get("potassium_kg_ha")
                telemetry["ph"] = soil_row.get("ph")
                telemetry["organic_carbon_percent"] = soil_row.get("organic_carbon_percent")
                telemetry["electrical_conductivity"] = soil_row.get("electrical_conductivity")

    except Exception as exc:
        logger.warning(f"Could not load plot telemetry from Supabase: {exc}")

    return telemetry, coords


# ---------------------------------------------------------------------------
# Endpoint 1: POST /api/recommendations/{plot_id}/explain
# ---------------------------------------------------------------------------

@router.post(
    "/api/recommendations/{plot_id}/explain",
    response_model=DiagnosticExplainResponse,
    status_code=status.HTTP_200_OK,
)
def explain_diagnostic_parameter(
    plot_id: str,
    request: DiagnosticExplainRequest,
) -> DiagnosticExplainResponse:
    """
    RAG-powered diagnostic explainer for a specific nutrient or soil parameter card.
    Fetches KAU Package of Practices agronomic context, combines with live Open-Meteo weather,
    and returns a clean, structured advisory from Groq (Llama 3).
    When no lab report is attached, provides standard regional baseline calibration guidance.
    """
    crop = request.crop or "Oil Palm"
    nutrient = request.nutrient or "general"
    nutrient_label = request.nutrient_label or nutrient.capitalize()
    curr_val = f"{request.current_value} {request.unit}" if request.current_value is not None else "Not specified"

    # 1. Fetch plot telemetry and weather
    telemetry, coords = get_plot_and_soil_context(
        plot_id=plot_id,
        soil_report_id=request.soil_report_id,
        crop_hint=crop,
    )
    crop = telemetry.get("crop", crop)
    lat, lon = coords if coords else (None, None)
    weather_summary = fetch_live_weather(lat, lon)

    # Determine whether plot is running under baseline calibration (no lab report attached)
    is_baseline = request.is_baseline
    if is_baseline is None:
        is_baseline = not (bool(request.soil_report_id) or telemetry.get("has_soil_report", False))

    # 2. Retrieve Agronomy Knowledge Base context & construct structured prompt
    if is_baseline:
        rag_query = f"{crop} {nutrient_label} standard agronomic baseline requirement package of practices maintenance dosage"
        context, context_ok, context_err = retrieve_context(rag_query, match_threshold=0.3, match_count=2)

        system_prompt = (
            "You are NutriPalm-AI, a senior agronomist specializing in South Indian plantation and field crops.\n"
            "The farm plot currently has NO laboratory soil report attached, so it is operating under the "
            "standard regional agronomic baseline calibration (Package of Practices).\n\n"
            "CRITICAL INSTRUCTIONS:\n"
            "- Clearly explain the standard regional baseline benchmark for this nutrient and why it is essential.\n"
            "- Do NOT diagnose a laboratory deficiency, and do NOT claim the soil has a measured defect or emergency.\n"
            "- Clarify that the soil parameters are currently calibrated to the optimal healthy regional baseline.\n"
            "- Provide standard routine maintenance guidelines, basal application, or organic mulching practices "
            "per the KAU / ICAR Package of Practices to sustain baseline vigor.\n"
            "- Provide weather-smart application timing based on current rainfall & weather conditions.\n\n"
            "Format your response with clean markdown:\n"
            "### 🔬 Agronomic Significance\n"
            "(Explain physiological role and importance of this nutrient for this crop)\n\n"
            "### 📊 Standard Regional Baseline\n"
            "(Explain the standard healthy benchmark level and optimal target range for this crop under regional baseline calibration. Emphasize that the parameter is calibrated to optimal baseline status with no acute deficiency detected.)\n\n"
            "### 🌿 Standard Maintenance & Basal Management\n"
            "(Outline routine seasonal maintenance, pre-monsoon basal recommendations, or organic soil conditioning per KAU / ICAR Package of Practices to sustain healthy baseline levels)\n\n"
            "### ⛅ Weather-Smart Application Timing\n"
            "(Timing guidance based on current rainfall & weather conditions)\n\n"
            "Keep language practical, encouraging, and clear."
        )

        user_prompt = (
            f"Plot ID: {plot_id}\n"
            f"Crop: {crop}\n"
            f"Target Parameter: {nutrient_label} ({nutrient})\n"
            f"Agronomic Mode: Standard Regional Baseline Calibration (No laboratory soil report attached)\n"
            f"Regional Baseline Target: {curr_val}\n"
            f"Live Weather Telemetry: {weather_summary}\n\n"
            f"Package of Practices Guidelines:\n{context}\n\n"
            f"Please provide the agronomic explanation and standard regional baseline guidance for {nutrient_label}."
        )
    else:
        rag_query = f"{crop} {nutrient_label} soil requirement fertilizer dosage application timing"
        context, context_ok, context_err = retrieve_context(rag_query, match_threshold=0.3, match_count=2)

        system_prompt = (
            "You are NutriPalm-AI, a senior agronomist specializing in South Indian plantation and field crops.\n"
            "Provide a concise, professional, and farmer-friendly explanation breaking down why this specific "
            "soil parameter is critical for the crop, what the measured value implies, and weather-smart action steps.\n\n"
            "Format your response with clean markdown:\n"
            "### 🔬 Agronomic Significance\n"
            "(Explain physiological role of this nutrient for this crop)\n\n"
            "### 📊 Status & Impact on Yield\n"
            "(Explain what the measured value means and the risk if uncorrected)\n\n"
            "### 🌿 Recommended Corrective Application\n"
            "(Specific commercial fertilizer product, split dosage, or conditioning advice)\n\n"
            "### ⛅ Weather-Smart Application Timing\n"
            "(Timing guidance based on current rainfall & weather conditions)\n\n"
            "Keep language practical and clear. Do not contradict deterministic calculations."
        )

        user_prompt = (
            f"Plot ID: {plot_id}\n"
            f"Crop: {crop}\n"
            f"Target Parameter: {nutrient_label} ({nutrient})\n"
            f"Measured Value: {curr_val}\n"
            f"Live Weather Telemetry: {weather_summary}\n\n"
            f"Package of Practices Guidelines:\n{context}\n\n"
            f"Please provide the agronomic explanation and advice for {nutrient_label}."
        )

    settings = get_settings()
    groq_api_key = settings.groq_api_key

    if not groq_api_key or not groq_api_key.strip():
        pop_msg = (
            "Groq response failed: GROQ_API_KEY is not configured in backend/.env. "
            "Please add your free Groq API key."
        )
        return DiagnosticExplainResponse(
            success=False,
            plot_id=plot_id,
            nutrient=nutrient,
            pop_message=pop_msg,
            weather_summary=weather_summary,
            error="Missing GROQ_API_KEY",
            error_code="GROQ_KEY_MISSING",
            context_retrieved=context_ok,
            is_baseline=is_baseline,
        )

    headers = {
        "Authorization": f"Bearer {groq_api_key.strip()}",
        "Content-Type": "application/json",
    }

    configured_model = getattr(settings, "groq_model", "openai/gpt-oss-120b") or "openai/gpt-oss-120b"
    candidate_models = [configured_model, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    seen = set()
    unique_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

    last_resp = None
    explanation_md = None

    for model_name in unique_models:
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.25,
            "max_tokens": 850,
        }

        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=15,
            )
            last_resp = resp
            if resp.status_code == 200:
                data = resp.json()
                explanation_md = data["choices"][0]["message"]["content"]
                break
            elif resp.status_code in {400, 404}:
                logger.warning(f"Groq model '{model_name}' returned status {resp.status_code}. Trying fallback model...")
                continue
            else:
                break
        except requests.exceptions.RequestException as req_err:
            logger.warning(f"Request failed for model '{model_name}': {req_err}")
            continue

    if explanation_md:
        return DiagnosticExplainResponse(
            success=True,
            plot_id=plot_id,
            nutrient=nutrient,
            explanation=explanation_md,
            weather_summary=weather_summary,
            context_retrieved=context_ok,
            is_baseline=is_baseline,
        )

    if last_resp is not None:
        pop_msg, err_detail, err_code = parse_groq_error(last_resp.status_code, last_resp.text)
        logger.warning("Groq diagnostic explanation failed [%d]: %s", last_resp.status_code, err_detail)
        return DiagnosticExplainResponse(
            success=False,
            plot_id=plot_id,
            nutrient=nutrient,
            pop_message=pop_msg,
            weather_summary=weather_summary,
            error=err_detail,
            error_code=err_code,
            context_retrieved=context_ok,
            is_baseline=is_baseline,
        )
    return DiagnosticExplainResponse(
        success=False,
        plot_id=plot_id,
        nutrient=nutrient,
        pop_message="Groq response failed: Unable to connect to Groq AI servers.",
        weather_summary=weather_summary,
        error="All candidate models failed to return a response.",
        error_code="GROQ_CONNECTION_ERROR",
        context_retrieved=context_ok,
        is_baseline=is_baseline,
    )


# ---------------------------------------------------------------------------
# Endpoint 2: POST /api/chat
# ---------------------------------------------------------------------------

@router.post(
    "/api/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
)
def dashboard_chat(request: ChatRequest) -> ChatResponse:
    """
    Dashboard agronomy conversational assistant.
    Accepts user question, queries vector database for relevant agronomy context,
    combines plot telemetry & live weather, and returns Groq Llama 3 response.
    """
    plot_id = request.plot_id or "default"
    crop = request.crop or "Oil Palm"

    # 1. Fetch plot & weather
    telemetry, coords = get_plot_and_soil_context(plot_id=plot_id, crop_hint=crop)
    crop = telemetry.get("crop", crop)
    lat, lon = coords if coords else (None, None)
    weather_summary = fetch_live_weather(lat, lon)

    # 2. Retrieve Agronomy Knowledge Base context for the user question
    rag_query = f"{crop} {request.message}"
    context, context_ok, _ = retrieve_context(rag_query, match_threshold=0.28, match_count=2)

    # 3. Build Conversation Messages
    system_prompt = (
        "You are NutriPalm-AI, an expert agricultural advisor specializing in South Indian crops "
        "(such as Oil Palm, Arecanut, Coconut, Rubber, Rice, Cardamom, Pepper, etc.).\n"
        "You help farmers and estate managers understand soil health, fertilizer scheduling, chemical mixing "
        "compatibility (e.g. Urea + SSP vs MOP), and weather-smart application windows.\n\n"
        f"Active Plot Context: Plot ID: {plot_id}, Crop: {crop}\n"
        f"Live Weather Status: {weather_summary}\n\n"
        f"Agronomy Guidelines:\n{context}\n\n"
        "Guidelines:\n"
        "- Give direct, actionable, practical agronomic advice.\n"
        "- Highlight safety warnings (e.g. do not mix lime with ammonium fertilizers, avoid application before heavy rain).\n"
        "- Keep responses concise, organized with bullet points, and friendly."
    )

    messages = [{"role": "system", "content": system_prompt}]

    # Append recent conversation history (up to last 6 turns to conserve free tokens)
    if request.history:
        for turn in request.history[-6:]:
            if turn.role in {"user", "assistant"}:
                messages.append({"role": turn.role, "content": turn.content})

    # Append current message
    messages.append({"role": "user", "content": request.message})

    settings = get_settings()
    groq_api_key = settings.groq_api_key

    if not groq_api_key or not groq_api_key.strip():
        pop_msg = (
            "Groq response failed: GROQ_API_KEY is not configured in backend/.env. "
            "Please configure your free Groq API key."
        )
        return ChatResponse(
            success=False,
            pop_message=pop_msg,
            error="Missing GROQ_API_KEY",
            error_code="GROQ_KEY_MISSING",
        )

    headers = {
        "Authorization": f"Bearer {groq_api_key.strip()}",
        "Content-Type": "application/json",
    }

    configured_model = getattr(settings, "groq_model", "openai/gpt-oss-120b") or "openai/gpt-oss-120b"
    candidate_models = [configured_model, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    seen = set()
    unique_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

    last_resp = None
    reply = None

    for model_name in unique_models:
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": 0.35,
            "max_tokens": 700,
        }

        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=15,
            )
            last_resp = resp
            if resp.status_code == 200:
                data = resp.json()
                reply = data["choices"][0]["message"]["content"]
                break
            elif resp.status_code in {400, 404}:
                logger.warning(f"Groq chat model '{model_name}' returned status {resp.status_code}. Trying fallback model...")
                continue
            else:
                break
        except requests.exceptions.RequestException as req_err:
            logger.warning(f"Chat request failed for model '{model_name}': {req_err}")
            continue

    if reply:
        return ChatResponse(
            success=True,
            response=reply,
            context_retrieved=context_ok,
        )

    if last_resp is not None:
        pop_msg, err_detail, err_code = parse_groq_error(last_resp.status_code, last_resp.text)
        logger.warning("Groq chat failed [%d]: %s", last_resp.status_code, err_detail)
        return ChatResponse(
            success=False,
            pop_message=pop_msg,
            error=err_detail,
            error_code=err_code,
            context_retrieved=context_ok,
        )
    return ChatResponse(
        success=False,
        pop_message="Groq response failed: Unable to connect to Groq AI servers.",
        error="All candidate models failed to return a response.",
        error_code="GROQ_CONNECTION_ERROR",
        context_retrieved=context_ok,
    )
