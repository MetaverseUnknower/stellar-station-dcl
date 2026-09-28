# Builds assets/models/space_bar.glb: the lounge's bar, curved to follow the wall under the SPACE BAR sign. A
# mid-century counter (walnut top with a brass edge, a navy lacquered front with a cyan neon line under the lip and a
# pink one at the kick), a brass foot rail, and a back bar against the wall: a low cabinet and two shelves of
# glowing bottles.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_space_bar.py -- assets/models
#
# Built round the hub's centre (the origin), with the floor at z 0, centred on Blender's +X axis, which the explorer
# turns to scene -X (scene angle 180); src/lounge/spaceBar.ts turns it round to its place. Radii and angles here
# must match spaceBar.ts.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
HALF = math.radians(16)        # half the bar's sweep
FRONT_R, BACK_R = 24.6, 25.4   # the counter body (bar front faces the hub centre)
TOP_R0, TOP_R1 = 24.45, 25.5   # the top, overhanging the front
TOP_Z0, TOP_Z1 = 1.24, 1.36    # The Silt's counter height, for its stools
CAB_R0, CAB_R1, CAB_Z = 27.0, 27.6, 1.0   # back bar cabinet (the wall is ~28.2 m out)
SHELVES = ((1.55, 26.95, 27.4), (2.15, 26.9, 27.3))   # (height, inner r, outer r): the dome leans in above
SEG = 64

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene.collection


def mat(name, rgb, metallic=0.3, roughness=0.5, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emit:
        b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


WALNUT = mat('Walnut', (0.22, 0.11, 0.05), 0.0, 0.35)
BRASS = mat('Brass', (0.85, 0.62, 0.28), 1.0, 0.25)
NAVY = mat('Lacquer', (0.03, 0.06, 0.16), 0.2, 0.2)
CYAN = mat('NeonCyan', (0.2, 0.9, 1.0), emit=3.0)
PINK = mat('NeonPink', (1.0, 0.22, 0.7), emit=3.0)
BOTTLES = [mat(f'Bottle{i}', c, 0.1, 0.1, 1.6) for i, c in enumerate(
    [(1.0, 0.55, 0.12), (0.2, 0.9, 1.0), (1.0, 0.22, 0.7), (0.5, 1.0, 0.4), (0.6, 0.3, 1.0)])]


def sector(name, r0, r1, z0, z1, m, half=HALF, seg=SEG, span=None):
    """A solid ring sector: r0..r1 out from the origin, z0..z1 up, sweeping -half..half about +X (or span: a0..a1)."""
    a0, a1 = span if span else (-half, half)
    bm = bmesh.new()
    rings = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, r * s, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for i in range(seg):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    scene.objects.link(ob)
    return ob


def cylinder(name, x, y, z, radius, depth, m):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, z + depth / 2))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    scene.objects.link(bpy.data.objects.new(name, me))


# The counter.
sector('Body', FRONT_R, BACK_R, 0.0, TOP_Z0, NAVY)
sector('Top', TOP_R0, TOP_R1, TOP_Z0, TOP_Z1, WALNUT)
sector('TopEdge', TOP_R0 - 0.03, TOP_R0, TOP_Z0 - 0.02, TOP_Z1 + 0.005, BRASS)
sector('NeonLip', FRONT_R - 0.03, FRONT_R, TOP_Z0 - 0.1, TOP_Z0 - 0.06, CYAN)
sector('NeonKick', FRONT_R - 0.03, FRONT_R, 0.1, 0.14, PINK)
sector('FootRail', FRONT_R - 0.32, FRONT_R - 0.26, 0.2, 0.26, BRASS)

# The back bar: a cabinet, and shelves of bottles above it, against a lacquered back panel. Its centre bay is two
# leaves (LeafL_*, LeafR_*) that swing open, hinged at their outer front corners, onto the hidden doorway to the
# Eld's pod behind it (build_station_models.py ELD_*): exported on their own, each with its hinge at the origin, and
# turned by src/bar/secretDoor.ts. The leaves are shallower than the rest (to 27.36 m), so they clear the counter as
# they swing.
BAY = math.radians(2.8)           # the centre bay: -BAY..BAY
HINGE_R = 26.87                   # the leaves' front edge: their hinge line
LEAF_BACK = 27.36
PANEL = (27.32, 27.36, 2.45)      # back panel: inner and outer radius, height (the dome leans in above: ~27.45 there)
rng = random.Random(3)


def back_bar(prefix, span, back):
    """One stretch of the back bar, over span (a0, a1), `back` metres out at its deepest."""
    a0, a1 = span
    seg = max(2, int(SEG * (a1 - a0) / (2 * HALF)))
    shelf_span = (max(a0, -HALF * 0.8), min(a1, HALF * 0.8))
    sector(f'{prefix}Cabinet', CAB_R0, back, 0.0, CAB_Z, NAVY, seg=seg, span=span)
    sector(f'{prefix}CabinetTop', CAB_R0 - 0.04, back, CAB_Z, CAB_Z + 0.05, WALNUT, seg=seg, span=span)
    sector(f'{prefix}CabinetNeon', CAB_R0 - 0.07, CAB_R0 - 0.04, CAB_Z - 0.06, CAB_Z - 0.02, CYAN, seg=seg, span=span)
    sector(f'{prefix}BackPanel', PANEL[0], PANEL[1], CAB_Z + 0.05, PANEL[2], NAVY, seg=seg, span=shelf_span)
    for n, (z, r0, r1) in enumerate(SHELVES):
        sector(f'{prefix}Shelf{n}', r0, min(r1, PANEL[0]), z, z + 0.04, WALNUT, seg=seg, span=shelf_span)
        sector(f'{prefix}ShelfGlow{n}', r0 - 0.02, r0, z - 0.03, z, PINK, seg=seg, span=shelf_span)
    for n, (z, r0, r1) in enumerate([(CAB_Z + 0.05, CAB_R0, min(CAB_R1, PANEL[0]))] + list(SHELVES)):
        r = (r0 + min(r1, PANEL[0])) / 2
        a = shelf_span[0] + 0.05 / r
        while a < shelf_span[1] - 0.05 / r:
            h = rng.uniform(0.25, 0.4)
            cylinder(f'{prefix}Bottle{n}_{a:.3f}', r * math.cos(a), r * math.sin(a), z + 0.04, rng.uniform(0.04, 0.06), h, rng.choice(BOTTLES))
            a += rng.uniform(0.35, 0.6) / r


back_bar('Back', (-HALF * 0.9, -BAY), CAB_R1)
back_bar('BackR', (BAY, HALF * 0.9), CAB_R1)
back_bar('LeafL_', (-BAY, -0.001), LEAF_BACK)
back_bar('LeafR_', (0.001, BAY), LEAF_BACK)

os.makedirs(OUT, exist_ok=True)


def export(filename, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# Each leaf with its hinge at the origin (the hinge at its outer end: -BAY for the left, +BAY for the right).
for side, sign in (('LeafL_', -1), ('LeafR_', 1)):
    hinge = Vector((HINGE_R * math.cos(BAY), sign * HINGE_R * math.sin(BAY), 0))
    leaf = [o for o in scene.objects if o.name.startswith(side)]
    for o in leaf:
        o.data.transform(Matrix.Translation(-hinge))
    export(f'space_bar_{side[:5].lower()}.glb', leaf)
    print('HINGE', side, tuple(round(v, 4) for v in hinge))

export('space_bar.glb', [o for o in scene.objects if not o.name.startswith(('LeafL_', 'LeafR_'))])
