import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const API_BASE = "https://api.bilibili.com";
const HOME_URL = "https://www.bilibili.com/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const QN_LABELS = new Map([
  [6, "240P"],
  [16, "360P"],
  [32, "480P"],
  [64, "720P"],
  [74, "720P60"],
  [80, "1080P"],
  [112, "1080P+"],
  [116, "1080P60"],
  [120, "4K"],
  [125, "HDR"],
  [126, "Dolby Vision"],
  [127, "8K"]
]);

let anonymousCookie = process.env.BILIBILI_COOKIE?.trim() || "";
let cookieRefreshedAt = anonymousCookie ? Date.now() : 0;

export class BilibiliError extends Error {
  constructor(message, { code = null, status = null, details = null } = {}) {
    super(message);
    this.name = "BilibiliError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function cookiePairs(headers) {
  const raw = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return raw.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function refreshAnonymousCookie(force = false) {
  if (!force && anonymousCookie && Date.now() - cookieRefreshedAt < 30 * 60 * 1000) {
    return anonymousCookie;
  }
  if (process.env.BILIBILI_COOKIE?.trim()) {
    anonymousCookie = process.env.BILIBILI_COOKIE.trim();
    cookieRefreshedAt = Date.now();
    return anonymousCookie;
  }
  try {
    const response = await fetch(HOME_URL, {
      headers: { "User-Agent": USER_AGENT, Referer: HOME_URL },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
    anonymousCookie = cookiePairs(response.headers);
    cookieRefreshedAt = Date.now();
  } catch {
    anonymousCookie = "";
    cookieRefreshedAt = Date.now();
  }
  return anonymousCookie;
}

async function requestJson(url, { referer = HOME_URL, retry = true, envelope = true } = {}) {
  await refreshAnonymousCookie(false);
  const headers = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": USER_AGENT,
    Referer: referer
  };
  if (anonymousCookie) headers.Cookie = anonymousCookie;

  let response;
  try {
    response = await fetch(url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    throw new BilibiliError(`Network request failed: ${error.message}`);
  }

  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = null;
  }

  const blocked = response.status === 412 || payload?.code === -412;
  if (blocked && retry) {
    await refreshAnonymousCookie(true);
    return requestJson(url, { referer, retry: false, envelope });
  }
  if (!response.ok) {
    throw new BilibiliError(`Bilibili returned HTTP ${response.status}`, {
      status: response.status,
      details: raw.slice(0, 500)
    });
  }
  if (!payload) {
    throw new BilibiliError("Bilibili returned a non-JSON response", {
      status: response.status,
      details: raw.slice(0, 500)
    });
  }
  if (envelope && payload.code !== 0) {
    throw new BilibiliError(payload.message || `Bilibili API error ${payload.code}`, {
      code: payload.code,
      status: response.status,
      details: payload
    });
  }
  return envelope ? payload.data : payload;
}

async function api(pathname, params, options = {}) {
  const url = new URL(pathname, API_BASE);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return requestJson(url, options);
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

let cachedMixinKey = "";
let mixinKeyExpiresAt = 0;

async function getMixinKey() {
  const now = Date.now();
  if (cachedMixinKey && now < mixinKeyExpiresAt) {
    return cachedMixinKey;
  }
  try {
    const nav = await api("/x/web-interface/nav", {}, { referer: HOME_URL });
    const imgUrl = nav?.wbi_img?.img_url || "";
    const subUrl = nav?.wbi_img?.sub_url || "";
    const imgKey = imgUrl.split("/").pop().split(".")[0];
    const subKey = subUrl.split("/").pop().split(".")[0];
    const raw = imgKey + subKey;
    cachedMixinKey = MIXIN_KEY_ENC_TAB.map((n) => raw[n]).join("").slice(0, 32);
    mixinKeyExpiresAt = now + 3600000;
    return cachedMixinKey;
  } catch {
    return cachedMixinKey || "";
  }
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

export async function signWbiParams(params = {}) {
  const mixinKey = await getMixinKey();
  const signedParams = {
    ...params,
    wts: Math.round(Date.now() / 1000)
  };
  const sortedKeys = Object.keys(signedParams).sort();
  const query = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signedParams[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  const w_rid = md5(query + mixinKey);
  return { ...signedParams, w_rid };
}

export async function wbiApi(pathname, params, options = {}) {
  const signed = await signWbiParams(params);
  return api(pathname, signed, options);
}

export function normalizeBvid(value) {
  const match = String(value || "").match(/BV[0-9A-Za-z]{10}/i);
  if (!match) throw new BilibiliError("Expected a Bilibili BV number or video URL");
  return `BV${match[0].slice(2)}`;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function unixIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export async function searchVideos(keyword, { page = 1, pageSize = 10, order = "totalrank" } = {}) {
  if (!String(keyword || "").trim()) throw new BilibiliError("keyword is required");
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const safePageSize = Math.min(20, Math.max(1, Math.trunc(Number(pageSize) || 10)));
  const allowedOrders = new Set(["totalrank", "click", "pubdate", "dm", "stow"]);
  const safeOrder = allowedOrders.has(order) ? order : "totalrank";
  const data = await api("/x/web-interface/search/type", {
    search_type: "video",
    keyword: String(keyword).trim(),
    page: safePage,
    page_size: safePageSize,
    order: safeOrder
  });
  const results = Array.isArray(data?.result) ? data.result : [];
  return {
    keyword: String(keyword).trim(),
    page: safePage,
    page_size: safePageSize,
    total: Number(data?.numResults || data?.numResults === 0 ? data.numResults : data?.num_results || 0),
    results: results.slice(0, safePageSize).map((item) => ({
      bvid: item.bvid,
      title: decodeHtml(item.title),
      author: decodeHtml(item.author),
      description: decodeHtml(item.description),
      duration: item.duration,
      views: Number(item.play || 0),
      danmaku: Number(item.video_review || 0),
      favorites: Number(item.favorites || 0),
      published_at: unixIso(item.pubdate),
      url: item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : null),
      cover: item.pic?.startsWith("//") ? `https:${item.pic}` : item.pic || null
    }))
  };
}

function compactOwner(owner) {
  if (!owner) return null;
  return { mid: owner.mid, name: owner.name, face: owner.face };
}

function compactStat(stat) {
  if (!stat) return null;
  return {
    views: stat.view,
    danmaku: stat.danmaku,
    replies: stat.reply,
    favorites: stat.favorite,
    coins: stat.coin,
    shares: stat.share,
    likes: stat.like
  };
}

export async function getVideoInfo(video, { page = 1 } = {}) {
  const bvid = normalizeBvid(video);
  const data = await api("/x/web-interface/view", { bvid }, {
    referer: `https://www.bilibili.com/video/${bvid}`
  });
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const safePage = Math.max(1, Math.trunc(Number(page) || 1));
  const selected = pages[safePage - 1];
  if (!selected) {
    throw new BilibiliError(`Page ${safePage} does not exist; video has ${pages.length || 1} page(s)`);
  }
  return {
    bvid: data.bvid,
    aid: data.aid,
    title: data.title,
    description: data.desc,
    owner: compactOwner(data.owner),
    stats: compactStat(data.stat),
    published_at: unixIso(data.pubdate),
    duration_seconds: data.duration,
    cover: data.pic,
    copyright: data.copyright,
    page_count: pages.length,
    selected_page: {
      page: selected.page,
      cid: selected.cid,
      title: selected.part,
      duration_seconds: selected.duration,
      width: selected.dimension?.width,
      height: selected.dimension?.height,
      rotate: selected.dimension?.rotate || 0,
      first_frame: selected.first_frame || null
    },
    pages: pages.map((item) => ({
      page: item.page,
      cid: item.cid,
      title: item.part,
      duration_seconds: item.duration
    })),
    url: `https://www.bilibili.com/video/${data.bvid}?p=${safePage}`
  };
}

function qualityLabel(id) {
  return QN_LABELS.get(Number(id)) || `QN ${id}`;
}

function expiryFromUrl(value) {
  try {
    const deadline = Number(new URL(value).searchParams.get("deadline"));
    return Number.isFinite(deadline) && deadline > 0 ? new Date(deadline * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function compactStream(stream, { includeBackupUrls = false, audio = false } = {}) {
  const url = stream.baseUrl || stream.base_url;
  const result = {
    id: stream.id,
    quality: audio ? undefined : qualityLabel(stream.id),
    codecs: stream.codecs,
    mime_type: stream.mimeType || stream.mime_type,
    bandwidth: stream.bandwidth,
    width: audio ? undefined : stream.width,
    height: audio ? undefined : stream.height,
    frame_rate: audio ? undefined : stream.frameRate || stream.frame_rate,
    url,
    expires_at: expiryFromUrl(url)
  };
  if (includeBackupUrls) result.backup_urls = stream.backupUrl || stream.backup_url || [];
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function sortStreams(streams) {
  return streams.sort((a, b) => Number(b.id || 0) - Number(a.id || 0) || Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
}

export async function getPlayurl(video, { page = 1, quality = 80, includeBackupUrls = false } = {}) {
  const info = await getVideoInfo(video, { page });
  const bvid = info.bvid;
  const cid = info.selected_page.cid;
  const requestedQuality = Number(quality) || 80;
  const data = await api("/x/player/playurl", {
    bvid,
    cid,
    qn: requestedQuality,
    fnver: 0,
    fnval: 16,
    fourk: 1
  }, { referer: `https://www.bilibili.com/video/${bvid}` });
  const videoStreams = sortStreams((data.dash?.video || []).map((stream) => compactStream(stream, { includeBackupUrls })));
  const audioStreams = sortStreams((data.dash?.audio || []).map((stream) => compactStream(stream, { includeBackupUrls, audio: true })));
  return {
    bvid,
    cid,
    page: info.selected_page.page,
    requested_quality: requestedQuality,
    selected_quality: data.quality,
    selected_quality_label: qualityLabel(data.quality),
    duration_seconds: data.dash?.duration || Math.ceil(Number(data.timelength || 0) / 1000),
    actual_video_qualities: [...new Set(videoStreams.map((stream) => stream.id))],
    video_streams: videoStreams,
    audio_streams: audioStreams,
    note: "URLs are signed and temporary. Send the Bilibili video Referer when fetching them."
  };
}

function chooseSubtitle(subtitles, preferredLanguage) {
  if (!subtitles.length) return null;
  if (preferredLanguage) {
    const needle = String(preferredLanguage).toLowerCase();
    const exact = subtitles.find((item) => String(item.lan).toLowerCase() === needle);
    if (exact) return exact;
    const fuzzy = subtitles.find((item) => `${item.lan} ${item.lan_doc}`.toLowerCase().includes(needle));
    if (fuzzy) return fuzzy;
  }
  const priorities = ["zh-CN", "zh-Hans", "ai-zh", "zh-Hant", "en"];
  for (const language of priorities) {
    const match = subtitles.find((item) => String(item.lan).toLowerCase() === language.toLowerCase());
    if (match) return match;
  }
  return subtitles[0];
}

function timestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [hours, minutes, secs].map((item) => String(item).padStart(2, "0")).join(":");
}

export async function getSubtitleData(video, { page = 1, preferredLanguage } = {}) {
  const info = await getVideoInfo(video, { page });
  const bvid = info.bvid;
  const cid = info.selected_page.cid;
  let player = null;
  try {
    player = await wbiApi("/x/player/wbi/v2", { bvid, cid }, {
      referer: `https://www.bilibili.com/video/${bvid}`
    });
  } catch {
    player = await api("/x/player/v2", { bvid, cid }, {
      referer: `https://www.bilibili.com/video/${bvid}`
    });
  }
  const subtitles = Array.isArray(player?.subtitle?.subtitles) ? player.subtitle.subtitles : [];
  const selected = chooseSubtitle(subtitles, preferredLanguage);
  const available = subtitles.map((item) => ({
    id: item.id,
    language: item.lan,
    language_name: item.lan_doc,
    ai_generated: Boolean(item.ai_type)
  }));
  const viewPoints = Array.isArray(player?.view_points)
    ? player.view_points
        .map((pt) => ({
          start_seconds: Number(pt.from ?? pt.start ?? 0),
          title: String(pt.content ?? pt.title ?? "").trim()
        }))
        .filter((pt) => pt.title)
    : [];

  if (!selected) return { info, available, selected: null, view_points: viewPoints, body: [] };

  let subtitleUrl = selected.subtitle_url || selected.subtitleUrl;
  if (subtitleUrl?.startsWith("//")) subtitleUrl = `https:${subtitleUrl}`;
  if (!subtitleUrl) return { info, available, selected: null, view_points: viewPoints, body: [] };

  const payload = await requestJson(subtitleUrl, {
    referer: `https://www.bilibili.com/video/${bvid}`,
    envelope: false
  });
  return {
    info,
    available,
    selected: {
      id: selected.id,
      language: selected.lan,
      language_name: selected.lan_doc,
      ai_generated: Boolean(selected.ai_type)
    },
    view_points: viewPoints,
    body: Array.isArray(payload?.body) ? payload.body : []
  };
}

export async function readVideo(video, {
  page = 1,
  preferredLanguage,
  transcriptOffset = 0,
  transcriptLimit = 30000
} = {}) {
  const subtitle = await getSubtitleData(video, { page, preferredLanguage });
  const info = subtitle.info;
  if (!subtitle.selected || !subtitle.body.length) {
    return {
      readable: false,
      reason: "No official subtitle is available for this page.",
      next_step: "Track 2 Fallback: Call get_audio_segment for spoken content or get_video_frames for visual content.",
      video: info,
      view_points: subtitle.view_points || [],
      available_subtitles: subtitle.available
    };
  }
  const transcript = subtitle.body.map((item) =>
    `[${timestamp(item.from)}-${timestamp(item.to)}] ${String(item.content || "").trim()}`
  ).join("\n");
  const safeOffset = Math.max(0, Math.trunc(Number(transcriptOffset) || 0));
  const safeLimit = Math.min(100000, Math.max(1000, Math.trunc(Number(transcriptLimit) || 30000)));
  const chunk = transcript.slice(safeOffset, safeOffset + safeLimit);
  return {
    readable: true,
    video: info,
    selected_subtitle: subtitle.selected,
    available_subtitles: subtitle.available,
    view_points: subtitle.view_points || [],
    transcript: chunk,
    transcript_offset: safeOffset,
    transcript_returned_chars: chunk.length,
    transcript_total_chars: transcript.length,
    transcript_has_more: safeOffset + chunk.length < transcript.length,
    next_offset: safeOffset + chunk.length < transcript.length ? safeOffset + chunk.length : null
  };
}

function runFfmpeg(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65536) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new BilibiliError("ffmpeg timed out while preparing media content"));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new BilibiliError(`Unable to start ffmpeg: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new BilibiliError(`ffmpeg failed with exit code ${code}`, { details: stderr.slice(-2000) }));
    });
  });
}

export async function getAudioSegment(video, { page = 1, fromSeconds = 0, durationSeconds = 60 } = {}) {
  const safeStart = Math.max(0, Number(fromSeconds) || 0);
  const safeDuration = Math.min(120, Math.max(1, Number(durationSeconds) || 60));
  const playurl = await getPlayurl(video, { page, quality: 16 });
  const audio = [...playurl.audio_streams].sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0))[0];
  if (!audio?.url) throw new BilibiliError("No playable audio stream was returned");

  const tempFile = path.join(os.tmpdir(), `bilibili-reader-${process.pid}-${crypto.randomUUID()}.mp3`);
  const referer = `https://www.bilibili.com/video/${playurl.bvid}`;
  const headers = `Referer: ${referer}\r\n`;
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-user_agent", USER_AGENT,
      "-headers", headers,
      "-ss", String(safeStart),
      "-i", audio.url,
      "-t", String(safeDuration),
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k",
      "-f", "mp3", "-y", tempFile
    ]);
    const data = await fs.readFile(tempFile);
    return {
      metadata: {
        bvid: playurl.bvid,
        cid: playurl.cid,
        page: playurl.page,
        from_seconds: safeStart,
        duration_seconds: safeDuration,
        mime_type: "audio/mpeg",
        bytes: data.length,
        source_audio_id: audio.id,
        source_bandwidth: audio.bandwidth
      },
      base64: data.toString("base64")
    };
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

function buildFrameTimestamps(durationSeconds, { timestampsSeconds, intervalSeconds, maxFrames = 6 } = {}) {
  const duration = Math.max(0.1, Number(durationSeconds) || 0.1);
  const count = Math.min(8, Math.max(1, Math.trunc(Number(maxFrames) || 6)));
  let values = [];

  if (Array.isArray(timestampsSeconds) && timestampsSeconds.length) {
    values = timestampsSeconds
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.min(value, Math.max(0, duration - 0.1)));
  } else if (Number(intervalSeconds) > 0) {
    const interval = Math.max(1, Number(intervalSeconds));
    for (let value = 0; value < duration && values.length < count; value += interval) {
      values.push(value);
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      values.push(Math.min((index + 0.5) * duration / count, Math.max(0, duration - 0.1)));
    }
  }

  const unique = new Map();
  for (const value of values) {
    const rounded = Math.round(value * 1000) / 1000;
    unique.set(rounded.toFixed(3), rounded);
  }
  return [...unique.values()].sort((a, b) => a - b).slice(0, count);
}

function selectFrameStream(streams) {
  if (!streams.length) return null;
  const compare = (a, b) =>
    Number(b.id || 0) - Number(a.id || 0) ||
    Number(b.height || 0) - Number(a.height || 0) ||
    Number(b.bandwidth || 0) - Number(a.bandwidth || 0);
  const avc = streams.filter((stream) => String(stream.codecs || "").toLowerCase().startsWith("avc1"));
  return [...(avc.length ? avc : streams)].sort(compare)[0];
}

async function extractFrame(stream, referer, timestampSeconds, maxWidth) {
  const tempFile = path.join(os.tmpdir(), `bilibili-reader-${process.pid}-${crypto.randomUUID()}.jpg`);
  const headers = `Referer: ${referer}\r\n`;
  try {
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error",
      "-user_agent", USER_AGENT,
      "-headers", headers,
      "-ss", String(timestampSeconds),
      "-i", stream.url,
      "-an", "-frames:v", "1",
      "-vf", `scale=${maxWidth}:-2:force_original_aspect_ratio=decrease`,
      "-q:v", "3", "-y", tempFile
    ], 90000);
    const data = await fs.readFile(tempFile);
    return {
      metadata: {
        timestamp_seconds: timestampSeconds,
        mime_type: "image/jpeg",
        bytes: data.length,
        max_width: maxWidth
      },
      base64: data.toString("base64")
    };
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => {});
  }
}

export async function getVideoFrames(video, {
  page = 1,
  timestampsSeconds,
  intervalSeconds,
  maxFrames = 6,
  width = 960
} = {}) {
  const safeWidth = Math.min(1280, Math.max(320, Math.trunc(Number(width) || 960)));
  const playurl = await getPlayurl(video, { page, quality: 80 });
  const stream = selectFrameStream(playurl.video_streams);
  if (!stream?.url) throw new BilibiliError("No playable video stream was returned");

  const timestamps = buildFrameTimestamps(playurl.duration_seconds, {
    timestampsSeconds,
    intervalSeconds,
    maxFrames
  });
  const referer = `https://www.bilibili.com/video/${playurl.bvid}`;
  const frames = [];
  for (const timestampSeconds of timestamps) {
    frames.push(await extractFrame(stream, referer, timestampSeconds, safeWidth));
  }

  return {
    metadata: {
      bvid: playurl.bvid,
      cid: playurl.cid,
      page: playurl.page,
      duration_seconds: playurl.duration_seconds,
      frame_count: frames.length,
      timestamps_seconds: frames.map((frame) => frame.metadata.timestamp_seconds),
      source_video: {
        id: stream.id,
        quality: stream.quality,
        codecs: stream.codecs,
        width: stream.width,
        height: stream.height,
        bandwidth: stream.bandwidth
      },
      frames: frames.map((frame) => frame.metadata)
    },
    frames
  };
}
