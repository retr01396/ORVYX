import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, RotateCcw, Layers, Compass } from 'lucide-react';
import type { OrganStructure, CrosshairPosition } from '../../types/ct';

interface Volume3DViewerProps {
  structures: OrganStructure[];
  visibleStructures: Record<string, boolean>;
  opacity: number;
  crosshair: CrosshairPosition;
  focusedStructure: string | null;
  onSelectStructure?: (id: string) => void;
  onResetFocus?: () => void;
}

// Bounding box dimensions in mm (512*0.7617 x 512*0.7617 x 139*2.5)
const CT_SIZE_X = 390.0;
const CT_SIZE_Y = 390.0;
const CT_SIZE_Z = 347.5;

export const Volume3DViewer: React.FC<Volume3DViewerProps> = ({
  structures,
  visibleStructures,
  opacity,
  crosshair,
  focusedStructure,
  onResetFocus,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // References to Three.js objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const organGroupRef = useRef<THREE.Group | null>(null);
  const meshesMapRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const planesGroupRef = useRef<THREE.Group | null>(null);

  // Animation frame id
  const animFrameIdRef = useRef<number | null>(null);
  const [loadingMeshes, setLoadingMeshes] = useState<boolean>(true);
  const [loadedCount, setLoadedCount] = useState<number>(0);
  const [showPlanes, setShowPlanes] = useState<boolean>(true);

  // 1. Initialize Three.js scene
  useEffect(() => {
    if (!canvasContainerRef.current) return;

    const container = canvasContainerRef.current;
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 400;

    // Dynamically create canvas element for pristine WebGL context (prevents StrictMode context loss)
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617); // slate-950
    sceneRef.current = scene;

    // Camera: FOV 40, looking from Anterior-Superior vantage point
    const camera = new THREE.PerspectiveCamera(40, width / height, 1, 4000);
    camera.position.set(0, 30, 640);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 150;
    controls.maxDistance = 1800;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.3);
    dirLight1.position.set(300, 400, 500);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.9);
    dirLight2.position.set(-300, -200, -400);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight(0x38bdf8, 0.5);
    dirLight3.position.set(0, 500, 0);
    scene.add(dirLight3);

    // Master Group: Rotate by -90 deg on X so Superior (+Z in LPS) points UP (+Y in Three.js)
    const masterGroup = new THREE.Group();
    masterGroup.rotation.x = -Math.PI / 2;
    scene.add(masterGroup);

    // Anatomical Bounding Box (390 x 390 x 347.5 mm)
    const boxGeo = new THREE.BoxGeometry(CT_SIZE_X, CT_SIZE_Y, CT_SIZE_Z);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    const boxLine = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.7 })
    );
    masterGroup.add(boxLine);

    // Organ group inside master
    const organGroup = new THREE.Group();
    masterGroup.add(organGroup);
    organGroupRef.current = organGroup;

    // Crosshair cutting planes group
    const planesGroup = new THREE.Group();
    masterGroup.add(planesGroup);
    planesGroupRef.current = planesGroup;

    // Animation Loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Observer on canvas container
    const resizeObserver = new ResizeObserver(() => {
      if (!canvasContainerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = canvasContainerRef.current.clientWidth;
      const h = canvasContainerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h, false);
    });
    resizeObserver.observe(container);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      controls.dispose();
      renderer.dispose();
      canvas.remove();
      scene.clear();
      const map = meshesMapRef.current;
      map.clear();
    };
  }, []);

  // 2. Load 3D Organ Meshes from Backend JSON geometry assets
  useEffect(() => {
    if (!organGroupRef.current || structures.length === 0) return;

    let isMounted = true;
    setLoadingMeshes(true);
    let loaded = 0;

    const loadMeshes = async () => {
      for (const s of structures) {
        const existingMesh = meshesMapRef.current.get(s.id);
        if (existingMesh) {
          if (organGroupRef.current && !organGroupRef.current.children.includes(existingMesh)) {
            organGroupRef.current.add(existingMesh);
          }
          loaded++;
          if (isMounted) setLoadedCount(loaded);
          continue;
        }

        try {
          const res = await fetch(s.mesh_url);
          if (!res.ok) continue;
          const data = await res.json();
          if (!isMounted) return;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(data.vertices, 3)
          );
          if (data.normals && data.normals.length > 0) {
            geometry.setAttribute(
              'normal',
              new THREE.Float32BufferAttribute(data.normals, 3)
            );
          } else {
            geometry.computeVertexNormals();
          }
          if (data.indices && data.indices.length > 0) {
            geometry.setIndex(data.indices);
          }

          const isSkeleton = s.group === 'Skeletal';
          const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(s.color),
            roughness: isSkeleton ? 0.45 : 0.35,
            metalness: isSkeleton ? 0.05 : 0.15,
            transparent: opacity < 0.99,
            opacity: opacity,
            side: THREE.DoubleSide,
            depthWrite: opacity > 0.6,
          });

          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = s.id;
          mesh.userData = { id: s.id, label: s.label };
          mesh.visible = visibleStructures[s.id] !== false;

          organGroupRef.current?.add(mesh);
          meshesMapRef.current.set(s.id, mesh);

          loaded++;
          if (isMounted) setLoadedCount(loaded);
        } catch (err) {
          console.error(`Failed loading mesh for ${s.id}:`, err);
        }
      }
      if (isMounted) setLoadingMeshes(false);
    };

    loadMeshes();

    return () => {
      isMounted = false;
    };
  }, [structures]);

  // 3. Synchronize visibility and opacity
  useEffect(() => {
    meshesMapRef.current.forEach((mesh, id) => {
      mesh.visible = visibleStructures[id] !== false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat) {
        mat.opacity = opacity;
        mat.depthWrite = opacity > 0.85;
        mat.needsUpdate = true;
      }
    });
  }, [visibleStructures, opacity]);

  // 4. Synchronize 3D crosshair cut planes
  useEffect(() => {
    if (!planesGroupRef.current) return;
    const group = planesGroupRef.current;
    group.clear();

    if (!showPlanes) return;

    // In centered coordinates:
    // X center = (crosshair.x - 256) * 0.7617
    // Y center = (crosshair.y - 256) * 0.7617
    // Z center = (crosshair.z - 69.5) * 2.5
    const cx = (crosshair.x - 256) * 0.761718988;
    const cy = (crosshair.y - 256) * 0.761718988;
    const cz = (crosshair.z - 69.5) * 2.5;

    // 1. Axial plane (Z cut, X-Y span)
    const axialGeo = new THREE.PlaneGeometry(CT_SIZE_X, CT_SIZE_Y);
    const axialMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4, // cyan
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const axialMesh = new THREE.Mesh(axialGeo, axialMat);
    axialMesh.position.set(0, 0, cz);
    group.add(axialMesh);

    // Axial edge border
    const axialEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(axialGeo),
      new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.7 })
    );
    axialEdge.position.set(0, 0, cz);
    group.add(axialEdge);

    // 2. Coronal plane (Y cut, X-Z span)
    const coronalGeo = new THREE.PlaneGeometry(CT_SIZE_X, CT_SIZE_Z);
    const coronalMat = new THREE.MeshBasicMaterial({
      color: 0x10b981, // emerald
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const coronalMesh = new THREE.Mesh(coronalGeo, coronalMat);
    coronalMesh.rotation.x = Math.PI / 2;
    coronalMesh.position.set(0, cy, 0);
    group.add(coronalMesh);

    const coronalEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(coronalGeo),
      new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.7 })
    );
    coronalEdge.rotation.x = Math.PI / 2;
    coronalEdge.position.set(0, cy, 0);
    group.add(coronalEdge);

    // 3. Sagittal plane (X cut, Y-Z span)
    const sagittalGeo = new THREE.PlaneGeometry(CT_SIZE_Y, CT_SIZE_Z);
    const sagittalMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, // amber
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sagittalMesh = new THREE.Mesh(sagittalGeo, sagittalMat);
    sagittalMesh.rotation.y = Math.PI / 2;
    sagittalMesh.position.set(cx, 0, 0);
    group.add(sagittalMesh);

    const sagittalEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(sagittalGeo),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.7 })
    );
    sagittalEdge.rotation.y = Math.PI / 2;
    sagittalEdge.position.set(cx, 0, 0);
    group.add(sagittalEdge);
  }, [crosshair, showPlanes]);

  // 5. Camera focus animation when structure is selected
  useEffect(() => {
    if (!focusedStructure || !controlsRef.current || !cameraRef.current) return;
    const s = structures.find((item) => item.id === focusedStructure);
    if (!s) return;

    // Centered coordinates: [cx, cy, cz]
    // In rotated master group (rotation.x = -Math.PI / 2):
    // world_x = cx
    // world_y = cz
    // world_z = -cy
    const [cx, cy, cz] = s.centered_centroid;
    const targetX = cx;
    const targetY = cz;
    const targetZ = -cy;

    const controls = controlsRef.current;
    const camera = cameraRef.current;

    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(targetX, targetY, targetZ);

    const startCam = camera.position.clone();
    // Offset camera slightly anterior and superior relative to target
    const endCam = new THREE.Vector3(targetX, targetY + 30, targetZ + 320);

    let progress = 0;
    const duration = 40; // ~600ms at 60fps

    const tween = () => {
      progress++;
      const t = Math.min(1, progress / duration);
      // Smooth ease-in-out curve
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      controls.target.lerpVectors(startTarget, endTarget, ease);
      camera.position.lerpVectors(startCam, endCam, ease);
      controls.update();

      if (progress < duration) {
        requestAnimationFrame(tween);
      }
    };
    tween();
  }, [focusedStructure, structures]);

  // Reset Camera View (AP view)
  const handleResetCamera = () => {
    if (!controlsRef.current || !cameraRef.current) return;
    controlsRef.current.target.set(0, 0, 0);
    cameraRef.current.position.set(0, 50, 680);
    controlsRef.current.update();
    if (onResetFocus) onResetFocus();
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-slate-950 rounded-lg border border-slate-800 overflow-hidden flex flex-col group shadow-md"
    >
      {/* 3D Header HUD */}
      <div className="absolute top-2 left-2 z-20 pointer-events-none flex flex-col">
        <div className="flex items-center gap-1.5">
          <Box className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs font-bold text-slate-200 tracking-wide">
            3D TotalSegmentator Volume
          </span>
          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-slate-800/90 text-cyan-400 border border-slate-700/60">
            WebGL 60fps
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          {loadingMeshes
            ? `Loading organ geometry (${loadedCount}/${structures.length})...`
            : `${loadedCount} anatomical structures rendered`}
        </span>
      </div>

      {/* Top-Right HUD Controls */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
        <button
          onClick={() => setShowPlanes(!showPlanes)}
          title="Toggle 3D slice indicator planes"
          className={`px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition-colors ${
            showPlanes
              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40'
              : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3 h-3" />
          <span>Planes</span>
        </button>

        <button
          onClick={handleResetCamera}
          title="Reset Camera to AP View"
          className="px-2 py-1 rounded text-[11px] font-mono bg-slate-900/80 text-slate-400 border border-slate-700 hover:text-cyan-400 hover:border-cyan-500/50 flex items-center gap-1 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Anatomical Orientation Tags */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase">
        Superior (S)
      </div>
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase">
        Inferior (I)
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 left-2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase [writing-mode:vertical-lr] rotate-180">
        Right (R)
      </div>
      <div className="absolute top-1/2 -translate-y-1/2 right-2 text-[9px] font-mono text-slate-500 font-bold z-20 pointer-events-none uppercase [writing-mode:vertical-lr]">
        Left (L)
      </div>

      {/* WebGL Canvas Container */}
      <div ref={canvasContainerRef} className="flex-1 w-full min-h-0 relative cursor-grab active:cursor-grabbing overflow-hidden" />

      {/* Footer Navigation Hints */}
      <div className="h-6 bg-slate-900/90 px-3 flex items-center justify-between text-[10px] text-slate-400 font-mono border-t border-slate-800 z-20">
        <div className="flex items-center gap-2">
          <span>Rotate: Left Drag</span>
          <span>•</span>
          <span>Pan: Right Drag</span>
          <span>•</span>
          <span>Zoom: Scroll</span>
        </div>
        {focusedStructure && (
          <div className="text-cyan-300 flex items-center gap-1 font-semibold">
            <Compass className="w-3 h-3 animate-spin text-cyan-400" />
            <span>Target: {structures.find((s) => s.id === focusedStructure)?.label}</span>
          </div>
        )}
      </div>
    </div>
  );
};
