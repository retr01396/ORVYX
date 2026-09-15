"""
ORVYX Phase 6 — Production Hardening & Final QA Smoke Test Suite

Covers:
  - Backend startup & health check
  - Path traversal rejection on /api/xray/image/
  - Invalid CT plane parameter -> HTTP 400
  - Invalid CT window parameter -> HTTP 400
  - Invalid structure on /api/ct/mask-slice -> HTTP 400
  - Unknown structure on /api/ct/mesh/ -> HTTP 404
  - Oversized / empty / malformed Co-Pilot question handling
  - Full regression checks across Phases 1, 2, 3, and 5
"""

import sys
import os
import io

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, os.path.join(REPO_ROOT, "backend"))

from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

PASS_COUNT = 0
FAIL_COUNT = 0
FAILURES = []


def check(label, condition, detail=""):
    global PASS_COUNT, FAIL_COUNT
    if condition:
        PASS_COUNT += 1
        print(f"  [PASS] {label}" + (f" ({detail})" if detail else ""))
        return True
    else:
        FAIL_COUNT += 1
        FAILURES.append(f"{label}: {detail}")
        print(f"  [FAIL] {label}" + (f" -- {detail}" if detail else ""))
        return False


def make_png_bytes(w=128, h=128):
    img = Image.new("L", (w, h), color=128)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run_tests():
    with TestClient(app) as client:
        print("=" * 80)
        print("ORVYX PHASE 6 -- PRODUCTION HARDENING SMOKE TEST SUITE")
        print("=" * 80)

        # --- Group 1: Backend Health ---
        print("\n--- Group 1: Backend Startup & Health ---")
        r = client.get("/api/health")
        check("1.1: GET /api/health returns 200", r.status_code == 200)
        body = r.json()
        check("1.2: Health shows device field", "device" in body, body.get("device", "missing"))
        check("1.3: Health shows models_loaded=True", body.get("models_loaded") is True)

        # --- Group 2: Path Traversal Rejection ---
        print("\n--- Group 2: Path Traversal Rejection ---")
        for bad_id in ["../config.py", "../../etc/passwd", "demo-1/../../config.py"]:
            r = client.get(f"/api/xray/image/{bad_id}")
            check(
                f"2.x: path traversal '{bad_id[:30]}' rejected",
                r.status_code in (400, 404, 422),
                f"HTTP {r.status_code}"
            )

        # --- Group 3: CT Plane Validation ---
        print("\n--- Group 3: CT Plane Parameter Validation ---")
        for plane in ["diagonal", "oblique", "z", "bone"]:
            r = client.get(f"/api/ct/slice?plane={plane}&index=50&window=lung")
            check(f"3.x: invalid plane '{plane}' -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")
        for vplane in ["axial", "coronal", "sagittal"]:
            r = client.get(f"/api/ct/slice?plane={vplane}&index=50&window=lung")
            check(f"3.v: valid plane '{vplane}' -> HTTP 200", r.status_code == 200, f"HTTP {r.status_code}")

        # --- Group 4: CT Window Validation ---
        print("\n--- Group 4: CT Window Parameter Validation ---")
        for win in ["bone", "brain", "invalid_window", "soft_tissue"]:
            r = client.get(f"/api/ct/slice?plane=axial&index=50&window={win}")
            check(f"4.x: invalid window '{win}' -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")
        for vwin in ["lung", "mediastinum"]:
            r = client.get(f"/api/ct/slice?plane=axial&index=50&window={vwin}")
            check(f"4.v: valid window '{vwin}' -> HTTP 200", r.status_code == 200, f"HTTP {r.status_code}")

        # --- Group 5: CT Structure Validation (mask-slice) ---
        print("\n--- Group 5: CT Structure Allowlist (mask-slice) ---")
        for struct in ["kidney", "liver", "spleen", "unknown"]:
            r = client.get(f"/api/ct/mask-slice?structure={struct}&plane=axial&index=63")
            check(f"5.x: unknown structure '{struct}' mask -> HTTP 400", r.status_code in (400, 404), f"HTTP {r.status_code}")
        r = client.get("/api/ct/mask-slice?structure=heart&plane=axial&index=63")
        check("5.v: valid structure 'heart' mask -> HTTP 200", r.status_code == 200)

        # --- Group 6: CT Mesh Unknown Structure ---
        print("\n--- Group 6: CT Mesh Unknown Structure -> HTTP 404 ---")
        for name in ["kidney", "pancreas", "nonexistent"]:
            r = client.get(f"/api/ct/mesh/{name}")
            check(f"6.x: unknown mesh '{name}' -> HTTP 404", r.status_code == 404, f"HTTP {r.status_code}")
        r = client.get("/api/ct/mesh/heart")
        check("6.v: valid mesh 'heart' -> HTTP 200", r.status_code == 200)

        # --- Group 7: Co-Pilot Safety ---
        print("\n--- Group 7: Co-Pilot Safety & Malformed Input ---")
        r = client.post("/api/copilot/ask", json={"study_id": "demo-1", "question": ""})
        check("7.1: Empty question returns safe fallback (not 500)", r.status_code == 200, f"HTTP {r.status_code}")

        long_q = "What is the diagnosis? " * 50
        r = client.post("/api/copilot/ask", json={"study_id": "demo-1", "question": long_q})
        check("7.2: Oversized question handled safely (not 500)", r.status_code == 200, f"HTTP {r.status_code}")

        r = client.post("/api/copilot/ask", json={"study_id": "demo-1", "question": "'; DROP TABLE patients; --"})
        check("7.3: SQL-like injection returns safe response", r.status_code == 200, f"HTTP {r.status_code}")

        r = client.post("/api/copilot/ask", json={"study_id": "demo-1", "question": "What medication should this patient take?"})
        check("7.4: Out-of-scope question handled safely", r.status_code == 200, f"HTTP {r.status_code}")

        # --- Group 8: Upload Safety ---
        print("\n--- Group 8: Upload Safety Guards ---")
        r = client.post("/api/xray/upload", files={"file": ("empty.png", b"", "image/png")})
        check("8.1: Empty file -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")

        r = client.post("/api/xray/upload", files={"file": ("test.exe", b"MZ\x90\x00", "application/octet-stream")})
        check("8.2: Unsupported extension -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")

        r = client.post("/api/xray/upload", files={"file": ("corrupt.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIH", "image/png")})
        check("8.3: Corrupt PNG -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")

        tiny = Image.new("L", (32, 32), 128)
        buf = io.BytesIO()
        tiny.save(buf, "PNG")
        r = client.post("/api/xray/upload", files={"file": ("tiny.png", buf.getvalue(), "image/png")})
        check("8.4: Sub-64px image -> HTTP 400", r.status_code == 400, f"HTTP {r.status_code}")

        png_data = make_png_bytes(256, 256)
        r = client.post("/api/xray/upload", files={"file": ("ph6_test.png", png_data, "image/png")})
        check("8.5: Valid 256x256 PNG upload -> HTTP 200", r.status_code == 200, f"HTTP {r.status_code}")

        # --- Group 9: Full Phase 1-5 Regression ---
        print("\n--- Group 9: Phase 1-5 Regression Checks ---")
        r = client.get("/api/xray/studies")
        check("9.1: Phase 1 -- GET /api/xray/studies intact", r.status_code == 200)

        r = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
        n_findings = len(r.json().get("findings", [])) if r.status_code == 200 else 0
        check("9.2: Phase 1 -- /api/xray/analyze demo-1 intact (18 findings)", r.status_code == 200 and n_findings == 18, f"{n_findings} findings")

        r = client.get("/api/ct/study")
        check("9.3: Phase 2 -- GET /api/ct/study intact", r.status_code == 200)

        r = client.get("/api/ct/slice?plane=axial&index=69&window=lung")
        check("9.4: Phase 2 -- Axial slice intact", r.status_code == 200)

        r = client.get("/api/ct/mesh/heart")
        check("9.5: Phase 2 -- Heart mesh intact", r.status_code == 200)

        r = client.post("/api/copilot/context", json={"study_id": "demo-1", "xray_study_id": "demo-1"})
        check("9.6: Phase 3 -- Co-Pilot context intact", r.status_code == 200)
        ctx = r.json()
        heart_vols = [m["value"] for m in ctx.get("measurements", []) if "cardiac" in m.get("name", "").lower() or "heart" in m.get("name", "").lower()]
        check("9.7: Phase 3 -- Cardiac volume ~484 mL present", any(abs(v - 484.12) < 5.0 for v in heart_vols), str(heart_vols))

        png_data2 = make_png_bytes(512, 512)
        r = client.post("/api/xray/upload", files={"file": ("ph6_reg.png", png_data2, "image/png")})
        check("9.8: Phase 5 -- Upload intact", r.status_code == 200)
        if r.status_code == 200:
            up_id = r.json()["study_id"]
            r2 = client.post("/api/xray/analyze", json={"study_id": up_id})
            check(
                "9.9: Phase 5 -- Analyze uploaded study intact (source=user-upload)",
                r2.status_code == 200 and r2.json().get("source") == "user-upload",
                f"source={r2.json().get('source')}"
            )

        total = PASS_COUNT + FAIL_COUNT
        print()
        print("=" * 80)
        print(f"VERIFICATION SUMMARY: {PASS_COUNT} / {total} tests PASSED")
        if FAILURES:
            print("\nFAILED TESTS:")
            for f in FAILURES:
                print(f"  x {f}")
        print("=" * 80)
        return FAIL_COUNT == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
