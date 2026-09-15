export interface CTDimensions {
  x: number; // 512
  y: number; // 512
  z: number; // 139
}

export interface CTSpacing {
  x: number; // 0.7617
  y: number; // 0.7617
  z: number; // 2.5000
}

export interface WindowPreset {
  name: string;
  width: number;
  level: number;
  min_hu: number;
  max_hu: number;
  description: string;
}

export interface OrganStructure {
  id: string;
  label: string;
  color: string;
  group: string;
  volume_cm3: number;
  voxel_centroid: [number, number, number];
  physical_centroid: [number, number, number];
  centered_centroid: [number, number, number];
  vertex_count: number;
  face_count: number;
  mesh_url: string;
}

export interface CTStudyMetadata {
  study_id: string;
  modality: string;
  title: string;
  patient_id: string;
  dimensions: CTDimensions;
  spacing: CTSpacing;
  origin: { x: number; y: number; z: number };
  direction: number[];
  intensity_range: { min: number; max: number; mean: number };
  window_presets: Record<string, WindowPreset>;
  structures: OrganStructure[];
}

export interface CrosshairPosition {
  x: number; // 0 - 511 (Sagittal plane index)
  y: number; // 0 - 511 (Coronal plane index)
  z: number; // 0 - 138 (Axial plane index)
}
