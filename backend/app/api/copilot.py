import os
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.models.copilot import CoPilotResponse, AskRequest, AskResponse
from app.models.reconstruction import ProviderInfoResponse
from app.services.copilot_service import copilot_manager
from app.config import ASSETS_DEMO_DIR
from app.services.preprocess import preprocess_xray_image
from app.services.inference import model_manager

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class ContextRequest(BaseModel):
    study_id: str = "multimodal"
    xray_study_id: Optional[str] = None


def _get_xray_data(study_id: str) -> Optional[dict]:
    """Retrieves analyzed X-ray state from memory cache or runs inference on demand."""
    try:
        from app.api.xray import STUDY_STATE_CACHE, get_study_registry
        if study_id in STUDY_STATE_CACHE:
            return STUDY_STATE_CACHE[study_id].model_dump()

        registry = get_study_registry()
        if study_id not in registry:
            return None

        entry = registry[study_id]
        image_path = entry.get("file_path") or (ASSETS_DEMO_DIR / entry["filename"])
        if not image_path.exists():
            return None

        tensor = preprocess_xray_image(image_path)
        state = model_manager.run_inference(tensor, study_id)
        STUDY_STATE_CACHE[study_id] = state
        return state.model_dump()
    except Exception:
        return None


@router.get("/study/{study_id}", response_model=CoPilotResponse)
async def get_study_copilot(study_id: str):
    """
    Generates structured AI Co-Pilot synthesis for the requested study.
    Supports 'demo-1', 'demo-2', 'ct-chest-1', 'multimodal', or custom uploaded study IDs.
    """
    try:
        xray_data = None
        if study_id != "ct-chest-1":
            target_xray = "demo-1" if study_id == "multimodal" else study_id
            xray_data = _get_xray_data(target_xray)
        return copilot_manager.get_copilot_response(study_id=study_id, xray_data=xray_data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate Co-Pilot response: {str(e)}",
        )


@router.post("/context", response_model=CoPilotResponse)
async def get_copilot_context(request: ContextRequest):
    """
    Generates unified multimodal Co-Pilot context linking active X-Ray and CT state.
    """
    try:
        target_study = request.xray_study_id or (
            "demo-1" if request.study_id == "multimodal" else request.study_id
        )
        xray_data = None
        if target_study and target_study != "ct-chest-1":
            xray_data = _get_xray_data(target_study)
        return copilot_manager.get_copilot_response(
            study_id=request.study_id, xray_data=xray_data
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Co-Pilot context error: {str(e)}",
        )


@router.post("/ask", response_model=AskResponse)
async def ask_copilot(request: AskRequest):
    """
    Answers natural language clinical queries with evidence citations,
    quantitative values, and interactive navigation targets.
    """
    try:
        target_study = "demo-1" if request.study_id == "multimodal" else request.study_id
        xray_data = None
        if target_study and target_study != "ct-chest-1":
            xray_data = _get_xray_data(target_study)
        context = copilot_manager.get_copilot_response(
            study_id=request.study_id, xray_data=xray_data
        )
        return copilot_manager.answer_question(request=request, context=context)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process inquiry: {str(e)}",
        )


@router.get("/provider-info", response_model=ProviderInfoResponse)
async def get_provider_info():
    """
    Returns Co-Pilot provider metadata.
    Does NOT expose API keys or secrets — only mode name and configuration status.
    """
    mode = copilot_manager.active_provider_mode
    is_external = mode == "api"
    return ProviderInfoResponse(
        provider_mode=mode,
        provider_name=copilot_manager.active_provider_name,
        is_external=is_external,
        external_warning=(
            "⚠ External API mode: anonymized study context is sent to an external server. "
            "No patient-identifiable data is included."
        ) if is_external else None,
        custom_llm_configured=bool(os.getenv("CUSTOM_LLM_BASE_URL", "")),
        api_configured=bool(os.getenv("AI_API_KEY", "")),
    )
