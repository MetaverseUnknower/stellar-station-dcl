# Builds DEX, the Space Bar's robot bartender (src/bar/bartender.ts): a mid-century hover-bot in ivory, brass and navy
# lacquer to match the bar (build_space_bar.py), with a bow tie. Three models, so the scene can move the parts:
#   bartender_body.glb    hover skirt, torso, arms, bow tie; origin on the floor under it
#   bartender_head.glb    the head (no eyes: bartender.ts draws them, to blink); origin at the neck's top
#   bartender_shaker.glb  a cocktail shaker; origin at its middle (the scene holds it in the right hand and shakes it)
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_bartender.py -- assets/models
#
# Built facing Blender -Y (scene +Z, once exported); his right hand is at Blender -X. Heights here must match
# bartender.ts (NECK, HAND).
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
NECK = 1.62            # the head's origin, above the floor
HAND = (-0.3, -0.36, 1.08)   # the right hand (Blender), where the shaker goes

bpy.ops.wm.read_factory_settings(use_empty=True)


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


IVORY = mat('Ivory', (0.9, 0.86, 0.78), 0.1, 0.25)
BRASS = mat('Brass', (0.85, 0.62, 0.28), 1.0, 0.25)
NAVY = mat('Lacquer', (0.03, 0.06, 0.16), 0.2, 0.2)
BLACK = mat('Visor', (0.01, 0.01, 0.015), 0.6, 0.08)
CYAN = mat('NeonCyan', (0.2, 0.9, 1.0), emit=3.0)
PINK = mat('NeonPink', (1.0, 0.22, 0.7), emit=3.0)
AMBER = mat('Amber', (1.0, 0.6, 0.15), emit=2.5)
CHROME = mat('Chrome', (0.85, 0.87, 0.9), 1.0, 0.12)


def piece(coll, name, m, build):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def ellipsoid(centre, radii, u=24, v=16):
    def build(bm):
        bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1,
                                  matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*radii, 1)))
    return build


def cyl(centre, r1, r2, depth, rot=Matrix.Identity(4), seg=24):
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth,
                              matrix=Matrix.Translation(centre) @ rot)
    return build


def torus(centre, major, minor, n=48, m=10):
    def build(bm):
        rows = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rows.append([bm.verts.new(Vector(centre) + Vector(((major + minor * math.cos(b)) * math.cos(a),
                                                                (major + minor * math.cos(b)) * math.sin(a),
                                                                minor * math.sin(b))))
                         for b in (2 * math.pi * j / m for j in range(m))])
        for i in range(n):
            for j in range(m):
                bm.faces.new((rows[i][j], rows[(i + 1) % n][j], rows[(i + 1) % n][(j + 1) % m], rows[i][(j + 1) % m]))
    return build


def between(p, q, r):
    """A cylinder of radius r from p to q."""
    p, q = Vector(p), Vector(q)
    d = q - p
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return cyl((p + q) / 2, r, r, d.length, rot, 16)


def new_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.objects:
        o.select_set(True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    print('WROTE', path)


# ── Body ──
body = new_coll('Body')
piece(body, 'Skirt', NAVY, cyl((0, 0, 0.66), 0.3, 0.2, 0.22))
piece(body, 'SkirtGlow', CYAN, torus((0, 0, 0.55), 0.3, 0.018))
piece(body, 'Waist', BRASS, torus((0, 0, 0.8), 0.23, 0.035))
piece(body, 'Torso', IVORY, ellipsoid((0, 0, 1.15), (0.3, 0.24, 0.4)))
piece(body, 'ChestPanel', NAVY, ellipsoid((0, -0.2, 1.18), (0.16, 0.06, 0.16)))
for i, (m, x) in enumerate(((CYAN, -0.06), (PINK, 0.0), (AMBER, 0.06))):
    piece(body, f'Button{i}', m, ellipsoid((x, -0.255, 1.2), (0.018, 0.012, 0.018), 12, 8))
piece(body, 'Collar', BRASS, torus((0, 0, 1.53), 0.09, 0.025))
piece(body, 'Neck', BRASS, cyl((0, 0, 1.58), 0.05, 0.05, 0.1))
# The bow tie: two cones meeting at a knot, just under the chin
for sgn in (-1, 1):
    piece(body, f'Bow{sgn}', BLACK, cyl((sgn * 0.055, -0.165, 1.52), 0.045, 0.012, 0.1, Matrix.Rotation(sgn * math.pi / 2, 4, 'Y'), 12))
piece(body, 'Knot', BLACK, ellipsoid((0, -0.17, 1.52), (0.022, 0.02, 0.024), 12, 8))
# Arms: shoulder, elbow out to the side, forearm forward toward the counter
for sgn in (-1, 1):
    shoulder, elbow, hand = (sgn * 0.33, 0, 1.36), (sgn * 0.38, -0.05, 1.05), (sgn * 0.3, -0.36, 1.08)
    piece(body, f'Shoulder{sgn}', BRASS, ellipsoid(shoulder, (0.07, 0.07, 0.07), 16, 10))
    piece(body, f'Upper{sgn}', IVORY, between(shoulder, elbow, 0.045))
    piece(body, f'Elbow{sgn}', BRASS, ellipsoid(elbow, (0.05, 0.05, 0.05), 16, 10))
    piece(body, f'Fore{sgn}', IVORY, between(elbow, hand, 0.04))
    piece(body, f'Hand{sgn}', CHROME, ellipsoid(hand, (0.055, 0.05, 0.045), 16, 10))
export(body, 'bartender_body.glb')

# ── Head (origin at the neck's top) ──
head = new_coll('Head')
piece(head, 'Dome', IVORY, ellipsoid((0, 0, 0.14), (0.2, 0.18, 0.16)))
piece(head, 'Visor', BLACK, ellipsoid((0, -0.07, 0.14), (0.185, 0.13, 0.075)))
for sgn in (-1, 1):
    piece(head, f'Ear{sgn}', BRASS, cyl((sgn * 0.2, 0, 0.14), 0.06, 0.06, 0.04, Matrix.Rotation(math.pi / 2, 4, 'Y')))
piece(head, 'Antenna', BRASS, cyl((0.08, 0.02, 0.36), 0.008, 0.008, 0.14, seg=8))
piece(head, 'AntennaTip', PINK, ellipsoid((0.08, 0.02, 0.44), (0.022, 0.022, 0.022), 12, 8))
export(head, 'bartender_head.glb')

# ── Shaker (origin at its middle) ──
shaker = new_coll('Shaker')
piece(shaker, 'Tin', CHROME, cyl((0, 0, 0), 0.045, 0.036, 0.16))
piece(shaker, 'Cap', CHROME, cyl((0, 0, 0.1), 0.036, 0.018, 0.05))
piece(shaker, 'Band', BRASS, cyl((0, 0, 0.075), 0.038, 0.038, 0.012))
export(shaker, 'bartender_shaker.glb')
print('HAND (blender)', HAND, 'NECK', NECK)
