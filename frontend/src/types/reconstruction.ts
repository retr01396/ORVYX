// Phase 4: X-ray → 3D Thoracic Reconstruction Types
// IMPORTANT: These types describe ESTIMATED/TEMPLATE anatomy, NOT patient-specific CT data.

export type ReconstructionPhase =
  | 'idle'        // No reconstruction triggered yet
  | 'analyzing'   // X-ray analysis in progress
  | 'building'    // Particle system initializing, particles appearing
  | 'converging'  // Particles converging toward anatomical targets
  | 'complete';   // Animation complete, interactive 3D model ready

export type QualityTier = 'high' | 'medium' | 'low';

export interface ThoracicStructure {
  id: string;
  label: string;
  group: 'Skeleton' | 'Soft Tissue';
  color: string;         // hex, used for particle and mesh color
  particle_weight: number;
  formation_order: number;
  ct_derived: boolean;   // true = uses actual TotalSegmentator data
}

export interface ThoracicTemplate {
  label: string;
  disclaimer: string;
  structures: ThoracicStructure[];
  finding_map: Record<string, string[]>;  // finding_label → structure_ids
}

export interface ReconstructionState {
  phase: ReconstructionPhase;
  progress: number;           // 0-100
  qualityTier: QualityTier;
  highlightedStructureIds: string[];
  visibleStructures: Record<string, boolean>;
  template: ThoracicTemplate | null;
  studyImageUrl: string | null;  // 2D X-ray thumbnail URL
}

// Mapping from X-ray finding label to thoracic structure IDs (client-side mirror)
export const FINDING_TO_3D_STRUCTURE: Record<string, string[]> = {
  'Cardiomegaly':               ['heart'],
  'Enlarged Cardiomediastinum': ['heart', 'thoracic_spine'],
  'Effusion':                   ['lung_left', 'lung_right'],
  'Pneumothorax':               ['lung_left', 'lung_right'],
  'Pneumonia':                  ['lung_left', 'lung_right'],
  'Consolidation':              ['lung_left', 'lung_right'],
  'Atelectasis':                ['lung_left', 'lung_right'],
  'Infiltration':               ['lung_left', 'lung_right'],
  'Edema':                      ['lung_left', 'lung_right', 'heart'],
  'Emphysema':                  ['lung_left', 'lung_right'],
  'Fibrosis':                   ['lung_left', 'lung_right'],
  'Pleural_Thickening':         ['rib_cage', 'lung_left', 'lung_right'],
  'Fracture':                   ['rib_cage', 'clavicles', 'scapulae'],
  'Lung Lesion':                ['lung_left', 'lung_right'],
  'Lung Opacity':               ['lung_left', 'lung_right'],
  'Nodule':                     ['lung_left', 'lung_right'],
  'Mass':                       ['lung_left', 'lung_right', 'heart'],
  'Hernia':                     ['sternum'],
};

// Reconstruction phase labels for progress display
export const PHASE_LABELS: Record<ReconstructionPhase, string> = {
  idle:       'Ready',
  analyzing:  'Running AI Analysis…',
  building:   'Generating Particle Field…',
  converging: 'Forming 3D Anatomy…',
  complete:   '3D Model Ready',
};

export const PHASE_PROGRESS: Record<ReconstructionPhase, number> = {
  idle:       0,
  analyzing:  20,
  building:   45,
  converging: 75,
  complete:   100,
};
