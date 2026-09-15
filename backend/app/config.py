import os
from pathlib import Path
import torch

# Base paths
APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
ROOT_DIR = BACKEND_DIR.parent
ASSETS_DEMO_DIR = ROOT_DIR / "assets" / "demo"
ASSETS_UPLOADS_DIR = ASSETS_DEMO_DIR / "uploads"
WEIGHTS_CACHE_DIR = BACKEND_DIR / "weights_cache"

# Ensure directories exist
WEIGHTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
ASSETS_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Hardware device detection per Phase 0 empirical validation
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Strictly verified model configuration
CLASSIFIER_WEIGHTS = "densenet121-res224-all"

# Documented 18 default pathologies in exact order (Phase 0 Task 2)
PATHOLOGY_LABELS = [
    'Atelectasis',
    'Consolidation',
    'Infiltration',
    'Pneumothorax',
    'Edema',
    'Emphysema',
    'Fibrosis',
    'Effusion',
    'Pneumonia',
    'Pleural_Thickening',
    'Cardiomegaly',
    'Nodule',
    'Mass',
    'Hernia',
    'Lung Lesion',
    'Fracture',
    'Lung Opacity',
    'Enlarged Cardiomediastinum'
]

# Documented 14 PSPNet anatomical targets in exact order (Phase 0 Task 2)
SEGMENTATION_TARGETS = [
    'Left Clavicle',
    'Right Clavicle',
    'Left Scapula',
    'Right Scapula',
    'Left Lung',
    'Right Lung',
    'Left Hilus Pulmonis',
    'Right Hilus Pulmonis',
    'Heart',
    'Aorta',
    'Facies Diaphragmatica',
    'Mediastinum',
    'Weasand',
    'Spine'
]

# Clinical confidence band thresholds
BAND_LOW_THRESHOLD = 0.30
BAND_ELEVATED_THRESHOLD = 0.60

# Segmentation binarization threshold (logits -> sigmoid -> >= 0.5)
SEGMENTATION_THRESHOLD = 0.50

# Demo asset registry
DEMO_STUDIES = {
    "demo-1": {
        "study_id": "demo-1",
        "title": "Normal Chest Radiograph",
        "filename": "demo-1.png",
        "patient_id": "PT-00000001",
        "view": "PA",
        "modality": "CX",
        "description": "Baseline posteroanterior projection without acute findings."
    },
    "demo-2": {
        "study_id": "demo-2",
        "title": "Abnormal Chest Radiograph (Cardiomegaly / Consolidation)",
        "filename": "demo-2.jpg",
        "patient_id": "PT-00016747",
        "view": "AP",
        "modality": "CX",
        "description": "Anteroposterior projection presenting cardiomegaly and lung opacity."
    }
}
