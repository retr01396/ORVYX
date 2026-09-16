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
// Procedural geometry generators — ALL labeled as TEMPLATE/ESTIMATED
// ---------------------------------------------------------------------------

/** Generate a single rib arc as a TubeGeometry. */
function makeRib(
  side: number,      // +1 right, -1 left
  ribIndex: number,  // 0=T1-rib, 11=T12-rib
) {
  const y = 15 - ribIndex * 2.7;        // superior→inferior spacing
  const startX = side * 1.8;            // near spine
  const midX   = side * (9.5 + ribIndex * 0.3); // widest lateral point
  const endX   = side * (4 + (ribIndex < 7 ? 0 : 2)); // anterior attachment

  // Arc through 3 control points
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(startX,        y,        -5),
    new THREE.Vector3(midX * 0.7,   y - 0.5,  -2),
    new THREE.Vector3(midX,         y - 1.5,   2),
    new THREE.Vector3(midX * 0.55,  y - 2.5,   6),
    new THREE.Vector3(endX,         y - 3,     7),
  ]);

  const geo = new THREE.TubeGeometry(curve, 16, 0.35, 6, false);
  return { curve, geo };
}

function buildThoracicGeometry(): Map<string, THREE.BufferGeometry> {
  const map = new Map<string, THREE.BufferGeometry>();

  // ── Rib cage (12 pairs) ───────────────────────────────────────────────────
  const ribMerge = new THREE.BufferGeometry();
  const ribPositions: number[] = [];
  const ribNormals:   number[] = [];

  for (let i = 0; i < 12; i++) {
    for (const side of [1, -1]) {
      const { geo } = makeRib(side, i);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const nor = geo.attributes.normal  as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        ribPositions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
        ribNormals.push(nor.getX(v), nor.getY(v), nor.getZ(v));
      }
      geo.dispose();
    }
  }
  ribMerge.setAttribute('position', new THREE.Float32BufferAttribute(ribPositions, 3));
  ribMerge.setAttribute('normal',   new THREE.Float32BufferAttribute(ribNormals,   3));
  map.set('rib_cage', ribMerge);

  // ── Sternum (center-anterior plate) ──────────────────────────────────────
  const sternumGeo = new THREE.BoxGeometry(2.2, 16, 1.4, 2, 8, 2);
  sternumGeo.translate(0, 1, 8);
  map.set('sternum', sternumGeo);

  // ── Thoracic spine (T1–T12) ───────────────────────────────────────────────
  const spineGroup: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const y = 15 - i * 2.7;
    const g = new THREE.CylinderGeometry(0.85 + i * 0.04, 0.9 + i * 0.04, 2.2, 8);
    g.translate(0, y - 1, -5.5);
    spineGroup.push(g);
  }
  const spineMerge = new THREE.BufferGeometry();
  const spinePos: number[] = [];
  spineGroup.forEach(g => {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) spinePos.push(p.getX(v), p.getY(v), p.getZ(v));
    g.dispose();
  });
  spineMerge.setAttribute('position', new THREE.Float32BufferAttribute(spinePos, 3));
  map.set('thoracic_spine', spineMerge);

  // ── Clavicles (S-curve tubes) ─────────────────────────────────────────────
  for (const side of [1, -1] as const) {
    const id = side === 1 ? 'clavicle_right' : 'clavicle_left';
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 2,    16,  6),
      new THREE.Vector3(side * 6,    17,  5),
      new THREE.Vector3(side * 9,    16,  4),
      new THREE.Vector3(side * 11.5, 15,  3),
    ]);
    const g = new THREE.TubeGeometry(curve, 12, 0.5, 6, false);
    map.set(id, g);
  }
  // Merge both clavicles under one key
  const clavMerge = new THREE.BufferGeometry();
  const clavPos: number[] = [];
  ['clavicle_right','clavicle_left'].forEach(id => {
    const g = map.get(id)!;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) clavPos.push(p.getX(v), p.getY(v), p.getZ(v));
    g.dispose();
    map.delete(id);
  });
  clavMerge.setAttribute('position', new THREE.Float32BufferAttribute(clavPos, 3));
  map.set('clavicles', clavMerge);

  // ── Scapulae (flat triangular slabs) ─────────────────────────────────────
  const scapMerge = new THREE.BufferGeometry();
  const scapPos: number[] = [];
  for (const side of [1, -1] as const) {
    const g = new THREE.BoxGeometry(6, 7, 0.6, 4, 5, 1);
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(side * 0.25));
    g.translate(side * 13, 10, -3);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) scapPos.push(p.getX(v), p.getY(v), p.getZ(v));
    g.dispose();
  }
  scapMerge.setAttribute('position', new THREE.Float32BufferAttribute(scapPos, 3));
  map.set('scapulae', scapMerge);

  // ── Lungs (simple ellipsoids — CT-derived data fetched separately) ────────
  for (const [id, sx, sy, sz, tx, ty, tz] of [
    ['lung_left',  -6, 11, 6, -7, 4, 0],
    ['lung_right',  6, 11, 6,  7, 4, 0],
  ] as [string, number, number, number, number, number, number][]) {
    const g = new THREE.SphereGeometry(1, 12, 8);
    g.applyMatrix4(new THREE.Matrix4().makeScale(sx, sy, sz));
    g.translate(tx, ty, tz);
    map.set(id, g);
  }

  // ── Heart (slightly flattened sphere) ─────────────────────────────────────
  const heartGeo = new THREE.SphereGeometry(1, 12, 8);
  heartGeo.applyMatrix4(new THREE.Matrix4().makeScale(5, 5.5, 4.5));
  heartGeo.translate(1, 3, 3);
  map.set('heart', heartGeo);

  // ── Trachea (cylinder) ────────────────────────────────────────────────────
  const trachea = new THREE.CylinderGeometry(0.8, 0.9, 12, 8);
  trachea.translate(0, 18, 0);
  map.set('trachea', trachea);

  return map;
}

/** Sample `count` surface points from a BufferGeometry. */
function sampleSurfacePoints(geo: THREE.BufferGeometry, count: number): Float32Array {
  const positions = geo.attributes.position as THREE.BufferAttribute;
  const n = positions.count;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const vi = Math.floor(Math.random() * n);
    out[i * 3]     = positions.getX(vi) + (Math.random() - 0.5) * 0.3;
    out[i * 3 + 1] = positions.getY(vi) + (Math.random() - 0.5) * 0.3;
    out[i * 3 + 2] = positions.getZ(vi) + (Math.random() - 0.5) * 0.3;
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
  const canvasRef     = useRef<HTMLCanvasElement>(null);
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

  const [autoRotate, setAutoRotate] = useState(false);
  const [showMeshes, setShowMeshes]  = useState(false);
  const [localPhase, setLocalPhase]  = useState<ReconstructionPhase>(phase);

  // Keep ref in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Initialize Three.js scene (once) ─────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const canvas    = canvasRef.current;
    const container = containerRef.current;
    const { width, height } = container.getBoundingClientRect();

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x030810, 1);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030810, 0.007);
    sceneRef.current = scene;

    // Ambient grid (subtle depth cue)
    const gridHelper = new THREE.GridHelper(60, 30, 0x0a1a2a, 0x0a1a2a);
    gridHelper.position.y = -12;
    gridHelper.material.opacity = 0.4;
    (gridHelper.material as THREE.Material).transparent = true;
    scene.add(gridHelper);

    // Camera
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500);
    camera.position.set(0, 5, 52);
    camera.lookAt(0, 5, 0);
    cameraRef.current = camera;

    // Lights (for final mesh mode)
    scene.add(new THREE.AmbientLight(0x0a1528, 0.8));
    const dir = new THREE.DirectionalLight(0x4488cc, 1.2);
    dir.position.set(20, 30, 20);
    scene.add(dir);
    const rim = new THREE.DirectionalLight(0x002244, 0.4);
    rim.position.set(-15, -10, -15);
    scene.add(rim);

    // OrbitControls (disabled during animation)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance   = 20;
    controls.maxDistance   = 100;
    controls.target.set(0, 5, 0);
    controls.enabled = false;
    controlsRef.current = controls;

    // Mesh group (shown after animation)
    const mg = new THREE.Group();
    scene.add(mg);
    meshGroupRef.current = mg;

    // Pre-build all procedural geometry
    geoMapRef.current = buildThoracicGeometry();

    // Resize handler
    const onResize = () => {
      if (!containerRef.current) return;
      const { width: w, height: h } = containerRef.current.getBoundingClientRect();
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

        particlesRef.current.forEach(pts => {
          const mat = pts.material as THREE.ShaderMaterial;
          mat.uniforms.uProgress.value = progress;
        });

        if (progress >= 1.0 && phaseRef.current !== 'complete') {
          phaseRef.current = 'complete';
          setLocalPhase('complete');
          setShowMeshes(true);
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
    renderer.domElement.addEventListener('click', onCanvasClick);

    return () => {
      renderer.domElement.removeEventListener('click', onCanvasClick);
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      ro.disconnect();
      renderer.dispose();
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

      const hexColor = new THREE.Color(isHighlighted ? '#06b6d4' : struct.color);

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uProgress:       { value: 0.0 },
          uStructureDelay: { value: delay },
          uColor:          { value: hexColor },
          uGlobalOpacity:  { value: 0.88 },
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
      const color = isHighlighted ? '#06b6d4' : struct.color;
      const mat = new THREE.MeshPhongMaterial({
        color:       new THREE.Color(color),
        emissive:    new THREE.Color(color).multiplyScalar(isHighlighted ? 0.3 : 0.05),
        transparent: true,
        opacity:     struct.group === 'Soft Tissue' ? 0.55 : 0.82,
        wireframe:   false,
        side:        THREE.FrontSide,
        shininess:   isHighlighted ? 80 : 30,
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
    // Manually re-trigger the effect by dispatching a synthetic event
    // (we call the building logic inline)
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
          uColor:          { value: new THREE.Color(isHL ? '#06b6d4' : struct.color) },
          uGlobalOpacity:  { value: 0.88 },
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
    cameraRef.current.position.set(0, 5, 52);
    controlsRef.current.target.set(0, 5, 0);
    controlsRef.current.update();
  }, []);

  const isComplete = localPhase === 'complete';

  return (
    <div className="relative w-full h-full bg-[#030810] overflow-hidden flex flex-col">
      {/* Three.js Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        aria-label={`3D thoracic anatomy reconstruction viewport for study ${studyId}`}
      />
      <div ref={containerRef} className="absolute inset-0 pointer-events-none" />

      {/* Medical Disclaimer Badge — always visible */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-amber-950/90 border border-amber-600/50 px-2.5 py-1.5 rounded-md backdrop-blur-sm pointer-events-none">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
        <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">
          AI-ESTIMATED ANATOMY — Not Patient-Specific CT
        </span>
      </div>

      {/* Quality Indicator */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/50 px-2 py-1 rounded-md pointer-events-none">
        <Zap className="w-3 h-3 text-cyan-400" aria-hidden="true" />
        <span className="text-[10px] font-mono text-cyan-300 uppercase">
          {qualityRef.current.toUpperCase()} — {PARTICLE_COUNTS[qualityRef.current].toLocaleString()} pts
        </span>
      </div>

      {/* Animation Phase Label */}
      {!isComplete && (
        <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center z-20 pointer-events-none">
          <p className="text-xs font-semibold text-cyan-300 animate-pulse">
            {localPhase === 'building' || localPhase === 'converging'
              ? 'Forming thoracic anatomy from particles…'
              : localPhase === 'analyzing'
              ? 'Running AI analysis…'
              : ''}
          </p>
        </div>
      )}

      {/* Structure Label on hover (complete mode) */}
      {isComplete && highlightedStructureIds.length > 0 && (
        <div className="absolute bottom-20 left-0 right-0 flex justify-center z-20 pointer-events-none">
          <div className="bg-cyan-950/90 border border-cyan-500/40 px-3 py-1.5 rounded-lg text-xs">
            <span className="text-cyan-400 font-mono font-bold">
              {structures.find(s => s.id === highlightedStructureIds[0])?.label ?? highlightedStructureIds[0]}
            </span>
            <span className="text-slate-400 ml-2 text-[10px]">3D localization: estimated</span>
          </div>
        </div>
      )}

      {/* Controls Toolbar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-slate-900/90 border border-slate-700/60 px-3 py-1.5 rounded-full backdrop-blur-md shadow-xl">
        <button
          onClick={handleReplay}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
          aria-label="Replay particle reconstruction animation"
        >
          <Play className="w-3 h-3" aria-hidden="true" />
          Replay
        </button>
        <div className="w-px h-4 bg-slate-700" />
        <button
          onClick={handleResetCamera}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-300 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
          aria-label="Reset camera to default position"
        >
          <RotateCcw className="w-3 h-3" aria-hidden="true" />
          Reset
        </button>
        <div className="w-px h-4 bg-slate-700" />
        <button
          onClick={() => setAutoRotate(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            autoRotate ? 'text-cyan-300 bg-cyan-950/60 border border-cyan-500/30' : 'text-slate-300 hover:text-cyan-300 hover:bg-slate-800'
          }`}
          aria-label={autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
          aria-pressed={autoRotate}
        >
          <Layers className="w-3 h-3" aria-hidden="true" />
          Auto-Rotate
        </button>
        {isComplete && (
          <>
            <div className="w-px h-4 bg-slate-700" />
            <span className="text-[10px] font-mono text-emerald-400 px-1">
              ● Interactive
            </span>
          </>
        )}
      </div>

      {/* 2D X-Ray PiP thumbnail */}
      {studyImageUrl && (
        <div className="absolute bottom-14 right-3 z-20 w-28 border border-slate-700/60 rounded-lg overflow-hidden shadow-xl bg-black">
          <div className="text-[9px] font-mono text-slate-400 bg-slate-900/80 px-1.5 py-0.5 text-center uppercase tracking-wider">
            2D X-Ray
          </div>
          <img
            src={studyImageUrl}
            alt="Original 2D X-ray"
            className="w-full object-contain filter contrast-110"
          />
        </div>
      )}
    </div>
  );
};
