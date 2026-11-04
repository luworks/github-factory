# Moonshot film audio

The film is exactly **180 seconds**, in **English only**, with 12 contiguous scenes and a 325-word original narration. `storyboard.json` is the compositor contract; `narration.txt` is the matching spoken script. Capture the app with `localStorage.setItem("moonshot.lang", "en")`. This lane did not capture or modify the app.

## Ready-to-use assets

All generated assets live outside the checkout:

`<private-audio-artifacts>/`

| File                    | Use                                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| `mix.wav`               | Final stereo soundtrack; place at video time zero, without further ducking |
| `narration.wav`         | Isolated mono narration, including scene offsets and silence               |
| `score.wav`             | Original stereo score, titled **First Bearings**                           |
| `sound-design.wav`      | Subtle reveal breaths and interface accents                                |
| `english.srt`           | English subtitles, aligned to returned word boundaries                     |
| `narration-timing.json` | Scene/word/cue offsets and actual per-scene tempo factors                  |
| `review-sample.mp3`     | 32-second excerpt from film time 00:12 to 00:44                            |
| `technical-checks.json` | Exact frame counts, hashes, peaks and clipping checks                      |
| `source-manifest.json`  | Provenance, rights, dependency versions and claim evidence                 |
| `atlas-evidence.json`   | Twenty actual saved public-repository snapshots and heads                  |
| `failures.jsonl`        | Preserved failed attempts and their resolution                             |
| `asr-inspection.json`   | Independent local speech-recognition check of the mixed soundtrack         |

The four WAV deliverables are 16-bit PCM, 48 kHz and exactly 8,640,000 frames each. Narration is mono; the other stems and mix are stereo. Nominal mastering targets are -17 LUFS narration, -24 LUFS score and -16 LUFS final mix, with comfortable peak headroom. Use the measured values in the private manifest. The final mix already includes smooth narration ducking.

## Story and score

The story moves from unfamiliar code to a navigable world: public repository input, source inspection, five perspectives, project activity, Muse field guide, evidence boundaries, a twenty-project atlas, refresh, and a quiet brand close. It promises orientation and informed exploration. It does not claim automatic fixing, runtime telemetry, deployment acceptance, popularity rankings, users or benchmark superiority.

**First Bearings** is an original 80 BPM composition in D-minor/F-major colors: oscillator pads and sub-bass, an original rising-question/descending-answer motif, quiet navigation arpeggios and synthesized percussion. No recordings, loops, game music, borrowed melodies, sound libraries or convolution impulse responses are used. A restrained opening grows into exploration, thins under the evidence scene, expands for the atlas and releases at the close.

The generic synthetic voice is Microsoft `en-US-ChristopherNeural`, generated using the free Edge speech endpoint through `edge-tts`, at `-5%` rate and `-2Hz` pitch. No actor imitation or voice cloning is requested. Each scene starts 0.60 seconds after its scene boundary. Small pitch-preserving tempo adjustments, all at or below 1.12x, keep speech within the fixed edit. Exact offsets are in the timing JSON.

## Sources and rights

The script, composition and sound synthesis were created for this task. They contain no licensed third-party music or samples. They are original local task deliverables; no publication or external licensing action was performed.

The neural voice remains a Microsoft service output, subject to Microsoft's applicable terms. `edge-tts` is LGPLv3, with its SRT composer under MIT; that software license does not grant rights to Microsoft's voice service. Independent commercial/public redistribution clearance for the service output was not performed. See [Microsoft Services Agreement](https://www.microsoft.com/en-us/servicesagreement) and [edge-tts source](https://github.com/rany2/edge-tts).

Core tools: Python 3.12.3, `edge-tts` 7.3.1, NumPy 2.5.4, SciPy 1.18.1, and the host FFmpeg 6.1.1. NumPy/SciPy use permissive BSD-family licenses with bundled notices. The optional local intelligibility check uses `faster-whisper` 1.2.1 and the MIT-licensed [Whisper tiny.en conversion](https://huggingface.co/Systran/faster-whisper-tiny.en); it makes no inference API call. Tool/package licenses are distinct from generated asset provenance.

Product claims were checked against `src/contracts.ts`, `src/components/ExplorerPage.tsx`, `src/server/analysis.ts`, `src/server/ai.ts`, `src/server/github.ts`, `README.md`, and the parent's twenty saved survey worlds at baseline `05ee518dc5e1cbd1bf3dcdd5274cabcd18a4fa62`. Coverage includes partial snapshots; twenty surveyed projects does not mean twenty exhaustive source audits. AI district roles and explanations remain inferred.

## Reproduction and inspection

Use the private `.venv` interpreter to run `generate_audio.py --stage all`. Core dependencies may be installed only in this private environment; do not add app dependencies. `--stage voice`, `score`, `mix` and `verify` are available separately. Successful speech is cached by script/voice/settings hash. A rerun reuses matching audio. Network speech failures stop with a retained failure record; the utility never searches for keys or invokes a paid fallback. Numerical libraries and FFmpeg are capped at four threads. Run heavy stages sequentially.

The utility checks scene continuity, ASCII-only media text, script consistency, every spoken token against the authored script, subtitle ordering, scene containment, 48 kHz sample identity, exact 180-second duration and clipping. The private local ASR report independently checks intelligibility of the complete final mix. Automated inspection is not a human listening test: the parent should audition `review-sample.mp3` and the complete mix, then check captions against the final picture. Browser footage, final mux, visual text, and human perceptual approval remain outside this lane.

Paid API spend in this lane: **USD 0**. No credentials, environment files, ledger, service settings, app code, commits, push, PR, publication or submission were accessed or changed.
