# Builds the black market's back room (src/blackMarket/room.ts): a grimy lean-to against the lounge's dome, next to
# the Space Bar, past the pillar at the bar's end. Three models:
#   black_market_room.glb      the walls (the pillar is its bar-side wall's neighbour), ceiling, a stained floor,
#                              crates, a bare bulb on its flex, a door frame
#   black_market_curtain.glb   a strip curtain across the doorway (no collision: walk through it)
#   black_market_terminal.glb  the terminal: a battered cabinet, a cracked screen, a keyboard shelf, cables
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_black_market.py -- assets/models
#
# Built in place round the hub's centre (the origin), with the lounge floor at z 0, at Blender angles: the explorer
# shows Blender angle A at scene angle A + 180, so room.ts places all three at the hub's centre, unturned. The room
# spans scene 190.5..204 degrees (Blender 10.5..24): plain hull (Wall 03), between the east lift's landing at 180 and
# the pillar at 205..210; the bar runs 219..251. Radii and angles here must match room.ts.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
A0, A1 = math.radians(10.5), math.radians(24.0)   # the room's sides
R_FRONT, T = 22.8, 0.15                          # the front wall (hub side) and wall thickness
H = 3.0                                          # ceiling height
# The dome here (a raycast of station.glb, scene 190..200): 28.7 m out at 0.5 m up, 28.1 at 1.5, 27.4 at 2.5, 26.5
# at 3.5. The side walls and ceiling run a little into the hull (2.8 m thick), so there is never a gap to see through.
R_BACK_FLOOR, R_BACK_TOP = 29.2, 27.8
DOOR_W, DOOR_H = 1.3, 2.3
DOOR_SIDE_GAP = 0.5                              # from the bar-side wall to the doorway
TERMINAL_A = math.radians(17.25)                 # the room's middle
TERMINAL_R = 27.55                               # the cabinet's centre (the dome is ~28.0 m out at its top)
BULB_A, BULB_R = math.radians(15.5), 25.6
SEG = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)


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


GRIME = mat('Grime', (0.075, 0.07, 0.065), 0.5, 0.85)
GRIME_IN = mat('GrimeInside', (0.11, 0.085, 0.08), 0.35, 0.9)
RUST = mat('Rust', (0.24, 0.1, 0.045), 0.4, 0.8)
STAIN = mat('Stain', (0.04, 0.035, 0.03), 0.1, 0.95)
CRATE = mat('Crate', (0.16, 0.19, 0.12), 0.2, 0.8)
CRATE_EDGE = mat('CrateEdge', (0.35, 0.3, 0.12), 0.7, 0.5)
FRAME = mat('DoorFrame', (0.2, 0.18, 0.16), 0.8, 0.4)
HAZARD = mat('Hazard', (0.85, 0.6, 0.05), 0.2, 0.6)
BULB = mat('Bulb', (1.0, 0.55, 0.25), 0.0, 0.3, emit=6.0)
FLEX = mat('Flex', (0.02, 0.02, 0.02), 0.0, 0.7)
CURTAIN = mat('Curtain', (0.1, 0.12, 0.1), 0.0, 0.35, alpha=0.82)
CASE = mat('Case', (0.13, 0.13, 0.14), 0.6, 0.5)
CASE_DARK = mat('CaseDark', (0.05, 0.05, 0.055), 0.4, 0.6)
SCREEN = mat('Screen', (0.01, 0.09, 0.03), 0.0, 0.2, emit=0.6)
CRACK = mat('Crack', (0.55, 0.9, 0.6), 0.0, 0.2, emit=2.0)
KEYS = mat('Keys', (0.22, 0.21, 0.19), 0.1, 0.7)
LED = mat('Led', (1.0, 0.1, 0.1), 0.0, 0.3, emit=5.0)
CABLE = mat('Cable', (0.03, 0.03, 0.035), 0.0, 0.6)


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


ONE_SIDED = ('Screen', 'Cracks')


def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.all_objects:
        o.select_set(True)
    for o in coll.all_objects:
        if o.name in ONE_SIDED:
            continue   # a single face: recalculating could turn it away from the viewer
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(o.data)
        bm.free()
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True)
    print('WROTE', path)


# ── The room ──
room = new_coll('Room')

# Front wall, hub side, with the doorway near the bar-side wall (A1)
door_a1 = A1 - (T + DOOR_SIDE_GAP) / R_FRONT
door_a0 = door_a1 - DOOR_W / R_FRONT
bm = bmesh.new()
arc_wall(bm, R_FRONT, R_FRONT + T, A0, door_a0, 0, H + 0.12, 20)
arc_wall(bm, R_FRONT, R_FRONT + T, door_a1, A1, 0, H + 0.12, 3)
arc_wall(bm, R_FRONT, R_FRONT + T, door_a0, door_a1, DOOR_H, H + 0.12, 4)
side_wall(bm, A0, 1)
side_wall(bm, A1, -1)
obj(room, 'Walls', bm, GRIME)

# The walls' insides: a warmer, dirtier skin 1 cm in, so the room reads different from the lounge
bm = bmesh.new()
arc_wall(bm, R_FRONT + T + 0.005, R_FRONT + T + 0.01, A0 + T / R_FRONT, door_a0, 0.02, H, 20)
arc_wall(bm, R_FRONT + T + 0.005, R_FRONT + T + 0.01, door_a1, A1 - T / R_FRONT, 0.02, H, 3)
arc_wall(bm, R_FRONT + T + 0.005, R_FRONT + T + 0.01, door_a0, door_a1, DOOR_H, H, 4)
obj(room, 'WallsInside', bm, GRIME_IN)

# Ceiling
bm = bmesh.new()
arc_wall(bm, R_FRONT, R_BACK_TOP, A0, A1, H, H + 0.12, SEG)
obj(room, 'Ceiling', bm, GRIME)

# A stained floor over the lounge's, and rust streaks down the front wall's inside
bm = bmesh.new()
arc_wall(bm, R_FRONT + T, 28.9, A0 + T / R_FRONT, A1 - T / R_FRONT, 0.0, 0.006, SEG)
obj(room, 'Floor', bm, STAIN)
bm = bmesh.new()
for a, w, h in ((12.2, 0.12, 1.4), (13.9, 0.08, 2.1), (18.3, 0.1, 0.9)):
    ar = math.radians(a)
    arc_wall(bm, R_FRONT + T + 0.011, R_FRONT + T + 0.016, ar, ar + w / R_FRONT, H - h, H - 0.02, 2)
obj(room, 'RustStreaks', bm, RUST)

# Door frame (both faces) and hazard stripes on the sill
bm = bmesh.new()
for a, out in ((door_a0, -1), (door_a1, 1)):
    d = Vector((-math.sin(a), math.cos(a), 0)) * 0.05 * out   # centred just outside the opening
    box(bm, polar(R_FRONT + T / 2, a, DOOR_H / 2) + d, (T + 0.08, 0.1, DOOR_H), a)
mid = (door_a0 + door_a1) / 2
box(bm, polar(R_FRONT + T / 2, mid, DOOR_H + 0.05), (T + 0.08, DOOR_W + 0.2, 0.1), mid)
obj(room, 'DoorFrame', bm, FRAME)
bm = bmesh.new()
for i in range(6):
    a = door_a0 + (door_a1 - door_a0) * (i + 0.5) / 6
    box(bm, polar(R_FRONT + T / 2, a, 0.012), (T + 0.1, 0.1, 0.024), a + math.radians(35))
obj(room, 'Hazard', bm, HAZARD)

# Crates stacked in the far corner (A0 side, against the dome)
bm_c, bm_e = bmesh.new(), bmesh.new()
for r, a, z, s, rot in ((26.9, 11.9, 0, 0.8, 4), (26.9, 11.9, 0.8, 0.62, -9), (25.9, 12.2, 0, 0.7, 12), (27.0, 14.4, 0, 0.55, -3)):
    ar = math.radians(a)
    c = polar(r, ar, z + s / 2)
    box(bm_c, c, (s, s, s), ar + math.radians(rot))
    for dz in (-s / 2 + 0.03, s / 2 - 0.03):
        box(bm_e, c + Vector((0, 0, dz)), (s + 0.02, s + 0.02, 0.05), ar + math.radians(rot))
obj(room, 'Crates', bm_c, CRATE)
obj(room, 'CrateBands', bm_e, CRATE_EDGE)

# A bare bulb on its flex (room.ts puts a flickering light here)
bm = bmesh.new()
bulb = polar(BULB_R, BULB_A, H - 0.75)
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.07, matrix=Matrix.Translation(bulb))
obj(room, 'Bulb', bm, BULB)
bm = bmesh.new()
box(bm, bulb + Vector((0, 0, 0.4)), (0.012, 0.012, 0.7), 0)
box(bm, bulb + Vector((0, 0, 0.09)), (0.05, 0.05, 0.06), 0)
obj(room, 'Flex', bm, FLEX)

export(room, 'black_market_room.glb')

# ── The curtain ──
curtain = new_coll('Curtain')
bm = bmesh.new()
strips = 9
for i in range(strips):
    a = door_a0 + (door_a1 - door_a0) * (i + 0.5) / strips
    w = DOOR_W / strips * 0.94
    jitter = random.uniform(-0.04, 0.04)
    length = DOOR_H - 0.06 - random.uniform(0.0, 0.25)
    c = polar(R_FRONT + T / 2 + jitter, a, DOOR_H - length / 2)
    box(bm, c, (0.006, w, length), a + random.uniform(-0.12, 0.12))
obj(curtain, 'Strips', bm, CURTAIN)
export(curtain, 'black_market_curtain.glb')

# ── The terminal ── built facing -X (toward the hub centre) at the origin, then moved into place
terminal = new_coll('Terminal')
place = Matrix.Translation(polar(TERMINAL_R, TERMINAL_A)) @ Matrix.Rotation(TERMINAL_A, 4, 'Z')


def part(name, m, build):
    bm = bmesh.new()
    build(bm)
    bm.transform(place)
    obj(terminal, name, bm, m)


# Local frame: x out toward the dome (the front is at -x), y across, z up. 0.8 wide, 0.6 deep.
FRONT = -0.3
part('Base', CASE, lambda bm: box(bm, Vector((0, 0, 0.5)), (0.6, 0.8, 1.0)))
part('Kick', CASE_DARK, lambda bm: box(bm, Vector((FRONT + 0.02, 0, 0.05)), (0.06, 0.82, 0.1)))


def head(bm):
    # The monitor housing: deeper at the bottom, leaning back
    quad_solid(bm, [Vector(c) for c in (
        (FRONT + 0.02, -0.4, 1.12), (0.3, -0.4, 1.12), (0.3, 0.4, 1.12), (FRONT + 0.02, 0.4, 1.12),
        (FRONT + 0.14, -0.4, 1.9), (0.3, -0.4, 1.9), (0.3, 0.4, 1.9), (FRONT + 0.14, 0.4, 1.9))])


part('Head', CASE, head)
# The screen, set into the leaning face; its plane is room.ts's SCREEN_* (text goes on it there)
lean = math.atan2(0.12, 0.78)
SCREEN_C = Vector((FRONT + 0.02 + 0.12 * (1.51 - 1.12) / 0.78 - 0.004, 0, 1.51))


def screen(bm):
    m = Matrix.Translation(SCREEN_C) @ Matrix.Rotation(lean, 4, "Y")
    v = [bm.verts.new(m @ Vector(c)) for c in ((0, -0.3, -0.26), (0, -0.3, 0.26), (0, 0.3, 0.26), (0, 0.3, -0.26))]
    bm.faces.new(v)


part('Screen', SCREEN, screen)


def cracks(bm):
    m = Matrix.Translation(SCREEN_C + Vector((-0.003, 0, 0))) @ Matrix.Rotation(lean, 4, "Y")
    # A spider crack from the lower-left, thin quads along each line
    origin = Vector((0, -0.19, -0.12))
    for ang, ln in ((20, 0.3), (65, 0.22), (-15, 0.26), (110, 0.13), (160, 0.1), (-60, 0.1)):
        a = math.radians(ang)
        tip = origin + Vector((0, math.cos(a) * ln, math.sin(a) * ln))
        side = Vector((0, -math.sin(a), math.cos(a))) * 0.0025
        v = [bm.verts.new(m @ p) for p in (origin + side, tip + side, tip - side, origin - side)]   # facing -x
        bm.faces.new(v)


part('Cracks', CRACK, cracks)
part('Shelf', CASE_DARK, lambda bm: box(bm, Vector((FRONT - 0.13, 0, 1.0)), (0.34, 0.78, 0.05)))
part('Keyboard', KEYS, lambda bm: box(bm, Vector((FRONT - 0.15, 0, 1.04)), (0.2, 0.56, 0.03), math.radians(3)))
part('Led', LED, lambda bm: box(bm, Vector((FRONT + 0.11, 0.33, 1.84)), (0.02, 0.03, 0.03)))


def cables(bm):
    # Three cables from the base's side, along the floor and up into the dome
    for k, y in enumerate((-0.25, 0.0, 0.22)):
        pts = [Vector((0.3, y, 0.2 + 0.1 * k)), Vector((0.45, y + 0.05, 0.02)), Vector((0.55, y - 0.1 + 0.05 * k, 0.02)),
               Vector((0.75, y - 0.2, 0.3 + 0.2 * k))]
        for p, q in zip(pts, pts[1:]):
            d = q - p
            c = (p + q) / 2
            rot = math.atan2(d.y, d.x)
            m = Matrix.Translation(c) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Rotation(-math.atan2(d.z, d.xy.length), 4, 'Y')
            hx, h = d.length / 2 + 0.01, 0.012
            quad_solid(bm, [m @ Vector(c) for c in ((-hx, -h, -h), (hx, -h, -h), (hx, h, -h), (-hx, h, -h), (-hx, -h, h), (hx, -h, h), (hx, h, h), (-hx, h, h))])


part('Cables', CABLE, cables)
export(terminal, 'black_market_terminal.glb')

# For room.ts
sc = place @ SCREEN_C
print('DOOR scene angles', round(math.degrees(door_a0) + 180, 3), round(math.degrees(door_a1) + 180, 3))
print('SCREEN centre (blender)', tuple(round(v, 3) for v in sc), 'lean', round(math.degrees(lean), 2))
print('BULB (blender)', tuple(round(v, 3) for v in bulb))
