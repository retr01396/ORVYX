import torch
import numpy as np
from pathlib import Path
import torchxrayvision as xrv

def preprocess_xray_image(image_path: Path) -> torch.Tensor:
    """
    Authoritative 2D chest X-ray preprocessing pipeline validated in Phase 0:
    1. Load image using xrv.utils.load_image (handles DICOM, PNG, JPEG -> [-1024, 1024] float32)
    2. Apply XRayCenterCrop (center-crops to square on long dimension)
    3. Convert to torch tensor with shape [1, 1, H, W]
    4. Assert values strictly within [-1024, 1024] range; raise ValueError if violated.
    """
    if not image_path.exists():
        raise FileNotFoundError(f"Image not found at path: {image_path}")

    # Step 1: Load and normalize to [-1024, 1024]
    img = xrv.utils.load_image(str(image_path))
    
    # Step 2: Center crop
    crop = xrv.datasets.XRayCenterCrop()
    img = crop(img)
    
    # Step 3: Convert to tensor with batch dimension [1, 1, H, W]
    tensor = torch.from_numpy(img).unsqueeze(0).float()
    
    # Step 4: Validate value range strictly
    t_min = float(tensor.min().item())
    t_max = float(tensor.max().item())
    
    # Allow 0.1 tolerance for floating-point rounding
    if t_min < -1024.1 or t_max > 1024.1:
        raise ValueError(
            f"Preprocessed tensor range [{t_min:.2f}, {t_max:.2f}] violates strict [-1024, 1024] bound. "
            f"Inference aborted to prevent model degradation."
        )
        
    return tensor
