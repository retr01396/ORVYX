export interface Centroid {
  x: number;
  y: number;
}

export interface Finding {
  label: string;
  score: number;
  band: 'low' | 'moderate' | 'elevated';
}

export interface Segment {
  name: string;
  source: string;
  centroid: Centroid;
  area_px: number;
  mask_base64: string;
}

export interface Provenance {
  classifier_model: string;
  segmentation_model: string;
  version: string;
  device: string;
  runtime_ms: number;
}

export interface StudyState {
  study_id: string;
  modality: string;
  source: string;
  status?: string;
  available_modalities?: string[];
  provenance: Provenance;
  findings: Finding[];
  segments: Segment[];
  measurements: any[];
  comparison: any | null;
  limitations: string[];
}

export interface StudySummary {
  study_id: string;
  title: string;
  patient_id: string;
  view: string;
  modality: string;
  description: string;
  status?: 'ready' | 'uploading' | 'analyzing' | 'complete' | 'error';
  is_custom?: boolean;
  available_modalities?: string[];
  file_size_bytes?: number;
  created_at?: string;
}

// Map findings to corresponding anatomical structures for click-a-finding focus
export const FINDING_ANATOMY_MAP: Record<string, string[]> = {
  Cardiomegaly: ['Heart'],
  'Enlarged Cardiomediastinum': ['Mediastinum', 'Heart'],
  Effusion: ['Left Lung', 'Right Lung', 'Facies Diaphragmatica'],
  Pneumothorax: ['Left Lung', 'Right Lung'],
  Pneumonia: ['Left Lung', 'Right Lung'],
  Consolidation: ['Left Lung', 'Right Lung'],
  Atelectasis: ['Left Lung', 'Right Lung'],
  Infiltration: ['Left Lung', 'Right Lung'],
  Edema: ['Left Lung', 'Right Lung', 'Heart'],
  Emphysema: ['Left Lung', 'Right Lung'],
  Fibrosis: ['Left Lung', 'Right Lung'],
  Pleural_Thickening: ['Left Lung', 'Right Lung'],
  Fracture: ['Left Clavicle', 'Right Clavicle', 'Left Scapula', 'Right Scapula', 'Spine'],
  'Lung Lesion': ['Left Lung', 'Right Lung'],
  'Lung Opacity': ['Left Lung', 'Right Lung'],
  Nodule: ['Left Lung', 'Right Lung'],
  Mass: ['Left Lung', 'Right Lung', 'Mediastinum'],
  Hernia: ['Facies Diaphragmatica'],
};

// Distinct colors for each of the 14 PSPNet anatomical segments
export const SEGMENT_COLORS: Record<string, { stroke: string; fill: string; hex: string }> = {
  'Left Clavicle': { stroke: '#38bdf8', fill: 'rgba(56, 189, 248, 0.35)', hex: '#38bdf8' },
  'Right Clavicle': { stroke: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.35)', hex: '#0ea5e9' },
  'Left Scapula': { stroke: '#818cf8', fill: 'rgba(129, 140, 248, 0.35)', hex: '#818cf8' },
  'Right Scapula': { stroke: '#6366f1', fill: 'rgba(99, 102, 241, 0.35)', hex: '#6366f1' },
  'Left Lung': { stroke: '#2dd4bf', fill: 'rgba(45, 212, 191, 0.35)', hex: '#2dd4bf' },
  'Right Lung': { stroke: '#14b8a6', fill: 'rgba(20, 184, 166, 0.35)', hex: '#14b8a6' },
  'Left Hilus Pulmonis': { stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.4)', hex: '#a855f7' },
  'Right Hilus Pulmonis': { stroke: '#c084fc', fill: 'rgba(192, 132, 252, 0.4)', hex: '#c084fc' },
  Heart: { stroke: '#f43f5e', fill: 'rgba(244, 63, 94, 0.4)', hex: '#f43f5e' },
  Aorta: { stroke: '#fb7185', fill: 'rgba(251, 113, 133, 0.4)', hex: '#fb7185' },
  'Facies Diaphragmatica': { stroke: '#fbbf24', fill: 'rgba(251, 191, 36, 0.35)', hex: '#fbbf24' },
  Mediastinum: { stroke: '#f97316', fill: 'rgba(249, 115, 22, 0.35)', hex: '#f97316' },
  Weasand: { stroke: '#e879f9', fill: 'rgba(232, 121, 249, 0.35)', hex: '#e879f9' },
  Spine: { stroke: '#94a3b8', fill: 'rgba(148, 163, 184, 0.4)', hex: '#94a3b8' },
};
