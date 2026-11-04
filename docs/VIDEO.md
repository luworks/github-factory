> Historical incubation record (2026-11-04), sanitized for publication. Current repository setup: [SETUP.md](SETUP.md).

# Moonshot — Find Your Place

A completed 180-second English product film with a cinematic narration, original 80 BPM score, sound design, source-linked product recordings and a twenty-world atlas. No Chinese narration, subtitles, title cards or visible UI text were intentionally included; the recorded views were checked for visible CJK and all storyboard/SRT text passed the English boundary.

## Delivered files

Private delivery root: `<private-video-artifacts>/film/output/`.

- `final/moonshot-film.mp4` — H.264, 1920×1080, yuv420p, 30 fps, stereo 48 kHz AAC, faststart.
- `final/english.srt` — 55 English cues, also burned into the film.
- `final/poster.png` — actual final-film frame.
- `atlas-20.png` and `moonshot-20-worlds.zip` — the atlas plus twenty unmodified browser screenshots and capture metadata.
- `final/render-report.json` — full capture identities, crops, source hashes, timings, resource use and checks.
- `final/review/` — twelve chapter frame samples, contact sheet, sound/loudness and presentation-integrity evidence.

The final MP4 is 19,131,930 bytes, exactly180.000s and5400video frames. SHA-256: `6205e6f2bb1a4b3f51b7909899b0ee815cf835e912994f045d6e6dbb8c7f96b5`.

## Story and production

The film moves from an unfamiliar codebase, to a navigable world, repository input, source inspection, five perspectives, actual work, a Muse guide, explicit evidence limits, the twenty-project atlas and a quiet closing invitation. Chapter timing and the original 325-word narration are in `media/film/storyboard.json` and `narration.txt`.

The primary recorded the actual app through the shared T3 browser at1920×1080CSS pixels. Native clips are4K and variable frame rate; the final compositor normalizes30fps. The English language switch was changed to EN/ZH; an earlier five-style recording hides only that switch. No repo status or source fact was replaced. The paste demonstration uses a previously generated world and makes no uncached generation-speed claim.

Original starfield, orbital graphics, typography, a twenty-world montage and source-preserving camera crops are generated locally. The first chapter uses the original question/reveal animation. No film/game assets or commercial music samples were copied. Source music, voice, sound design and licensing boundaries are documented in `media/film/AUDIO.md` and the private audio source manifest. The generic Microsoft synthetic voice is service output; independent public/commercial redistribution clearance was not performed. This delivery is local and does not publish or submit the film.

## Verification

- Full renderer: delivery mode,12 contiguous scenes,180.000s,5400frames,1080p/H.264/yuv420p/AAC, English metadata and faststart verified.
- Twenty browser world views:20/20 captured in English with zero detected visible CJK in their DOM text. The original full screenshots are retained.
- All twelve final chapter samples visually inspected; subtitles occupy a separate area below the product viewport.
- Final soundtrack:−16.14LUFS,−3.25dBTP. The reviewed master is preserved without a second ducking/normalization pass. Presentation-length decoded audio has8,640,000frames and correlates0.99989 with the master; gain difference−0.0136dB. Raw AAC decode has512codec-padding frames beyond the presentation interval, retained in the QC record.
- Audio-lane independent local ASR recovered the narrative with about97% text similarity; exact authored-script/returned-word-boundary alignment was checked separately. This is automated intelligibility evidence, not a user listening approval.
- Existing compositor smoke:14contract checks and an8-second real-MP4 smoke passed. Final full-film evidence supersedes smoke as the delivery proof.
- Unverified: subjective approval by the user and playback on physical iOS/Android devices. The file uses broadly supported codecs; no claim of testing every player.

## Reproduce

Use the project-local `media/film/render.py` and `atlas.py` with the private source footage, original audio and capture manifests. Supply `--mixed-audio` to preserve the reviewed180-second mix. Rendering is sequential, bounded to four CPU cores, and performs no model calls. Generated assets and the private Python environment stay outside Git. The original shared API ledger remains unchanged.

No PR, push, public hosting or competition submission was performed. Website JS/TS runtime source remains `f089316c6ce76eda0dbd69cf5d8e94316622422c`; later commits add offline film tooling and documentation.
