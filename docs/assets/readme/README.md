# Public README media

Curated public product media, recorded on **2026-11-05 UTC** from
<https://chaorders.com/github-factory/>. These exports are intentionally published
for the English and Chinese READMEs; raw recordings, browser profiles, network
captures, runtime data and private film assets remain excluded from Git.

## Contents

- `landing.webp`: live public homepage; the hero world is an explicitly labeled **illustration**, not a real repository map.
- `gallery.webp`: public atlas, including visibly unavailable maps.
- `moonshot.webp`, `factorio.webp`, `red-alert.webp`, `red-alert-2.webp`, `civilization.webp`: five actual procedural views of the same cached `vercel/next.js` map.
- `source.webp`: district selection and source inspector.
- `activity.webp`: cached GitHub activity; original conclusions remain visible.
- `chinese.webp`: Chinese interface and existing field guide.
- `five-perspectives.gif`: an 8-second excerpt switching perspectives, 960×640, 7 fps.
- `source-to-guide.gif`: an 8-second excerpt of source inspection, activity and bilingual guide navigation, 960×640, 7 fps.
- `world-tour.mp4`: homepage, atlas and perspective-switching excerpt, 13.52 seconds.
- `evidence-tour.mp4`: source/activity/guide excerpt, 8.04 seconds.

The two MP4s are 1440×960 H.264/yuv420p, 25 fps, faststart, **without audio**.
They are linked from image posters because relative repository video files do not
provide a dependable inline GitHub README player. GIFs provide inline motion.
Images are optimized WebP exports at the original 1440×960 viewport. Video
excerpts are chronological cuts of the actual browser recording; no repository
facts, status labels or evidence panels were replaced.

## Evidence and publication boundary

The Next.js world visibly retains **STALE CACHE · CURRENT STATE UNKNOWN**,
its captured head and timestamp. The historical guide shown is existing cached
content; recording it does not demonstrate a new model result or fresh analysis.
The curated atlas has nineteen entries, with unavailable maps left unavailable.
A snapshot is not a current upstream, CI or deployment guarantee.

Capture used a clean browser profile with GET requests only. All non-GET traffic
was blocked (the recorded blocked requests were Cloudflare browser telemetry).
No import, refresh, analysis action or paid model request was triggered. No
credential, private runtime database, ledger, raw response or source archive is
included. The synthetic test fixtures used by Playwright checks are separate
from these public-page recordings.

Original procedural UI artwork is covered by the repository's MIT license.
Third-party repository names, descriptions and public facts identify their owners;
no endorsement is implied. No game assets, soundtrack, synthetic narration or
material from the uncleared private film is included. See
[third-party notices](../../../THIRD_PARTY_NOTICES.md).

## Export recipe

Raw material stays in ignored `artifacts/`. The browser recording was captured
with Playwright at 1440×960. Selected screenshots were encoded with Pillow as
WebP, quality 88. FFmpeg exported silent H.264 MP4s using CRF 25, yuv420p and
`+faststart`; GIFs use a 96-color palette at 7 fps with Bayer dithering. The first
MP4 covers recording time 0–13.5s; the second starts at 13.5s. GIF excerpts start
at 5.5s and 13.5s respectively. No speed claim is implied by these short excerpts.

Verification for this documentation change: Bun 1.4.4 TypeScript check and build
passed; **224 unit tests and 25 synthetic Chromium journeys passed**, with zero
failures or skips. Synthetic journeys intercepted APIs and made no paid calls.
The build emitted dependency-level `use client` bundling warnings. Paid provider
acceptance, Firefox/Safari, physical mobile playback and a native inline GitHub
video player were not tested by this change. CI is recorded separately.
