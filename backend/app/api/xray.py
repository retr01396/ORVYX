import io
import uuid
import datetime
from pathlib import Path
from typing import Dict, List, Optional
from PIL import Image
from fastapi import APIRouter, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse

from app.config import DEMO_STUDIES, ASSETS_DEMO_DIR, ASSETS_UPLOADS_DIR
from app.models.state import StudyState, AnalyzeRequest, StudySummary
from app.services.preprocess import preprocess_xray_image
from app.services.inference import model_manager

router = APIRouter(prefix="/api/xray", tags=["xray"])

# In-memory dynamic study registry initialized with verified demo studies
STUDY_REGISTRY: Dict[str, dict] = {}
# In-memory cache for analyzed study states to eliminate redundant inference
STUDY_STATE_CACHE: Dict[str, StudyState] = {}

def get_study_registry() -> Dict[str, dict]:
    """Returns the mutable study registry, initializing with verified demo assets on first access."""
    global STUDY_REGISTRY
    if not STUDY_REGISTRY:
        for s_id, s in DEMO_STUDIES.items():
            file_path = ASSETS_DEMO_DIR / s["filename"]
            file_size = file_path.stat().st_size if file_path.exists() else None
            STUDY_REGISTRY[s_id] = {
                "study_id": s["study_id"],
                "title": s["title"],
                "filename": s["filename"],
                "file_path": file_path,
                "patient_id": s["patient_id"],
                "view": s["view"],
                "modality": s["modality"],
                "description": s["description"],
                "status": "ready",
                "is_custom": False,
                "available_modalities": ["CX"],
                "file_size_bytes": file_size,
                "created_at": None,
            }
    return STUDY_REGISTRY

@router.get("/studies", response_model=List[StudySummary])
async def list_studies():
    """Returns metadata for all available verified demo studies and ingested custom studies."""
    registry = get_study_registry()
    return [
        StudySummary(
            study_id=s["study_id"],
            title=s["title"],
            patient_id=s["patient_id"],
            view=s["view"],
            modality=s["modality"],
            description=s["description"],
            status=s.get("status", "ready"),
            is_custom=s.get("is_custom", False),
            available_modalities=s.get("available_modalities", ["CX"]),
            file_size_bytes=s.get("file_size_bytes"),
            created_at=s.get("created_at")
        )
        for s in registry.values()
    ]

@router.post("/upload", response_model=StudySummary)
async def upload_xray_study(file: UploadFile = File(...)):
    """
    Ingests an uploaded thoracic radiograph image (PNG, JPEG, TIFF, etc.):
    1. Validates file extension and size limits (max 50 MB).
    2. Validates image decodability and resolution using PIL.
    3. Saves file into assets/demo/uploads/.
    4. Registers the new study into STUDY_REGISTRY.
    5. Returns initial StudySummary with status='ready'.
    """
    raw_filename = Path(file.filename or "uploaded_xray.png").name  # basename only – strips any directory components
    ext = Path(raw_filename).suffix.lower()
    
    allowed_exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Supported formats: {', '.join(sorted(allowed_exts))}"
        )

    contents = await file.read()
    if not contents or len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty (0 bytes)."
        )
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds the 50 MB maximum limit."
        )

    # Validate image data
    try:
        stream = io.BytesIO(contents)
        img = Image.open(stream)
        img.verify()
        # Reopen to check dimensions
        stream.seek(0)
        img = Image.open(stream)
        w, h = img.size
        if w < 64 or h < 64:
            raise ValueError(f"Image dimensions {w}x{h} are too small for thoracic radiograph analysis (minimum 64x64).")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid image file: {str(e)}"
        )

    study_id = f"upload-{uuid.uuid4().hex[:8]}"
    save_filename = f"{study_id}{ext}"
    save_path = ASSETS_UPLOADS_DIR / save_filename

    try:
        with open(save_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist uploaded image: {str(e)}"
        )

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    stem = Path(raw_filename).stem.replace("_", " ").replace("-", " ").title()
    title = f"Custom: {stem}"

    registry = get_study_registry()
    registry[study_id] = {
        "study_id": study_id,
        "title": title,
        "filename": save_filename,
        "file_path": save_path,
        "patient_id": f"PT-UP-{study_id[-4:].upper()}",
        "view": "PA",
        "modality": "CX",
        "description": f"User-uploaded radiograph ({w}x{h} px, {len(contents) // 1024} KB).",
        "status": "ready",
        "is_custom": True,
        "available_modalities": ["CX"],
        "file_size_bytes": len(contents),
        "created_at": now_iso,
    }

    return StudySummary(
        study_id=study_id,
        title=title,
        patient_id=registry[study_id]["patient_id"],
        view="PA",
        modality="CX",
        description=registry[study_id]["description"],
        status="ready",
        is_custom=True,
        available_modalities=["CX"],
        file_size_bytes=len(contents),
        created_at=now_iso
    )

@router.get("/image/{study_id}")
async def get_study_image(study_id: str):
    """Serves raw chest X-ray image for client-side rendering (demo or uploaded)."""
    # Reject any study_id containing path traversal sequences
    if ".." in study_id or "/" in study_id or "\\" in study_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid study_id: path traversal characters are not permitted."
        )
    registry = get_study_registry()
    if study_id not in registry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study '{study_id}' not found."
        )
    
    entry = registry[study_id]
    image_path = entry.get("file_path") or (ASSETS_DEMO_DIR / entry["filename"])
    
    if not image_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Image file '{entry['filename']}' missing on server."
        )
        
    media_type = "image/png" if str(image_path).endswith(".png") else "image/jpeg"
    return FileResponse(image_path, media_type=media_type)


@router.post("/analyze", response_model=StudyState)
async def analyze_xray(request: AnalyzeRequest):
    """
    Executes full 2D chest X-ray pipeline:
    1. Validates study_id against registry (demo or custom uploaded).
    2. Runs normalized [-1024, 1024] preprocessing with strict range check.
    3. Executes DenseNet-121 classification + PSPNet anatomical segmentation on MPS.
    4. Returns complete StudyState contract with findings and base64 PNG masks.
    """
    study_id = request.study_id
    registry = get_study_registry()
    if study_id not in registry:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown study_id '{study_id}'. Available demo studies: {list(registry.keys())}"
        )
        
    entry = registry[study_id]
    image_path = entry.get("file_path") or (ASSETS_DEMO_DIR / entry["filename"])
    
    try:
        # Preprocessing with strict [-1024, 1024] boundary check
        tensor = preprocess_xray_image(image_path)
    except ValueError as ve:
        entry["status"] = "error"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Preprocessing validation error: {str(ve)}"
        )
    except Exception as e:
        entry["status"] = "error"
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to load or preprocess image: {str(e)}"
        )
        
    try:
        # Inference pass
        study_state = model_manager.run_inference(tensor, study_id)
        if entry.get("is_custom"):
            study_state.source = "user-upload"
            study_state.limitations.append(
                "User-ingested radiograph. Model predictions are assistive and have not undergone prior radiologist verification."
            )
        entry["status"] = "complete"
        STUDY_STATE_CACHE[study_id] = study_state
        return study_state
    except Exception as e:
        entry["status"] = "error"
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference execution failure: {str(e)}"
        )
