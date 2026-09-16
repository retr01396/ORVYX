"""
Generates high-fidelity anatomical thoracic skeleton mesh for ORVYX.
Creates smooth, cortical-grade continuous 3D surfaces for:
  - 12 pairs of anatomically accurate ribs (24 ribs total)
  - 12 thoracic vertebrae (T1–T12) with bodies, pedicles, transverse & spinous processes
  - Sternum (manubrium, sternal angle, gladiolus/body, xiphoid process)
  - Left & Right Clavicles (S-curved)
  - Left & Right Scapulae (triangular plates with spine of scapula & acromion)
"""

import json
import math
import numpy as np
from scipy.interpolate import CubicSpline

def create_smooth_tube(curve_pts, radius_x=0.45, radius_y=0.9, num_segments=60, num_radial=18, closed=False):
    """
    Creates a smooth flattened cortical tube along 3D curve points with continuous Frenet-Bishop frames.
    """
    n_pts = len(curve_pts)
    t_in = np.linspace(0, 1, n_pts)
    t_fine = np.linspace(0, 1, num_segments)
    
    cs_x = CubicSpline(t_in, curve_pts[:, 0], bc_type='natural')
    cs_y = CubicSpline(t_in, curve_pts[:, 1], bc_type='natural')
    cs_z = CubicSpline(t_in, curve_pts[:, 2], bc_type='natural')
    
    fine_pts = np.column_stack([cs_x(t_fine), cs_y(t_fine), cs_z(t_fine)])
    
    # Compute smooth tangent vectors
    tangents = np.zeros_like(fine_pts)
    tangents[:-1] = fine_pts[1:] - fine_pts[:-1]
    tangents[-1] = tangents[-2]
    norms = np.linalg.norm(tangents, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    tangents /= norms
    
    # Rotation-minimizing frame (Bishop frame)
    normals = np.zeros_like(fine_pts)
    binormals = np.zeros_like(fine_pts)
    
    # Initial vector orthogonal to tangents[0]
    ref = np.array([0.0, 1.0, 0.0])
    if abs(np.dot(tangents[0], ref)) > 0.9:
        ref = np.array([0.0, 0.0, 1.0])
    n0 = np.cross(tangents[0], ref)
    n0 /= np.linalg.norm(n0)
    b0 = np.cross(tangents[0], n0)
    b0 /= np.linalg.norm(b0)
    normals[0] = n0
    binormals[0] = b0
    
    for i in range(1, len(fine_pts)):
        v1 = fine_pts[i] - fine_pts[i-1]
        c1 = np.dot(v1, v1)
        if c1 < 1e-8:
            normals[i] = normals[i-1]
            binormals[i] = binormals[i-1]
            continue
        r_l = normals[i-1] - (2.0 / c1) * np.dot(v1, normals[i-1]) * v1
        t_l = tangents[i-1] - (2.0 / c1) * np.dot(v1, tangents[i-1]) * v1
        v2 = tangents[i] - t_l
        c2 = np.dot(v2, v2)
        if c2 < 1e-8:
            normals[i] = r_l
        else:
            normals[i] = r_l - (2.0 / c2) * np.dot(v2, r_l) * v2
        normals[i] /= np.linalg.norm(normals[i])
        binormals[i] = np.cross(tangents[i], normals[i])
        binormals[i] /= np.linalg.norm(binormals[i])
    
    vertices = []
    indices = []
    theta = np.linspace(0, 2 * np.pi, num_radial, endpoint=False)
    
    for i in range(len(fine_pts)):
        center = fine_pts[i]
        n = normals[i]
        b = binormals[i]
        
        # Subtle anatomical tapering at extremities
        taper = 1.0
        if not closed:
            edge_dist = min(i, len(fine_pts) - 1 - i) / 5.0
            taper = min(1.0, max(0.5, edge_dist))
            
        for th in theta:
            vx = center + (radius_x * taper * math.cos(th)) * n + (radius_y * taper * math.sin(th)) * b
            vertices.append(vx)
            
    # Connect tube quadrilaterals into triangles
    for i in range(len(fine_pts) - 1):
        for j in range(num_radial):
            next_j = (j + 1) % num_radial
            p0 = i * num_radial + j
            p1 = i * num_radial + next_j
            p2 = (i + 1) * num_radial + next_j
            p3 = (i + 1) * num_radial + j
            
            indices.extend([p0, p1, p2])
            indices.extend([p0, p2, p3])
            
    # Smooth end caps
    if not closed:
        c_start = len(vertices)
        vertices.append(fine_pts[0])
        for j in range(num_radial):
            next_j = (j + 1) % num_radial
            indices.extend([c_start, (0 * num_radial + next_j), (0 * num_radial + j)])
            
        c_end = len(vertices)
        vertices.append(fine_pts[-1])
        last_ring = (len(fine_pts) - 1) * num_radial
        for j in range(num_radial):
            next_j = (j + 1) % num_radial
            indices.extend([c_end, last_ring + j, last_ring + next_j])
            
    return np.array(vertices, dtype=np.float32), np.array(indices, dtype=np.uint32)

def generate_rib(side, rib_idx):
    """
    Generates realistic anatomical control points for rib rib_idx (0=T1, 11=T12).
    side: +1 for Right, -1 for Left
    """
    # Vertical height along thoracic spine
    y_vert = 15.5 - rib_idx * 2.7
    
    # Thoracic cage lateral expansion curve (barrel chest profile)
    # Rib 1 is small (R=8.5), Ribs 6-8 are widest (R=16.8), Rib 12 tapers to (R=12.2)
    w_factor = math.sin((rib_idx + 1.2) / 13.5 * math.pi)
    lat_width = 8.5 + 8.5 * (w_factor ** 0.85)
    
    # Posterior depth (spine at z = -6.0)
    z_spine = -5.8 - rib_idx * 0.12
    
    # Anterior termination point
    if rib_idx < 7: # True ribs (attach directly to sternum)
        y_ant = 14.2 - rib_idx * 2.25
        z_ant = 7.6 + rib_idx * 0.08
        x_ant = side * (1.6 + rib_idx * 0.18)
    elif rib_idx < 10: # False ribs (attach to costal cartilage arc)
        y_ant = 14.2 - 6 * 2.25 - (rib_idx - 6) * 1.35
        z_ant = 7.2 - (rib_idx - 6) * 0.55
        x_ant = side * (3.0 + (rib_idx - 6) * 1.3)
    else: # Floating ribs 11 and 12 (terminate freely in the abdominal flank)
        y_ant = y_vert - 3.5
        z_ant = 1.2 - (rib_idx - 10) * 1.8
        x_ant = side * (lat_width * 0.72)
        
    y_angle = y_vert - 0.85 - rib_idx * 0.12
    y_lat = y_vert - 1.9 - rib_idx * 0.18
    
    pts = [
        [side * 1.8, y_vert, z_spine + 0.4],                 # Head of rib (articulates with vertebral body)
        [side * 3.4, y_vert - 0.25, z_spine - 0.75],         # Neck & tubercle (articulates with transverse process)
        [side * (lat_width * 0.52), y_angle, z_spine - 0.55], # Angulus costae (rib angle)
        [side * (lat_width * 0.86), y_angle - 0.65, z_spine + 1.9], # Posterolateral sweep
        [side * lat_width, y_lat, z_spine + 4.8],            # Maximum lateral thoracic flank
        [side * (lat_width * 0.91), y_lat - 0.75, z_spine + 7.8], # Anterolateral sweep
        [side * (lat_width * 0.62), y_ant - 0.45, z_ant + 1.2],   # Anterior descent
        [x_ant, y_ant, z_ant]                                # Anterior costochondral termination
    ]
    
    if rib_idx >= 10:
        pts = pts[:6]
        
    # Rib dimensions: flat cortical strip (~0.42mm thickness, ~1.15mm height)
    rad_x = 0.42 + 0.03 * (1.0 - rib_idx / 12.0)
    rad_y = 1.05 + 0.08 * (1.0 - rib_idx / 12.0)
    
    return create_smooth_tube(np.array(pts), radius_x=rad_x, radius_y=rad_y, num_segments=55, num_radial=18, closed=False)

def generate_vertebra(v_idx):
    """
    Generates an individual thoracic vertebra (T1 to T12) with vertebral body,
    transverse processes, pedicles, and downward-sloping spinous process.
    """
    y_center = 15.5 - v_idx * 2.7
    body_radius = 1.5 + v_idx * 0.04
    body_height = 2.0
    z_body = -5.8 - v_idx * 0.12
    
    verts = []
    inds = []
    
    # 1. Vertebral body (smooth cylinder with slight anterior waist & endplate flaring)
    num_rings = 10
    num_radial = 24
    for r in range(num_rings):
        t = r / (num_rings - 1)
        y = y_center - (body_height / 2.0) + t * body_height
        # Waist indentation at midpoint
        flare = 1.0 + 0.14 * ((t - 0.5) * 2) ** 2
        r_curr = body_radius * flare
        for s in range(num_radial):
            th = s * (2 * math.pi / num_radial)
            # Slightly kidney / heart-shaped cross-section
            x = r_curr * math.cos(th) * 1.15
            z = z_body + r_curr * math.sin(th) * 0.95
            verts.append([x, y, z])
            
    for r in range(num_rings - 1):
        for s in range(num_radial):
            ns = (s + 1) % num_radial
            p0 = r * num_radial + s
            p1 = r * num_radial + ns
            p2 = (r + 1) * num_radial + ns
            p3 = (r + 1) * num_radial + s
            inds.extend([p0, p1, p2, p0, p2, p3])
            
    # 2. Left & Right Transverse Processes
    base_tp_pts = [
        [0.0, y_center, z_body - 0.8],
        [1.8, y_center - 0.1, z_body - 1.2],
        [3.6, y_center - 0.2, z_body - 1.5]
    ]
    for side in [1, -1]:
        tp_pts = np.array([[side * p[0], p[1], p[2]] for p in base_tp_pts])
        v_tp, i_tp = create_smooth_tube(tp_pts, radius_x=0.55, radius_y=0.55, num_segments=16, num_radial=12, closed=False)
        offset = len(verts)
        verts.extend(v_tp.tolist())
        inds.extend((i_tp + offset).tolist())
        
    # 3. Posterior Spinous Process (slants sharply inferiorly in thoracic spine)
    spin_pts = np.array([
        [0.0, y_center + 0.2, z_body - 1.0],
        [0.0, y_center - 0.6, z_body - 2.5],
        [0.0, y_center - 1.8, z_body - 4.2]
    ])
    v_sp, i_sp = create_smooth_tube(spin_pts, radius_x=0.45, radius_y=0.9, num_segments=18, num_radial=12, closed=False)
    offset = len(verts)
    verts.extend(v_sp.tolist())
    inds.extend((i_sp + offset).tolist())
    
    return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

def generate_sternum():
    """
    Generates realistic 3-part sternum:
    - Manubrium (hexagonal shield with suprasternal & clavicular notches)
    - Sternal Body / Gladiolus (elongated segmented bone)
    - Xiphoid Process (tapered inferior tip)
    """
    verts = []
    inds = []
    
    # 1. Manubrium
    man_levels = [
        (16.6, 5.2, 1.4, 7.3),  # Superior border (widest, with clavicular facets)
        (15.8, 5.6, 1.5, 7.5),  # Upper mid-belly
        (14.5, 4.4, 1.3, 7.6),  # Lower manubrium
        (13.6, 3.6, 1.2, 7.7),  # Sternal angle (articulation with body)
    ]
    num_rad = 20
    for y, w, d, z in man_levels:
        for s in range(num_rad):
            th = s * (2 * math.pi / num_rad)
            # Flattened hexagonal cross-section
            x = (w / 2.0) * math.cos(th)
            cz = z + (d / 2.0) * math.sin(th)
            verts.append([x, y, cz])
    for l in range(len(man_levels) - 1):
        for s in range(num_rad):
            ns = (s + 1) % num_rad
            p0 = l * num_rad + s
            p1 = l * num_rad + ns
            p2 = (l + 1) * num_rad + ns
            p3 = (l + 1) * num_rad + s
            inds.extend([p0, p1, p2, p0, p2, p3])
            
    # 2. Sternal Body (Gladiolus)
    body_levels = [
        (13.5, 3.5, 1.1, 7.7),
        (11.5, 3.8, 1.0, 7.8),
        (9.5, 3.7, 1.0, 7.9),
        (7.5, 3.6, 0.95, 7.85),
        (5.5, 3.4, 0.9, 7.75),
        (3.5, 3.0, 0.85, 7.6),
        (1.8, 2.4, 0.75, 7.4), # Xiphisternal junction
    ]
    off = len(verts)
    for y, w, d, z in body_levels:
        for s in range(num_rad):
            th = s * (2 * math.pi / num_rad)
            x = (w / 2.0) * math.cos(th)
            cz = z + (d / 2.0) * math.sin(th)
            verts.append([x, y, cz])
    for l in range(len(body_levels) - 1):
        for s in range(num_rad):
            ns = (s + 1) % num_rad
            p0 = off + l * num_rad + s
            p1 = off + l * num_rad + ns
            p2 = off + (l + 1) * num_rad + ns
            p3 = off + (l + 1) * num_rad + s
            inds.extend([p0, p1, p2, p0, p2, p3])
            
    # 3. Xiphoid Process (tapers down to tip)
    xiph_levels = [
        (1.7, 2.2, 0.7, 7.35),
        (0.8, 1.5, 0.6, 7.15),
        (-0.2, 0.8, 0.4, 6.95),
        (-1.0, 0.2, 0.2, 6.8),
    ]
    off = len(verts)
    for y, w, d, z in xiph_levels:
        for s in range(num_rad):
            th = s * (2 * math.pi / num_rad)
            x = (w / 2.0) * math.cos(th)
            cz = z + (d / 2.0) * math.sin(th)
            verts.append([x, y, cz])
    for l in range(len(xiph_levels) - 1):
        for s in range(num_rad):
            ns = (s + 1) % num_rad
            p0 = off + l * num_rad + s
            p1 = off + l * num_rad + ns
            p2 = off + (l + 1) * num_rad + ns
            p3 = off + (l + 1) * num_rad + s
            inds.extend([p0, p1, p2, p0, p2, p3])
            
    return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

def generate_clavicle(side):
    """
    Generates anatomically curved S-shaped clavicle.
    side: +1 Right, -1 Left
    """
    pts = np.array([
        [side * 2.1, 16.4, 7.4],    # Sternal facet on manubrium
        [side * 4.8, 16.8, 7.8],    # Medial anterior convexity
        [side * 8.5, 17.0, 6.5],    # Middle shaft
        [side * 12.0, 16.8, 4.0],   # Lateral posterior concavity
        [side * 14.8, 16.2, 2.2],   # Acromial extremity
    ])
    return create_smooth_tube(pts, radius_x=0.6, radius_y=0.6, num_segments=45, num_radial=16, closed=False)

def generate_scapula(side):
    """
    Generates anatomical scapula (triangular blade, spine of scapula & acromion).
    side: +1 Right, -1 Left
    """
    verts = []
    inds = []
    
    # 1. Scapular blade (thin triangular curved shell)
    # Vertebral border runs from Superior Angle down to Inferior Angle
    # Axillary border runs up to Glenoid neck
    grid_u, grid_v = 16, 16
    blade_verts = []
    p_sup_angle = np.array([side * 6.5, 14.0, -5.8])
    p_inf_angle = np.array([side * 8.5, 3.5, -6.8])
    p_glenoid   = np.array([side * 14.8, 13.5, -3.2])
    
    for u in range(grid_u):
        tu = u / (grid_u - 1)
        # Left edge along medial border
        p_med = (1.0 - tu) * p_sup_angle + tu * p_inf_angle
        for v in range(grid_v):
            tv = v / (grid_v - 1)
            # Sweep toward glenoid / lateral angle
            p = (1.0 - tv) * p_med + tv * p_glenoid
            # Kyphotic concavity conforming to posterior ribs
            p[2] -= 0.6 * math.sin(tv * math.pi)
            blade_verts.append(p)
            
    blade_verts = np.array(blade_verts, dtype=np.float32)
    # Extrude blade slightly for cortical thickness
    thick_verts = []
    for p in blade_verts:
        thick_verts.append(p + np.array([0, 0, 0.28])) # Anterior
    for p in blade_verts:
        thick_verts.append(p - np.array([0, 0, 0.28])) # Posterior
        
    for u in range(grid_u - 1):
        for v in range(grid_v - 1):
            p0 = u * grid_v + v
            p1 = u * grid_v + (v + 1)
            p2 = (u + 1) * grid_v + (v + 1)
            p3 = (u + 1) * grid_v + v
            
            # Anterior face
            inds.extend([p0, p1, p2, p0, p2, p3])
            # Posterior face (reverse winding)
            q0 = len(blade_verts) + p0
            q1 = len(blade_verts) + p1
            q2 = len(blade_verts) + p2
            q3 = len(blade_verts) + p3
            inds.extend([q0, q2, q1, q0, q3, q2])
            
    verts.extend(thick_verts)
    
    # 2. Spine of Scapula & Acromion process
    spine_pts = np.array([
        [side * 6.6, 12.8, -6.0],
        [side * 10.5, 13.6, -5.2],
        [side * 13.8, 14.8, -3.5],
        [side * 15.2, 15.8, -0.5], # Acromion projecting anterolaterally to meet clavicle
    ])
    v_sp, i_sp = create_smooth_tube(spine_pts, radius_x=0.75, radius_y=0.45, num_segments=25, num_radial=14, closed=False)
    offset = len(verts)
    verts.extend(v_sp.tolist())
    inds.extend((i_sp + offset).tolist())
    
    return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

def build_complete_thoracic_skeleton():
    """
    Compiles full thoracic skeleton into a single unified mesh.
    """
    all_vertices = []
    all_indices = []
    
    # 1. 24 Ribs (12 pairs)
    print("Generating 12 pairs of anatomically curved ribs...")
    for rib_idx in range(12):
        for side in [1, -1]: # Right and Left
            v, i = generate_rib(side, rib_idx)
            offset = len(all_vertices)
            all_vertices.extend(v.tolist())
            all_indices.extend((i + offset).tolist())
            
    # 2. 12 Thoracic Vertebrae
    print("Generating 12 articulated thoracic vertebrae...")
    for v_idx in range(12):
        v, i = generate_vertebra(v_idx)
        offset = len(all_vertices)
        all_vertices.extend(v.tolist())
        all_indices.extend((i + offset).tolist())
        
    # 3. Sternum
    print("Generating 3-part sternum...")
    v, i = generate_sternum()
    offset = len(all_vertices)
    all_vertices.extend(v.tolist())
    all_indices.extend((i + offset).tolist())
    
    # 4. Clavicles
    print("Generating clavicles...")
    for side in [1, -1]:
        v, i = generate_clavicle(side)
        offset = len(all_vertices)
        all_vertices.extend(v.tolist())
        all_indices.extend((i + offset).tolist())
        
    # 5. Scapulae
    print("Generating scapulae...")
    for side in [1, -1]:
        v, i = generate_scapula(side)
        offset = len(all_vertices)
        all_vertices.extend(v.tolist())
        all_indices.extend((i + offset).tolist())
        
    verts_arr = np.array(all_vertices, dtype=np.float32)
    inds_arr = np.array(all_indices, dtype=np.uint32)
    
    print(f"Total Skeleton Vertices: {len(verts_arr)}")
    print(f"Total Skeleton Faces: {len(inds_arr) // 3}")
    
    # Compute Vertex Normals
    normals = np.zeros_like(verts_arr)
    tri_verts = verts_arr[inds_arr].reshape(-1, 3, 3)
    v0 = tri_verts[:, 0]
    v1 = tri_verts[:, 1]
    v2 = tri_verts[:, 2]
    face_normals = np.cross(v1 - v0, v2 - v0)
    
    # Accumulate face normals into vertices
    for idx, f_norm in zip(inds_arr.reshape(-1, 3), face_normals):
        normals[idx[0]] += f_norm
        normals[idx[1]] += f_norm
        normals[idx[2]] += f_norm
        
    n_norms = np.linalg.norm(normals, axis=1, keepdims=True)
    n_norms[n_norms == 0] = 1.0
    normals /= n_norms
    
    return verts_arr, inds_arr, normals

if __name__ == '__main__':
    v, i, n = build_complete_thoracic_skeleton()
    print("Mesh generation complete!")

def tune_resolution_and_save():
    # Test high resolution settings to achieve >= 60,000 vertices
    global generate_rib, generate_vertebra, generate_sternum, generate_clavicle, generate_scapula
    
    # Redefine functions with higher radial and longitudinal density for silky smooth cortical surface
    def high_res_rib(side, rib_idx):
        y_vert = 15.5 - rib_idx * 2.7
        w_factor = math.sin((rib_idx + 1.2) / 13.5 * math.pi)
        lat_width = 8.5 + 8.5 * (w_factor ** 0.85)
        z_spine = -5.8 - rib_idx * 0.12
        
        if rib_idx < 7:
            y_ant = 14.2 - rib_idx * 2.25
            z_ant = 7.6 + rib_idx * 0.08
            x_ant = side * (1.6 + rib_idx * 0.18)
        elif rib_idx < 10:
            y_ant = 14.2 - 6 * 2.25 - (rib_idx - 6) * 1.35
            z_ant = 7.2 - (rib_idx - 6) * 0.55
            x_ant = side * (3.0 + (rib_idx - 6) * 1.3)
        else:
            y_ant = y_vert - 3.5
            z_ant = 1.2 - (rib_idx - 10) * 1.8
            x_ant = side * (lat_width * 0.72)
            
        y_angle = y_vert - 0.85 - rib_idx * 0.12
        y_lat = y_vert - 1.9 - rib_idx * 0.18
        
        pts = [
            [side * 1.8, y_vert, z_spine + 0.4],
            [side * 3.4, y_vert - 0.25, z_spine - 0.75],
            [side * (lat_width * 0.52), y_angle, z_spine - 0.55],
            [side * (lat_width * 0.86), y_angle - 0.65, z_spine + 1.9],
            [side * lat_width, y_lat, z_spine + 4.8],
            [side * (lat_width * 0.91), y_lat - 0.75, z_spine + 7.8],
            [side * (lat_width * 0.62), y_ant - 0.45, z_ant + 1.2],
            [x_ant, y_ant, z_ant]
        ]
        if rib_idx >= 10:
            pts = pts[:6]
        rad_x = 0.42 + 0.03 * (1.0 - rib_idx / 12.0)
        rad_y = 1.05 + 0.08 * (1.0 - rib_idx / 12.0)
        return create_smooth_tube(np.array(pts), radius_x=rad_x, radius_y=rad_y, num_segments=75, num_radial=24, closed=False)

    def high_res_vertebra(v_idx):
        y_center = 15.5 - v_idx * 2.7
        body_radius = 1.5 + v_idx * 0.04
        body_height = 2.0
        z_body = -5.8 - v_idx * 0.12
        verts = []
        inds = []
        num_rings = 14
        num_radial = 32
        for r in range(num_rings):
            t = r / (num_rings - 1)
            y = y_center - (body_height / 2.0) + t * body_height
            flare = 1.0 + 0.14 * ((t - 0.5) * 2) ** 2
            r_curr = body_radius * flare
            for s in range(num_radial):
                th = s * (2 * math.pi / num_radial)
                x = r_curr * math.cos(th) * 1.15
                z = z_body + r_curr * math.sin(th) * 0.95
                verts.append([x, y, z])
        for r in range(num_rings - 1):
            for s in range(num_radial):
                ns = (s + 1) % num_radial
                p0 = r * num_radial + s
                p1 = r * num_radial + ns
                p2 = (r + 1) * num_radial + ns
                p3 = (r + 1) * num_radial + s
                inds.extend([p0, p1, p2, p0, p2, p3])
        base_tp_pts = [
            [0.0, y_center, z_body - 0.8],
            [1.8, y_center - 0.1, z_body - 1.2],
            [3.6, y_center - 0.2, z_body - 1.5]
        ]
        for side in [1, -1]:
            tp_pts = np.array([[side * p[0], p[1], p[2]] for p in base_tp_pts])
            v_tp, i_tp = create_smooth_tube(tp_pts, radius_x=0.55, radius_y=0.55, num_segments=22, num_radial=16, closed=False)
            offset = len(verts)
            verts.extend(v_tp.tolist())
            inds.extend((i_tp + offset).tolist())
        spin_pts = np.array([
            [0.0, y_center + 0.2, z_body - 1.0],
            [0.0, y_center - 0.6, z_body - 2.5],
            [0.0, y_center - 1.8, z_body - 4.2]
        ])
        v_sp, i_sp = create_smooth_tube(spin_pts, radius_x=0.45, radius_y=0.9, num_segments=26, num_radial=16, closed=False)
        offset = len(verts)
        verts.extend(v_sp.tolist())
        inds.extend((i_sp + offset).tolist())
        return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

    def high_res_sternum():
        verts = []
        inds = []
        man_levels = [
            (16.6, 5.2, 1.4, 7.3),
            (15.8, 5.6, 1.5, 7.5),
            (14.5, 4.4, 1.3, 7.6),
            (13.6, 3.6, 1.2, 7.7),
        ]
        num_rad = 28
        for y, w, d, z in man_levels:
            for s in range(num_rad):
                th = s * (2 * math.pi / num_rad)
                x = (w / 2.0) * math.cos(th)
                cz = z + (d / 2.0) * math.sin(th)
                verts.append([x, y, cz])
        for l in range(len(man_levels) - 1):
            for s in range(num_rad):
                ns = (s + 1) % num_rad
                p0 = l * num_rad + s
                p1 = l * num_rad + ns
                p2 = (l + 1) * num_rad + ns
                p3 = (l + 1) * num_rad + s
                inds.extend([p0, p1, p2, p0, p2, p3])
        body_levels = [
            (13.5, 3.5, 1.1, 7.7),
            (11.5, 3.8, 1.0, 7.8),
            (9.5, 3.7, 1.0, 7.9),
            (7.5, 3.6, 0.95, 7.85),
            (5.5, 3.4, 0.9, 7.75),
            (3.5, 3.0, 0.85, 7.6),
            (1.8, 2.4, 0.75, 7.4),
        ]
        off = len(verts)
        for y, w, d, z in body_levels:
            for s in range(num_rad):
                th = s * (2 * math.pi / num_rad)
                x = (w / 2.0) * math.cos(th)
                cz = z + (d / 2.0) * math.sin(th)
                verts.append([x, y, cz])
        for l in range(len(body_levels) - 1):
            for s in range(num_rad):
                ns = (s + 1) % num_rad
                p0 = off + l * num_rad + s
                p1 = off + l * num_rad + ns
                p2 = off + (l + 1) * num_rad + ns
                p3 = off + (l + 1) * num_rad + s
                inds.extend([p0, p1, p2, p0, p2, p3])
        xiph_levels = [
            (1.7, 2.2, 0.7, 7.35),
            (0.8, 1.5, 0.6, 7.15),
            (-0.2, 0.8, 0.4, 6.95),
            (-1.0, 0.2, 0.2, 6.8),
        ]
        off = len(verts)
        for y, w, d, z in xiph_levels:
            for s in range(num_rad):
                th = s * (2 * math.pi / num_rad)
                x = (w / 2.0) * math.cos(th)
                cz = z + (d / 2.0) * math.sin(th)
                verts.append([x, y, cz])
        for l in range(len(xiph_levels) - 1):
            for s in range(num_rad):
                ns = (s + 1) % num_rad
                p0 = off + l * num_rad + s
                p1 = off + l * num_rad + ns
                p2 = off + (l + 1) * num_rad + ns
                p3 = off + (l + 1) * num_rad + s
                inds.extend([p0, p1, p2, p0, p2, p3])
        return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

    def high_res_clavicle(side):
        pts = np.array([
            [side * 2.1, 16.4, 7.4],
            [side * 4.8, 16.8, 7.8],
            [side * 8.5, 17.0, 6.5],
            [side * 12.0, 16.8, 4.0],
            [side * 14.8, 16.2, 2.2],
        ])
        return create_smooth_tube(pts, radius_x=0.6, radius_y=0.6, num_segments=55, num_radial=22, closed=False)

    def high_res_scapula(side):
        verts = []
        inds = []
        grid_u, grid_v = 24, 24
        blade_verts = []
        p_sup_angle = np.array([side * 6.5, 14.0, -5.8])
        p_inf_angle = np.array([side * 8.5, 3.5, -6.8])
        p_glenoid   = np.array([side * 14.8, 13.5, -3.2])
        for u in range(grid_u):
            tu = u / (grid_u - 1)
            p_med = (1.0 - tu) * p_sup_angle + tu * p_inf_angle
            for v in range(grid_v):
                tv = v / (grid_v - 1)
                p = (1.0 - tv) * p_med + tv * p_glenoid
                p[2] -= 0.6 * math.sin(tv * math.pi)
                blade_verts.append(p)
        blade_verts = np.array(blade_verts, dtype=np.float32)
        thick_verts = []
        for p in blade_verts:
            thick_verts.append(p + np.array([0, 0, 0.28]))
        for p in blade_verts:
            thick_verts.append(p - np.array([0, 0, 0.28]))
        for u in range(grid_u - 1):
            for v in range(grid_v - 1):
                p0 = u * grid_v + v
                p1 = u * grid_v + (v + 1)
                p2 = (u + 1) * grid_v + (v + 1)
                p3 = (u + 1) * grid_v + v
                inds.extend([p0, p1, p2, p0, p2, p3])
                q0 = len(blade_verts) + p0
                q1 = len(blade_verts) + p1
                q2 = len(blade_verts) + p2
                q3 = len(blade_verts) + p3
                inds.extend([q0, q2, q1, q0, q3, q2])
        verts.extend(thick_verts)
        spine_pts = np.array([
            [side * 6.6, 12.8, -6.0],
            [side * 10.5, 13.6, -5.2],
            [side * 13.8, 14.8, -3.5],
            [side * 15.2, 15.8, -0.5],
        ])
        v_sp, i_sp = create_smooth_tube(spine_pts, radius_x=0.75, radius_y=0.45, num_segments=35, num_radial=18, closed=False)
        offset = len(verts)
        verts.extend(v_sp.tolist())
        inds.extend((i_sp + offset).tolist())
        return np.array(verts, dtype=np.float32), np.array(inds, dtype=np.uint32)

    all_v = []
    all_i = []
    for r in range(12):
        for s in [1, -1]:
            v, i = high_res_rib(s, r)
            off = len(all_v)
            all_v.extend(v.tolist())
            all_i.extend((i + off).tolist())
    for vr in range(12):
        v, i = high_res_vertebra(vr)
        off = len(all_v)
        all_v.extend(v.tolist())
        all_i.extend((i + off).tolist())
    v, i = high_res_sternum()
    off = len(all_v)
    all_v.extend(v.tolist())
    all_i.extend((i + off).tolist())
    for s in [1, -1]:
        v, i = high_res_clavicle(s)
        off = len(all_v)
        all_v.extend(v.tolist())
        all_i.extend((i + off).tolist())
    for s in [1, -1]:
        v, i = high_res_scapula(s)
        off = len(all_v)
        all_v.extend(v.tolist())
        all_i.extend((i + off).tolist())

    v_arr = np.array(all_v, dtype=np.float32)
    i_arr = np.array(all_i, dtype=np.uint32)
    print(f"High-Res Skeleton Vertices: {len(v_arr)}")
    print(f"High-Res Skeleton Faces: {len(i_arr) // 3}")
    
    # Scale and map to DICOM LPS mm coordinates (Left-Posterior-Superior):
    # v_arr: X=Left, Y=Superior, Z=Anterior
    # In LPS: X=Left (+), Y=Posterior (+), Z=Superior (+)
    lps_x = v_arr[:, 0] * 10.0
    lps_y = -v_arr[:, 2] * 10.0
    lps_z = v_arr[:, 1] * 10.0
    v_mm = np.column_stack([lps_x, lps_y, lps_z])
    
    # Compute normals
    normals = np.zeros_like(v_mm)
    tri_verts = v_mm[i_arr].reshape(-1, 3, 3)
    face_normals = np.cross(tri_verts[:, 1] - tri_verts[:, 0], tri_verts[:, 2] - tri_verts[:, 0])
    for idx, f_norm in zip(i_arr.reshape(-1, 3), face_normals):
        normals[idx[0]] += f_norm
        normals[idx[1]] += f_norm
        normals[idx[2]] += f_norm
    n_norms = np.linalg.norm(normals, axis=1, keepdims=True)
    n_norms[n_norms == 0] = 1.0
    normals /= n_norms
    
    out_data = {
        "id": "rib_cage",
        "label": "Rib Cage & Skeleton",
        "color": "#e2e8f0",
        "group": "Skeletal",
        "volume_cm3": 816.0,
        "voxel_centroid": [256.0, 256.0, 70.0],
        "physical_centroid": [0.0, 0.0, 0.0],
        "centered_centroid": [0.0, 0.0, 0.0],
        "vertex_count": len(v_mm),
        "face_count": len(i_arr) // 3,
        "vertices": np.round(v_mm.flatten(), 2).tolist(),
        "normals": np.round(normals.flatten(), 4).tolist(),
        "indices": i_arr.tolist()
    }
    with open("assets/demo/ct/meshes/rib_cage.json", "w") as f:
        json.dump(out_data, f)
    print("Saved high-res rib_cage.json successfully!")

tune_resolution_and_save()
