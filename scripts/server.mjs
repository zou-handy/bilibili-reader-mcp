import readline from "node:readline";
import {
  BilibiliError,
  getAudioSegment,
  getPlayurl,
  getVideoFrames,
  getVideoInfo,
  readVideo,
  searchVideos
} from "./bilibili-api.mjs";

const SERVER_INFO = { name: "bilibili-reader", version: "0.1.0" };

const tools = [
  {
    name: "search_videos",
    description: "Search public Bilibili videos by keyword and return compact metadata plus BV numbers.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Search query." },
        page: { type: "integer", minimum: 1, default: 1 },
        page_size: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        order: { type: "string", enum: ["totalrank", "click", "pubdate", "dm", "stow"], default: "totalrank" }
      },
      required: ["keyword"],
      additionalProperties: false
    }
  },
  {
    name: "get_video_info",
    description: "Resolve a BV number or Bilibili URL into metadata, multipart pages, and the selected page cid.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "BV number or Bilibili video URL." },
        page: { type: "integer", minimum: 1, default: 1, description: "1-based multipart page." }
      },
      required: ["video"],
      additionalProperties: false
    }
  },
  {
    name: "read_video",
    description: "Read a public Bilibili video's official subtitle transcript. Returns a paged transcript or directs the caller to audio segments when no subtitle exists.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "BV number or Bilibili video URL." },
        page: { type: "integer", minimum: 1, default: 1 },
        preferred_language: { type: "string", description: "Subtitle language code or name, such as zh-CN or en." },
        transcript_offset: { type: "integer", minimum: 0, default: 0 },
        transcript_limit: { type: "integer", minimum: 1000, maximum: 100000, default: 30000 }
      },
      required: ["video"],
      additionalProperties: false
    }
  },
  {
    name: "get_playurl",
    description: "Call Bilibili's web-player playurl endpoint and return actual anonymous DASH video/audio streams with temporary signed URLs.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "BV number or Bilibili video URL." },
        page: { type: "integer", minimum: 1, default: 1 },
        quality: { type: "integer", enum: [6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127], default: 80 },
        include_backup_urls: { type: "boolean", default: false }
      },
      required: ["video"],
      additionalProperties: false
    }
  },
  {
    name: "get_audio_segment",
    description: "Return a short MP3 audio segment from a public Bilibili video for direct listening when no subtitle is available. Requires ffmpeg on PATH.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "BV number or Bilibili video URL." },
        page: { type: "integer", minimum: 1, default: 1 },
        from_seconds: { type: "number", minimum: 0, default: 0 },
        duration_seconds: { type: "number", minimum: 1, maximum: 120, default: 60 }
      },
      required: ["video"],
      additionalProperties: false
    }
  },
  {
    name: "get_video_frames",
    description: "Sample up to eight JPEG frames from a public Bilibili video for visual analysis. Uses explicit timestamps, a fixed interval, or even sampling. Requires ffmpeg on PATH.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "BV number or Bilibili video URL." },
        page: { type: "integer", minimum: 1, default: 1 },
        timestamps_seconds: {
          type: "array",
          items: { type: "number", minimum: 0 },
          maxItems: 8,
          description: "Optional exact timestamps. Takes precedence over interval_seconds."
        },
        interval_seconds: { type: "number", minimum: 1, description: "Optional sampling interval." },
        max_frames: { type: "integer", minimum: 1, maximum: 8, default: 6 },
        width: { type: "integer", minimum: 320, maximum: 1280, default: 960, description: "Maximum JPEG width." }
      },
      required: ["video"],
      additionalProperties: false
    }
  }
];

function jsonText(value) {
  return { type: "text", text: JSON.stringify(value, null, 2) };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "search_videos": {
      const result = await searchVideos(args.keyword, {
        page: args.page,
        pageSize: args.page_size,
        order: args.order
      });
      return { content: [jsonText(result)], structuredContent: result };
    }
    case "get_video_info": {
      const result = await getVideoInfo(args.video, { page: args.page });
      return { content: [jsonText(result)], structuredContent: result };
    }
    case "read_video": {
      const result = await readVideo(args.video, {
        page: args.page,
        preferredLanguage: args.preferred_language,
        transcriptOffset: args.transcript_offset,
        transcriptLimit: args.transcript_limit
      });
      return { content: [jsonText(result)], structuredContent: result };
    }
    case "get_playurl": {
      const result = await getPlayurl(args.video, {
        page: args.page,
        quality: args.quality,
        includeBackupUrls: args.include_backup_urls
      });
      return { content: [jsonText(result)], structuredContent: result };
    }
    case "get_audio_segment": {
      const result = await getAudioSegment(args.video, {
        page: args.page,
        fromSeconds: args.from_seconds,
        durationSeconds: args.duration_seconds
      });
      return {
        content: [
          jsonText(result.metadata),
          { type: "audio", data: result.base64, mimeType: "audio/mpeg" }
        ],
        structuredContent: result.metadata
      };
    }
    case "get_video_frames": {
      const result = await getVideoFrames(args.video, {
        page: args.page,
        timestampsSeconds: args.timestamps_seconds,
        intervalSeconds: args.interval_seconds,
        maxFrames: args.max_frames,
        width: args.width
      });
      const content = [jsonText(result.metadata)];
      result.frames.forEach((frame, index) => {
        content.push({
          type: "text",
          text: `Frame ${index + 1}/${result.frames.length} at ${frame.metadata.timestamp_seconds}s`
        });
        content.push({ type: "image", data: frame.base64, mimeType: "image/jpeg" });
      });
      return { content, structuredContent: result.metadata };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function serializeError(error) {
  return {
    error: error.name || "Error",
    message: error.message,
    code: error.code ?? undefined,
    status: error.status ?? undefined,
    details: error.details ?? undefined
  };
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || !message.method) return null;
  if (message.method.startsWith("notifications/")) return null;
  const id = message.id;
  try {
    if (message.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: message.params?.protocolVersion || "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "Search public Bilibili videos, prefer official subtitles, use short audio segments for speech, and sample frames when visual information matters."
        }
      };
    }
    if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (message.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
    if (message.method === "tools/call") {
      try {
        const result = await callTool(message.params?.name, message.params?.arguments || {});
        return { jsonrpc: "2.0", id, result };
      } catch (error) {
        const details = serializeError(error);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
            structuredContent: details
          }
        };
      }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  } catch (error) {
    const details = serializeError(error);
    return { jsonrpc: "2.0", id, error: { code: -32603, message: details.message, data: details } };
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const response = await handle(JSON.parse(trimmed));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error", data: String(error.message || error) }
    })}\n`);
  }
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`[bilibili-reader] ${error.stack || error}\n`);
});

process.on("unhandledRejection", (error) => {
  process.stderr.write(`[bilibili-reader] ${error?.stack || error}\n`);
});

export { callTool, handle, tools };
