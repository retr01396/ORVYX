import React from 'react';
import { Activity, Box, Sparkles, Cpu, Layers, Cuboid } from 'lucide-react';

export type WorkstationViewMode = 'xray' | 'ct' | '3d';

interface HeaderProps {
  device?: string;
  runtimeMs?: number;
  viewMode: WorkstationViewMode;
  onViewModeChange: (mode: WorkstationViewMode) => void;
  isCoPilotOpen: boolean;
  onToggleCoPilot: () => void;
  activeStudyTitle?: string;
  activePatientId?: string;
}

export const Header: React.FC<HeaderProps> = ({
  device = 'mps',
  runtimeMs,
  viewMode,
  onViewModeChange,
  isCoPilotOpen,
  onToggleCoPilot,
  activeStudyTitle,
  activePatientId,
}) => {
  return (
    <header className="h-14 bg-slate-900/95 border-b border-slate-800 px-5 flex items-center justify-between select-none z-40 backdrop-blur-md">
      {/* Brand & Modality indicator */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Activity className="w-5 h-5 text-white stroke-[2.5]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-base tracking-wider text-white">ORVYX</span>
            <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/30">
              Workstation
            </span>
            {activeStudyTitle && (
              <span className="text-[11px] font-mono text-slate-400 max-w-[220px] truncate hidden md:inline-block">
                • {activeStudyTitle} {activePatientId && `(${activePatientId})`}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 font-mono tracking-tight leading-none">
            Thoracic Multimodal Diagnostic System
          </p>
        </div>
      </div>

      {/* Unified Modality Navigation Tabs */}
      <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-lg border border-slate-800" role="tablist" aria-label="Workstation view mode">
        {/* 1. 2D CXR Tab */}
        <button
          onClick={() => onViewModeChange('xray')}
          role="tab"
          aria-selected={viewMode === 'xray'}
          aria-label="Switch to 2D X-Ray view"
          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            viewMode === 'xray'
              ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 shadow-sm shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Layers className={`w-3.5 h-3.5 ${viewMode === 'xray' ? 'text-cyan-400' : 'text-slate-400'}`} />
          <span>2D X-RAY</span>
        </button>

        {/* 2. CT / MPR Tab */}
        <button
          onClick={() => onViewModeChange('ct')}
          role="tab"
          aria-selected={viewMode === 'ct'}
          aria-label="Switch to CT / MPR view"
          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            viewMode === 'ct'
              ? 'bg-purple-950/80 text-purple-300 border border-purple-500/50 shadow-sm shadow-purple-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Box className={`w-3.5 h-3.5 ${viewMode === 'ct' ? 'text-purple-400' : 'text-slate-400'}`} />
          <span>CT / MPR</span>
        </button>

        {/* 3. 3D Anatomy Tab */}
        <button
          onClick={() => onViewModeChange('3d')}
          role="tab"
          aria-selected={viewMode === '3d'}
          aria-label="Switch to 3D Anatomy view"
          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            viewMode === '3d'
              ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/50 shadow-sm shadow-indigo-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Cuboid className={`w-3.5 h-3.5 ${viewMode === '3d' ? 'text-indigo-400' : 'text-slate-400'}`} />
          <span>3D ANATOMY</span>
        </button>

        <div className="w-[1px] h-5 bg-slate-800 mx-1" />

        {/* 4. AI Co-Pilot Toggle */}
        <button
          onClick={onToggleCoPilot}
          aria-pressed={isCoPilotOpen}
          aria-label={isCoPilotOpen ? 'Close AI Co-Pilot panel' : 'Open AI Co-Pilot panel'}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
            isCoPilotOpen
              ? 'bg-gradient-to-r from-purple-900/90 to-indigo-900/90 text-purple-200 border border-purple-400/60 shadow-md shadow-purple-500/30'
              : 'text-purple-300 hover:text-purple-100 hover:bg-purple-950/40 border border-purple-500/20'
          }`}
        >
          <Sparkles className={`w-3.5 h-3.5 ${isCoPilotOpen ? 'text-purple-300 animate-pulse' : 'text-purple-400'}`} />
          <span>AI CO-PILOT</span>
          <span className={`text-[9px] uppercase px-1 py-0.2 rounded font-mono ${
            isCoPilotOpen ? 'bg-purple-400 text-slate-950 font-bold' : 'bg-purple-950/80 text-purple-300'
          }`}>
            ON
          </span>
        </button>
      </div>


      {/* Hardware & Runtime Engine Indicator */}
      <div className="flex items-center gap-3">
        {runtimeMs !== undefined && (
          <div className="text-[11px] font-mono text-slate-400 hidden sm:block">
            Latency: <span className="text-cyan-400 font-semibold">{runtimeMs}ms</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-xs font-mono">
          <Cpu className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-slate-300 text-[11px]">Device:</span>
          <span className="text-emerald-400 font-bold uppercase text-[11px]">{device}</span>
        </div>
      </div>
    </header>
  );
};
