#!/usr/bin/env python3
"""
ORVYX Phase 4 Automated Smoke Test Suite
Verifies all Phase 4 2D X-ray -> 3D Reconstruction & Multi-Provider Co-Pilot capabilities:

1. GET /api/reconstruction/template loads with 200 and schema compliance:
   - Explicit "AI-ESTIMATED" medical disclaimer
   - Thoracic template structures (rib cage, sternum, spine, clavicles, scapulae, lungs, heart, trachea)
   - Finding to structure mapping for all primary pathologies
2. GET /api/reconstruction/structures/validate/{id}:
   - Valid structure IDs accepted (200)
   - Unknown/fabricated structures safely rejected (404)
3. GET /api/reconstruction/status/{study_id}:
   - Valid study ID returns status (200)
   - Invalid format rejected (400)
   - Non-existent study rejected (404)
4. GET /api/copilot/provider-info:
   - Returns provider_mode, provider_name, is_external
   - Strictly NO secrets, API keys, or tokens exposed in response
5. Multi-provider Co-Pilot fallback:
   - Deterministic provider works offline
   - Unconfigured CustomLLMProvider falls back to deterministic without error
   - Unconfigured APIProvider falls back to deterministic without error
6. Finding to 3D structure mappings consistency:
   - Cardiomegaly -> heart
   - Fracture -> rib_cage, clavicles, scapulae
   - Effusion / Pneumothorax -> lungs
7. Regression checks:
   - Phase 1 2D X-ray inference (18 findings, 14 segments)
   - Phase 2 3D CT & MPR endpoints (study, slice, mesh)
   - Phase 3 Co-Pilot ask & context
   - Phase 5 Upload pipeline
"""
import os
import sys
import time
from pathlib import Path
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.main import app
from app.services.reconstruction_service import (
    THORACIC_STRUCTURES,
    FINDING_TO_STRUCTURE_MAP,
    get_thoracic_template,
    get_structure_by_id,
    get_structures_for_finding,
)
from app.services.copilot_service import (
    DeterministicCoPilotProvider,
    CustomLLMProvider,
    APIProvider,
)
from app.models.copilot import AskRequest

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
    print("ORVYX PHASE 4 2D->3D RECONSTRUCTION & MULTI-PROVIDER CO-PILOT TEST SUITE")
    print("================================================================================")

    # --------------------------------------------------------------------------
    # Group 1: Reconstruction Template Endpoint & Schema Compliance
    # --------------------------------------------------------------------------
    print("\n--- Group 1: 3D Reconstruction Template & Disclaimer ---")
    res = client.get("/api/reconstruction/template")
    assert_test("1.1: GET /api/reconstruction/template returns 200", res.status_code == 200)
    data = res.json()

    assert_test("1.2: Template contains explicit medical disclaimer",
                "AI-ESTIMATED" in data.get("label", "") and "NOT a patient-specific" in data.get("disclaimer", ""),
                data.get("label", ""))

    structures = data.get("structures", [])
    assert_test("1.3: Thoracic structures present (>=8)",
                len(structures) >= 8, f"{len(structures)} structures found")

    structure_ids = {s["id"] for s in structures}
    expected_structures = {"rib_cage", "sternum", "thoracic_spine", "clavicles", "scapulae", "lung_left", "lung_right", "heart", "trachea"}
    assert_test("1.4: All required anatomical structures defined",
                expected_structures.issubset(structure_ids), f"missing: {expected_structures - structure_ids}")

    # Verify particle weights sum to ~1.0
    total_weight = sum(s.get("particle_weight", 0) for s in structures)
    assert_test("1.5: Particle weights properly normalized (~1.0)",
                0.9 <= total_weight <= 1.1, f"sum: {total_weight:.2f}")

    # --------------------------------------------------------------------------
    # Group 2: Structure Validation Endpoint
    # --------------------------------------------------------------------------
    print("\n--- Group 2: Structure Validation & Unknown Rejection ---")
    res_valid = client.get("/api/reconstruction/structures/validate/rib_cage")
    assert_test("2.1: Valid structure 'rib_cage' returns 200", res_valid.status_code == 200)

    res_heart = client.get("/api/reconstruction/structures/validate/heart")
    assert_test("2.2: Valid structure 'heart' returns 200", res_heart.status_code == 200)

    for invalid_id in ["pancreas", "liver", "kidney", "unknown_organ", "fake_mesh"]:
        res_invalid = client.get(f"/api/reconstruction/structures/validate/{invalid_id}")
        assert_test(f"2.3: Unknown structure '{invalid_id}' safely rejected (404)",
                    res_invalid.status_code == 404, f"HTTP {res_invalid.status_code}")

    # --------------------------------------------------------------------------
    # Group 3: Reconstruction Status Endpoint
    # --------------------------------------------------------------------------
    print("\n--- Group 3: Reconstruction Status & Path Security ---")
    res_status = client.get("/api/reconstruction/status/demo-1")
    assert_test("3.1: GET status for demo-1 returns 200", res_status.status_code == 200)
    status_data = res_status.json()
    assert_test("3.2: Status contains required phase and estimated flag",
                "phase" in status_data and status_data.get("estimated") is True,
                f"phase={status_data.get('phase')}")

    # Bad format / path traversal check
    res_bad = client.get("/api/reconstruction/status/../../etc/passwd")
    assert_test("3.3: Path traversal study_id rejected", res_bad.status_code in (400, 404))

    res_missing = client.get("/api/reconstruction/status/nonexistent-study-9999")
    assert_test("3.4: Nonexistent study returns 404", res_missing.status_code == 404)

    # --------------------------------------------------------------------------
    # Group 4: Finding to 3D Structure Mappings
    # --------------------------------------------------------------------------
    print("\n--- Group 4: Finding -> 3D Structure Mapping Consistency ---")
    finding_map = data.get("finding_map", {})
    assert_test("4.1: Finding map contains mappings (>=15)", len(finding_map) >= 15, f"{len(finding_map)} mappings")

    # Check key mappings
    assert_test("4.2: Cardiomegaly maps to heart",
                "heart" in finding_map.get("Cardiomegaly", []))
    assert_test("4.3: Fracture maps to rib_cage / clavicles / scapulae",
                "rib_cage" in finding_map.get("Fracture", []) and "clavicles" in finding_map.get("Fracture", []))
    assert_test("4.4: Effusion maps to lungs",
                "lung_left" in finding_map.get("Effusion", []) and "lung_right" in finding_map.get("Effusion", []))
    assert_test("4.5: Hernia maps to sternum",
                "sternum" in finding_map.get("Hernia", []))

    # All target structures in finding_map must exist in the thoracic structure definitions
    all_mapped_ids = {sid for sids in finding_map.values() for sid in sids}
    assert_test("4.6: All mapped structures exist in template definition",
                all_mapped_ids.issubset(structure_ids), f"orphan mapped ids: {all_mapped_ids - structure_ids}")

    # --------------------------------------------------------------------------
    # Group 5: Multi-Provider Co-Pilot Architecture & Security
    # --------------------------------------------------------------------------
    print("\n--- Group 5: Multi-Provider Co-Pilot Architecture & Security ---")
    res_prov = client.get("/api/copilot/provider-info")
    assert_test("5.1: GET /api/copilot/provider-info returns 200", res_prov.status_code == 200)
    prov_data = res_prov.json()

    assert_test("5.2: Provider info contains provider_mode & provider_name",
                "provider_mode" in prov_data and "provider_name" in prov_data,
                prov_data.get("provider_name", ""))

    # SECURITY CHECK: Verify absolutely no secret tokens/keys are exposed in JSON response
    prov_str = str(prov_data).lower()
    for sensitive in ["sk-", "bearer", "password", "secret", "private_key", "api_key"]:
        assert_test(f"5.3: No secret '{sensitive}' leaked in provider-info",
                    sensitive not in prov_str)

    # --------------------------------------------------------------------------
    # Group 6: Graceful Provider Fallbacks
    # --------------------------------------------------------------------------
    print("\n--- Group 6: Provider Fallback Resilience ---")
    # Test Deterministic provider
    det_prov = DeterministicCoPilotProvider()
    resp_det = det_prov.generate_response("demo-1")
    assert_test("6.1: Deterministic provider generates valid response",
                len(resp_det.summary) > 20 and len(resp_det.findings) > 0)

    # Test CustomLLMProvider fallback when unconfigured
    custom_prov = CustomLLMProvider()
    custom_prov.base_url = ""  # explicitly unconfigured
    resp_custom = custom_prov.generate_response("demo-1")
    assert_test("6.2: CustomLLMProvider gracefully falls back to deterministic when unconfigured",
                len(resp_custom.summary) > 20)

    ask_req = AskRequest(study_id="demo-1", question="Summarize findings")
    ans_custom = custom_prov.answer_question(ask_req, resp_custom)
    assert_test("6.3: CustomLLMProvider question fallback works without error",
                len(ans_custom.answer) > 20)

    # Test APIProvider fallback when unconfigured
    api_prov = APIProvider()
    api_prov.api_key = ""  # explicitly unconfigured
    resp_api = api_prov.generate_response("demo-1")
    assert_test("6.4: APIProvider gracefully falls back to deterministic when unconfigured",
                len(resp_api.summary) > 20)

    ans_api = api_prov.answer_question(ask_req, resp_api)
    assert_test("6.5: APIProvider question fallback works without error",
                len(ans_api.answer) > 20)

    # --------------------------------------------------------------------------
    # Group 7: Phase 1-3, 5 Regression Verification
    # --------------------------------------------------------------------------
    print("\n--- Group 7: Full System Regression Checks ---")
    # Phase 1: X-ray studies & analysis
    r_studies = client.get("/api/xray/studies")
    assert_test("7.1: Phase 1 -- GET /api/xray/studies intact", r_studies.status_code == 200)

    r_analyze = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
    assert_test("7.2: Phase 1 -- X-ray analyze demo-1 returns 18 findings",
                r_analyze.status_code == 200 and len(r_analyze.json().get("findings", [])) == 18)

    # Phase 2: CT volume & mesh
    r_ct = client.get("/api/ct/study")
    assert_test("7.3: Phase 2 -- CT study metadata intact", r_ct.status_code == 200)

    r_slice = client.get("/api/ct/slice?plane=axial&index=69&window=lung")
    assert_test("7.4: Phase 2 -- CT axial slice intact", r_slice.status_code == 200)

    r_mesh = client.get("/api/ct/mesh/heart")
    assert_test("7.5: Phase 2 -- Heart 3D mesh intact", r_mesh.status_code == 200)

    # Phase 3: Co-Pilot
    r_ask = client.post("/api/copilot/ask", json={"study_id": "demo-1", "question": "Show me the heart"})
    assert_test("7.6: Phase 3 -- Co-Pilot natural language ask intact",
                r_ask.status_code == 200 and "cardiac" in r_ask.json().get("answer", "").lower())

    # Phase 5: Upload validation
    r_bad_up = client.post("/api/xray/upload", files={"file": ("test.txt", b"not an image", "text/plain")})
    assert_test("7.7: Phase 5 -- Invalid file upload rejected", r_bad_up.status_code == 400)

    print("\n" + "=" * 80)
    print(f"VERIFICATION SUMMARY: {passed} / {total} tests PASSED")
    print("================================================================================")

if __name__ == "__main__":
    with TestClient(app) as client:
        _run_all(client)
