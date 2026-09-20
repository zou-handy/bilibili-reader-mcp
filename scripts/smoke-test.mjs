import { getAudioSegment, getPlayurl, getVideoFrames, getVideoInfo, readVideo, searchVideos } from "./bilibili-api.mjs";

const bvid = process.argv[2] || "BV1ph3T6sEHC";
const keyword = process.argv[3] || "AI Agent";
const includeAudio = process.argv.includes("--audio");
const includeFrames = process.argv.includes("--frames");

const search = await searchVideos(keyword, { pageSize: 3 });
const info = await getVideoInfo(bvid);
const playurl = await getPlayurl(bvid, { quality: 80 });
const readable = await readVideo(bvid, { transcriptLimit: 2000 });

const summary = {
  search: {
    keyword: search.keyword,
    count: search.results.length,
    first_bvid: search.results[0]?.bvid || null
  },
  video: {
    bvid: info.bvid,
    cid: info.selected_page.cid,
    title: info.title,
    page_count: info.page_count
  },
  playurl: {
    selected_quality: playurl.selected_quality,
    actual_video_qualities: playurl.actual_video_qualities,
    video_streams: playurl.video_streams.length,
    audio_streams: playurl.audio_streams.length
  },
  read_video: {
    readable: readable.readable,
    subtitle: readable.selected_subtitle?.language || null,
    transcript_chars: readable.transcript_returned_chars || 0,
    reason: readable.reason || null
  }
};

if (includeAudio) {
  const audio = await getAudioSegment(bvid, { fromSeconds: 0, durationSeconds: 2 });
  summary.audio_segment = audio.metadata;
}

if (includeFrames) {
  const frames = await getVideoFrames(bvid, { maxFrames: 2, width: 640 });
  summary.video_frames = frames.metadata;
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
