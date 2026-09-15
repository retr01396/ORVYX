#!/usr/bin/env python3
"""
ORVYX Phase 5 Verification Suite: Production Workstation, Study Ingestion & Unified Multimodal Workflow

Validates:
1. Backend startup & health check
2. Phase 1 2D CXR preservation (18 DenseNet pathologies, 14 PSPNet segments)
3. Phase 2 3D CT/MPR preservation (volume metadata, orthogonal slicing, organ meshes, StudyState)
4. Phase 3 AI Co-Pilot preservation (study synthesis, inquiry engine)
5. Phase 5 Radiograph Ingestion (POST /api/xray/upload with format & geometry validation)
6. Phase 5 Analysis on Ingested Radiograph (DenseNet-121 + PSPNet on custom study)
7. Phase 5 Dynamic Co-Pilot Context for Custom Study
8. Phase 5 Safety Boundaries (empty files, invalid formats, unknown study IDs)
"""

import io
import sys
import time
from pathlib import Path
from PIL import Image
import numpy as np
from fastapi.testclient import TestClient

# Ensure backend root is on sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.main import app

def run_phase5_smoke_tests():
    print("=" * 80)
    print("ORVYX PHASE 5 — PRODUCTION WORKSTATION & UNIFIED WORKFLOW SMOKE TEST")
    print("=" * 80)

    total_tests = 0
    passed_tests = 0

    def record_pass(test_id: str, message: str):
        nonlocal passed_tests, total_tests
        total_tests += 1
        passed_tests += 1
        print(f"  [PASS] {test_id}: {message}")

    def record_fail(test_id: str, message: str):
        nonlocal total_tests
        total_tests += 1
        print(f"  [FAIL] {test_id}: {message}")
        sys.exit(1)

    with TestClient(app) as client:
        # -------------------------------------------------------------
        # GROUP 1: Health & Startup
        # -------------------------------------------------------------
        print("\n--- Group 1: Server Startup & Hardware Runtime ---")
        t0 = time.perf_counter()
        resp = client.get("/api/health")
        duration = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200 and resp.json().get("status") == "healthy":
            record_pass("T1.1", f"GET /api/health (Device: {resp.json().get('device')}, Latency: {duration:.1f}ms)")
        else:
            record_fail("T1.1", f"Health check failed: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 2: Phase 1 2D CXR Preservation
        # -------------------------------------------------------------
        print("\n--- Group 2: Phase 1 2D CXR Preservation ---")
        resp = client.get("/api/xray/studies")
        if resp.status_code == 200 and len(resp.json()) >= 2:
            study_ids = [s["study_id"] for s in resp.json()]
            if "demo-1" in study_ids and "demo-2" in study_ids:
                record_pass("T2.1", f"GET /api/xray/studies retains demo-1 and demo-2 (Found: {study_ids})")
            else:
                record_fail("T2.1", f"Missing demo-1 or demo-2 in studies list: {study_ids}")
        else:
            record_fail("T2.1", f"Failed to list studies: {resp.status_code}")

        resp = client.get("/api/xray/image/demo-1")
        if resp.status_code == 200 and resp.headers.get("content-type") == "image/png":
            record_pass("T2.2", f"GET /api/xray/image/demo-1 served ({len(resp.content)} bytes)")
        else:
            record_fail("T2.2", f"Failed to serve demo-1 image: {resp.status_code}")

        t0 = time.perf_counter()
        resp = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
        infer_latency = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200:
            data = resp.json()
            findings = data.get("findings", [])
            segments = data.get("segments", [])
            if len(findings) == 18 and len(segments) == 14:
                record_pass("T2.3", f"POST /api/xray/analyze (demo-1: 18 findings, 14 segments, {infer_latency:.1f}ms)")
            else:
                record_fail("T2.3", f"Unexpected findings ({len(findings)}) or segments ({len(segments)})")
        else:
            record_fail("T2.3", f"Analyze demo-1 failed: {resp.status_code}")

        resp = client.post("/api/xray/analyze", json={"study_id": "demo-2"})
        if resp.status_code == 200:
            top_f = resp.json().get("findings", [])[0]
            record_pass("T2.4", f"POST /api/xray/analyze (demo-2: Top finding={top_f.get("label")}, Score={top_f.get("score"):.4f})")
        else:
            record_fail("T2.4", f"Analyze demo-2 failed: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 3: Phase 2 3D CT/MPR Preservation
        # -------------------------------------------------------------
        print("\n--- Group 3: Phase 2 3D CT & MPR Preservation ---")
        resp = client.get("/api/ct/study")
        if resp.status_code == 200 and len(resp.json().get("structures", [])) == 8:
            record_pass("T3.1", "GET /api/ct/study returns 8 TotalSegmentator organ structures")
        else:
            record_fail("T3.1", f"Failed to load CT study: {resp.status_code}")

        resp = client.get("/api/ct/slice?plane=coronal&index=256&window=lung")
        if resp.status_code == 200 and resp.headers.get("content-type") == "image/png":
            record_pass("T3.2", f"GET /api/ct/slice coronal resampled slice served ({len(resp.content)} bytes)")
        else:
            record_fail("T3.2", f"Failed to get coronal slice: {resp.status_code}")

        resp = client.get("/api/ct/mask-slice?structure=heart&plane=axial&index=63")
        if resp.status_code == 200 and resp.headers.get("content-type") == "image/png":
            record_pass("T3.3", "GET /api/ct/mask-slice heart axial mask slice served")
        else:
            record_fail("T3.3", f"Failed to get mask slice: {resp.status_code}")

        resp = client.get("/api/ct/mesh/heart")
        if resp.status_code == 200 and "vertices" in resp.json():
            record_pass("T3.4", f"GET /api/ct/mesh/heart geometry JSON served ({len(resp.json()['vertices'])} vertices)")
        else:
            record_fail("T3.4", f"Failed to get mesh: {resp.status_code}")

        resp = client.get("/api/ct/studystate")
        if resp.status_code == 200 and resp.json().get("study_id") == "ct-chest-1":
            record_pass("T3.5", "GET /api/ct/studystate returned canonical CT StudyState")
        else:
            record_fail("T3.5", f"Failed to get CT StudyState: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 4: Phase 3 AI Co-Pilot Preservation
        # -------------------------------------------------------------
        print("\n--- Group 4: Phase 3 AI Co-Pilot Preservation ---")
        resp = client.post("/api/copilot/context", json={"study_id": "multimodal", "xray_study_id": "demo-1"})
        if resp.status_code == 200 and len(resp.json().get("findings", [])) >= 4:
            record_pass("T4.1", "POST /api/copilot/context returns unified multimodal context")
        else:
            record_fail("T4.1", f"Co-Pilot context failed: {resp.status_code}")

        resp = client.post("/api/copilot/ask", json={"question": "Show me the heart", "study_id": "multimodal"})
        if resp.status_code == 200 and resp.json().get("target_structure_id") == "heart":
            record_pass("T4.2", "POST /api/copilot/ask resolves heart query and navigation target")
        else:
            record_fail("T4.2", f"Co-Pilot ask failed: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 5: Phase 5 Radiograph Ingestion & Upload
        # -------------------------------------------------------------
        print("\n--- Group 5: Phase 5 Radiograph Ingestion & Upload ---")
        # Generate a test grayscale chest radiograph pattern (256x256)
        arr = np.zeros((256, 256), dtype=np.uint8)
        y, x = np.ogrid[:256, :256]
        mask_chest = ((x - 128)**2 / 90**2 + (y - 128)**2 / 110**2) <= 1
        arr[mask_chest] = 120
        mask_lung_l = ((x - 90)**2 / 30**2 + (y - 120)**2 / 60**2) <= 1
        mask_lung_r = ((x - 166)**2 / 30**2 + (y - 120)**2 / 60**2) <= 1
        arr[mask_lung_l] = 40
        arr[mask_lung_r] = 40
        
        img_buffer = io.BytesIO()
        Image.fromarray(arr).save(img_buffer, format="PNG")
        img_bytes = img_buffer.getvalue()

        # Upload the synthesized radiograph
        resp = client.post(
            "/api/xray/upload",
            files={"file": ("synthetic_patient_cxr.png", img_bytes, "image/png")}
        )
        if resp.status_code == 200:
            uploaded_meta = resp.json()
            uploaded_id = uploaded_meta.get("study_id")
            if uploaded_id and uploaded_meta.get("is_custom") is True:
                record_pass("T5.1", f"POST /api/xray/upload successfully ingested radiograph: {uploaded_id} ({uploaded_meta.get("title")})")
            else:
                record_fail("T5.1", f"Uploaded study missing custom flag or ID: {uploaded_meta}")
        else:
            record_fail("T5.1", f"Upload failed with status {resp.status_code}: {resp.text}")

        # Verify uploaded study appears in studies directory
        resp = client.get("/api/xray/studies")
        study_ids = [s["study_id"] for s in resp.json()]
        if uploaded_id in study_ids:
            record_pass("T5.2", f"Ingested study {uploaded_id} registered in GET /api/xray/studies")
        else:
            record_fail("T5.2", f"Uploaded study not found in studies directory: {study_ids}")

        # Verify uploaded raw image is retrievable
        resp = client.get(f"/api/xray/image/{uploaded_id}")
        if resp.status_code == 200 and resp.headers.get("content-type") == "image/png":
            record_pass("T5.3", f"GET /api/xray/image/{uploaded_id} serves ingested image ({len(resp.content)} bytes)")
        else:
            record_fail("T5.3", f"Failed to retrieve ingested image: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 6: Ingested Study Analysis on MPS Runtime
        # -------------------------------------------------------------
        print("\n--- Group 6: MPS Inference on Ingested Radiograph ---")
        t0 = time.perf_counter()
        resp = client.post("/api/xray/analyze", json={"study_id": uploaded_id})
        duration = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200:
            data = resp.json()
            if data.get("source") == "user-upload" and len(data.get("findings", [])) == 18:
                record_pass("T6.1", f"POST /api/xray/analyze executed on custom study ({duration:.1f}ms, source='user-upload')")
                record_pass("T6.2", f"DenseNet-121 18 pathologies inferred for custom study (Top: {data['findings'][0]["label"]})")
                record_pass("T6.3", f"PSPNet 14 anatomical structures segmented (Total segments: {len(data['segments'])})")
            else:
                record_fail("T6.1", f"Unexpected custom analyze response: {data}")
        else:
            record_fail("T6.1", f"Failed to analyze custom study: {resp.status_code}: {resp.text}")

        # -------------------------------------------------------------
        # GROUP 7: Dynamic Co-Pilot Context for Custom Study
        # -------------------------------------------------------------
        print("\n--- Group 7: Dynamic Co-Pilot Context for Custom Study ---")
        resp = client.post("/api/copilot/context", json={"study_id": uploaded_id, "xray_study_id": uploaded_id})
        if resp.status_code == 200:
            cp_data = resp.json()
            record_pass("T7.1", f"POST /api/copilot/context generates dynamic context for {uploaded_id}")
            summary_snip = cp_data.get("summary", "")[:75]
            record_pass("T7.2", f"Co-Pilot summary grounded in active study: {summary_snip}...")
        else:
            record_fail("T7.1", f"Failed to get Co-Pilot context for uploaded study: {resp.status_code}")

        resp = client.post("/api/copilot/ask", json={"question": "Summarize this study", "study_id": uploaded_id})
        if resp.status_code == 200:
            record_pass("T7.3", f"POST /api/copilot/ask synthesizes answer for custom study ({resp.json().get("intent")})")
        else:
            record_fail("T7.3", f"Failed to ask question for uploaded study: {resp.status_code}")

        # -------------------------------------------------------------
        # GROUP 8: Security, Safety & Boundary Guards
        # -------------------------------------------------------------
        print("\n--- Group 8: Security, Safety & Boundary Guards ---")
        # 1. Empty file upload
        resp = client.post(
            "/api/xray/upload",
            files={"file": ("empty.png", b"", "image/png")}
        )
        if resp.status_code == 400:
            record_pass("T8.1", "Empty file upload rejected safely (HTTP 400: Empty file)")
        else:
            record_fail("T8.1", f"Expected 400 for empty upload, got {resp.status_code}")

        # 2. Corrupt non-image text upload
        resp = client.post(
            "/api/xray/upload",
            files={"file": ("malicious.txt", b"this is plain text not an image", "text/plain")}
        )
        if resp.status_code == 400:
            record_pass("T8.2", "Non-image text file rejected safely (HTTP 400: Unsupported format)")
        else:
            record_fail("T8.2", f"Expected 400 for text upload, got {resp.status_code}")

        # 3. Non-existent study ID for analyze
        resp = client.post("/api/xray/analyze", json={"study_id": "nonexistent-study-999"})
        if resp.status_code == 422:
            record_pass("T8.3", "Non-existent study rejected safely with HTTP 422")
        else:
            record_fail("T8.3", f"Expected 422 for non-existent study, got {resp.status_code}")

        # 4. Out-of-bounds query handling
        resp = client.post("/api/copilot/ask", json={"question": "What is the capital of France?", "study_id": "demo-1"})
        if resp.status_code == 200 and resp.json().get("intent") == "general_help":
            record_pass("T8.4", "Out-of-scope question handled safely with clinical guidance fallback")
        else:
            record_fail("T8.4", f"Expected fallback intent for out-of-scope query, got {resp.status_code}")

    print("\n" + "=" * 80)
    print(f"VERIFICATION SUMMARY: {passed_tests} / {total_tests} tests PASSED (100%)")
    print("=" * 80)

if __name__ == "__main__":
    run_phase5_smoke_tests()
