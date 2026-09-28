# Builds the Space Bar's drinking emotes (src/bar/drinks.ts plays one, looped, while you stand still holding a drink):
# the drink held at the chest in the right hand, fingers round the glass, the left arm easy, a little breathing, and
# every eight seconds a sip (glass to the lips, tipped, head back a touch). The glass is the emote's prop, keyed to the
# hand every other frame, so it sits in the hand however the explorer holds it. One emote per drink, differing only in
# the glass's colour:
#   assets/emotes/<id>_emote.glb      (scene emotes must end in _emote.glb)
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
LENGTH = 240          # eight seconds
F = -1                # the avatar faces -Y

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


def v(x, y, z):
    return Vector((x, y, z)).normalized()


def world(pb, o=arm):
    return o.matrix_world @ pb.matrix


def aim(name, direction, roll=0.0):
    """Turn a bone so it points along `direction` (world), by the least turn from where it points now, then roll it
    about its own length."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    cur = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    q = cur.rotation_difference(direction.normalized())
    q = Quaternion(direction.normalized(), roll) @ q
    turned = Matrix.Translation(m.translation) @ q.to_matrix().to_4x4() @ Matrix.Translation(-m.translation) @ m
    pb.matrix = arm.matrix_world.inverted() @ turned


def tilt(name, axis, angle):
    """Turn a bone about a world axis through its head."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[name]
    m = world(pb)
    q = Quaternion(axis, angle)
    pb.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(m.translation) @ q.to_matrix().to_4x4() @ Matrix.Translation(-m.translation) @ m)


def curl(side, amount):
    """Close a hand's fingers (about each finger bone's own Z, which bends toward the palm) and bring the thumb in."""
    for finger in ('Index', 'Middle', 'Ring', 'Pinky'):
        for k, a in ((1, 0.8), (2, 1.0), (3, 0.7)):
            pb = arm.pose.bones[f'Avatar_{side}Hand{finger}{k}']
            pb.rotation_quaternion = Quaternion((0, 0, 1), amount * a)
    for k, a in ((1, 0.3), (2, 0.4), (3, 0.3)):
        pb = arm.pose.bones[f'Avatar_{side}HandThumb{k}']
        pb.rotation_quaternion = Quaternion((0, 0, 1), amount * a)


def reset():
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


SIDE = Vector((1, 0, 0))   # the avatar's left-right axis


def pose(sip, breath):
    """sip: 0 holding at the chest .. 1 glass at the lips. breath: -1..1."""
    reset()
    tilt('Avatar_Spine1', SIDE, 0.02 * breath)
    tilt('Avatar_Head', SIDE, -0.18 * sip)   # head back a little for the sip
    # Left arm: down by the side, a little out and forward, elbow soft
    aim('Avatar_LeftArm', v(0.12, F * 0.05, -1))
    aim('Avatar_LeftForeArm', v(0.06, F * 0.2, -1))
    aim('Avatar_LeftHand', v(0.04, F * 0.25, -1))
    curl('Left', 0.35)
    # Right arm: glass at the chest, or up at the lips
    up = (1 - sip) * Vector((-0.12, F * 0.18, -0.97)) + sip * Vector((-0.05, F * 0.72, -0.68))
    fore = (1 - sip) * Vector((0.25, F * 0.85, 0.46)) + sip * Vector((0.36, F * 0.12, 0.93))
    aim('Avatar_RightArm', up)
    aim('Avatar_RightForeArm', fore, roll=F * 1.2)
    aim('Avatar_RightHand', fore + Vector((0.1, 0, -0.25)))
    curl('Right', 1.0)


def key_avatar(frame):
    for pb in arm.pose.bones:
        if pb.name.startswith('Avatar_'):
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)


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


# Work out every keyed pose with no action on the rig (with one, each update in aim() would put the keyed pose back),
# then key them all.
arm.animation_data.action = None
poses = {}
for f in range(0, LENGTH + 1, 6):
    pose(sip_at(f), math.sin(2 * math.pi * f / 120))
    poses[f] = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in arm.pose.bones if pb.name.startswith('Avatar_')}
arm.animation_data.action = bpy.data.actions.new('Drink_Avatar')
for f, bones in poses.items():
    for name, (rot, loc) in bones.items():
        pb = arm.pose.bones[name]
        pb.rotation_quaternion = rot
        pb.location = loc
    key_avatar(f)

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

# The glass in the hand: its middle in the curled fingers, upright, tipping toward the lips as it's sipped.
REST = prop.data.bones['Prop_Root'].matrix_local
prop.animation_data.action = bpy.data.actions.new('Drink_Prop')
pprop = prop.pose.bones['Prop_Root']
pprop.rotation_mode = 'QUATERNION'
for f in range(0, LENGTH + 1, 2):
    scene.frame_set(f)
    bpy.context.view_layer.update()
    hand = world(arm.pose.bones['Avatar_RightHand'])
    along = (hand.to_3x3() @ Vector((0, 1, 0))).normalized()
    grip = hand.translation + along * 0.07 + Vector((0.02, 0, -0.035))   # in the curled fingers, a little toward the body
    s = sip_at(f)
    g = Matrix.Translation(grip + Vector((0, 0, 0.03 * s))) @ Matrix.Rotation(-F * 1.05 * s, 4, 'X')
    pprop.matrix = prop.matrix_world.inverted() @ g @ REST
    pprop.keyframe_insert('rotation_quaternion', frame=f)
    pprop.keyframe_insert('location', frame=f)
    pprop.keyframe_insert('scale', frame=f)

# Both actions onto NLA tracks (the exporter names the animations after them), then one file per drink
for o, name in ((arm, 'Drink_Avatar'), (prop, 'Drink_Prop')):
    act = o.animation_data.action
    track = o.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    o.animation_data.action = None

os.makedirs(OUT, exist_ok=True)
liquid = prop_mesh.data.materials[1]
for drink, rgb in DRINKS.items():
    b = liquid.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Emission Color' if 'Emission Color' in b.inputs else 'Emission'].default_value = (*rgb, 1)
    bpy.ops.object.select_all(action='DESELECT')
    for o in (arm, prop, prop_mesh):
        o.hide_set(False)
        o.select_set(True)
    path = os.path.join(OUT, f'{drink}_emote.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_def_bones=True,
                              export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_frame_step=1,
                              export_morph=False, export_skins=True, export_apply=False)
    print('WROTE', path, os.path.getsize(path) // 1024, 'KB')

# For a check render, if asked for
if os.environ.get('CHECK_BLEND'):
    bpy.ops.wm.save_as_mainfile(filepath=os.environ['CHECK_BLEND'], copy=True)
