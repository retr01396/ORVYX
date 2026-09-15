from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class Centroid(BaseModel):
    x: float = Field(..., description="Horizontal centroid in pixel space")
    y: float = Field(..., description="Vertical centroid in pixel space")

class Finding(BaseModel):
    label: str = Field(..., description="Pathology name from the 18 validated torchxrayvision classes")
    score: float = Field(..., ge=0.0, le=1.0, description="Sigmoid probability in [0, 1]")
    band: str = Field(..., description="Clinical confidence band: low (<0.3), moderate (0.3-0.6), elevated (>0.6)")

class Segment(BaseModel):
    name: str = Field(..., description="Anatomical structure name (14 PSPNet structures)")
    source: str = Field(default="chestx_det-pspnet", description="Segmentation model source")
    centroid: Centroid = Field(..., description="Center of mass coordinates in image pixels")
    area_px: int = Field(..., description="Total count of positive mask pixels")
    mask_base64: str = Field(..., description="Single-channel binary mask encoded as base64 PNG")

class Provenance(BaseModel):
    classifier_model: str = Field(..., description="Model identifier for classification")
    segmentation_model: str = Field(..., description="Model identifier for segmentation")
    version: str = Field(..., description="torchxrayvision library version")
    device: str = Field(..., description="Execution device: mps or cpu")
    runtime_ms: float = Field(..., description="Full end-to-end inference wall-clock runtime in milliseconds")

class StudyState(BaseModel):
    study_id: str = Field(..., description="Unique identifier for the study (e.g. demo-1, demo-2)")
    modality: str = Field(default="CX", description="Imaging modality: CX for 2D chest X-ray, CT for computed tomography")
    source: str = Field(default="demo-asset", description="Origin of the study image: demo-asset or user-upload")
    status: str = Field(default="complete", description="Study processing status: ready, analyzing, complete, error")
    available_modalities: List[str] = Field(default_factory=lambda: ["CX"], description="Modalities available for this study: CX, CT, or both")
    provenance: Provenance = Field(..., description="Model execution metadata and timings")
    findings: List[Finding] = Field(..., description="List of 18 pathology findings sorted descending by score")
    segments: List[Segment] = Field(..., description="List of 14 anatomical segmentation structures")
    measurements: List[Any] = Field(default_factory=list, description="Extensible slot for future cardiothoracic ratio, etc.")
    comparison: Optional[Any] = Field(default=None, description="Extensible slot for prior study comparisons")
    limitations: List[str] = Field(default_factory=list, description="Quality or clinical scope limitations")

class AnalyzeRequest(BaseModel):
    study_id: str = Field(..., description="Identifier of the study to analyze (e.g. demo-1, demo-2, or custom study ID)")

class StudySummary(BaseModel):
    study_id: str
    title: str
    patient_id: str
    view: str
    modality: str
    description: str
    status: str = Field(default="ready", description="Study status: ready, uploading, analyzing, complete, error")
    is_custom: bool = Field(default=False, description="True if uploaded by user, False if verified demo asset")
    available_modalities: List[str] = Field(default_factory=lambda: ["CX"], description="Supported modalities for this study")
    file_size_bytes: Optional[int] = Field(default=None, description="Image file size in bytes")
    created_at: Optional[str] = Field(default=None, description="ISO timestamp of study ingestion")
