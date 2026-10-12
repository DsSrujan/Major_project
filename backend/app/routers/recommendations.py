"""
routers/recommendations.py

POST /api/recommendations
    Generate + persist a recommendation.

GET /api/recommendations
    List the caller's own recommendations.

GET /api/recommendations/{id}
    Fetch one of the caller's own recommendations.

Every endpoint requires a verified Supabase auth token.
owner_id is never taken from client input.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.database import get_supabase_client
from app.dependencies import AuthenticatedUser, get_current_user
from app.exceptions import (
    NotAuthorized,
    PlotNotFound,
    RecommendationNotFound,
    RepositoryNotConfigured,
    SoilReportNotFound,
    UnsupportedCrop,
    ValidationFailed,
)
from app.repositories.plot_repository import (
    PlotRepository,
    get_plot_repository,
)
from app.repositories.recommendation_repository import (
    RecommendationRepository,
    get_recommendation_repository,
)
from app.repositories.soil_report_repository import (
    SoilReportRepository,
    get_soil_report_repository,
)
from app.schemas.api import (
    RecommendationRecordOut,
    RecommendationRequest,
    RecommendationResponse,
    row_to_record,
    to_response,
)
from app.services import recommendation_service, whatsapp_service

logger = logging.getLogger("nutripalm.recommendations")

router = APIRouter(
    prefix="/api/recommendations",
    tags=["recommendations"],
)


@router.post(
    "",
    response_model=RecommendationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_recommendation(
    request: RecommendationRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    plot_repo: PlotRepository = Depends(get_plot_repository),
    soil_repo: SoilReportRepository = Depends(get_soil_report_repository),
    rec_repo: RecommendationRepository = Depends(
        get_recommendation_repository
    ),
) -> RecommendationResponse:

    # ---------------------------------------------------------
    # Fetch plot
    # ---------------------------------------------------------
    try:
        plot = plot_repo.get_plot(request.plot_id)
    except PlotNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plot not found.",
        ) from exc
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Plot data source is not yet configured "
                "(BLOCKED BY TEAMMATE CONTRACT - see "
                "integration_contract.md)."
            ),
        ) from exc

    # ---------------------------------------------------------
    # Verify plot ownership
    # ---------------------------------------------------------
    if plot.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plot not found.",
        )

    # ---------------------------------------------------------
    # Fetch soil report
    # ---------------------------------------------------------
    try:
        soil = soil_repo.get_soil_report(
            request.soil_report_id
        )
    except SoilReportNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Soil report not found.",
        )
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Soil report data source is not yet configured "
                "(BLOCKED BY TEAMMATE CONTRACT - see "
                "integration_contract.md)."
            ),
        ) from exc

    # ---------------------------------------------------------
    # Verify soil report ownership
    # ---------------------------------------------------------
    if soil.owner_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Soil report not found.",
        )

    # ---------------------------------------------------------
    # Verify soil report belongs to selected plot
    # ---------------------------------------------------------
    if soil.plot_id != plot.plot_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Soil report not found.",
        )

    # ---------------------------------------------------------
    # Build recommendation
    # ---------------------------------------------------------
    try:
        result = recommendation_service.build_recommendation(
            plot,
            soil,
            crop_price_per_ton_inr=request.crop_price_per_ton_inr,
            fertilizer_price_overrides=(
                request.fertilizer_price_overrides
            ),
        )
    except UnsupportedCrop as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except ValidationFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    # ---------------------------------------------------------
    # Persist recommendation
    # ---------------------------------------------------------
    try:
        saved_row = rec_repo.save(result)
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recommendation database is not configured.",
        ) from exc

    logger.info(
        "recommendation.created",
        extra={
            "owner_id": current_user.user_id,
            "plot_id": plot.plot_id,
            "crop": plot.crop,
            "dosages_count": len(result.dosage_plan.dosages),
            "recommendation_id": saved_row.get("id"),
        },
    )




    return to_response(
        result,
        recommendation_id=saved_row.get("id"),
        status=saved_row.get("status", "generated"),
        created_at=saved_row.get("created_at"),
    )



@router.get(
    "",
    response_model=list[RecommendationRecordOut],
)
def list_recommendations(
    current_user: AuthenticatedUser = Depends(get_current_user),
    rec_repo: RecommendationRepository = Depends(
        get_recommendation_repository
    ),
) -> list[RecommendationRecordOut]:

    try:
        rows = rec_repo.list_for_owner(
            current_user.user_id
        )
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recommendation database is not configured.",
        ) from exc

    return [
        row_to_record(row)
        for row in rows
    ]


@router.get(
    "/{recommendation_id}",
    response_model=RecommendationRecordOut,
)
def get_recommendation(
    recommendation_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    rec_repo: RecommendationRepository = Depends(
        get_recommendation_repository
    ),
) -> RecommendationRecordOut:

    try:
        row = rec_repo.get_for_owner(
            recommendation_id,
            current_user.user_id,
        )
    except (RecommendationNotFound, NotAuthorized) as exc:
        # Use one fixed response for both missing and unauthorized
        # recommendations so ownership cannot be probed.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recommendation not found.",
        ) from exc
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recommendation database is not configured.",
        ) from exc

    return row_to_record(row)


class WhatsAppDispatchByRecIdRequest(BaseModel):
    phone_override: Optional[str] = None
    custom_message: Optional[str] = None


@router.post(
    "/{recommendation_id}/whatsapp",
    tags=["recommendations", "whatsapp"],
)
def dispatch_recommendation_whatsapp(
    recommendation_id: str,
    body: Optional[WhatsAppDispatchByRecIdRequest] = None,
    current_user: AuthenticatedUser = Depends(get_current_user),
    rec_repo: RecommendationRepository = Depends(
        get_recommendation_repository
    ),
    plot_repo: PlotRepository = Depends(get_plot_repository),
) -> dict[str, Any]:
    """
    Retrieves the specified recommendation, looks up the user's phone number
    from their profile, formats key crop status values and urgent advice,
    and dispatches it via the WhatsApp service.
    """
    # 1. Fetch recommendation
    try:
        row = rec_repo.get_for_owner(
            recommendation_id,
            current_user.user_id,
        )
    except (RecommendationNotFound, NotAuthorized) as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recommendation not found.",
        ) from exc
    except RepositoryNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recommendation database is not configured.",
        ) from exc

    # 2. Fetch plot details if available
    plot_name = "Plot"
    crop = row.get("crop", "Oil Palm")
    plot_id = row.get("plot_id")
    if plot_id:
        try:
            plot = plot_repo.get_plot(plot_id)
            if plot:
                plot_name = plot.name
                crop = plot.crop
        except Exception:
            pass

    # 3. Retrieve user profile from Supabase
    phone = body.phone_override if body and body.phone_override else None
    farmer_name = "Farmer"
    try:
        client = get_supabase_client()
        res = client.table("profiles").select("*").eq("id", current_user.user_id).limit(1).execute()
        if res.data and len(res.data) > 0:
            profile = res.data[0]
            if not phone:
                phone = profile.get("phone") or profile.get("phone_number")
            farmer_name = profile.get("name") or profile.get("full_name") or "Farmer"
    except Exception as exc:
        logger.warning("Could not query user profile: %s", exc)

    if not phone:
        return {
            "success": False,
            "status": "missing_phone",
            "error": "No phone number found in user profile. Please update your profile in Settings or during login.",
        }

    # 4. Extract diagnostic and advice fields from recommendation row
    findings = row.get("deficiencies") or []
    fertilizer_plan = row.get("fertilizer_plan") or []
    yield_pred = row.get("yield_prediction") or {}
    expected_yield = yield_pred.get("expected_yield_t_ha") or yield_pred.get("expected_yield")

    severity = "normal"
    if any(f.get("status") in ("critical", "deficient") for f in findings if isinstance(f, dict)):
        severity = "critical"
    elif any(f.get("status") == "warning" for f in findings if isinstance(f, dict)):
        severity = "warning"

    advice = None
    explanation = row.get("explanation")
    if isinstance(explanation, dict):
        advice = explanation.get("summary")
    elif isinstance(explanation, str):
        advice = explanation

    custom_msg = body.custom_message if body else None

    # 5. Dispatch via WhatsApp service
    result = whatsapp_service.send_whatsapp_recommendation(
        phone=phone,
        farmer_name=farmer_name,
        plot_name=plot_name,
        crop=crop,
        severity=severity,
        fertilizer_plan=fertilizer_plan,
        advice=advice,
        expected_yield=expected_yield,
        custom_message=custom_msg,
    )
    return result
