export interface EvidenceItem {
  type: 'xray_finding' | 'ct_structure' | 'measurement' | 'segmentation' | 'metadata';
  label: string;
  value: string;
  source: string;
}

export interface FindingAnatomy {
  structure_id: string;
  label: string;
  modality: 'xray' | 'ct';
  voxel_centroid?: [number, number, number];
  physical_centroid?: [number, number, number];
  image_centroid?: [number, number];
}

export interface FindingActions {
  focus_3d: boolean;
  focus_mpr: boolean;
  focus_xray: boolean;
}

export interface CoPilotFinding {
  id: string;
  title: string;
  category: string;
  severity: 'high' | 'moderate' | 'low' | 'normal' | 'indeterminate';
  confidence: number;
  description: string;
  evidence: EvidenceItem[];
  anatomy?: FindingAnatomy;
  actions: FindingActions;
}

export interface CoPilotMeasurement {
  name: string;
  value: number;
  unit: string;
  category: string;
  reference_range?: string;
  interpretation?: string;
  anatomy_id?: string;
}

export interface CoPilotProvenance {
  mode: 'deterministic-demo' | 'llm-augmented';
  provider: string;
  generated_at: string;
  sources: string[];
}

export interface CoPilotResponse {
  study_id: string;
  modality: string;
  title: string;
  summary: string;
  impression: string[];
  findings: CoPilotFinding[];
  measurements: CoPilotMeasurement[];
  limitations: string[];
  provenance: CoPilotProvenance;
}

export interface AskResponse {
  question: string;
  intent: string;
  answer: string;
  highlights: string[];
  relevant_finding_ids: string[];
  target_structure_id?: string;
  target_view?: 'xray' | 'ct';
  provenance: CoPilotProvenance;
}
