# Builds assets/models/station/station.glb from the Daisy Class interior kit.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b "<kit>/DaisyClass_Interior_Kit.blend" \
#       --python tools/build_station_models.py -- assets/models/station
#
# The kit is one spherical pod (inner wall radius ~15.4 m, floor at z 0.24) modelled with mirror modifiers.
# This bakes the kit's "Interior Demo" assembly and lays out the station around the origin:
#   - a hub: the pod at HUB_SCALE, minus its benches, with a door on each diagonal
#   - a pod beyond each hub door, with one door facing the hub
#   - a corridor from each hub door to its pod, with a frame at each mouth hiding the edges of the cut
#   - benches around the hub wall at 1x, so they keep human scale
# Everything is baked into one GLB with the station floor at z 0 and the hub centre at the origin. The scene places
# it once, unrotated, so however the explorer converts glTF axes the pieces stay joined. Meshes are merged per
# material (one draw call each) and all colliders into one mesh. The .blend is never saved.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/models/station')
os.makedirs(OUT, exist_ok=True)

FLOOR_Z = 0.24          # pod floor height (kit units)
DOOR_W, DOOR_H = 5.0, 4.5  # doorway, metres
HUB_SCALE = 2.0
CORRIDOR_LENGTH = 19.0
TEXTURE_MAX = 1024
INNER_WALL, HUB_OUTER, POD_OUTER = 15.4, 16.8, 16.8   # pod wall radii at floor height, 1x (fallbacks for raycasts)
HUB_DOORS = (45, 135, 225, 315)          # clear of the window (+Y) and the engine (-Y)
BENCH_ANGLES = (-20, 0, 20, 160, 180, 200)
POD_DISTANCE = INNER_WALL * HUB_SCALE + CORRIDOR_LENGTH + INNER_WALL   # pod centre from hub centre
# Hub levels (src/station.ts HUB_LEVELS must match): two ring balconies open over the atrium, and a lounge with a
# dance floor round a central opening. Lifts run up the +-X axis at LIFT_R; rails have gaps where they pass.
BALCONIES = (9.0, 17.0)
LOUNGE = 25.0
SLAB = 0.5
BALCONY_INNER = 20.0
OCULUS_R = 6.0
LIFT_R = 17.0
WELL_R = 1.8
LIFT_PLATFORM_R = 1.5   # src/hubLevels.ts PLATFORM_RADIUS: the lift platform's disc
LANDING_HALF = 1.5      # landings are 3 m wide
LIFT_GAP_DEG = math.degrees(math.atan(LANDING_HALF / (20.0 + 0.15)))   # the balcony rail's gap is the landing's width
LOUNGE_BENCHES = (60, 90, 120, 240, 270, 300)

DEMO = bpy.data.collections['Daisy Class Interior Demo']


def all_objects(c):
    yield from c.objects
    for ch in c.children:
        yield from all_objects(ch)


def bake(pred):
    """World-space copies of the demo meshes with modifiers applied, as new objects in a scratch collection."""
    dg = bpy.context.evaluated_depsgraph_get()
    coll = bpy.data.collections.new('bake')
    bpy.context.scene.collection.children.link(coll)
    for o in all_objects(DEMO):
        if o.type != 'MESH' or not pred(o):
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        me.transform(o.matrix_world)
        ob = bpy.data.objects.new(o.name, me)
        coll.objects.link(ob)
    name_colliders(coll)
    return coll


def name_colliders(coll):
    """The explorer treats meshes whose names end in "_collider" as invisible colliders. Blender's .001 suffixes
    would break that, so give each one a unique name ending exactly in _collider."""
    for i, ob in enumerate(o for o in coll.objects if '_collider' in o.name):
        base = ob.name.split('_collider')[0].replace(' ', '')
        ob.name = ob.data.name = f'{base}{i}_collider'


def cut_door(coll, angle_deg, width, height, r_min=11.0, center=Vector((0, 0, 0)), floor=FLOOR_Z):
    """Remove hull geometry in a width x height doorway facing angle_deg from center, by slicing along the
    door's side and top planes and deleting the faces between them."""
    a = math.radians(angle_deg)
    axis = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((-math.sin(a), math.cos(a), 0))
    top = floor + height
    for ob in coll.objects:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for co, no in ((center + side * (width / 2), side), (center - side * (width / 2), -side), (Vector((0, 0, top)), Vector((0, 0, 1)))):
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
        doomed = []
        for f in bm.faces:
            c = f.calc_center_median() - center
            if abs(c.dot(side)) < width / 2 and c.z + center.z < top and c.z + center.z > floor + 0.02 and c.dot(axis) > r_min:
                doomed.append(f)
        bmesh.ops.delete(bm, geom=doomed, context='FACES')
        bm.to_mesh(ob.data)
        bm.free()


def export(coll, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in coll.objects:
        ob.select_set(True)
    path = os.path.join(OUT, filename)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='JPEG', export_jpeg_quality=85)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


def discard(coll):
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob)
    bpy.data.collections.remove(coll)


def shrink_textures():
    for img in bpy.data.images:
        if img.source == 'FILE' and img.size[0] > TEXTURE_MAX:
            img.scale(TEXTURE_MAX, TEXTURE_MAX * img.size[1] // img.size[0])


def material(name):
    return bpy.data.materials[name]


def panel_material(name, rgb, metallic=0.6, roughness=0.45):
    """Plain PBR material for the corridor. The kit's textures are atlases laid out for its own UVs, so they
    can't be box-mapped onto new geometry."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return m


def box_uv(bm, scale=0.25):
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        for loop in f.loops:
            p = loop.vert.co
            if abs(n.z) > max(abs(n.x), abs(n.y)):
                loop[uv].uv = (p.x * scale, p.y * scale)
            elif abs(n.x) > abs(n.y):
                loop[uv].uv = (p.y * scale, p.z * scale)
            else:
                loop[uv].uv = (p.x * scale, p.z * scale)


def orient(face, outward):
    """Point a face along `outward` (away from the solid it bounds). Colliders need this: the explorer's character
    controller treats a floor whose faces point down as being inside it, and won't walk on it."""
    face.normal_update()
    if face.normal.dot(outward) < 0:
        face.normal_flip()


def mesh_object(name, bm, mat=None):
    box_uv(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    return bpy.data.objects.new(name, me)


def box(name, lo, hi, mat=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector(((lo[i] + hi[i]) / 2 + v.co[i] * (hi[i] - lo[i]) for i in range(3)))
    return mesh_object(name, bm, mat)


def densify(points, step, closed=False):
    """Resample a 2D polyline so no segment is longer than step (so projected copies follow a curved hull)."""
    out = []
    pts = points + [points[0]] if closed else points
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(y1 - y0, z1 - z0) / step))
        out += [(y0 + (y1 - y0) * k / n, z0 + (z1 - z0) * k / n) for k in range(n)]
    if not closed:
        out.append(pts[-1])
    return out


def resample(points, n, closed=False):
    """n points evenly spaced by arc length along a 2D polyline, so two loops can be paired point for point."""
    pts = points + [points[0]] if closed else points
    seg = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    total = sum(seg)
    out, i, acc = [], 0, 0.0
    for k in range(n):
        d = total * k / (n if closed else n - 1)
        while i < len(seg) - 1 and acc + seg[i] < d:
            acc += seg[i]
            i += 1
        u = (d - acc) / seg[i] if seg[i] else 0
        (y0, z0), (y1, z1) = pts[i], pts[i + 1]
        out.append((y0 + (y1 - y0) * u, z0 + (z1 - z0) * u))
    return out


def hull_bvh(coll, parts=('Wall 0', 'RivetWall')):
    """Raycast target for a hull's surfaces: walls by default (no rails, lights, trim or colliders)."""
    bm = bmesh.new()
    for ob in coll.objects:
        if ob.name.startswith(parts) and '_collider' not in ob.name:
            bm.from_mesh(ob.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


class CorridorFrame:
    """A corridor's frame in station space: axial distance s from the hub centre along the corridor, lateral
    offset y, height z above the deck. hub/pod are (walls, walls-and-floor) raycast trees for each hull."""

    def __init__(self, deg, hub, pod):
        a = math.radians(deg)
        self.axis = Vector((math.cos(a), math.sin(a), 0))
        self.side = Vector((-math.sin(a), math.cos(a), 0))
        self.hub, self.pod = hub, pod
        self.mid = (HUB_OUTER * HUB_SCALE + POD_DISTANCE - POD_OUTER) / 2   # between the two hulls

    def at(self, s, y, z):
        return self.axis * s + self.side * y + Vector((0, 0, z))

    def _hit(self, tree, s0, sign, y, z):
        loc, _, _, dist = tree.ray_cast(self.at(s0, y, z), self.axis * sign, 40)
        return s0 + sign * dist if loc is not None else None

    def _inner(self, trees, s0, sign, y, z, fallback, bumper):
        wall = self._hit(trees[0], s0, sign, y, z)
        wall = fallback if wall is None else wall
        if bumper:
            # The floor's bumper stands proud of the wall near the deck; sit on it, but ignore anything
            # further into the room (floor rings, the dais).
            # Sampled a little above the deck: a ray right at floor level skims the floor and hits it anywhere.
            b = self._hit(trees[1], s0, sign, y, max(z, 0.15))
            if b is not None and 0 < (wall - b) * sign < 3:
                return b
        return wall

    def hub_inner(self, y, z, bumper=False):
        return self._inner(self.hub, 18, 1, y, z, INNER_WALL * HUB_SCALE, bumper)

    def pod_inner(self, y, z, bumper=False):
        return self._inner(self.pod, POD_DISTANCE - 8, -1, y, z, POD_DISTANCE - INNER_WALL, bumper)

    # Outside, a ray near the hull's lower edge can slip under it and hit the floor from below; only trust hits
    # near where the hull should be (None otherwise, and trim() borrows a neighbour's).
    def hub_outer(self, y, z):
        s = self._hit(self.hub[1], self.mid, -1, y, z)
        return s if s is not None and abs(s - HUB_OUTER * HUB_SCALE) < 3 else None

    def pod_outer(self, y, z):
        s = self._hit(self.pod[1], self.mid, 1, y, z)
        return s if s is not None and abs(s - (POD_DISTANCE - POD_OUTER)) < 3 else None

    def clamp(self, ob):
        """Trim a mesh to the stretch between the hub's and the pod's inner surfaces (the bumper near the deck,
        the wall above it), per vertex, so the tube's ends meet the trim and cover the bumper's cut ends."""
        for v in ob.data.vertices:
            s, y, z = v.co.dot(self.axis), v.co.dot(self.side), v.co.z
            s = min(max(s, self.hub_inner(y, z, bumper=True)), self.pod_inner(y, z, bumper=True))
            v.co = self.at(s, y, z)


def build_corridor(deg, hub_tree, pod_tree):
    """A corridor on the diagonal deg, built in station space and fitted to the curved hulls at both ends."""
    coll = bpy.data.collections.new('corridor')
    bpy.context.scene.collection.children.link(coll)
    f = CorridorFrame(deg, hub_tree, pod_tree)
    w, h, c = DOOR_W / 2, DOOR_H, 0.9   # c: chamfer on the ceiling corners
    s0, s1 = INNER_WALL * HUB_SCALE - 4, POD_DISTANCE - INNER_WALL + 4   # overshoot; clamp() trims to the walls

    def run(name, profile, closed, mat, inward=True):
        """Extrude a 2D (y, z) profile from s0 to s1."""
        bm = bmesh.new()
        a = [bm.verts.new(f.at(s0, y, z)) for y, z in profile]
        b = [bm.verts.new(f.at(s1, y, z)) for y, z in profile]
        n = len(profile)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((a[i], b[i], b[j], a[j]) if inward else (a[i], a[j], b[j], b[i]))
        ob = mesh_object(name, bm, mat)
        f.clamp(ob)
        return ob

    def strip(name, y, z, dy, dz, mat):
        return run(name, [(y - dy, z - dz), (y + dy, z - dz), (y + dy, z + dz), (y - dy, z + dz)], True, mat, inward=False)

    # Tube, densified so its ends can follow the hull's curve when clamped.
    shell = densify([(-w, 0), (w, 0), (w, h - c), (w - c, h), (-w + c, h), (-w, h - c)], 0.4, closed=True)
    coll.objects.link(run('CorridorShell', shell, True, panel_material('CorridorPanel', (0.16, 0.15, 0.4))))
    coll.objects.link(run('CorridorFloor', densify([(-w, 0.02), (w, 0.02)], 0.5), False, material('Floor 01'), inward=False))
    for sgn in (-1, 1):
        # Fully inside the tube wall, so they don't show through on the outside.
        coll.objects.link(strip(f'PureEM_CorridorStrip{sgn}', sgn * (w - 0.07), 0.32, 0.04, 0.07, material('Blue EM')))
        coll.objects.link(strip(f'PureEM_CorridorTop{sgn}', sgn * (w - c / 2 - 0.12), h - c / 2 - 0.12, 0.06, 0.06, material('PinkEM')))

    # Trim around each mouth, projected onto the hull so it sits flush. Inside it's a U standing on the deck;
    # outside, where the tube's underside shows, it goes all the way round.
    t, n = 0.55, 64
    edge = [(-w, 0), (-w, h - c), (-w + c, h), (w - c, h), (w, h - c), (w, 0)]
    u_in, u_out = resample(edge, n), resample([(-w - t, 0), (-w - t, h + t), (w + t, h + t), (w + t, 0)], n)
    o_in = resample(edge, n, closed=True)
    o_out = resample([(-w - t, -t), (-w - t, h + t), (w + t, h + t), (w + t, -t)], n, closed=True)
    frame_mat = panel_material('CorridorFrame', (0.13, 0.12, 0.32), 0.75, 0.4)
    for name, surface, toward_viewer, loops, closed in (
            ('HubIn', lambda y, z: f.hub_inner(y, z, bumper=True), -1, (u_in, u_out), False),
            ('PodIn', lambda y, z: f.pod_inner(y, z, bumper=True), 1, (u_in, u_out), False),
            ('HubOut', f.hub_outer, 1, (o_in, o_out), True),
            ('PodOut', f.pod_outer, -1, (o_in, o_out), True)):
        coll.objects.link(trim(f'CorridorTrim{name}', f, surface, toward_viewer, *loops, frame_mat, closed))

    # Colliders: floor slab and the two side walls (the ceiling is out of reach).
    coll.objects.link(run('CorridorFloor_collider', [(-w, -0.3), (w, -0.3), (w, 0.02), (-w, 0.02)], True, None, inward=False))
    for sgn in (-1, 1):
        coll.objects.link(strip(f'CorridorWall{sgn}_collider', sgn * (w + 0.15), h / 2, 0.15, h / 2, None))
    name_colliders(coll)
    return coll


def trim(name, f, surface, toward_viewer, inner, outer, mat, closed=False):
    """A flat band around the doorway lying on a hull surface: a face just off the wall, a rim on each edge,
    and a glowing strip along the doorway edge."""
    def depths(loop):
        # Where the surface wasn't found, use the nearest point along the loop that was.
        found = [surface(y, z) for y, z in loop]
        good = [i for i, d in enumerate(found) if d is not None]
        return [d if d is not None else found[min(good, key=lambda g: abs(g - i))] for i, d in enumerate(found)]

    bm = bmesh.new()
    lift, depth = 0.02, 0.1
    si, so = depths(inner), depths(outer)
    ia = [bm.verts.new(f.at(si[k] + toward_viewer * lift, y, z)) for k, (y, z) in enumerate(inner)]
    ib = [bm.verts.new(f.at(si[k] + toward_viewer * (lift + depth), y, z)) for k, (y, z) in enumerate(inner)]
    oa = [bm.verts.new(f.at(so[k] + toward_viewer * lift, y, z)) for k, (y, z) in enumerate(outer)]
    ob_ = [bm.verts.new(f.at(so[k] + toward_viewer * (lift + depth), y, z)) for k, (y, z) in enumerate(outer)]
    viewer = f.axis * toward_viewer
    glow = []
    n = len(inner)
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        faces = [
            (bm.faces.new((ib[i], ib[j], ob_[j], ob_[i])), viewer),
            (bm.faces.new((oa[i], oa[j], ob_[j], ob_[i])), None),
            (bm.faces.new((ia[i], ia[j], ib[j], ib[i])), None),
        ]
        glow.append(faces[2][0])
        for face, want in faces:
            face.normal_update()
            if want is not None and face.normal.dot(want) < 0:
                face.normal_flip()
    ob = mesh_object(name, bm, mat)
    ob.data.materials.append(material('AmberEM'))
    for i, poly in enumerate(ob.data.polygons):
        if i % 3 == 2:   # the doorway-edge rim
            poly.material_index = 1
    return ob




def glass_material():
    m = panel_material('StationGlass', (0.55, 0.7, 1.0), 0.1, 0.05)
    m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.25
    m.blend_method = 'BLEND'
    return m


class HubWall:
    """The hub's inner surface (walls, window, engine) as a radius at any angle and height."""

    def __init__(self, hub):
        self.tree = hull_bvh(hub, ('Wall 0', 'RivetWall', 'Window', 'Glass', 'Engine'))

    def radius(self, theta, z, inset=0.03):
        d = Vector((math.cos(theta), math.sin(theta), 0))
        loc, _, _, _ = self.tree.ray_cast(Vector((0, 0, z)) + d * 12, d, 40)
        return (loc.xy.length if loc is not None else 30.0) - inset


def near_lift(theta):
    """True within the lift gap on either end of the X axis."""
    deg = math.degrees(theta) % 180
    return min(deg, 180 - deg) < LIFT_GAP_DEG


def slab(name, wall, z, r_in, mat, wells=(), n=144, radial=20.0, collider_n=72, collider_radial=20.0):
    """A floor slab from r_in to the hub wall, top at z, with round holes at `wells` (x, y centres). Returns the
    visible slab and a coarser collider. Holes need fine radial steps; plain rings don't."""
    return (slab_mesh(name, wall, z, r_in, mat, wells, n, radial),
            slab_mesh(name + '_collider', wall, z, r_in, None, wells, collider_n, collider_radial))


def slab_mesh(name, wall, z, r_in, mat, wells, n, radial):
    thetas = [2 * math.pi * i / n for i in range(n)]
    r_top = [wall.radius(t, z + 0.05) for t in thetas]
    r_bot = [wall.radius(t, z - SLAB) for t in thetas]
    k = max(1, math.ceil((max(r_top) - r_in) / radial))

    def build(with_uv_mat):
        bm = bmesh.new()
        top = [[bm.verts.new((math.cos(t) * (r_in + (r_top[i] - r_in) * j / k), math.sin(t) * (r_in + (r_top[i] - r_in) * j / k), z))
                for j in range(k + 1)] for i, t in enumerate(thetas)]
        bot = [[bm.verts.new((math.cos(t) * (r_in + (r_bot[i] - r_in) * j / k), math.sin(t) * (r_in + (r_bot[i] - r_in) * j / k), z - SLAB))
                for j in range(k + 1)] for i, t in enumerate(thetas)]
        def in_well(vs):
            c = sum((v.co for v in vs), Vector()) / len(vs)
            return any((c.xy - Vector(w)).length < WELL_R + 0.2 for w in wells)
        up, down = Vector((0, 0, 1)), Vector((0, 0, -1))
        for i in range(n):
            a = (i + 1) % n
            mid = (thetas[i] + (thetas[a] if a else 2 * math.pi)) / 2
            radial = Vector((math.cos(mid), math.sin(mid), 0))
            for j in range(k):
                q = [top[i][j], top[a][j], top[a][j + 1], top[i][j + 1]]
                if not in_well(q):
                    orient(bm.faces.new(q), up)
                    orient(bm.faces.new([bot[i][j + 1], bot[a][j + 1], bot[a][j], bot[i][j]]), down)
            orient(bm.faces.new([top[i][0], bot[i][0], bot[a][0], top[a][0]]), -radial)   # inner edge, facing the atrium
            orient(bm.faces.new([top[a][k], bot[a][k], bot[i][k], top[i][k]]), radial)    # against the wall
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0001)
        return mesh_object(name, bm, mat)
    return build(True)


def ring_band(name, radius, z0, z1, mat, center=(0, 0), gap=None, n=None, depth=0.0):
    """A vertical band round a circle (a rail panel or an edge strip); segments where gap(theta) are left out.
    With depth it's a closed ring of that thickness (for colliders)."""
    bm = bmesh.new()
    cx, cy = center
    n = n or max(24, round(radius * 4))   # ~1.5 m segments on the big rings, 24 on the small ones
    for i in range(n):
        t0, t1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        if gap and gap((t0 + t1) / 2):
            continue
        first = len(bm.faces)
        for r in ((radius,) if not depth else (radius - depth / 2, radius + depth / 2)):
            p = [(cx + math.cos(t) * r, cy + math.sin(t) * r) for t in (t0, t1)]
            bm.faces.new([bm.verts.new((p[0][0], p[0][1], z0)), bm.verts.new((p[1][0], p[1][1], z0)),
                          bm.verts.new((p[1][0], p[1][1], z1)), bm.verts.new((p[0][0], p[0][1], z1))])
        if depth:
            ri, ro = radius - depth / 2, radius + depth / 2
            for t in (t0, t1):
                bm.faces.new([bm.verts.new((cx + math.cos(t) * ri, cy + math.sin(t) * ri, z0)), bm.verts.new((cx + math.cos(t) * ro, cy + math.sin(t) * ro, z0)),
                              bm.verts.new((cx + math.cos(t) * ro, cy + math.sin(t) * ro, z1)), bm.verts.new((cx + math.cos(t) * ri, cy + math.sin(t) * ri, z1))])
            for z in (z0, z1):
                p = [(cx + math.cos(t) * r, cy + math.sin(t) * r) for t in (t0, t1) for r in (ri, ro)]
                bm.faces.new([bm.verts.new((p[0][0], p[0][1], z)), bm.verts.new((p[1][0], p[1][1], z)),
                              bm.verts.new((p[3][0], p[3][1], z)), bm.verts.new((p[2][0], p[2][1], z))])
            # Each segment is a small closed block: point its faces away from its middle.
            tm = (t0 + t1) / 2
            middle = Vector((cx + math.cos(tm) * radius, cy + math.sin(tm) * radius, (z0 + z1) / 2))
            bm.faces.ensure_lookup_table()
            for f in bm.faces[first:]:
                orient(f, f.calc_center_median() - middle)
    return mesh_object(name, bm, mat)


def railing(coll, name, radius, z, center=(0, 0), gap=None):
    """Glass rail with a glowing cap, and its collider."""
    coll.objects.link(ring_band(f'{name}Glass', radius, z, z + 1.05, glass_material(), center, gap))
    coll.objects.link(ring_band(f'PureEM_{name}Cap', radius, z + 1.05, z + 1.15, material('PinkEM'), center, gap, depth=0.08))
    coll.objects.link(ring_band(f'{name}Rail_collider', radius, z, z + 1.3, None, center, gap, depth=0.2))


def annulus(name, center, r0, r1, z0, z1, mat=None, n=48):
    """A flat solid ring (for the collision under a lift well's collar), faces pointing out of the solid."""
    bm = bmesh.new()
    cx, cy = center
    ring = lambda r, z: [bm.verts.new((cx + math.cos(2 * math.pi * i / n) * r, cy + math.sin(2 * math.pi * i / n) * r, z)) for i in range(n)]
    ti, to, bi, bo = ring(r0, z1), ring(r1, z1), ring(r0, z0), ring(r1, z0)
    for i in range(n):
        j = (i + 1) % n
        tm = 2 * math.pi * (i + 0.5) / n
        radial = Vector((math.cos(tm), math.sin(tm), 0))
        orient(bm.faces.new([ti[i], ti[j], to[j], to[i]]), Vector((0, 0, 1)))
        orient(bm.faces.new([bi[i], bi[j], bo[j], bo[i]]), Vector((0, 0, -1)))
        orient(bm.faces.new([ti[i], ti[j], bi[j], bi[i]]), -radial)
        orient(bm.faces.new([to[i], to[j], bo[j], bo[i]]), radial)
    return mesh_object(name, bm, mat)


def landing(coll, name, side, z, deck):
    """A landing from a balcony's inner edge out to the lift shaft on the X axis, railed along its sides. The edge
    facing the shaft is closed by a gate in the scene (src/hubLevels.ts) while the lift is elsewhere."""
    near, far = LIFT_R + LIFT_PLATFORM_R + 0.05, BALCONY_INNER + 0.3   # overlaps the slab's edge
    x0, x1 = sorted((side * near, side * far))
    w = LANDING_HALF
    coll.objects.link(box(name, (x0, -w, z - SLAB), (x1, w, z), deck))
    coll.objects.link(box(f'{name}_collider', (x0, -w, z - SLAB), (x1, w, z)))
    coll.objects.link(box(f'PureEM_{name}Edge', (x0, -w, z - SLAB * 0.65), (x1, w, z - SLAB * 0.35), material('Blue EM')))
    for s in (-1, 1):
        y = s * w
        coll.objects.link(box(f'{name}Glass{s}', (x0, y - 0.02, z), (x1, y + 0.02, z + 1.05), glass_material()))
        coll.objects.link(box(f'PureEM_{name}Cap{s}', (x0, y - 0.04, z + 1.05), (x1, y + 0.04, z + 1.15), material('PinkEM')))
        coll.objects.link(box(f'{name}Rail{s}_collider', (x0, y - 0.1, z), (x1, y + 0.1, z + 1.3)))


def build_hub_levels(hub):
    coll = bpy.data.collections.new('levels')
    bpy.context.scene.collection.children.link(coll)
    wall = HubWall(hub)
    deck = panel_material('DeckFloor', (0.09, 0.08, 0.22), 0.7, 0.35)
    under = panel_material('CorridorPanel', (0.16, 0.15, 0.4))

    for i, z in enumerate(BALCONIES):
        vis, col = slab(f'Balcony{i}', wall, z, BALCONY_INNER, deck)
        coll.objects.link(vis)
        coll.objects.link(col)
        coll.objects.link(ring_band(f'PureEM_Balcony{i}Edge', BALCONY_INNER - 0.01, z - SLAB * 0.65, z - SLAB * 0.35, material('Blue EM')))
        railing(coll, f'Balcony{i}', BALCONY_INNER + 0.15, z, gap=near_lift)
        for side in (1, -1):
            landing(coll, f'Balcony{i}Landing{side}', side, z, deck)

    wells = [(LIFT_R, 0), (-LIFT_R, 0)]
    vis, col = slab('Lounge', wall, LOUNGE, OCULUS_R, deck, wells=wells, radial=0.6, collider_n=144, collider_radial=0.6)   # the collider's well holes must match the floor you see
    coll.objects.link(vis)
    coll.objects.link(col)
    coll.objects.link(ring_band('PureEM_OculusEdge', OCULUS_R - 0.01, LOUNGE - SLAB * 0.65, LOUNGE - SLAB * 0.35, material('Blue EM')))
    railing(coll, 'Oculus', OCULUS_R + 0.15, LOUNGE)
    for side, (wx, wy) in zip((1, -1), wells):
        # Lift well: a lined shaft through the slab, a collar over the cut edge, and a rail open on its outer side.
        coll.objects.link(ring_band(f'Well{side}Liner', WELL_R, LOUNGE - SLAB - 0.01, LOUNGE + 0.01, under, (wx, wy)))
        coll.objects.link(ring_band(f'PureEM_Well{side}Glow', WELL_R + 0.3, LOUNGE + 0.01, LOUNGE + 0.03, material('Blue EM'), (wx, wy), depth=0.6))
        # Solid footing under the collar: the slab's hole is cut from whole cells, so its edge is ragged out to ~2.6 m.
        coll.objects.link(annulus(f'Well{side}Collar_collider', (wx, wy), WELL_R, WELL_R + 1.0, LOUNGE - SLAB, LOUNGE + 0.03))
        outward = (lambda t, side=side: abs(((math.degrees(t) - (0 if side > 0 else 180) + 180) % 360) - 180) < 40)
        railing(coll, f'Well{side}', WELL_R + 0.9, LOUNGE, (wx, wy), gap=outward)
    name_colliders(coll)
    return coll


def transform(coll, matrix):
    for ob in coll.objects:
        ob.data.transform(matrix @ ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)


def placed(deg, distance, scale=1.0, floor=FLOOR_Z):
    """Scale about the origin, drop the floor to z 0, turn +X toward deg, then move out along deg."""
    a = math.radians(deg)
    return (Matrix.Translation((math.cos(a) * distance, math.sin(a) * distance, 0)) @ Matrix.Rotation(a, 4, 'Z')
            @ Matrix.Translation((0, 0, -floor * scale)) @ Matrix.Scale(scale, 4))


def merge(colls):
    """One mesh per material, plus one collider mesh."""
    groups = {}
    for coll in colls:
        for ob in coll.objects:
            if '_collider' in ob.name:
                key = '_collider'
            else:
                mats = [m.name for m in ob.data.materials if m]
                key = mats[0] if len(set(mats)) == 1 else '|'.join(sorted(set(mats))) or 'none'
            groups.setdefault(key, []).append(ob)
    out = bpy.data.collections.new('station')
    bpy.context.scene.collection.children.link(out)
    for i, (key, obs) in enumerate(groups.items()):
        for ob in obs:
            for c in list(ob.users_collection):
                c.objects.unlink(ob)
            out.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT')
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = joined.data.name = 'Station_collider' if key == '_collider' else f'Station{i}'
    return out


def main():
    shrink_textures()
    parts = []

    # No benches (they'd be 2x; 1x ones are added below), no wall rails (oversized bars at 2x), and no engine: its
    # round hatch is ~36 m across at 2x. A second window, turned half round, fills the engine's opening instead.
    hub = bake(lambda o: not o.name.startswith(('Bench', 'PureEM_Bench', 'Railing', 'Wall Rail', 'Engine', 'PureEM_Engine')))
    transform(hub, placed(0, 0, HUB_SCALE))
    second_window = bake(lambda o: o.name.startswith(('Window', 'Glass_Window')))
    transform(second_window, placed(180, 0, HUB_SCALE))
    for ob in list(second_window.objects):
        second_window.objects.unlink(ob)
        hub.objects.link(ob)
    bpy.data.collections.remove(second_window)
    name_colliders(hub)   # the copy's collider names would clash (and gain .001) otherwise
    # Uncut, so corridor ends can be fitted to the hull across the doorway.
    hub_tree = (hull_bvh(hub), hull_bvh(hub, ('Wall 0', 'RivetWall', 'Ground')))
    for a in HUB_DOORS:
        cut_door(hub, a, DOOR_W, DOOR_H, r_min=11 * HUB_SCALE, floor=0)
    parts.append(hub)

    for a in HUB_DOORS:
        pod = bake(lambda o: True)
        transform(pod, placed(a, POD_DISTANCE))
        pod_tree = (hull_bvh(pod), hull_bvh(pod, ('Wall 0', 'RivetWall', 'Ground')))
        # Its door faces the hub: back along the diagonal, measured from the pod's own centre.
        cut_door(pod, a + 180, DOOR_W, DOOR_H, center=Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * POD_DISTANCE, floor=0)
        parts.append(pod)
        parts.append(build_corridor(a, hub_tree, pod_tree))

    parts.append(build_hub_levels(hub))
    hub_wall = HubWall(hub)
    for a in LOUNGE_BENCHES:
        # Bench backs against the lounge wall (the model sits on the 1x wall, 15.4 m out).
        wall_r = hub_wall.radius(math.radians(a), LOUNGE + 0.5)
        bench = bake(lambda o: o.name.startswith(('Bench.001', 'Bench_collider.001', 'PureEM_Bench.001')))
        transform(bench, Matrix.Translation((0, 0, LOUNGE)) @ placed(a, wall_r - 16.45 - 0.1))
        parts.append(bench)

    for a in BENCH_ANGLES:
        bench = bake(lambda o: o.name.startswith(('Bench.001', 'Bench_collider.001', 'PureEM_Bench.001')))
        transform(bench, placed(a, INNER_WALL * (HUB_SCALE - 1)))  # the model sits on the 1x wall; shift it to the hub wall
        parts.append(bench)

    station = merge(parts)
    export(station, 'station.glb')
    print('STATION tris', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in station.objects),
          'meshes', len(station.objects), 'pod distance', round(POD_DISTANCE, 2))


main()
