# Synthesises assets/audio/glass_break.mp3 (a dropped drink, src/bar/drinks.ts; needs numpy and ffmpeg): the crack of
# the glass hitting the floor, then shards ringing out at random high pitches as they bounce and skitter, over a
# short burst of filtered noise.
#
#   python3 tools/make_glass_break.py
import os, subprocess, tempfile, wave
import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'glass_break.mp3')
rng = np.random.default_rng(11)
n = int(RATE * 1.4)
t = np.arange(n) / RATE
out = np.zeros(n)

# The impact: a very short, bright crack
crack = rng.standard_normal(n) * np.exp(-t / 0.006)
out += 0.9 * np.diff(np.concatenate([[0], crack]))   # differenced: bright, no thump

# Filtered noise under the shards: the glass going to pieces
noise = rng.standard_normal(n)
hp = np.diff(np.concatenate([[0], noise]))
out += 0.25 * hp * np.exp(-t / 0.12)

# Shards: glassy partials with hard attacks, in bursts as they land and bounce
for burst, count, level in ((0.0, 26, 1.0), (0.09, 14, 0.55), (0.21, 10, 0.35), (0.36, 7, 0.2), (0.55, 4, 0.12)):
    for _ in range(count):
        start = burst + rng.uniform(0, 0.05)
        f = rng.uniform(2600, 9500)
        decay = rng.uniform(0.03, 0.25)
        amp = level * rng.uniform(0.15, 0.5)
        s = int(start * RATE)
        tt = t[: n - s]
        ring = np.sin(2 * np.pi * f * tt + rng.uniform(0, 6.28)) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt)   # a clink's inharmonic overtone
        out[s:] += amp * ring * np.exp(-tt / decay) * (1 - np.exp(-tt / 0.0008))

fade = np.minimum(1, (n - np.arange(n)) / (RATE * 0.05))   # no click at the end
out *= fade
out /= np.max(np.abs(out)) * 1.05

tmp = os.path.join(tempfile.mkdtemp(), 'glass.wav')
with wave.open(tmp, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((out * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-b:a', '128k', OUT], check=True)
print('WROTE', os.path.abspath(OUT))
