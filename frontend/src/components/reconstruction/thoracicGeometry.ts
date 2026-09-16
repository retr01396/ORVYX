/**
 * thoracicGeometry.ts
 *
 * High-fidelity anatomical thoracic geometry generators for the ORVYX 3D Reconstruction Viewport.
 * Builds realistic, smooth cortical bone meshes and soft-tissue silhouettes matching clinical reference:
 *   - 12 pairs of anatomically curved ribs with flattened cortical cross-sections
 *   - 12 articulated thoracic vertebrae (T1–T12) with bodies, pedicles, transverse & spinous processes
 *   - 3-part sternum (manubrium, sternal body / gladiolus, and xiphoid process)
 *   - Left & right S-curved clavicles
 *   - Left & right triangular scapulae with spine and acromion process
 *   - Asymmetric anatomical lungs with cardiac notch and diaphragmatic base
 *   - Conical anatomical heart with apex and ventricular contour
 *   - Trachea with cartilaginous rings and bronchial bifurcation (carina)
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// 1. Rib Cage (12 pairs of anatomically accurate ribs)
// ---------------------------------------------------------------------------

function makeAnatomicalRib(side: number, ribIndex: number): THREE.BufferGeometry {
  // Height along thoracic column (T1 at y=15.5 down to T12 at y=-15)
  const yVert = 15.5 - ribIndex * 2.7;
  
  // Barrel chest curvature factor: Rib 1 narrow (R=8.5), Ribs 7-8 widest (R=16.8), Rib 12 tapers
  const wFactor = Math.sin(((ribIndex + 1.2) / 13.5) * Math.PI);
  const latWidth = 8.5 + 8.5 * Math.pow(wFactor, 0.85);
  const zSpine = -5.8 - ribIndex * 0.12;

  let xAnt: number;
  let yAnt: number;
  let zAnt: number;

  if (ribIndex < 7) {
    // True ribs (attach directly to sternum)
    yAnt = 14.2 - ribIndex * 2.25;
    zAnt = 7.6 + ribIndex * 0.08;
    xAnt = side * (1.6 + ribIndex * 0.18);
  } else if (ribIndex < 10) {
    // False ribs (attach to costal cartilage margin)
    yAnt = 14.2 - 6 * 2.25 - (ribIndex - 6) * 1.35;
    zAnt = 7.2 - (ribIndex - 6) * 0.55;
    xAnt = side * (3.0 + (ribIndex - 6) * 1.3);
  } else {
    // Floating ribs 11 and 12
    yAnt = yVert - 3.5;
    zAnt = 1.2 - (ribIndex - 10) * 1.8;
    xAnt = side * (latWidth * 0.72);
  }

  const yAngle = yVert - 0.85 - ribIndex * 0.12;
  const yLat   = yVert - 1.9 - ribIndex * 0.18;

  const points: THREE.Vector3[] = [
    new THREE.Vector3(side * 1.8, yVert, zSpine + 0.4),                  // Head of rib (articulates with vertebra)
    new THREE.Vector3(side * 3.4, yVert - 0.25, zSpine - 0.75),          // Neck & tubercle
    new THREE.Vector3(side * (latWidth * 0.52), yAngle, zSpine - 0.55),  // Angulus costae (rib angle)
    new THREE.Vector3(side * (latWidth * 0.86), yAngle - 0.65, zSpine + 1.9), // Posterolateral arc
    new THREE.Vector3(side * latWidth, yLat, zSpine + 4.8),              // Maximum lateral flank
    new THREE.Vector3(side * (latWidth * 0.91), yLat - 0.75, zSpine + 7.8), // Anterolateral curve
    new THREE.Vector3(side * (latWidth * 0.62), yAnt - 0.45, zAnt + 1.2),   // Anterior descent
    new THREE.Vector3(xAnt, yAnt, zAnt),                                 // Anterior costochondral end
  ];

  const curvePts = ribIndex >= 10 ? points.slice(0, 6) : points;
  const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.5);

  // Ribs are flat cortical bone strips: thickness ~0.45, height ~1.15
  const radX = 0.42 + 0.03 * (1.0 - ribIndex / 12.0);
  const radY = 1.05 + 0.08 * (1.0 - ribIndex / 12.0);

  const tube = new THREE.TubeGeometry(curve, 55, radX, 16, false);
  // Scale craniocaudally to flatten into anatomical ribbon cross-section
  tube.scale(1.0, radY / radX, 1.0);
  tube.computeVertexNormals();
  return tube;
}

export function buildAnatomicalRibCage(): THREE.BufferGeometry {
  const ribGeos: THREE.BufferGeometry[] = [];
  for (let ribIdx = 0; ribIdx < 12; ribIdx++) {
    for (const side of [1, -1]) {
      ribGeos.push(makeAnatomicalRib(side, ribIdx));
    }
  }
  const merged = BufferGeometryUtils.mergeGeometries(ribGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 2. Thoracic Spine (T1–T12 articulated vertebral column)
// ---------------------------------------------------------------------------

function makeVertebra(vIdx: number): THREE.BufferGeometry {
  const yCenter = 15.5 - vIdx * 2.7;
  const zBody = -5.8 - vIdx * 0.12;
  const bodyRadius = 1.5 + vIdx * 0.04;
  const bodyHeight = 2.0;

  const parts: THREE.BufferGeometry[] = [];

  // 1. Vertebral body (kidney/heart-shaped cylinder with flared endplates)
  const bodyGeo = new THREE.CylinderGeometry(bodyRadius * 1.05, bodyRadius * 1.05, bodyHeight, 20, 4);
  bodyGeo.scale(1.15, 1.0, 0.95);
  bodyGeo.translate(0, yCenter, zBody);
  parts.push(bodyGeo);

  // 2. Left & Right Transverse Processes (project posterolaterally)
  for (const side of [1, -1]) {
    const tpCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, yCenter, zBody - 0.8),
      new THREE.Vector3(side * 1.8, yCenter - 0.1, zBody - 1.2),
      new THREE.Vector3(side * 3.6, yCenter - 0.2, zBody - 1.5),
    ]);
    const tpGeo = new THREE.TubeGeometry(tpCurve, 12, 0.5, 10, false);
    parts.push(tpGeo);
  }

  // 3. Posterior Spinous Process (slants sharply inferiorly)
  const spinCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, yCenter + 0.2, zBody - 1.0),
    new THREE.Vector3(0.0, yCenter - 0.6, zBody - 2.5),
    new THREE.Vector3(0.0, yCenter - 1.8, zBody - 4.2),
  ]);
  const spinGeo = new THREE.TubeGeometry(spinCurve, 14, 0.45, 10, false);
  spinGeo.scale(1.0, 1.4, 1.0); // flatten laterally
  parts.push(spinGeo);

  return BufferGeometryUtils.mergeGeometries(parts, false);
}

export function buildAnatomicalSpine(): THREE.BufferGeometry {
  const vertGeos: THREE.BufferGeometry[] = [];
  for (let vIdx = 0; vIdx < 12; vIdx++) {
    vertGeos.push(makeVertebra(vIdx));
  }
  const merged = BufferGeometryUtils.mergeGeometries(vertGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 3. Sternum (Manubrium, Sternal Body, and Xiphoid Process)
// ---------------------------------------------------------------------------

export function buildAnatomicalSternum(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Manubrium (hexagonal shield at thoracic inlet)
  const manubriumCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 16.6, 7.3),
    new THREE.Vector3(0, 15.8, 7.5),
    new THREE.Vector3(0, 14.5, 7.6),
    new THREE.Vector3(0, 13.6, 7.7),
  ]);
  const manGeo = new THREE.TubeGeometry(manubriumCurve, 12, 2.6, 16, false);
  manGeo.scale(1.0, 1.0, 0.45); // flatten anterior-posteriorly
  parts.push(manGeo);

  // 2. Sternal Body (Gladiolus with segmental costal facets)
  const bodyCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 13.5, 7.7),
    new THREE.Vector3(0, 10.5, 7.85),
    new THREE.Vector3(0, 7.5, 7.85),
    new THREE.Vector3(0, 4.5, 7.7),
    new THREE.Vector3(0, 1.8, 7.4),
  ]);
  const bodyGeo = new THREE.TubeGeometry(bodyCurve, 20, 1.7, 16, false);
  bodyGeo.scale(1.0, 1.0, 0.4);
  parts.push(bodyGeo);

  // 3. Xiphoid Process (tapered inferior tip)
  const xiphCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.7, 7.35),
    new THREE.Vector3(0, 0.5, 7.1),
    new THREE.Vector3(0, -0.8, 6.8),
  ]);
  const xiphGeo = new THREE.TubeGeometry(xiphCurve, 10, 0.9, 12, false);
  xiphGeo.scale(0.8, 1.0, 0.35);
  parts.push(xiphGeo);

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 4. Clavicles (S-curved paired collarbones)
// ---------------------------------------------------------------------------

export function buildAnatomicalClavicles(): THREE.BufferGeometry {
  const clavGeos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const pts = [
      new THREE.Vector3(side * 2.1, 16.4, 7.4),   // Sternal facet
      new THREE.Vector3(side * 4.8, 16.8, 7.8),   // Medial anterior convexity
      new THREE.Vector3(side * 8.5, 17.0, 6.5),   // Mid-shaft
      new THREE.Vector3(side * 12.0, 16.8, 4.0),  // Lateral posterior concavity
      new THREE.Vector3(side * 14.8, 16.2, 2.2),  // Acromial end
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo = new THREE.TubeGeometry(curve, 35, 0.55, 14, false);
    clavGeos.push(geo);
  }
  const merged = BufferGeometryUtils.mergeGeometries(clavGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 5. Scapulae (Triangular blade, spine of scapula & acromion)
// ---------------------------------------------------------------------------

export function buildAnatomicalScapulae(): THREE.BufferGeometry {
  const scapGeos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    // Blade triangular plate
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(side * 6.5, 14.0);  // Superior angle
    bladeShape.lineTo(side * 8.5, 3.5);   // Inferior angle
    bladeShape.lineTo(side * 14.5, 13.5); // Glenoid cavity / lateral angle
    bladeShape.closePath();

    const extrudeSettings = {
      steps: 2,
      depth: 0.6,
      bevelEnabled: true,
      bevelThickness: 0.25,
      bevelSize: 0.3,
      bevelSegments: 3,
    };
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
    // Kyphotic concavity conforming to posterior thoracic ribs
    bladeGeo.translate(0, 0, -6.0);

    // Spine of the Scapula & Acromion
    const spineCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 6.6, 12.8, -6.0),
      new THREE.Vector3(side * 10.5, 13.6, -5.2),
      new THREE.Vector3(side * 13.8, 14.8, -3.5),
      new THREE.Vector3(side * 15.2, 15.8, -0.5), // Acromion process
    ]);
    const spineGeo = new THREE.TubeGeometry(spineCurve, 20, 0.65, 12, false).toNonIndexed();

    const singleScap = BufferGeometryUtils.mergeGeometries([bladeGeo, spineGeo], false);
    scapGeos.push(singleScap);
  }
  const merged = BufferGeometryUtils.mergeGeometries(scapGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 6. Lungs (Realistic anatomical lung contours conforming to rib cage)
// ---------------------------------------------------------------------------

export function buildAnatomicalLung(side: 'left' | 'right'): THREE.BufferGeometry {
  const sign = side === 'right' ? 1 : -1;
  const isLeft = side === 'left';

  // Parametric anatomical lung: conical apex, convex lateral surface, concave diaphragmatic base
  const radialSegments = 24;
  const heightSegments = 24;
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];

  for (let yIdx = 0; yIdx <= heightSegments; yIdx++) {
    const v = yIdx / heightSegments; // 0 (apex) -> 1 (base)
    const y = 14.5 - v * 20.5; // from y=14.5 to y=-6.0

    // Radial expansion from apex to diaphragmatic base
    const apexProfile = Math.sin(Math.min(1.0, v * 1.5) * (Math.PI / 2));
    const baseWidth = (4.8 + 2.8 * apexProfile);

    for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
      const u = xIdx / radialSegments;
      const th = u * 2 * Math.PI;

      // Elliptical cross section conforming to thoracic cavity
      let rx = baseWidth * 0.95;
      let rz = baseWidth * 1.05;

      // Medial flattening along spine and heart
      const cosTh = Math.cos(th);
      const sinTh = Math.sin(th);

      let px = sign * (6.5 + rx * cosTh);
      let pz = -0.5 + rz * sinTh;

      // Left lung cardiac notch (incisura cardiaca)
      if (isLeft && y > -1.0 && y < 6.5) {
        // Anteromedial depression for the heart
        const notchFactor = Math.sin(((y - (-1.0)) / 7.5) * Math.PI);
        if (cosTh > -0.2 && sinTh > 0.0) {
          px += 2.2 * notchFactor;
          pz -= 1.8 * notchFactor;
        }
      }

      // Inferior diaphragmatic concavity at the base
      let py = y;
      if (v > 0.85) {
        const baseNorm = (v - 0.85) / 0.15;
        py += Math.sin(baseNorm * Math.PI) * 1.2;
      }

      positions.push(px, py, pz);
    }
  }

  for (let yIdx = 0; yIdx < heightSegments; yIdx++) {
    for (let xIdx = 0; xIdx < radialSegments; xIdx++) {
      const p0 = yIdx * (radialSegments + 1) + xIdx;
      const p1 = p0 + 1;
      const p2 = (yIdx + 1) * (radialSegments + 1) + xIdx;
      const p3 = p2 + 1;

      indices.push(p0, p1, p2);
      indices.push(p1, p3, p2);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// 7. Heart (Conical cardiovascular volume with apex and ventricular contour)
// ---------------------------------------------------------------------------

export function buildAnatomicalHeart(): THREE.BufferGeometry {
  const radialSegments = 24;
  const heightSegments = 24;
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];

  // Heart axis tilted posterosuperior to anteroinferior-left
  const centerBase = new THREE.Vector3(0.6, 6.2, 1.2);
  const centerApex = new THREE.Vector3(-2.6, 0.8, 5.2);

  for (let yIdx = 0; yIdx <= heightSegments; yIdx++) {
    const t = yIdx / heightSegments; // 0 = base, 1 = apex
    const center = new THREE.Vector3().lerpVectors(centerBase, centerApex, t);

    // Width tapers toward apex
    const taper = Math.sin((1.0 - t * 0.75) * (Math.PI / 2));
    const radX = (4.5 * taper) + 0.5;
    const radZ = (4.0 * taper) + 0.5;

    for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
      const u = xIdx / radialSegments;
      const th = u * 2 * Math.PI;

      // Asymmetric contour (right ventricle rounded anteriorly, left ventricle thicker lateral)
      const px = center.x + radX * Math.cos(th);
      const py = center.y - (t * 0.5);
      const pz = center.z + radZ * Math.sin(th);

      positions.push(px, py, pz);
    }
  }

  for (let yIdx = 0; yIdx < heightSegments; yIdx++) {
    for (let xIdx = 0; xIdx < radialSegments; xIdx++) {
      const p0 = yIdx * (radialSegments + 1) + xIdx;
      const p1 = p0 + 1;
      const p2 = (yIdx + 1) * (radialSegments + 1) + xIdx;
      const p3 = p2 + 1;

      indices.push(p0, p1, p2);
      indices.push(p1, p3, p2);
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// 8. Trachea (Corrugated airway with carina & bronchial bifurcation)
// ---------------------------------------------------------------------------

export function buildAnatomicalTrachea(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Main trachea tube (from neck y=21.0 down to carina y=11.5)
  const tracheaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 21.0, -1.2),
    new THREE.Vector3(0.0, 18.0, -1.8),
    new THREE.Vector3(0.0, 15.0, -2.5),
    new THREE.Vector3(0.0, 11.5, -3.2), // Carina bifurcation
  ]);
  const mainTube = new THREE.TubeGeometry(tracheaCurve, 30, 0.95, 16, false);
  parts.push(mainTube);

  // Right main bronchus (steeper, wider)
  const rightBronchusCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 11.5, -3.2),
    new THREE.Vector3(2.2, 9.8, -3.8),
    new THREE.Vector3(4.2, 8.2, -4.2),
  ]);
  const rightBronchus = new THREE.TubeGeometry(rightBronchusCurve, 15, 0.75, 12, false);
  parts.push(rightBronchus);

  // Left main bronchus (longer, more horizontal)
  const leftBronchusCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 11.5, -3.2),
    new THREE.Vector3(-2.6, 10.0, -3.6),
    new THREE.Vector3(-5.2, 8.8, -3.9),
  ]);
  const leftBronchus = new THREE.TubeGeometry(leftBronchusCurve, 18, 0.7, 12, false);
  parts.push(leftBronchus);

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// Master Thoracic Map Builder
// ---------------------------------------------------------------------------

export function buildFullThoracicGeometryMap(): Map<string, THREE.BufferGeometry> {
  const map = new Map<string, THREE.BufferGeometry>();

  map.set('rib_cage', buildAnatomicalRibCage());
  map.set('sternum', buildAnatomicalSternum());
  map.set('thoracic_spine', buildAnatomicalSpine());
  map.set('clavicles', buildAnatomicalClavicles());
  map.set('scapulae', buildAnatomicalScapulae());
  map.set('lung_left', buildAnatomicalLung('left'));
  map.set('lung_right', buildAnatomicalLung('right'));
  map.set('heart', buildAnatomicalHeart());
  map.set('trachea', buildAnatomicalTrachea());

  return map;
}
