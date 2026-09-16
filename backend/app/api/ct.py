from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response, JSONResponse

from app.services.ct_service import ct_manager
from app.models.state import StudyState, Provenance, Segment, Centroid, Finding

router = APIRouter(prefix="/api/ct", tags=["ct"])

# Allowlists for strict parameter validation
_VALID_PLANES = frozenset({"axial", "coronal", "sagittal"})
_VALID_WINDOWS = frozenset({"lung", "mediastinum"})
_VALID_MASK_STRUCTURES = frozenset({
    "heart", "aorta", "trachea",
    "lung_upper_lobe_right", "lung_middle_lobe_right", "lung_lower_lobe_right",
    "lung_upper_lobe_left", "lung_lower_lobe_left",
})
_VALID_STRUCTURES = _VALID_MASK_STRUCTURES | {"rib_cage"}


@router.get("/study")
async def get_ct_study_metadata():
    """Returns comprehensive metadata for the verified CT dataset."""
    try:
        ct_manager.load_ct_data()
        manifest = ct_manager.get_manifest()
        return {
            **ct_manager.metadata,
            "structures": manifest
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load CT study: {str(e)}"
        )


@router.get("/slice")
async def get_ct_slice(
    plane: str = Query(..., description="Orthogonal plane: axial, coronal, or sagittal"),
    index: int = Query(..., ge=0, description="Slice coordinate index along the plane axis"),
    window: str = Query("lung", description="Window preset: lung or mediastinum")
):
    """
    Renders orthogonal CT slice image with physical aspect ratio correction
    and verified Hounsfield Unit windowing.
    """
    if plane not in _VALID_PLANES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid plane '{plane}'. Must be one of: {', '.join(sorted(_VALID_PLANES))}."
        )
    if window not in _VALID_WINDOWS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid window preset '{window}'. Must be one of: {', '.join(sorted(_VALID_WINDOWS))}."
        )
    try:
        png_bytes = ct_manager.get_slice_png(plane=plane, index=index, window_preset=window)
        return Response(content=png_bytes, media_type="image/png")
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/mask-slice")
async def get_ct_mask_slice(
    structure: str = Query(..., description="Organ structure identifier (e.g. heart, aorta)"),
    plane: str = Query(..., description="Orthogonal plane: axial, coronal, or sagittal"),
    index: int = Query(..., ge=0, description="Slice coordinate index")
):
    """Returns 2D binary segmentation mask slice matching the corresponding CT slice geometry."""
    if structure not in _VALID_MASK_STRUCTURES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown structure '{structure}'. Valid structures: {', '.join(sorted(_VALID_MASK_STRUCTURES))}."
        )
    if plane not in _VALID_PLANES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid plane '{plane}'. Must be one of: {', '.join(sorted(_VALID_PLANES))}."
        )
    try:
        png_bytes = ct_manager.get_mask_slice_png(structure=structure, plane=plane, index=index)
        return Response(content=png_bytes, media_type="image/png")
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get("/mesh/{structure_name}")
async def get_structure_mesh(structure_name: str):
    """Returns 3D triangle surface mesh geometry (vertices, normals, faces) for browser-native rendering."""
    if structure_name not in _VALID_STRUCTURES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Structure mesh '{structure_name}' not found. Valid structures: {', '.join(sorted(_VALID_STRUCTURES))}."
        )
    try:
        mesh_json = ct_manager.get_mesh_data(structure_name)
        return JSONResponse(content=mesh_json)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Structure mesh '{structure_name}' not found on disk."
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/studystate", response_model=StudyState)
async def get_ct_studystate():
    """
    Returns CT StudyState contract matching Phase 1 schema,
    extended with verified TotalSegmentator organ structures.
    """
    try:
        ct_manager.load_ct_data()
        manifest = ct_manager.get_manifest()

        segments = []
        for organ in manifest:
            # Map voxel centroid to Centroid model
            vc = organ["voxel_centroid"]
            segments.append(
                Segment(
                    name=organ["label"],
                    source="TotalSegmentator-v2-mps",
                    centroid=Centroid(x=vc[0], y=vc[1]), # in-plane X, Y
                    area_px=int(organ["volume_cm3"] * 1000), # volume in mm3
                    mask_base64="" # Meshes served via /api/ct/mesh/{id}
                )
            )

        provenance = Provenance(
            classifier_model="None (CT Morphometric Analysis)",
            segmentation_model="TotalSegmentator v2 (nnUNetV2, --fast)",
            version="2.18.0",
            device="mps",
            runtime_ms=16790.0 # Phase 0 verified MPS benchmark
        )

        return StudyState(
            study_id="ct-chest-1",
            modality="CT",
            source="verified-demo-asset",
            provenance=provenance,
            findings=[],
            segments=segments,
            measurements=[
                {
                    "name": "Total Lung Volume",
                    "value_ml": sum(o["volume_cm3"] for o in manifest if "Lobe" in o["label"]),
                    "unit": "mL"
                },
                {
                    "name": "Heart Volume",
                    "value_ml": next((o["volume_cm3"] for o in manifest if o["id"] == "heart"), 0),
                    "unit": "mL"
                }
            ],
            comparison=None,
            limitations=[
                "Single verified chest CT baseline study. Longitudinal comparison is not implemented.",
                "Research prototype segmentation for anatomical visualization only."
            ]
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
