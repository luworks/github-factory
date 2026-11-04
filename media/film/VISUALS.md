# Moonshot original film compositor

`render.py` is an offline Pillow/FFmpeg compositor. No browser, credentials,
model calls, network requests, application writes or paid dependencies are used.
All visible editorial copy and captions are English. Original artwork consists
of a dark lunar palette, a warm orange signal, orbital lander geometry, a seeded
starfield and a receding grid. Nothing is copied from a film or game. Typography
uses the system DejaVu family (Bitstream Vera / DejaVu license).

## Delivery command

Run from the project root after the capture and audio lanes finish:

```sh
python3 code/moonshot/media/film/render.py \
  --storyboard /absolute/film/storyboard.json \
  --assets-dir /absolute/film/assets \
  --audio-dir /absolute/film/audio \
  --mixed-audio /absolute/film/audio/mix.wav \
  --output-dir /absolute/film/output \
  --threads 4
```

Use only the authorized private output directory. `--preflight` resolves and
validates every input without rendering. `--preset veryfast` trades compression
efficiency for speed; the default is `fast`, CRF 19. Rendering is sequential,
with FFmpeg codec/filter pools limited to four threads and, on Linux, subprocess
CPU affinity limited to four allowed CPUs. The utility never creates a browser
capture. It does not overwrite source footage, score, narration or storyboard.

Outputs are `moonshot-film.mp4`, `poster.png`, `english.srt`, and
`render-report.json`. The MP4 is **180.000 seconds**, **5400 frames**, 1920×1080,
30 fps, H.264/yuv420p, stereo 48 kHz AAC, with `moov` before `mdat` (faststart).
These properties are checked from the finished file, including parsed MP4
atoms. The report records source hashes, crops, exact input identities, CPU
limit, elapsed render time and verification results. Intermediate scene MP4s
are deleted after successful assembly unless `--keep-intermediates` is set;
small original generated plates and FFmpeg logs remain in `_render_work/`.

## Storyboard and capture contract

The storyboard has `{title, duration:180, scenes:[...]}`. Each scene has
`id`, `start`, `duration`, `eyebrow`, `title`, `narration` and `shot`.
Exactly twelve contiguous scene durations are required:
`14,12,12,20,18,20,17,18,19,13,10,7`. Accepted shots are `landing`,
`architecture`, `styles`, `activity`, `guide`, `atlas` and `brand`.
`brand` uses the original animated title/reveal/outro system and needs no capture.

Assets are resolved first by scene id, then by shot name. Supported extensions
are `.webm`, `.mp4`, `.mov`, `.mkv`, `.png`, `.jpg`, `.jpeg`, `.webp` in that order.
The full delivery requires at least one real moving product clip; a slideshow
cannot pass as the delivered film. Supply motion captures for **all** product
chapters when available. Clips keep their original pace, then hold the last
frame when too short. They are never sped up or reverse-looped. A gentle 0.6%
camera drift and short dark dip transitions retain text legibility.

Optional `assets/manifest.json` provides precise editorial control:

```json
{
  "shots": {
    "architecture": {
      "path": "architecture.webm",
      "crop": [0, 87, 1920, 993],
      "start": 1.0,
      "english": true
    },
    "styles": { "path": "styles.mp4", "english": true }
  }
}
```

Keys may be scene ids or shot names. A scene's optional `capture` object takes
precedence over the manifest. Crop values are source pixels `[x,y,width,height]`.
`start` is a trim offset for a video. No manifest path may escape `assets-dir`.
Content is fitted inside a 1760×742 product stage without stretching. A very
tall historical screenshot gets a top-content crop instead of unreadable
full-page reduction; specify a crop explicitly for a different focus.

**English capture boundary:** set `localStorage moonshot.lang=en` in the parent's
capture browser. The app's English language switch still contains Chinese text.
By default, this compositor crops the entire source header: 94 CSS pixels on
landing/atlas, 65 on other shots, scaled relative to a 1440-pixel-wide source.
That heuristic matches the supplied historical 1440-pixel screenshots. For new
viewport sizes, browser zoom, device-pixel ratios or different routes, inspect
the frames and specify an explicit crop. The compositor rejects `-zh` filenames,
`english:false`, and CJK in storyboard/captions; it does **not** claim pixel OCR
can guarantee English. Parent must inspect final footage for Chinese text in
repo titles or other content. Keep original input frames unchanged.

## Audio and captions

The audio lane supplies `audio/narration.wav`, `audio/score.wav` and
`audio/english.srt`. Narration can be shorter than 180 seconds and is padded with
silence; longer narration is rejected instead of silently truncating speech.
The score loops to the target duration, fades in/out, and is mixed at 20% before
sidechain compression driven by the normalized narration. Narration target is
−16 LUFS; the output mix has a limiter. Listen to the assembled mix: loudness and
voice/music balance remain human acceptance checks.

SRT cues must be ordered, non-overlapping and inside 0–180 seconds. Each cue
must contain at most 102 characters for a readable single subtitle line. Split
long sentences in the audio lane. English SRT is converted into a safe internal
ASS track and burned into every output; the original English SRT is also copied
beside the MP4. Captions sit below the product viewport, above the footer. ASS
control characters in subtitle text cannot override caption style. A supplied
`audio/manifest.json` is recorded by hash; final absolute WAV and SRT timing are
authoritative. The compositor does not guess alignment from per-scene voice
files or retime a sibling's narration.

## Bounded smoke

```sh
python3 code/moonshot/media/film/render.py \
  --storyboard /absolute/smoke/storyboard.json \
  --assets-dir /absolute/smoke/assets \
  --audio-dir /absolute/smoke/audio \
  --output-dir /absolute/film/output/compositor-smoke \
  --smoke-seconds 8 --preset veryfast
```

Smoke mode uses equal-duration excerpts: the first brand chapter and the first
product chapter. It validates the full input contract, but replaces captions
with explicit smoke notices. Outputs have a `SMOKE-` prefix and the report says
`SMOKE / NOT DELIVERY`. Historical English screenshots and synthetic audio are
permitted here. Smoke is not evidence of current browser footage, live app
acceptance, real narration alignment, final music balance, or a completed
180-second film. The parent performs the final real-footage render once.

## Evidence and visual meaning

Original orbit/grid/star animation is editorial design. It never claims runtime
traffic, current CI success, repository ranking or complete data coverage.
No numerical product evidence is invented. Chapter numbers are chapter indices.
Observed/inferred/unknown states, errors and source notes remain in real product
footage. Replacing a clipped source state with a success graphic is prohibited.

When `--mixed-audio` is supplied, the reviewed 180-second, 48 kHz stereo master is copied intact into assembly. The source sound design, narration timing, mastering and ducking are preserved; the separate stem mixer is bypassed. The master hash is recorded in the render report. The first chapter uses the original brand animation as a cinematic question before the first product reveal. Current English UI uses EN / ZH; explicit capture crops remain important for readable framing.
