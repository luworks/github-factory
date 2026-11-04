#!/usr/bin/env python3
"""Build an English atlas plate and moving montage from actual captured worlds."""

import argparse
import json
import random
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--captures", type=Path, required=True)
p.add_argument("--assets-dir", type=Path, required=True)
p.add_argument("--output-dir", type=Path, required=True)
a = p.parse_args()
rows = json.loads(a.captures.read_text())
if len(rows) != 20 or len({r["requested"].lower() for r in rows}) != 20:
    raise ValueError("Exactly twenty unique real captures are required.")
if any(r.get("lang") != "en" or r.get("cjk") for r in rows):
    raise ValueError("All source views must be English without visible CJK.")
a.output_dir.mkdir(parents=True, exist_ok=True)
font_root = Path("/usr/share/fonts/truetype/dejavu")


def font(n, bold=False, mono=False):
    name = "DejaVuSansMono.ttf" if mono else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    return ImageFont.truetype(str(font_root / name), n)


im = Image.new("RGB", (1920, 1080), "#071219")
d = ImageDraw.Draw(im)
rng = random.Random(426)
for _ in range(170):
    x, y = rng.randrange(1920), rng.randrange(1080)
    d.ellipse((x, y, x + 1, y + 1), fill="#51666a")
d.text((56, 35), "THE OPEN-SOURCE ATLAS", font=font(17, mono=True), fill="#ee9865")
d.text((54, 67), "Twenty codebases. Twenty worlds.", font=font(39, True), fill="#e9ecde")
for i, r in enumerate(rows):
    source = a.assets_dir / "worlds" / (r["requested"].replace("/", "--").lower() + ".png")
    image = Image.open(source).convert("RGB")
    w, h = image.size
    # Actual canvas stage only. Keep the complete unmodified UI PNG as the source artifact.
    image = image.crop((round(w * 240 / 1920), round(h * 114 / 1080), round(w * 1600 / 1920), round(h * 1050 / 1080)))
    tile = ImageOps.fit(image, (348, 166), method=Image.Resampling.LANCZOS)
    x, y = 56 + i % 5 * 365, 145 + i // 5 * 215
    im.paste(tile, (x, y))
    d.rectangle((x - 1, y - 1, x + 348, y + 166), outline="#536963", width=1)
    label = r["requested"]
    n = 17
    while d.textlength(label, font=font(n, mono=True)) > 345:
        n -= 1
    d.text((x + 2, y + 175), label, font=font(n, mono=True), fill="#e9ecde")
    d.text((x + 2, y + 197), r["style"].upper(), font=font(10, mono=True), fill="#9bb09c")
d.text(
    (56, 1034),
    "REAL PUBLIC REPOSITORIES  |  BOUNDED ARCHITECTURE SURVEYS  |  COVERAGE MAY BE SAMPLED",
    font=font(14, mono=True),
    fill="#a7b6a8",
)
plate = a.output_dir / "atlas-20.png"
im.save(plate)
clip = a.assets_dir / "09-atlas.mp4"
subprocess.run(
    [
        "ffmpeg",
        "-hide_banner",
        "-y",
        "-threads",
        "4",
        "-filter_threads",
        "4",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        str(plate),
        "-vf",
        "zoompan=z='min(zoom+0.00004,1.025)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=1920x1080:fps=30,fade=t=in:d=0.35,fade=t=out:st=18.65:d=0.35,format=yuv420p",
        "-t",
        "19",
        "-r",
        "30",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-threads",
        "4",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(clip),
    ],
    check=True,
)
print(json.dumps({"plate": str(plate), "clip": str(clip), "captures": 20, "duration": 19, "source_manifest": str(a.captures)}))
