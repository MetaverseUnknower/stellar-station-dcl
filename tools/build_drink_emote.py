# Builds the Space Bar's drinking emotes (src/bar/drinks.ts plays one, looped, while you're still with a drink): the
# drink held at the chest in the right hand, palm in, fingers round the glass, and every eight seconds a sip (glass to
# the lips, tipped, head back a touch). Two ways:
#   standing: moving like someone at a club: weight shifting side to side, a little bounce in the knees and a nod on
#             the beat (120 bpm), the shoulders countering the hips, the free arm easy; feet planted (the legs are
#             solved to keep them there)
#   sitting:  for the scene's seats, which stand you on the seat and sit you down with Decentraland's sittingChair
#             emotes: hips dropped onto the seat (where your feet are), thighs forward, shins hanging, a gentle sway,
#             a foot tapping on the beat
# The glass is the emote's prop, keyed to the hand every other frame, so it sits in the hand however the explorer
# holds it. One emote per drink and way, differing only in the glass's colour:
#   assets/emotes/<id>_emote.glb, assets/emotes/<id>_sit_emote.glb      (scene emotes must end in _emote.glb)
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b "<documentation>/static/images/emotes/Avatar_File.blend" \
#       --python tools/build_drink_emote.py -- assets/emotes
#
# Avatar_File.blend is Decentraland's emote template (the avatar rig, facing -Y, and a prop armature, Armature_Prop /
# Prop_Root): see content/creator/wearables-and-emotes/emotes/props-and-sounds.md in the documentation repo. Its
# naming rules: the avatar animation <Name>_Avatar, the prop's <Name>_Prop, the same length, at most 299 frames.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'assets/emotes')
DRINKS = {   # drinks.ts ids, and the liquid's colour
    'helium3': (0.2, 0.75, 1.0),
    'plasma': (0.55, 0.2, 0.95),
    'mythic': (1.0, 0.35, 0.7),
}
FPS = 30
LENGTH = 240          # eight seconds: two weight shifts, sixteen beats, one sip
BEAT = 15             # frames a beat (120 bpm)
STEP = 3              # frames between avatar keys (a beat needs several)
F = -1                # the avatar faces -Y
SIDE = Vector((1, 0, 0))   # the avatar's left-right axis
FWD = Vector((0, F, 0))
UP = Vector((0, 0, 1))
SEAT_HIPS = 0.13      # sitting: the hips this far above the feet's rest level (the seat top, where you're stood)

arm = bpy.data.objects['Armature']
prop = bpy.data.objects['Armature_Prop']
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 0, LENGTH

# The template's deform bones copy its control rig; we pose the deform bones themselves, so drop those constraints.
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c)
    pb.rotation_mode = 'QUATERNION'
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm.animation_data_create()
prop.animation_data_create()
REST = {b.name: arm.matrix_world @ b.matrix_local for b in arm.data.bones}


def v(x, y, z):
    return Vector((x, y, z)).normalized()


def world(pb, o=arm):
    return o.matrix_world @ pb.matrix


def set_world(pb, m):
    pb.matrix = arm.matrix_world.inverted() @ m


def aim(name, direction, roll=0.0):
    """Turn a bone so it points along `direction` (world), by the least turn from where it points now, then roll it
    about its own length."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    cur = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(direction.normalized())
    q = Quaternion(direction.normalized(), roll) @ q
    set_world(pb, Matrix.Translation(m.translation) @ q.to_matrix().to_4x4() @ Matrix.Translation(-m.translation) @ m)


def orient(name, y_dir, x_dir):
    """Set a bone's world orientation outright: its length along y_dir, its X axis as near x_dir as that allows. (The
    arm bones' X is the back of the hand's side: in the rest T-pose it points up, palms down.)"""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    y = y_dir.normalized()
    x = (x_dir - y * x_dir.dot(y)).normalized()
    z = x.cross(y)
    r = Matrix((x, y, z)).transposed()
    set_world(pb, Matrix.Translation(m.translation) @ r.to_4x4() @ Matrix.Diagonal((*m.to_scale(), 1)))


def keep_rest_rotation(name):
    """Hold a bone at its rest orientation in the world (a foot flat on the floor), wherever its parent has put it."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    set_world(pb, Matrix.Translation(m.translation) @ REST[name].to_quaternion().to_matrix().to_4x4() @ Matrix.Diagonal((*m.to_scale(), 1)))


def tilt(name, axis, angle):
    """Turn a bone about a world axis through its head."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    q = Quaternion(axis, angle)
    set_world(pb, Matrix.Translation(m.translation) @ q.to_matrix().to_4x4() @ Matrix.Translation(-m.translation) @ m)


def move(name, delta):
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    set_world(pb, Matrix.Translation(delta) @ world(pb))


def bone_len(a, b):
    return (REST[b].translation - REST[a].translation).length


def leg_to(side, ankle, knee_out=0.0):
    """Two-bone IK: put a leg's ankle at `ankle` (world), the knee bending forward (and a little out), the foot flat."""
    bpy.context.view_layer.update()
    up_name, leg_name, foot = f'Avatar_{side}UpLeg', f'Avatar_{side}Leg', f'Avatar_{side}Foot'
    l1, l2 = bone_len(up_name, leg_name), bone_len(leg_name, foot)
    hip = world(arm.pose.bones[up_name]).translation
    to = ankle - hip
    d = min(to.length, l1 + l2 - 1e-4)
    dirn = to.normalized()
    bend = (FWD + SIDE * knee_out - dirn * (FWD + SIDE * knee_out).dot(dirn)).normalized()
    cos_a = max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
    knee = hip + dirn * l1 * cos_a + bend * l1 * math.sqrt(1 - cos_a * cos_a)
    aim(up_name, knee - hip)
    aim(leg_name, hip + dirn * d - knee)
    keep_rest_rotation(foot)


def curl(side, amount):
    """Close a hand's fingers (about each finger bone's own Z, which bends toward the palm) and bring the thumb in."""
    for finger in ('Index', 'Middle', 'Ring', 'Pinky'):
        for k, a in ((1, 0.8), (2, 1.0), (3, 0.7)):
            arm.pose.bones[f'Avatar_{side}Hand{finger}{k}'].rotation_quaternion = Quaternion((0, 0, 1), amount * a)
    for k, a in ((1, 0.3), (2, 0.4), (3, 0.3)):
        arm.pose.bones[f'Avatar_{side}HandThumb{k}'].rotation_quaternion = Quaternion((0, 0, 1), amount * a)


def reset():
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def sip_at(f):
    """Holding until 120, up by 148, sipping to 178, back down by 208."""
    ease = lambda x: 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, x)))
    if f < 120:
        return 0.0
    if f < 148:
        return ease((f - 120) / 28)
    if f < 178:
        return 1.0
    return 1 - ease((f - 178) / 30)


ANKLES = {s: REST[f'Avatar_{s}Foot'].translation.copy() for s in ('Left', 'Right')}


def drinking_arm(sip):
    """The right arm: glass at the chest, or up at the lips. Palm in toward the body, thumb up, fingers round the glass:
    the back of the hand (bone X) faces out, and the forearm's the same way, so the wrist isn't twisted."""
    up = (1 - sip) * Vector((-0.12, F * 0.18, -0.97)) + sip * Vector((-0.05, F * 0.72, -0.68))
    fore = (1 - sip) * Vector((0.25, F * 0.85, 0.46)) + sip * Vector((0.36, F * 0.12, 0.93))
    out_side = Vector((-1, 0, 0.15 + 0.6 * sip))
    aim('Avatar_RightArm', up)
    orient('Avatar_RightForeArm', fore, out_side)
    hand = (1 - sip) * Vector((0.15, F * 1, 0.05)) + sip * Vector((0.3, F * 0.2, 1.0))
    orient('Avatar_RightHand', hand, out_side)
    curl('Right', 1.0)


def pose_standing(f):
    sip = sip_at(f)
    shift = math.sin(2 * math.pi * f / 120)                  # weight side to side, every four seconds
    beat = 0.5 - 0.5 * math.cos(2 * math.pi * f / BEAT)       # 0..1 on each beat
    groove = 1 - 0.7 * sip                                    # quieter while sipping
    reset()
    # Hips: over to one side and dropped a touch on the beat, rolled a little toward the weighted leg
    move('Avatar_Hips', Vector((0.028 * shift * groove, 0, -0.014 * beat * groove - 0.01)))
    tilt('Avatar_Hips', FWD, 0.045 * shift * groove)
    # Legs: feet planted, knees soft
    for s in ('Left', 'Right'):
        leg_to(s, ANKLES[s], knee_out=0.15 if s == 'Left' else -0.15)
    # Upper body: shoulders counter the hips, breathing, a nod on the beat, and back a little for the sip
    tilt('Avatar_Spine', FWD, -0.035 * shift * groove)
    tilt('Avatar_Spine1', SIDE, 0.015 * math.sin(2 * math.pi * f / 80))
    tilt('Avatar_Spine2', FWD, -0.02 * shift * groove)
    tilt('Avatar_Neck', SIDE, 0.05 * beat * groove)
    tilt('Avatar_Head', FWD, 0.03 * shift * groove)
    tilt('Avatar_Head', SIDE, -0.18 * sip)
    # The free arm, easy, swinging a little with the sway
    aim('Avatar_LeftArm', v(0.12 + 0.03 * shift, F * 0.05, -1))
    aim('Avatar_LeftForeArm', v(0.06 + 0.02 * shift, F * (0.2 + 0.05 * beat), -1))
    aim('Avatar_LeftHand', v(0.04, F * 0.25, -1))
    curl('Left', 0.35)
    drinking_arm(sip)


def pose_sitting(f):
    sip = sip_at(f)
    shift = math.sin(2 * math.pi * f / 120)
    beat = 0.5 - 0.5 * math.cos(2 * math.pi * f / BEAT)
    groove = 1 - 0.7 * sip
    reset()
    hips_rest = REST['Avatar_Hips'].translation
    move('Avatar_Hips', Vector((0, 0.05, SEAT_HIPS - hips_rest.z)))   # down onto the seat, a little back
    tilt('Avatar_Hips', FWD, 0.02 * shift * groove)
    # Thighs forward along the seat, shins hanging, knees a little apart; the right foot taps on the beat
    for s, sgn in (('Left', 1), ('Right', -1)):
        up = arm.pose.bones[f'Avatar_{s}UpLeg']
        bpy.context.view_layer.update()
        hip = world(up).translation
        l1, l2 = bone_len(f'Avatar_{s}UpLeg', f'Avatar_{s}Leg'), bone_len(f'Avatar_{s}Leg', f'Avatar_{s}Foot')
        knee = hip + v(sgn * 0.12, F * 1, -0.06) * l1
        tap = 0.035 * beat if s == 'Right' else 0.0
        ankle = knee + v(0, F * 0.22, -1) * l2 + Vector((0, 0, tap))
        leg_to(s, ankle, knee_out=sgn * 0.3)
    tilt('Avatar_Spine', SIDE, 0.07)   # leaning in a little, as you do on a stool
    tilt('Avatar_Spine1', FWD, -0.03 * shift * groove)
    tilt('Avatar_Spine2', SIDE, 0.012 * math.sin(2 * math.pi * f / 80))
    tilt('Avatar_Neck', SIDE, 0.045 * beat * groove - 0.05)
    tilt('Avatar_Head', FWD, 0.03 * shift * groove)
    tilt('Avatar_Head', SIDE, -0.18 * sip)
    # The free hand resting on the thigh
    aim('Avatar_LeftArm', v(0.18, F * 0.35, -1))
    aim('Avatar_LeftForeArm', v(0.0, F * 1, -0.25))
    aim('Avatar_LeftHand', v(0.0, F * 1, -0.35))
    curl('Left', 0.3)
    drinking_arm(sip)


# ── The glass: a highball, two materials (the prop limit), centred on the origin, upright ──
def mat(name, rgb, alpha=1.0, emit=0.0, rough=0.1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


GLASS_H, GLASS_R = 0.13, 0.034
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=GLASS_R * 0.92, radius2=GLASS_R, depth=GLASS_H)
glass_me = bpy.data.meshes.new('Glass')
bm.to_mesh(glass_me)
bm.free()
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=GLASS_R * 0.84, radius2=GLASS_R * 0.9, depth=GLASS_H * 0.62,
                      matrix=Matrix.Translation((0, 0, -GLASS_H * 0.14)))
liquid_me = bpy.data.meshes.new('Liquid')
bm.to_mesh(liquid_me)
bm.free()
glass_me.materials.append(mat('Glass', (0.85, 0.95, 1.0), alpha=0.35))
glass_ob = bpy.data.objects.new('Drink_Glass', glass_me)
liquid_ob = bpy.data.objects.new('Drink_Liquid', liquid_me)
for o in (glass_ob, liquid_ob):
    scene.collection.objects.link(o)
bpy.ops.object.select_all(action='DESELECT')
liquid_ob.select_set(True)
glass_ob.select_set(True)
bpy.context.view_layer.objects.active = glass_ob
liquid_me.materials.append(mat('Liquid', (1, 1, 1), emit=1.5))
bpy.ops.object.join()   # one mesh, two materials
prop_mesh = bpy.context.view_layer.objects.active
prop_mesh.name = 'Drink_Prop_Mesh'
vg = prop_mesh.vertex_groups.new(name='Prop_Root')
vg.add(range(len(prop_mesh.data.vertices)), 1.0, 'REPLACE')
prop_mesh.parent = prop
mod = prop_mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = prop
PROP_REST = prop.data.bones['Prop_Root'].matrix_local
pprop = prop.pose.bones['Prop_Root']
pprop.rotation_mode = 'QUATERNION'
liquid = prop_mesh.data.materials[1]


def build(pose, suffix):
    # Work out every keyed pose with no action on the rig (with one, each update in aim() would put the keyed pose
    # back), then key them all.
    for o in (arm, prop):
        o.animation_data.action = None
        for t in list(o.animation_data.nla_tracks):
            o.animation_data.nla_tracks.remove(t)
    poses = {}
    for f in range(0, LENGTH + 1, STEP):
        pose(f)
        poses[f] = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones if pb.name.startswith('Avatar_')}
    act = bpy.data.actions.new('Drink_Avatar')
    arm.animation_data.action = act
    for f, bones in poses.items():
        for name, (rot, loc) in bones.items():
            pb = arm.pose.bones[name]
            pb.rotation_quaternion = rot
            pb.location = loc
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)

    # The glass in the hand: held in the palm, fingers round it, centred in the fist, upright, tipping back toward the
    # lips as it's sipped (the avatar faces -Y)
    prop_act = bpy.data.actions.new('Drink_Prop')
    prop.animation_data.action = prop_act
    for f in range(0, LENGTH + 1, 2):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        hand = world(arm.pose.bones['Avatar_RightHand'])
        along = (hand.to_3x3() @ Vector((0, 1, 0))).normalized()
        palm = -(hand.to_3x3() @ Vector((1, 0, 0))).normalized()   # the palm's side: opposite the back of the hand
        grip = hand.translation + along * 0.06 + palm * 0.04 + Vector((0, 0, 0.015))
        s = sip_at(f)
        g = Matrix.Translation(grip + Vector((0, 0, 0.03 * s))) @ Matrix.Rotation(F * 1.05 * s, 4, 'X')
        pprop.matrix = prop.matrix_world.inverted() @ g @ PROP_REST
        pprop.keyframe_insert('rotation_quaternion', frame=f)
        pprop.keyframe_insert('location', frame=f)
        pprop.keyframe_insert('scale', frame=f)

    # One file per drink, each with its own animation names (<Drink>[Sit]_Avatar / _Prop): the explorer seems to keep
    # emote clips by name, so files sharing names all played whichever loaded first. The exporter names the animations
    # after the NLA tracks.
    for o in (arm, prop):
        o.animation_data.action = None
    os.makedirs(OUT, exist_ok=True)
    for drink, rgb in DRINKS.items():
        name = drink.capitalize() + ('Sit' if suffix else '')
        for o, a, part in ((arm, act, 'Avatar'), (prop, prop_act, 'Prop')):
            for t in list(o.animation_data.nla_tracks):
                o.animation_data.nla_tracks.remove(t)
            track = o.animation_data.nla_tracks.new()
            track.name = f'{name}_{part}'
            track.strips.new(track.name, 0, a)
        b = liquid.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*rgb, 1)
        b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
        bpy.ops.object.select_all(action='DESELECT')
        for o in (arm, prop, prop_mesh):
            o.hide_set(False)
            o.select_set(True)
        path = os.path.join(OUT, f'{drink}{suffix}_emote.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_def_bones=True,
                                  export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
                                  export_morph=False, export_skins=True, export_apply=False)
        print('WROTE', path, os.path.getsize(path) // 1024, 'KB', name)
    # For a check render, if asked for
    if os.environ.get('CHECK_BLEND'):
        bpy.ops.wm.save_as_mainfile(filepath=os.environ['CHECK_BLEND'].replace('.blend', f'{suffix}.blend'), copy=True)
    for a in (act, prop_act):
        a.use_fake_user = False


build(pose_standing, '')
build(pose_sitting, '_sit')
