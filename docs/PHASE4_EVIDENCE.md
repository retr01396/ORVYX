# ORVYX Phase 4 Evidence: 2D X-Ray → Cinematic 3D Thoracic Reconstruction & Multi-Provider Co-Pilot

## 1. Overview & Architectural Goals

Phase 4 bridges 2D Chest Radiography (Phase 1) and 3D Cross-Sectional CT (Phase 2) into a continuous, cinematic 2D → 3D diagnostic experience, coupled with a production-grade multi-provider AI Co-Pilot architecture.

### Key Architectural Tenets
1. **Never Fabricate Patient-Specific 3D Anatomy**: A single 2D projection cannot yield depth-accurate 3D patient anatomy. All X-ray-derived 3D representations are explicitly designated and prominently labeled as **AI-ESTIMATED THORACIC ANATOMY (Template)** with clear medical disclaimers in both UI and API responses.
2. **GPU-Accelerated Particle Formation**: Renders 12,000 to 60,000 particles converging from outer space into thoracic bone (rib cage, sternum, spine, clavicles, scapulae) and visceral organ templates (lungs, heart, trachea) at ~60 FPS without DOM overhead or per-particle React state.
3. **Multi-Provider Co-Pilot Architecture**:
   - `DeterministicProvider`: 100% offline, zero data leakage, verified quantitative citations.
   - `CustomLLMProvider`: Connects to self-hosted OpenAI-compatible LLM endpoints (`CUSTOM_LLM_BASE_URL`).
   - `APIProvider`: External API gateway (`AI_API_BASE_URL`, `AI_API_KEY`) with clear data disclosure alerts.
   - Resilient fallback: Any unconfigured or failing external provider gracefully degrades to the deterministic engine.
   - Zero secrets exposed to the frontend (`/api/copilot/provider-info`).

---

## 2. Verified Endpoints & Contracts

### 2.1 GET `/api/reconstruction/template`
Returns the standardized thoracic template definition with 9 anatomical structures and 18 finding mappings:
```json
{
  "label": "AI-ESTIMATED THORACIC ANATOMY",
  "disclaimer": "This 3D model is an anatomical template informed by X-ray AI findings. It is NOT a patient-specific CT reconstruction...",
  "structures": [
    {"id": "rib_cage", "label": "Rib Cage (12 pairs)", "group": "Skeleton", "color": "#a5c8f0", "particle_weight": 0.35, "formation_order": 1, "ct_derived": false},
    {"id": "sternum", "label": "Sternum", "group": "Skeleton", "color": "#c8d8f0", "particle_weight": 0.07, "formation_order": 2, "ct_derived": false},
    {"id": "thoracic_spine", "label": "Thoracic Spine (T1–T12)", "group": "Skeleton", "color": "#b0c4e8", "particle_weight": 0.12, "formation_order": 3, "ct_derived": false},
    {"id": "clavicles", "label": "Clavicles", "group": "Skeleton", "color": "#d0e4f8", "particle_weight": 0.06, "formation_order": 4, "ct_derived": false},
    {"id": "scapulae", "label": "Scapulae", "group": "Skeleton", "color": "#b8d0ec", "particle_weight": 0.05, "formation_order": 5, "ct_derived": false},
    {"id": "lung_left", "label": "Left Lung", "group": "Soft Tissue", "color": "#06b6d4", "particle_weight": 0.10, "formation_order": 6, "ct_derived": true},
    {"id": "lung_right", "label": "Right Lung", "group": "Soft Tissue", "color": "#0891b2", "particle_weight": 0.10, "formation_order": 6, "ct_derived": true},
    {"id": "heart", "label": "Heart", "group": "Soft Tissue", "color": "#f43f5e", "particle_weight": 0.09, "formation_order": 7, "ct_derived": true},
    {"id": "trachea", "label": "Trachea", "group": "Soft Tissue", "color": "#a78bfa", "particle_weight": 0.06, "formation_order": 8, "ct_derived": true}
  ],
  "finding_map": {
    "Cardiomegaly": ["heart"],
    "Fracture": ["rib_cage", "clavicles", "scapulae"],
    "Effusion": ["lung_left", "lung_right"],
    "Hernia": ["sternum"],
    ...
  }
}
```

### 2.2 GET `/api/reconstruction/structures/validate/{structure_id}`
- Valid structure ID (`rib_cage`, `heart`) → HTTP 200 with structure definition.
- Invalid/fabricated ID (`pancreas`, `kidney`, `unknown`) → HTTP 404.

### 2.3 GET `/api/reconstruction/status/{study_id}`
- Returns reconstruction phase (`idle` | `analyzing` | `building` | `converging` | `complete`), estimated flag (`true`), and status message.
- Sanitizes study_id against directory traversal.

### 2.4 GET `/api/copilot/provider-info`
- Exposes provider metadata (`provider_mode`, `provider_name`, `is_external`, `external_warning`, `custom_llm_configured`, `api_configured`).
- Strictly sanitizes credentials — zero API keys or secrets transmitted.

---

## 3. Frontend Implementation & Performance

### 3.1 Components Created
- `ThoracicReconstructionViewer.tsx`: Three.js WebGL canvas rendering GPU-accelerated particle formation via custom GLSL `ShaderMaterial`. Implements dynamic quality adaptation (High: 60k particles, Medium: 30k, Low: 12k), interactive OrbitControls, raycasting structure selection, and camera reset/replay controls.
- `ReconstructionPanel.tsx`: Sidebar tracking the 5-step reconstruction lifecycle (Image Uploaded → AI Analysis → Extracting Geometry → Generating 3D Model → Complete), structure visibility toggles, finding alerts, and disclaimer notices.
- `types/reconstruction.ts`: Type definitions for `ThoracicStructure`, `ThoracicTemplate`, `ReconstructionPhase`, `QualityTier`, and finding mappings.

### 3.2 2D ↔ 3D Synchronized Flow
1. User selects a finding in 2D Viewport or InsightsPanel (e.g. Cardiomegaly / Fracture).
2. User clicks "View in 3D Recon" or selects the "3D RECON" tab in the Header.
3. The viewport seamlessly switches to the split reconstruction view.
4. Particles emit from the 2D projection space and smoothly assemble into the 3D thoracic volume.
5. Highlighted structures (e.g. heart for cardiomegaly, ribs/clavicles for fracture) illuminate in vivid cyan (`#06b6d4`).
6. Once complete, solid interactive meshes enable OrbitControls and structure raycasting inspection.

---

## 4. Test Verification Summary

All Phase 4 tests pass deterministically:
- `smoke_test_phase4.py`: **42 / 42 tests PASSED**
- Cumulative suite (Phases 1, 2, 3, 4, 5, 6): **167 / 167 tests PASSED**
- Production TypeScript build (`tsc -b && vite build`): **PASS in 138ms**
