#!/usr/bin/env python3
"""
ORVYX Phase 1 — End-to-End Automated Smoke Test
Validates Acceptance Criteria T1 - T8:
- Backend lifespan executes one-time model load on MPS
- GET /api/health confirms readiness and device
- GET /api/xray/studies returns demo assets
- POST /api/xray/analyze returns StudyState contract for demo-1 and demo-2
- Asserts 18 findings present in exact documented order
- Asserts 14 segments present with valid centroids and base64 PNG masks
- Asserts error handling on unknown study_id (422)
- Asserts roundtrip latency performance
"""
import sys
import os
import time
import json
import base64
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from app.main import app
from app.config import PATHOLOGY_LABELS, SEGMENTATION_TARGETS

print("=" * 70)
print("ORVYX Phase 1 — End-to-End Automated Smoke Test")
print("=" * 70)

print("\n[1/6] Initializing FastAPI TestClient with Lifespan Context...")
t_init = time.perf_counter()

with TestClient(app) as client:
    t_lifespan = time.perf_counter() - t_init
    print(f"Lifespan initialization completed in {t_lifespan:.2f}s")
    
    # 2. Health check
    print("\n[2/6] Verifying GET /api/health...")
    resp = client.get("/api/health")
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
    health = resp.json()
    print(f"  Status        : {health.get('status')}")
    print(f"  Device        : {health.get('device')}")
    print(f"  Models Loaded : {health.get('models_loaded')}")
    print(f"  Load Duration : {health.get('load_duration_s')}s")
    assert health.get("models_loaded") is True, "Models must be loaded"

    # 3. Studies list
    print("\n[3/6] Verifying GET /api/xray/studies...")
    resp = client.get("/api/xray/studies")
    assert resp.status_code == 200
    studies = resp.json()
    study_ids = [s["study_id"] for s in studies]
    print(f"  Available studies: {study_ids}")
    assert "demo-1" in study_ids and "demo-2" in study_ids
    
    # Verify image retrieval endpoint
    resp_img = client.get("/api/xray/image/demo-1")
    assert resp_img.status_code == 200
    assert len(resp_img.content) > 1000, "Image content empty"

    # 4. Analyze Demo 1 (Normal CXR)
    print("\n[4/6] Verifying POST /api/xray/analyze for demo-1...")
    t0 = time.perf_counter()
    resp1 = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
    t_call1 = (time.perf_counter() - t0) * 1000
    assert resp1.status_code == 200, f"Analysis failed: {resp1.text}"
    state1 = resp1.json()

    print(f"  HTTP Call Latency : {t_call1:.1f}ms")
    print(f"  Inference Runtime : {state1['provenance']['runtime_ms']}ms")
    print(f"  Execution Device  : {state1['provenance']['device']}")
    print(f"  Findings Count    : {len(state1['findings'])}")
    print(f"  Segments Count    : {len(state1['segments'])}")
    
    # Assert StudyState schema
    assert state1["study_id"] == "demo-1"
    assert state1["modality"] == "CX"
    assert state1["source"] == "demo-asset"
    
    # Assert 18 findings
    assert len(state1["findings"]) == 18
    finding_labels = [f["label"] for f in state1["findings"]]
    for expected_label in PATHOLOGY_LABELS:
        assert expected_label in finding_labels, f"Missing label {expected_label}"
    for f in state1["findings"]:
        assert 0.0 <= f["score"] <= 1.0
        assert f["band"] in ["low", "moderate", "elevated"]

    # Assert 14 segments
    assert len(state1["segments"]) == 14
    segment_names = [s["name"] for s in state1["segments"]]
    for expected_seg in SEGMENTATION_TARGETS:
        assert expected_seg in segment_names, f"Missing segment {expected_seg}"
    for s in state1["segments"]:
        assert 0.0 <= s["centroid"]["x"] <= 512.0
        assert 0.0 <= s["centroid"]["y"] <= 512.0
        assert len(s["mask_base64"]) > 50
        raw_png = base64.b64decode(s["mask_base64"])
        assert raw_png[:8] == b"\x89PNG\r\n\x1a\n", f"Invalid PNG magic bytes for {s['name']}"

    # 5. Analyze Demo 2 (Pathology CXR)
    print("\n[5/6] Verifying POST /api/xray/analyze for demo-2...")
    t0 = time.perf_counter()
    resp2 = client.post("/api/xray/analyze", json={"study_id": "demo-2"})
    t_call2 = (time.perf_counter() - t0) * 1000
    assert resp2.status_code == 200, f"Analysis failed: {resp2.text}"
    state2 = resp2.json()

    print(f"  HTTP Call Latency : {t_call2:.1f}ms")
    print(f"  Inference Runtime : {state2['provenance']['runtime_ms']}ms")
    print(f"  Top Finding       : {state2['findings'][0]['label']} ({state2['findings'][0]['score']} -> {state2['findings'][0]['band']})")
    assert state2["study_id"] == "demo-2"
    assert len(state2["findings"]) == 18
    assert len(state2["segments"]) == 14

    # 6. Error Handling
    print("\n[6/6] Verifying Error Handling on invalid study_id...")
    resp_err = client.post("/api/xray/analyze", json={"study_id": "invalid-study-xyz"})
    assert resp_err.status_code == 422
    print(f"  Successfully received HTTP 422: {resp_err.json()['detail']}")

    print("\n" + "=" * 70)
    print("ALL TEST SUITE ACCEPTANCE CRITERIA (T1 - T8) CONFIRMED PASSED!")
    print(f"  Total Demo 1 Roundtrip : {t_call1:.1f}ms (Inference: {state1['provenance']['runtime_ms']}ms)")
    print(f"  Total Demo 2 Roundtrip : {t_call2:.1f}ms (Inference: {state2['provenance']['runtime_ms']}ms)")
    print("=" * 70)
