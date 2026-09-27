# Synthesises PETAL INVADERS' chiptune sound effects into assets/audio/arcade/*.wav (8-bit mono, 22 kHz): square and
# noise voices with simple envelopes, the way the old cabinets made them.
#
#   python3 tools/make_arcade_sounds.py
import math, os, random, struct, wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'audio', 'arcade')
rng = random.Random(9)


def square(f, t, duty=0.5):
    return 1.0 if (t * f) % 1 < duty else -1.0


def write(name, samples, volume=0.5):
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(RATE)
        w.writeframes(bytes(max(0, min(255, int(128 + 127 * volume * s))) for s in samples))


def render(seconds, fn):
    return [fn(i / RATE, i / RATE / seconds) for i in range(int(seconds * RATE))]


# Shot: a quick falling square sweep.
write('shoot', render(0.14, lambda t, p: square(1400 - 1100 * p, t, 0.25) * (1 - p)), 0.35)
# Pop: a burst of noise with a falling pitch underneath.
noise = [rng.uniform(-1, 1) for _ in range(RATE)]
write('pop', render(0.18, lambda t, p: (0.7 * noise[int(t * RATE)] + 0.3 * square(300 - 200 * p, t)) * (1 - p) ** 1.5), 0.5)
# Ship hit: long crunchy noise, stepping down.
write('hit', render(0.9, lambda t, p: noise[int(t * RATE / (1 + 3 * p)) % RATE] * (1 - p) ** 1.2), 0.6)
# The march: four low notes, one per formation step (the scene cycles them).
for k, f in enumerate([98, 87, 78, 73]):
    write(f'step{k}', render(0.09, lambda t, p, f=f: square(f, t) * (1 - p) ** 0.5), 0.45)
# Comet: a warbling siren.
write('comet', render(1.6, lambda t, p: square(700 + 250 * math.sin(t * 2 * math.pi * 7), t, 0.4) * (0.5 + 0.5 * math.sin(math.pi * p))), 0.25)
# Bonus: a bright rising arpeggio.
notes = [784, 988, 1175, 1568]
write('bonus', render(0.4, lambda t, p: square(notes[min(3, int(p * 4))], t, 0.25) * (1 - p * 0.5)), 0.35)
# Start: a short fanfare.
fanfare = [523, 659, 784, 1047]
write('start', render(0.6, lambda t, p: square(fanfare[min(3, int(p * 4))], t) * (1 - 0.3 * p)), 0.35)
# Wave cleared: the fanfare, higher and quicker.
write('wave', render(0.45, lambda t, p: square(fanfare[min(3, int(p * 4))] * 1.5, t, 0.25) * (1 - 0.3 * p)), 0.35)
# Game over: a slow falling line.
write('over', render(1.4, lambda t, p: square([392, 349, 311, 262][min(3, int(p * 4))], t) * (1 - p) ** 0.7), 0.4)
# ASTRO GARDEN:
# Munch: a quick two-step chirp up.
write('munch', render(0.1, lambda t, p: square(660 if p < 0.5 else 990, t, 0.3) * (1 - p)), 0.35)
# Golden seed: a sparkling run up the scale, quick.
sparkle = [784, 988, 1175, 1319, 1568, 1976]
write('golden', render(0.36, lambda t, p: square(sparkle[min(5, int(p * 6))], t, 0.2) * (1 - 0.4 * p)), 0.3)
# Wilt: the golden seed going, a soft falling blip.
write('wilt', render(0.25, lambda t, p: square(700 - 400 * p, t, 0.5) * (1 - p)), 0.2)
# Level: a little three-note fanfare.
write('level', render(0.3, lambda t, p: square([523, 659, 988][min(2, int(p * 3))], t, 0.25) * (1 - 0.3 * p)), 0.3)
# Crash: a noise burst with a thud under it.
write('crash', render(0.6, lambda t, p: (0.6 * noise[int(t * RATE / (1 + 2 * p)) % RATE] + 0.4 * square(90 - 50 * p, t)) * (1 - p) ** 1.3), 0.55)
# NEBULA BREAKER:
# Bounce off the paddle: a round low blip.
write('bounce', render(0.08, lambda t, p: square(330, t, 0.5) * (1 - p)), 0.4)
# A cloud breaking: a bright pop with a little noise.
write('brick', render(0.12, lambda t, p: (0.6 * square(880 - 300 * p, t, 0.3) + 0.4 * noise[int(t * RATE)]) * (1 - p) ** 1.5), 0.4)
# Tick: walls, asteroids and two-hit clouds.
write('tick', render(0.04, lambda t, p: square(1200, t, 0.5) * (1 - p)), 0.25)
# Power-up caught: a rising warble.
write('power', render(0.45, lambda t, p: square(500 + 900 * p + 80 * math.sin(t * 2 * math.pi * 18), t, 0.35) * (1 - 0.5 * p)), 0.3)
# Launch: a quick rising zip.
write('launch', render(0.12, lambda t, p: square(400 + 800 * p, t, 0.25) * (1 - p)), 0.3)
print('wrote', sorted(os.listdir(OUT)))
