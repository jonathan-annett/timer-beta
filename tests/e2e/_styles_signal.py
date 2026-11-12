# A made-up piece of music for sting_styles.py: 8 s at 16 kHz mono, 16-bit (no resampling anywhere, so the
# browser decodes exactly the samples Essentia read for the reference). Kick, snare (noise from a fixed LCG),
# bass and chords at 120 bpm: deterministic, so the same bytes every time. Not a module the runner runs (_).
import io, math, struct, wave
SR = 16000
def signal(seconds=8.0):
    n = int(SR * seconds)
    out = [0.0] * n
    beat = SR // 2                                      # 120 bpm
    seed = 12345
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (196.0, 246.94, 293.66)]
    bass = [110.0, 98.0, 87.31, 98.0]
    for i in range(n):
        b, t = divmod(i, beat)
        bar = (i // (beat * 4)) % 4
        x = 0.0
        if b % 2 == 0:                                  # kick on 1 and 3
            x += 0.6 * math.exp(-t / 1200) * math.sin(2 * math.pi * (50 + 60 * math.exp(-t / 400)) * t / SR)
        else:                                           # snare on 2 and 4
            seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
            x += 0.25 * math.exp(-t / 1500) * ((seed / 0x7FFFFFFF) * 2 - 1)
        x += 0.25 * math.sin(2 * math.pi * bass[bar] * i / SR) * (0.6 + 0.4 * math.exp(-t / 3000))
        for f in chords[bar]:
            x += 0.07 * (math.sin(2 * math.pi * f * i / SR) + 0.3 * math.sin(4 * math.pi * f * i / SR))
        out[i] = max(-1.0, min(1.0, x * 0.8))
    return out
def wav_bytes(seconds=8.0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(round(v * 32767))) for v in signal(seconds)))
    return buf.getvalue()
