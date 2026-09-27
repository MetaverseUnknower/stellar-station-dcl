# Builds assets/models/disco_ball.glb: a mirror ball of flat mirror tiles with grout between them, a mounting cap and
# a rod to hang it by. Flat tiles are what make a real one sparkle as it turns.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_disco_ball.py -- assets/models
#
# Built at the origin with the ball's centre there; radius RADIUS; the rod runs up ROD metres from its top.
import bpy, bmesh, math, os, random, sys
from mathutils import Matrix, Vector

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
RADIUS = 0.8
SEGMENTS, RINGS = 48, 24   # ~1,100 tiles
GROUT = 0.005              # gap between tiles
TILT = 5.0                 # degrees each tile is knocked askew (at random, the same every build): the sparkle
ROD = 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return m


mirror = material('Mirror', (0.92, 0.93, 0.96), 1.0, 0.03)
grout = material('Grout', (0.015, 0.015, 0.02), 0.2, 0.9)
metal = material('Fitting', (0.25, 0.25, 0.28), 0.9, 0.3)

bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=SEGMENTS, v_segments=RINGS, radius=RADIUS)
# Each face becomes a tile: inset it, and the inset border is the grout. Tiles stay flat (flat shading below).
faces = bm.faces[:]
res = bmesh.ops.inset_individual(bm, faces=faces, thickness=GROUT, depth=0.0, use_even_offset=True)
tiles = set(faces)
# Knock each tile slightly askew about its own centre, so neighbouring tiles catch light differently.
rng = random.Random(7)
for f in faces:
    c = f.calc_center_median()
    axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
    axis = axis - f.normal * axis.dot(f.normal)   # tilt about an axis in the tile's own plane
    if axis.length < 1e-6:
        continue
    rot = Matrix.Rotation(math.radians(rng.uniform(-TILT, TILT)), 3, axis.normalized())
    for v in f.verts:
        v.co = c + rot @ (v.co - c)
for f in bm.faces:
    f.material_index = 0 if f in tiles else 1
    f.smooth = False
me = bpy.data.meshes.new('DiscoBall')
bm.to_mesh(me)
bm.free()
me.materials.append(mirror)
me.materials.append(grout)
ball = bpy.data.objects.new('DiscoBall', me)
bpy.context.scene.collection.objects.link(ball)

# Cap on top, and the rod up to the ceiling.
def cylinder(name, radius, depth, z, mat):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z))
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m)
    bm.free()
    m.materials.append(mat)
    ob = bpy.data.objects.new(name, m)
    bpy.context.scene.collection.objects.link(ob)
    return ob

cylinder('Cap', 0.12, 0.1, RADIUS + 0.03, metal)
cylinder('Rod', 0.025, ROD, RADIUS + 0.08 + ROD / 2, metal)

bpy.ops.object.select_all(action='SELECT')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'disco_ball.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', 'tris', sum(len(p.vertices) - 2 for o in bpy.data.objects for p in o.data.polygons))
