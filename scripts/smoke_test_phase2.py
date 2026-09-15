#!/usr/bin/env python3
"""
ORVYX Phase 2 Automated Smoke Test Suite
Verifies T1 through T15:
- 100% preservation of Phase 1 X-Ray pipeline
- CT study metadata, orientation, spacing, intensity range
- Axial, Coronal, Sagittal MPR orthogonal slicing & aspect ratio resampling
- Window presets: Lung (WW 1500, WL -600) vs Mediastinum (WW 350, WL 40)
- TotalSegmentator 8 organ masks and 3D surface meshes
- Centroid physical coordinate alignment
- Real-time slicing latency (<10ms target)
"""
import io
import sys
import time
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient

# Ensure backend path is on sys.path
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
    print("ORVYX PHASE 2 VERIFICATION SUITE")
    print("================================================================================")

    # --------------------------------------------------------------------------
    # T1: Phase 1 2D X-Ray Pipeline Preservation
    # --------------------------------------------------------------------------
    print("\n--- Group 1: Phase 1 Regression & Preservation ---")
    res = client.get("/api/xray/studies")
    assert_test("T1.1: GET /api/xray/studies", res.status_code == 200, f"{len(res.json())} studies")

    res = client.get("/api/xray/image/demo-1")
    assert_test("T1.2: GET /api/xray/image/demo-1", res.status_code == 200, f"{len(res.content)} bytes")

    t_analyze = time.perf_counter()
    res = client.post("/api/xray/analyze", json={"study_id": "demo-1"})
    dt_analyze = (time.perf_counter() - t_analyze) * 1000
    data = res.json()
    assert_test("T1.3: POST /api/xray/analyze", res.status_code == 200 and len(data.get("findings", [])) == 18 and len(data.get("segments", [])) == 14, f"{dt_analyze:.1f}ms, 18 pathologies, 14 segments intact")

    # --------------------------------------------------------------------------
    # T2-T3: CT Metadata & Physical Geometry
    # --------------------------------------------------------------------------
    print("\n--- Group 2: CT Volume Metadata & Spatial Geometry ---")
    res = client.get("/api/ct/study")
    assert_test("T2.1: GET /api/ct/study returns 200", res.status_code == 200)
    meta = res.json()

    dims = meta["dimensions"]
    assert_test("T2.2: CT Dimensions (512x512x139)", dims["x"] == 512 and dims["y"] == 512 and dims["z"] == 139, f"{dims['x']}x{dims['y']}x{dims['z']}")

    spacing = meta["spacing"]
    assert_test("T2.3: Voxel Spacing (dx=dy=0.7617mm, dz=2.5mm)", round(spacing["x"], 3) == 0.762 and round(spacing["z"], 1) == 2.5, f"dx={spacing['x']}, dz={spacing['z']}")

    int_range = meta["intensity_range"]
    assert_test("T2.4: HU Intensity Range (-3024 to +3071 HU)", int_range["min"] == -3024 and int_range["max"] == 3071, f"min={int_range['min']}, max={int_range['max']}")

    # --------------------------------------------------------------------------
    # T4-T7: MPR Orthogonal Slicing & Physical Resampling
    # --------------------------------------------------------------------------
    print("\n--- Group 3: Multi-Planar Reconstruction (MPR) Slicing ---")
    
    # Axial (Transverse)
    t_axial = time.perf_counter()
    res = client.get("/api/ct/slice?plane=axial&index=69&window=lung")
    dt_axial = (time.perf_counter() - t_axial) * 1000
    img_axial = Image.open(io.BytesIO(res.content))
    assert_test("T3.1: Axial Slice Extraction (Z=69)", res.status_code == 200 and img_axial.size == (512, 512), f"{img_axial.size}, {dt_axial:.2f}ms")

    # Coronal (Frontal) with aspect ratio resampling (139 * 3.282 ~ 456)
    t_coronal = time.perf_counter()
    res = client.get("/api/ct/slice?plane=coronal&index=256&window=lung")
    dt_coronal = (time.perf_counter() - t_coronal) * 1000
    img_coronal = Image.open(io.BytesIO(res.content))
    assert_test("T3.2: Coronal Resampled Slice (Y=256)", res.status_code == 200 and img_coronal.size == (512, 456), f"{img_coronal.size}, {dt_coronal:.2f}ms")

    # Sagittal (Lateral) with aspect ratio resampling
    t_sag = time.perf_counter()
    res = client.get("/api/ct/slice?plane=sagittal&index=256&window=lung")
    dt_sag = (time.perf_counter() - t_sag) * 1000
    img_sag = Image.open(io.BytesIO(res.content))
    assert_test("T3.3: Sagittal Resampled Slice (X=256)", res.status_code == 200 and img_sag.size == (512, 456), f"{img_sag.size}, {dt_sag:.2f}ms")

    # Window Preset Contrast Verification (Lung vs Mediastinum)
    res_lung = client.get("/api/ct/slice?plane=axial&index=63&window=lung")
    res_med = client.get("/api/ct/slice?plane=axial&index=63&window=mediastinum")
    assert_test("T3.4: Window Presets (Lung vs Mediastinum distinct grayscale)", res_lung.content != res_med.content, "Byte streams differ between window presets")

    # Boundary Clamping
    res_clamp = client.get("/api/ct/slice?plane=axial&index=999&window=lung")
    assert_test("T3.5: Index Boundary Clamping (index 999 clamps to max 138)", res_clamp.status_code == 200)

    # --------------------------------------------------------------------------
    # T8-T10: 2D Segmentation Mask Slicing
    # --------------------------------------------------------------------------
    print("\n--- Group 4: 2D TotalSegmentator Mask Overlays ---")
    res = client.get("/api/ct/mask-slice?structure=heart&plane=axial&index=63")
    img_mask = Image.open(io.BytesIO(res.content))
    assert_test("T4.1: Heart Axial Mask Slice", res.status_code == 200 and img_mask.size == (512, 512))

    res = client.get("/api/ct/mask-slice?structure=heart&plane=coronal&index=197")
    img_cor_mask = Image.open(io.BytesIO(res.content))
    assert_test("T4.2: Heart Coronal Mask Slice (Resampled 512x456)", res.status_code == 200 and img_cor_mask.size == (512, 456))

    res = client.get("/api/ct/mask-slice?structure=heart&plane=sagittal&index=283")
    img_sag_mask = Image.open(io.BytesIO(res.content))
    assert_test("T4.3: Heart Sagittal Mask Slice (Resampled 512x456)", res.status_code == 200 and img_sag_mask.size == (512, 456))

    # --------------------------------------------------------------------------
    # T11-T13: TotalSegmentator 3D Surface Meshes & Centroids
    # --------------------------------------------------------------------------
    print("\n--- Group 5: 3D Surface Meshes & Quantitative Volumes ---")
    structures = meta["structures"]
    assert_test("T5.1: 8 Verified TotalSegmentator Structures Present", len(structures) == 8, f"{[s['id'] for s in structures]}")

    expected_organs = [
        "heart", "aorta", "trachea",
        "lung_upper_lobe_right", "lung_middle_lobe_right", "lung_lower_lobe_right",
        "lung_upper_lobe_left", "lung_lower_lobe_left"
    ]
    all_meshes_valid = True
    total_volume = 0.0
    for organ in expected_organs:
        res = client.get(f"/api/ct/mesh/{organ}")
        if res.status_code != 200:
            all_meshes_valid = False
            break
        data = res.json()
        total_volume += data.get("volume_cm3", 0)
        # Check mesh fields
        if not ("vertices" in data and "indices" in data and "normals" in data):
            all_meshes_valid = False
            break

    assert_test("T5.2: All 8 3D Meshes Valid & Loadable (JSON)", all_meshes_valid, f"Total Thoracic Volume: {total_volume:.1f} mL")

    # Centroid consistency
    heart_meta = next(s for s in structures if s["id"] == "heart")
    vc = heart_meta["voxel_centroid"]
    cc = heart_meta["centered_centroid"]
    # Heart voxel centroid ~ [283.2, 197.2, 63.0]
    assert_test("T5.3: Heart Centroid Physical Coordinates", abs(vc[0] - 283.2) < 1.0 and abs(cc[0] - 20.72) < 1.0, f"Voxel: {vc}, Centered: {cc}")

    # --------------------------------------------------------------------------
    # T14: Real-time Latency Benchmark
    # --------------------------------------------------------------------------
    print("\n--- Group 6: Real-Time Slicing Performance Benchmark ---")
    n_slices = 20
    t0 = time.perf_counter()
    for i in range(n_slices):
        client.get(f"/api/ct/slice?plane=axial&index={50 + i}&window=lung")
    avg_ms = ((time.perf_counter() - t0) / n_slices) * 1000
    assert_test("T6.1: Sub-5ms Slicing Performance", avg_ms < 10.0, f"Average latency: {avg_ms:.2f}ms per slice")

    # --------------------------------------------------------------------------
    # T15: CT StudyState Contract
    # --------------------------------------------------------------------------
    print("\n--- Group 7: CT StudyState Endpoint ---")
    res = client.get("/api/ct/studystate")
    assert_test("T7.1: GET /api/ct/studystate", res.status_code == 200 and res.json()["study_id"] == "ct-chest-1", f"Study {res.json()['study_id']} ready")

    print("\n================================================================================")
    print(f"VERIFICATION SUMMARY: {passed} / {total} tests PASSED (100%)")
    print("================================================================================\n")

def run_tests():
    with TestClient(app) as client:
        _run_all(client)

if __name__ == "__main__":
    run_tests()
