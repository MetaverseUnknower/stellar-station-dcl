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
UPPER_PODS = (0, 180)                    # observation pods off Balcony 2, on the X axis (the hub wall is plain there)
UPPER_Z = 17.0                           # BALCONIES[1]
# The arcade: a small pod (the kit at 0.4) off Balcony 1 (the Recreation Deck), on a plain stretch of hub wall between
# an observation pod's axis and a docking pod. Small enough that its roof clears the observation pod's hull above it
# (16.8 m up) and its sides the docking pod at 45 degrees.
ARCADE_ANGLE, ARCADE_SCALE, ARCADE_DIST, ARCADE_Z = 18.5, 0.4, 46.0, 9.0   # across the hub from Terra (201); a pillar starts at 22.25
ARCADE_DOOR = (3.0, 3.0)
# Terra, the Earth room: a bigger small pod (the kit at 0.6, 20 m across) off the Recreation Deck across the hub, on
# the plain stretch of wall between the -X observation pod and the docking pod at 225. At 0.6 it's too tall to pass
# under an observation pod, so it's placed to clear them sideways (27.4 m between centres, 26.9 needed).
TERRA_ANGLE, TERRA_SCALE, TERRA_DIST, TERRA_Z = 201.0, 0.6, 46.5, 9.0
TERRA_DOOR = (4.0, 3.6)
# The breeding lab: off the Docks, on Terra's side, between the hub's benches at 160 and 180 and halfway between the
# docking corridors at 135 and 225; under the -X observation pod (16.8 m up), so it can be Terra's size. Sealed for
# now: its corridor is closed at the hub end by a door (src/lab/lab.ts says what's coming).
LAB_ANGLE, LAB_SCALE, LAB_DIST, LAB_Z = 169.5, 0.6, 46.5, 0.0
LAB_DOOR = (4.0, 3.6)
# The Eld's pod: a small pod off the lounge, hidden behind the Space Bar (scene 235, Blender 55). Its doorway is cut
# low and narrow so the back bar's centre bay (two leaves that swing open: build_space_bar.py, src/bar/) covers it,
# and the SPACE BAR sign over the bar clears it. Obsidian inside, with violet light (restyle_eld). Clear of the
# docking pod under it at 45 (which tops out ~15 m up) and of the Observation Deck's pods.
ELD_ANGLE, ELD_SCALE, ELD_DIST, ELD_Z = 55.0, 0.4, 46.0, 25.0
ELD_DOOR = (2.0, 2.3)
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
LOUNGE_BENCHES = (90, 120, 240, 270, 300)   # 60 (scene 240, under the SPACE BAR sign) is the bar's

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
    door's side, top and floor planes and deleting the faces between them. (The floor slice matters for doors
    off an upper level: without it, a wall face straddling the floor line goes whole, leaving a hole below.)"""
    a = math.radians(angle_deg)
    axis = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((-math.sin(a), math.cos(a), 0))
    top = floor + height
    for ob in coll.objects:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        for co, no in ((center + side * (width / 2), side), (center - side * (width / 2), -side), (Vector((0, 0, top)), Vector((0, 0, 1))), (Vector((0, 0, floor)), Vector((0, 0, -1)))):
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
        # Light strips on the wall stand proud of it, in front of the doorway's trim: clear them across the trim too.
        half = width / 2 + (0.6 if ob.name.startswith('PureEM') else 0.0)
        if half > width / 2:
            for co, no in ((center + side * half, side), (center - side * half, -side)):
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
                bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
        doomed = []
        for f in bm.faces:
            c = f.calc_center_median() - center
            if abs(c.dot(side)) < half and c.z + center.z < top + (0.6 if half > width / 2 else 0) and c.z + center.z > floor + 0.02 and c.dot(axis) > r_min:
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
    offset y, height z above the corridor's floor, which is `base` above the deck (0 for the lower pods, the
    upper pods' level for theirs). hub/pod are (walls, walls-and-floor) raycast trees for each hull."""

    def __init__(self, deg, hub, pod, base=0.0, pod_dist=POD_DISTANCE, pod_scale=1.0):
        a = math.radians(deg)
        self.pod_dist, self.pod_scale = pod_dist, pod_scale
        self.axis = Vector((math.cos(a), math.sin(a), 0))
        self.side = Vector((-math.sin(a), math.cos(a), 0))
        self.hub, self.pod = hub, pod
        self.base = base
        self.mid = (HUB_OUTER * HUB_SCALE + pod_dist - POD_OUTER * pod_scale) / 2   # between the two hulls

    def at(self, s, y, z):
        return self.axis * s + self.side * y + Vector((0, 0, z + self.base))

    def _hit(self, tree, s0, sign, y, z):
        loc, _, _, dist = tree.ray_cast(self.at(s0, y, z), self.axis * sign, 40)
        return s0 + sign * dist if loc is not None else None

    def _inner(self, trees, s0, sign, y, z, fallback, bumper):
        wall = self._hit(trees[0], s0, sign, y, z)
        # The walls have seams where a separate panel (a light strip) stands in for them, e.g. ~3 m above the
        # Recreation Deck; a ray through one misses. Take the wall just above or below rather than the fallback,
        # which would pull the corridor's end metres into the room.
        for dz in (0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8, 1.0, -1.0):
            if wall is not None:
                break
            wall = self._hit(trees[0], s0, sign, y, z + dz)
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
        if self.pod_scale < 1:
            return self._pod_inner_smooth(y, z)
        return self._inner(self.pod, self.pod_dist - 8 * self.pod_scale, -1, y, z, self.pod_dist - INNER_WALL * self.pod_scale, bumper)

    def _pod_inner_smooth(self, y, z):
        """A small pod's wall is tightly curved, and its panels' bumps and seams show in a trim laid on it. Fit a
        smooth surface to it across the doorway instead, s = a + b y^2 + c z + d z^2 + e y^2 z, and sit the
        corridor's end and trim on that. (No floor bumper: at this scale it's a few centimetres.)"""
        if not hasattr(self, '_fit'):
            import numpy as np
            rows, rhs = [], []
            for yy in np.linspace(-3.2, 3.2, 17):
                for zz in np.linspace(0.3, 4.6, 12):
                    v = self._inner(self.pod, self.pod_dist - 8 * self.pod_scale, -1, yy, zz, None, False)
                    if v is not None:
                        rows.append([1, yy * yy, zz, zz * zz, yy * yy * zz])
                        rhs.append(v)
            A, v = np.array(rows), np.array(rhs)
            self._fit = np.linalg.lstsq(A, v, rcond=None)[0]
            # Out to the most protruding point (0.2-0.3 m, a panel over the doorway), so the wall never covers the
            # trim; elsewhere the trim stands a little proud of the wall.
            self._fit[0] += float((v - A @ self._fit).max())
        a, b, c, d, e = self._fit
        return float(a + b * y * y + c * z + d * z * z + e * y * y * z)

    # Outside, a ray near the hull's lower edge can slip under it and hit the floor from below; only trust hits
    # near where the hull should be (None otherwise, and trim() borrows a neighbour's).
    def hub_outer(self, y, z):
        s = self._hit(self.hub[1], self.mid, -1, y, z)
        if s is not None and self.base >= LOUNGE:
            # Up at the lounge the dome has curved well in from its widest (the hull is ~30 m out there, not 33.6),
            # and there's no lower edge for a ray to slip under.
            return s if 22 < s < self.mid else None
        return s if s is not None and abs(s - HUB_OUTER * HUB_SCALE) < 3 else None

    def pod_outer(self, y, z):
        s = self._hit(self.pod[1], self.mid, 1, y, z)
        return s if s is not None and abs(s - (self.pod_dist - POD_OUTER * self.pod_scale)) < 3 else None

    def clamp(self, ob):
        """Trim a mesh to the stretch between the hub's and the pod's inner surfaces (the bumper near the deck,
        the wall above it), per vertex, so the tube's ends meet the trim and cover the bumper's cut ends."""
        for v in ob.data.vertices:
            s, y, z = v.co.dot(self.axis), v.co.dot(self.side), v.co.z - self.base
            s = min(max(s, self.hub_inner(y, z, bumper=True)), self.pod_inner(y, z, bumper=True))
            v.co = self.at(s, y, z)


def build_corridor(deg, hub_tree, pod_tree, base=0.0, pod_dist=POD_DISTANCE, pod_scale=1.0, door=(DOOR_W, DOOR_H), hub_trim=True):
    """A corridor on the diagonal deg, built in station space and fitted to the curved hulls at both ends. Without
    hub_trim, no frame round its mouth in the hub (a hidden doorway: the Eld's, behind the Space Bar's back bar)."""
    coll = bpy.data.collections.new('corridor')
    bpy.context.scene.collection.children.link(coll)
    f = CorridorFrame(deg, hub_tree, pod_tree, base, pod_dist, pod_scale)
    w, h, c = door[0] / 2, door[1], min(0.9, door[0] / 5)   # c: chamfer on the ceiling corners
    s0, s1 = INNER_WALL * HUB_SCALE - 4, pod_dist - INNER_WALL * pod_scale + 4   # overshoot; clamp() trims to the walls

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
            # On the wall itself, passing behind the floor's bumper (climbing over it left shards at its foot).
            ('HubIn', lambda y, z: f.hub_inner(y, z, bumper=False), -1, (u_in, u_out), False),
            ('PodIn', lambda y, z: f.pod_inner(y, z, bumper=True), 1, (u_in, u_out), False),
            ('HubOut', f.hub_outer, 1, (o_in, o_out), True),
            ('PodOut', f.pod_outer, -1, (o_in, o_out), True)):
        if name == 'HubIn' and not hub_trim:
            continue
        coll.objects.link(trim(f'CorridorTrim{name}', f, surface, toward_viewer, *loops, frame_mat, closed))

    # Colliders: floor slab, the two side walls, and a ceiling slab over the whole width (with a jump and a glide the
    # ceiling is in reach, and without it players got out through the chamfers onto the outside of the station).
    coll.objects.link(run('CorridorFloor_collider', [(-w, -0.3), (w, -0.3), (w, 0.02), (-w, 0.02)], True, None, inward=False))
    for sgn in (-1, 1):
        coll.objects.link(strip(f'CorridorWall{sgn}_collider', sgn * (w + 0.15), (h + 0.3) / 2, 0.15, (h + 0.3) / 2, None))
    coll.objects.link(run('CorridorCeiling_collider', [(-w - 0.3, h - 0.02), (w + 0.3, h - 0.02), (w + 0.3, h + 0.3), (-w - 0.3, h + 0.3)], True, None, inward=False))
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
    visible slab and a coarser collider. Holes are cut with a boolean, so their edges are true circles on both."""
    vis = slab_mesh(name, wall, z, r_in, mat, (), n, radial)
    col = slab_mesh(name + '_collider', wall, z, r_in, None, (), collider_n, collider_radial)
    for ob in (vis, col):
        if wells:
            cut_holes(ob, wells, WELL_R, z - SLAB - 1, z + 1)
    return vis, col


def cut_holes(ob, centres, radius, z0, z1, segments=64):
    """Boolean-subtract round holes (vertical cylinders) from a closed mesh, in place."""
    bm = bmesh.new()
    for cx, cy in centres:
        made = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                                     radius1=radius, radius2=radius, depth=z1 - z0)
        bmesh.ops.translate(bm, verts=made['verts'], vec=Vector((cx, cy, (z0 + z1) / 2)))
    cutter_mesh = bpy.data.meshes.new('cutter')
    bm.to_mesh(cutter_mesh)
    bm.free()
    cutter = bpy.data.objects.new('cutter', cutter_mesh)
    scene = bpy.context.scene.collection
    scene.objects.link(cutter)
    linked = ob.name not in scene.objects
    if linked:
        scene.objects.link(ob)
    mod = ob.modifiers.new('holes', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    dg = bpy.context.evaluated_depsgraph_get()
    cut = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.remove(mod)
    old = ob.data
    ob.data = cut
    bpy.data.meshes.remove(old)
    if linked:
        scene.objects.unlink(ob)
    bpy.data.objects.remove(cutter)
    bpy.data.meshes.remove(cutter_mesh)


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
    n = n or max(48, round(radius * 4))   # ~1.5 m segments on the big rings, 48 on the small ones (smooth up close)
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


def glow_material(name, rgb, strength):
    """Emissive material (the glTF export carries the emission colour and strength)."""
    m = panel_material(name, tuple(c * 0.4 for c in rgb), 0.2, 0.4)
    bsdf = m.node_tree.nodes['Principled BSDF']
    colour = 'Emission Color' if 'Emission Color' in bsdf.inputs else 'Emission'   # Blender 4 renamed it
    bsdf.inputs[colour].default_value = (*rgb, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return m


def dock_sign(name, deg, wall, base=0.0, text='DOCK', door_h=DOOR_H, rgb=(0, 0.9, 1), w=3.6):
    """A 3D sign (by default "DOCK") over a hub doorway: extruded lettering on a backing plate with a glowing border,
    just in front of the curved wall above the corridor's trim, facing the hub's centre."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    h, depth = 1.2, 0.12
    trim_top = base + door_h + 0.55               # the corridor trim's top edge (build_corridor's t)
    z = trim_top + 0.3 + h / 2
    # Built facing -Y at the origin, then turned and moved into place.
    coll.objects.link(box(f'{name}Plate', (-w / 2, 0, -h / 2), (w / 2, depth, h / 2), panel_material('SignPlate', (0.05, 0.05, 0.12), 0.7, 0.35)))
    edge = glow_material(f'SignEdge{rgb}', rgb, 3)
    b = 0.05
    for lo, hi in (((-w / 2, -0.02, h / 2 - b), (w / 2, 0.02, h / 2)), ((-w / 2, -0.02, -h / 2), (w / 2, 0.02, -h / 2 + b)),
                   ((-w / 2, -0.02, -h / 2), (-w / 2 + b, 0.02, h / 2)), ((w / 2 - b, -0.02, -h / 2), (w / 2, 0.02, h / 2))):
        coll.objects.link(box(f'{name}Edge', lo, hi, edge))
    curve = bpy.data.curves.new(f'{name}Text', 'FONT')
    curve.body = text
    curve.align_x, curve.align_y = 'CENTER', 'CENTER'
    curve.size = 0.8 if len(text) <= 4 else 0.62
    curve.extrude = 0.05
    curve.bevel_depth = 0.008
    text_ob = bpy.data.objects.new(f'{name}TextCurve', curve)
    bpy.context.scene.collection.objects.link(text_ob)
    dg = bpy.context.evaluated_depsgraph_get()
    text_mesh = bpy.data.meshes.new_from_object(text_ob.evaluated_get(dg))
    bpy.context.scene.collection.objects.unlink(text_ob)
    bpy.data.objects.remove(text_ob)
    bpy.data.curves.remove(curve)
    text_mesh.transform(Matrix.Translation((0, -0.07, 0)) @ Matrix.Rotation(math.radians(90), 4, 'X'))  # stand it up, just proud of the plate
    text_mesh.materials.append(glow_material(f'SignText{rgb}', rgb, 5))
    coll.objects.link(bpy.data.objects.new(f'{name}Letters', text_mesh))
    # Place: the plate's front faces -Y; turn it to face the centre from `deg`, in front of the wall at that height.
    a = math.radians(deg)
    r = wall.radius(a, z) - 0.35
    transform(coll, Matrix.Translation((math.cos(a) * r, math.sin(a) * r, z)) @ Matrix.Rotation(a + math.radians(270), 4, 'Z'))
    return coll


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


def fill_projector_well(coll, center, floor, scale=1.0):
    """With the projector left out, the deck has a 3.5 m hole where it stood (the under-floor 0.18 m below shows
    through, under a collider that stays flat at deck height). Fill it: a disc flush with the deck, with a thin
    glowing edge."""
    def disc(name, r0, r1, z, mat, n=128):
        bm = bmesh.new()
        if r0 == 0:
            bmesh.ops.create_circle(bm, cap_ends=True, radius=r1, segments=n)
        else:
            outer = [bm.verts.new((r1 * math.cos(2 * math.pi * i / n), r1 * math.sin(2 * math.pi * i / n), 0)) for i in range(n)]
            inner = [bm.verts.new((r0 * math.cos(2 * math.pi * i / n), r0 * math.sin(2 * math.pi * i / n), 0)) for i in range(n)]
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        bmesh.ops.translate(bm, verts=bm.verts, vec=(center.x, center.y, z))
        coll.objects.link(mesh_object(name, bm, mat))
    disc('WellCap', 0, 3.52 * scale, floor - 0.003, panel_material('DeckFloor', (0.09, 0.08, 0.22), 0.7, 0.35))
    disc('PureEM_WellCapEdge', 3.3 * scale, 3.3 * scale + 0.08, floor - 0.001, material('Blue EM'))


def build_hub_levels(hub, wall):
    coll = bpy.data.collections.new('levels')
    bpy.context.scene.collection.children.link(coll)
    # `wall` is measured before the doorways are cut (see main).
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
    vis, col = slab('Lounge', wall, LOUNGE, OCULUS_R, deck, wells=wells, radial=2.0, collider_n=96, collider_radial=4.0)
    coll.objects.link(vis)
    coll.objects.link(col)
    coll.objects.link(ring_band('PureEM_OculusEdge', OCULUS_R - 0.01, LOUNGE - SLAB * 0.65, LOUNGE - SLAB * 0.35, material('Blue EM')))
    railing(coll, 'Oculus', OCULUS_R + 0.15, LOUNGE)
    for side, (wx, wy) in zip((1, -1), wells):
        # Lift well: the slab's round hole (its wall comes from the cut), a glowing collar, and a rail open on its outer side.
        coll.objects.link(ring_band(f'PureEM_Well{side}Glow', WELL_R + 0.3, LOUNGE + 0.01, LOUNGE + 0.03, material('Blue EM'), (wx, wy), depth=0.6))

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


def restyle_eld(colls):
    """The Eld's pod and corridor in the black market's colours: glossy obsidian, the light strips violet, the glass
    left alone. (Each mesh is its own copy, so the other pods keep the kit's materials.)"""
    obsidian = panel_material('EldObsidian', (0.015, 0.012, 0.022), 0.9, 0.18)
    violet = glow_material('EldViolet', (0.55, 0.3, 1.0), 2.4)
    for coll in colls:
        for ob in coll.objects:
            if '_collider' in ob.name or ob.name.startswith(('Window', 'Glass')):
                continue
            ob.data = ob.data.copy()
            glow = ob.name.startswith(('PureEM', 'PureEm'))
            for i in range(len(ob.data.materials)):
                ob.data.materials[i] = violet if glow or 'EM' in (ob.data.materials[i].name if ob.data.materials[i] else '') else obsidian
            if not ob.data.materials:
                ob.data.materials.append(violet if glow else obsidian)


def build_small_pod(hub_tree, hub_wall, angle, scale, dist, z, door, sign_text, sign_rgb, hidden=False):
    """A small pod off a balcony (the arcade, Terra), its corridor and its sign. Like the observation pods: no engine
    (a second window instead) and no projector; no benches or wall rails either (they'd be doll-sized at this
    scale)."""
    centre = Vector((math.cos(math.radians(angle)), math.sin(math.radians(angle)), 0)) * dist
    skip = ('Engine', 'PureEM_Engine', 'Projector', 'PureEM_Projector', 'PureEm_Projector', 'Bench', 'PureEM_Bench', 'Railing', 'Wall Rail')
    pod = bake(lambda o: not o.name.startswith(skip))
    at = Matrix.Translation((0, 0, z)) @ placed(angle, dist, scale)
    transform(pod, at)
    fill_projector_well(pod, centre, z, scale)
    window = bake(lambda o: o.name.startswith(('Window', 'Glass_Window')))
    transform(window, at @ Matrix.Rotation(math.pi, 4, 'Z'))
    for ob in list(window.objects):
        window.objects.unlink(ob)
        pod.objects.link(ob)
    bpy.data.collections.remove(window)
    name_colliders(pod)
    pod_tree = (hull_bvh(pod), hull_bvh(pod, ('Wall 0', 'RivetWall', 'Ground')))
    cut_door(pod, angle + 180, *door, r_min=11 * scale, center=centre, floor=z)
    corridor = build_corridor(angle, hub_tree, pod_tree, base=z, pod_dist=dist, pod_scale=scale, door=door, hub_trim=not hidden)
    if hidden:   # no sign, no frame in the hub: the doorway is a secret
        return [pod, corridor]
    sign = dock_sign(f'{sign_text}Sign', angle, hub_wall, base=z, text=sign_text, door_h=door[1], rgb=sign_rgb, w=3.8)
    return [pod, corridor, sign]


def sealed_door(name, angle, z, door, hub_wall, depth=0.6):
    """A closed door just inside a corridor's hub end: two leaves in the corridor's own shape (build_corridor's
    profile), meeting at a glowing seam, with a band of amber status light across them, and a collider."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    a = math.radians(angle)
    axis = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((-math.sin(a), math.cos(a), 0))
    s0 = hub_wall.radius(a, z + door[1] / 2) + depth
    w, h, c = door[0] / 2, door[1], min(0.9, door[0] / 5)
    at = lambda s, y, zz: axis * s + side * y + Vector((0, 0, z + zz))
    leaf_mat = panel_material('LabDoor', (0.12, 0.11, 0.2), 0.8, 0.35)
    for sgn in (-1, 1):
        # Each leaf: the half of the profile on its side, 1 cm short of the middle, 12 cm thick.
        half = [(0.01, 0.0), (w, 0.0), (w, h - c), (w - c, h), (0.01, h)]
        prof = [(sgn * y, zz) for y, zz in half]
        bm = bmesh.new()
        front = [bm.verts.new(at(s0, y, zz)) for y, zz in prof]
        back = [bm.verts.new(at(s0 + 0.12, y, zz)) for y, zz in prof]
        bm.faces.new(front)
        bm.faces.new(back[::-1])
        for i in range(len(prof)):
            j = (i + 1) % len(prof)
            bm.faces.new((front[i], front[j], back[j], back[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        coll.objects.link(mesh_object(f'{name}Leaf{sgn}', bm, leaf_mat))
    glow = glow_material('LabSeam', (0.7, 0.45, 1), 3)
    amber = glow_material('LabStatus', (1, 0.6, 0.15), 2.5)
    coll.objects.link(box(f'PureEM_{name}Seam', tuple(at(s0 - 0.02, -0.02, 0.05)), tuple(at(s0 - 0.005, 0.02, h - 0.05)), glow))
    lo, hi = at(s0 - 0.02, -w + 0.1, 1.55), at(s0 - 0.005, w - 0.1, 1.65)
    coll.objects.link(box(f'PureEM_{name}Band', tuple(Vector((min(lo.x, hi.x), min(lo.y, hi.y), lo.z))), tuple(Vector((max(lo.x, hi.x), max(lo.y, hi.y), hi.z))), amber))
    lo, hi = at(s0, -w, 0), at(s0 + 0.12, w, h)
    coll.objects.link(box(f'{name}_collider', tuple(Vector((min(lo.x, hi.x), min(lo.y, hi.y), lo.z))), tuple(Vector((max(lo.x, hi.x), max(lo.y, hi.y), hi.z)))))
    name_colliders(coll)
    print('SEALED', name, 'door face at', round(s0, 3), 'm out')
    return coll


HUB_WINDOWS = ((50, 130), (230, 310))   # degrees: the hub's two big windows (+-Y), clear of the doorways at 45 / 135 ...


def window_colliders(wall):
    """The hub's window glass has no collision, and from the lounge a jump and a glide reached the top of the
    windows and out. An invisible sheet 8 cm inside each window, from the floor to the top of the dome."""
    coll = bpy.data.collections.new('WindowColliders')
    bpy.context.scene.collection.children.link(coll)
    for a0, a1 in HUB_WINDOWS:
        bm = bmesh.new()
        angles = [math.radians(a0 + (a1 - a0) * i / 40) for i in range(41)]
        heights = [0.1 + 0.75 * k for k in range(60)]   # to 44 m: past the dome's top
        grid = []
        for z in heights:
            row = []
            for a in angles:
                d = Vector((math.cos(a), math.sin(a), 0))
                loc, _, _, _ = wall.tree.ray_cast(Vector((0, 0, z)) + d * 2, d, 60)
                row.append(bm.verts.new((d * (loc.xy.length - 0.08)).to_3d() + Vector((0, 0, z))) if loc is not None else None)
            grid.append(row)
        for k in range(len(heights) - 1):
            for i in range(len(angles) - 1):
                quad = (grid[k][i], grid[k][i + 1], grid[k + 1][i + 1], grid[k + 1][i])
                if all(v is not None for v in quad):
                    bm.faces.new(quad)
        me = bpy.data.meshes.new(f'HubWindow{a0}_collider')
        bm.to_mesh(me)
        bm.free()
        coll.objects.link(bpy.data.objects.new(f'HubWindow{a0}_collider', me))
    name_colliders(coll)
    return coll


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
    hub_wall = HubWall(hub)   # also uncut: floors built across a doorway must still reach the wall line
    for a in HUB_DOORS:
        cut_door(hub, a, DOOR_W, DOOR_H, r_min=11 * HUB_SCALE, floor=0)
    for a in UPPER_PODS:
        cut_door(hub, a, DOOR_W, DOOR_H, r_min=11 * HUB_SCALE, floor=UPPER_Z)
    cut_door(hub, ARCADE_ANGLE, *ARCADE_DOOR, r_min=11 * HUB_SCALE, floor=ARCADE_Z)
    cut_door(hub, TERRA_ANGLE, *TERRA_DOOR, r_min=11 * HUB_SCALE, floor=TERRA_Z)
    cut_door(hub, LAB_ANGLE, *LAB_DOOR, r_min=11 * HUB_SCALE, floor=LAB_Z)
    cut_door(hub, ELD_ANGLE, *ELD_DOOR, r_min=11 * HUB_SCALE, floor=ELD_Z)
    parts.append(hub)

    for a in HUB_DOORS:
        pod = bake(lambda o: True)
        transform(pod, placed(a, POD_DISTANCE))
        pod_tree = (hull_bvh(pod), hull_bvh(pod, ('Wall 0', 'RivetWall', 'Ground')))
        # Its door faces the hub: back along the diagonal, measured from the pod's own centre.
        cut_door(pod, a + 180, DOOR_W, DOOR_H, center=Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * POD_DISTANCE, floor=0)
        parts.append(pod)
        parts.append(build_corridor(a, hub_tree, pod_tree))

    # The upper ring: pods off Balcony 2 (the Observation Deck), on the X axis where the hub wall is plain (the
    # windows are on +-Y). Observation pods: no engine; a second window, turned half round, fills its opening, as in
    # the hub. No projector dais on the floor either.
    for a in UPPER_PODS:
        pod = bake(lambda o: not o.name.startswith(('Engine', 'PureEM_Engine', 'Projector', 'PureEM_Projector', 'PureEm_Projector')))
        at = Matrix.Translation((0, 0, UPPER_Z)) @ placed(a, POD_DISTANCE)
        transform(pod, at)
        fill_projector_well(pod, Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * POD_DISTANCE, UPPER_Z)
        window = bake(lambda o: o.name.startswith(('Window', 'Glass_Window')))
        transform(window, at @ Matrix.Rotation(math.pi, 4, 'Z'))
        for ob in list(window.objects):
            window.objects.unlink(ob)
            pod.objects.link(ob)
        bpy.data.collections.remove(window)
        name_colliders(pod)
        pod_tree = (hull_bvh(pod), hull_bvh(pod, ('Wall 0', 'RivetWall', 'Ground')))
        cut_door(pod, a + 180, DOOR_W, DOOR_H, center=Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0)) * POD_DISTANCE, floor=UPPER_Z)
        parts.append(pod)
        parts.append(build_corridor(a, hub_tree, pod_tree, base=UPPER_Z))

    parts += build_small_pod(hub_tree, hub_wall, ARCADE_ANGLE, ARCADE_SCALE, ARCADE_DIST, ARCADE_Z, ARCADE_DOOR, 'ARCADE', (1, 0.2, 0.75))
    parts += build_small_pod(hub_tree, hub_wall, TERRA_ANGLE, TERRA_SCALE, TERRA_DIST, TERRA_Z, TERRA_DOOR, 'TERRA', (0.4, 1, 0.5))
    parts += build_small_pod(hub_tree, hub_wall, LAB_ANGLE, LAB_SCALE, LAB_DIST, LAB_Z, LAB_DOOR, 'LAB', (0.7, 0.45, 1))
    parts.append(sealed_door('LabDoor', LAB_ANGLE, LAB_Z, LAB_DOOR, hub_wall))
    eld = build_small_pod(hub_tree, hub_wall, ELD_ANGLE, ELD_SCALE, ELD_DIST, ELD_Z, ELD_DOOR, None, None, hidden=True)
    restyle_eld(eld)
    parts += eld
    parts.append(build_hub_levels(hub, hub_wall))
    parts.append(window_colliders(hub_wall))
    for a in HUB_DOORS:
        parts.append(dock_sign(f'DockSign{a}', a, hub_wall))
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
