import React, { useState } from 'react';
import {
  Sparkles,
  Activity,
  Layers,
  ChevronRight,
  Info,
  Target
} from 'lucide-react';
import type { Finding, Segment, Provenance, Centroid } from '../types/studystate';
import { FINDING_ANATOMY_MAP, SEGMENT_COLORS } from '../types/studystate';

interface InsightsPanelProps {
  findings: Finding[];
  segments: Segment[];
  provenance?: Provenance;
  visibleSegments: Record<string, boolean>;
  onToggleSegment: (name: string) => void;
  onFocusAnatomy: (name: string, centroid: Centroid) => void;
  focusedTarget: { name: string; centroid: Centroid } | null;
  limitations: string[];
}

export const InsightsPanel: React.FC<InsightsPanelProps> = ({
  findings,
  segments,
  provenance,
  visibleSegments,
  onToggleSegment,
  onFocusAnatomy,
  focusedTarget,
  limitations,
}) => {
  const [activeTab, setActiveTab] = useState<'findings' | 'anatomy'>('findings');

  // Helper to trigger focus when a finding is clicked
  const handleFindingClick = (finding: Finding) => {
    const mappedAnatomy = FINDING_ANATOMY_MAP[finding.label] || [];
    if (mappedAnatomy.length > 0) {
      // Find the first available segment
      const targetName = mappedAnatomy[0];
      const targetSegment = segments.find((s) => s.name === targetName);
      if (targetSegment) {
        // Ensure segment is visible
        if (!visibleSegments[targetName]) {
          onToggleSegment(targetName);
        }
        onFocusAnatomy(targetName, targetSegment.centroid);
      }
    }
  };

  return (
    <aside className="w-84 bg-slate-900 border-l border-slate-800 flex flex-col h-full shrink-0 select-none">
      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/40 p-1">
        <button
          onClick={() => setActiveTab('findings')}
          className={`flex-1 py-2 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'findings'
              ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>AI Findings ({findings.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('anatomy')}
          className={`flex-1 py-2 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all ${
            activeTab === 'anatomy'
              ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span>Anatomy ({segments.length})</span>
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {activeTab === 'findings' ? (
          <>
            {/* Clinical Notice */}
            <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-500/20 flex items-start gap-2">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-cyan-200/80 leading-relaxed">
                Click any finding below to navigate and focus the viewport on its associated anatomical region.
              </p>
            </div>

            {/* Findings List (18 Pathologies) */}
            <div className="space-y-1.5">
              {findings.map((finding) => {
                const mappedAnatomy = FINDING_ANATOMY_MAP[finding.label];
                const isElevated = finding.band === 'elevated';
                const isModerate = finding.band === 'moderate';

                return (
                  <div
                    key={finding.label}
                    onClick={() => handleFindingClick(finding)}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer group ${
                      isElevated
                        ? 'bg-rose-950/20 border-rose-500/30 hover:bg-rose-950/30 hover:border-rose-500/50'
                        : isModerate
                        ? 'bg-amber-950/15 border-amber-500/25 hover:bg-amber-950/25 hover:border-amber-500/40'
                        : 'bg-slate-800/40 border-slate-800/70 hover:bg-slate-800/70 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-cyan-300 transition-colors">
                        {finding.label}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded font-bold ${
                            isElevated
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isModerate
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {finding.band}
                        </span>
                        <span className="font-mono text-xs font-bold text-slate-300 min-w-10 text-right">
                          {(finding.score * 100).toFixed(1)}%
                        </span>
                        {mappedAnatomy && (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 transition-transform group-hover:translate-x-0.5" />
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-950/60 rounded-full h-1.5 mt-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isElevated
                            ? 'bg-rose-500'
                            : isModerate
                            ? 'bg-amber-500'
                            : 'bg-slate-600'
                        }`}
                        style={{ width: `${Math.max(finding.score * 100, 3)}%` }}
                      />
                    </div>

                    {mappedAnatomy && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                        <Target className="w-2.5 h-2.5 text-cyan-400" />
                        <span>Focal Region: {mappedAnatomy.join(', ')}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Anatomy Segments Toggle List */
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400 mb-2">
              Toggle 14 anatomical structures segmented by PSPNet:
            </p>
            {segments.map((seg) => {
              const isVisible = visibleSegments[seg.name];
              const color = SEGMENT_COLORS[seg.name] || { hex: '#06b6d4' };
              const isFocused = focusedTarget?.name === seg.name;

              return (
                <div
                  key={seg.name}
                  className={`p-2 rounded-lg border flex items-center justify-between transition-all ${
                    isFocused
                      ? 'bg-cyan-950/40 border-cyan-500 ring-1 ring-cyan-500/30'
                      : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/70'
                  }`}
                >
                  <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => onToggleSegment(seg.name)}
                      className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 bg-slate-900"
                    />
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="text-xs text-slate-300 font-medium">
                      {seg.name}
                    </span>
                  </label>

                  <button
                    onClick={() => onFocusAnatomy(seg.name, seg.centroid)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-cyan-950 hover:text-cyan-300 text-slate-400 border border-slate-700/60"
                  >
                    Focus
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Provenance Card */}
        {provenance && (
          <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2 mt-4">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-cyan-400" />
              Provenance & Hardware Audit
            </h4>
            <div className="space-y-1 text-[11px] font-mono text-slate-400">
              <div className="flex justify-between">
                <span>Classifier:</span>
                <span className="text-slate-300 font-semibold">{provenance.classifier_model}</span>
              </div>
              <div className="flex justify-between">
                <span>Segmenter:</span>
                <span className="text-slate-300 font-semibold">{provenance.segmentation_model}</span>
              </div>
              <div className="flex justify-between">
                <span>TXRV Version:</span>
                <span className="text-slate-300">{provenance.version}</span>
              </div>
              <div className="flex justify-between">
                <span>Execution Device:</span>
                <span className="text-emerald-400 font-bold uppercase">{provenance.device}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800/80 pt-1 mt-1">
                <span>Inference Latency:</span>
                <span className="text-cyan-400 font-bold">{provenance.runtime_ms} ms</span>
              </div>
            </div>
          </div>
        )}

        {/* Limitations Notice */}
        {limitations.length > 0 && (
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[10px] text-slate-400 space-y-1">
            <span className="font-semibold text-slate-300 uppercase tracking-wide block">Model Limitations:</span>
            <ul className="list-disc list-inside space-y-0.5">
              {limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
};
