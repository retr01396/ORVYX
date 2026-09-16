import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Banner } from './components/Banner';
import { Header, type WorkstationViewMode } from './components/Header';
import { StudyRail } from './components/StudyRail';
import { Viewport } from './components/Viewport';
import { InsightsPanel } from './components/InsightsPanel';
import { CTControlPanel } from './components/ct/CTControlPanel';
import { MPRViewer } from './components/ct/MPRViewer';
import { Volume3DViewer } from './components/ct/Volume3DViewer';
import { AICoPilotPanel } from './components/copilot/AICoPilotPanel';
import { ThoracicReconstructionViewer } from './components/reconstruction/ThoracicReconstructionViewer';
import { ReconstructionPanel } from './components/reconstruction/ReconstructionPanel';
import type { StudySummary, StudyState, Centroid, Finding } from './types/studystate';
import type { CTStudyMetadata, CrosshairPosition } from './types/ct';
import type { CoPilotResponse, CoPilotFinding, CoPilotMeasurement } from './types/copilot';
import type { ThoracicStructure, ReconstructionPhase } from './types/reconstruction';
import { FINDING_TO_3D_STRUCTURE } from './types/reconstruction';

export const App: React.FC = () => {
  // Top-level unified modality switch: 'xray' | 'ct' | '3d'
  const [viewMode, setViewMode] = useState<WorkstationViewMode>('xray');

  // ==========================================
  // STUDY & INGESTION STATE
  // ==========================================
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState<string>('demo-1');
  // Ref that always holds the current selectedStudyId — used in async closures
  // to correctly discard stale responses when the user switches studies mid-flight.
  const activeStudyRef = useRef<string>('demo-1');
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [studyStates, setStudyStates] = useState<Record<string, StudyState>>({});
  const [error, setError] = useState<string | null>(null);

  // Viewport overlays & focus for X-Ray
  const [visibleSegments, setVisibleSegments] = useState<Record<string, boolean>>({});
  const [focusedTarget, setFocusedTarget] = useState<{ name: string; centroid: Centroid } | null>(null);
  const [opacity, setOpacity] = useState<number>(0.45);

  // ==========================================
  // PHASE 2: 3D CT WORKSTATION STATE
  // ==========================================
  const [ctMetadata, setCtMetadata] = useState<CTStudyMetadata | null>(null);
  const [ctCrosshair, setCtCrosshair] = useState<CrosshairPosition>({ x: 256, y: 256, z: 69 });
  const [ctWindowPreset, setCtWindowPreset] = useState<string>('lung');
  const [ctVisibleStructures, setCtVisibleStructures] = useState<Record<string, boolean>>({});
  const [ctOpacity, setCtOpacity] = useState<number>(0.45);
  const [focusedStructure, setFocusedStructure] = useState<string | null>(null);
  const [loadingCT, setLoadingCT] = useState<boolean>(false);

  // ==========================================
  // PHASE 3: AI CO-PILOT STATE
  // ==========================================
  const [isCoPilotOpen, setIsCoPilotOpen] = useState<boolean>(false);
  const [copilotData, setCopilotData] = useState<CoPilotResponse | null>(null);
  const [loadingCoPilot, setLoadingCoPilot] = useState<boolean>(false);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  // ==========================================
  // PHASE 4: 3D RECONSTRUCTION STATE
  // ==========================================
  const [reconstructionPhase, setReconstructionPhase] = useState<ReconstructionPhase>('idle');
  const [reconstructionProgress, setReconstructionProgress] = useState<number>(0);
  const [thoracicStructures, setThoracicStructures] = useState<ThoracicStructure[]>([]);
  const [reconVisibleStructures, setReconVisibleStructures] = useState<Record<string, boolean>>({});
  const [reconHighlightedIds, setReconHighlightedIds] = useState<string[]>([]);

  // Fetch thoracic template on mount
  useEffect(() => {
    fetch('/api/reconstruction/template')
      .then(res => res.ok ? res.json() : null)
      .then((data: { structures: ThoracicStructure[]; finding_map: Record<string, string[]> } | null) => {
        if (!data) return;
        setThoracicStructures(data.structures);
        const vis: Record<string, boolean> = {};
        data.structures.forEach(s => { vis[s.id] = true; });
        setReconVisibleStructures(vis);
      })
      .catch(() => {/* template fetch fail is non-fatal */});
  }, []);

  // Auto-advance reconstruction phase when analysis completes
  useEffect(() => {
    if (viewMode !== 'reconstruction') return;
    const result = studyStates[selectedStudyId];
    if (result && reconstructionPhase === 'idle') {
      setReconstructionPhase('building');
      setReconstructionProgress(45);
    }
  }, [viewMode, studyStates, selectedStudyId, reconstructionPhase]);

  // When switching to reconstruction tab and analysis is already done, start animation
  const handleViewModeChange = useCallback((mode: WorkstationViewMode) => {
    setViewMode(mode);
    if (mode === 'reconstruction') {
      const result = studyStates[selectedStudyId];
      if (result) {
        setReconstructionPhase('building');
        setReconstructionProgress(45);
      } else if (!analyzing) {
        setReconstructionPhase('analyzing');
        setReconstructionProgress(20);
        handleAnalyze(selectedStudyId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyStates, selectedStudyId, analyzing]);

  const handleToggleReconStructure = useCallback((id: string) => {
    setReconVisibleStructures(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleViewFindingIn3D = useCallback((finding: Finding) => {
    setViewMode('reconstruction');
    const mapped = FINDING_TO_3D_STRUCTURE[finding.label] || [];
    setReconHighlightedIds(mapped);
    setReconstructionPhase('building');
    setReconstructionProgress(45);
  }, []);

  // 1. Fetch available studies (demo + uploaded)
  useEffect(() => {
    fetch('/api/xray/studies')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch studies: ${res.statusText}`);
        return res.json();
      })
      .then((data: StudySummary[]) => {
        setStudies(data);
        if (data.length > 0 && !selectedStudyId) {
          setSelectedStudyId(data[0].study_id);
        }
      })
      .catch((err) => {
        console.error('Error fetching studies:', err);
        setError(err.message);
      });
  }, []);

  // 2. Automatically trigger analysis for initial selected study if not already done
  useEffect(() => {
    if (selectedStudyId && !studyStates[selectedStudyId] && !analyzing) {
      handleAnalyze(selectedStudyId);
    }
  }, [selectedStudyId]);

  // 3. Fetch CT study metadata when switched to CT/3D mode or when Co-Pilot opens
  useEffect(() => {
    if ((viewMode === 'ct' || viewMode === '3d' || isCoPilotOpen) && !ctMetadata && !loadingCT) {
      setLoadingCT(true);
      fetch('/api/ct/study')
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load CT study: ${res.statusText}`);
          return res.json();
        })
        .then((data: CTStudyMetadata) => {
          setCtMetadata(data);
          // Default all structures to visible
          const initialVis: Record<string, boolean> = {};
          data.structures.forEach((s) => {
            initialVis[s.id] = true;
          });
          setCtVisibleStructures(initialVis);
        })
        .catch((err) => {
          console.error('Failed to load CT study data:', err);
          setError(err.message);
        })
        .finally(() => {
          setLoadingCT(false);
        });
    }
  }, [viewMode, isCoPilotOpen, ctMetadata, loadingCT]);

  // Helper to refresh dynamic Co-Pilot context
  const refreshCoPilot = (studyId: string) => {
    setLoadingCoPilot(true);
    fetch('/api/copilot/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        study_id: studyId,
        xray_study_id: studyId,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Co-Pilot context error: ${res.statusText}`);
        return res.json();
      })
      .then((data: CoPilotResponse) => {
        // Discard stale response if user has switched to a different study
        if (activeStudyRef.current !== studyId) return;
        setCopilotData(data);
      })
      .catch((err) => {
        console.error('Failed to load Co-Pilot context:', err);
      })
      .finally(() => {
        setLoadingCoPilot(false);
      });
  };


  // 4. Fetch / refresh Co-Pilot context when opened or active study changes
  useEffect(() => {
    if (isCoPilotOpen && selectedStudyId) {
      refreshCoPilot(selectedStudyId);
    }
  }, [isCoPilotOpen, selectedStudyId]);

  // Ingestion: Upload custom radiograph
  const handleUploadStudy = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/xray/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errJson.detail || `Upload failed: ${res.status}`);
      }

      const newStudy: StudySummary = await res.json();
      setStudies((prev) => [newStudy, ...prev.filter((s) => s.study_id !== newStudy.study_id)]);
      activeStudyRef.current = newStudy.study_id;
      setSelectedStudyId(newStudy.study_id);
      setViewMode('xray');
      // Trigger analysis immediately upon ingestion
      handleAnalyze(newStudy.study_id);

    } catch (err: any) {
      console.error('Upload failed:', err);
      setUploadError(err.message || 'File upload failed');
      throw err;
    } finally {
      setUploading(false);
    }
  };

  // Execute X-Ray Analysis
  const handleAnalyze = async (studyId: string) => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/xray/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ study_id: studyId }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errJson.detail || `Inference error: ${res.status}`);
      }

      const state: StudyState = await res.json();
      // Only update state if this analysis is still for the active study.
      // activeStudyRef.current always reflects the current selectedStudyId at the
      // time the response arrives — unlike the closure-captured studyId which
      // is frozen at call time but never changes (making it useless as a guard).
      if (activeStudyRef.current !== studyId) return;

      setStudyStates((prev) => ({ ...prev, [studyId]: state }));

      // Initialize all 14 segments as visible by default
      const initialVisibility: Record<string, boolean> = {};
      state.segments.forEach((seg) => {
        initialVisibility[seg.name] = true;
      });
      setVisibleSegments(initialVisibility);

      if (isCoPilotOpen) {
        refreshCoPilot(studyId);
      }
    } catch (err: any) {
      console.error('Analysis failed:', err);
      setError(err.message || 'Inference execution failed');
    } finally {
      setAnalyzing(false);
    }
  };


  const handleToggleSegment = (name: string) => {
    setVisibleSegments((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  };

  const handleToggleAllSegments = (visible: boolean) => {
    const next: Record<string, boolean> = {};
    currentResult?.segments.forEach((s) => {
      next[s.name] = visible;
    });
    setVisibleSegments(next);
  };

  const handleFocusAnatomy = (name: string, centroid: Centroid) => {
    setFocusedTarget({ name, centroid });
  };

  const handleClearFocus = () => {
    setFocusedTarget(null);
  };

  // ==========================================
  // CT EVENT HANDLERS
  // ==========================================
  const handleUpdateCrosshair = (pos: Partial<CrosshairPosition>) => {
    setCtCrosshair((prev) => ({ ...prev, ...pos }));
  };

  const handleToggleCTStructure = (id: string) => {
    setCtVisibleStructures((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleToggleAllCTStructures = (visible: boolean) => {
    const next: Record<string, boolean> = {};
    ctMetadata?.structures.forEach((s) => {
      next[s.id] = visible;
    });
    setCtVisibleStructures(next);
  };

  const handleFilterCTGroup = (groupSubstring: string) => {
    const next: Record<string, boolean> = {};
    ctMetadata?.structures.forEach((s) => {
      next[s.id] = s.group.toLowerCase().includes(groupSubstring.toLowerCase());
    });
    setCtVisibleStructures(next);
  };

  const handleFocusCTStructure = (id: string, voxelCentroid: [number, number, number]) => {
    setFocusedStructure(id);
    // Snap MPR crosshair to structure voxel centroid: X, Y, Z
    setCtCrosshair({
      x: Math.max(0, Math.min(511, Math.round(voxelCentroid[0]))),
      y: Math.max(0, Math.min(511, Math.round(voxelCentroid[1]))),
      z: Math.max(0, Math.min(138, Math.round(voxelCentroid[2]))),
    });
  };

  const handleClearCTFocus = () => {
    setFocusedStructure(null);
  };

  // ==========================================
  // PHASE 3: CO-PILOT INTERACTION HANDLERS
  // ==========================================
  const handleSelectCoPilotFinding = (finding: CoPilotFinding) => {
    setSelectedFindingId(finding.id);

    if (finding.anatomy) {
      if (finding.anatomy.modality === 'ct') {
        // Switch view to CT workstation
        setViewMode('ct');
        // Set focused structure for 3D camera
        setFocusedStructure(finding.anatomy.structure_id);
        // Snap MPR crosshairs if voxel coordinates available
        if (finding.anatomy.voxel_centroid) {
          const [vx, vy, vz] = finding.anatomy.voxel_centroid;
          setCtCrosshair({
            x: Math.max(0, Math.min(511, Math.round(vx))),
            y: Math.max(0, Math.min(511, Math.round(vy))),
            z: Math.max(0, Math.min(138, Math.round(vz))),
          });
        }
      } else if (finding.anatomy.modality === 'xray') {
        // Switch view to X-Ray workstation
        setViewMode('xray');
        // Focus 2D target on radiograph
        if (finding.anatomy.image_centroid) {
          const [ix, iy] = finding.anatomy.image_centroid;
          setFocusedTarget({
            name: finding.title,
            centroid: { x: ix, y: iy },
          });
        }
      }
    }

    // Phase 4: Also highlight corresponding 3D reconstruction structures
    const structIds = FINDING_TO_3D_STRUCTURE[finding.title] ?? [];
    if (structIds.length > 0) {
      setReconHighlightedIds(structIds);
    }
  };

  const handleSelectCoPilotMeasurement = (measurement: CoPilotMeasurement) => {
    if (measurement.anatomy_id) {
      setViewMode('ct');
      setFocusedStructure(measurement.anatomy_id);
      const struct = ctMetadata?.structures.find((s) => s.id === measurement.anatomy_id);
      if (struct) {
        setCtCrosshair({
          x: Math.round(struct.voxel_centroid[0]),
          y: Math.round(struct.voxel_centroid[1]),
          z: Math.round(struct.voxel_centroid[2]),
        });
      }
    }
  };

  const currentResult = studyStates[selectedStudyId];
  const currentStudy = studies.find((s) => s.study_id === selectedStudyId);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* 1. Non-dismissible disclaimer banner */}
      <Banner />

      {/* 2. Top application header */}
      <Header
        device={currentResult?.provenance.device || 'mps'}
        runtimeMs={currentResult?.provenance.runtime_ms}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isCoPilotOpen={isCoPilotOpen}
        onToggleCoPilot={() => setIsCoPilotOpen(!isCoPilotOpen)}
        activeStudyTitle={currentStudy?.title}
        activePatientId={currentStudy?.patient_id}
      />

      {/* Global Error Notice if any */}
      {error && (
        <div className="bg-rose-950/90 border-b border-rose-500/50 px-4 py-2 text-xs text-rose-200 flex items-center justify-between z-30">
          <span>
            <strong>System Error:</strong> {error}
          </span>
          <button
            onClick={() => setError(null)}
            className="px-2 py-0.5 rounded bg-rose-800 text-rose-100 hover:bg-rose-700 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3. Main Workstation Area */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'xray' ? (
          /* Phase 1: 2D Chest Radiograph Workstation */
          <>
            {/* Left: Study Rail & Ingestion */}
            <StudyRail
              studies={studies}
              selectedId={selectedStudyId}
              onSelectStudy={(id) => {
                if (id !== selectedStudyId) {
                  activeStudyRef.current = id;
                  setSelectedStudyId(id);
                  setFocusedTarget(null);
                  setSelectedFindingId(null);
                  // Clear stale Co-Pilot data so it refreshes for the new study
                  setCopilotData(null);
                }
              }}
              onAnalyze={handleAnalyze}
              analyzing={analyzing}
              hasResult={!!currentResult}
              onUploadStudy={handleUploadStudy}
              uploading={uploading}
              uploadError={uploadError}
              onClearUploadError={() => setUploadError(null)}
            />

            {/* Center: Main High-Resolution Viewport */}
            <Viewport
              studyId={selectedStudyId}
              segments={currentResult?.segments || []}
              visibleSegments={visibleSegments}
              onToggleSegment={handleToggleSegment}
              onToggleAllSegments={handleToggleAllSegments}
              focusedTarget={focusedTarget}
              onClearFocus={handleClearFocus}
              opacity={opacity}
              setOpacity={setOpacity}
              analyzing={analyzing}
            />

            {/* Right: AI Findings & Insights Panel (shown when Co-Pilot panel is closed) */}
            {!isCoPilotOpen && (
              <InsightsPanel
                findings={currentResult?.findings || []}
                segments={currentResult?.segments || []}
                provenance={currentResult?.provenance}
                visibleSegments={visibleSegments}
                onToggleSegment={handleToggleSegment}
                onFocusAnatomy={handleFocusAnatomy}
                focusedTarget={focusedTarget}
                limitations={currentResult?.limitations || []}
                onViewIn3DRecon={handleViewFindingIn3D}
              />
            )}
          </>
        ) : viewMode === '3d' ? (
          /* Dedicated 3D Anatomical Reconstruction Viewport */
          <>
            {/* Left: CT Control Panel */}
            <CTControlPanel
              windowPreset={ctWindowPreset}
              onSelectWindowPreset={setCtWindowPreset}
              structures={ctMetadata?.structures || []}
              visibleStructures={ctVisibleStructures}
              onToggleStructure={handleToggleCTStructure}
              onToggleAll={handleToggleAllCTStructures}
              onFilterGroup={handleFilterCTGroup}
              opacity={ctOpacity}
              onChangeOpacity={setCtOpacity}
              crosshair={ctCrosshair}
              focusedStructure={focusedStructure}
              onFocusStructure={handleFocusCTStructure}
              onClearFocus={handleClearCTFocus}
            />

            {/* Center: Full-Canvas 3D Mesh Viewer */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 relative">
              <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs z-10">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold">
                    3D ANATOMICAL MESHES
                  </span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    Verified Thoracic Volume (ct-chest-1) • 8 TotalSegmentator Organs (7,094.7 mL)
                  </span>
                </div>
                {focusedStructure && (
                  <button
                    onClick={handleClearCTFocus}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-slate-700 cursor-pointer"
                  >
                    Reset Camera Focus
                  </button>
                )}
              </div>

              {ctMetadata ? (
                <div className="flex-1 relative min-h-0 w-full h-full">
                  <Volume3DViewer
                    structures={ctMetadata.structures}
                    visibleStructures={ctVisibleStructures}
                    opacity={ctOpacity}
                    crosshair={ctCrosshair}
                    focusedStructure={focusedStructure}
                    onSelectStructure={(id) => {
                      const s = ctMetadata.structures.find((item) => item.id === id);
                      if (s) handleFocusCTStructure(s.id, s.voxel_centroid);
                    }}
                    onResetFocus={handleClearCTFocus}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-mono text-xs">
                  Loading 3D Volume & Mesh Geometry...
                </div>
              )}
            </div>
          </>
        ) : viewMode === 'reconstruction' ? (
          /* Phase 4: X-ray → Cinematic 3D Thoracic Reconstruction */
          <>
            {/* Left: Reconstruction Progress Panel */}
            <ReconstructionPanel
              phase={reconstructionPhase}
              progress={reconstructionProgress}
              structures={thoracicStructures}
              visibleStructures={reconVisibleStructures}
              onToggleStructure={handleToggleReconStructure}
              highlightedStructureIds={reconHighlightedIds}
              elevatedFindings={currentResult?.findings?.filter(f => f.band !== 'low') ?? []}
              studyTitle={currentStudy?.title}
              studyImageUrl={selectedStudyId ? `/api/xray/image/${selectedStudyId}` : null}
            />

            {/* Center: Cinematic 3D Reconstruction Viewport */}
            <div className="flex-1 relative overflow-hidden">
              {thoracicStructures.length > 0 ? (
                <ThoracicReconstructionViewer
                  structures={thoracicStructures}
                  phase={reconstructionPhase}
                  highlightedStructureIds={reconHighlightedIds}
                  visibleStructures={reconVisibleStructures}
                  onPhaseComplete={() => {
                    setReconstructionPhase('complete');
                    setReconstructionProgress(100);
                  }}
                  onSelectStructure={(id) => {
                    setReconHighlightedIds(prev =>
                      prev.includes(id) ? prev.filter(x => x !== id) : [id]
                    );
                  }}
                  studyImageUrl={
                    selectedStudyId
                      ? `/api/xray/image/${selectedStudyId}`
                      : null
                  }
                  studyId={selectedStudyId}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-400 font-mono text-xs">
                  Loading thoracic template…
                </div>
              )}
            </div>
          </>
        ) : (
          /* Phase 2: 3D CT + Synchronized MPR Workstation */
          <>
            {/* Left: CT Control Panel */}
            <CTControlPanel
              windowPreset={ctWindowPreset}
              onSelectWindowPreset={setCtWindowPreset}
              structures={ctMetadata?.structures || []}
              visibleStructures={ctVisibleStructures}
              onToggleStructure={handleToggleCTStructure}
              onToggleAll={handleToggleAllCTStructures}
              onFilterGroup={handleFilterCTGroup}
              opacity={ctOpacity}
              onChangeOpacity={setCtOpacity}
              crosshair={ctCrosshair}
              focusedStructure={focusedStructure}
              onFocusStructure={handleFocusCTStructure}
              onClearFocus={handleClearCTFocus}
            />

            {/* Center: 4-Quadrant MPR + 3D Viewport */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {ctMetadata ? (
                <MPRViewer
                  crosshair={ctCrosshair}
                  onUpdateCrosshair={handleUpdateCrosshair}
                  windowPreset={ctWindowPreset}
                  structures={ctMetadata.structures}
                  visibleStructures={ctVisibleStructures}
                  opacity={ctOpacity}
                  render3DViewport={
                    <Volume3DViewer
                      structures={ctMetadata.structures}
                      visibleStructures={ctVisibleStructures}
                      opacity={ctOpacity}
                      crosshair={ctCrosshair}
                      focusedStructure={focusedStructure}
                      onSelectStructure={(id) => {
                        const s = ctMetadata.structures.find((item) => item.id === id);
                        if (s) handleFocusCTStructure(s.id, s.voxel_centroid);
                      }}
                      onResetFocus={handleClearCTFocus}
                    />
                  }
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 font-mono text-xs">
                  Loading CT Volume & TotalSegmentator metadata...
                </div>
              )}
            </div>
          </>
        )}

        {/* Phase 3: AI Co-Pilot Panel (docked right) */}
        {isCoPilotOpen && (
          <AICoPilotPanel
            data={copilotData}
            loading={loadingCoPilot}
            onClose={() => setIsCoPilotOpen(false)}
            onSelectFinding={handleSelectCoPilotFinding}
            onSelectMeasurement={handleSelectCoPilotMeasurement}
            selectedFindingId={selectedFindingId}
            onViewIn3DRecon={(structureId: string) => {
              setViewMode('reconstruction');
              setReconHighlightedIds([structureId]);
              setReconstructionPhase('building');
              setReconstructionProgress(45);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default App;
