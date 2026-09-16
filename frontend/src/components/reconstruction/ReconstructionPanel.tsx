/**
 * ReconstructionPanel — Left sidebar for the Phase 4 reconstruction view.
 * Shows 2D X-ray thumbnail, pipeline progress steps, structure list, and disclaimer.
 */

import React from 'react';
import { CheckCircle2, Circle, Loader2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import type { ReconstructionPhase, ThoracicStructure } from '../../types/reconstruction';
import type { Finding } from '../../types/studystate';

interface Step {
  id: ReconstructionPhase | 'upload';
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'upload',     label: 'Image Uploaded',       description: '2D X-ray received' },
  { id: 'analyzing',  label: 'AI Analysis',           description: 'Running inference…' },
  { id: 'building',   label: 'Extracting Geometry',   description: 'Mapping structures…' },
  { id: 'converging', label: 'Generating 3D Model',   description: 'Forming from particles…' },
  { id: 'complete',   label: 'Complete',              description: '3D model ready' },
];

const PHASE_ORDER: (ReconstructionPhase | 'upload')[] = [
  'upload', 'analyzing', 'building', 'converging', 'complete',
];

interface ReconstructionPanelProps {
  phase: ReconstructionPhase;
  progress: number;
  structures: ThoracicStructure[];
  visibleStructures: Record<string, boolean>;
  onToggleStructure: (id: string) => void;
  highlightedStructureIds: string[];
  elevatedFindings: Finding[];
  studyTitle?: string;
  studyImageUrl?: string | null;
}

export const ReconstructionPanel: React.FC<ReconstructionPanelProps> = ({
  phase,
  progress,
  structures,
  visibleStructures,
  onToggleStructure,
  highlightedStructureIds,
  elevatedFindings,
  studyTitle,
  studyImageUrl,
}) => {
  const currentStepIdx = PHASE_ORDER.indexOf(phase === 'idle' ? 'analyzing' : phase);

  return (
    <aside
      className="w-64 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden select-none"
      role="complementary"
      aria-label="3D Reconstruction Progress Panel"
    >
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-slate-800">
        <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          3D Reconstruction
        </h2>
        {studyTitle && (
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">{studyTitle}</p>
        )}
      </div>

      {/* 2D X-Ray Thumbnail Card */}
      {studyImageUrl && (
        <div className="p-3 border-b border-slate-800 bg-black/40">
          <div className="relative rounded-lg overflow-hidden border border-slate-700/80 bg-black aspect-square shadow-md group">
            <img
              src={studyImageUrl}
              alt="Frontal Chest Radiograph"
              className="w-full h-full object-contain filter contrast-105"
            />
            <div className="absolute top-1.5 left-1.5 bg-slate-950/80 px-1.5 py-0.5 rounded text-[9px] font-mono text-cyan-300 font-bold border border-cyan-500/40 shadow">
              R
            </div>
            <div className="absolute bottom-1.5 left-1.5 right-1.5 bg-slate-950/85 px-1.5 py-0.5 rounded text-[9px] font-mono text-slate-300 border border-slate-800 flex items-center justify-between">
              <span>2D X-Ray</span>
              <span className="text-slate-400">CHEST PA</span>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="mx-3 mt-2.5 flex items-start gap-1.5 bg-amber-950/40 border border-amber-700/40 p-2 rounded-md">
        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[9px] text-amber-300 leading-relaxed">
          <strong>AI-ESTIMATED</strong> template anatomy — not patient-specific CT data
        </p>
      </div>

      {/* Pipeline Progress Steps */}
      <div className="px-3 pt-3 pb-2 space-y-2.5 border-b border-slate-800">
        {STEPS.map((step) => {
          const stepOrder  = PHASE_ORDER.indexOf(step.id);
          const isDone     = stepOrder < currentStepIdx || phase === 'complete';
          const isActive   = stepOrder === currentStepIdx && phase !== 'complete';

          return (
            <div key={step.id} className="flex items-start gap-2">
              <div className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" aria-hidden="true" />
                ) : (
                  <Circle className="w-4 h-4 text-slate-600" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className={`text-[11px] font-semibold leading-tight ${
                  isDone ? 'text-emerald-300' : isActive ? 'text-cyan-300' : 'text-slate-500'
                }`}>
                  {step.label}
                </p>
                <p className="text-[9px] text-slate-500 leading-tight mt-0.5">
                  {isActive && step.id === 'converging'
                    ? `Forming from particles… ${progress}%`
                    : step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress Bar */}
      {phase !== 'complete' && phase !== 'idle' && (
        <div className="px-3 py-2 border-b border-slate-800">
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Reconstruction progress"
            />
          </div>
          <p className="text-[9px] font-mono text-cyan-400 text-right mt-1">{progress}%</p>
        </div>
      )}

      {/* Detected Findings that have 3D localization */}
      {elevatedFindings.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-800">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Detected Findings
          </p>
          <div className="space-y-1.5">
            {elevatedFindings.slice(0, 4).map(f => (
              <div key={f.label} className="flex items-center gap-1.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    f.band === 'elevated' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="text-[10px] text-slate-300 truncate">{f.label}</span>
                <span className="text-[9px] text-slate-500 ml-auto">
                  {(f.score * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Structure Visibility List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
          Structures
        </p>
        <div className="space-y-1">
          {structures.map(s => {
            const isVisible     = visibleStructures[s.id] ?? true;
            const isHighlighted = highlightedStructureIds.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => onToggleStructure(s.id)}
                className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors ${
                  isHighlighted
                    ? 'bg-cyan-950/60 border border-cyan-500/30'
                    : 'hover:bg-slate-800/60'
                }`}
                aria-label={`${isVisible ? 'Hide' : 'Show'} ${s.label}`}
                aria-pressed={isVisible}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isHighlighted ? '#06b6d4' : s.color }}
                  aria-hidden="true"
                />
                <span className={`text-[10px] flex-1 truncate ${isHighlighted ? 'text-cyan-300 font-semibold' : 'text-slate-300'}`}>
                  {s.label}
                </span>
                <span className="shrink-0">
                  {isVisible
                    ? <Eye className="w-3 h-3 text-slate-500" aria-hidden="true" />
                    : <EyeOff className="w-3 h-3 text-slate-700" aria-hidden="true" />
                  }
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer: Group legend */}
      <div className="px-3 py-2 border-t border-slate-800 flex gap-3">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#a5c8f0]" aria-hidden="true" />
          <span className="text-[9px] text-slate-500">Skeleton</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-[#06b6d4]" aria-hidden="true" />
          <span className="text-[9px] text-slate-500">Soft Tissue</span>
        </div>
      </div>
    </aside>
  );
};
