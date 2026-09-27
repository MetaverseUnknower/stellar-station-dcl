# Synthesises Terra's ambience into assets/audio/terra_ambience.ogg: a small pond on a still day. Leaves rustling
# softly in gusts (airy, high noise, not a rumble, which reads as surf), a trickle of running water with the odd
# droplet plink, and now and then a bird's chirps or trill. 30 s, looping seamlessly. Needs ffmpeg (for the OGG).
#
#   python3 tools/make_terra_ambience.py
import math, os, random, struct, subprocess, tempfile, wave

RATE = 32000
SECONDS = 30
N = RATE * SECONDS
rng = random.Random(21)
out = [0.0] * N


def smooth_random(rate_hz, lo, hi):
    """A slowly wandering level between lo and hi, changing about rate_hz times a second (and wrapping to loop)."""
    knots = [rng.uniform(lo, hi) for _ in range(int(SECONDS * rate_hz))]
    n = len(knots)
    res = []
    for i in range(N):
        x = i / N * n
        k = int(x)
        f = x - k
        f = f * f * (3 - 2 * f)
        res.append(knots[k % n] + (knots[(k + 1) % n] - knots[k % n]) * f)
    return res


def looped(layer):
    """Crossfade a layer's end into its start, so it loops without a seam."""
    fade = RATE // 2
    for i in range(fade):
        k = i / fade
        layer[i] = layer[i] * k + layer[N - fade + i] * (1 - k)
    return layer


# Leaves: white noise, high-passed (an airy hiss, no low end), in soft irregular gusts.
low = 0.0
lp = 0.0
gust = smooth_random(0.5, 0.05, 1.0)
leaves = []
for i in range(N):
    x = rng.uniform(-1, 1)
    low = low * 0.97 + x * 0.03          # the low part, taken away
    hp = x - low
    lp = lp * 0.55 + hp * 0.45           # and the harshest top off
    leaves.append(lp * 0.045 * gust[i] ** 2)
looped(leaves)

# Trickle: noise in a soft band round 1-2 kHz, gently rising and falling (a smooth murmur; a fast, hard-edged
# flicker here read as digital crackle in-world), fairly quiet.
b1 = b2 = b3 = 0.0
murmur = smooth_random(6, 0.45, 1.0)
swell = smooth_random(0.3, 0.6, 1.0)
trickle = []
for i in range(N):
    x = rng.uniform(-1, 1)
    b1 = b1 * 0.8 + x * 0.2
    b2 = b2 * 0.94 + b1 * 0.06
    b3 = b3 * 0.6 + (b1 - b2) * 0.4   # and its harshest top smoothed off
    trickle.append(b3 * 0.3 * murmur[i] * swell[i])
looped(trickle)

for i in range(N):
    out[i] = leaves[i] + trickle[i]


def add(start, samples):
    for k, s in enumerate(samples):
        out[(start + k) % N] += s   # wraps: a sound near the end finishes at the start


def tone(f0, f1, dur, amp, decay=None):
    n = int(dur * RATE)
    ph = 0.0
    res = []
    attack = int(0.006 * RATE)   # every sound fades in over 6 ms: starting at full level clicks
    for k in range(n):
        p = k / n
        ph += 2 * math.pi * (f0 + (f1 - f0) * p) / RATE
        env = math.exp(-k / RATE / decay) if decay else math.sin(math.pi * p) ** 1.5
        env *= min(1.0, k / attack) * min(1.0, (n - k) / attack)
        res.append(math.sin(ph) * env * amp)
    return res


# Droplets: little rising plinks off the water.
t = 0.3
while t < SECONDS:
    f = rng.uniform(900, 1700)
    add(int(t * RATE), tone(f, f * 1.4, 0.12, rng.uniform(0.03, 0.07), decay=0.035))
    t += rng.uniform(1.2, 3.5)

# Birds: now and then a few chirps or a short trill, some way off.
t = 1.5
while t < SECONDS - 1:
    base = rng.uniform(2800, 4200)
    amp = rng.uniform(0.04, 0.09)
    s = []
    if rng.random() < 0.6:
        for _ in range(rng.randint(2, 4)):
            s += tone(base, base * rng.uniform(1.2, 1.5), rng.uniform(0.05, 0.08), amp) + [0.0] * int(rng.uniform(0.06, 0.14) * RATE)
    else:
        for _ in range(rng.randint(5, 9)):
            s += tone(base * 1.1, base * 0.9, 0.04, amp * 0.8) + [0.0] * int(0.025 * RATE)
    add(int(t * RATE), s)
    t += rng.uniform(3.5, 7.5)

peak = max(abs(x) for x in out)
tmp = tempfile.mkdtemp()
wav = os.path.join(tmp, 'terra.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.8 * 32767)) for x in out))
# OGG, not MP3: an MP3's padding at each end would click at every loop.
dest = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'terra_ambience.ogg')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'vorbis', '-strict', '-2', '-ac', '2', '-q:a', '4', dest], check=True)
print('wrote', os.path.abspath(dest), os.path.getsize(dest) // 1024, 'KB')
