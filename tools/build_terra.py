# Builds assets/models/terra.glb: the inside of Terra, the station's Earth room. A painted sky (clouds and a sun) on
# a shell just inside the pod's hull hides the station entirely; a ring of rolling hills stands in front of it; the
# floor is a lawn with a pond in the middle, trees round the edge, flowerbeds, grass tufts, a stepping-stone path from
# the door, and two park benches (src/terra/terra.ts seats players on them).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_terra.py -- assets/models
#
# Built in the pod's own frame: its centre at the origin, the floor at z 0, the doorway toward -X (the hub). Sizes
# come from raycasts of the built pod (build_station_models.py TERRA_*, kit at 0.6): the hull's inner radius by
# height (HULL), flat floor out to 9 m, the ceiling at ~11 m. The textures are generated here, not loaded.
import bpy, bmesh, math, os, random, struct, sys, tempfile, zlib
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
# The hull's inner radius by height, less 0.35 m: the sky shell's profile (z, r), closed at the top.
SHELL = [(0.0, 8.95), (4.4, 8.95), (5.0, 8.9), (6.0, 8.6), (7.0, 8.1), (8.0, 7.6), (9.0, 6.75), (10.0, 5.6),
         (10.5, 4.6), (10.75, 2.5), (10.8, 0.0)]
DOOR_HALF = math.radians(17)   # the doorway's half-width round the shell (door 4 m wide at ~9 m, with margin)
DOOR_TOP = 4.0                 # the shell is open below this in the doorway's sector
HILLS_R, HILLS_TOP = 8.7, 3.4
LAWN_R = 9.1
POND_R = 2.3
LAWN_Z = 0.06   # the lawn's height over the deck: well clear of it, or the deck flickers through at a distance
SEG = 96
rng = random.Random(11)
BENCHES = [(4.0, 90), (4.0, 270)]   # (r, degrees) round the pod; src/terra/terra.ts seats players on them

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene.collection
TMP = tempfile.mkdtemp()


# ---- textures ------------------------------------------------------------------------------------------------

def write_png(path, w, h, pixels, alpha=False):
    """pixels: rows top to bottom of (r, g, b[, a]) in 0..1."""
    ch = 4 if alpha else 3
    raw = b''.join(b'\x00' + bytes(max(0, min(255, int(c * 255 + 0.5))) for px in row for c in px[:ch]) for row in pixels)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if alpha else 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)


def value_noise(seed, cells):
    r = random.Random(seed)
    grid = [[r.random() for _ in range(cells)] for _ in range(cells)]
    def at(u, v):  # tileable in u and v over 0..1
        x, y = u * cells, v * cells
        x0, y0 = int(math.floor(x)) % cells, int(math.floor(y)) % cells
        x1, y1 = (x0 + 1) % cells, (y0 + 1) % cells
        fx, fy = x - math.floor(x), y - math.floor(y)
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = grid[y0][x0] + (grid[y0][x1] - grid[y0][x0]) * sx
        b = grid[y1][x0] + (grid[y1][x1] - grid[y1][x0]) * sx
        return a + (b - a) * sy
    return at


def fbm(fns, u, v):
    return sum(f(u, v) * (0.5 ** i) for i, f in enumerate(fns)) / sum(0.5 ** i for i in range(len(fns)))


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def sky_texture():
    """u round the room, v up the shell (0 = floor, 1 = top): a gradient from a hazy horizon to deep blue, soft
    clouds in the middle band, and a sun."""
    w, h = 512, 256
    octaves = [value_noise(100 + i, 4 * 2 ** i) for i in range(4)]
    horizon, mid, top = (0.82, 0.9, 0.97), (0.5, 0.72, 0.95), (0.28, 0.5, 0.9)
    sun_u, sun_v = 0.3, 0.72
    rows = []
    for j in range(h):
        v = 1 - j / (h - 1)
        base = lerp3(horizon, mid, min(1, v / 0.45)) if v < 0.45 else lerp3(mid, top, (v - 0.45) / 0.55)
        row = []
        for i in range(w):
            u = i / w
            c = base
            band = max(0.0, 1 - abs(v - 0.55) / 0.3)   # clouds between ~0.25 and ~0.85
            n = fbm(octaves, u, v * 0.5)
            cloud = max(0.0, (n - 0.52) * 3.2) * band
            c = lerp3(c, (1, 1, 1), min(1, cloud))
            du = min(abs(u - sun_u), 1 - abs(u - sun_u)) * 2.2   # the shell is wider than tall
            d = math.hypot(du, v - sun_v)
            if d < 0.035:
                c = (1, 0.98, 0.9)
            elif d < 0.16:
                c = lerp3(c, (1, 0.96, 0.8), (1 - (d - 0.035) / 0.125) ** 2 * 0.8)
            row.append(c)
        rows.append(row)
    path = os.path.join(TMP, 'terra_sky.png')
    write_png(path, w, h, rows)
    return path


def hills_texture():
    """u round the room (twice round the texture), v up the band: three ranges of hills, far and hazy blue to near
    and green, transparent above them."""
    w, h = 1024, 128
    ranges = [  # (base height, amplitude, frequencies, colour)
        (0.52, 0.2, (2, 5, 11), (0.55, 0.68, 0.8)),  # peaks stay under the band's top (max ~0.72)
        (0.42, 0.2, (3, 7, 13), (0.36, 0.58, 0.45)),
        (0.2, 0.16, (4, 9, 17), (0.25, 0.5, 0.25)),
    ]
    phases = [[rng.random() * 6.28 for _ in range(3)] for _ in ranges]
    heights = []
    for k, (base, amp, freqs, _) in enumerate(ranges):
        col = []
        for i in range(w):
            u = i / w
            y = base + amp * sum(math.sin(2 * math.pi * f * u + phases[k][n]) / (n + 1) for n, f in enumerate(freqs)) / 1.8
            col.append(y)
        heights.append(col)
    rows = []
    for j in range(h):
        v = 1 - j / (h - 1)
        row = []
        for i in range(w):
            px = (0, 0, 0, 0)
            for k in range(len(ranges)):   # far to near: nearer ranges paint over
                if v <= heights[k][i]:
                    shade = 0.85 + 0.15 * (v / max(heights[k][i], 0.01))
                    c = ranges[k][3]
                    px = (c[0] * shade, c[1] * shade, c[2] * shade, 1)
            row.append(px)
        rows.append(row)
    path = os.path.join(TMP, 'terra_hills.png')
    write_png(path, w, h, rows, alpha=True)
    return path


def grass_texture():
    w = h = 256
    octaves = [value_noise(200 + i, 8 * 2 ** i) for i in range(4)]
    blades = random.Random(5)
    rows = []
    for j in range(h):
        row = []
        for i in range(w):
            n = fbm(octaves, i / w, j / h)
            g = lerp3((0.16, 0.36, 0.1), (0.36, 0.6, 0.18), n)
            if blades.random() < 0.08:
                g = lerp3(g, (0.5, 0.75, 0.25), 0.5)
            row.append(g)
        rows.append(row)
    path = os.path.join(TMP, 'terra_grass.png')
    write_png(path, w, h, rows)
    return path


# ---- materials ---------------------------------------------------------------------------------------------------

def material(name, rgb=(1, 1, 1), metallic=0.0, roughness=0.8, image=None, emit=0.0, clip=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    emission = 'Emission Color' if 'Emission Color' in b.inputs else 'Emission'
    if image:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        tex.image.pack()
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
        if emit:
            nt.links.new(tex.outputs['Color'], b.inputs[emission])
        if clip:
            nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
            m.blend_method = 'CLIP'
            m.alpha_threshold = 0.5
    elif emit:
        b.inputs[emission].default_value = (*rgb, 1)
    if emit:
        b.inputs['Emission Strength'].default_value = emit
    return m


SKY = material('TerraSky', image=sky_texture(), emit=1.0, roughness=1)
HILLS = material('TerraHills', image=hills_texture(), emit=0.8, roughness=1, clip=True)
GRASS = material('Lawn', image=grass_texture(), roughness=0.95)
BARK = material('Bark', (0.3, 0.19, 0.11), roughness=0.9)
LEAVES = [material(f'Leaves{i}', c, roughness=0.85) for i, c in enumerate([(0.2, 0.5, 0.18), (0.28, 0.58, 0.2), (0.16, 0.42, 0.2)])]
PINE = material('Pine', (0.12, 0.34, 0.2), roughness=0.85)
WATER = material('Pond', (0.12, 0.35, 0.5), metallic=0.3, roughness=0.05)
STONE = material('Stone', (0.55, 0.53, 0.5), roughness=0.9)
LILY = material('LilyPad', (0.22, 0.5, 0.2), roughness=0.6)
WOOD = material('BenchWood', (0.5, 0.32, 0.17), roughness=0.6)
IRON = material('BenchIron', (0.08, 0.08, 0.08), metallic=0.8, roughness=0.4)
TUFT = material('Tuft', (0.3, 0.55, 0.17), roughness=0.9)
FLOWERS = [material(f'Flower{i}', c, roughness=0.6) for i, c in enumerate(
    [(1, 0.35, 0.55), (1, 0.85, 0.2), (0.6, 0.4, 1), (1, 1, 1), (1, 0.5, 0.15)])]


# ---- geometry helpers --------------------------------------------------------------------------------------------

def link(name, bm, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    scene.objects.link(ob)
    return ob


def in_door(a, margin=0.0):
    """Whether angle a (round the pod, 0 = +X) is in the doorway's sector (toward -X)."""
    d = abs(((a - math.pi) + math.pi) % (2 * math.pi) - math.pi)
    return d < DOOR_HALF + margin


def revolve(name, profile, mat, uv_v, skip=lambda a, z: False, inward=True):
    """A surface of revolution through (z, r) profile points, UV u round and v by uv_v(z); faces facing inward."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rings = []
    for k in range(SEG + 1):
        a = 2 * math.pi * k / SEG
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for z, r in profile])
    for k in range(SEG):
        a = 2 * math.pi * (k + 0.5) / SEG
        for n in range(len(profile) - 1):
            if skip(a, (profile[n][0] + profile[n + 1][0]) / 2):
                continue
            quad = (rings[k][n], rings[k + 1][n], rings[k + 1][n + 1], rings[k][n + 1])
            if not inward:
                quad = quad[::-1]
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            for loop in f.loops:
                kk = k + (1 if loop.vert in (rings[k + 1][n], rings[k + 1][n + 1]) else 0)
                zz = loop.vert.co.z
                loop[uv].uv = (kk / SEG, uv_v(zz))
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.co.xy.length < 1e-6], dist=1e-5)
    return link(name, bm, mat, smooth=True)


def disc(name, r, z, mat, center=(0, 0), n=48, uv_scale=None):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    verts = [bm.verts.new((center[0] + r * math.cos(2 * math.pi * i / n), center[1] + r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
    f = bm.faces.new(verts)
    for loop in f.loops:
        s = uv_scale or 1
        loop[uv].uv = (loop.vert.co.x / s, loop.vert.co.y / s)
    return link(name, bm, mat)


def blob(bm, center, radius, squash=1.0, subdiv=1):
    ret = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    for v in ret['verts']:
        v.co = Vector((v.co.x * (1 + rng.uniform(-0.12, 0.12)), v.co.y * (1 + rng.uniform(-0.12, 0.12)), v.co.z * squash)) + Vector(center)


def cone(bm, base, r0, r1, height, seg=8):
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=height)
    for v in ret['verts']:
        v.co += Vector(base) + Vector((0, 0, height / 2))


def box(bm, lo, hi):
    ret = bmesh.ops.create_cube(bm, size=1)
    for v in ret['verts']:
        v.co = Vector(((lo[i] + hi[i]) / 2 + v.co[i] * (hi[i] - lo[i]) for i in range(3)))


def polar(r, deg):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a))


# ---- the room ----------------------------------------------------------------------------------------------------

# Sky and hills. The sky's UV v runs up its height; the hills go round twice.
revolve('Sky', SHELL, SKY, lambda z: z / SHELL[-1][0], skip=lambda a, z: in_door(a) and z < DOOR_TOP)
hills = revolve('Hills', [(0.0, HILLS_R), (HILLS_TOP, HILLS_R)], HILLS, lambda z: z / HILLS_TOP, skip=lambda a, z: in_door(a, 0.02))
for loop_face in hills.data.uv_layers.active.data:
    loop_face.uv[0] *= 2

# The lawn, LAWN_Z over the deck, and a pond sunk into it (drawn on top: the lawn has a hole for it).
bm = bmesh.new()
uv = bm.loops.layers.uv.new()
outer = [bm.verts.new((LAWN_R * math.cos(2 * math.pi * i / SEG), LAWN_R * math.sin(2 * math.pi * i / SEG), LAWN_Z)) for i in range(SEG)]
inner = [bm.verts.new((POND_R * math.cos(2 * math.pi * i / SEG), POND_R * math.sin(2 * math.pi * i / SEG), LAWN_Z)) for i in range(SEG)]
for i in range(SEG):
    j = (i + 1) % SEG
    f = bm.faces.new((outer[i], outer[j], inner[j], inner[i]))   # anticlockwise from above: facing up (the explorer culls back faces)
    for loop in f.loops:
        loop[uv].uv = (loop.vert.co.x / 2.5, loop.vert.co.y / 2.5)
link('Lawn', bm, GRASS)
disc('Pond', POND_R + 0.05, LAWN_Z - 0.01, WATER, n=64)
bm = bmesh.new()
for i in range(22):   # rocks round the pond's edge
    a = 2 * math.pi * i / 22 + rng.uniform(-0.05, 0.05)
    blob(bm, (math.cos(a) * (POND_R + 0.08), math.sin(a) * (POND_R + 0.08), LAWN_Z + 0.04), rng.uniform(0.18, 0.28), squash=0.45)
link('PondRocks', bm, STONE)
bm = bmesh.new()
for x, y, r in ((0.8, 0.6, 0.35), (-0.5, 1.1, 0.28), (0.2, -1.2, 0.32), (-1.1, -0.4, 0.25)):
    ret = bmesh.ops.create_circle(bm, cap_ends=True, radius=r, segments=12)
    for v in ret['verts']:
        v.co += Vector((x, y, LAWN_Z + 0.005))
link('LilyPads', bm, LILY)

# Stepping stones from the doorway (at -X) to the pond.
bm = bmesh.new()
for k, x in enumerate([-8.3, -7.3, -6.3, -5.3, -4.3, -3.3]):
    ret = bmesh.ops.create_circle(bm, cap_ends=True, radius=0.38 + rng.uniform(-0.04, 0.04), segments=10)
    for v in ret['verts']:
        v.co += Vector((x, (0.25 if k % 2 else -0.25), LAWN_Z + 0.015))
link('SteppingStones', bm, STONE)

# Trees round the edge: leafy ones and a couple of pines, clear of the path and the benches.
trees = [(6.6, 25, 'leafy', 1.0), (6.9, 75, 'pine', 1.0), (6.4, 118, 'leafy', 0.85), (6.8, 245, 'leafy', 0.95),
         (6.6, 290, 'pine', 0.9), (6.9, 330, 'leafy', 1.1), (5.2, 0, 'leafy', 0.8)]
bark, pine, colliders = bmesh.new(), bmesh.new(), bmesh.new()
leaves = [bmesh.new() for _ in LEAVES]
for r, deg, kind, s in trees:
    x, y = polar(r, deg)
    # Crowns stay under the sky shell: at 6-7 m out it's ~8 m up.
    if kind == 'leafy':
        cone(bark, (x, y, 0), 0.22 * s, 0.14 * s, 3.2 * s)
        for n in range(4):
            off = (rng.uniform(-0.7, 0.7) * s, rng.uniform(-0.7, 0.7) * s, (3.4 + rng.uniform(-0.3, 0.8)) * s)
            blob(leaves[rng.randrange(len(leaves))], (x + off[0], y + off[1], off[2]), rng.uniform(1.0, 1.4) * s, squash=0.85)
    else:
        cone(bark, (x, y, 0), 0.18 * s, 0.1 * s, 1.2 * s)
        for n, (z, rr) in enumerate([(0.9, 1.5), (2.2, 1.2), (3.4, 0.9), (4.4, 0.6)]):
            cone(pine, (x, y, z * s), rr * s, 0.05, 1.6 * s)
    box(colliders, (x - 0.3 * s, y - 0.3 * s, 0), (x + 0.3 * s, y + 0.3 * s, 2.5))
link('TreeTrunks', bark, BARK)
link('PineNeedles', pine, PINE)
for i, bm in enumerate(leaves):
    link(f'TreeLeaves{i}', bm, LEAVES[i])
link('TreeTrunks_collider', colliders, BARK)

# Flowerbeds: clusters of blossoms in drifts between the trees.
beds = [(4.6, 50), (4.9, 150), (4.7, 210), (4.5, 310), (7.4, 100), (7.5, 265)]
blossoms = [bmesh.new() for _ in FLOWERS]
for r, deg in beds:
    cx, cy = polar(r, deg)
    for n in range(26):
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0, 0.9) ** 0.7
        blob(blossoms[rng.randrange(len(FLOWERS))], (cx + math.cos(a) * d, cy + math.sin(a) * d, LAWN_Z + rng.uniform(0.18, 0.36)), rng.uniform(0.06, 0.1), squash=0.7, subdiv=1)
for i, bm in enumerate(blossoms):
    link(f'Blossoms{i}', bm, FLOWERS[i])
bm = bmesh.new()
for r, deg in beds:   # leafy mounds under the blossoms
    cx, cy = polar(r, deg)
    blob(bm, (cx, cy, LAWN_Z - 0.03), 1.0, squash=0.22, subdiv=2)
link('BedFoliage', bm, LEAVES[1])

# Grass tufts scattered over the lawn (off the path, the pond and the beds).
bm = bmesh.new()
for n in range(260):
    r, a = rng.uniform(POND_R + 0.5, LAWN_R - 0.4), rng.uniform(0, 2 * math.pi)
    x, y = r * math.cos(a), r * math.sin(a)
    if x < -2.8 and abs(y) < 0.9:
        continue
    if any(math.hypot(x - bx, y - by) < 1.4 for bx, by in (polar(br, bd) for br, bd in BENCHES)):
        continue   # clear round the benches, where players sit
    for k in range(3):
        cone(bm, (x + rng.uniform(-0.08, 0.08), y + rng.uniform(-0.08, 0.08), LAWN_Z - 0.02), 0.05, 0.0, rng.uniform(0.18, 0.32), seg=3)
link('GrassTufts', bm, TUFT)

# Park benches either side of the pond, facing it: wooden slats on iron legs. Seat 0.45 m up, 1.6 m wide.
wood, iron, benchcol = bmesh.new(), bmesh.new(), bmesh.new()
for r, deg in BENCHES:
    # Build facing +X (toward the pond from -X), then turn to face the centre.
    parts_w, parts_i = bmesh.new(), bmesh.new()
    for k in range(3):
        box(parts_w, (-0.25 + k * 0.17, -0.8, 0.43), (-0.1 + k * 0.17, 0.8, 0.47))
    for k in range(2):
        box(parts_w, (-0.32, -0.8, 0.62 + k * 0.18), (-0.28, 0.8, 0.74 + k * 0.18))
    for y in (-0.7, 0.7):
        box(parts_i, (-0.3, y - 0.03, 0), (-0.26, y + 0.03, 0.95))
        box(parts_i, (0.05, y - 0.03, 0), (0.09, y + 0.03, 0.43))
        box(parts_i, (-0.3, y - 0.03, 0.4), (0.09, y + 0.03, 0.43))
    turn = Matrix.Translation((*polar(r, deg), 0)) @ Matrix.Rotation(math.radians(deg + 180), 4, 'Z')
    for part, into in ((parts_w, wood), (parts_i, iron)):
        part.transform(turn)
        me = bpy.data.meshes.new('tmp')
        part.to_mesh(me)
        part.free()
        into.from_mesh(me)
    cb = bmesh.new()
    box(cb, (-0.32, -0.8, 0), (-0.02, 0.8, 0.47))   # stops short of the seat's front, where a sitter stands
    cb.transform(turn)
    me = bpy.data.meshes.new('tmp')
    cb.to_mesh(me)
    cb.free()
    benchcol.from_mesh(me)
link('BenchSlats', wood, WOOD)
link('BenchFrames', iron, IRON)
link('Benches_collider', benchcol, WOOD)

for ob in bpy.data.objects:
    if ob.name.endswith('_collider'):
        ob.data.materials.clear()

# The explorer draws only front faces: check the flat ground pieces face up (a Blender render shows both sides, so
# a downward lawn looks fine here and invisible in-world).
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob.name in ('Lawn', 'Pond', 'LilyPads', 'SteppingStones'):
        down = sum(1 for p in ob.data.polygons if p.normal.z < 0)
        print('FACING', ob.name, 'down' if down else 'up', down, '/', len(ob.data.polygons))
bpy.ops.object.select_all(action='SELECT')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'terra.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_image_format='AUTO')
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', 'tris', tris)
