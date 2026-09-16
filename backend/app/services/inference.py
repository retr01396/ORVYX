import time
import io
import base64
import logging
from typing import Dict, List, Tuple
from PIL import Image
import numpy as np
import torch
import torchxrayvision as xrv

from app.config import (
    DEVICE,
    CLASSIFIER_WEIGHTS,
    PATHOLOGY_LABELS,
    SEGMENTATION_TARGETS,
    BAND_LOW_THRESHOLD,
    BAND_ELEVATED_THRESHOLD,
    SEGMENTATION_THRESHOLD,
    WEIGHTS_CACHE_DIR
)
from app.models.state import Finding, Segment, Centroid, Provenance, StudyState

logger = logging.getLogger("orvyx.inference")

class ModelManager:
    """
    Singleton model manager initialized during FastAPI lifespan startup.
    Loads models once to eliminate cold-load overhead (PSPNet ~22.5s).
    """
    def __init__(self):
        self.device = DEVICE
        self.classifier = None
        self.segmenter = None
        self.load_duration_s = 0.0

    def load_models(self):
        t_start = time.perf_counter()
        logger.info(f"Initializing ORVYX models on device: {self.device} (weights cache: {WEIGHTS_CACHE_DIR})...")
        
        # 1. DenseNet-121 Classifier
        logger.info(f"Loading DenseNet-121 with weights={CLASSIFIER_WEIGHTS}...")
        self.classifier = xrv.models.DenseNet(
            weights=CLASSIFIER_WEIGHTS,
            cache_dir=str(WEIGHTS_CACHE_DIR)
        )
        self.classifier.eval()
        self.classifier.to(self.device)
        
        # 2. PSPNet Anatomical Segmenter
        logger.info("Loading PSPNet anatomical segmentation model...")
        self.segmenter = xrv.baseline_models.chestx_det.PSPNet(
            cache_dir=str(WEIGHTS_CACHE_DIR)
        )
        self.segmenter.eval()
        self.segmenter.to(self.device)
        
        # 3. Warm-up pass to initialize Metal shaders / PyTorch cache
        logger.info("Performing model warm-up pass...")
        with torch.no_grad():
            dummy = torch.zeros((1, 1, 512, 512), dtype=torch.float32, device=self.device)
            _ = self.classifier(dummy)
            _ = self.segmenter(dummy)
            if self.device == "mps":
                torch.mps.synchronize()
                
        self.load_duration_s = time.perf_counter() - t_start
        logger.info(f"Models successfully loaded and warmed up in {self.load_duration_s:.2f}s.")

    def run_inference(self, input_tensor: torch.Tensor, study_id: str) -> StudyState:
        if self.classifier is None or self.segmenter is None:
            self.load_models()
        t_start = time.perf_counter()
        active_device = self.device
        
        try:
            findings, segments = self._execute_pass(input_tensor, active_device)
        except Exception as mps_err:
            if active_device == "mps":
                logger.warning(f"MPS inference failed ({mps_err}). Retrying once on CPU fallback...")
                active_device = "cpu"
                findings, segments = self._execute_pass(input_tensor, "cpu")
            else:
                raise mps_err

        runtime_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
        
        # Sort findings descending by score
        findings_sorted = sorted(findings, key=lambda f: f.score, reverse=True)
        
        provenance = Provenance(
            classifier_model=f"DenseNet121 ({CLASSIFIER_WEIGHTS})",
            segmentation_model="PSPNet (chestx_det)",
            version=getattr(xrv, "__version__", "1.5.4"),
            device=active_device,
            runtime_ms=runtime_ms
        )
        
        return StudyState(
            study_id=study_id,
            modality="CX",
            source="demo-asset",
            provenance=provenance,
            findings=findings_sorted,
            segments=segments,
            measurements=[],
            comparison=None,
            limitations=[
                "Research prototype output only. Not evaluated as a primary diagnostic tool.",
                "PSPNet segmentation provides 14 anatomical regions of interest."
            ]
        )

    def _execute_pass(self, tensor: torch.Tensor, device: str) -> Tuple[List[Finding], List[Segment]]:
        x = tensor.clone().to(device)
        clf_model = self.classifier.to(device)
        seg_model = self.segmenter.to(device)
        
        with torch.no_grad():
            # 1. Classification
            clf_logits = clf_model(x)
            if device == "mps":
                torch.mps.synchronize()
            clf_scores = clf_logits.cpu().numpy()[0]
            
            # 2. Segmentation
            seg_logits = seg_model(x)
            if device == "mps":
                torch.mps.synchronize()
            seg_probs = torch.sigmoid(seg_logits).cpu().numpy()[0]  # [14, 512, 512]
            
        # Build Finding objects
        findings = []
        for idx, label in enumerate(PATHOLOGY_LABELS):
            score = float(clf_scores[idx])
            if score >= BAND_ELEVATED_THRESHOLD:
                band = "elevated"
            elif score >= BAND_LOW_THRESHOLD:
                band = "moderate"
            else:
                band = "low"
            findings.append(Finding(label=label, score=round(score, 4), band=band))
            
        # Build Segment objects
        segments = []
        for idx, target_name in enumerate(SEGMENTATION_TARGETS):
            prob_map = seg_probs[idx]
            binary_mask = (prob_map >= SEGMENTATION_THRESHOLD).astype(np.uint8)
            area_px = int(np.sum(binary_mask))
            
            # Compute centroid
            if area_px > 0:
                y_coords, x_coords = np.where(binary_mask > 0)
                centroid_x = float(np.mean(x_coords))
                centroid_y = float(np.mean(y_coords))
            else:
                centroid_x = 256.0
                centroid_y = 256.0
                
            # Encode mask as PNG base64
            mask_png_base64 = self._mask_to_base64_png(binary_mask * 255)
            
            segments.append(
                Segment(
                    name=target_name,
                    source="chestx_det-pspnet",
                    centroid=Centroid(x=round(centroid_x, 1), y=round(centroid_y, 1)),
                    area_px=area_px,
                    mask_base64=mask_png_base64
                )
            )
            
        return findings, segments

    @staticmethod
    def _mask_to_base64_png(mask_arr: np.ndarray) -> str:
        """Converts [H, W] uint8 binary mask (0 or 255) to PNG base64 string with alpha transparency."""
        h, w = mask_arr.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 0] = 255
        rgba[..., 1] = 255
        rgba[..., 2] = 255
        rgba[..., 3] = mask_arr
        img = Image.fromarray(rgba, mode='RGBA')
        buffer = io.BytesIO()
        img.save(buffer, format='PNG', optimize=True)
        return base64.b64encode(buffer.getvalue()).decode('utf-8')

# Global singleton
model_manager = ModelManager()
