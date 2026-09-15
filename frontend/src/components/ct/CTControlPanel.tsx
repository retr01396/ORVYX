import React from 'react';
import {
  Sliders,
  Crosshair,
  Focus,
  Activity,
  Heart,
  Wind,
  CheckSquare,
  Square,
} from 'lucide-react';
import type { OrganStructure, CrosshairPosition } from '../../types/ct';

interface CTControlPanelProps {
  windowPreset: string;
  onSelectWindowPreset: (preset: string) => void;
  structures: OrganStructure[];
  visibleStructures: Record<string, boolean>;
  onToggleStructure: (id: string) => void;
  onToggleAll: (visible: boolean) => void;
  onFilterGroup: (group: string) => void;
  opacity: number;
  onChangeOpacity: (opacity: number) => void;
  crosshair: CrosshairPosition;
  focusedStructure: string | null;
  onFocusStructure: (id: string, voxelCentroid: [number, number, number]) => void;
  onClearFocus: () => void;
}

export const CTControlPanel: React.FC<CTControlPanelProps> = ({
  windowPreset,
  onSelectWindowPreset,
  structures,
  visibleStructures,
  onToggleStructure,
  onToggleAll,
  onFilterGroup,
  opacity,
  onChangeOpacity,
  crosshair,
  focusedStructure,
  onFocusStructure,
  onClearFocus,
}) => {
  // Compute total segmented volume in mL
  const totalVolume = structures.reduce((sum, s) => sum + s.volume_cm3, 0);

  // Group structures by category
  const groups: Record<string, OrganStructure[]> = {};
  structures.forEach((s) => {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  });

  return (
    <aside className="w-80 bg-slate-900/95 border-r border-slate-800 flex flex-col h-full select-none overflow-hidden shrink-0 z-30">
      {/* 1. Header & Dataset Metadata */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h2 className="font-bold text-sm text-slate-100 tracking-wide">CT Workstation</h2>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            512×512×139
          </span>
        </div>
        <p className="text-[11px] text-slate-400 font-mono">
          Spacing: 0.76 × 0.76 × 2.50 mm (LPS)
        </p>
      </div>

      {/* Scrollable controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar">
        {/* 2. Window Presets */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Window Presets
            </span>
            <Sliders className="w-3.5 h-3.5 text-slate-500" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Lung Window Preset */}
            <button
              onClick={() => onSelectWindowPreset('lung')}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                windowPreset === 'lung'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-white shadow-sm shadow-cyan-500/10'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Wind className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-bold">Lung</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                W: 1500 / L: -600
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">
                Parenchyma & Air
              </div>
            </button>

            {/* Mediastinum Window Preset */}
            <button
              onClick={() => onSelectWindowPreset('mediastinum')}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                windowPreset === 'mediastinum'
                  ? 'bg-rose-950/60 border-rose-500/60 text-white shadow-sm shadow-rose-500/10'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Heart className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-xs font-bold">Mediastinum</span>
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                W: 350 / L: 40
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">
                Cardio & Soft Tissue
              </div>
            </button>
          </div>
        </div>

        {/* 3. 3D Opacity Slider */}
        <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-800">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-slate-300 font-medium">3D & Mask Opacity</span>
            <span className="font-mono text-cyan-400 font-semibold">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={opacity}
            onChange={(e) => onChangeOpacity(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* 4. TotalSegmentator Anatomy List */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                TotalSegmentator v2
              </span>
              <span className="ml-1.5 text-[10px] font-mono text-slate-500">
                ({structures.length} organs)
              </span>
            </div>
            {focusedStructure && (
              <button
                onClick={onClearFocus}
                className="text-[10px] text-cyan-400 hover:underline font-mono"
              >
                Clear Focus
              </button>
            )}
          </div>

          {/* Quick Group Filters */}
          <div className="flex items-center gap-1.5 mb-3 text-[10px] font-mono">
            <button
              onClick={() => onToggleAll(true)}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            >
              All
            </button>
            <button
              onClick={() => onToggleAll(false)}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            >
              None
            </button>
            <button
              onClick={() => onFilterGroup('Lung')}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            >
              Lungs
            </button>
            <button
              onClick={() => onFilterGroup('Cardiovascular')}
              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700"
            >
              Cardio
            </button>
          </div>

          {/* Structure Matrix grouped by category */}
          <div className="space-y-3">
            {Object.entries(groups).map(([groupName, groupStructures]) => (
              <div key={groupName} className="space-y-1">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 px-1">
                  {groupName}
                </div>
                <div className="space-y-1">
                  {groupStructures.map((s) => {
                    const isVisible = visibleStructures[s.id] !== false;
                    const isFocused = focusedStructure === s.id;

                    return (
                      <div
                        key={s.id}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                          isFocused
                            ? 'bg-cyan-950/50 border-cyan-500/60 shadow-sm shadow-cyan-500/10'
                            : isVisible
                            ? 'bg-slate-800/50 border-slate-700/50'
                            : 'bg-slate-900/40 border-slate-800/40 opacity-50'
                        }`}
                      >
                        <div
                          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                          onClick={() => onToggleStructure(s.id)}
                        >
                          {/* Toggle Checkbox */}
                          <div className="shrink-0 text-slate-400 hover:text-white">
                            {isVisible ? (
                              <CheckSquare className="w-3.5 h-3.5 text-cyan-400" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </div>

                          {/* Organ Color Pill */}
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: s.color }}
                          />

                          {/* Organ Label & Volume */}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-slate-200 truncate">
                              {s.label}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {s.volume_cm3.toFixed(1)} mL
                            </div>
                          </div>
                        </div>

                        {/* Focus / Fly-to Button */}
                        <button
                          onClick={() => onFocusStructure(s.id, s.voxel_centroid)}
                          title={`Focus 3D camera & center MPR crosshairs on ${s.label}`}
                          className={`p-1.5 rounded text-xs transition-colors shrink-0 ml-1 ${
                            isFocused
                              ? 'bg-cyan-500 text-slate-950 font-bold'
                              : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-cyan-300'
                          }`}
                        >
                          <Focus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Quantitative Volume Summary */}
          <div className="mt-3 p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-[11px] font-mono flex items-center justify-between">
            <span className="text-slate-400">Total Segmented:</span>
            <span className="text-cyan-300 font-bold">{totalVolume.toFixed(1)} mL</span>
          </div>
        </div>

        {/* 5. Synchronized Coordinates Readout */}
        <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1.5 font-mono text-[11px]">
          <div className="flex items-center gap-1 text-cyan-400 font-bold uppercase tracking-wide text-[10px] mb-1">
            <Crosshair className="w-3 h-3" />
            <span>Active MPR Crosshair</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Voxel:</span>
            <span className="text-cyan-300 font-bold">
              X:{crosshair.x} Y:{crosshair.y} Z:{crosshair.z}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Physical:</span>
            <span className="text-slate-300">
              {`(${(-195.0 + crosshair.x * 0.7617).toFixed(1)}, ${(-171.7 + crosshair.y * 0.7617).toFixed(1)}, ${(-347.8 + crosshair.z * 2.5).toFixed(1)}) mm`}
            </span>
          </div>
          <div className="flex justify-between pt-1 border-t border-slate-800/80">
            <span className="text-slate-400">Preset:</span>
            <span className="text-emerald-400 font-bold uppercase">{windowPreset}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
