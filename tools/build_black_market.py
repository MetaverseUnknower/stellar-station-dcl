# Builds the black market's back room (src/blackMarket/room.ts): a sealed obsidian chamber against the lounge's dome,
# next to the Space Bar, past the pillar at the bar's end, where an unregistered relay talks to the Eld (a Kardashev
# III civilisation that grants favours for MANA). Four models:
#   black_market_room.glb    glossy black walls and ceiling with violet light seams, a glass-black floor with rings
#                            of light under the relay, and a door frame
#   black_market_field.glb   the energy field across the doorway (no collision: walk through it)
#   black_market_relay.glb   the relay's pedestal: a tapered hexagonal column with a dish on top
#   black_market_ring.glb    one ring (1 m radius, at the origin, round Blender Z); room.ts scales and spins three of
#                            them round the relay's core, a glowing sphere it draws itself
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_black_market.py -- assets/models
#
# The room, field and relay are built in place round the hub's centre (the origin), with the lounge floor at z 0, at
# Blender angles: the explorer shows Blender angle A at scene angle A + 180, so room.ts places them at the hub's
# centre, unturned. The room spans scene 190.5..204 degrees (Blender 10.5..24): plain hull (Wall 03), between the
# east lift's landing at 180 and the pillar at 205..210; the bar runs 219..251. Radii and angles here must match
# room.ts.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
A0, A1 = math.radians(10.5), math.radians(24.0)   # the room's sides
R_FRONT, T = 22.8, 0.15                          # the front wall (hub side) and wall thickness
H = 3.0                                          # ceiling height
# The dome here (a raycast of station.glb, scene 190..200): 28.7 m out at 0.5 m up, 28.1 at 1.5, 27.4 at 2.5, 26.5
# at 3.5. The side walls and ceiling run a little into the hull (2.8 m thick), so there is never a gap to see through.
R_BACK_FLOOR, R_BACK_TOP = 29.2, 27.8
DOOR_W, DOOR_H = 1.4, 2.4
DOOR_SIDE_GAP = 0.5                              # from the bar-side wall to the doorway
RELAY_A, RELAY_R = math.radians(17.25), 26.0     # the relay, in the room's middle
PEDESTAL_H = 1.1
SEG = 24

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


OBSIDIAN = mat('Obsidian', (0.015, 0.012, 0.022), 0.9, 0.18)
GLASS_FLOOR = mat('GlassFloor', (0.01, 0.008, 0.016), 0.6, 0.08)
SEAM = mat('Seam', (0.55, 0.3, 1.0), 0.0, 0.3, emit=2.2)
SEAM_CYAN = mat('SeamCyan', (0.3, 0.85, 1.0), 0.0, 0.3, emit=2.0)
FRAME = mat('Frame', (0.04, 0.035, 0.06), 1.0, 0.25)
FIELD = mat('Field', (0.45, 0.25, 1.0), 0.0, 0.1, emit=1.4, alpha=0.28)
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


def arc_wall(bm, r0, r1, a0, a1, z0, z1, seg=SEG):
    """A curved slab r0..r1 out, a0..a1 round, z0..z1 up (a solid, closed)."""
    rings = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        rings.append([bm.verts.new(polar(r, a, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    for i in range(seg):
        p, q = rings[i], rings[i + 1]
        for k in range(4):
            bm.faces.new((p[k], q[k], q[(k + 1) % 4], p[(k + 1) % 4]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


def side_wall(bm, a, sign):
    """A radial wall at angle a, T thick toward the room (sign +1: the room is at larger angles), from the front
    wall to past the dome: a trapezoid, deeper at the floor, where the dome is further out."""
    n = Vector((-math.sin(a), math.cos(a), 0)) * sign * T
    base = [polar(R_FRONT, a, 0), polar(R_BACK_FLOOR, a, 0)]
    top = [polar(R_FRONT, a, H + 0.12), polar(R_BACK_TOP, a, H + 0.12)]
    quad_solid(bm, [base[0], base[1], base[1] + n, base[0] + n, top[0], top[1], top[1] + n, top[0] + n])


def box(bm, centre, size, rot=0.0):
    """A box at centre (x, y, z of its middle), size (dx, dy, dz), turned rot about Z."""
    m = Matrix.Translation(centre) @ Matrix.Rotation(rot, 4, 'Z')
    hx, hy, hz = (s / 2 for s in size)
    corners = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    quad_solid(bm, [m @ Vector(c) for c in corners])


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


ONE_SIDED = ('Liner',)


def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.all_objects:
        o.select_set(True)
        if o.name in ONE_SIDED:
            continue   # a sheet: recalculating could turn it away from the room
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(o.data)
        bm.free()
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True)
    print('WROTE', path)


door_a1 = A1 - (T + DOOR_SIDE_GAP) / R_FRONT
door_a0 = door_a1 - DOOR_W / R_FRONT
IN = R_FRONT + T                        # the front wall's inside face
ia0, ia1 = A0 + T / IN, A1 - T / IN     # the side walls' inside faces, as angles at the front

# ── The room ──
room = new_coll('Room')
bm = bmesh.new()
arc_wall(bm, R_FRONT, IN, A0, door_a0, 0, H + 0.12, 20)
arc_wall(bm, R_FRONT, IN, door_a1, A1, 0, H + 0.12, 3)
arc_wall(bm, R_FRONT, IN, door_a0, door_a1, DOOR_H, H + 0.12, 4)
side_wall(bm, A0, 1)
side_wall(bm, A1, -1)
arc_wall(bm, R_FRONT, R_BACK_TOP, A0, A1, H, H + 0.12, SEG)   # ceiling
obj(room, 'Walls', bm, OBSIDIAN)

bm = bmesh.new()
arc_wall(bm, IN, 28.9, ia0, ia1, 0.0, 0.006, SEG)
obj(room, 'Floor', bm, GLASS_FLOOR)

# A liner over the dome's surface at the back, 35 cm in from it (the dome bulges between the samples), so the whole chamber is black (a sheet facing the
# room; its profile is the dome's, from the raycast above)
LINER = ((28.35, 0.0), (28.3, 0.5), (27.75, 1.5), (27.05, 2.5), (26.65, H))
bm = bmesh.new()
grid = [[bm.verts.new(polar(r, ia0 + (ia1 - ia0) * i / SEG, z)) for r, z in LINER] for i in range(SEG + 1)]
for i in range(SEG):
    for k in range(len(LINER) - 1):
        bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))   # facing the hub centre
obj(room, 'Liner', bm, OBSIDIAN)

# Light seams: a line round the room just above the floor and one under the ceiling, and verticals on the front wall
bm = bmesh.new()
for z in (0.12, H - 0.14):
    for a0, a1, seg in ((ia0, door_a0 - 0.004, 16), (door_a1 + 0.004, ia1, 2)):
        arc_wall(bm, IN + 0.003, IN + 0.012, a0, a1, z, z + 0.025, seg)
    for a, sign in ((A0, 1), (A1, -1)):
        n = Vector((-math.sin(a), math.cos(a), 0)) * sign
        far = 28.3 if z < 1 else 26.7   # to the liner
        c = polar((IN + far) / 2, a, z + 0.0125) + n * (T + 0.008)
        box(bm, c, (far - IN, 0.009, 0.025), a)
for k in range(1, 5):
    a = ia0 + (door_a0 - ia0) * k / 5
    arc_wall(bm, IN + 0.003, IN + 0.012, a, a + 0.012 / IN, 0.12, H - 0.14, 1)
obj(room, 'Seams', bm, SEAM)

# Rings of light on the floor under the relay
bm = bmesh.new()
annulus(bm, polar(RELAY_R, RELAY_A), 0.95, 1.0, 0.006, 0.012)
annulus(bm, polar(RELAY_R, RELAY_A), 1.25, 1.27, 0.006, 0.012)
obj(room, 'FloorRing', bm, SEAM_CYAN)

# Door frame: sleek jambs and lintel, with a violet edge inside the opening
mid = (door_a0 + door_a1) / 2
bm = bmesh.new()
for a, out in ((door_a0, -1), (door_a1, 1)):
    d = Vector((-math.sin(a), math.cos(a), 0)) * 0.06 * out
    box(bm, polar(R_FRONT + T / 2, a, DOOR_H / 2) + d, (T + 0.1, 0.12, DOOR_H), a)
box(bm, polar(R_FRONT + T / 2, mid, DOOR_H + 0.06), (T + 0.1, DOOR_W + 0.24, 0.12), mid)
obj(room, 'DoorFrame', bm, FRAME)
bm = bmesh.new()
for a in (door_a0, door_a1):
    box(bm, polar(R_FRONT + T / 2, a, DOOR_H / 2), (T + 0.02, 0.02, DOOR_H - 0.02), a)
box(bm, polar(R_FRONT + T / 2, mid, DOOR_H - 0.005), (T + 0.02, DOOR_W, 0.02), mid)
obj(room, 'DoorEdge', bm, SEAM)
export(room, 'black_market_room.glb')

# ── The energy field across the doorway ──
field = new_coll('Field')
bm = bmesh.new()
arc_wall(bm, R_FRONT + T / 2 - 0.004, R_FRONT + T / 2 + 0.004, door_a0, door_a1, 0.0, DOOR_H, 6)
obj(field, 'Field', bm, FIELD)
export(field, 'black_market_field.glb')

# ── The relay's pedestal ──
relay = new_coll('Relay')
base = polar(RELAY_R, RELAY_A)
turn = Matrix.Rotation(RELAY_A, 4, 'Z')
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.34, radius2=0.16, depth=PEDESTAL_H,
                      matrix=Matrix.Translation(base + Vector((0, 0, PEDESTAL_H / 2))) @ turn)
bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.2, radius2=0.3, depth=0.07,
                      matrix=Matrix.Translation(base + Vector((0, 0, PEDESTAL_H + 0.035))) @ turn)
obj(relay, 'Pedestal', bm, PEDESTAL)
bm = bmesh.new()
# Light lines up the column's six edges, and round the dish
for k in range(6):
    a = RELAY_A + k * math.pi / 3
    lo = base + Vector((math.cos(a) * 0.345, math.sin(a) * 0.345, 0.05))
    hi = base + Vector((math.cos(a) * 0.165, math.sin(a) * 0.165, PEDESTAL_H - 0.02))
    d = hi - lo
    m = Matrix.Translation((lo + hi) / 2) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(-math.atan2(d.xy.length, d.z), 4, 'Y')
    hx, hz = 0.012, d.length / 2
    quad_solid(bm, [m @ Vector(c) for c in ((-hx, -hx, -hz), (hx, -hx, -hz), (hx, hx, -hz), (-hx, hx, -hz),
                                           (-hx, -hx, hz), (hx, -hx, hz), (hx, hx, hz), (-hx, hx, hz))])
annulus(bm, base, 0.29, 0.31, PEDESTAL_H + 0.07, PEDESTAL_H + 0.08, 36)
obj(relay, 'PedestalLight', bm, SEAM)
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

core = base + Vector((0, 0, 1.55))
print('DOOR scene angles', round(math.degrees(door_a0) + 180, 3), round(math.degrees(door_a1) + 180, 3))
print('CORE (blender)', tuple(round(v, 3) for v in core))
