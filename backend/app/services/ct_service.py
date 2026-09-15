import io
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from PIL import Image
import numpy as np
import SimpleITK as sitk

from app.config import ROOT_DIR

logger = logging.getLogger("orvyx.ct_service")

ASSETS_CT_DIR = ROOT_DIR / "assets" / "demo" / "ct"
CT_FILE = ASSETS_CT_DIR / "CT-chest.nrrd"
MASKS_DIR = ASSETS_CT_DIR / "masks"
MESHES_DIR = ASSETS_CT_DIR / "meshes"

# Verified Window Presets from Phase 0 Evidence
WINDOW_PRESETS = {
    "lung": {
        "name": "Lung",
        "width": 1500,
        "level": -600,
        "min_hu": -1350,
        "max_hu": 150,
        "description": "High contrast for pulmonary parenchyma and airway markings"
    },
    "mediastinum": {
        "name": "Mediastinum",
        "width": 350,
        "level": 40,
        "min_hu": -135,
        "max_hu": 215,
        "description": "Soft-tissue contrast for heart, aorta, and mediastinal structures"
    }
}

ORGAN_LABELS = {
    "heart": "Heart",
    "aorta": "Aorta",
    "trachea": "Trachea",
    "lung_upper_lobe_right": "Right Upper Lobe",
    "lung_middle_lobe_right": "Right Middle Lobe",
    "lung_lower_lobe_right": "Right Lower Lobe",
    "lung_upper_lobe_left": "Left Upper Lobe",
    "lung_lower_lobe_left": "Left Lower Lobe"
}

ORGAN_COLORS = {
    "heart": "#f43f5e",
    "aorta": "#fb7185",
    "trachea": "#38bdf8",
    "lung_upper_lobe_right": "#0ea5e9",
    "lung_middle_lobe_right": "#06b6d4",
    "lung_lower_lobe_right": "#14b8a6",
    "lung_upper_lobe_left": "#2dd4bf",
    "lung_lower_lobe_left": "#10b981"
}

class CTVolumeManager:
    """
    In-memory CT volume and segmentation manager for high-speed MPR and 3D delivery.
    Loads once upon application startup or first query.
    """
    def __init__(self):
        self.volume: Optional[np.ndarray] = None
        self.masks: Dict[str, np.ndarray] = {}
        self.metadata: Dict[str, Any] = {}
        self.aspect_ratio_z: float = 1.0
        self.is_loaded: bool = False

    def load_ct_data(self):
        if self.is_loaded:
            return

        logger.info(f"Loading verified CT dataset from {CT_FILE}...")
        if not CT_FILE.exists():
            raise FileNotFoundError(f"CT volume asset missing at {CT_FILE}")

        img = sitk.ReadImage(str(CT_FILE))
        self.volume = sitk.GetArrayFromImage(img) # shape (Z, Y, X) = (139, 512, 512)
        
        origin = img.GetOrigin()
        spacing = img.GetSpacing()
        size = img.GetSize()
        direction = img.GetDirection()

        # Physical aspect ratio of Z slices relative to in-plane X/Y pixels
        self.aspect_ratio_z = float(spacing[2] / spacing[0]) # 2.5 / 0.761718988 ~ 3.282

        self.metadata = {
            "study_id": "ct-chest-1",
            "modality": "CT",
            "title": "Chest CT (Non-Contrast Axial Volume)",
            "patient_id": "PT-CT-001",
            "dimensions": {
                "x": int(size[0]),
                "y": int(size[1]),
                "z": int(size[2])
            },
            "spacing": {
                "x": round(float(spacing[0]), 4),
                "y": round(float(spacing[1]), 4),
                "z": round(float(spacing[2]), 4)
            },
            "origin": {
                "x": round(float(origin[0]), 2),
                "y": round(float(origin[1]), 2),
                "z": round(float(origin[2]), 2)
            },
            "direction": [round(float(d), 2) for d in direction],
            "intensity_range": {
                "min": int(np.min(self.volume)),
                "max": int(np.max(self.volume)),
                "mean": round(float(np.mean(self.volume)), 1)
            },
            "window_presets": WINDOW_PRESETS
        }

        logger.info(f"Loading 8 precomputed TotalSegmentator masks from {MASKS_DIR}...")
        for organ_id in ORGAN_LABELS:
            mask_path = MASKS_DIR / f"{organ_id}.nii.gz"
            if mask_path.exists():
                m_img = sitk.ReadImage(str(mask_path))
                self.masks[organ_id] = sitk.GetArrayFromImage(m_img) # (139, 512, 512) uint8
            else:
                logger.warning(f"Mask file {mask_path} not found")

        self.is_loaded = True
        logger.info("CT Volume and Segmentation masks ready in memory.")

    def get_slice_png(self, plane: str, index: int, window_preset: str = "lung") -> bytes:
        """
        Extracts orthogonal slice, resamples for physical aspect ratio, applies windowing,
        and returns compressed PNG bytes.
        """
        self.load_ct_data()
        preset = WINDOW_PRESETS.get(window_preset.lower(), WINDOW_PRESETS["lung"])
        ww = preset["width"]
        wl = preset["level"]

        plane = plane.lower()
        if plane == "axial":
            idx = max(0, min(index, self.volume.shape[0] - 1))
            raw_slice = self.volume[idx, :, :] # (512, 512)
            # Standard axial orientation: row 0 is anterior, row 511 is posterior
            slice_arr = raw_slice
        elif plane == "coronal":
            idx = max(0, min(index, self.volume.shape[1] - 1))
            raw_slice = self.volume[:, idx, :] # (139, 512)
            # Flip vertically so superior (high Z) is top
            raw_slice = np.flipud(raw_slice)
            # Resample height to physical aspect ratio: 139 * 3.282 ~ 456 px
            target_h = int(round(raw_slice.shape[0] * self.aspect_ratio_z))
            target_w = raw_slice.shape[1]
            slice_arr = self._resample_array(raw_slice, target_w, target_h)
        elif plane == "sagittal":
            idx = max(0, min(index, self.volume.shape[2] - 1))
            raw_slice = self.volume[:, :, idx] # (139, 512)
            raw_slice = np.flipud(raw_slice)
            target_h = int(round(raw_slice.shape[0] * self.aspect_ratio_z))
            target_w = raw_slice.shape[1]
            slice_arr = self._resample_array(raw_slice, target_w, target_h)
        else:
            raise ValueError(f"Unknown plane: {plane}. Must be axial, coronal, or sagittal.")

        # Windowing formula: clamp((HU - (WL - WW/2)) / WW, 0, 1) * 255
        lower = wl - (ww / 2.0)
        norm = (slice_arr - lower) / float(ww)
        uint8_slice = np.clip(norm * 255.0, 0, 255).astype(np.uint8)

        img = Image.fromarray(uint8_slice, mode="L")
        buf = io.BytesIO()
        img.save(buf, format="PNG", compress_level=1)
        return buf.getvalue()

    def get_mask_slice_png(self, structure: str, plane: str, index: int) -> bytes:
        """
        Extracts 2D binary mask slice matching the geometry of get_slice_png.
        Returns 8-bit grayscale PNG where foreground is 255, background is 0.
        """
        self.load_ct_data()
        mask = self.masks.get(structure.lower())
        plane = plane.lower()

        if mask is None:
            # Return empty 1x1 mask
            empty = np.zeros((1, 1), dtype=np.uint8)
            img = Image.fromarray(empty, mode="L")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()

        if plane == "axial":
            idx = max(0, min(index, mask.shape[0] - 1))
            raw_slice = mask[idx, :, :]
            slice_arr = raw_slice
        elif plane == "coronal":
            idx = max(0, min(index, mask.shape[1] - 1))
            raw_slice = np.flipud(mask[:, idx, :])
            target_h = int(round(raw_slice.shape[0] * self.aspect_ratio_z))
            target_w = raw_slice.shape[1]
            slice_arr = self._resample_array(raw_slice, target_w, target_h, nearest=True)
        elif plane == "sagittal":
            idx = max(0, min(index, mask.shape[2] - 1))
            raw_slice = np.flipud(mask[:, :, idx])
            target_h = int(round(raw_slice.shape[0] * self.aspect_ratio_z))
            target_w = raw_slice.shape[1]
            slice_arr = self._resample_array(raw_slice, target_w, target_h, nearest=True)
        else:
            raise ValueError(f"Unknown plane: {plane}")

        uint8_mask = (slice_arr > 0).astype(np.uint8) * 255
        img = Image.fromarray(uint8_mask, mode="L")
        buf = io.BytesIO()
        img.save(buf, format="PNG", compress_level=1)
        return buf.getvalue()

    @staticmethod
    def _resample_array(arr: np.ndarray, width: int, height: int, nearest: bool = False) -> np.ndarray:
        pil_mode = "F" if arr.dtype in [np.float32, np.float64] else "I"
        img = Image.fromarray(arr)
        resample_filter = Image.Resampling.NEAREST if nearest else Image.Resampling.BILINEAR
        resized = img.resize((width, height), resample=resample_filter)
        return np.array(resized)

    def get_mesh_data(self, structure: str) -> Dict[str, Any]:
        mesh_file = MESHES_DIR / f"{structure.lower()}.json"
        if not mesh_file.exists():
            raise FileNotFoundError(f"Mesh geometry asset not found for {structure}")
        with open(mesh_file, "r") as f:
            return json.load(f)

    def get_manifest(self) -> list:
        manifest_file = MESHES_DIR / "manifest.json"
        if not manifest_file.exists():
            raise FileNotFoundError("Mesh manifest missing")
        with open(manifest_file, "r") as f:
            return json.load(f)

# Global singleton
ct_manager = CTVolumeManager()
