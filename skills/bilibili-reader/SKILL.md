---
name: bilibili-reader
description: Search and read public Bilibili videos when the user mentions B站, 哔哩哔哩, a Bilibili URL, a BV number, video subtitles, playurl, Bilibili audio, or visual frame analysis.
---

# Bilibili Reader

Use the plugin tools to retrieve public Bilibili content without inventing video details.

## Workflow

1. For topic discovery, call `search_videos` and keep each result's `bvid`.
2. Call `get_video_info` when pages, cid, duration, author, or engagement metadata matter.
3. Call `read_video` first for content. It returns the selected official subtitle as a paged transcript when one exists.
4. Call `get_video_frames` when the request depends on slides, demonstrations, diagrams, code, visual changes, or an overall view of the footage. Use evenly sampled frames first, then request explicit timestamps for close inspection.
5. If `read_video` reports no subtitle, call `get_audio_segment` in chronological chunks and analyze the returned audio. Start with 60–120 second chunks and combine it with sampled frames when visual information matters.
6. Call `get_playurl` only when the user needs media stream details, download URLs, codecs, or exact accessible qualities.

## Constraints

- Operate on public content. Do not claim this web-player endpoint is a stable official OpenAPI or use it to bypass paid, private, regional, membership, or DRM restrictions.
- Signed playurl URLs expire. Fetch a fresh URL before using it and preserve the Bilibili video Referer.
- Inspect returned stream IDs and dimensions; a requested `qn` can be downgraded for anonymous access.
- `get_video_frames` returns at most eight JPEG images per call. Use targeted timestamps instead of repeatedly sampling the whole video.
- A 412 response is anti-abuse blocking, not proof that WBI signing is required. The server retries once with refreshed anonymous cookies, then reports the failure.
- For multipart videos, respect the requested 1-based page number rather than assuming the top-level cid is the desired part.
