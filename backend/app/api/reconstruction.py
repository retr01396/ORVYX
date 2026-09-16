"""
ORVYX Phase 4 — Reconstruction API

Endpoints for X-ray → 3D thoracic anatomical template and reconstruction state.

NOTE: These endpoints provide TEMPLATE anatomy, not patient-specific CT data.
All responses include a disclaimer making this distinction explicit.
"""

import re
from fastapi import APIRouter, HTTPException, status

from app.models.reconstruction import (
    ThoracicTemplate,
    ReconstructionStatusResponse,
)
from app.services.reconstruction_service import get_thoracic_template

router = APIRouter(prefix="/api/reconstruction", tags=["reconstruction"])

# Allowlisted study ID pattern (matches existing Phase 5 upload IDs)
_STUDY_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,64}$")


@router.get("/template", response_model=ThoracicTemplate)
async def get_template():
    """
    Returns the thoracic anatomical template used for X-ray-derived 3D visualization.

    The response includes:
    - A full disclaimer that this is NOT patient-specific CT data
    - All structure definitions with particle weights and formation order
    - X-ray finding → structure mapping for 3D localization
    """
    return get_thoracic_template()


@router.get("/status/{study_id}", response_model=ReconstructionStatusResponse)
async def get_reconstruction_status(study_id: str):
    """
    Returns the current reconstruction phase state for a study.

    The reconstruction pipeline is managed client-side (browser/Three.js).
    This endpoint reflects whether the study's X-ray analysis has completed,
    which is the prerequisite for triggering the 3D visualization.
    """
    if not _STUDY_ID_RE.match(study_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid study_id format",
        )

    # Check whether an X-ray analysis result exists for this study
    try:
        from app.api.xray import STUDY_STATE_CACHE, get_study_registry
        registry = get_study_registry()
        has_analysis = study_id in STUDY_STATE_CACHE
        study_exists = study_id in registry or study_id.startswith("demo-")

        if not study_exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Study '{study_id}' not found",
            )

        if has_analysis:
            return ReconstructionStatusResponse(
                study_id=study_id,
                phase="complete",
                progress=100,
                message="X-ray analysis complete. 3D template reconstruction available.",
            )
        else:
            return ReconstructionStatusResponse(
                study_id=study_id,
                phase="idle",
                progress=0,
                message="Run X-ray analysis first to enable 3D reconstruction.",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reconstruction status error: {str(e)}",
        )


@router.get("/structures/validate/{structure_id}")
async def validate_structure(structure_id: str):
    """
    Validates that a structure ID is known to the template.
    Returns 200 with the structure definition if valid, 404 if unknown.
    Used by smoke tests and the frontend to confirm structure availability.
    """
    from app.services.reconstruction_service import get_structure_by_id
    structure = get_structure_by_id(structure_id)
    if structure is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown thoracic structure: '{structure_id}'",
        )
    return structure
