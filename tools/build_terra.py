# Builds assets/models/terra.glb: the inside of Terra, the station's Earth room. MetaPetal's two Earth views
# (assets/images/terra-bg-1/-2) wrap a shell just inside the pod's hull, hiding the station entirely, with a sky
# overhead in their colours; the floor is a lawn with a pond in the middle, trees round the edge, flowerbeds, grass tufts, a stepping-stone path from
# the door, and two park benches (src/terra/terra.ts seats players on them).
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_terra.py -- assets/models
#
# Built in the pod's own frame: its centre at the origin, the floor at z 0, the doorway toward -X (the hub). Sizes
# come from raycasts of the built pod (build_station_models.py TERRA_*, kit at 0.6): the hull's inner radius by
# height (HULL), flat floor out to 9 m, the ceiling at ~11 m. The lawn and sky-cap textures are generated here.
import bpy, bmesh, math, os, random, struct, sys, tempfile, zlib
from mathutils import Vector, Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models')
# The hull's inner radius by height, less 0.35 m: the sky shell's profile (z, r), closed at the top. (Resampled
# every 0.5 m below, so the views spread smoothly up it.)
SHELL_POINTS = [(0.0, 8.95), (4.4, 8.95), (5.0, 8.9), (6.0, 8.6), (7.0, 8.1), (8.0, 7.6), (9.0, 6.75), (10.0, 5.6),
         (10.5, 4.6), (10.75, 2.5), (10.8, 0.0)]


def _resample(points, step, upto):
    out = []
    z = 0.0
    while z < upto:
        for (z0, r0), (z1, r1) in zip(points, points[1:]):
            if z0 <= z <= z1:
                out.append((z, r0 + (r1 - r0) * (z - z0) / (z1 - z0)))
                break
        z = round(z + step, 3)
    return out + [p for p in points if p[0] >= upto]


SHELL = _resample(SHELL_POINTS, 0.5, 10.0)
DOOR_HALF = math.radians(17)   # the doorway's half-width round the shell (door 4 m wide at ~9 m, with margin)
DOOR_TOP = 4.0                 # the shell is open below this in the doorway's sector
LAWN_R = 9.1
POND_R = 2.3
LAWN_Z = 0.06   # the lawn's height over the deck: well clear of it, or the deck flickers through at a distance
SEG = 96
rng = random.Random(11)
BENCHES = [(4.3, 90), (4.3, 270)]   # (r, degrees) round the pod, facing the pond; src/terra/terra.ts seats players on them

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


IMAGES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'images')
PANORAMA = ('terra-bg-1.jpg', 'terra-bg-2.jpg')   # MetaPetal's Earth views, each wrapped half round the room
CROP = (0.03, 0.9)             # rows kept, from the top: below 0.9 are the images' own frame and dais
TEX_W, TEX_H = 2048, 1024
SEAM = 160                     # columns blended at each join, so the two halves meet without an edge


def panorama_textures():
    """The two views, cropped and scaled to TEX_W x TEX_H, their side edges blended toward a colour shared with the
    neighbouring half (per row), so the joins don't show. Returns the two files and the sky colour at their top."""
    import numpy as np
    halves = []
    for name in PANORAMA:
        img = bpy.data.images.load(os.path.join(IMAGES, name))
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)[::-1]   # Blender stores rows bottom-up; flip to top-down
        rows = px[int(CROP[0] * h):int(CROP[1] * h)]
        # Resample to TEX_W x TEX_H (nearest-of-bilinear is plenty for a backdrop).
        ys = np.linspace(0, rows.shape[0] - 1, TEX_H)
        xs = np.linspace(0, rows.shape[1] - 1, TEX_W)
        y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
        y1, x1 = np.minimum(y0 + 1, rows.shape[0] - 1), np.minimum(x0 + 1, rows.shape[1] - 1)
        fy, fx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
        top = rows[y0][:, x0] * (1 - fx) + rows[y0][:, x1] * fx
        bot = rows[y1][:, x0] * (1 - fx) + rows[y1][:, x1] * fx
        halves.append(top * (1 - fy) + bot * fy)
    a, b = halves
    # Join 1: a's right edge meets b's left; join 2: b's right meets a's left. Each side eases to the rows' mean.
    ramp = (np.linspace(0, 1, SEAM) ** 2)[None, :, None]
    for left, right in ((a, b), (b, a)):
        meet = (left[:, -24:].mean(axis=1, keepdims=True) + right[:, :24].mean(axis=1, keepdims=True)) / 2
        left[:, -SEAM:] = left[:, -SEAM:] * (1 - ramp) + meet * ramp
        right[:, :SEAM] = right[:, :SEAM] * (1 - ramp[:, ::-1]) + meet * ramp[:, ::-1]
    # The top: fade into the sky cap's colour (the mean of both tops), so the ceiling has no edge where they meet.
    sky4 = (a[:6].mean(axis=(0, 1)) + b[:6].mean(axis=(0, 1))) / 2
    fade = int(TEX_H * 0.18)
    top_ramp = (np.linspace(1, 0, fade) ** 1.6)[:, None, None]
    for half in halves:
        half[:fade] = half[:fade] * (1 - top_ramp) + sky4[None, None, :] * top_ramp
    paths = []
    for k, half in enumerate(halves):
        out = bpy.data.images.new(f'terra_view{k + 1}', TEX_W, TEX_H)
        out.pixels.foreach_set(np.ascontiguousarray(half[::-1], dtype=np.float32).ravel())
        path = os.path.join(TMP, f'terra_view{k + 1}.jpg')
        out.filepath_raw = path
        out.file_format = 'JPEG'
        bpy.context.scene.render.image_settings.quality = 88
        out.save()
        paths.append(path)
    return paths, tuple(float(c) for c in sky4[:3])


def sky_cap_texture(horizon):
    """The ceiling above the views: from the views' own sky colour at their top edge to a deeper blue overhead."""
    zenith = (horizon[0] * 0.55, horizon[1] * 0.7, min(1.0, horizon[2] * 0.95))
    rows = [[lerp3(zenith, horizon, j / 63)] * 8 for j in range(64)]   # top row = zenith
    path = os.path.join(TMP, 'terra_skycap.png')
    write_png(path, 8, 64, rows)
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


VIEW_FILES, VIEW_SKY = panorama_textures()
VIEW_GLOW = 0.5   # enough to read as daylight; at 1 the views were glaring
VIEWS = [material(f'TerraView{k + 1}', image=f, emit=VIEW_GLOW, roughness=1) for k, f in enumerate(VIEW_FILES)]
SKY_CAP = material('TerraSkyCap', image=sky_cap_texture(VIEW_SKY), emit=VIEW_GLOW, roughness=1)
GRASS = material('Lawn', image=grass_texture(), roughness=0.95)
BARK = material('Bark', (0.3, 0.19, 0.11), roughness=0.9)
LEAVES = [material(f'Leaves{i}', c, roughness=0.85) for i, c in enumerate([(0.2, 0.5, 0.18), (0.28, 0.58, 0.2), (0.16, 0.42, 0.2)])]
PINE = material('Pine', (0.12, 0.34, 0.2), roughness=0.85)
WATER = material('Pond', (0.12, 0.35, 0.5), metallic=0.3, roughness=0.05)
STONE = material('Stone', (0.55, 0.53, 0.5), roughness=0.9)
PORTAL = material('PortalPanel', (0.07, 0.08, 0.1), metallic=0.6, roughness=0.35)
PORTAL_GLOW = material('PortalGlow', (0.75, 1.0, 0.85), emit=2.0)
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
            quad = (rings[k][n], rings[k + 1][n], rings[k + 1][n + 1], rings[k][n + 1])   # this way round faces out
            if inward:
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

# The backdrop. The views wrap the shell's walls up to VIEW_TOP, each half round the room (the first from 180 to 0
# through 90, the second on round through 270; their joins behind the doorway and the trees opposite it), their
# rows spread by distance up the shell. Above, the sky cap closes the ceiling.
VIEW_TOP = 9.0
walls = [p for p in SHELL if p[0] <= VIEW_TOP]
cap = [p for p in SHELL if p[0] >= VIEW_TOP]
run = [0.0]
for (z0, r0), (z1, r1) in zip(walls, walls[1:]):
    run.append(run[-1] + math.hypot(z1 - z0, r1 - r0))
run_at = {z: d / run[-1] for (z, _), d in zip(walls, run)}
for k, mat in enumerate(VIEWS):
    ob = revolve(f'View{k + 1}', walls, mat, lambda z: run_at[round(z, 3)] if round(z, 3) in run_at else z / VIEW_TOP,
                 skip=lambda a, z, k=k: (in_door(a) and z < DOOR_TOP) or ((math.degrees(a) % 360) < 180) != (k == 0))
    # u: seen from inside, an image runs left to right as the angle falls; each half spans 180 degrees.
    me = ob.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            ang = math.degrees(math.atan2(v.y, v.x)) % 360
            if k == 0:
                u = (180 - ang) / 180 if ang <= 180.001 else 0.0
            else:
                u = (360 - ang) / 180 if ang >= 179.999 else 1.0
                if ang < 1e-3:
                    u = 0.0
            if k == 0 and ang < 1e-3:
                u = 1.0
            me.uv_layers.active.data[li].uv = (max(0.0, min(1.0, u)), me.uv_layers.active.data[li].uv[1])
revolve('SkyCap', cap, SKY_CAP, lambda z: (z - VIEW_TOP) / (cap[-1][0] - VIEW_TOP))

# The doorway's portal: where the views open for the corridor, a dark panel stands just in front of them, and a
# sleeve runs from it back into the corridor. The sleeve's opening is the corridor's own shape (build_station_models.py
# build_corridor: TERRA_DOOR 4 x 3.6 m, 0.8 m chamfers), inset a little, and its walls are thick enough to enclose the
# corridor's end, the pod's wall and the corridor's trim there, so nothing pokes through. Doorway toward -X.
PORTAL_FACE = -8.3             # the panel's front: in front of the views (they're 8.4 m out 3.2 m to the side)
PORTAL_BACK = -10.8            # the sleeve's far end: past the pod's wall (~9.5 m) and the corridor's trim on it
PANEL_W, PANEL_H = 3.2, 4.5    # half-width and height of the panel (over the views' opening, 2.9 x 4 m)
INNER = [(-1.9, 0.0), (-1.9, 2.75), (-1.15, 3.5), (1.15, 3.5), (1.9, 2.75), (1.9, 0.0)]   # the opening (y, z)
OUTER = [(-2.7, 0.0), (-2.7, 4.35), (2.7, 4.35), (2.7, 0.0)]                             # the sleeve's outside


def resample_open(points, n):
    """n points evenly spaced along an open polyline."""
    lengths = [math.dist(a, b) for a, b in zip(points, points[1:])]
    total = sum(lengths)
    out = []
    for i in range(n):
        d = total * i / (n - 1)
        for (a, b), l in zip(zip(points, points[1:]), lengths):
            if d <= l or (a, b) == (points[-2], points[-1]):
                t = min(1.0, d / l) if l else 0
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                break
            d -= l
    return out


def ring_faces(bm, loop_a, loop_b, facing):
    """Quads between two matching loops, each turned to face along facing(centre) (the explorer draws front faces
    only, and an open shape like this is where automatic normals guess wrong)."""
    for i in range(len(loop_a) - 1):
        f = bm.faces.new((loop_a[i], loop_a[i + 1], loop_b[i + 1], loop_b[i]))
        f.normal_update()
        if f.normal.dot(facing(f.calc_center_median())) < 0:
            f.normal_flip()


def toward_axis(c):   # into the opening, from its walls
    return Vector((0, -c.y, 1.75 - c.z))


def away_from_axis(c):
    return -toward_axis(c)


N = 48
inner, outer = resample_open(INNER, N), resample_open(OUTER, N)
bm = bmesh.new()
# The sleeve: inner surface (facing the opening's axis), outer, and the far end's cap. Its near end is behind the panel.
near = PORTAL_FACE - 0.05
in_near = [bm.verts.new((near, y, z)) for y, z in inner]
in_far = [bm.verts.new((PORTAL_BACK, y, z)) for y, z in inner]
out_near = [bm.verts.new((near, y, z)) for y, z in outer]
out_far = [bm.verts.new((PORTAL_BACK, y, z)) for y, z in outer]
ring_faces(bm, in_near, in_far, toward_axis)
ring_faces(bm, out_near, out_far, away_from_axis)
ring_faces(bm, in_far, out_far, lambda c: Vector((-1, 0, 0)))   # seen from the corridor
# The panel: its front between the opening and its own edge, and its sides.
front_in = [bm.verts.new((PORTAL_FACE, y, z)) for y, z in inner]
panel = resample_open([(-PANEL_W, 0.0), (-PANEL_W, PANEL_H), (PANEL_W, PANEL_H), (PANEL_W, 0.0)], N)
front_out = [bm.verts.new((PORTAL_FACE, y, z)) for y, z in panel]
ring_faces(bm, front_out, front_in, lambda c: Vector((1, 0, 0)))   # facing the room
ring_faces(bm, front_in, in_near, toward_axis)   # the opening's lip, from the panel back to the sleeve
back_out = [bm.verts.new((PORTAL_FACE - 0.12, y, z)) for y, z in panel]
ring_faces(bm, back_out, front_out, away_from_axis)   # the panel's edge
link('Portal', bm, PORTAL)
# Sill: the floor through the sleeve, level with the lawn.
bm = bmesh.new()
box(bm, (PORTAL_BACK, -1.9, 0), (PORTAL_FACE, 1.9, LAWN_Z + 0.01))
link('PortalSill', bm, PORTAL)
# A soft glow round the opening, on the panel's face.
bm = bmesh.new()
lip = resample_open(INNER, N)
grown = resample_open([(y * 1.03 + (0.05 if y > 0 else -0.05), z + (0.05 if z > 3 else 0)) for y, z in INNER], N)
a_ = [bm.verts.new((PORTAL_FACE + 0.015, y, z)) for y, z in lip]
b_ = [bm.verts.new((PORTAL_FACE + 0.015, y, z)) for y, z in grown]
ring_faces(bm, b_, a_, lambda c: Vector((1, 0, 0)))
link('PortalGlow', bm, PORTAL_GLOW)

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
# (Clear of the windows at 90 and 270, +-32 degrees, and the door at 180.)
trees = [(6.6, 18, 'leafy', 1.0), (6.9, 48, 'pine', 1.0), (6.4, 138, 'leafy', 0.85), (6.8, 222, 'leafy', 0.95),
         (6.6, 312, 'pine', 0.9), (6.9, 342, 'leafy', 1.1), (5.0, 0, 'leafy', 0.8)]
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
    # Build facing +X, then turn to face the centre.
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
    if ob.type == 'MESH' and ob.name in ('View1', 'View2', 'SkyCap'):
        out = sum(1 for p in ob.data.polygons if p.normal.dot(Vector((p.center.x, p.center.y, 0))) > 0 and p.center.xy.length > 1)
        print('FACING', ob.name, 'OUT' if out else 'in', out, '/', len(ob.data.polygons))
    if ob.type == 'MESH' and ob.name in ('Lawn', 'Pond', 'LilyPads', 'SteppingStones'):
        down = sum(1 for p in ob.data.polygons if p.normal.z < 0)
        print('FACING', ob.name, 'down' if down else 'up', down, '/', len(ob.data.polygons))
bpy.ops.object.select_all(action='SELECT')
os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, 'terra.glb')
bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_image_format='AUTO')
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB', 'tris', tris)
