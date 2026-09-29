# Builds the Space Bar's robot bartenders (src/bar/bartender.ts). DEX: a mid-century hover-bot in ivory, brass and navy
# lacquer to match the bar (build_space_bar.py), with a bow tie. PIP: small, round and pastel, with blushing cheeks, a
# smile and a heart on her antenna. Each in parts, so the scene can move them:
#   bartender_body.glb    hover skirt, torso, arms, bow tie; origin on the floor under it
#   bartender_head.glb    the head (no eyes: bartender.ts draws them, to blink); origin at the neck's top
#   bartender_shaker.glb  a cocktail shaker; origin at its middle (the scene holds it in the right hand and shakes it)
#   blip_body.glb, blip_head.glb   PIP's, the same way (her head's origin at BLIP_NECK; no eyes either)
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_bartender.py -- assets/models
#
# Built facing Blender -Y (scene +Z, once exported); the right hand is at Blender -X. Heights here must match
# bartender.ts (NECK, HAND, and PIP's).
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
NECK = 1.62            # the head's origin, above the floor
HAND = (-0.3, -0.36, 1.08)   # the right hand (Blender), where the shaker goes
BLIP_NECK = 1.44
BLIP_HAND = (-0.29, -0.25, 1.03)

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
MINT = mat('Mint', (0.62, 0.95, 0.84), 0.05, 0.2)
WHITE = mat('Pearl', (0.96, 0.95, 0.97), 0.05, 0.18)
BLUSH = mat('Blush', (1.0, 0.45, 0.62), emit=1.6)
BUBBLEGUM = mat('Bubblegum', (1.0, 0.62, 0.78), 0.05, 0.3)
SCREEN = mat('FaceScreen', (0.03, 0.03, 0.06), 0.3, 0.08)


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


def heart(coll, name, centre, size, m):
    """A little heart facing -Y: two lobes and a point."""
    x, y, z = centre
    for sgn in (-1, 1):
        piece(coll, f'{name}Lobe{sgn}', m, ellipsoid((x + sgn * 0.5 * size, y, z), (0.62 * size, 0.35 * size, 0.62 * size), 14, 10))
    piece(coll, f'{name}Point', m, cyl((x, y, z - 0.55 * size), 0.95 * size, 0.0, 1.1 * size, Matrix.Rotation(math.pi, 4, 'X') @ Matrix.Scale(1, 4), 14))


# ── PIP ──
pip = new_coll('BlipBody')
piece(pip, 'Base', BUBBLEGUM, cyl((0, 0, 0.82), 0.1, 0.17, 0.16))
piece(pip, 'BaseGlow', BLUSH, torus((0, 0, 0.74), 0.11, 0.014))
piece(pip, 'Body', MINT, ellipsoid((0, 0, 1.12), (0.27, 0.25, 0.27)))
piece(pip, 'Belly', WHITE, ellipsoid((0, -0.17, 1.08), (0.17, 0.09, 0.15)))
heart(pip, 'BellyHeart', (0, -0.258, 1.1), 0.035, BLUSH)
piece(pip, 'Neck', WHITE, cyl((0, 0, 1.41), 0.06, 0.06, 0.06))
for sgn in (-1, 1):
    shoulder, hand = (sgn * 0.25, -0.02, 1.18), (sgn * 0.29, -0.25, 1.03)
    piece(pip, f'Arm{sgn}', MINT, between(shoulder, hand, 0.04))
    piece(pip, f'Hand{sgn}', WHITE, ellipsoid(hand, (0.048, 0.048, 0.048), 16, 10))
export(pip, 'blip_body.glb')

pip_head = new_coll('BlipHead')
piece(pip_head, 'Dome', WHITE, ellipsoid((0, 0, 0.19), (0.22, 0.2, 0.2)))
piece(pip_head, 'Face', SCREEN, ellipsoid((0, -0.08, 0.18), (0.18, 0.14, 0.13)))
for sgn in (-1, 1):
    piece(pip_head, f'Cheek{sgn}', BLUSH, ellipsoid((sgn * 0.11, -0.172, 0.12), (0.032, 0.012, 0.02), 14, 8))
    piece(pip_head, f'Ear{sgn}', BUBBLEGUM, ellipsoid((sgn * 0.215, 0, 0.21), (0.03, 0.05, 0.05), 14, 10))
# A smile: a little arc of light under the eyes
def smile(bm):
    rows = []
    n, m_, r, tube = 12, 6, 0.035, 0.007
    for i in range(n + 1):
        a = math.radians(200 + 140 * i / n)
        c = Vector((r * math.cos(a), -0.212, 0.115 + r * math.sin(a) + r * 0.6))
        rows.append([bm.verts.new(c + Vector((0, tube * math.sin(2 * math.pi * j / m_), 0)) + Vector((math.cos(a), 0, math.sin(a))) * tube * math.cos(2 * math.pi * j / m_)) for j in range(m_)])
    for i in range(n):
        for j in range(m_):
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][(j + 1) % m_], rows[i][(j + 1) % m_]))
piece(pip_head, 'Smile', BLUSH, smile)
piece(pip_head, 'Stem', WHITE, cyl((0, 0, 0.43), 0.007, 0.007, 0.1, seg=8))
heart(pip_head, 'AntennaHeart', (0, 0, 0.51), 0.032, BLUSH)
export(pip_head, 'blip_head.glb')
print('HAND (blender)', HAND, 'NECK', NECK, 'BLIP_HAND', BLIP_HAND, 'BLIP_NECK', BLIP_NECK)
