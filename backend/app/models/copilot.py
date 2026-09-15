from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

class EvidenceItem(BaseModel):
    type: Literal["xray_finding", "ct_structure", "measurement", "segmentation", "metadata"]
    label: str = Field(..., description="Short label for evidence (e.g., 'DenseNet-121 Nodule Probability')")
    value: str = Field(..., description="Evidence value (e.g., '0.6909 (elevated)', '484.1 mL')")
    source: str = Field(..., description="Model, file or preset source")

class FindingAnatomy(BaseModel):
    structure_id: str = Field(..., description="Identifier matching organ structure (e.g. 'heart', 'nodule')")
    label: str = Field(..., description="Human-readable anatomy label")
    modality: Literal["xray", "ct"] = Field(default="ct")
    voxel_centroid: Optional[List[float]] = Field(default=None, description="[X, Y, Z] voxel coordinates for CT")
    physical_centroid: Optional[List[float]] = Field(default=None, description="[X, Y, Z] physical coordinates in mm")
    image_centroid: Optional[List[float]] = Field(default=None, description="[X, Y] pixel coordinates for 2D CXR")

class FindingActions(BaseModel):
    focus_3d: bool = Field(default=False)
    focus_mpr: bool = Field(default=False)
    focus_xray: bool = Field(default=False)

class CoPilotFinding(BaseModel):
    id: str
    title: str
    category: str = Field(default="Pathology", description="Category e.g. Pathology, Anatomy, Metric")
    severity: Literal["high", "moderate", "low", "normal", "indeterminate"]
    confidence: float = Field(..., ge=0.0, le=1.0)
    description: str
    evidence: List[EvidenceItem] = Field(default_factory=list)
    anatomy: Optional[FindingAnatomy] = None
    actions: FindingActions = Field(default_factory=FindingActions)

class CoPilotMeasurement(BaseModel):
    name: str
    value: float
    unit: str
    category: str
    reference_range: Optional[str] = None
    interpretation: Optional[str] = None
    anatomy_id: Optional[str] = None

class CoPilotProvenance(BaseModel):
    mode: Literal["deterministic-demo", "llm-augmented"] = "deterministic-demo"
    provider: str
    generated_at: str
    sources: List[str]

class CoPilotResponse(BaseModel):
    study_id: str
    modality: str
    title: str
    summary: str
    impression: List[str]
    findings: List[CoPilotFinding]
    measurements: List[CoPilotMeasurement]
    limitations: List[str]
    provenance: CoPilotProvenance

class AskRequest(BaseModel):
    study_id: str = Field(default="multimodal")
    question: str
    current_view: Optional[str] = "ct"

class AskResponse(BaseModel):
    question: str
    intent: str
    answer: str
    highlights: List[str] = Field(default_factory=list)
    relevant_finding_ids: List[str] = Field(default_factory=list)
    target_structure_id: Optional[str] = None
    target_view: Optional[Literal["xray", "ct"]] = None
    provenance: CoPilotProvenance
