# Builds Terra's trees: assets/models/terra/trees/<species>_<variant>.glb. Four species, grown procedurally the way
# real trees branch (a tapering trunk splitting into branches and twigs), with clusters of leaf cards textured with
# many small leaves (alpha-tested, both sides drawn) and a bark texture each:
#   oak      a broad, rounded crown on a short, stout trunk
#   birch    slender and upright, white bark, small light leaves
#   spruce   a straight spire of drooping whorls, needle sprays
#   willow   an arching crown whose curtains of long leaves hang to the ground (for the riverbank)
# src/terra/trees.ts picks species and places them from each station's id, so every station's Terra differs.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/build_terra_trees.py -- assets/models/terra/trees
#
# Each tree stands on its origin, trunk up Z (the explorer's Y), at most ~6.5 m tall and ~2.4 m out from its trunk,
# so it fits under Terra's sky at up to ~6.5 m from the room's centre. A box *_collider round the trunk's foot.
import bpy, bmesh, math, os, random, struct, sys, tempfile, zlib
from mathutils import Vector, Matrix, Quaternion

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models/terra/trees')
TMP = tempfile.mkdtemp()
VARIANTS = 2


# ---- textures ----------------------------------------------------------------------------------------------------

def write_png(path, w, h, pixels):
    raw = b''.join(b'\x00' + bytes(max(0, min(255, int(c * 255 + 0.5))) for px in row for c in px) for row in pixels)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def value_noise(seed, cx, cy):
    r = random.Random(seed)
    grid = [[r.random() for _ in range(cx)] for _ in range(cy)]
    def at(u, v):
        x, y = u * cx, v * cy
        x0, y0 = int(x) % cx, int(y) % cy
        x1, y1 = (x0 + 1) % cx, (y0 + 1) % cy
        fx, fy = x - int(x), y - int(y)
        fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = grid[y0][x0] + (grid[y0][x1] - grid[y0][x0]) * fx
        b = grid[y1][x0] + (grid[y1][x1] - grid[y1][x0]) * fx
        return a + (b - a) * fy
    return at


def leaf_texture(name, seed, count, length, width, greens, droop=False, needles=False):
    """A cluster of leaves on transparency: each a pointed ellipse with a darker midrib and a light-to-dark shade,
    in varied greens. droop: long narrow leaves hanging in strands (willow). needles: fine needles on twigs."""
    size = 256
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]
    r = random.Random(seed)
    leaves = []
    if needles:
        for t in range(16):   # twigs across, densely set with needles either side
            y0 = r.uniform(0.06, 0.94) * size
            ang = r.uniform(-0.35, 0.35)
            for k in range(70):
                along = k / 70 * size
                cx, cy = along, y0 + math.tan(ang) * along
                for side in (-1, 1):
                    a = ang + side * r.uniform(0.5, 1.0)
                    leaves.append((cx + math.cos(a) * 9, cy + math.sin(a) * 9, 11, 2.4, a, r.choice(greens)))
    else:
        for n in range(count):
            if droop:
                sx = r.uniform(0.05, 0.95) * size
                cx, cy, a = sx + r.uniform(-8, 8), r.uniform(0.05, 0.95) * size, math.pi / 2 + r.uniform(-0.35, 0.35)
            else:
                ang = r.uniform(0, 2 * math.pi)
                d = size * 0.42 * math.sqrt(r.random())
                cx, cy, a = size / 2 + math.cos(ang) * d, size / 2 + math.sin(ang) * d, r.uniform(0, 2 * math.pi)
            leaves.append((cx, cy, length * r.uniform(0.75, 1.2), width * r.uniform(0.75, 1.2), a, r.choice(greens)))
    for cx, cy, L, Wd, a, col in leaves:
        ca, sa = math.cos(a), math.sin(a)
        ext = int(L + 2)
        for y in range(max(0, int(cy - ext)), min(size, int(cy + ext) + 1)):
            for x in range(max(0, int(cx - ext)), min(size, int(cx + ext) + 1)):
                dx, dy = x - cx, y - cy
                u = (dx * ca + dy * sa) / L          # along the leaf, -1..1
                v = (-dx * sa + dy * ca) / Wd        # across
                if abs(u) >= 1:
                    continue
                half = (1 - u * u) ** 0.8 * (1 - 0.35 * max(0.0, u))   # pointed at the tip
                if abs(v) > half:
                    continue
                shade = 0.8 + 0.35 * (0.5 - u * 0.5) - 0.15 * abs(v) / max(half, 1e-3)
                if abs(v) < 0.08 and not needles:
                    shade *= 0.78   # midrib
                px[size - 1 - y][x] = (col[0] * shade, col[1] * shade, col[2] * shade, 1)
    path = os.path.join(TMP, f'{name}.png')
    write_png(path, size, size, px)
    return path


def bark_texture(name, seed, base, dark, streak=True, birch=False):
    w, h = 64, 256
    n1, n2 = value_noise(seed, 8, 2), value_noise(seed + 1, 24, 6)
    r = random.Random(seed)
    marks = [(r.random(), r.random(), r.uniform(0.05, 0.25), r.uniform(0.004, 0.012)) for _ in range(45)] if birch else []
    rows = []
    for j in range(h):
        row = []
        for i in range(w):
            u, v = i / w, j / h
            n = 0.6 * n1(u, v) + 0.4 * n2(u, v)
            k = n ** 2 if streak else n
            c = tuple(base[c] * (1 - k * 0.6) + dark[c] * k * 0.6 for c in range(3))
            for mu, mv, mw, mh in marks:   # birch: dark horizontal lenticels
                du = min(abs(u - mu), 1 - abs(u - mu))
                if du < mw / 2 and abs(v - mv) < mh:
                    c = tuple(x * 0.25 for x in c)
            row.append((*c, 1))
        rows.append(row)
    path = os.path.join(TMP, f'{name}.png')
    write_png(path, w, h, rows)
    return path


def material(name, image, leaf=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.85 if not leaf else 0.6
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(image)
    tex.image.pack()
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if leaf:
        nt.links.new(tex.outputs['Alpha'], b.inputs['Alpha'])
        m.blend_method = 'CLIP'
        m.alpha_threshold = 0.5
        m.use_backface_culling = False   # exported double-sided: leaves show from both sides
    return m


# ---- growing -----------------------------------------------------------------------------------------------------

class Tree:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.wood = bmesh.new()
        self.wood_uv = self.wood.loops.layers.uv.new()
        self.leaves = bmesh.new()
        self.leaves_uv = self.leaves.loops.layers.uv.new()

    def tube(self, points, radii, sides):
        """A tapering tube through points, radii per point; u round, v along (1 per metre)."""
        rings = []
        along = 0.0
        vs = []
        for k, p in enumerate(points):
            if k:
                along += (p - points[k - 1]).length
            vs.append(along)
            d = (points[min(k + 1, len(points) - 1)] - points[max(k - 1, 0)]).normalized()
            side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
            up = side.cross(d).normalized()
            ring = []
            for s in range(sides + 1):
                a = 2 * math.pi * s / sides
                ring.append(self.wood.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * radii[k]))
            rings.append(ring)
        for k in range(len(rings) - 1):
            for s in range(sides):
                f = self.wood.faces.new((rings[k][s], rings[k][s + 1], rings[k + 1][s + 1], rings[k + 1][s]))
                f.normal_update()
                mid = (points[k] + points[k + 1]) / 2
                if f.normal.dot(f.calc_center_median() - mid) < 0:
                    f.normal_flip()
                for loop in f.loops:
                    kk = k if loop.vert in rings[k] else k + 1
                    ss = (rings[kk].index(loop.vert))
                    loop[self.wood_uv].uv = (ss / sides, vs[kk] / 1.5)

    def branch(self, start, direction, length, radius, segments, sides, curve, gravity):
        """A branch's centreline: from start along direction, bending by `curve` (random) and `gravity` (down)."""
        pts, radii = [start.copy()], [radius]
        d = direction.normalized()
        p = start.copy()
        step = length / segments
        for k in range(segments):
            d = (d + Vector((self.r.uniform(-1, 1), self.r.uniform(-1, 1), self.r.uniform(-1, 1))) * curve + Vector((0, 0, -gravity))).normalized()
            p = p + d * step
            pts.append(p.copy())
            radii.append(radius * (1 - (k + 1) / segments * 0.85))
        self.tube(pts, radii, sides)
        return pts, radii

    def card(self, centre, size, facing=None, upright=None, stretch=1.0):
        """A leaf card: a quad of `size` (x `stretch` tall) centred at centre, facing `facing` (random if None)."""
        n = facing.normalized() if facing is not None else Vector((self.r.uniform(-1, 1), self.r.uniform(-1, 1), self.r.uniform(-0.3, 1))).normalized()
        up = upright if upright is not None else Vector((0, 0, 1))
        side = n.cross(up)
        if side.length < 1e-3:
            side = n.cross(Vector((1, 0, 0)))
        side.normalize()
        vert = side.cross(n).normalized()
        rot = self.r.uniform(0, 2 * math.pi) if upright is None else 0.0
        a, b = side * math.cos(rot) + vert * math.sin(rot), -side * math.sin(rot) + vert * math.cos(rot)
        hw, hh = size / 2, size / 2 * stretch
        corners = [centre - a * hw - b * hh, centre + a * hw - b * hh, centre + a * hw + b * hh, centre - a * hw + b * hh]
        vs = [self.leaves.verts.new(c) for c in corners]
        f = self.leaves.faces.new(vs)
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[self.leaves_uv].uv = uv

    def finish(self, name, bark, leaf, collider_h):
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
        for bm, mat, nm in ((self.wood, bark, 'Wood'), (self.leaves, leaf, 'Leaves')):
            me = bpy.data.meshes.new(f'{name}{nm}')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(mat)
            for p in me.polygons:
                p.use_smooth = nm == 'Wood'
            coll.objects.link(bpy.data.objects.new(f'{name}{nm}', me))
        cb = bmesh.new()
        bmesh.ops.create_cube(cb, size=1)
        for v in cb.verts:
            v.co = Vector((v.co.x * 0.5, v.co.y * 0.5, (v.co.z + 0.5) * collider_h))
        me = bpy.data.meshes.new(f'{name}Trunk_collider')
        cb.to_mesh(me)
        cb.free()
        coll.objects.link(bpy.data.objects.new(f'{name}Trunk_collider', me))
        return coll


def grow_broadleaf(t, trunk_len, trunk_r, lean, level1, level2, card, cards_per_twig, spread, rise, twig_len, gravity=0.02, reach=1.0):
    """Oak / birch: a trunk, branches off its upper part (spiralling, the golden angle apart), twigs off those, and
    leaf clusters round the twigs' ends."""
    base = Vector((0, 0, 0))
    trunk_dir = Vector((t.r.uniform(-lean, lean), t.r.uniform(-lean, lean), 1))
    pts, radii = t.branch(base, trunk_dir, trunk_len, trunk_r, 9, 8, 0.06, 0.0)
    az = t.r.uniform(0, 2 * math.pi)
    for i in range(level1):
        f = 0.35 + 0.6 * (i + 0.5) / level1
        k = min(len(pts) - 2, int(f * (len(pts) - 1)))
        az += 2.39996
        out = Vector((math.cos(az), math.sin(az), 0))
        d = (out * math.sin(spread) + Vector((0, 0, math.cos(spread))) * rise).normalized()
        L = trunk_len * reach * (0.75 - 0.35 * f) * t.r.uniform(0.85, 1.15)
        bp, br = t.branch(pts[k], d, L, radii[k] * 0.55, 5, 5, 0.18, gravity)
        for j in range(level2):
            g = 0.3 + 0.7 * (j + 0.5) / level2
            kk = min(len(bp) - 2, int(g * (len(bp) - 1)))
            az2 = t.r.uniform(0, 2 * math.pi)
            d2 = (d + Vector((math.cos(az2), math.sin(az2), t.r.uniform(-0.2, 0.6))) * 0.9).normalized()
            tp, _ = t.branch(bp[kk], d2, twig_len * t.r.uniform(0.7, 1.2), br[kk] * 0.5, 3, 4, 0.25, gravity)
            for c in range(cards_per_twig):
                where = tp[-1].lerp(tp[len(tp) // 2], t.r.random() * 0.6)
                jitter = Vector((t.r.uniform(-1, 1), t.r.uniform(-1, 1), t.r.uniform(-0.6, 0.8))) * card * 0.45
                t.card(where + jitter, card * t.r.uniform(0.8, 1.2))
    # A crown of cards round the top too, so it reads full from below.
    top = pts[-1]
    for c in range(cards_per_twig * 3):
        t.card(top + Vector((t.r.uniform(-1, 1), t.r.uniform(-1, 1), t.r.uniform(-0.3, 0.7))) * card, card * t.r.uniform(0.9, 1.3))


def grow_spruce(t, height, trunk_r):
    """A straight trunk; whorls of five drooping branches every ~0.45 m, shorter toward the top; needle sprays along
    each branch, lying roughly flat."""
    pts, radii = t.branch(Vector((0, 0, 0)), Vector((0, 0, 1)), height, trunk_r, 10, 7, 0.01, 0.0)
    z = 0.8
    az = t.r.uniform(0, 2 * math.pi)
    while z < height - 0.35:
        f = z / height
        L = 2.1 * (1 - f) ** 0.9 + 0.25
        for b in range(5):
            a = az + b * 2 * math.pi / 5 + t.r.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), math.sin(a), t.r.uniform(-0.25, 0.05)))
            start = Vector((0, 0, z))
            bp, _ = t.branch(start, d, L, trunk_r * (1 - f) * 0.35 + 0.012, 3, 4, 0.05, 0.06)
            n_cards = max(1, int(L / 0.4))
            out = Vector((d.x, d.y, 0)).normalized()
            across = Vector((-out.y, out.x, 0))
            for c in range(n_cards):
                p = bp[0].lerp(bp[-1], (c + 0.6) / n_cards)
                size = 0.75 + 0.45 * (1 - f)
                # Crossed sprays: one tilted up and out, one upright across the branch, so it's full from anywhere.
                t.card(p + Vector((0, 0, 0.05)), size, facing=(out * 0.6 + Vector((0, 0, 1))))
                t.card(p, size * 0.85, facing=across + Vector((0, 0, 0.15)), upright=Vector((0, 0, 1)))
        z += t.r.uniform(0.38, 0.5)
        az += 0.6
    t.card(Vector((0, 0, height)), 0.5, facing=Vector((1, 0, 0.2)))
    t.card(Vector((0, 0, height)), 0.5, facing=Vector((0, 1, 0.2)))


def grow_willow(t, trunk_len, trunk_r):
    """A short leaning trunk; long branches arching up and out; curtains of long leaf strands hanging from them to
    near the ground."""
    lean = Vector((t.r.uniform(-0.25, 0.25), t.r.uniform(-0.25, 0.25), 1))
    pts, radii = t.branch(Vector((0, 0, 0)), lean, trunk_len, trunk_r, 7, 8, 0.07, 0.0)
    az = t.r.uniform(0, 2 * math.pi)
    for i in range(7):
        az += 2.39996
        d = Vector((math.cos(az) * 0.8, math.sin(az) * 0.8, 1.5))
        k = min(len(pts) - 2, int((0.55 + 0.4 * i / 7) * (len(pts) - 1)))
        bp, _ = t.branch(pts[k], d, t.r.uniform(2.4, 3.0), radii[k] * 0.5, 7, 5, 0.1, 0.11)   # arches over
        for c in range(1, len(bp)):
            p = bp[c]
            if p.z < 1.2:
                continue
            for s in range(3):
                hang = min(p.z - 0.25, t.r.uniform(1.4, 2.4))
                centre = p + Vector((t.r.uniform(-0.3, 0.3), t.r.uniform(-0.3, 0.3), -hang / 2))
                facing = Vector((t.r.uniform(-1, 1), t.r.uniform(-1, 1), 0))
                t.card(centre, 0.5, facing=facing, upright=Vector((0, 0, 1)), stretch=hang / 0.5)


# ---- the species ---------------------------------------------------------------------------------------------------

bpy.ops.wm.read_factory_settings(use_empty=True)
os.makedirs(OUT, exist_ok=True)
OAK_GREENS = [(0.22, 0.42, 0.14), (0.28, 0.5, 0.17), (0.18, 0.36, 0.12), (0.32, 0.52, 0.2)]
BIRCH_GREENS = [(0.45, 0.62, 0.2), (0.52, 0.68, 0.25), (0.4, 0.56, 0.18)]
SPRUCE_GREENS = [(0.1, 0.26, 0.14), (0.13, 0.3, 0.16), (0.08, 0.22, 0.12)]
WILLOW_GREENS = [(0.42, 0.58, 0.22), (0.5, 0.64, 0.26), (0.36, 0.52, 0.2)]
mats = {
    'oak': (material('OakBark', bark_texture('oak_bark', 1, (0.36, 0.29, 0.22), (0.12, 0.09, 0.07))),
            material('OakLeaves', leaf_texture('oak_leaves', 2, 70, 16, 8, OAK_GREENS), leaf=True)),
    'birch': (material('BirchBark', bark_texture('birch_bark', 3, (0.88, 0.86, 0.82), (0.55, 0.53, 0.5), streak=False, birch=True)),
              material('BirchLeaves', leaf_texture('birch_leaves', 4, 90, 10, 6, BIRCH_GREENS), leaf=True)),
    'spruce': (material('SpruceBark', bark_texture('spruce_bark', 5, (0.4, 0.26, 0.18), (0.16, 0.1, 0.07))),
               material('SpruceNeedles', leaf_texture('spruce_needles', 6, 0, 0, 0, SPRUCE_GREENS, needles=True), leaf=True)),
    'willow': (material('WillowBark', bark_texture('willow_bark', 7, (0.34, 0.31, 0.25), (0.12, 0.11, 0.09))),
               material('WillowLeaves', leaf_texture('willow_leaves', 8, 140, 18, 3, WILLOW_GREENS, droop=True), leaf=True)),
}

for species in ('oak', 'birch', 'spruce', 'willow'):
    for v in range(VARIANTS):
        seed = ord(species[0]) * 100 + v
        t = Tree(seed)
        if species == 'oak':
            grow_broadleaf(t, trunk_len=4.2 + v * 0.3, trunk_r=0.26, lean=0.1, level1=7, level2=4, card=1.0, cards_per_twig=3,
                           spread=math.radians(52), rise=0.8, twig_len=0.7, reach=0.62)
        elif species == 'birch':
            grow_broadleaf(t, trunk_len=4.8 + v * 0.3, trunk_r=0.13, lean=0.06, level1=9, level2=3, card=0.7, cards_per_twig=3,
                           spread=math.radians(38), rise=1.0, twig_len=0.5, gravity=0.04, reach=0.7)
        elif species == 'spruce':
            grow_spruce(t, height=6.0 + v * 0.3, trunk_r=0.17)
        else:
            grow_willow(t, trunk_len=3.0 + v * 0.3, trunk_r=0.25)
        name = f'{species}_{v + 1}'
        coll = t.finish(name, *mats[species], collider_h=2.4)
        bpy.ops.object.select_all(action='DESELECT')
        xs, zs = [], []
        for ob in coll.objects:
            ob.select_set(True)
            for vv in ob.data.vertices:
                xs.append(vv.co.xy.length)
                zs.append(vv.co.z)
        path = os.path.join(OUT, f'{name}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True)
        tris = sum(sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in coll.objects)
        print('TREE', name, os.path.getsize(path) // 1024, 'KB', 'tris', tris, 'height', round(max(zs), 2), 'reach', round(max(xs), 2))
