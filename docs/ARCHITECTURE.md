# ORVYX System Architecture

ORVYX is an AI-assisted thoracic medical imaging workstation. This document captures the technical architecture, data contracts, and design principles of the system.

---

## 1. System Overview

```
                          ┌──────────────────────────────────────────────┐
                          │          ORVYX Clinical Workstation          │
                          │   (React 19 + TypeScript + Tailwind CSS)     │
                          └───────┬──────────────────────────────▲───────┘
                                  │ POST /api/xray/analyze       │
                                  │ { "study_id": "demo-1" }     │ StudyState JSON
                                  ▼                              │ (Findings + Masks)
                          ┌──────────────────────────────────────┴───────┐
                          │         ORVYX FastAPI Backend Service        │
                          │            (Uvicorn / Python 3.14)           │
                          └───────┬──────────────────────────────▲───────┘
                                  │ Preprocessed Tensor          │ Logits
                                  │ [-1024, 1024]                │ & Probabilities
                                  ▼                              │
┌────────────────────────────────────────────────────────────────────────┐
│                        Apple Silicon MPS Runtime                       │
│  ┌─────────────────────────────────┐ ┌───────────────────────────────┐ │
│  │   DenseNet-121 Classifier       │ │   PSPNet Anatomical Segmenter │ │
│  │   (densenet121-res224-all)      │ │   (chestx_det, 14 structures) │ │
│  │   18 Pathologies (Sigmoid)      │ │   [1, 14, 512, 512] -> >=0.5  │ │
│  └─────────────────────────────────┘ └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Phase 1 — As Built

Phase 1 establishes the production ORVYX application shell and the end-to-end 2D chest X-ray pipeline. Every technical decision, model parameter, and preprocessing step is grounded directly in the verified empirical findings of Phase 0 (`docs/PHASE0_EVIDENCE.md`).

### 2.1 File & Directory Layout

```
ORVYX/
├── assets/
│   └── demo/
│       ├── demo-1.png                  # Verified CXR (Normal: 00000001_000.png)
│       └── demo-2.jpg                  # Verified CXR (Pathology: 16747_3_1.jpg)
├── backend/
│   ├── .venv/                          # Dedicated Python 3.14 virtual environment
│   ├── requirements.txt                # Production backend dependencies
│   ├── weights_cache/                  # Cached model weights (27M DenseNet, 260M PSPNet)
│   └── app/
│       ├── __init__.py
│       ├── main.py                     # FastAPI application with lifespan context
│       ├── config.py                   # Device detection (MPS/CPU), labels, paths
│       ├── models/
│       │   ├── __init__.py
│       │   └── state.py                # StudyState, Finding, Segment Pydantic schemas
│       ├── services/
│       │   ├── __init__.py
│       │   ├── preprocess.py           # Strict [-1024, 1024] preprocessing pipeline
│       │   └── inference.py            # Singleton model manager with lifespan loading
│       └── api/
│           ├── __init__.py
│           └── xray.py                 # REST endpoints (/analyze, /studies, /image)
├── frontend/
│   ├── index.html
│   ├── package.json                    # React, Vite, Lucide-React, Tailwind CSS
│   ├── vite.config.ts                  # Vite config with proxy to backend :8000
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                     # Top-level state and 3-panel layout
│       ├── index.css                   # Clinical dark theme and custom scrollbars
│       ├── types/
│       │   └── studystate.ts           # TypeScript interfaces matching backend contract
│       └── components/
│           ├── Banner.tsx              # Non-dismissible disclaimer banner
│           ├── Header.tsx              # Branding, MPS status, disabled Phase 2/3 tabs
│           ├── StudyRail.tsx           # Selectable demo study cards & metadata
│           ├── Viewport.tsx            # Pan/Zoom viewer, mask overlays, centroid reticle
│           └── InsightsPanel.tsx       # 18 findings, confidence bands, anatomy toggles
├── docs/
│   ├── PHASE0_EVIDENCE.md              # Historical empirical record (Phase 0A & 0B)
│   ├── walkthrough.md                  # Feasibility study walkthrough
│   └── ARCHITECTURE.md                 # System architecture (this document)
└── scripts/
    └── smoke_test_phase1.py            # Automated smoke test suite (T1 - T8)
```

### 2.2 Strict Preprocessing Pipeline
To guarantee consistent inference and eliminate silent degradation:
1. `xrv.utils.load_image(path)` normalizes 8-bit input to float32 `[-1024, 1024]`.
2. `XRayCenterCrop()(img)` crops square on the smallest dimension.
3. Converted to tensor `[1, 1, H, W]`.
4. **Boundary Guard**: Validates that tensor values lie strictly in `[-1024.1, 1024.1]`. Out-of-bounds inputs raise an explicit HTTP 500 error.

### 2.3 Model Lifespan & Inference Strategy
- **One-Time Startup Load**: DenseNet-121 and PSPNet are loaded once inside FastAPI's `@asynccontextmanager` lifespan handler during server startup. This eliminates PSPNet's 22.5s cold-load time on user requests.
- **Hardware Acceleration**: Automatic detection of `device="mps"` (Metal Performance Shaders on Apple Silicon). If an MPS runtime exception occurs, the service catches it, logs a warning, and retries seamlessly on CPU.
- **Classifier**: Exclusively `densenet121-res224-all` (18 pathologies).
- **Segmentation**: PSPNet output logits `[1, 14, 512, 512]` are converted via sigmoid $\ge 0.5$ into 14 binary masks. Each mask is serialized as a compressed Base64 PNG along with its center-of-mass centroid `{x, y}` and pixel area. Total response payload is < 100 KB.

### 2.4 StudyState JSON Contract
```json
{
  "study_id": "demo-1",
  "modality": "CX",
  "source": "demo-asset",
  "provenance": {
    "classifier_model": "DenseNet121 (densenet121-res224-all)",
    "segmentation_model": "PSPNet (chestx_det)",
    "version": "1.5.4",
    "device": "mps",
    "runtime_ms": 255.5
  },
  "findings": [
    { "label": "Cardiomegaly", "score": 0.6069, "band": "elevated" },
    { "label": "Fibrosis", "score": 0.5410, "band": "moderate" }
  ],
  "segments": [
    {
      "name": "Heart",
      "source": "chestx_det-pspnet",
      "centroid": { "x": 256.4, "y": 320.1 },
      "area_px": 14200,
      "mask_base64": "iVBORw0KGgoAAA..."
    }
  ],
  "measurements": [],
  "comparison": null,
  "limitations": [
    "Research prototype output only. Not evaluated as a primary diagnostic tool."
  ]
}
```

### 2.5 Clinical Workstation Frontend
- **Study Rail (Left)**: Allows switching between verified demo studies with real-time thumbnail previews and patient metadata.
- **Viewport (Center)**: Interactive X-ray viewer supporting mouse drag pan, smooth zoom, view reset, opacity slider, and layered anatomical overlays.
- **Click-a-Finding Focal Navigation**: Clicking an AI finding in the insights panel triggers an animated focal jump in the viewport, centering on the structure's centroid with an animated crosshair reticle.
- **Insights Panel (Right)**: Lists all 18 findings sorted descending by probability with color-coded confidence badges (`elevated` >0.60, `moderate` 0.30–0.60, `low` <0.30) and an anatomical mask toggle matrix.
- **Regulatory Banner**: Persistent, non-dismissible clinical disclaimer across the top of the interface.
- **Phase Placeholders**: Clearly labeled, disabled buttons for "3D CT Volume" (Phase 2) and "AI Co-Pilot" (Phase 3).

---

## 3. How to Run the Application

### Prerequisites
- macOS on Apple Silicon (tested on Apple M5, Metal 4)
- Python 3.14+
- Node.js 20+

### Step 1: Start the Backend Service
```bash
cd backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```
*Models will load and warm up in ~3.8 seconds on MPS.*

### Step 2: Start the Frontend Application
```bash
cd frontend
npm run dev
```
*Open your browser at `http://localhost:5173`.*

### Step 3: Run Automated Smoke Tests
```bash
backend/.venv/bin/python scripts/smoke_test_phase1.py
```
*Verifies endpoints, schemas, 18 findings, 14 segments, and sub-second latency.*

---

## 4. Phase 1 Performance Benchmarks

Measured on Apple M5 (fanless MacBook Air, unified 16 GiB):
- **Server Startup & Model Preload**: **3.91s** (one-time cold load).
- **Demo 1 Analysis (Normal CXR)**:
  - Model Inference: **255.52ms** on MPS.
  - End-to-End HTTP Roundtrip: **268.0ms**.
- **Demo 2 Analysis (Pathology CXR)**:
  - Model Inference: **247.27ms** on MPS.
  - End-to-End HTTP Roundtrip: **254.7ms**.
- **Payload Size**: < 85 KB per analysis response (compressed PNG masks).

---

## 5. Phase 2 — Multimodal CT & 3D Workstation (As Built)

### Spatial Geometry & Multi-Planar Reconstruction (MPR)
- **CT Volume Dataset**: `assets/demo/ct/CT-chest.nrrd` (42 MB).
- **Matrix Dimensions**: $512 \times 512 \times 139$ voxels (X, Y, Z).
- **Physical Spacing**: $dx=0.7617$ mm, $dy=0.7617$ mm, $dz=2.5000$ mm.
- **Physical Extents**: $390.0 \times 390.0 \times 347.5$ mm (Volume centered around `[0.0, 23.3, -174.0]` mm).
- **Intensity Dynamic Range**: $-3024$ to $+3071$ Hounsfield Units (HU).
- **Physical Aspect Ratio Correction**:
  Because $dz / dx \approx 3.282$, naive slicing of coronal/sagittal planes would appear vertically squashed.
  The backend resamples coronal and sagittal slices from $139$ to $456$ pixels ($139 \times 3.282$) with `np.flipud`, ensuring anatomically square geometry with Superior oriented upwards.
- **Orthogonal Slicing Performance**:
  In-memory slicing with fast PNG compression (`compress_level=1`) achieves an average response latency of **2.35ms** per slice (~400 FPS server throughput).

### Exact Verified Window Presets
- **Lung Window**: Window Width (WW) = 1500 HU, Window Level (WL) = -600 HU (Range: $-1350$ to $+150$ HU). Optimized for lung parenchyma, fissures, and bronchial airways.
- **Mediastinum Window**: Window Width (WW) = 350 HU, Window Level (WL) = 40 HU (Range: $-135$ to $+215$ HU). Optimized for cardiovascular anatomy, heart chambers, and soft tissue boundaries.

### TotalSegmentator v2 Organ Segmentation & 3D Surface Meshes
- **8 Precomputed Organ Structures**:
  1. `heart`: 484.1 mL (Cardiovascular)
  2. `aorta`: 239.6 mL (Cardiovascular)
  3. `trachea`: 33.5 mL (Airways)
  4. `lung_upper_lobe_right`: 1,403.3 mL (Right Lung)
  5. `lung_middle_lobe_right`: 500.4 mL (Right Lung)
  6. `lung_lower_lobe_right`: 1,315.9 mL (Right Lung)
  7. `lung_upper_lobe_left`: 1,455.1 mL (Left Lung)
  8. `lung_lower_lobe_left`: 1,662.7 mL (Left Lung)
  - **Total Segmented Thoracic Volume**: 7,094.7 mL.
- **Surface Mesh Generation**:
  - Marching cubes with step size 2 extracts smooth polygonal surfaces.
  - Centered to volume origin for Three.js orbit rotation around the chest center.
  - Formatted as compact JSON geometry assets (`vertices`, `indices`, `normals`, `centroids`).

### Browser-Native 3D WebGL Rendering
- Built with Three.js (`three` + `OrbitControls`).
- Double-sided `MeshStandardMaterial` with real-time opacity slider (10% to 100%).
- 3D bounding wireframe box ($390 \times 390 \times 347.5$ mm) with anatomical markers (A, P, S, I, R, L).
- Synchronized 3D slicing planes indicating active Axial, Coronal, and Sagittal crosshairs.
- Animated camera fly-to/focus tween when any organ is selected, with simultaneous MPR crosshair synchronization.

### Phase 2 Verification Results
- **Automated Test Suite**: `scripts/smoke_test_phase2.py` (20 / 20 tests PASSED, 100%).
- **Phase 1 X-Ray Regression**: 0 regressions; 18 DenseNet pathologies and 14 PSPNet segments remain fully functional at 260ms inference latency.

---

## 6. Phase 3 — Multimodal AI Co-Pilot (As Built)

### Co-Pilot Architecture & Unified Context
The Phase 3 AI Co-Pilot establishes an assistive clinical intelligence layer that unifies outputs from the Phase 1 2D chest radiograph pipeline and the Phase 2 3D CT workstation:
```
Phase 1 2D X-ray (DenseNet 18 Pathologies + PSPNet 14 Segments) ──┐
                                                                 │
Phase 2 3D CT (Volume Metadata + 8 TotalSegmentator Organs) ──────┤
                                                                 │
Phase 2 Quantitative Morphometry (6 Volumetric Measures) ─────────┤
                                                                 ↓
                                                       Unified AI Context
                                                                 ↓
                                                    Deterministic Clinical Engine
                                                                 ↓
                                                      Structured CoPilotResponse
                                                                 ↓
                                                      Interactive Co-Pilot Panel
```

### Deterministic Reasoning & Zero-Hallucination Guardrails
- **Offline Reliability**: The primary reasoning path uses `DeterministicCoPilotProvider`, operating 100% locally with zero external network or LLM API dependencies.
- **Strict Evidence Citation**: Every finding links to verified data:
  - 2D X-Ray: Sigmoid logits and confidence bands (e.g., Pulmonary Nodule 0.6909 on `demo-2`).
  - 3D CT: Exact segmentation volumes (Heart 484.1 mL, Aorta 239.6 mL, Trachea 33.6 mL, Total Lung 6,337.4 mL).
  - Presets: Window boundaries (Lung: WW 1500 / WL -600; Mediastinum: WW 350 / WL 40).
- **Patient Privacy**: Never fabricates patient history, lab values, names, or unsupported clinical diagnoses.

### Natural Language Inquiry Engine (`POST /api/copilot/ask`)
- Employs deterministic intent matching for queries regarding:
  1. Study summaries and clinical impressions.
  2. Prioritized findings and focal abnormalities.
  3. Specific anatomical structures (Heart, Aorta, Trachea, Lung Lobes).
  4. Segmented structure catalogs across both modalities.
  5. Quantitative measurements and normal reference ranges.
  6. Clinical safety limitations and model uncertainties.
- Safely refuses out-of-scope inquiries with transparent prompt guidance.

### Bidirectional Workstation Synchronization
- Selecting a Co-Pilot finding with associated anatomy:
  1. Automatically switches to the corresponding modality viewport (2D CXR or 3D CT).
  2. Focuses the 3D camera smoothly on the organ's centered centroid.
  3. Centers the 2D MPR crosshairs on the organ's voxel coordinates `[X, Y, Z]`.
  4. Highlights the active finding in the Co-Pilot panel.

### Safety Disclaimers & Provenance
- Explicitly documented as a research prototype, not evaluated as a certified medical diagnostic device.
- All model predictions clearly demarcate AI interpretation from ground-truth pixel data.

### Phase 3 Verification Results
- **Automated Test Suite**: `scripts/smoke_test_phase3.py` (26 / 26 tests PASSED, 100%).
- **Phase 1 & Phase 2 Regression Tests**: Both suites pass 100% (8/8 and 20/20).
- **Frontend Production Build**: `npm run build` succeeds with 0 errors.

---

## 7. Phase 5 — Production Workstation, Study Ingestion & Unified Multimodal Workflow (As Built)

### Canonical Study State & Ingestion Pipeline
Phase 5 integrates the separate modalities into a cohesive clinical workstation operating against a unified study model:
```
                                 ┌────────────────────────┐
                                 │   Study Ingestion UI   │
                                 │ (Drag-and-Drop/Picker) │
                                 └───────────┬────────────┘
                                             │ POST /api/xray/upload (PNG/JPG/TIFF)
                                             ▼
                                 ┌────────────────────────┐
                                 │  Validation & Storage  │
                                 │ assets/demo/uploads/   │
                                 └───────────┬────────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 STUDY_REGISTRY & Cache                                 │
│  - Demo Benchmarks: demo-1 (Normal CXR), demo-2 (Pathology CXR)                       │
│  - Ingested Patient Studies: upload-<id> (is_custom=True)                              │
│  - CT Volume: ct-chest-1 (512x512x139, 8 TotalSegmentator organs)                     │
└────────────┬───────────────────────────────┬──────────────────────────────┬────────────┘
             │                               │                              │
             ▼                               ▼                              ▼
 ┌───────────────────────┐       ┌───────────────────────┐      ┌───────────────────────┐
 │       2D X-RAY        │       │       CT / MPR        │      │      3D ANATOMY       │
 │ - DenseNet-121 18-cls │       │ - Axial, Coronal, Sag │      │ - Three.js WebGL      │
 │ - PSPNet 14-seg masks │       │ - Synced Crosshairs   │      │ - 8 Organ Meshes      │
 │ - Focal Navigation    │       │ - HU Window Presets   │      │ - Orbit & Organ Focus │
 └───────────┬───────────┘       └───────────┬───────────┘      └───────────┬───────────┘
             │                               │                              │
             └───────────────────────┬───────┴──────────────────────────────┘
                                     │ Active Context
                                     ▼
                     ┌───────────────────────────────┐
                     │      Dynamic AI Co-Pilot      │
                     │ - Grounded in Active Study    │
                     │ - Zero Fabrication of Data   │
                     │ - Bidirectional Nav Sync     │
                     └───────────────────────────────┘
```

### Key Technical Achievements
1. **Production Radiograph Ingestion (`POST /api/xray/upload`)**:
   - Handles multipart file uploads up to 50 MB.
   - Validates file formats (`.png`, `.jpg`, `.jpeg`, `.tif`, `.tiff`, `.bmp`) and decodes pixel geometry via PIL ($\ge 64\times 64$).
   - Rejects empty, corrupted, or non-image files with HTTP 400 Bad Request and clean, human-readable error messages.
   - Automatically registers ingested studies with unique identifiers (`upload-<id>`) and persists them to `assets/demo/uploads/`.
   - Real-time DenseNet-121 and PSPNet inference executes on MPS hardware directly on custom ingested studies (~220ms runtime).
2. **Unified 4-Way Navigation**:
   - `[2D X-RAY]`: Frontal radiograph viewer, zoom/pan controls, layered anatomical segmentation masks, and clinical findings.
   - `[CT / MPR]`: Synchronized orthogonal Multi-Planar Reconstruction (Axial, Coronal, Sagittal) with real-time crosshair synchronization and HU window presets (Lung vs Mediastinum).
   - `[3D ANATOMY]`: Dedicated full-canvas browser-native Three.js 3D viewport displaying 8 TotalSegmentator organ meshes with bounding wireframe and camera tweening.
   - `[AI CO-PILOT]`: Assistive clinical intelligence panel docked right, accessible across all view modes without state disruption.
3. **Dynamic Co-Pilot Context**:
   - Decoupled from static constants (`"multimodal"`, `"demo-1"`).
   - Ingests the active study's actual DenseNet-121 probabilities, PSPNet segment centroids, or CT morphometric measurements.
   - Grounded natural language answers for any active study (normal, abnormal, or custom ingested).
4. **Preserved Selection & Focal Synchronization**:
   - Active study context, selected findings, active organ structures, crosshair coordinates, and segmentation visibility persist across all modality transitions.

### Explicit Phase 4 Boundary (Strictly Deferred)
- Slicer-derived 3D integration, cinematic volumetric shaders, GLB/OBJ/VTK exporters, and advanced volume raycasting belong exclusively to the future Phase 4.
- Phase 5 makes the existing Three.js 3D CT viewer and precomputed TotalSegmentator meshes operate cohesively within the unified workstation without altering the 3D rendering pipeline.

### Phase 5 Verification Results
- **Phase 5 Smoke Test**: `scripts/smoke_test_phase5.py` (25 / 25 tests PASSED, 100%).
- **Full System Regression**:
  - Phase 1 Suite: 8 / 8 tests PASSED (100%).
  - Phase 2 Suite: 20 / 20 tests PASSED (100%).
  - Phase 3 Suite: 26 / 26 tests PASSED (100%).
  - Cumulative: **79 / 79 tests PASSED** across all test suites.
- **Frontend Production Build**: `npm run build` succeeds with 0 TypeScript/bundling errors.


