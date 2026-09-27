# Synthesises Terra's ambience into assets/audio/terra_ambience.mp3: a soft breeze with birdsong (quick chirps,
# trills and, now and then, a distant two-note call), 30 s, looping seamlessly. Needs ffmpeg for the mp3.
#
#   python3 tools/make_terra_ambience.py
import math, os, random, struct, subprocess, tempfile, wave

RATE = 32000
SECONDS = 30
N = RATE * SECONDS
rng = random.Random(21)
out = [0.0] * N

# Breeze: brown-ish noise through a slow swell, wrapped round so the loop's ends meet.
b = 0.0
breeze = []
for i in range(N):
    b = b * 0.995 + rng.uniform(-1, 1) * 0.05
    breeze.append(b)
mean = sum(breeze) / N
for i in range(N):
    t = i / RATE
    swell = 0.55 + 0.45 * math.sin(2 * math.pi * t / SECONDS * 2) * math.sin(2 * math.pi * t / SECONDS * 3 + 1)
    out[i] += (breeze[i] - mean) * 0.9 * swell
fade = RATE // 2   # crossfade the breeze's end into its start
for i in range(fade):
    k = i / fade
    out[i] = out[i] * k + out[N - fade + i] * (1 - k)


def add(start, samples):
    for k, s in enumerate(samples):
        out[(start + k) % N] += s   # wraps: a call near the end finishes at the start


def chirp(f0, f1, dur, amp, vibrato=0.0):
    n = int(dur * RATE)
    ph = 0.0
    res = []
    for k in range(n):
        p = k / n
        f = f0 + (f1 - f0) * p + vibrato * math.sin(2 * math.pi * 30 * k / RATE)
        ph += 2 * math.pi * f / RATE
        env = math.sin(math.pi * p) ** 1.5
        res.append(math.sin(ph) * env * amp)
    return res


def trill(base, count, amp):
    res = []
    for c in range(count):
        res += chirp(base * 1.15, base * 0.9, 0.045, amp) + [0.0] * int(0.02 * RATE)
    return res


def gap(seconds):
    return [0.0] * int(seconds * RATE)


t = 0.5
last_call = -99.0   # the two-note call is the most noticeable sound, so it's rare: at most one per CALL_GAP seconds
CALL_GAP = 12.0
while t < SECONDS - 0.5:
    kind = rng.random()
    amp = rng.uniform(0.08, 0.2)
    base = rng.uniform(2600, 4200)
    if kind >= 0.95 and t - last_call < CALL_GAP:
        kind = rng.uniform(0, 0.95)   # too soon for another call: chirps or a trill instead
    if kind < 0.55:   # a few quick chirps
        s = []
        for _ in range(rng.randint(2, 5)):
            s += chirp(base, base * rng.uniform(1.2, 1.6), rng.uniform(0.05, 0.09), amp) + gap(rng.uniform(0.05, 0.12))
    elif kind < 0.95:  # a trill
        s = trill(base, rng.randint(6, 14), amp * 0.8)
    else:              # a distant two-note call
        last_call = t
        f = rng.uniform(1500, 2100)
        s = chirp(f * 1.25, f * 1.2, 0.28, amp * 0.5, vibrato=20) + gap(0.08) + chirp(f, f * 0.97, 0.38, amp * 0.5, vibrato=20)
    add(int(t * RATE), s)
    if kind >= 0.95:
        print('call at', round(t, 1), 's')
    t += rng.uniform(0.8, 2.6)

peak = max(abs(x) for x in out)
tmp = tempfile.mkdtemp()
wav = os.path.join(tmp, 'terra.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.8 * 32767)) for x in out))
dest = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'terra_ambience.mp3')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-b:a', '64k', dest], check=True)
print('wrote', os.path.abspath(dest), os.path.getsize(dest) // 1024, 'KB')
