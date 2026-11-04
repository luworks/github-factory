#!/usr/bin/env python3
"""Build original 180 s film stems. Outputs stay outside the source checkout.

Requires Python 3.12, edge-tts, numpy, scipy and ffmpeg. No credentials or model
API configuration is read. Edge speech receives only the original public script.
CPU libraries and FFmpeg are limited to four threads. See AUDIO.md for rights.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import textwrap
import wave

for _name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ[_name] = "4"

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import gaussian_filter1d

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = Path("artifacts/film/audio")
SR = 48000
SECONDS = 180
VOICE = "en-US-ChristopherNeural"
RATE = "-5%"
PITCH = "-2Hz"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, capture_output=True, text=True)


def ffmpeg(*args: str) -> None:
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "4", "-filter_threads", "4", *args)


def load_story() -> dict:
    story = json.loads((ROOT / "storyboard.json").read_text())
    assert story["duration"] == SECONDS
    pos = 0
    for scene in story["scenes"]:
        assert scene["start"] == pos
        assert scene["shot"] in {"landing", "architecture", "styles", "activity", "guide", "atlas", "brand"}
        assert all(ord(c) < 128 for value in scene.values() if isinstance(value, str) for c in value)
        pos += scene["duration"]
    assert pos == SECONDS
    assert (ROOT / "narration.txt").read_text().strip() == "\n\n".join(s["narration"] for s in story["scenes"])
    return story


def pcm(path: Path, samples: np.ndarray) -> None:
    wavfile.write(path, SR, np.round(np.clip(samples, -1, 1) * 32767).astype(np.int16))


def read_pcm(path: Path) -> np.ndarray:
    rate, arr = wavfile.read(path)
    assert rate == SR
    return arr.astype(np.float32) / 32768


def stamp(sec: float) -> str:
    ms = round(sec * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


async def voice_scene(scene: dict, out: Path) -> tuple[Path, list[dict]]:
    import edge_tts

    identity = hashlib.sha256(json.dumps([scene["narration"], VOICE, RATE, PITCH]).encode()).hexdigest()
    mp3 = out / f"{scene['id']}.mp3"
    metadata = out / f"{scene['id']}.speech.json"
    if mp3.exists() and metadata.exists():
        cached = json.loads(metadata.read_text())
        if cached["identity"] == identity:
            return mp3, cached["boundaries"]
    boundaries = []
    try:
        with mp3.open("wb") as stream:
            communicator = edge_tts.Communicate(
                scene["narration"], VOICE, rate=RATE, pitch=PITCH, boundary="WordBoundary", connect_timeout=15, receive_timeout=30
            )
            async for chunk in communicator.stream():
                if chunk["type"] == "audio":
                    stream.write(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    boundaries.append(
                        {"start": chunk["offset"] / 1e7, "end": (chunk["offset"] + chunk["duration"]) / 1e7, "text": chunk["text"]}
                    )
        assert boundaries and mp3.stat().st_size > 1000
    except Exception as error:
        with (out / "failures.jsonl").open("a") as failures:
            failures.write(json.dumps({"stage": "speech", "scene": scene["id"], "error": repr(error)}) + "\n")
        raise
    metadata.write_text(
        json.dumps({"identity": identity, "voice": VOICE, "rate": RATE, "pitch": PITCH, "boundaries": boundaries}, indent=2) + "\n"
    )
    return mp3, boundaries


async def narration(story: dict, out: Path) -> None:
    timeline = np.zeros(SR * SECONDS, dtype=np.float32)
    scene_timings, words, cues = [], [], []
    for scene in story["scenes"]:
        print("Speech:", scene["id"], flush=True)
        mp3, boundaries = await voice_scene(scene, out)
        # Edge removes punctuation from boundary text. Restore the authored script
        # only after verifying the exact ordered spoken tokens against it.
        tokens = scene["narration"].split()
        clean = lambda text: "".join(c.lower() for c in text if c.isalnum())
        assert [clean(t) for t in tokens] == [clean(b["text"]) for b in boundaries]
        boundaries = [{**b, "text": token} for b, token in zip(boundaries, tokens)]
        decoded = out / f"{scene['id']}.wav"
        ffmpeg("-i", str(mp3), "-ar", str(SR), "-ac", "1", str(decoded))
        voice = read_pcm(decoded)
        original_duration = len(voice) / SR
        available = scene["duration"] - 1.05
        speed = max(1.0, original_duration / available)
        if speed > 1.12:
            raise ValueError(f"Scene {scene['id']} needs excessive speed {speed:.3f}; revise script.")
        if speed > 1:
            ffmpeg("-i", str(mp3), "-af", f"atempo={speed:.8f}", "-ar", str(SR), "-ac", "1", str(decoded))
            voice = read_pcm(decoded)
        offset = scene["start"] + 0.60
        i = round(offset * SR)
        assert i + len(voice) <= (scene["start"] + scene["duration"]) * SR
        timeline[i : i + len(voice)] += voice
        adjusted = [
            {
                "start": round(offset + b["start"] / speed, 4),
                "end": round(offset + b["end"] / speed, 4),
                "text": b["text"],
                "scene": scene["id"],
            }
            for b in boundaries
        ]
        words.extend(adjusted)
        scene_timings.append(
            {
                "id": scene["id"],
                "sceneStart": scene["start"],
                "sceneDuration": scene["duration"],
                "voiceStart": offset,
                "voiceEnd": round(offset + len(voice) / SR, 4),
                "originalDuration": original_duration,
                "speed": speed,
                "file": str(decoded),
                "narration": scene["narration"],
            }
        )
        group = []
        for k, word in enumerate(adjusted):
            group.append(word)
            size = len(" ".join(w["text"] for w in group))
            if size >= 62 or word["text"].endswith((".", "?", "!")) or k == len(adjusted) - 1:
                content = " ".join(w["text"] for w in group)
                cue_end = min(group[-1]["end"] + 0.13, offset + len(voice) / SR)
                cues.append(
                    {"start": group[0]["start"], "end": cue_end, "text": "\n".join(textwrap.wrap(content, 44)), "scene": scene["id"]}
                )
                group = []
    for first, second in zip(cues, cues[1:]):
        first["end"] = min(first["end"], second["start"] - 0.015)
    raw = out / "narration.raw.wav"
    pcm(raw, timeline)
    ffmpeg("-i", str(raw), "-af", "loudnorm=I=-17:TP=-3:LRA=9", "-ar", str(SR), "-ac", "1", str(out / "narration.wav"))
    timing = {
        "duration": SECONDS,
        "sampleRate": SR,
        "voice": VOICE,
        "alignment": "Edge WordBoundary events; offsets adjusted by measured per-scene tempo factor",
        "scenes": scene_timings,
        "words": words,
        "cues": cues,
    }
    (out / "narration-timing.json").write_text(json.dumps(timing, indent=2) + "\n")
    (out / "english.srt").write_text(
        "\n\n".join(f"{i}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i, c in enumerate(cues, 1)) + "\n"
    )


def music(out: Path) -> None:
    """Original score: 80 BPM, D-minor / F-major color, no external samples."""
    print("Synthesizing original score", flush=True)
    rng = np.random.default_rng(20261104)
    size = SR * SECONDS
    score = np.zeros((size, 2), np.float32)
    fx = np.zeros_like(score)

    def add(target: np.ndarray, signal: np.ndarray, start: float, gain: float, pan: float = 0):
        idx = round(start * SR)
        if idx < 0 or idx >= size:
            return
        n = min(len(signal), size - idx)
        angle = (pan + 1) * math.pi / 4
        target[idx : idx + n, 0] += signal[:n] * (gain * math.cos(angle))
        target[idx : idx + n, 1] += signal[:n] * (gain * math.sin(angle))

    def note(midi: float, duration: float, color: str = "pad") -> np.ndarray:
        t = np.arange(round(duration * SR), dtype=np.float32) / SR
        freq = 440 * 2 ** ((midi - 69) / 12)
        if color == "pad":
            phase = 2 * np.pi * freq * t
            wave = (
                0.52 * np.sin(phase)
                + 0.22 * np.sin(phase * 1.0018 + 0.4)
                + 0.12 * np.sin(phase * 0.9982 + 1.1)
                + 0.07 * np.sin(2 * phase)
                + 0.025 * np.sin(3 * phase)
            )
            env = np.minimum(t / 1.25, 1) * np.minimum((duration - t) / 1.75, 1)
        elif color == "bell":
            wave = np.sin(2 * np.pi * freq * t) + 0.24 * np.sin(2 * np.pi * freq * 2 * t)
            env = (1 - np.exp(-t * 180)) * np.exp(-t * 1.65) * np.minimum((duration - t) / 0.15, 1)
        else:
            wave = np.sin(2 * np.pi * freq * t) + 0.12 * np.sin(2 * np.pi * freq * 2 * t)
            env = (1 - np.exp(-t * 35)) * np.exp(-t * 2.2) * np.minimum((duration - t) / 0.10, 1)
        return (wave * np.clip(env, 0, 1)).astype(np.float32)

    chords = [[50, 57, 60, 64, 69], [46, 53, 57, 60, 65], [41, 53, 57, 60, 67], [48, 55, 60, 62, 67]]
    for bar in range(30):
        start = bar * 6.0
        chord = chords[bar % 4] if start < 168 else [50, 57, 62, 64, 69]
        lift = np.interp(
            start, [0, 14, 38, 58, 76, 96, 113, 131, 150, 166, 173], [0.34, 0.70, 0.55, 0.72, 0.85, 0.68, 0.42, 0.95, 1.05, 1.15, 0.70]
        )
        for j, midi in enumerate(chord):
            add(score, note(midi, 8.2), start, 0.040 * lift, (j - 2) * 0.33)
        add(score, note(chord[0] - 12, 6.4), start, 0.065 * lift, 0)
    # An original rising four-note question, followed by a descending answer.
    motif = [74, 81, 76, 77, 74, 72, 69, 67]
    for phrase in [14, 38, 58, 82, 98, 131, 143, 155, 163]:
        for j, pitch in enumerate(motif):
            add(score, note(pitch, 2.8, "bell"), phrase + j * 0.75, 0.018 if phrase < 131 else 0.026, -0.55 + j / 7 * 1.1)
    # Quiet eighth-note navigation pulse, with a deliberate hush for the trust scene.
    for step in range(320):
        start = 53.25 + step * 0.375
        if start > 171 or 113 <= start < 131:
            continue
        chord = chords[int(start // 6) % 4]
        midi = chord[[1, 2, 3, 4, 3, 2, 1, 3][step % 8]] + 12
        gain = 0.012 if start < 131 else 0.020
        add(score, note(midi, 0.85, "pluck"), start, gain, -0.45 if step % 2 else 0.45)
    for beat in range(240):
        start = beat * 0.75
        if start < 14 or start > 169 or 96 <= start < 131:
            continue
        intensity = 0.55 if start < 76 else 0.85 if start < 150 else 1.0
        if beat % 4 in (0, 2):
            t = np.arange(round(SR * 0.65), dtype=np.float32) / SR
            phase = 2 * np.pi * (43 * t + (105 - 43) * 0.025 * (1 - np.exp(-t / 0.025)))
            kick = np.sin(phase) * (1 - np.exp(-t * 250)) * np.exp(-t * 8)
            add(score, kick, start, 0.095 * intensity)
        if beat % 4 == 2:
            t = np.arange(round(SR * 0.32), dtype=np.float32) / SR
            noise = rng.normal(size=len(t)).astype(np.float32)
            noise -= gaussian_filter1d(noise, 9)
            snare = (noise * 0.42 + np.sin(2 * np.pi * 168 * t) * 0.35) * np.exp(-t * 18)
            add(score, snare, start, 0.024 * intensity, 0.12)
    # Short stereo room: no impulse responses or sampled recordings.
    dry = score.copy()
    for delay, gain in [(0.173, 0.12), (0.347, 0.10), (0.619, 0.07), (0.971, 0.04)]:
        shift = round(delay * SR)
        score[shift:, 0] += dry[:-shift, 1] * gain
        score[shift:, 1] += dry[:-shift, 0] * gain
    del dry
    # Subtle reveal breaths and interface accents, kept as a separate optional stem.
    for boundary in [14, 26, 38, 58, 76, 96, 113, 131, 150, 163, 173]:
        length = 1.4
        t = np.arange(round(SR * length), dtype=np.float32) / SR
        noise = gaussian_filter1d(rng.normal(size=len(t)).astype(np.float32), 4)
        env = np.sin(np.pi * t / length) ** 2
        add(fx, noise * env, max(0, boundary - 1.0), 0.035, -0.3)
        if boundary in [14, 38, 131, 173]:
            add(fx, note(86, 2.1, "bell"), boundary + 0.05, 0.015, 0.35)
    t = np.arange(size, dtype=np.float32) / SR
    fade = np.clip(t / 2.5, 0, 1) * np.clip((180 - t) / 4, 0, 1)
    score *= fade[:, None]
    fx *= fade[:, None]
    pcm(out / "score.raw.wav", score)
    pcm(out / "sound-design.wav", fx)
    ffmpeg("-i", str(out / "score.raw.wav"), "-af", "loudnorm=I=-24:TP=-6:LRA=10", "-ar", str(SR), "-ac", "2", str(out / "score.wav"))


def mix(out: Path) -> None:
    voice = read_pcm(out / "narration.wav")
    score = read_pcm(out / "score.wav")
    effects = read_pcm(out / "sound-design.wav")
    assert len(voice) == len(score) == len(effects) == SECONDS * SR
    # Smooth, scene-aware ducking avoids pumping between individual words.
    timing = json.loads((out / "narration-timing.json").read_text())
    envelope = np.ones(len(voice), dtype=np.float32) * 0.84
    for scene in timing["scenes"]:
        start = max(0, round((scene["voiceStart"] - 0.2) * SR))
        end = min(len(voice), round((scene["voiceEnd"] + 0.15) * SR))
        envelope[start:end] = 0.30
    # Smooth at a low control rate, keeping CPU and memory bounded.
    controls = gaussian_filter1d(envelope[::480], 18)
    envelope = np.interp(np.arange(len(voice)) / 480, np.arange(len(controls)), controls).astype(np.float32)
    combined = voice[:, None] * np.ones((1, 2), np.float32) + score * envelope[:, None] + effects
    pcm(out / "mix.raw.wav", combined)
    ffmpeg("-i", str(out / "mix.raw.wav"), "-af", "loudnorm=I=-16:TP=-1.5:LRA=9", "-ar", str(SR), "-ac", "2", str(out / "mix.wav"))
    ffmpeg("-ss", "12", "-i", str(out / "mix.wav"), "-t", "32", "-c:a", "libmp3lame", "-b:a", "192k", str(out / "review-sample.mp3"))


def verify(story: dict, out: Path) -> None:
    files = ["score.wav", "narration.wav", "sound-design.wav", "mix.wav"]
    checks = []
    for name in files:
        p = out / name
        with wave.open(str(p)) as f:
            frames, rate, channels = f.getnframes(), f.getframerate(), f.getnchannels()
        arr = read_pcm(p)
        assert frames == SECONDS * SR and rate == SR
        checks.append(
            {
                "file": str(p),
                "duration": frames / rate,
                "sampleRate": rate,
                "channels": channels,
                "peakDbfs": round(float(20 * np.log10(max(abs(arr).max(), 1e-8))), 3),
                "clippedSamples": int(np.sum(abs(arr) >= 0.9999)),
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
        )
    timing = json.loads((out / "narration-timing.json").read_text())
    assert len(timing["scenes"]) == len(story["scenes"]) == 12
    assert all(s["voiceEnd"] <= s["sceneStart"] + s["sceneDuration"] for s in timing["scenes"])
    assert all(0 <= c["start"] < c["end"] <= SECONDS for c in timing["cues"])
    assert all(a["end"] <= b["start"] for a, b in zip(timing["cues"], timing["cues"][1:]))
    expected_words = " ".join(s["narration"] for s in story["scenes"]).split()
    actual_words = " ".join(w["text"] for w in timing["words"]).split()
    clean = lambda word: "".join(c.lower() for c in word if c.isalnum())
    assert list(map(clean, expected_words)) == list(map(clean, actual_words)), "Speech boundary text differs from narration"
    srt = (out / "english.srt").read_text()
    assert srt.isascii()
    (out / "technical-checks.json").write_text(
        json.dumps(
            {
                "result": "passed",
                "storyboardDuration": SECONDS,
                "sceneCount": 12,
                "narrationWords": len(expected_words),
                "subtitleCues": len(timing["cues"]),
                "textAlignment": "All supplied spoken words match the English script in order",
                "humanListening": "Not performed by this utility; parent should audition review-sample.mp3 and final mix",
                "files": checks,
            },
            indent=2,
        )
        + "\n"
    )
    print(json.dumps(checks, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--stage", choices=["all", "voice", "score", "mix", "verify"], default="all")
    args = parser.parse_args()
    out = args.out.resolve()
    if out != DEFAULT_OUT and DEFAULT_OUT not in out.parents:
        raise SystemExit("Outputs must stay in the authorized private film/audio directory")
    out.mkdir(parents=True, exist_ok=True)
    story = load_story()
    if args.stage in {"all", "voice"}:
        asyncio.run(narration(story, out))
    if args.stage in {"all", "score"}:
        music(out)
    if args.stage in {"all", "mix"}:
        mix(out)
    if args.stage in {"all", "verify"}:
        verify(story, out)


if __name__ == "__main__":
    main()
