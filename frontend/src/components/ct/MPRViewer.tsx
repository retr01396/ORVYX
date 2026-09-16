import React, { useRef } from 'react';
import { Layers, Crosshair } from 'lucide-react';
import type { CrosshairPosition, OrganStructure } from '../../types/ct';

interface MPRViewerProps {
  crosshair: CrosshairPosition;
  onUpdateCrosshair: (pos: Partial<CrosshairPosition>) => void;
  windowPreset: string;
  structures: OrganStructure[];
  visibleStructures: Record<string, boolean>;
  opacity: number;
  render3DViewport?: React.ReactNode;
}

export const MPRViewer: React.FC<MPRViewerProps> = ({
  crosshair,
  onUpdateCrosshair,
  windowPreset,
  structures,
  visibleStructures,
  opacity,
  render3DViewport,
}) => {
  return (
    <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2 p-2 bg-slate-950 select-none overflow-hidden">
      {/* 1. AXIAL VIEWPORT (Z-slice, X & Y plane) */}
      <OrthogonalPlane
        name="Axial (Transverse)"
        subtitle="Inferior - Superior (Z-cut)"
        plane="axial"
        index={crosshair.z}
        maxIndex={138}
        sliceLabel={`Z: ${crosshair.z} / 138`}
        coordLabel={`Z = ${(-347.8 + crosshair.z * 2.5).toFixed(1)} mm`}
        crossX={crosshair.x / 512.0}
        crossY={crosshair.y / 512.0}
        onScrollSlice={(delta) =>
          onUpdateCrosshair({ z: Math.max(0, Math.min(138, crosshair.z + delta)) })
        }
        onCanvasClick={(u, v) =>
          onUpdateCrosshair({
            x: Math.round(u * 512),
            y: Math.round(v * 512),
          })
        }
        windowPreset={windowPreset}
        structures={structures}
        visibleStructures={visibleStructures}
        opacity={opacity}
        axisLabels={{ top: 'A (Anterior)', bottom: 'P (Posterior)', left: 'R (Right)', right: 'L (Left)' }}
      />

      {/* 2. CORONAL VIEWPORT (Y-slice, X & Z plane) */}
      <OrthogonalPlane
        name="Coronal (Frontal)"
        subtitle="Anterior - Posterior (Y-cut)"
        plane="coronal"
        index={crosshair.y}
        maxIndex={511}
        sliceLabel={`Y: ${crosshair.y} / 511`}
        coordLabel={`Y = ${(-171.7 + crosshair.y * 0.7617).toFixed(1)} mm`}
        crossX={crosshair.x / 512.0}
        crossY={1.0 - crosshair.z / 138.0} // Superior on top
        onScrollSlice={(delta) =>
          onUpdateCrosshair({ y: Math.max(0, Math.min(511, crosshair.y + delta)) })
        }
        onCanvasClick={(u, v) =>
          onUpdateCrosshair({
            x: Math.round(u * 512),
            z: Math.round((1.0 - v) * 138),
          })
        }
        windowPreset={windowPreset}
        structures={structures}
        visibleStructures={visibleStructures}
        opacity={opacity}
        axisLabels={{ top: 'S (Superior)', bottom: 'I (Inferior)', left: 'R (Right)', right: 'L (Left)' }}
      />

      {/* 3. SAGITTAL VIEWPORT (X-slice, Y & Z plane) */}
      <OrthogonalPlane
        name="Sagittal (Lateral)"
        subtitle="Right - Left (X-cut)"
        plane="sagittal"
        index={crosshair.x}
        maxIndex={511}
        sliceLabel={`X: ${crosshair.x} / 511`}
        coordLabel={`X = ${(-195.0 + crosshair.x * 0.7617).toFixed(1)} mm`}
        crossX={crosshair.y / 512.0} // Anterior on left
        crossY={1.0 - crosshair.z / 138.0} // Superior on top
        onScrollSlice={(delta) =>
          onUpdateCrosshair({ x: Math.max(0, Math.min(511, crosshair.x + delta)) })
        }
        onCanvasClick={(u, v) =>
          onUpdateCrosshair({
            y: Math.round(u * 512),
            z: Math.round((1.0 - v) * 138),
          })
        }
        windowPreset={windowPreset}
        structures={structures}
        visibleStructures={visibleStructures}
        opacity={opacity}
        axisLabels={{ top: 'S (Superior)', bottom: 'I (Inferior)', left: 'A (Anterior)', right: 'P (Posterior)' }}
      />

      {/* 4. 3D VIEWPORT OR MPR INFO & NAVIGATION SUMMARY */}
      {render3DViewport ? (
        <div className="w-full h-full overflow-hidden rounded-lg">
          {render3DViewport}
        </div>
      ) : (
        <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between text-xs font-mono">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-[11px] mb-2">
              <Layers className="w-4 h-4" />
              <span>Synchronized MPR Navigation</span>
            </div>
            <p className="text-slate-400 text-[11px] font-sans leading-relaxed mb-3">
              Multi-Planar Reconstruction projects orthogonal views from the 3D CT volume with physical aspect ratio correction ($dz/dx \approx 3.28$).
            </p>

            <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800 space-y-1.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Current Crosshair:</span>
                <span className="text-cyan-300 font-bold">
                  X:{crosshair.x} Y:{crosshair.y} Z:{crosshair.z}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Physical Coordinates:</span>
                <span className="text-slate-300 font-bold">
                  {`(${(-195.0 + crosshair.x * 0.7617).toFixed(1)}, ${(-171.7 + crosshair.y * 0.7617).toFixed(1)}, ${(-347.8 + crosshair.z * 2.5).toFixed(1)}) mm`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Active Window:</span>
                <span className="text-emerald-400 font-bold uppercase">
                  {windowPreset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Voxel Dimensions:</span>
                <span className="text-slate-300">512 × 512 × 139</span>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-slate-500 font-sans flex items-center gap-1.5 pt-2 border-t border-slate-800">
            <Crosshair className="w-3 h-3 text-cyan-400 shrink-0" />
            <span>Click anywhere in any plane to reposition the 3D crosshair cut. Scroll wheel changes slices.</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface OrthogonalPlaneProps {
  name: string;
  subtitle: string;
  plane: string;
  index: number;
  maxIndex: number;
  sliceLabel: string;
  coordLabel: string;
  crossX: number; // 0.0 - 1.0
  crossY: number; // 0.0 - 1.0
  onScrollSlice: (delta: number) => void;
  onCanvasClick: (u: number, v: number) => void;
  windowPreset: string;
  structures: OrganStructure[];
  visibleStructures: Record<string, boolean>;
  opacity: number;
  axisLabels: { top: string; bottom: string; left: string; right: string };
}

const OrthogonalPlane: React.FC<OrthogonalPlaneProps> = ({
  name,
  subtitle,
  plane,
  index,
  maxIndex,
  sliceLabel,
  coordLabel,
  crossX,
  crossY,
  onScrollSlice,
  onCanvasClick,
  windowPreset,
  structures,
  visibleStructures,
  opacity,
  axisLabels,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    onScrollSlice(delta);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onCanvasClick(u, v);
  };

  return (
    <div
      onWheel={handleWheel}
      className="relative bg-black rounded-lg border border-slate-800 overflow-hidden flex flex-col group shadow-md"
    >
      {/* Header Overlay */}
      <div className="absolute top-2 left-2 z-20 pointer-events-none flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-slate-200 tracking-wide">{name}</span>
          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800/80 text-cyan-400 border border-slate-700/60">
            {sliceLabel}
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">{coordLabel} • {subtitle}</span>
      </div>

      {/* Anatomical Orientation Tags */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase">
        {axisLabels.top}
      </div>
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase">
        {axisLabels.bottom}
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 left-1.5 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase [writing-mode:vertical-lr] rotate-180">
        {axisLabels.left}
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 right-1.5 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase [writing-mode:vertical-lr]">
        {axisLabels.right}
      </div>

      {/* Viewport Canvas Stage */}
      <div
        ref={containerRef}
        onClick={handleClick}
        className="flex-1 w-full h-full relative cursor-crosshair flex items-center justify-center overflow-hidden"
      >
        {/* CT Image Slice */}
        <img
          src={`/api/ct/slice?plane=${plane}&index=${index}&window=${windowPreset}`}
          alt={`${name} CT Slice`}
          className="w-full h-full object-contain pointer-events-none filter contrast-105"
          loading="eager"
        />

        {/* Layered 2D Mask Slices */}
        {structures.map((s) => {
          if (!visibleStructures[s.id]) return null;
          return (
            <div
              key={s.id}
              className="absolute inset-0 pointer-events-none transition-opacity duration-150"
              style={{ opacity }}
            >
              <div
                className="w-full h-full"
                style={{
                  backgroundColor: s.color,
                  maskImage: `url(/api/ct/mask-slice?structure=${s.id}&plane=${plane}&index=${index})`,
                  WebkitMaskImage: `url(/api/ct/mask-slice?structure=${s.id}&plane=${plane}&index=${index})`,
                  maskMode: 'alpha',
                  maskSize: 'contain',
                  WebkitMaskSize: 'contain',
                  maskRepeat: 'no-repeat',
                  WebkitMaskRepeat: 'no-repeat',
                  maskPosition: 'center',
                  WebkitMaskPosition: 'center',
                }}
              />
            </div>
          );
        })}

        {/* Orthogonal Synchronized Crosshairs */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none border-l border-cyan-400/70 z-10"
          style={{ left: `${crossX * 100}%` }}
        />
        <div
          className="absolute left-0 right-0 pointer-events-none border-t border-cyan-400/70 z-10"
          style={{ top: `${crossY * 100}%` }}
        />
      </div>

      {/* Slice Slider in Footer */}
      <div className="h-6 bg-slate-900/90 px-3 flex items-center gap-2 border-t border-slate-800 z-20">
        <input
          type="range"
          min="0"
          max={maxIndex}
          value={index}
          onChange={(e) => onScrollSlice(parseInt(e.target.value) - index)}
          className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
        />
      </div>
    </div>
  );
};
