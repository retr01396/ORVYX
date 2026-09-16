import React, { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Sliders, Crosshair } from 'lucide-react';
import type { Segment, Centroid } from '../types/studystate';
import { SEGMENT_COLORS } from '../types/studystate';

interface ViewportProps {
  studyId: string;
  segments: Segment[];
  visibleSegments: Record<string, boolean>;
  onToggleSegment?: (name: string) => void;
  onToggleAllSegments: (visible: boolean) => void;
  focusedTarget: { name: string; centroid: Centroid } | null;
  onClearFocus: () => void;
  opacity: number;
  setOpacity: (val: number) => void;
  analyzing?: boolean;
}

export const Viewport: React.FC<ViewportProps> = ({
  studyId,
  segments,
  visibleSegments,
  onToggleAllSegments,
  focusedTarget,
  onClearFocus,
  opacity,
  setOpacity,
  analyzing = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Pre-load mask Image elements in state for canvas rendering
  const maskImagesRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    // Reset view on study change
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    onClearFocus();
  }, [studyId]);

  // When focusedTarget changes, smoothly pan/zoom to its centroid
  useEffect(() => {
    if (focusedTarget && containerRef.current) {
      const targetZoom = 1.8;
      const targetX = (256 - focusedTarget.centroid.x) * targetZoom;
      const targetY = (256 - focusedTarget.centroid.y) * targetZoom;
      
      setZoom(targetZoom);
      setPan({ x: targetX, y: targetY });
    }
  }, [focusedTarget]);

  // Preload base64 PNG mask images
  useEffect(() => {
    segments.forEach((seg) => {
      if (seg.mask_base64 && !maskImagesRef.current[seg.name]) {
        const img = new Image();
        img.src = `data:image/png;base64,${seg.mask_base64}`;
        maskImagesRef.current[seg.name] = img;
      }
    });
  }, [segments]);

  // Pan interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }

    // Compute image coordinates if hovering
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left - rect.width / 2 - pan.x) / zoom + 256;
      const relY = (e.clientY - rect.top - rect.height / 2 - pan.y) / zoom + 256;
      if (relX >= 0 && relX <= 512 && relY >= 0 && relY <= 512) {
        setCursorPos({ x: Math.round(relX), y: Math.round(relY) });
      } else {
        setCursorPos(null);
      }
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom((prev) => Math.min(Math.max(0.5, prev + delta), 4.0));
  };

  const handleReset = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    onClearFocus();
  };

  const allVisible = segments.length > 0 && segments.every((s) => visibleSegments[s.name]);

  return (
    <main className="flex-1 flex flex-col bg-slate-950 relative overflow-hidden select-none" role="region" aria-label="X-Ray Viewport">
      {/* Viewport Floating Controls Toolbar */}
      <div className="absolute top-4 left-4 z-30 flex items-center gap-2 bg-slate-900/90 border border-slate-800 p-1.5 rounded-lg shadow-xl backdrop-blur-md">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.25, 4.0))}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
          title="Zoom In"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
          title="Zoom Out"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" aria-hidden="true" />
        </button>
        <span className="text-[11px] font-mono font-semibold text-cyan-400 px-1.5">
          {Math.round(zoom * 100)}%
        </span>
        <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />
        <button
          onClick={handleReset}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors flex items-center gap-1 text-xs"
          title="Reset View"
          aria-label="Reset view to default zoom and position"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="text-[10px]">Reset</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

        {/* Visibility Toggle All */}
        <button
          onClick={() => onToggleAllSegments(!allVisible)}
          className={`p-1.5 rounded flex items-center gap-1 text-[11px] font-medium transition-colors ${
            allVisible
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
              : 'hover:bg-slate-800 text-slate-400'
          }`}
          title={allVisible ? 'Hide All Anatomical Masks' : 'Show All Anatomical Masks'}
          aria-label={allVisible ? 'Hide all anatomical masks' : 'Show all anatomical masks'}
          aria-pressed={allVisible}
        >
          {allVisible ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
          <span>{allVisible ? 'Anatomy On' : 'Anatomy Off'}</span>
        </button>

        {/* Opacity Slider */}
        <div className="flex items-center gap-1.5 px-2">
          <Sliders className="w-3 h-3 text-slate-400" aria-hidden="true" />
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            title={`Overlay Opacity: ${Math.round(opacity * 100)}%`}
            aria-label={`Overlay opacity: ${Math.round(opacity * 100)} percent`}
          />
          <span className="text-[10px] font-mono text-slate-400 w-6">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      </div>

      {/* Focus Indicator Pill if finding clicked */}
      {focusedTarget && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-slate-900/95 border border-cyan-500/40 px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-md animate-fadeIn">
          <Crosshair className="w-4 h-4 text-cyan-400 animate-spin" style={{ animationDuration: '4s' }} aria-hidden="true" />
          <div className="text-xs">
            <span className="text-slate-400 text-[10px] uppercase font-mono block">Focal Structure:</span>
            <span className="font-bold text-cyan-300">{focusedTarget.name}</span>
            <span className="text-[10px] font-mono text-slate-400 ml-1.5">
              ({focusedTarget.centroid.x}, {focusedTarget.centroid.y})
            </span>
          </div>
          <button
            onClick={onClearFocus}
            className="ml-2 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
            aria-label="Clear focal structure"
          >
            Clear
          </button>
        </div>
      )}

      {/* Canvas Viewport Area */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className={`flex-1 flex items-center justify-center relative cursor-grab active:cursor-grabbing overflow-hidden ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        {/* Render Stage */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
            width: '512px',
            height: '512px',
          }}
          className="relative shadow-2xl border border-slate-800/80 bg-black shrink-0"
        >
          {/* Base X-Ray Image */}
          <img
            src={`/api/xray/image/${studyId}`}
            alt="Chest radiograph for analysis"
            className="w-full h-full object-contain pointer-events-none filter contrast-105"
            draggable={false}
          />

          {/* Layered Segmentation Overlays */}
          {segments.map((seg) => {
            if (!visibleSegments[seg.name] || !seg.mask_base64) return null;
            const color = SEGMENT_COLORS[seg.name] || { hex: '#06b6d4' };
            const isFocused = focusedTarget?.name === seg.name;

            return (
              <div
                key={seg.name}
                className="absolute inset-0 pointer-events-none transition-opacity duration-200"
                style={{ opacity: isFocused ? 0.95 : opacity }}
              >
                {/* Colored Mask layer using CSS mask-image */}
                <div
                  className="w-full h-full"
                  style={{
                    backgroundColor: color.hex,
                    maskImage: `url(data:image/png;base64,${seg.mask_base64})`,
                    WebkitMaskImage: `url(data:image/png;base64,${seg.mask_base64})`,
                    maskSize: '100% 100%',
                    WebkitMaskSize: '100% 100%',
                    filter: isFocused ? 'brightness(1.4) drop-shadow(0 0 4px rgba(255,255,255,0.6))' : 'none',
                  }}
                />
              </div>
            );
          })}

          {/* Focal Reticle Marker if Focused */}
          {focusedTarget && (
            <div
              className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-1/2 z-20"
              style={{
                left: `${focusedTarget.centroid.x}px`,
                top: `${focusedTarget.centroid.y}px`,
              }}
            >
              <div className="relative flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-2 border-cyan-400 animate-ping opacity-75" />
                <div className="absolute w-8 h-8 rounded-full border border-cyan-300" />
                <div className="absolute w-2 h-2 rounded-full bg-cyan-400 shadow-md shadow-cyan-400" />
                <div className="absolute top-5 bg-slate-900/90 text-cyan-300 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyan-500/40 whitespace-nowrap shadow-lg">
                  {focusedTarget.name}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Analyzing Overlay — shown while MPS inference is running */}
        {analyzing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm z-40 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-xs font-semibold text-cyan-300">Running MPS Inference…</p>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">DenseNet-121 + PSPNet</p>
            </div>
          </div>
        )}
      </div>

      {/* Viewport Footer with Pixel Coordinates & Metadata */}
      <div className="h-7 bg-slate-900 border-t border-slate-800 px-4 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span>Active View: <strong className="text-slate-300">CXR 2D Projections</strong></span>
          <span className="text-slate-600">•</span>
          <span>
            Cursor:{' '}
            {cursorPos ? (
              <span className="text-cyan-400 font-bold">X:{cursorPos.x} Y:{cursorPos.y}</span>
            ) : (
              <span className="text-slate-500">Out of bounds</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>Segmentation: <strong className="text-slate-300">PSPNet 14-ROI</strong></span>
          <span className="text-slate-600">•</span>
          <span>Threshold: <strong className="text-cyan-400 font-bold">0.50 (Sigmoid)</strong></span>
        </div>
      </div>
    </main>
  );
};
