# ORVYX — Multimodal Thoracic Diagnostic Workstation

> **⚠ Investigational Use Only** — Research prototype. Not a diagnostic device. All AI predictions require licensed radiologist review.

ORVYX is a multimodal medical-imaging research workstation combining 2D chest X-ray AI analysis, 3D CT multi-planar reconstruction, TotalSegmentator-derived anatomical meshes, and a deterministic AI Co-Pilot — all in a browser-native React + FastAPI application.

---

## Features

### Phase 1 — 2D Chest X-Ray Pipeline
- **DenseNet-121** (torchxrayvision `densenet121-res224-all`): 18 pathology classifications with confidence bands
- **PSPNet** (torchxrayvision `chestx_det`): 14 thoracic anatomical segmentation masks
- Apple Silicon **MPS** inference (~250 ms per study)
- Overlay visualization with opacity control and per-segment toggle

### Phase 2 — CT / MPR Workstation
- 512×512×139 chest CT volume (40 MB NRRD)
- Synchronized axial / coronal / sagittal multi-planar reconstruction
- HU windowing: **Lung** (WW 1500, WL -600) and **Mediastinum** (WW 350, WL 40)
- 8 TotalSegmentator v2 organ overlays as 2D mask slices and 3D meshes
- Sub-3 ms orthogonal slicing (SimpleITK + physical aspect ratio correction)

### Phase 3 — AI Co-Pilot
- Deterministic multimodal reasoning engine (no LLM — fully offline)
- Grounded clinical summary, prioritized findings, and quantitative measurements
- Natural language inquiry (heart, lungs, aorta, trachea, measurements, limitations)
- Cross-modality anatomy navigation: Co-Pilot finding → MPR crosshair snap + 3D camera focus

### Phase 4 — 2D X-Ray → Cinematic 3D Reconstruction & Multi-Provider Co-Pilot
- **GPU Particle Reconstruction**: 12,000 to 60,000 particles converging from 2D space into 3D thoracic anatomy at ~60 FPS
- **Explicit Medical Disclaimer**: Labeled "AI-ESTIMATED THORACIC ANATOMY (Template)" with clear disclaimer that single 2D projections do not produce patient-specific 3D depth
- **Thoracic Skeletal & Visceral Template**: 9 structures (rib cage 12 pairs, sternum, thoracic spine T1–T12, clavicles, scapulae, lungs, heart, trachea) with 18 finding mappings
- **Multi-Provider Co-Pilot**: Offline deterministic engine (default), self-hosted Custom LLM (`CUSTOM_LLM_BASE_URL`), and external API gateway (`AI_API_BASE_URL`, `AI_API_KEY`) with automated fallback and zero secret leakage
- **Bidirectional 2D ↔ 3D Synchronization**: Finding selection in 2D Viewport/InsightsPanel highlights corresponding 3D structures; interactive 3D raycaster click selects anatomy

### Phase 5 — Custom Study Ingestion
- Drag-and-drop or file-picker radiograph upload (PNG, JPEG, TIFF, BMP; max 50 MB)
- Server-side format, size, and pixel-geometry validation
- DenseNet-121 + PSPNet inference on uploaded studies
- Dynamic Study Registry and dynamic Co-Pilot context per active study

### Phase 6 — Production Hardening
- Path traversal protection on all file-serving endpoints
- Strict parameter allowlists for CT plane, window, and structure IDs (HTTP 400 on violation)
- Filename sanitization on upload (basename extraction)
- Co-Pilot question length clamping and empty-input handling
- Race condition guard on rapid study switching (stale analysis responses discarded)
- Stale Co-Pilot state cleared on study switch
- ARIA labels and `role="tab"` / `aria-selected` / `aria-pressed` on navigation controls

---

## Architecture

```
ORVYX/
├── backend/                  FastAPI (Python 3.14, MPS)
│   ├── app/
│   │   ├── api/
│   │   │   ├── xray.py       2D study endpoints + upload ingestion
│   │   │   ├── ct.py         CT slicing, masks, meshes (hardened allowlists)
│   │   │   └── copilot.py    AI Co-Pilot context + ask endpoints
│   │   ├── services/
│   │   │   ├── inference.py  DenseNet-121 + PSPNet (MPS)
│   │   │   ├── preprocess.py X-ray preprocessing pipeline
│   │   │   ├── ct_service.py CT slicing + mask + mesh service
│   │   │   └── copilot_service.py Deterministic reasoning engine
│   │   └── models/           Pydantic schemas
│   └── weights_cache/        Local model weights (not committed to git)
├── frontend/                 React 19 + TypeScript + Vite + Tailwind CSS v4
│   └── src/
│       ├── App.tsx           Unified workstation state + layout
│       └── components/       Header, StudyRail, Viewport, InsightsPanel,
│                             ct/, copilot/ sub-components
├── assets/demo/
│   ├── demo-1.png            Verified benchmark CXR (normal)
│   ├── demo-2.jpg            Verified benchmark CXR (nodule/cardiomegaly)
│   ├── ct/CT-chest.nrrd      Verified 40 MB chest CT volume
│   ├── ct/masks/             8 TotalSegmentator NIfTI masks
│   └── ct/meshes/            8 TotalSegmentator JSON surface meshes
├── scripts/
│   ├── smoke_test_phase1.py  8 tests
│   ├── smoke_test_phase2.py  20 tests
│   ├── smoke_test_phase3.py  26 tests
│   ├── smoke_test_phase5.py  25 tests
│   └── smoke_test_phase6.py  46 tests (security + regression)
└── docs/
    ├── ARCHITECTURE.md
    ├── PHASE0_EVIDENCE.md    Phase 0 empirical benchmarks (source of truth)
    ├── walkthrough.md
    └── FINAL_QA.md
```

---

## Requirements

| Component | Version |
|-----------|---------|
| Python | 3.14 (backend venv) |
| PyTorch | with MPS backend (Apple Silicon) |
| Node.js | 18+ |
| npm | 9+ |

Key Python dependencies: `fastapi`, `uvicorn`, `torchxrayvision`, `SimpleITK`, `nibabel`, `Pillow`, `numpy`

---

## Installation

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Model weights are downloaded automatically to `backend/weights_cache/` on first startup (~287 MB total: DenseNet-121 27 MB + PSPNet 260 MB).

### Frontend

```bash
cd frontend
npm install
```

---

## Running the Application

### 1. Start Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Start Frontend Dev Server

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

The Vite dev server proxies all `/api/*` requests to the backend at `http://localhost:8000`.

---

## Test Commands

```bash
# Run from repository root with the backend venv

backend/.venv/bin/python scripts/smoke_test_phase1.py  # 8 tests
backend/.venv/bin/python scripts/smoke_test_phase2.py  # 20 tests
backend/.venv/bin/python scripts/smoke_test_phase3.py  # 26 tests
backend/.venv/bin/python scripts/smoke_test_phase4.py  # 42 tests
backend/.venv/bin/python scripts/smoke_test_phase5.py  # 25 tests
backend/.venv/bin/python scripts/smoke_test_phase6.py  # 46 tests

# Frontend production build
cd frontend && npm run build
```

**Cumulative verified result: 167/167 tests passing**

---

## AI Models

| Model | Source | Task | Size |
|-------|--------|------|------|
| DenseNet-121 | torchxrayvision `densenet121-res224-all` | 18-class CXR pathology | 27 MB |
| PSPNet | torchxrayvision `chestx_det` | 14-region CXR segmentation | 260 MB |

CT segmentation meshes were pre-computed with **TotalSegmentator v2** (nnUNetV2, `--fast`, 3 mm isotropic) in a separate Python 3.11 venv (see `docs/PHASE0_EVIDENCE.md`).

---

## Limitations

- Research prototype — **not FDA/CE cleared** as a diagnostic device
- Non-contrast CT: endoluminal thrombi and coronary calcifications cannot be fully characterized
- 2D radiograph has projectional tissue overlap; no lateral projection available
- TotalSegmentator fast mode uses 3 mm isotropic downsampling
- AI Co-Pilot default is deterministic and offline — external providers clearly show data transmission warnings
- Single CT baseline study; longitudinal comparison is not implemented

---

## Completed Phases

| Phase | Description | Tests |
|-------|-------------|-------|
| Phase 1 | 2D CXR pipeline (DenseNet-121 + PSPNet, MPS) | 8/8 |
| Phase 2 | CT/MPR workstation + 3D anatomy viewer | 20/20 |
| Phase 3 | AI Co-Pilot (deterministic, multimodal) | 26/26 |
| Phase 4 | 2D X-ray → 3D Particle Recon & Multi-Provider Co-Pilot | 42/42 |
| Phase 5 | Custom study ingestion + unified workflow | 25/25 |
| Phase 6 | Production hardening, security, accessibility | 46/46 |
| **Total** | **All cumulative regression test suites** | **167/167** |
