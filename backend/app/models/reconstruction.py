from __future__ import annotations
from typing import List, Optional, Dict
from pydantic import BaseModel


class ThoracicStructure(BaseModel):
    id: str
    label: str
    group: str            # "Skeleton" | "Soft Tissue"
    color: str            # hex colour for Three.js
    particle_weight: float
    formation_order: int
    ct_derived: bool = False


class ThoracicTemplate(BaseModel):
    label: str = "AI-ESTIMATED THORACIC ANATOMY"
    disclaimer: str = (
        "This 3D model is an anatomical template informed by X-ray AI findings. "
        "It is NOT a patient-specific CT reconstruction. "
        "A single 2D projection cannot produce exact 3D anatomy. "
        "For clinical-grade 3D anatomy, a CT scan is required."
    )
    structures: List[ThoracicStructure]
    finding_map: Dict[str, List[str]]


class ReconstructionStatusResponse(BaseModel):
    study_id: str
    phase: str
    progress: int
    estimated: bool = True
    modality_source: str = "xray"
    message: str = ""


class ProviderInfoResponse(BaseModel):
    provider_mode: str
    provider_name: str
    is_external: bool
    external_warning: Optional[str] = None
    custom_llm_configured: bool = False
    api_configured: bool = False
