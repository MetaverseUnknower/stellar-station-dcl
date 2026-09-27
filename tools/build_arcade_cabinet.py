# Builds assets/models/arcade_cabinet.glb: an upright arcade cabinet, retro-futuristic: a dark gloss body with the
# classic side silhouette, neon trim along both sides, a glowing marquee, and a control panel with a joystick and
# buttons. The screen is left as a dark recess; the scene lays an animated screen over it (src/arcade/arcade.ts:
# SCREEN_* must match the recess here).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_arcade_cabinet.py -- assets/models
#
# Built at the origin on the floor, 0.76 m wide, facing -Y (the explorer turns that to +Z).
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
HALF_W = 0.38
# Side silhouette as (y, z), front toward -y: base, kick, control panel ledge, screen slope, marquee hood, top.
PROFILE = [(0.42, 0.0), (-0.34, 0.0), (-0.34, 0.86), (-0.46, 0.96), (-0.44, 1.02), (-0.22, 1.06),
           (-0.12, 1.62), (-0.28, 1.66), (-0.28, 1.94), (0.42, 1.94)]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene.collection


def mat(name, rgb, metallic=0.3, roughness=0.4, emit=0.0):
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


BODY = mat('CabinetGloss', (0.03, 0.03, 0.07), 0.5, 0.2)
BEZEL = mat('Bezel', (0.01, 0.01, 0.015), 0.2, 0.6)
PANEL = mat('ControlPanel', (0.08, 0.06, 0.16), 0.6, 0.3)
PINK = mat('NeonPink', (1.0, 0.22, 0.7), emit=3.0)
CYAN = mat('NeonCyan', (0.2, 0.9, 1.0), emit=3.0)
MARQUEE = mat('Marquee', (1.0, 0.55, 0.9), emit=2.2)
BUTTONS = [mat(f'Button{i}', c, 0.1, 0.3, 2.0) for i, c in enumerate([(1, 0.2, 0.3), (1, 0.8, 0.2), (0.2, 0.9, 1.0), (0.5, 1, 0.4)])]


def link(name, bm, m):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(m)
    scene.objects.link(bpy.data.objects.new(name, me))


def extrude_profile(name, profile, x0, x1, m):
    """The (y, z) profile as a solid from x0 to x1."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in profile]
    b = [bm.verts.new((x1, y, z)) for y, z in profile]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    link(name, bm, m)


def box(name, lo, hi, m):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector(((lo[i] + hi[i]) / 2 + v.co[i] * (hi[i] - lo[i]) for i in range(3)))
    link(name, bm, m)


def tube(name, points, x, m, r=0.012):
    """A neon tube along (y, z) points at side offset x."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 1
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, (y, z) in zip(sp.points, points):
        p.co = (x, y, z, 1)
    ob = bpy.data.objects.new(name, cu)
    scene.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    scene.objects.unlink(ob)
    me.materials.append(m)
    scene.objects.link(bpy.data.objects.new(name, me))


def cylinder(name, x, y, z, radius, depth, m, seg=16):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(x, y, z + depth / 2))
    link(name, bm, m)


# Body: the silhouette, with slightly proud side panels.
extrude_profile('Body', PROFILE, -HALF_W + 0.02, HALF_W - 0.02, BODY)
for s in (-1, 1):
    extrude_profile(f'Side{s}', PROFILE, s * HALF_W - (0.02 if s > 0 else 0), s * HALF_W + (0.0 if s > 0 else 0.02), BODY)
    # Neon along the front edge of each side, from the kick up to the marquee hood.
    tube(f'SideNeon{s}', [(y - 0.01, z) for y, z in PROFILE[1:8]], s * (HALF_W + 0.005), PINK if s < 0 else CYAN)

# Screen bezel: a dark frame proud of the screen slope, open in the middle (the scene's screen goes there).
bottom, top = Vector((0, -0.22, 1.06)), Vector((0, -0.12, 1.62))
up = (top - bottom).normalized()
normal = Vector((0, -up.z, up.y))  # out of the slope, toward the player (-y)
bm = bmesh.new()
def at(u, v, off):
    return bottom + up * v + Vector((u, 0, 0)) + normal * off
outer = [(-0.34, 0.0), (0.34, 0.0), (0.34, 0.57), (-0.34, 0.57)]
inner = [(-0.3, 0.03), (0.3, 0.03), (0.3, 0.54), (-0.3, 0.54)]
o = [bm.verts.new(at(u, v, 0.012)) for u, v in outer]
i_ = [bm.verts.new(at(u, v, 0.012)) for u, v in inner]
for k in range(4):
    j = (k + 1) % 4
    bm.faces.new((o[k], o[j], i_[j], i_[k]))
link('Bezel', bm, BEZEL)

# Marquee: a glowing panel across the hood's front, with a cyan strip under it.
box('Marquee', (-HALF_W + 0.03, -0.29, 1.7), (HALF_W - 0.03, -0.27, 1.9), MARQUEE)
box('MarqueeStrip', (-HALF_W + 0.03, -0.3, 1.665), (HALF_W - 0.03, -0.28, 1.68), CYAN)

# Control panel: a joystick and four buttons on the ledge.
ledge_z = 1.0
cylinder('StickBase', -0.16, -0.36, ledge_z, 0.035, 0.02, BEZEL)
cylinder('Stick', -0.16, -0.36, ledge_z, 0.01, 0.1, BEZEL, 8)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.03)
bmesh.ops.translate(bm, verts=bm.verts, vec=(-0.16, -0.36, ledge_z + 0.12))
link('StickBall', bm, BUTTONS[0])
for k, (x, y) in enumerate([(0.02, -0.38), (0.1, -0.4), (0.18, -0.38), (0.26, -0.36)]):
    cylinder(f'Button{k}', x, y, ledge_z, 0.022, 0.02, BUTTONS[k])

bpy.ops.object.select_all(action='SELECT')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'arcade_cabinet.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')
