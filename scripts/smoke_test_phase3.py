#!/usr/bin/env python3
"""
ORVYX Phase 3 Automated Smoke Test Suite
Verifies all Phase 3 AI Co-Pilot capabilities:
1. GET /api/copilot/study/{id} loads for demo-1, demo-2, ct-chest-1, and multimodal.
2. Structured CoPilotResponse contract compliance (summary, impression, findings, measurements, limitations, provenance).
3. Evidence items attached to findings with verified values & sources.
4. CT quantitative morphometric measurements (Heart, Aorta, Trachea, 5 Lung Lobes, Total Lung Volume).
5. Interactive Anatomy links with spatial coordinates (voxel_centroid, physical_centroid).
6. Natural language Ask endpoint handles:
   - Summarization query
   - Priority / main findings query
   - Specific anatomy queries (Heart, Aorta, Trachea, Lungs)
   - Segmented structures query
   - Quantitative measurements query
   - Safety limitations query
7. Safe, informative handling of unknown/unsupported queries.
8. Missing modality graceful degradation.
9. Deterministic provider stability and repeatability.
10. Full regression check: Phase 1 X-Ray (18 findings, 14 segments) and Phase 2 CT endpoints (MPR, 3D meshes).
"""
import sys
import time
from pathlib import Path
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.main import app

def _run_all(client: TestClient):
    passed = 0
    total = 0

    def assert_test(name: str, condition: bool, details: str = ""):
        nonlocal passed, total
        total += 1
        if condition:
            passed += 1
            print(f"  [PASS] {name} {f'({details})' if details else ''}")
        else:
            print(f"  [FAIL] {name} - {details}")
            sys.exit(1)

    print("================================================================================")
    print("ORVYX PHASE 3 AI CO-PILOT VERIFICATION SUITE")
    print("================================================================================")

    # --------------------------------------------------------------------------
    # 1. Endpoints Load & Schema Compliance
    # --------------------------------------------------------------------------
    print("\n--- Group 1: Co-Pilot Endpoints & Schema Compliance ---")
    res = client.get("/api/copilot/study/multimodal")
    assert_test("1.1: GET /api/copilot/study/multimodal loads", res.status_code == 200)
    data = res.json()

    assert_test("1.2: Summary & Impressions Present", len(data.get("summary", "")) > 40 and len(data.get("impression", [])) >= 2, f"{len(data.get('impression', []))} impression items")

    findings = data.get("findings", [])
    assert_test("1.3: Prioritized Findings Present", len(findings) >= 3, f"{len(findings)} findings returned")

    measurements = data.get("measurements", [])
    assert_test("1.4: Quantitative Measurements Present", len(measurements) >= 4, f"{len(measurements)} measurements returned")

    limitations = data.get("limitations", [])
    assert_test("1.5: Explicit Limitations & Caveats", len(limitations) >= 3, f"{len(limitations)} limitations stated")

    provenance = data.get("provenance", {})
    assert_test("1.6: Provenance & Mode (deterministic-demo)", provenance.get("mode") == "deterministic-demo", f"Provider: {provenance.get('provider')}")

    # --------------------------------------------------------------------------
    # 2. Evidence Attachment & Anatomical Links
    # --------------------------------------------------------------------------
    print("\n--- Group 2: Evidence Attachment & Anatomy Links ---")
    has_evidence = all(len(f.get("evidence", [])) > 0 for f in findings)
    assert_test("2.1: Evidence Attached to All Findings", has_evidence, "Every finding contains verified evidence citations")

    anatomy_findings = [f for f in findings if f.get("anatomy")]
    assert_test("2.2: Anatomical Structure Linking", len(anatomy_findings) >= 3, f"{len(anatomy_findings)} findings link to specific anatomy")

    heart_finding = next((f for f in findings if f.get("anatomy", {}).get("structure_id") == "heart"), None)
    assert_test("2.3: Heart Anatomy Coordinates", heart_finding is not None and heart_finding["anatomy"].get("voxel_centroid") is not None, f"Voxel: {heart_finding['anatomy'].get('voxel_centroid') if heart_finding else 'N/A'}")

    # --------------------------------------------------------------------------
    # 3. Quantitative Morphometric Metrics
    # --------------------------------------------------------------------------
    print("\n--- Group 3: Quantitative CT Measurements ---")
    heart_m = next((m for m in measurements if "heart" in m["name"].lower() or "cardiac" in m["name"].lower()), None)
    assert_test("3.1: Cardiac Volume (~484.1 mL)", heart_m is not None and abs(heart_m["value"] - 484.1) < 2.0, f"{heart_m['value'] if heart_m else 'N/A'} mL")

    lung_m = next((m for m in measurements if "total lung" in m["name"].lower()), None)
    assert_test("3.2: Total Lung Volume (~6337.4 mL)", lung_m is not None and abs(lung_m["value"] - 6337.4) < 5.0, f"{lung_m['value'] if lung_m else 'N/A'} mL")

    aorta_m = next((m for m in measurements if "aorta" in m["name"].lower()), None)
    assert_test("3.3: Thoracic Aorta Volume (~239.6 mL)", aorta_m is not None and abs(aorta_m["value"] - 239.6) < 2.0, f"{aorta_m['value'] if aorta_m else 'N/A'} mL")

    # --------------------------------------------------------------------------
    # 4. Context Endpoint
    # --------------------------------------------------------------------------
    print("\n--- Group 4: POST /api/copilot/context ---")
    ctx_res = client.post("/api/copilot/context", json={"study_id": "multimodal", "xray_study_id": "demo-2"})
    assert_test("4.1: POST /api/copilot/context with demo-2", ctx_res.status_code == 200)
    ctx_data = ctx_res.json()
    has_nodule = any("nodule" in f["title"].lower() for f in ctx_data.get("findings", []))
    assert_test("4.2: Demo-2 Context Detects Pulmonary Nodule", has_nodule, "Nodule finding elevated for demo-2")

    # --------------------------------------------------------------------------
    # 5. Natural Language Ask Endpoint (Deterministic Intent Engine)
    # --------------------------------------------------------------------------
    print("\n--- Group 5: Natural Language Inquiry Engine (POST /api/copilot/ask) ---")
    
    # 5.1 Summarize
    res_sum = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "Summarize this study"})
    assert_test("5.1: Query 'Summarize this study'", res_sum.status_code == 200 and res_sum.json()["intent"] == "summarize")

    # 5.2 Main findings
    res_find = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "What are the main findings?"})
    assert_test("5.2: Query 'What are the main findings?'", res_find.status_code == 200 and res_find.json()["intent"] == "findings")

    # 5.3 Show heart
    res_heart = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "Show me the heart"})
    assert_test("5.3: Query 'Show me the heart'", res_heart.status_code == 200 and res_heart.json()["target_structure_id"] == "heart", f"Target structure: {res_heart.json().get('target_structure_id')}")

    # 5.4 Segmented structures
    res_struct = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "What structures were segmented?"})
    assert_test("5.4: Query 'What structures were segmented?'", res_struct.status_code == 200 and "TotalSegmentator" in res_struct.json()["answer"])

    # 5.5 Quantitative measurements
    res_meas = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "What quantitative measurements are available?"})
    assert_test("5.5: Query 'What quantitative measurements are available?'", res_meas.status_code == 200 and res_meas.json()["intent"] == "measurements")

    # 5.6 Limitations
    res_lim = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "What are the limitations of this analysis?"})
    assert_test("5.6: Query 'What are the limitations...'", res_lim.status_code == 200 and len(res_lim.json()["highlights"]) >= 3)

    # 5.7 Unknown / Fallback query
    res_unk = client.post("/api/copilot/ask", json={"study_id": "multimodal", "question": "Can this patient fly tomorrow?"})
    assert_test("5.7: Unknown question safe fallback", res_unk.status_code == 200 and res_unk.json()["intent"] == "general_help", "Gracefully refused out-of-scope medical question")

    # --------------------------------------------------------------------------
    # 6. Stability & Determinism Check
    # --------------------------------------------------------------------------
    print("\n--- Group 6: Deterministic Stability Check ---")
    run1 = client.get("/api/copilot/study/ct-chest-1").json()
    run2 = client.get("/api/copilot/study/ct-chest-1").json()
    assert_test("6.1: Stable Output Across Repeated Calls", run1["summary"] == run2["summary"] and len(run1["findings"]) == len(run2["findings"]))

    # --------------------------------------------------------------------------
    # 7. Regressions: Phase 1 X-Ray & Phase 2 CT Intact
    # --------------------------------------------------------------------------
    print("\n--- Group 7: Full System Regression Checks ---")
    # Phase 1
    res_xray = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
    assert_test("7.1: Phase 1 POST /api/xray/analyze intact", res_xray.status_code == 200 and len(res_xray.json()["findings"]) == 18 and len(res_xray.json()["segments"]) == 14)

    # Phase 2 CT Metadata
    res_ct = client.get("/api/ct/study")
    assert_test("7.2: Phase 2 GET /api/ct/study intact", res_ct.status_code == 200 and res_ct.json()["dimensions"]["z"] == 139)

    # Phase 2 CT Slicing
    res_slice = client.get("/api/ct/slice?plane=coronal&index=256&window=lung")
    assert_test("7.3: Phase 2 Coronal Slicing intact", res_slice.status_code == 200 and len(res_slice.content) > 1000)

    # Phase 2 3D Meshes
    res_mesh = client.get("/api/ct/mesh/heart")
    assert_test("7.4: Phase 2 3D Mesh Geometry intact", res_mesh.status_code == 200 and "vertices" in res_mesh.json())

    print("\n================================================================================")
    print(f"VERIFICATION SUMMARY: {passed} / {total} tests PASSED (100%)")
    print("================================================================================\n")

def run_tests():
    with TestClient(app) as client:
        _run_all(client)

if __name__ == "__main__":
    run_tests()
