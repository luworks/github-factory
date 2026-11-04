#!/usr/bin/env python3
"""Offline Moonshot film compositor. Pillow + FFmpeg; no network or model calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import resource
import shutil
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS = 1920, 1080, 30
CPU_LIMIT = 4
STAGE = (80, 203, 1760, 742)
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
EXPECTED_DURATIONS = [14, 12, 12, 20, 18, 20, 17, 18, 19, 13, 10, 7]
SHOT_NAMES = {"landing", "architecture", "styles", "activity", "guide", "atlas", "brand"}
CJK = re.compile(r"[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
EXTENSIONS = (".webm", ".mp4", ".mov", ".mkv", ".png", ".jpg", ".jpeg", ".webp")
LUNAR, SAGE, ORANGE = "#eeeedd", "#b5c7a1", "#ed9864"


def fail(message):
    raise ValueError(message)


def english(value, label):
    if CJK.search(str(value)):
        fail(f"{label} contains non-English CJK text. Correct the source before rendering.")


def run(command, log=None):
    # Bound actual CPU scheduling too: FFmpeg owns several independent pools.
    cpus = set(sorted(os.sched_getaffinity(0))[:CPU_LIMIT]) if hasattr(os, "sched_getaffinity") else None
    result = subprocess.run(
        [str(x) for x in command], capture_output=True, text=True, preexec_fn=(lambda: os.sched_setaffinity(0, cpus)) if cpus else None
    )
    if log:
        Path(log).write_text(result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {command[0]}\n{result.stderr[-6000:]}")
    return result.stdout


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def font(size, bold=False, mono=False):
    name = "DejaVuSansMono" if mono else "DejaVuSans"
    return ImageFont.truetype(str(FONT_DIR / f"{name}{'-Bold' if bold else ''}.ttf"), size)


def fitted(draw, value, size, max_width, bold=False):
    while draw.textlength(value, font=font(size, bold)) > max_width and size > 22:
        size -= 1
    return font(size, bold)


def wrapped(draw, value, size, max_width, bold=False):
    if "\n" in value:
        return [line for paragraph in value.splitlines() for line in wrapped(draw, paragraph, size, max_width, bold)]
    lines, line = [], ""
    for word in value.split():
        candidate = f"{line} {word}".strip()
        if line and draw.textlength(candidate, font=font(size, bold)) > max_width:
            lines.append(line)
            line = word
        else:
            line = candidate
    return lines + ([line] if line else [])


def background(path):
    """Original deterministic starfield, topographic grid and planetary limb."""
    im = Image.new("RGB", (WIDTH, HEIGHT), "#080f17")
    draw = ImageDraw.Draw(im)
    for y in range(HEIGHT):
        p = y / HEIGHT
        draw.line((0, y, WIDTH, y), fill=(8 + int(5 * p), 15 + int(9 * p), 23 + int(12 * p)))
    rng = random.Random(20261104)
    for _ in range(340):
        x, y = rng.randrange(WIDTH), rng.randrange(HEIGHT)
        brightness = rng.randrange(45, 110)
        draw.ellipse((x, y, x + 1, y + 1), fill=(brightness, brightness + 8, brightness + 8))
    grid = (29, 44, 49)
    for x in range(-800, 2800, 130):
        draw.line((960 + (x - 960) * 0.09, 500, x, 1080), fill=grid, width=1)
    for y in (555, 600, 660, 740, 845, 985):
        draw.line((0, y, 1920, y), fill=grid, width=1)
    for r in (440, 454, 600, 760):
        draw.arc((1350 - r, 390 - r, 1350 + r, 390 + r), 130, 322, fill=(40, 59, 63), width=1)
    draw.line((80, 1018, 1840, 1018), fill=(47, 62, 65))
    im.save(path)


def orbital(path):
    im = Image.new("RGBA", (700, 700))
    d = ImageDraw.Draw(im)
    for r, color in ((292, (163, 190, 164, 70)), (255, (163, 190, 164, 24)), (327, (163, 190, 164, 32))):
        d.ellipse((350 - r, 350 - r, 350 + r, 350 + r), outline=color, width=2)
    for angle in range(0, 360, 15):
        a = math.radians(angle)
        r1, r2 = (313, 329) if angle % 45 == 0 else (320, 326)
        d.line(
            (350 + math.cos(a) * r1, 350 + math.sin(a) * r1, 350 + math.cos(a) * r2, 350 + math.sin(a) * r2),
            fill=(181, 199, 161, 100),
            width=2,
        )
    for angle, color in ((25, (237, 152, 100, 255)), (160, (181, 199, 161, 210)), (270, (238, 238, 221, 160))):
        a = math.radians(angle)
        x, y = 350 + 292 * math.cos(a), 350 + 292 * math.sin(a)
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color)
    # A new lunar lander mark, constructed entirely from simple geometry.
    d.arc((258, 258, 442, 442), 18, 330, fill=(181, 199, 161, 170), width=2)
    d.polygon(
        ((350, 296), (389, 319), (389, 365), (350, 388), (311, 365), (311, 319)),
        fill=(18, 35, 42, 245),
        outline=(181, 199, 161, 210),
        width=3,
    )
    d.line((321, 376, 305, 402, 296, 402), fill=(237, 152, 100, 255), width=3)
    d.line((379, 376, 395, 402, 404, 402), fill=(237, 152, 100, 255), width=3)
    d.ellipse((341, 331, 359, 349), fill=(237, 152, 100, 255))
    im.save(path)


def typography(scene, index, path):
    im = Image.new("RGBA", (WIDTH, HEIGHT))
    d = ImageDraw.Draw(im)
    brand = scene["shot"] == "brand"
    # This is an editorial chapter index, never a measured product statistic.
    d.text((82, 37), "moonshot", font=font(25, True), fill=LUNAR)
    d.ellipse((224, 55, 231, 62), fill=ORANGE)
    d.text((1490, 43), "YOUR CODEBASE, A LIVING WORLD", font=font(12, mono=True), fill=SAGE)
    eyebrow = str(scene.get("eyebrow") or "REPOSITORY EXPLORER").upper()
    d.text((82, 105 if not brand else 266), eyebrow, font=font(16, mono=True), fill=ORANGE)
    title = str(scene["title"])
    if brand:
        lines = wrapped(d, title, 86, 1120, True)
        if len(lines) > 3:
            fail(f"Title too long for cinematic card: {title}")
        for n, line in enumerate(lines):
            d.text((76, 310 + n * 104), line, font=font(86, True), fill=LUNAR)
        d.line((82, 330 + len(lines) * 104, 230, 330 + len(lines) * 104), fill=ORANGE, width=3)
        d.text((82, 365 + len(lines) * 104), "EXPLORE THE SYSTEM. FIND YOUR NEXT MOVE.", font=font(17, mono=True), fill=SAGE)
    else:
        d.text((78, 131), title, font=fitted(d, title, 43, 1700, True), fill=LUNAR)
        x, y, w, h = STAGE
        d.rounded_rectangle((x - 2, y - 2, x + w + 2, y + h + 2), radius=13, outline=(181, 199, 161, 115), width=2)
        d.line((x, y - 15, x + 80, y - 15), fill=ORANGE, width=3)
    d.text((82, 1039), "MOONSHOT / ORIGINAL PRODUCT FILM", font=font(12, mono=True), fill=SAGE)
    d.text((1688, 1039), f"CHAPTER {index + 1:02d}", font=font(12, mono=True), fill=SAGE)
    im.save(path)


def load_storyboard(path):
    story = json.loads(path.read_text(encoding="utf-8"))
    if story.get("duration") != 180:
        fail("Storyboard duration must be exactly 180 seconds.")
    scenes = story.get("scenes", [])
    if len(scenes) != 12:
        fail("The film contract requires 12 scenes.")
    cursor = 0
    ids = set()
    for i, (scene, expected) in enumerate(zip(scenes, EXPECTED_DURATIONS)):
        if scene.get("duration") != expected or scene.get("start") != cursor:
            fail(f"Scene {i} must start at {cursor} and last {expected} seconds.")
        if scene.get("id") in ids or not scene.get("id"):
            fail("Each scene needs a unique id.")
        ids.add(scene["id"])
        if scene.get("shot") not in SHOT_NAMES:
            fail(f"Unsupported shot: {scene.get('shot')}")
        for key in ("eyebrow", "title", "narration"):
            english(scene.get(key, ""), f"Scene {i} {key}")
        if not scene.get("title"):
            fail(f"Scene {i} title is empty.")
        cursor += expected
    if cursor != 180:
        fail("Storyboard timeline is not 180 seconds.")
    english(story.get("title", ""), "Film title")
    return story


def timestamp(value):
    hours, minutes, rest = value.replace(".", ",").split(":")
    seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def read_srt(path):
    body = path.read_text(encoding="utf-8-sig")
    english(body, "Subtitle file")
    cues = []
    for block in re.split(r"\n\s*\n", body.strip()):
        lines = block.splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            fail(f"Malformed SRT block: {block[:80]}")
        a, b = [timestamp(x.strip()) for x in lines[1].split("-->")]
        content = " ".join(lines[2:]).strip()
        if a < 0 or b <= a or b > 180.05 or (cues and a < cues[-1][1] - 0.001):
            fail("SRT cues overlap or exceed the 180-second timeline.")
        if not content:
            fail("Subtitle cue is empty.")
        if len(content) > 102:
            fail(f"Subtitle cue is too long for one readable line ({len(content)} characters); split it in the audio source.")
        cues.append((a, b, content))
    if not cues:
        fail("English subtitles are required.")
    return cues


def ass_time(seconds):
    cs = round(seconds * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def write_ass(cues, path):
    # Deliberately fixed safe area: captions stay below the product viewport.
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Film,DejaVu Sans,28,&H00EDEEEE,&H00000000,&H00170F08,&H00170F08,0,0,0,0,100,100,0,0,3,7,0,2,120,120,75,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for a, b, text in cues:
        # Never interpret untrusted SRT content as ASS formatting/control code.
        text = text.replace("\\", "/").replace("{", "(").replace("}", ")")
        if len(text) > 102:
            fail(f"Subtitle cue is too long for one readable line ({len(text)} characters); split it in the audio source.")
        lines.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Film,,0,0,0,,{text}")
    path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")


def asset_spec(scene, assets_dir, manifest):
    if scene["shot"] == "brand":
        return None
    shots = manifest.get("shots", manifest)
    spec = scene.get("capture") or shots.get(scene["id"]) or shots.get(scene["shot"]) or {}
    if isinstance(spec, str):
        spec = {"path": spec}
    spec = dict(spec)
    name = spec.get("path") or spec.get("file")
    if name:
        path = (assets_dir / name).resolve()
        if not path.is_relative_to(assets_dir.resolve()):
            fail("Capture paths must stay inside --assets-dir.")
        if not path.is_file():
            fail(f"Missing capture: {path}")
    else:
        candidates = []
        for stem in (scene["id"], scene["shot"]):
            candidates.extend(assets_dir / (stem + ext) for ext in EXTENSIONS if (assets_dir / (stem + ext)).is_file())
        if not candidates:
            fail(f"No asset for {scene['id']} / {scene['shot']}; add a clip or manifest entry.")
        path = candidates[0]
    if re.search(r"(^|[-_.])zh([-_.]|$)", path.name, re.I):
        fail(f"Chinese capture is prohibited: {path.name}")
    info = probe(path)
    stream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if not stream:
        fail(f"Capture has no image/video stream: {path}")
    w, h = stream["width"], stream["height"]
    # The real UI language toggle includes Chinese even in English mode.
    # Remove the whole source header, preserving the content below it.
    default_top = round(w * (94 if scene["shot"] in ("landing", "atlas") else 65) / 1440)
    crop = spec.get("crop", [0, default_top, w, h - default_top])
    if len(crop) != 4 or any(not isinstance(n, int) for n in crop):
        fail("Capture crop must be integer [x,y,width,height].")
    x, y, cw, ch = crop
    if x < 0 or y < 0 or cw <= 0 or ch <= 0 or x + cw > w or y + ch > h:
        fail(f"Crop {crop} exceeds capture dimensions {w}x{h}.")
    # Very tall screenshots are an honest editorial crop, not a tiny full-page thumbnail.
    max_h = round(cw * STAGE[3] / STAGE[2])
    if ch > max_h * 1.65 and "crop" not in spec:
        ch = min(ch, max_h)
    spec.update(path=str(path), crop=[x, y, cw, ch], dimensions=[w, h], image=path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    if spec.get("english") is False:
        fail(f"Capture is marked non-English: {path}")
    return spec


def ffmpeg_base(threads):
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-threads",
        threads,
        "-filter_threads",
        threads,
        "-filter_complex_threads",
        threads,
    ]


def render_scene(scene, index, spec, duration, work, args):
    frames = round(duration * FPS)
    plate = work / f"title-{index:02d}.png"
    typography(scene, index, plate)
    out = work / f"scene-{index:02d}.mp4"
    cmd = ffmpeg_base(args.threads)
    cmd += [
        "-loop",
        "1",
        "-framerate",
        FPS,
        "-i",
        work / "background.png",
        "-loop",
        "1",
        "-framerate",
        FPS,
        "-i",
        work / "orbital.png",
        "-loop",
        "1",
        "-framerate",
        FPS,
        "-i",
        plate,
    ]
    filters = [
        f"[0:v]fps={FPS},format=yuv420p[bg]",
        "[1:v]format=rgba,rotate=angle='0.035*t':ow=iw:oh=ih:c=none[orbit]",
        "[bg][orbit]overlay=x='1230+12*sin(t/3)':y='145+8*cos(t/4)':shortest=1[space]",
    ]
    if spec:
        if spec["image"]:
            cmd += ["-loop", "1", "-framerate", FPS]
        elif spec.get("start", 0):
            cmd += ["-ss", str(spec["start"])]
        cmd += ["-threads", args.threads, "-i", spec["path"]]
        x, y, w, h = spec["crop"]
        sx, sy, sw, sh = STAGE
        # Quiet 0.6% drift keeps historic stills alive without hiding product edges.
        filters += [
            f"[3:v]crop={w}:{h}:{x}:{y},fps={FPS},"
            f"scale={sw}:{sh}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={sw}:{sh}:(ow-iw)/2:(oh-ih)/2:color=0x101b22,"
            f"zoompan=z='1+0.006*sin(on/{FPS * duration}*PI)':x='iw/2-iw/zoom/2':"
            f"y='ih/2-ih/zoom/2':d=1:s={sw}x{sh}:fps={FPS},"
            f"tpad=stop_mode=clone:stop_duration={duration},setsar=1[capture]",
            f"[space][capture]overlay={sx}:{sy}:shortest=1[framed]",
        ]
    else:
        filters += ["[space]null[framed]"]
    if scene["shot"] == "brand":
        filters += [
            "[2:v]format=rgba,fade=t=in:st=0.10:d=0.65:alpha=1[type]",
            "[framed][type]overlay=x='-42*exp(-1.3*t)':y=0:shortest=1[titled]",
        ]
    else:
        filters += ["[framed][2:v]overlay=x=0:y='6*exp(-3*t)':shortest=1[titled]"]
    filters += [f"[titled]fade=t=in:st=0:d=0.20,fade=t=out:st={duration - 0.22}:d=0.22,setsar=1,format=yuv420p[out]"]
    cmd += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[out]",
        "-an",
        "-frames:v",
        frames,
        "-c:v",
        "libx264",
        "-preset",
        args.preset,
        "-crf",
        args.crf,
        "-threads",
        args.threads,
        "-r",
        FPS,
        "-pix_fmt",
        "yuv420p",
        out,
    ]
    print(f"Rendering chapter {index + 1:02d}: {scene['id']} ({duration:.2f}s)", flush=True)
    run(cmd, work / f"scene-{index:02d}.log")
    return out


def escaped_filter_path(path):
    # FFmpeg filter grammar, independent of shell quoting (there is no shell).
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "'\\''")


def validate_output(path, duration):
    info = probe(path)
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    issues = []
    expected_frames = round(duration * FPS)
    for key, value in [("codec_name", "h264"), ("width", WIDTH), ("height", HEIGHT), ("pix_fmt", "yuv420p")]:
        if video.get(key) != value:
            issues.append(f"{key}: expected {value}, got {video.get(key)}")
    if int(video.get("nb_frames", 0)) != expected_frames:
        issues.append(f"Expected {expected_frames} frames; got {video.get('nb_frames')}")
    if abs(float(info["format"]["duration"]) - duration) > 0.001:
        issues.append(f"Container duration is {info['format']['duration']}, expected {duration}")
    if not audio or audio.get("codec_name") != "aac":
        issues.append("AAC audio missing")
    if audio and abs(float(audio.get("duration", 0)) - duration) > 0.03:
        issues.append(f"Audio duration is {audio.get('duration')}, expected {duration}")
    # Parse actual top-level MP4 atoms. A string search could match payload data.
    atoms = []
    with path.open("rb") as f:
        total = path.stat().st_size
        while f.tell() + 8 <= total:
            pos = f.tell()
            size = int.from_bytes(f.read(4), "big")
            kind = f.read(4).decode("ascii", errors="replace")
            if size == 1:
                size = int.from_bytes(f.read(8), "big")
            if size == 0:
                size = total - pos
            if size < 8:
                break
            atoms.append(kind)
            f.seek(pos + size)
    if "moov" not in atoms or "mdat" not in atoms or atoms.index("moov") > atoms.index("mdat"):
        issues.append("MP4 is not faststart")
    if issues:
        fail("Output verification failed: " + "; ".join(issues))
    return {
        "duration": float(info["format"]["duration"]),
        "frames": expected_frames,
        "video": {k: video.get(k) for k in ("codec_name", "width", "height", "pix_fmt", "r_frame_rate")},
        "audio": {k: audio.get(k) for k in ("codec_name", "sample_rate", "channels", "duration")},
        "faststart": True,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def main():
    global CPU_LIMIT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storyboard", type=Path, required=True)
    parser.add_argument("--assets-dir", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, required=True)
    parser.add_argument("--mixed-audio", type=Path, help="Use a reviewed, already-mastered 180-second soundtrack without remixing it")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4, choices=range(1, 5))
    parser.add_argument("--preset", default="fast", choices=["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"])
    parser.add_argument("--crf", type=int, default=19, choices=range(14, 29))
    parser.add_argument("--smoke-seconds", type=float, help="SMOKE ONLY: equal parts brand and first product shot; no delivery claim")
    parser.add_argument("--preflight", action="store_true", help="Validate all source files and print the resolved plan without rendering")
    parser.add_argument("--keep-intermediates", action="store_true")
    args = parser.parse_args()
    CPU_LIMIT = args.threads
    started = time.monotonic()
    for binary in ("ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            fail(f"{binary} is required.")
    story = load_storyboard(args.storyboard)
    manifest_path = args.assets_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    all_specs = [asset_spec(s, args.assets_dir, manifest) for s in story["scenes"]]
    narration = args.audio_dir / "narration.wav"
    score = args.audio_dir / "score.wav"
    subtitles = args.audio_dir / "english.srt"
    for p in (narration, score, subtitles):
        if not p.is_file():
            fail(f"Missing required audio/subtitle input: {p}")
    cues = read_srt(subtitles)
    audio_details = {}
    for p in (narration, score):
        info = probe(p)
        if not any(s["codec_type"] == "audio" for s in info["streams"]):
            fail(f"Audio input has no audio stream: {p}")
        audio_details[p.name] = {"path": str(p), "duration": float(info["format"]["duration"])}
    if audio_details["narration.wav"]["duration"] > 180.05:
        fail("Narration exceeds 180 seconds; retime it in the audio lane before rendering.")
    if args.mixed_audio:
        if not args.mixed_audio.is_file():
            fail("Missing reviewed mixed soundtrack.")
        info = probe(args.mixed_audio)
        streams = [s for s in info["streams"] if s["codec_type"] == "audio"]
        if len(streams) != 1 or abs(float(info["format"]["duration"]) - 180) > 0.05:
            fail("Reviewed mixed soundtrack must contain exactly one 180-second audio stream.")
        if int(streams[0].get("sample_rate", 0)) != 48000 or streams[0].get("channels") != 2:
            fail("Reviewed mixed soundtrack must be 48 kHz stereo.")
    duration = 180.0
    selection = list(enumerate(story["scenes"]))
    smoke = bool(args.smoke_seconds)
    if args.smoke_seconds is not None:
        if not 2 <= args.smoke_seconds <= 30:
            fail("--smoke-seconds must be between 2 and 30.")
        duration = round(args.smoke_seconds * FPS / 2) * 2 / FPS
        brand = next((p for p in selection if p[1]["shot"] == "brand"), None)
        product = next((p for p in selection if p[1]["shot"] != "brand"), None)
        if not brand or not product:
            fail("Smoke requires a brand card and a product shot.")
        selection = [brand, product]
    plan = []
    for index, scene in selection:
        spec = all_specs[index]
        plan.append(
            {
                "index": index,
                "scene": scene["id"],
                "shot": scene["shot"],
                "duration": duration / 2 if smoke else scene["duration"],
                "capture": spec,
            }
        )
    if not smoke and not any(x["shot"] != "brand" and x["capture"] and not x["capture"]["image"] for x in plan):
        fail("Delivery requires real moving product footage; screenshots alone are permitted only in smoke mode.")
    if args.preflight:
        print(
            json.dumps(
                {
                    "mode": "smoke" if smoke else "delivery",
                    "duration": duration,
                    "scenes": plan,
                    "audio": audio_details,
                    "subtitle_cues": len(cues),
                },
                indent=2,
            )
        )
        return
    args.output_dir.mkdir(parents=True, exist_ok=True)
    work = args.output_dir / ("_smoke_work" if smoke else "_render_work")
    work.mkdir(exist_ok=True)
    background(work / "background.png")
    orbital(work / "orbital.png")
    if smoke:
        cues = [
            (0.25, duration / 2 - 0.15, "SMOKE TEST / Source footage / Validation audio"),
            (duration / 2 + 0.15, duration - 0.25, "COMPOSITOR VALIDATION / Not the final product film"),
        ]
    ass = work / "english.ass"
    write_ass(cues, ass)
    files = []
    for entry, (index, scene) in zip(plan, selection):
        files.append(render_scene(scene, index, entry["capture"], entry["duration"], work, args))
    # Relative, generated names avoid concat's path escaping ambiguities.
    concat = work / "concat.txt"
    concat.write_text("".join(f"file '{p.name}'\n" for p in files), encoding="utf-8")
    output = args.output_dir / ("SMOKE-compositor.mp4" if smoke else "moonshot-film.mp4")
    # Narration normalization precedes sidechain detection. Duck only the score.
    af = (
        f"[0:a]aresample=48000,apad,atrim=duration={duration},"
        "loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000,asplit=2[voice][detector];"
        f"[1:a]aresample=48000,atrim=duration={duration},asetpts=PTS-STARTPTS,"
        f"volume=0.20,afade=t=in:d=1.0,afade=t=out:st={max(0, duration - 2.0)}:d=2[score];"
        "[score][detector]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=650:makeup=1[ducked];"
        "[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:latency=1[audio]"
    )
    # Materialize audio first; inspectable PCM also isolates audio from video EOS.
    # The explicit resample after loudnorm prevents 192k/48k sidechain EOF loss.
    mix = work / "mix.wav"
    if args.mixed_audio:
        # Preserve the audio lane's sound design, mastering and synchronized ducking.
        # Full-film assembly is bounded to 180s; smoke intentionally uses an excerpt.
        shutil.copyfile(args.mixed_audio, mix)
    else:
        run(
            ffmpeg_base(args.threads)
            + [
                "-i",
                narration,
                "-stream_loop",
                "-1",
                "-i",
                score,
                "-filter_complex",
                af,
                "-map",
                "[audio]",
                "-t",
                str(duration),
                "-c:a",
                "pcm_s16le",
                "-ar",
                "48000",
                "-ac",
                "2",
                mix,
            ],
            work / "mix.log",
        )
    cmd = ffmpeg_base(args.threads) + [
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        concat,
        "-i",
        mix,
        "-vf",
        f"ass=filename='{escaped_filter_path(ass)}',format=yuv420p",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-preset",
        args.preset,
        "-crf",
        args.crf,
        "-threads",
        args.threads,
        "-pix_fmt",
        "yuv420p",
        "-r",
        FPS,
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-metadata",
        "title=Moonshot — Your codebase, a living world",
        "-metadata",
        "language=eng",
        "-metadata:s:a:0",
        "language=eng",
        output,
    ]
    print("Assembling film, English captions and ducked audio", flush=True)
    run(cmd, work / "assemble.log")
    checks = validate_output(output, duration)
    poster = args.output_dir / ("SMOKE-poster.png" if smoke else "poster.png")
    # Use the rendered product chapter, not an unrepresentative black fade frame.
    poster_time = (
        duration * 0.75 if smoke else next((s["start"] + min(3, s["duration"] / 2) for s in story["scenes"] if s["shot"] != "brand"), 3)
    )
    run(ffmpeg_base(args.threads) + ["-ss", str(poster_time), "-i", output, "-frames:v", "1", "-update", "1", poster])
    sidecar = args.output_dir / ("SMOKE-english.srt" if smoke else "english.srt")
    if not smoke:
        shutil.copyfile(subtitles, sidecar)
    else:

        def srt_time(t):
            ms = round(t * 1000)
            return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"

        sidecar.write_text(
            "\n\n".join(f"{n + 1}\n{srt_time(a)} --> {srt_time(b)}\n{text}" for n, (a, b, text) in enumerate(cues)) + "\n", encoding="utf-8"
        )
    sources = []
    for entry in plan:
        if entry["capture"]:
            p = Path(entry["capture"]["path"])
            sources.append(
                {
                    "scene": entry["scene"],
                    "path": str(p),
                    "sha256": sha256(p),
                    "crop": entry["capture"]["crop"],
                    "still": entry["capture"]["image"],
                }
            )
    report = {
        "mode": "SMOKE / NOT DELIVERY" if smoke else "delivery",
        "checks": checks,
        "scenes": plan,
        "sources": sources,
        "storyboard": {"path": str(args.storyboard), "sha256": sha256(args.storyboard)},
        "audio": {p.name: {**audio_details[p.name], "sha256": sha256(p)} for p in (narration, score)},
        "subtitles": {"path": str(subtitles), "sha256": sha256(subtitles), "cues": len(cues)},
        "threads_limit": args.threads,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "resources": {
            "subprocess_peak_rss_kib": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
            "subprocess_user_cpu_seconds": round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime, 2),
            "cpu_affinity": sorted(os.sched_getaffinity(0))[: args.threads] if hasattr(os, "sched_getaffinity") else None,
        },
        "outputs": {"film": str(output), "poster": str(poster), "srt": str(sidecar)},
        "limits": [
            "English capture provenance requires parent verification; no OCR guarantee.",
            "Procedural motion illustrates design, never runtime traffic.",
            "No product success, CI or repository coverage statistics are invented.",
        ],
    }
    if (args.audio_dir / "manifest.json").exists():
        report["audio_manifest"] = {"path": str(args.audio_dir / "manifest.json"), "sha256": sha256(args.audio_dir / "manifest.json")}
    if args.mixed_audio:
        report["reviewed_soundtrack"] = {
            "path": str(args.mixed_audio),
            "sha256": sha256(args.mixed_audio),
            "mode": "preserved master; no additional normalization or ducking",
        }
    report_path = args.output_dir / ("SMOKE-render-report.json" if smoke else "render-report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if not args.keep_intermediates:
        for p in files:
            p.unlink()
    print(
        json.dumps(
            {
                "film": str(output),
                "poster": str(poster),
                "report": str(report_path),
                "verified": checks,
                "elapsed_seconds": report["elapsed_seconds"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, StopIteration, KeyError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
