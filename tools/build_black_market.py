# Builds the Eld relay (src/blackMarket/relay.ts), which stands in the middle of the Eld's pod, the one hidden
# behind the Space Bar's back bar (build_station_models.py ELD_*; the pod is obsidian with violet light). Two models:
#   black_market_relay.glb   the pedestal: a tapered hexagonal column with a dish on top, light up its edges, and
#                            rings of light on the floor round it; origin on the floor at its centre
#   black_market_ring.glb    one ring (1 m radius, at the origin, round Blender Z); relay.ts scales and spins three of
#                            them round the relay's core, a glowing sphere it draws itself
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_black_market.py -- assets/models
#
# CORE_H (the core's height) must match relay.ts.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
PEDESTAL_H = 1.1
CORE_H = 1.55

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, metallic=0.3, roughness=0.6, emit=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emit:
        b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


SEAM = mat('Seam', (0.55, 0.3, 1.0), 0.0, 0.3, emit=2.2)
SEAM_CYAN = mat('SeamCyan', (0.3, 0.85, 1.0), 0.0, 0.3, emit=2.0)
PEDESTAL = mat('Pedestal', (0.03, 0.025, 0.045), 0.95, 0.15)
RING = mat('Ring', (0.85, 0.75, 1.0), 0.9, 0.2, emit=1.6)


def polar(r, a, z=0.0):
    return Vector((r * math.cos(a), r * math.sin(a), z))


def new_coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def obj(coll, name, bm, m):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(m)
    coll.objects.link(o)
    return o


def quad_solid(bm, corners):
    """A closed solid from 8 corners: bottom 4 then top 4, both counter-clockwise seen from above."""
    v = [bm.verts.new(c) for c in corners]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])


def annulus(bm, centre, r0, r1, z0, z1, n=48):
    """A flat ring round centre (a closed solid)."""
    rings = []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = Vector((math.cos(a), math.sin(a), 0))
        rings.append([bm.verts.new(centre + d * r + Vector((0, 0, z))) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for i in range(n):
        p, q = rings[i], rings[(i + 1) % n]
        for k in range(4):
            bm.faces.new((p[k], q[k], q[(k + 1) % 4], p[(k + 1) % 4]))


def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.all_objects:
        o.select_set(True)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(o.data)
        bm.free()
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True)
    print('WROTE', path)


# ── The relay's pedestal ──
relay = new_coll('Relay')
base = Vector((0, 0, 0))
turn = Matrix.Identity(4)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.34, radius2=0.16, depth=PEDESTAL_H,
                      matrix=Matrix.Translation(base + Vector((0, 0, PEDESTAL_H / 2))) @ turn)
bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.2, radius2=0.3, depth=0.07,
                      matrix=Matrix.Translation(base + Vector((0, 0, PEDESTAL_H + 0.035))) @ turn)
obj(relay, 'Pedestal', bm, PEDESTAL)
bm = bmesh.new()
# Light lines up the column's six edges, and round the dish
for k in range(6):
    a = k * math.pi / 3
    lo = base + Vector((math.cos(a) * 0.345, math.sin(a) * 0.345, 0.05))
    hi = base + Vector((math.cos(a) * 0.165, math.sin(a) * 0.165, PEDESTAL_H - 0.02))
    d = hi - lo
    m = Matrix.Translation((lo + hi) / 2) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(-math.atan2(d.xy.length, d.z), 4, 'Y')
    hx, hz = 0.012, d.length / 2
    quad_solid(bm, [m @ Vector(c) for c in ((-hx, -hx, -hz), (hx, -hx, -hz), (hx, hx, -hz), (-hx, hx, -hz),
                                           (-hx, -hx, hz), (hx, -hx, hz), (hx, hx, hz), (-hx, hx, hz))])
annulus(bm, base, 0.29, 0.31, PEDESTAL_H + 0.07, PEDESTAL_H + 0.08, 36)
obj(relay, 'PedestalLight', bm, SEAM)
bm = bmesh.new()
annulus(bm, base, 0.95, 1.0, 0.006, 0.012)
annulus(bm, base, 1.25, 1.27, 0.006, 0.012)
obj(relay, 'FloorRing', bm, SEAM_CYAN)
export(relay, 'black_market_relay.glb')

# ── One ring: 1 m radius round the origin's Z (Blender), a round tube ──
ring = new_coll('Ring')
bm = bmesh.new()
n, m_, minor = 96, 8, 0.035
verts = []
for i in range(n):
    a = 2 * math.pi * i / n
    row = []
    for j in range(m_):
        b = 2 * math.pi * j / m_
        r = 1 + minor * math.cos(b)
        row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
    verts.append(row)
for i in range(n):
    for j in range(m_):
        bm.faces.new((verts[i][j], verts[(i + 1) % n][j], verts[(i + 1) % n][(j + 1) % m_], verts[i][(j + 1) % m_]))
obj(ring, 'Ring', bm, RING)
export(ring, 'black_market_ring.glb')

