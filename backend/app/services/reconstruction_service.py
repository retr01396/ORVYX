"""
ORVYX Phase 4 — Reconstruction Service

Provides thoracic template anatomy data for X-ray-derived 3D visualization.

IMPORTANT DISCLAIMER:
A single 2D chest X-ray does NOT contain enough depth information to produce an
exact patient-specific 3D reconstruction. This service provides a clinically
plausible TEMPLATE anatomy that is informed by AI findings from the X-ray analysis.

The template is based on reference adult thoracic anatomy (population averages)
and is explicitly labeled "AI-ESTIMATED" throughout the application.
"""

import logging
from typing import Dict, List, Optional

from app.models.reconstruction import ThoracicStructure, ThoracicTemplate

logger = logging.getLogger("orvyx.reconstruction")

# ---------------------------------------------------------------------------
# Thoracic structure definitions
# ---------------------------------------------------------------------------

THORACIC_STRUCTURES: List[ThoracicStructure] = [
    ThoracicStructure(
        id="rib_cage",
        label="Rib Cage (12 pairs)",
        group="Skeleton",
        color="#a5c8f0",
        particle_weight=0.35,
        formation_order=1,
        ct_derived=False,
    ),
    ThoracicStructure(
        id="sternum",
        label="Sternum",
        group="Skeleton",
        color="#c8d8f0",
        particle_weight=0.07,
        formation_order=2,
        ct_derived=False,
    ),
    ThoracicStructure(
        id="thoracic_spine",
        label="Thoracic Spine (T1–T12)",
        group="Skeleton",
        color="#b0c4e8",
        particle_weight=0.12,
        formation_order=3,
        ct_derived=False,
    ),
    ThoracicStructure(
        id="clavicles",
        label="Clavicles",
        group="Skeleton",
        color="#d0e4f8",
        particle_weight=0.06,
        formation_order=4,
        ct_derived=False,
    ),
    ThoracicStructure(
        id="scapulae",
        label="Scapulae",
        group="Skeleton",
        color="#b8d0ec",
        particle_weight=0.05,
        formation_order=5,
        ct_derived=False,
    ),
    ThoracicStructure(
        id="lung_left",
        label="Left Lung",
        group="Soft Tissue",
        color="#06b6d4",
        particle_weight=0.10,
        formation_order=6,
        ct_derived=True,
    ),
    ThoracicStructure(
        id="lung_right",
        label="Right Lung",
        group="Soft Tissue",
        color="#0891b2",
        particle_weight=0.10,
        formation_order=6,
        ct_derived=True,
    ),
    ThoracicStructure(
        id="heart",
        label="Heart",
        group="Soft Tissue",
        color="#f43f5e",
        particle_weight=0.09,
        formation_order=7,
        ct_derived=True,
    ),
    ThoracicStructure(
        id="trachea",
        label="Trachea",
        group="Soft Tissue",
        color="#a78bfa",
        particle_weight=0.06,
        formation_order=8,
        ct_derived=True,
    ),
]

# ---------------------------------------------------------------------------
# X-ray finding → 3D structure mapping
# ---------------------------------------------------------------------------

FINDING_TO_STRUCTURE_MAP: Dict[str, List[str]] = {
    "Cardiomegaly":               ["heart"],
    "Enlarged Cardiomediastinum": ["heart", "thoracic_spine"],
    "Effusion":                   ["lung_left", "lung_right"],
    "Pneumothorax":               ["lung_left", "lung_right"],
    "Pneumonia":                  ["lung_left", "lung_right"],
    "Consolidation":              ["lung_left", "lung_right"],
    "Atelectasis":                ["lung_left", "lung_right"],
    "Infiltration":               ["lung_left", "lung_right"],
    "Edema":                      ["lung_left", "lung_right", "heart"],
    "Emphysema":                  ["lung_left", "lung_right"],
    "Fibrosis":                   ["lung_left", "lung_right"],
    "Pleural_Thickening":         ["rib_cage", "lung_left", "lung_right"],
    "Fracture":                   ["rib_cage", "clavicles", "scapulae"],
    "Lung Lesion":                ["lung_left", "lung_right"],
    "Lung Opacity":               ["lung_left", "lung_right"],
    "Nodule":                     ["lung_left", "lung_right"],
    "Mass":                       ["lung_left", "lung_right", "heart"],
    "Hernia":                     ["sternum"],
}


def get_thoracic_template() -> ThoracicTemplate:
    """Return the full thoracic template definition."""
    return ThoracicTemplate(
        structures=THORACIC_STRUCTURES,
        finding_map=FINDING_TO_STRUCTURE_MAP,
    )


def get_structures_for_finding(finding_label: str) -> List[str]:
    """Return structure IDs associated with the given X-ray finding label."""
    return FINDING_TO_STRUCTURE_MAP.get(finding_label, [])


def get_structure_by_id(structure_id: str) -> Optional[ThoracicStructure]:
    for s in THORACIC_STRUCTURES:
        if s.id == structure_id:
            return s
    return None
