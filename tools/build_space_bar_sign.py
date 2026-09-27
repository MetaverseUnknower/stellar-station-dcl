# Builds assets/models/space_bar_sign.glb: a retro-futuristic, mid-century "SPACE BAR" neon sign. Neon tubes trace
# the letters' outlines (SPACE hot pink, BAR cyan), a Saturn-style planet (amber, with a tilted ring) and a four-point
# sparkle star (yellow), on a boomerang-shaped backboard with a warm-white neon rim.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_space_bar_sign.py -- assets/models
#
# Built in the XZ plane facing -Y, centred on the origin, about 7.2 m wide and 3.3 m tall. Lettering uses Blender's bundled font
# (openly licensed), not a system font, which couldn't be shipped inside the model.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
TUBE = 0.022          # neon tube radius
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene.collection


def neon(name, rgb, strength=6.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = strength
    return m


def plain(name, rgb, metallic=0.3, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    return m


PINK = neon('NeonPink', (1.0, 0.22, 0.7))
CYAN = neon('NeonCyan', (0.2, 0.9, 1.0))
AMBER = neon('NeonAmber', (1.0, 0.55, 0.12))
YELLOW = neon('NeonYellow', (1.0, 0.9, 0.3))
WARM = neon('NeonWarm', (1.0, 0.85, 0.65), 5.0)
BOARD = plain('Backboard', (0.03, 0.07, 0.12), 0.4, 0.35)


def to_mesh_object(curve_ob, name, mat):
    """Evaluate a curve object (with its bevel) to a mesh object standing in the XZ plane, facing -Y."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(curve_ob.evaluated_get(dg))
    scene.objects.unlink(curve_ob)
    me.transform(Matrix.Rotation(math.radians(90), 4, 'X'))  # XY -> XZ, readable from -Y
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.objects.link(ob)
    return ob


def neon_text(body, size, x, z, mat, name):
    """Letters as neon: outline curves only (no fill), each outline beveled into a round tube."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.fill_mode = 'NONE'
    cu.bevel_depth = TUBE
    cu.bevel_resolution = 2
    cu.space_character = 1.05
    ob = bpy.data.objects.new(name, cu)
    scene.objects.link(ob)
    out = to_mesh_object(ob, name, mat)
    out.location = (x, -0.06, z)
    return out


def neon_path(points, mat, name, closed=True):
    """A neon tube along a 2D path given as (x, z) points in the sign's plane."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = TUBE
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, (x, z) in zip(sp.points, points):
        p.co = (x, z, 0, 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    scene.objects.link(ob)
    out = to_mesh_object(ob, name, mat)
    out.location = (0, -0.07, 0)
    return out


def ellipse(cx, cz, rx, rz, tilt=0.0, n=64, start=0.0, end=2 * math.pi):
    pts = []
    for i in range(n + 1 if end - start < 2 * math.pi else n):
        a = start + (end - start) * i / (n if end - start < 2 * math.pi else n)
        x, z = rx * math.cos(a), rz * math.sin(a)
        c, s = math.cos(tilt), math.sin(tilt)
        pts.append((cx + x * c - z * s, cz + x * s + z * c))
    return pts


# Boomerang backboard: a swept, asymmetric kidney outline, extruded thin, with a neon rim.
def boomerang(n=96):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        # A wide ellipse, pinched at the top-middle and swept up at the right: the 1950s boomerang.
        r = 1 + 0.10 * math.cos(2 * a)
        x = 3.6 * math.cos(a) * r
        # Swept up at the right end and dipped in the middle of the top edge: the 1950s boomerang.
        z = 1.55 * math.sin(a) * r + 0.45 * math.cos(a) - 0.22 * max(0.0, math.sin(a)) * math.cos(a) ** 8
        pts.append((x, z))
    return pts


outline = boomerang()
bm = bmesh.new()
front = [bm.verts.new((x, 0, z)) for x, z in outline]
back = [bm.verts.new((x, 0.08, z)) for x, z in outline]
bm.faces.new(front[::-1])
bm.faces.new(back)
for i in range(len(outline)):
    j = (i + 1) % len(outline)
    bm.faces.new((front[i], front[j], back[j], back[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
me = bpy.data.meshes.new('Backboard')
bm.to_mesh(me)
bm.free()
me.materials.append(BOARD)
scene.objects.link(bpy.data.objects.new('Backboard', me))
# Rim, just inside the board's edge.
neon_path([(x * 0.94, z * 0.9 + 0.02) for x, z in outline], WARM, 'Rim')

# Lettering: SPACE over BAR, BAR set right, leaving the lower left for Saturn.
neon_text('SPACE', 0.95, 0.45, 0.5, PINK, 'Space')
neon_text('BAR', 0.8, 1.05, -0.6, CYAN, 'Bar')

# Saturn, lower left: the planet's outline, and a tilted ring that passes behind it (front arc only in front).
neon_path(ellipse(-1.7, -0.45, 0.42, 0.42), AMBER, 'Planet')
tilt = math.radians(-18)
neon_path(ellipse(-1.7, -0.45, 0.85, 0.22, tilt, start=math.radians(-10), end=math.radians(190)), AMBER, 'RingFront', closed=False)

# Four-point sparkle star, upper left, with two little starburst ticks.
def sparkle(cx, cz, r, pinch=0.28):
    pts = []
    for i in range(8):
        a = math.pi / 2 + i * math.pi / 4
        rr = r if i % 2 == 0 else r * pinch
        pts.append((cx + rr * math.cos(a), cz + rr * math.sin(a)))
    return pts
neon_path(sparkle(-2.25, 0.45, 0.38), YELLOW, 'Star')
neon_path([(-1.78, 0.78), (-1.66, 0.88)], YELLOW, 'Tick1', closed=False)
neon_path([(-2.7, 0.1), (-2.82, 0.0)], YELLOW, 'Tick2', closed=False)

bpy.ops.object.select_all(action='SELECT')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'space_bar_sign.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', 'tris', sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons))
