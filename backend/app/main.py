import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import DEVICE
from app.services.inference import model_manager
from app.api import xray, ct, copilot
from app.api import reconstruction

# Configure application logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("orvyx.main")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== ORVYX Backend Starting Up ===")
    # Pre-load DenseNet-121 and PSPNet models once during startup
    model_manager.load_models()
    logger.info("=== ORVYX Startup Complete: Models Ready for Fast Inference ===")
    yield
    logger.info("=== ORVYX Backend Shutting Down ===")

app = FastAPI(
    title="ORVYX AI Medical Imaging Workstation",
    description="Backend API service for AI-assisted thoracic imaging analysis",
    version="2.0.0",
    lifespan=lifespan
)

# CORS configuration for development with Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(xray.router)
app.include_router(ct.router)
app.include_router(copilot.router)
app.include_router(reconstruction.router)

@app.get("/api/health")
async def health_check():
    """Health check endpoint confirming model readiness and active hardware device."""
    return {
        "status": "healthy",
        "service": "ORVYX Multimodal AI Workstation",
        "device": model_manager.device,
        "models_loaded": model_manager.classifier is not None and model_manager.segmenter is not None,
        "load_duration_s": round(model_manager.load_duration_s, 3)
    }

@app.get("/api/ai/health")
async def ai_health_check():
    """Health check endpoint for active AI / LLM Co-Pilot provider."""
    from app.services.copilot_service import copilot_manager
    return copilot_manager.check_health()

