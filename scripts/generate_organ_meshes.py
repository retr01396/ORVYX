#!/usr/bin/env python3
"""
Generates clean 3D surface meshes (marching cubes) for the 8 verified TotalSegmentator organs.
Saves JSON geometry assets with vertices, normals, face indices, and centroids.
"""
import json
import time
from pathlib import Path
import SimpleITK as sitk
import numpy as np
from skimage.measure import marching_cubes

REPO_ROOT = Path(__file__).resolve().parent.parent
MASKS_DIR = REPO_ROOT / "assets" / "demo" / "ct" / "masks"
MESHES_DIR = REPO_ROOT / "assets" / "demo" / "ct" / "meshes"
MESHES_DIR.mkdir(parents=True, exist_ok=True)

ORGAN_METADATA = {
    "heart": {
        "label": "Heart",
        "color": "#f43f5e",
        "file": "heart.nii.gz",
        "group": "Cardiovascular"
    },
    "aorta": {
        "label": "Aorta",
        "color": "#fb7185",
        "file": "aorta.nii.gz",
        "group": "Cardiovascular"
    },
    "trachea": {
        "label": "Trachea",
        "color": "#38bdf8",
        "file": "trachea.nii.gz",
        "group": "Airways"
    },
    "lung_upper_lobe_right": {
        "label": "Right Upper Lobe",
        "color": "#0ea5e9",
        "file": "lung_upper_lobe_right.nii.gz",
        "group": "Right Lung"
    },
    "lung_middle_lobe_right": {
        "label": "Right Middle Lobe",
        "color": "#06b6d4",
        "file": "lung_middle_lobe_right.nii.gz",
        "group": "Right Lung"
    },
    "lung_lower_lobe_right": {
        "label": "Right Lower Lobe",
        "color": "#14b8a6",
        "file": "lung_lower_lobe_right.nii.gz",
        "group": "Right Lung"
    },
    "lung_upper_lobe_left": {
        "label": "Left Upper Lobe",
        "color": "#2dd4bf",
        "file": "lung_upper_lobe_left.nii.gz",
        "group": "Left Lung"
    },
    "lung_lower_lobe_left": {
        "label": "Left Lower Lobe",
        "color": "#10b981",
        "file": "lung_lower_lobe_left.nii.gz",
        "group": "Left Lung"
    }
}

print(f"Generating 3D surface meshes from {MASKS_DIR}...")

# Compute overall volume center from CT image
ct_img = sitk.ReadImage(str(REPO_ROOT / "assets" / "demo" / "ct" / "CT-chest.nrrd"))
origin = ct_img.GetOrigin()
spacing = ct_img.GetSpacing()
size = ct_img.GetSize()

# Physical center of CT volume
center_phys = [
    origin[0] + (size[0] * spacing[0]) / 2.0,
    origin[1] + (size[1] * spacing[1]) / 2.0,
    origin[2] + (size[2] * spacing[2]) / 2.0
]
print(f"CT Physical Center: X={center_phys[0]:.1f}, Y={center_phys[1]:.1f}, Z={center_phys[2]:.1f} mm")

voxel_volume_mm3 = spacing[0] * spacing[1] * spacing[2]

manifest = []

for organ_id, meta in ORGAN_METADATA.items():
    mask_path = MASKS_DIR / meta["file"]
    if not mask_path.exists():
        print(f"Warning: {mask_path} not found")
        continue

    t0 = time.perf_counter()
    img = sitk.ReadImage(str(mask_path))
    arr = sitk.GetArrayFromImage(img) # shape (Z, Y, X)

    voxels_count = int(np.sum(arr > 0))
    volume_cm3 = round((voxels_count * voxel_volume_mm3) / 1000.0, 2)

    z_indices, y_indices, x_indices = np.where(arr > 0)
    mean_z = float(np.mean(z_indices))
    mean_y = float(np.mean(y_indices))
    mean_x = float(np.mean(x_indices))

    # Physical centroid
    phys_centroid = img.TransformContinuousIndexToPhysicalPoint((mean_x, mean_y, mean_z))
    phys_centroid = [round(c, 2) for c in phys_centroid]

    # Marching cubes with spacing in (Z, Y, X)
    # step_size=2 produces high fidelity with optimal triangle count for 60fps webgl
    z_spacing, y_spacing, x_spacing = spacing[2], spacing[1], spacing[0]
    verts, faces, normals, _ = marching_cubes(
        arr,
        level=0.5,
        spacing=(z_spacing, y_spacing, x_spacing),
        step_size=2
    )

    # verts are in [Z_mm, Y_mm, X_mm] from array origin (0, 0, 0)
    # Convert to patient physical coordinates (X, Y, Z) centered around volume center:
    # X_phys = origin[0] + verts[:, 2]
    # Y_phys = origin[1] + verts[:, 1]
    # Z_phys = origin[2] + verts[:, 0]
    x_centered = (origin[0] + verts[:, 2]) - center_phys[0]
    y_centered = (origin[1] + verts[:, 1]) - center_phys[1]
    z_centered = (origin[2] + verts[:, 0]) - center_phys[2]

    # Three.js uses (X: Right/Left, Y: Superior/Inferior, Z: Anterior/Posterior) or standard medical axes
    # Let's keep standard medical coordinates: X=X_centered, Y=Y_centered, Z=Z_centered
    vertices_flat = []
    normals_flat = []
    for i in range(len(verts)):
        vertices_flat.extend([round(float(x_centered[i]), 2), round(float(y_centered[i]), 2), round(float(z_centered[i]), 2)])
        # normals in (Z, Y, X) -> (X, Y, Z)
        normals_flat.extend([round(float(normals[i][2]), 3), round(float(normals[i][1]), 3), round(float(normals[i][0]), 3)])

    faces_flat = faces.flatten().tolist()

    mesh_data = {
        "id": organ_id,
        "label": meta["label"],
        "color": meta["color"],
        "group": meta["group"],
        "volume_cm3": volume_cm3,
        "voxel_centroid": [round(mean_x, 1), round(mean_y, 1), round(mean_z, 1)],
        "physical_centroid": phys_centroid,
        "centered_centroid": [
            round(phys_centroid[0] - center_phys[0], 2),
            round(phys_centroid[1] - center_phys[1], 2),
            round(phys_centroid[2] - center_phys[2], 2)
        ],
        "vertex_count": len(verts),
        "face_count": len(faces),
        "vertices": vertices_flat,
        "normals": normals_flat,
        "indices": faces_flat
    }

    out_file = MESHES_DIR / f"{organ_id}.json"
    with open(out_file, "w") as f:
        json.dump(mesh_data, f)

    dt = (time.perf_counter() - t0) * 1000
    print(f"  {organ_id:<25}: {len(verts):>6} verts, {len(faces):>6} faces, {volume_cm3:>6} cm³, in {dt:.1f}ms -> {out_file.name}")

    manifest.append({
        "id": organ_id,
        "label": meta["label"],
        "color": meta["color"],
        "group": meta["group"],
        "volume_cm3": volume_cm3,
        "voxel_centroid": [round(mean_x, 1), round(mean_y, 1), round(mean_z, 1)],
        "physical_centroid": phys_centroid,
        "centered_centroid": mesh_data["centered_centroid"],
        "vertex_count": len(verts),
        "face_count": len(faces),
        "mesh_url": f"/api/ct/mesh/{organ_id}"
    })

# Save manifest
with open(MESHES_DIR / "manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

print("\nMesh generation complete! Manifest saved to manifest.json.")
