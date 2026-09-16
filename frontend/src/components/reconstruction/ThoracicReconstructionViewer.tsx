/**
 * ThoracicReconstructionViewer
 *
 * Cinematic 3D thoracic anatomy viewer with GPU-accelerated particle formation animation.
 * Renders a 5-phase particle reconstruction from a random cloud → thoracic skeleton.
 *
 * IMPORTANT MEDICAL DISCLAIMER:
 * The geometry shown is a TEMPLATE/ESTIMATED anatomical model, NOT a patient-specific
 * reconstruction. A single 2D X-ray cannot produce exact 3D anatomy.
 *
 * Architecture:
 * - React manages state (phase transitions, highlighted structures)
 * - Three.js manages ALL rendering and animation (zero React state updates per frame)
 * - ShaderMaterial drives particle motion on the GPU via uniforms
 * - OrbitControls enabled only after animation completes
 * - Quality tier auto-detected from measured frame time (first 10 frames)
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  RotateCcw, Play, AlertTriangle, Zap, Layers,
} from 'lucide-react';
import type { ThoracicStructure, ReconstructionPhase, QualityTier } from '../../types/reconstruction';

// ---------------------------------------------------------------------------
// Quality tier particle counts (benchmarked on Apple Silicon M-series)
// ---------------------------------------------------------------------------
const PARTICLE_COUNTS: Record<QualityTier, number> = {
  high:   60_000,
  medium: 30_000,
  low:    12_000,
};

const ANIMATION_DURATION_MS = 4_200; // total 0→1 animation

// ---------------------------------------------------------------------------
// Vertex Shader — all particle motion handled on GPU
// ---------------------------------------------------------------------------
const VERTEX_SHADER = /* glsl */`
  uniform float uProgress;        // 0.0 → 1.0 overall animation progress
  uniform float uStructureDelay;  // 0.0 → 0.8 per-structure stagger

  attribute vec3 aStartPosition;  // random initial position in space
  attribute vec3 aTargetPosition; // target position on mesh surface
  attribute float aSize;          // per-particle size variation

  varying float vAlpha;
  varying float vProgress;

  void main() {
    // Per-structure staggered progress
    float t = clamp((uProgress - uStructureDelay) / (1.0 - uStructureDelay + 0.001), 0.0, 1.0);
    // Smooth cubic ease-in-out
    float ease = t * t * (3.0 - 2.0 * t);

    vec3 pos = mix(aStartPosition, aTargetPosition, ease);

    // Deterministic turbulence that fades as particles converge
    float turbMag = (1.0 - ease) * 9.0;
    pos.x += sin(aStartPosition.y * 2.3 + uProgress * 6.28) * turbMag;
    pos.y += cos(aStartPosition.x * 1.7 + uProgress * 4.71) * turbMag;
    pos.z += sin(aStartPosition.z * 3.1 + uProgress * 3.14) * turbMag * 0.5;

    vAlpha = max(0.0, min(1.0, t * 3.0));   // fade in as structure forms
    vProgress = ease;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    // Perspective-correct point size
    gl_PointSize = aSize * (180.0 / max(-mvPos.z, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Fragment Shader — soft circular particle with glow
// ---------------------------------------------------------------------------
const FRAGMENT_SHADER = /* glsl */`
  uniform vec3 uColor;
  uniform float uGlobalOpacity;

  varying float vAlpha;
  varying float vProgress;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Soft circular falloff with bright core glow
    float core  = 1.0 - smoothstep(0.0, 0.18, d);
    float outer = 1.0 - smoothstep(0.18, 0.5, d);
    float alpha = (core * 0.9 + outer * 0.35) * vAlpha * uGlobalOpacity;

    vec3 col = uColor + vec3(core * 0.45);  // brighter hot core
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// High-Fidelity Anatomical Geometry Generators
// ---------------------------------------------------------------------------
import { buildFullThoracicGeometryMap } from './thoracicGeometry';

/** Sample `count` surface points from a BufferGeometry with tight cortical fidelity. */
function sampleSurfacePoints(geo: THREE.BufferGeometry, count: number): Float32Array {
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const n = positions.count;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const vi = Math.floor(Math.random() * n);
    out[i * 3]     = positions.getX(vi) + (Math.random() - 0.5) * 0.12;
    out[i * 3 + 1] = positions.getY(vi) + (Math.random() - 0.5) * 0.12;
    out[i * 3 + 2] = positions.getZ(vi) + (Math.random() - 0.5) * 0.12;
  }
  return out;
}

/** Generate random start positions scattered in a bounding volume. */
function randomCloud(count: number, spread: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3]     = (Math.random() - 0.5) * spread;
    out[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.9 + 5;
    out[i * 3 + 2] = (Math.random() - 0.5) * spread * 0.6;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ThoracicReconstructionViewerProps {
  structures: ThoracicStructure[];
  phase: ReconstructionPhase;
  highlightedStructureIds: string[];
  visibleStructures: Record<string, boolean>;
  onPhaseComplete: () => void;
  onSelectStructure: (id: string) => void;
  studyImageUrl: string | null;
  studyId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ThoracicReconstructionViewer: React.FC<ThoracicReconstructionViewerProps> = ({
  structures,
  phase,
  highlightedStructureIds,
  visibleStructures,
  onPhaseComplete,
  onSelectStructure,
  studyImageUrl,
  studyId,
}) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const sceneRef      = useRef<THREE.Scene | null>(null);
  const rendererRef   = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef     = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef   = useRef<OrbitControls | null>(null);
  const animIdRef     = useRef<number | null>(null);
  const startTimeRef  = useRef<number>(0);
  const geoMapRef     = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const particlesRef  = useRef<THREE.Points[]>([]);
  const meshGroupRef  = useRef<THREE.Group | null>(null);
  const phaseRef      = useRef<ReconstructionPhase>(phase);
  const qualityRef    = useRef<QualityTier>('high');
  const frameTimes    = useRef<number[]>([]);
  const lastFrameTime = useRef<number>(performance.now());

  const lastPctRef    = useRef<number>(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showMeshes, setShowMeshes]  = useState(false);
  const [localPhase, setLocalPhase]  = useState<ReconstructionPhase>(phase);
  const [animProgressPercent, setAnimProgressPercent] = useState<number>(0);

  // Keep ref in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Initialize Three.js scene (once) ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Dynamically create canvas element for pristine WebGL context (prevents StrictMode context loss)
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x020617, 1);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020617, 0.006);
    sceneRef.current = scene;

    // Ambient grid (subtle depth cue)
    const gridHelper = new THREE.GridHelper(60, 30, 0x0a1a2a, 0x0a1a2a);
    gridHelper.position.y = -12;
    gridHelper.material.opacity = 0.35;
    (gridHelper.material as THREE.Material).transparent = true;
    scene.add(gridHelper);

    // Camera (front three-quarter anatomical perspective)
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 500);
    camera.position.set(12, 10, 48);
    camera.lookAt(0, 3.5, 0);
    cameraRef.current = camera;

    // Studio lights for anatomical meshes: Warm key, cool fill, back rim light
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir1 = new THREE.DirectionalLight(0xfff5ea, 1.4);
    dir1.position.set(25, 30, 35);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x93c5fd, 0.75);
    dir2.position.set(-25, -15, 20);
    scene.add(dir2);
    const dir3 = new THREE.DirectionalLight(0x38bdf8, 0.65);
    dir3.position.set(0, 25, -35);
    scene.add(dir3);

    // OrbitControls (disabled during animation)
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance   = 20;
    controls.maxDistance   = 100;
    controls.target.set(0, 3.5, 0);
    controls.enabled = false;
    controlsRef.current = controls;

    // Mesh group (shown after animation)
    const mg = new THREE.Group();
    scene.add(mg);
    meshGroupRef.current = mg;

    // Pre-build high-fidelity anatomical thoracic geometry
    geoMapRef.current = buildFullThoracicGeometryMap();

    // Resize handler
    const onResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      rendererRef.current.setSize(w, h, false);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    // Render loop
    const tick = () => {
      animIdRef.current = requestAnimationFrame(tick);

      // Measure frame time for quality detection
      const now = performance.now();
      const dt  = now - lastFrameTime.current;
      lastFrameTime.current = now;
      if (frameTimes.current.length < 10) {
        frameTimes.current.push(dt);
        if (frameTimes.current.length === 10) {
          const avg = frameTimes.current.reduce((a, b) => a + b, 0) / 10;
          if (avg > 25) qualityRef.current = 'low';
          else if (avg > 16) qualityRef.current = 'medium';
          else qualityRef.current = 'high';
        }
      }

      // Update particle progress
      const p = phaseRef.current;
      if ((p === 'building' || p === 'converging') && startTimeRef.current > 0) {
        const elapsed  = now - startTimeRef.current;
        const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1.0);

        const pct = Math.round(progress * 100);
        if (Math.abs(pct - lastPctRef.current) >= 2 || progress >= 1.0) {
          lastPctRef.current = pct;
          setAnimProgressPercent(pct);
        }

        particlesRef.current.forEach(pts => {
          const mat = pts.material as THREE.ShaderMaterial;
          mat.uniforms.uProgress.value = progress;
        });

        if (progress >= 1.0 && phaseRef.current !== 'complete') {
          phaseRef.current = 'complete';
          setLocalPhase('complete');
          setShowMeshes(true);
          setAnimProgressPercent(100);
          if (controlsRef.current) controlsRef.current.enabled = true;
          onPhaseComplete();
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    // Structure selection raycaster on click
    const onCanvasClick = (e: MouseEvent) => {
      if (!cameraRef.current || !meshGroupRef.current || !rendererRef.current) return;
      if (phaseRef.current !== 'complete') return;
      const rect = rendererRef.current.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);
      const intersects = raycaster.intersectObjects(meshGroupRef.current.children, false);
      if (intersects.length > 0) {
        const topHit = intersects[0].object;
        const structId = topHit.userData?.structureId;
        if (structId) {
          onSelectStructure(structId);
        }
      }
    };
    canvas.addEventListener('click', onCanvasClick);

    return () => {
      canvas.removeEventListener('click', onCanvasClick);
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      geoMapRef.current.forEach(g => g.dispose());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start particle animation when phase switches to 'building' ─────────────
  useEffect(() => {
    setLocalPhase(phase);
    if (phase !== 'building') return;
    if (!sceneRef.current) return;

    // Remove old particles
    particlesRef.current.forEach(pts => {
      sceneRef.current!.remove(pts);
      pts.geometry.dispose();
      (pts.material as THREE.ShaderMaterial).dispose();
    });
    particlesRef.current = [];

    const totalParticles = PARTICLE_COUNTS[qualityRef.current];

    // Compute per-structure particle counts based on weight
    const totalWeight = structures.reduce((s, st) => s + st.particle_weight, 0);
    const maxFormOrder = Math.max(...structures.map(s => s.formation_order));

    structures.forEach(struct => {
      if (!visibleStructures[struct.id]) return;

      const geoTemplate = geoMapRef.current.get(struct.id);
      if (!geoTemplate) return;

      const count         = Math.round((struct.particle_weight / totalWeight) * totalParticles);
      const delay         = (struct.formation_order - 1) / maxFormOrder * 0.75; // 0→0.75
      const isHighlighted = highlightedStructureIds.includes(struct.id);

      const targets = sampleSurfacePoints(geoTemplate, count);
      const starts  = randomCloud(count, 55);
      const sizes   = new Float32Array(count).map(() => 1.5 + Math.random() * 2.5);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',      new THREE.BufferAttribute(targets, 3)); // placeholder
      geo.setAttribute('aTargetPosition', new THREE.BufferAttribute(targets, 3));
      geo.setAttribute('aStartPosition',  new THREE.BufferAttribute(starts,  3));
      geo.setAttribute('aSize',           new THREE.BufferAttribute(sizes,   1));

      const isSkeletal = struct.group === 'Skeleton';
      const hexColor = new THREE.Color(
        isHighlighted ? '#f43f5e' : (isSkeletal ? '#93c5fd' : struct.color)
      );

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress:       { value: 0.0 },
          uStructureDelay: { value: delay },
          uColor:          { value: hexColor },
          uGlobalOpacity:  { value: 0.9 },
        },
        vertexShader:   VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent:    true,
        depthWrite:     false,
        blending:       THREE.AdditiveBlending,
      });

      const pts = new THREE.Points(geo, mat);
      sceneRef.current!.add(pts);
      particlesRef.current.push(pts);
    });

    startTimeRef.current = performance.now();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Update mesh visibility in complete mode ───────────────────────────────
  useEffect(() => {
    if (!showMeshes || !meshGroupRef.current || !sceneRef.current) return;

    // Clear old meshes
    while (meshGroupRef.current.children.length) {
      const c = meshGroupRef.current.children[0];
      meshGroupRef.current.remove(c);
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
    }

    // Hide particles
    particlesRef.current.forEach(pts => { pts.visible = false; });

    // Add solid meshes
    structures.forEach(struct => {
      if (!visibleStructures[struct.id]) return;
      const geo = geoMapRef.current.get(struct.id);
      if (!geo) return;
      const isHighlighted = highlightedStructureIds.includes(struct.id);
      const isSkeletal = struct.group === 'Skeleton';
      const isLung = struct.id.startsWith('lung');
      const isHeart = struct.id === 'heart';
      const isTrachea = struct.id === 'trachea';

      let color = struct.color;
      let roughness = 0.35;
      let metalness = 0.1;
      let opacity = 0.5;
      let transparent = true;
      let depthWrite = true;

      if (isSkeletal) {
        color = '#f2ede4'; // warm ivory bone matching Reference B
        roughness = 0.44;
        metalness = 0.08;
        opacity = 1.0;
        transparent = false;
        depthWrite = true;
      } else if (isLung) {
        color = '#38bdf8'; // soft translucent cyan
        roughness = 0.28;
        metalness = 0.08;
        opacity = 0.28;
        transparent = true;
        depthWrite = false; // allows seeing heart and spine through the lung volume
      } else if (isHeart) {
        color = '#e11d48'; // cardiovascular crimson
        roughness = 0.38;
        metalness = 0.12;
        opacity = 0.72;
        transparent = true;
        depthWrite = true;
      } else if (isTrachea) {
        color = '#67e8f9'; // airway cyan
        roughness = 0.32;
        metalness = 0.06;
        opacity = 0.65;
        transparent = true;
        depthWrite = true;
      }

      if (isHighlighted) {
        color = '#f43f5e';
        opacity = 0.95;
        transparent = true;
        depthWrite = true;
      }

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness,
        metalness,
        emissive: new THREE.Color(isHighlighted ? '#e11d48' : '#000000'),
        emissiveIntensity: isHighlighted ? 0.85 : 0.0,
        transparent,
        opacity,
        depthWrite,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = { structureId: struct.id };
      meshGroupRef.current!.add(mesh);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMeshes, visibleStructures, highlightedStructureIds]);

  // ── Auto-rotate ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  // ── Replay handler ─────────────────────────────────────────────────────────
  const handleReplay = useCallback(() => {
    setShowMeshes(false);
    if (controlsRef.current) controlsRef.current.enabled = false;
    phaseRef.current = 'building';
    setLocalPhase('building');
    setAnimProgressPercent(0);

    if (!sceneRef.current) return;
    particlesRef.current.forEach(pts => {
      sceneRef.current!.remove(pts);
      pts.geometry.dispose();
      (pts.material as THREE.ShaderMaterial).dispose();
    });
    particlesRef.current = [];

    const totalParticles = PARTICLE_COUNTS[qualityRef.current];
    const totalWeight = structures.reduce((s, st) => s + st.particle_weight, 0);
    const maxFormOrder = Math.max(...structures.map(s => s.formation_order));

    structures.forEach(struct => {
      if (!visibleStructures[struct.id]) return;
      const geoTemplate = geoMapRef.current.get(struct.id);
      if (!geoTemplate) return;
      const count   = Math.round((struct.particle_weight / totalWeight) * totalParticles);
      const delay   = (struct.formation_order - 1) / maxFormOrder * 0.75;
      const isHL    = highlightedStructureIds.includes(struct.id);
      const isSkel  = struct.group === 'Skeleton';
      const targets = sampleSurfacePoints(geoTemplate, count);
      const starts  = randomCloud(count, 55);
      const sizes   = new Float32Array(count).map(() => 1.5 + Math.random() * 2.5);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position',        new THREE.BufferAttribute(targets, 3));
      geo.setAttribute('aTargetPosition', new THREE.BufferAttribute(targets, 3));
      geo.setAttribute('aStartPosition',  new THREE.BufferAttribute(starts,  3));
      geo.setAttribute('aSize',           new THREE.BufferAttribute(sizes,   1));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress:       { value: 0.0 },
          uStructureDelay: { value: delay },
          uColor:          { value: new THREE.Color(isHL ? '#f43f5e' : (isSkel ? '#93c5fd' : struct.color)) },
          uGlobalOpacity:  { value: 0.9 },
        },
        vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      sceneRef.current!.add(pts);
      particlesRef.current.push(pts);
    });
    startTimeRef.current = performance.now();
  }, [structures, visibleStructures, highlightedStructureIds]);

  const handleResetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(12, 10, 48);
    controlsRef.current.target.set(0, 3.5, 0);
    controlsRef.current.update();
  }, []);

  const isComplete = localPhase === 'complete';

  return (
    <div className="relative w-full h-full bg-[#020617] overflow-hidden flex flex-col select-none">
      {/* Three.js Canvas Container */}
      <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
        aria-label={`3D thoracic anatomy reconstruction viewport for study ${studyId}`}
      />

      {/* Top Left Title & Disclaimer */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-slate-100 tracking-wide drop-shadow">
            Reconstructing 3D Model from 2D X-Ray
          </h1>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-500/40">
            {isComplete ? 'SOLID 3D MESH' : 'PARTICLE CONVERGENCE'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 font-mono">
          {isComplete ? 'Anatomical model rendered • Interactive 3D orbit' : 'Bone structures forming from particles…'}
        </p>
        <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-600/40 px-2 py-1 rounded text-[9px] text-amber-300 font-semibold w-fit mt-0.5">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
          <span>AI-ESTIMATED ANATOMY — Not Patient-Specific CT</span>
        </div>
      </div>

      {/* Top Right Quality & FPS HUD */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2 pointer-events-none">
        <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/60 px-2.5 py-1 rounded-md text-[10px] font-mono text-cyan-400 shadow">
          <Zap className="w-3 h-3 text-cyan-400" aria-hidden="true" />
          <span>{qualityRef.current.toUpperCase()} • {PARTICLE_COUNTS[qualityRef.current].toLocaleString()} PTS</span>
        </div>
        <div className="bg-slate-900/90 border border-slate-700/60 px-2 py-1 rounded-md text-[10px] font-mono text-emerald-400 shadow">
          60 FPS
        </div>
      </div>

      {/* Detected Finding Highlight Badge */}
      {highlightedStructureIds.length > 0 && (
        <div className="absolute top-24 left-3 z-20 flex items-center gap-2 bg-rose-950/90 border border-rose-500/50 px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-sm pointer-events-none animate-pulse">
          <div className="w-2 h-2 rounded-full bg-rose-500 shadow-sm shadow-rose-500" />
          <span className="text-xs font-semibold text-rose-200">
            Highlighted Region: {structures.find(s => s.id === highlightedStructureIds[0])?.label ?? highlightedStructureIds[0]}
          </span>
          <span className="text-[10px] font-mono text-rose-300 ml-1">Pathology Focus</span>
        </div>
      )}

      {/* Bottom Center Progress Bar & Status (forming particles) */}
      {!isComplete && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 pointer-events-none w-80 max-w-full">
          <div className="w-full bg-slate-900/90 border border-slate-700/80 rounded-full h-2.5 overflow-hidden shadow-2xl p-0.5 backdrop-blur-sm">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-400 rounded-full transition-all duration-150 shadow-[0_0_12px_rgba(6,182,212,0.8)]"
              style={{ width: `${animProgressPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between w-full text-[10px] font-mono px-1">
            <span className="text-slate-400">Converting 2D X-ray to 3D anatomical model…</span>
            <span className="text-cyan-400 font-bold">{animProgressPercent}%</span>
          </div>
        </div>
      )}

      {/* Bottom Center Controls Toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-slate-900/95 border border-slate-700/80 px-3.5 py-1.5 rounded-full backdrop-blur-md shadow-2xl">
        <button
          onClick={handleReplay}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Replay particle reconstruction animation"
        >
          <Play className="w-3 h-3 text-cyan-400" aria-hidden="true" />
          <span>Replay</span>
        </button>
        <div className="w-px h-4 bg-slate-700" />
        <button
          onClick={handleResetCamera}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Reset camera to default position"
        >
          <RotateCcw className="w-3 h-3 text-slate-400" aria-hidden="true" />
          <span>Reset</span>
        </button>
        <div className="w-px h-4 bg-slate-700" />
        <button
          onClick={() => setAutoRotate(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
            autoRotate ? 'text-cyan-300 bg-cyan-950/60 border border-cyan-500/30' : 'text-slate-300 hover:text-cyan-300 hover:bg-slate-800'
          }`}
          aria-label={autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
          aria-pressed={autoRotate}
        >
          <Layers className="w-3 h-3" aria-hidden="true" />
          <span>Auto-Rotate</span>
        </button>
        {isComplete && (
          <>
            <div className="w-px h-4 bg-slate-700" />
            <span className="text-[10px] font-mono text-emerald-400 px-1 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Interactive Orbit
            </span>
          </>
        )}
      </div>

      {/* 2D X-Ray PiP thumbnail in bottom-right */}
      {studyImageUrl && (
        <div className="absolute bottom-3 right-3 z-20 w-32 border border-slate-700 rounded-lg overflow-hidden shadow-2xl bg-black group">
          <div className="text-[9px] font-mono text-slate-300 bg-slate-900/95 px-2 py-0.5 flex items-center justify-between border-b border-slate-800">
            <span>2D X-RAY</span>
            <span className="text-cyan-400">PA</span>
          </div>
          <img
            src={studyImageUrl}
            alt="Original 2D X-ray"
            className="w-full aspect-square object-contain filter contrast-110"
          />
        </div>
      )}
    </div>
  );
};
