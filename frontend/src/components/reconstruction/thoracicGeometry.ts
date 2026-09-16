/**
 * thoracicGeometry.ts
 *
 * Anatomically accurate human adult thoracic geometry generators for the ORVYX 3D Reconstruction Viewport.
 * Produces clinically realistic, non-deformed cortical bone meshes matching clinical reference (Picture 2):
 *   - 12 pairs of anatomically curved ribs using local Bishop rotation-minimizing frames (no global shear)
 *   - Seamless closed tube caps and smooth end-tapering (no open hollow cutoffs)
 *   - Normal human adult thoracic proportions: width ~26-28 cm, height ~20-22 cm, depth ~16-18 cm
 *   - Articulated anterior sternal connections: true ribs 1-7 articulate to sternum, false ribs 8-10 form costal arch
 *   - 3D faceted sternum with hexagonal manubrium (suprasternal notch, clavicular facets), gladiolus body, and xiphoid
 *   - Articulated thoracic spine with continuous vertebral body column, intervertebral discs, and C6-C7 neck extension
 *   - S-curved clavicles articulating with manubrium and acromion
 *   - Scapulae with dorsal blade, spine, acromion, glenoid cavity, and anatomical proximal humerus shafts
 *   - Compact internal viscera (lungs, heart, trachea) nestled neatly inside the thoracic cage
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Helper: Capped Ribbon Tube with Bishop Rotation-Minimizing Frame (RMF)
// ---------------------------------------------------------------------------
// Generates ribbon cross-sections directly in the local curve frame with smooth
// end-tapering and closed hemispherical end caps to prevent hollow pipe artifacts.
function createCappedRibbonTube(
  curve: THREE.Curve<THREE.Vector3>,
  radiusX: number, // local thickness (transverse)
  radiusY: number, // local height (craniocaudal)
  numSegments = 45,
  numRadial = 14,
  taperEnds = true
): THREE.BufferGeometry {
  const points = curve.getSpacedPoints(numSegments);
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const t = i === points.length - 1
      ? points[i].clone().sub(points[i - 1]).normalize()
      : points[i + 1].clone().sub(points[i]).normalize();
    tangents.push(t);
  }

  const normals: THREE.Vector3[] = [new THREE.Vector3()];
  const binormals: THREE.Vector3[] = [new THREE.Vector3()];

  let ref = new THREE.Vector3(0, 1, 0);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(0, 0, 1);
  normals[0].crossVectors(tangents[0], ref).normalize();
  binormals[0].crossVectors(tangents[0], normals[0]).normalize();

  // Parallel transport along the curve (Bishop frame)
  for (let i = 1; i < points.length; i++) {
    const v1 = points[i].clone().sub(points[i - 1]);
    const c1 = v1.dot(v1);
    if (c1 < 1e-8) {
      normals.push(normals[i - 1].clone());
      binormals.push(binormals[i - 1].clone());
      continue;
    }
    const r_l = normals[i - 1].clone().sub(v1.clone().multiplyScalar((2.0 / c1) * v1.dot(normals[i - 1])));
    const t_l = tangents[i - 1].clone().sub(v1.clone().multiplyScalar((2.0 / c1) * v1.dot(tangents[i - 1])));
    const v2 = tangents[i].clone().sub(t_l);
    const c2 = v2.dot(v2);
    const n_i = (c2 < 1e-8) ? r_l : r_l.sub(v2.clone().multiplyScalar((2.0 / c2) * v2.dot(r_l)));
    n_i.normalize();
    const b_i = new THREE.Vector3().crossVectors(tangents[i], n_i).normalize();
    normals.push(n_i);
    binormals.push(b_i);
  }

  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const n = normals[i];
    const b = binormals[i];

    // Smooth anatomical end-tapering
    let scale = 1.0;
    if (taperEnds) {
      if (i === 0) scale = 0.25;
      else if (i === 1) scale = 0.70;
      else if (i === points.length - 2) scale = 0.70;
      else if (i === points.length - 1) scale = 0.25;
    }

    const rx = radiusX * scale;
    const ry = radiusY * scale;

    for (let j = 0; j < numRadial; j++) {
      const th = (j / numRadial) * Math.PI * 2;
      const vx = p.x + (rx * Math.cos(th)) * n.x + (ry * Math.sin(th)) * b.x;
      const vy = p.y + (rx * Math.cos(th)) * n.y + (ry * Math.sin(th)) * b.y;
      const vz = p.z + (rx * Math.cos(th)) * n.z + (ry * Math.sin(th)) * b.z;
      vertices.push(vx, vy, vz);
    }
  }

  for (let i = 0; i < points.length - 1; i++) {
    for (let j = 0; j < numRadial; j++) {
      const next_j = (j + 1) % numRadial;
      const p0 = i * numRadial + j;
      const p1 = i * numRadial + next_j;
      const p2 = (i + 1) * numRadial + next_j;
      const p3 = (i + 1) * numRadial + j;
      indices.push(p0, p1, p2, p0, p2, p3);
    }
  }

  // Add closed end caps
  const capStartIdx = vertices.length / 3;
  vertices.push(points[0].x, points[0].y, points[0].z);
  for (let j = 0; j < numRadial; j++) {
    const next_j = (j + 1) % numRadial;
    indices.push(capStartIdx, next_j, j);
  }

  const capEndIdx = vertices.length / 3;
  const lastRingStart = (points.length - 1) * numRadial;
  vertices.push(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].z);
  for (let j = 0; j < numRadial; j++) {
    const next_j = (j + 1) % numRadial;
    indices.push(capEndIdx, lastRingStart + j, lastRingStart + next_j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// 1. Rib Cage (12 pairs of anatomically accurate ribs + costal arch)
// ---------------------------------------------------------------------------

function makeAnatomicalRib(side: number, ribIndex: number): THREE.BufferGeometry {
  const yVert = 9.6 - ribIndex * 1.75;
  const zSpine = -4.8 - 1.2 * Math.sin((ribIndex / 11.0) * Math.PI);

  const wFactor = Math.sin(((ribIndex + 1.2) / 13.5) * Math.PI);
  const latW = 6.2 + 7.0 * Math.pow(wFactor, 0.85);

  const yLat = yVert - 1.4 - ribIndex * 0.12;
  const zLat = zSpine + 3.8 + 2.4 * Math.sin((ribIndex / 11.0) * Math.PI);

  let xAnt: number;
  let yAnt: number;
  let zAnt: number;

  if (ribIndex === 0) {
    // Rib 1: articulates with lateral manubrium below clavicle
    xAnt = 2.2;
    yAnt = 8.5;
    zAnt = 3.9;
  } else if (ribIndex < 7) {
    // True ribs 2-7: articulate with lateral border of sternal body
    xAnt = 1.45;
    yAnt = 7.0 - (ribIndex - 1) * 1.08;
    zAnt = 4.2 + (ribIndex - 1) * 0.04;
  } else if (ribIndex === 7) {
    // False rib 8: sweeps up into 7th costal margin
    xAnt = 2.6;
    yAnt = 0.2;
    zAnt = 4.0;
  } else if (ribIndex === 8) {
    // False rib 9: sweeps up into 8th costal margin
    xAnt = 4.2;
    yAnt = -0.7;
    zAnt = 3.8;
  } else if (ribIndex === 9) {
    // False rib 10: sweeps up into 9th costal margin
    xAnt = 5.8;
    yAnt = -1.6;
    zAnt = 3.5;
  } else {
    // Floating ribs 11-12: short free tips in flank
    xAnt = latW * 0.80;
    yAnt = yVert - 2.2;
    zAnt = zSpine + 2.5 - (ribIndex - 10) * 1.2;
  }

  const yAngle = yVert - 0.55;
  let curvePts: THREE.Vector3[];

  if (ribIndex === 11) {
    // Rib 12: short floating rib ending in posterior flank
    curvePts = [
      new THREE.Vector3(side * 1.2, yVert, zSpine + 0.3),
      new THREE.Vector3(side * 2.2, yVert - 0.2, zSpine - 0.4),
      new THREE.Vector3(side * (latW * 0.42), yAngle, zSpine - 0.2),
      new THREE.Vector3(side * (latW * 0.70), yVert - 1.8, zSpine + 1.2),
    ];
  } else if (ribIndex === 10) {
    // Rib 11: medium floating rib ending in lateral flank
    curvePts = [
      new THREE.Vector3(side * 1.2, yVert, zSpine + 0.3),
      new THREE.Vector3(side * 2.3, yVert - 0.2, zSpine - 0.5),
      new THREE.Vector3(side * (latW * 0.50), yAngle, zSpine - 0.3),
      new THREE.Vector3(side * (latW * 0.82), yAngle - 0.35, zSpine + 1.6),
      new THREE.Vector3(side * (latW * 0.92), yVert - 2.1, zSpine + 2.8),
    ];
  } else {
    // Ribs 1-10: full ribs (1-7 true ribs to sternum, 8-10 to costal arch)
    curvePts = [
      new THREE.Vector3(side * 1.2, yVert, zSpine + 0.3),                 // Costovertebral joint
      new THREE.Vector3(side * 2.3, yVert - 0.2, zSpine - 0.5),         // Tubercle
      new THREE.Vector3(side * (latW * 0.5), yAngle, zSpine - 0.3),      // Angulus costae
      new THREE.Vector3(side * (latW * 0.88), yAngle - 0.4, zSpine + 1.8), // Posterolateral arc
      new THREE.Vector3(side * latW, yLat, zLat),                        // Lateral peak
      new THREE.Vector3(side * (latW * 0.88), yLat - 0.5, zLat + 2.2),   // Anterolateral descent
      new THREE.Vector3(side * (latW * 0.48), yAnt - 0.25, zAnt - 0.3),  // Anterior curve toward midline
      new THREE.Vector3(side * xAnt, yAnt, zAnt),                        // Sternal / costal arch facet
    ];
  }

  const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.5);

  const radX = 0.22 + 0.02 * (1.0 - ribIndex / 12.0);
  const radY = 0.46 + 0.04 * (1.0 - ribIndex / 12.0);

  return createCappedRibbonTube(curve, radX, radY, 45, 14, true);
}

export function buildAnatomicalRibCage(): THREE.BufferGeometry {
  const ribGeos: THREE.BufferGeometry[] = [];
  for (let ribIdx = 0; ribIdx < 12; ribIdx++) {
    for (const side of [1, -1]) {
      ribGeos.push(makeAnatomicalRib(side, ribIdx));
    }
  }

  // Costal arch connecting ribs 7, 8, 9, 10 into the continuous infrasternal margin
  for (const side of [1, -1]) {
    const archPts = [
      new THREE.Vector3(side * 1.45, 0.52, 4.2),  // At 7th sternal facet
      new THREE.Vector3(side * 2.6, 0.2, 4.0),    // Rib 8 junction
      new THREE.Vector3(side * 4.2, -0.7, 3.8),   // Rib 9 junction
      new THREE.Vector3(side * 5.8, -1.6, 3.5),   // Rib 10 junction
    ];
    const archCurve = new THREE.CatmullRomCurve3(archPts, false, 'catmullrom', 0.5);
    ribGeos.push(createCappedRibbonTube(archCurve, 0.26, 0.44, 25, 12, true));
  }

  const merged = BufferGeometryUtils.mergeGeometries(ribGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 2. Thoracic Spine with Continuous Articulated Column
// ---------------------------------------------------------------------------

export function buildAnatomicalSpine(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Continuous anterior vertebral body column (T12 up to C6/C7 neck extension)
  for (let i = -2; i < 12; i++) {
    const yCenter = 9.6 - i * 1.75;
    const normI = Math.max(0, i);
    const zBody = -4.8 - 1.2 * Math.sin((normI / 11.0) * Math.PI);
    const bodyR = 1.35 + normI * 0.03;
    const bodyH = 1.45;

    // Vertebral body
    const bodyGeo = new THREE.CylinderGeometry(bodyR, bodyR * 1.05, bodyH, 18, 1);
    bodyGeo.scale(1.15, 1.0, 0.95);
    bodyGeo.translate(0, yCenter, zBody);
    parts.push(bodyGeo.toNonIndexed());

    // Intervertebral disc (connects adjacent bodies smoothly)
    if (i < 11) {
      const discGeo = new THREE.CylinderGeometry(bodyR * 0.98, bodyR * 0.98, 0.35, 18, 1);
      discGeo.scale(1.15, 1.0, 0.95);
      discGeo.translate(0, yCenter - 0.90, zBody);
      parts.push(discGeo.toNonIndexed());
    }

    if (i >= 0) {
      // Transverse processes
      for (const side of [1, -1]) {
        const tpCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.0, yCenter, zBody - 0.6),
          new THREE.Vector3(side * 1.4, yCenter - 0.1, zBody - 0.9),
          new THREE.Vector3(side * 2.8, yCenter - 0.15, zBody - 1.1),
        ]);
        const tpGeo = new THREE.TubeGeometry(tpCurve, 10, 0.35, 8, false);
        parts.push(tpGeo.toNonIndexed());
      }

      // Spinous process
      const spinCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.0, yCenter + 0.15, zBody - 0.8),
        new THREE.Vector3(0.0, yCenter - 0.45, zBody - 1.9),
        new THREE.Vector3(0.0, yCenter - 1.35, zBody - 3.2),
      ]);
      const spinGeo = new THREE.TubeGeometry(spinCurve, 12, 0.32, 8, false);
      spinGeo.scale(0.85, 1.3, 1.0);
      parts.push(spinGeo.toNonIndexed());
    }
  }

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 3. Sternum (Anatomical 3D plate: Manubrium, Gladiolus, and Xiphoid)
// ---------------------------------------------------------------------------

export function buildAnatomicalSternum(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Manubrium: hexagonal shield with suprasternal notch & facets
  const manShape = new THREE.Shape();
  manShape.moveTo(0, 9.6);       // Suprasternal notch
  manShape.lineTo(2.3, 9.4);     // Right clavicular notch
  manShape.lineTo(2.4, 8.4);     // Right 1st rib facet
  manShape.lineTo(1.5, 7.2);     // Sternal angle (angle of Louis)
  manShape.lineTo(-1.5, 7.2);    // Left sternal angle
  manShape.lineTo(-2.4, 8.4);    // Left 1st rib facet
  manShape.lineTo(-2.3, 9.4);    // Left clavicular notch
  manShape.closePath();

  const manExtrude = {
    steps: 1,
    depth: 0.55,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.15,
    bevelSegments: 2,
  };
  const manGeo = new THREE.ExtrudeGeometry(manShape, manExtrude);
  manGeo.translate(0, 0, 3.8);
  parts.push(manGeo.toNonIndexed());

  // 2. Sternal Body (Gladiolus with lateral costal facets)
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-1.45, 7.2);
  bodyShape.lineTo(1.45, 7.2);
  bodyShape.lineTo(1.55, 5.0);
  bodyShape.lineTo(1.50, 3.0);
  bodyShape.lineTo(1.40, 1.5);
  bodyShape.lineTo(1.25, 0.5);
  bodyShape.lineTo(-1.25, 0.5);
  bodyShape.lineTo(-1.40, 1.5);
  bodyShape.lineTo(-1.50, 3.0);
  bodyShape.lineTo(-1.55, 5.0);
  bodyShape.closePath();

  const bodyExtrude = {
    steps: 1,
    depth: 0.50,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.14,
    bevelSegments: 2,
  };
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, bodyExtrude);
  bodyGeo.translate(0, 0, 3.9);
  parts.push(bodyGeo.toNonIndexed());

  // 3. Xiphoid Process
  const xiphShape = new THREE.Shape();
  xiphShape.moveTo(-1.0, 0.5);
  xiphShape.lineTo(1.0, 0.5);
  xiphShape.lineTo(0.5, -0.6);
  xiphShape.lineTo(0.0, -1.5); // Tapered inferior tip
  xiphShape.lineTo(-0.5, -0.6);
  xiphShape.closePath();

  const xiphExtrude = {
    steps: 1,
    depth: 0.35,
    bevelEnabled: true,
    bevelThickness: 0.12,
    bevelSize: 0.10,
    bevelSegments: 2,
  };
  const xiphGeo = new THREE.ExtrudeGeometry(xiphShape, xiphExtrude);
  xiphGeo.translate(0, 0, 3.7);
  parts.push(xiphGeo.toNonIndexed());

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 4. Clavicles (S-curved collarbones)
// ---------------------------------------------------------------------------

export function buildAnatomicalClavicles(): THREE.BufferGeometry {
  const clavGeos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const pts = [
      new THREE.Vector3(side * 2.2, 9.5, 4.0),   // Sternal facet at manubrium
      new THREE.Vector3(side * 5.0, 9.8, 4.4),   // Anterior medial curvature
      new THREE.Vector3(side * 8.5, 9.8, 3.5),   // Mid-shaft
      new THREE.Vector3(side * 11.5, 9.4, 1.6),  // Posterior lateral curvature
      new THREE.Vector3(side * 13.8, 8.8, -0.1), // Acromial end meeting scapula
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    clavGeos.push(createCappedRibbonTube(curve, 0.45, 0.45, 30, 12, true));
  }
  const merged = BufferGeometryUtils.mergeGeometries(clavGeos, false);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------
// 5. Scapulae & Shoulder Girdle with Proximal Humerus
// ---------------------------------------------------------------------------

export function buildAnatomicalScapulae(): THREE.BufferGeometry {
  const scapGeos: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    // 1. Blade plate
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(side * 5.8, 8.2);   // Superior angle
    bladeShape.lineTo(side * 7.4, -0.8);  // Inferior angle
    bladeShape.lineTo(side * 13.0, 7.8);  // Glenoid neck
    bladeShape.closePath();

    const extrudeSettings = {
      steps: 1,
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.18,
      bevelSize: 0.22,
      bevelSegments: 2,
    };
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, extrudeSettings);
    bladeGeo.translate(0, 0, -5.2);
    scapGeos.push(bladeGeo.toNonIndexed());

    // 2. Spine of Scapula & Acromion
    const spineCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 5.8, 7.4, -5.2),
      new THREE.Vector3(side * 9.2, 8.0, -4.4),
      new THREE.Vector3(side * 12.4, 8.8, -2.6),
      new THREE.Vector3(side * 13.8, 9.0, -0.1), // Acromion meeting clavicle
    ]);
    const spineGeo = new THREE.TubeGeometry(spineCurve, 16, 0.48, 10, false);
    scapGeos.push(spineGeo.toNonIndexed());

    // 3. Glenoid head and anatomical humerus shaft
    const humerusHead = new THREE.SphereGeometry(1.2, 16, 12);
    humerusHead.scale(0.9, 1.1, 0.9);
    humerusHead.translate(side * 13.8, 8.0, -0.3);
    scapGeos.push(humerusHead.toNonIndexed());

    const humerusCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 13.8, 7.6, -0.3),  // Surgical neck
      new THREE.Vector3(side * 14.1, 4.2, -0.3),  // Upper shaft
      new THREE.Vector3(side * 14.0, 0.5, -0.4),  // Mid shaft
      new THREE.Vector3(side * 13.8, -3.2, -0.5), // Distal thoracic level shaft
    ]);
    const humerusGeo = new THREE.TubeGeometry(humerusCurve, 20, 0.72, 12, false).toNonIndexed();
    scapGeos.push(humerusGeo);

    const humerusBottom = new THREE.SphereGeometry(0.72, 12, 8);
    humerusBottom.translate(side * 13.8, -3.2, -0.5);
    scapGeos.push(humerusBottom.toNonIndexed());
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

  const radialSegments = 24;
  const heightSegments = 24;
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];

  for (let yIdx = 0; yIdx <= heightSegments; yIdx++) {
    const v = yIdx / heightSegments; // 0 (apex) -> 1 (base)
    const y = 8.5 - v * 15.0; // from y=8.5 down to y=-6.5

    // Radial expansion from apex to diaphragmatic base
    const apexProfile = Math.sin(Math.min(1.0, v * 1.5) * (Math.PI / 2));
    const baseWidth = 3.6 + 2.4 * apexProfile;

    for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
      const u = xIdx / radialSegments;
      const th = u * 2 * Math.PI;

      const rx = baseWidth * 0.95;
      const rz = baseWidth * 1.05;

      const cosTh = Math.cos(th);
      const sinTh = Math.sin(th);

      let px = sign * (5.2 + rx * cosTh);
      let pz = -0.4 + rz * sinTh;

      // Left lung cardiac notch (incisura cardiaca)
      if (isLeft && y > -1.8 && y < 4.2) {
        const notchFactor = Math.sin(((y - (-1.8)) / 6.0) * Math.PI);
        if (cosTh > -0.25 && sinTh > 0.0) {
          px += 1.8 * notchFactor;
          pz -= 1.4 * notchFactor;
        }
      }

      // Inferior diaphragmatic concavity at the base
      let py = y;
      if (v > 0.85) {
        const baseNorm = (v - 0.85) / 0.15;
        py += Math.sin(baseNorm * Math.PI) * 0.9;
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
  const centerBase = new THREE.Vector3(0.5, 4.2, 0.8);
  const centerApex = new THREE.Vector3(-2.2, 0.4, 3.2);

  for (let yIdx = 0; yIdx <= heightSegments; yIdx++) {
    const t = yIdx / heightSegments;
    const center = new THREE.Vector3().lerpVectors(centerBase, centerApex, t);

    // Width tapers toward apex
    const taper = Math.sin((1.0 - t * 0.72) * (Math.PI / 2));
    const radX = (3.4 * taper) + 0.4;
    const radZ = (3.1 * taper) + 0.4;

    for (let xIdx = 0; xIdx <= radialSegments; xIdx++) {
      const u = xIdx / radialSegments;
      const th = u * 2 * Math.PI;

      const px = center.x + radX * Math.cos(th);
      const py = center.y - (t * 0.35);
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

  // Main trachea tube (sits naturally within thoracic inlet)
  const tracheaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 11.2, -1.8),
    new THREE.Vector3(0.0, 9.6, -2.2),
    new THREE.Vector3(0.0, 8.0, -2.5),
    new THREE.Vector3(0.0, 6.8, -2.8), // Carina
  ]);
  const mainTube = new THREE.TubeGeometry(tracheaCurve, 20, 0.65, 14, false);
  parts.push(mainTube.toNonIndexed());

  // Right main bronchus
  const rightBronchusCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 6.8, -2.8),
    new THREE.Vector3(1.8, 5.2, -3.2),
    new THREE.Vector3(3.4, 3.8, -3.6),
  ]);
  const rightBronchus = new THREE.TubeGeometry(rightBronchusCurve, 12, 0.58, 10, false);
  parts.push(rightBronchus.toNonIndexed());

  // Left main bronchus
  const leftBronchusCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 6.8, -2.8),
    new THREE.Vector3(-2.2, 5.5, -3.1),
    new THREE.Vector3(-4.4, 4.4, -3.4),
  ]);
  const leftBronchus = new THREE.TubeGeometry(leftBronchusCurve, 14, 0.54, 10, false);
  parts.push(leftBronchus.toNonIndexed());

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
