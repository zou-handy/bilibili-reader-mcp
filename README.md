# Bilibili Reader MCP Server

> 📺 **让 AI 真正能够“检索”、“看懂”、“听懂”、“阅读” B站视频的 Model Context Protocol (MCP) 服务。**
> 支持 Claude Desktop、Codex、Antigravity、WorkBuddy 等所有兼容 MCP 协议的智能体客户端。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Protocol-MCP-blue.svg)](https://modelcontextprotocol.io/)

---

## 🌟 核心特性 (Key Features)

市面上大多数 B站检索工具仅能返回视频标题和简介，而 **Bilibili Reader** 提供了全套面向多模态大模型的深度解析能力：

1. 🚀 **免登录开箱即用（Zero-Config Anti-Crawl）**：
   - 内置自动从 B站首页抓取与维护匿名 Cookie（含 `buvid3` 等凭据），30分钟周期自动刷新。
   - 遭遇 B站 `412` 反爬状态码时自动重试刷新，普通用户无需抓取敏感的 `SESSDATA`。
2. 📝 **字幕与转录提取 (`read_video`)**：
   - 自动获取官方中英/AI 字幕，整理为带时间戳 `[00:01:23-00:01:30]` 的分页全文转录，供 LLM 精准总结。
3. 👁️ **多模态视觉抽帧 (`get_video_frames`)**：
   - 结合 `ffmpeg` 针对视频关键时间点进行画面抽帧，输出 Base64 图片，使视觉大模型（如 Claude 3.5 Sonnet / GPT-4o）能直接分析 PPT、演示代码、图表与视频画面。
4. 🎙️ **语音切片生成 (`get_audio_segment`)**：
   - 针对无字幕视频，自动提取指定时间段的轻量 MP3 音频切片，便于语音多模态大模型直接听取原声。
5. 🔍 **视频精准搜索与分P (`search_videos` & `get_video_info`)**：
   - 支持多排序维度（综合、播放、发布时间、弹幕等），支持多 P 视频（分页 cid 定位）。
6. 🎬 **DASH 流媒体解析 (`get_playurl`)**：
   - 获取官方临时带签名的 DASH 视频/音频流直链及各档清晰度。

---

## 🛠️ 工具列表 (Available Tools)

| 工具名称 | 描述 | 主要参数 |
| :--- | :--- | :--- |
| `search_videos` | 根据关键词搜索 B站公开视频并返回 BV 号及概要 | `keyword`, `page`, `page_size`, `order` |
| `get_video_info` | 解析 BV 号或视频链接，获取作者、统计数据、分P及 cid | `video`, `page` |
| `read_video` | 读取视频官方字幕转录（优先中/英/AI字幕），支持时间戳分页 | `video`, `page`, `preferred_language`, `transcript_offset` |
| `get_video_frames` | 提取视频关键帧图像（最多8张），输出 Base64 供视觉大模型识别 | `video`, `page`, `timestamps_seconds`, `max_frames`, `width` |
| `get_audio_segment` | 提取指定时间段的短 MP3 音频切片（针对无字幕场景） | `video`, `page`, `from_seconds`, `duration_seconds` |
| `get_playurl` | 获取 B站 Web 播放器原始 DASH 临时音视频流地址 | `video`, `page`, `quality` |

---

## 🚀 快速接入 (Quick Start)

### 前置要求
- **Node.js** >= 18
- *(可选)* **ffmpeg**（如果需要提取短音频或抽取画面关键帧，请确保系统 PATH 中可运行 `ffmpeg`）

### 1. Claude Desktop 配置
在 `claude_desktop_config.json` 中加入：

```json
{
  "mcpServers": {
    "bilibili-reader": {
      "command": "node",
      "args": ["<你的本地路径>/bilibili-reader/scripts/server.mjs"]
    }
  }
}
```

### 2. Antigravity / Codex 配置
在 `mcp_config.json` 或 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "bilibili-reader": {
      "command": "node",
      "args": ["C:/Users/Lenovo/plugins/bilibili-reader/scripts/server.mjs"]
    }
  }
}
```

---

## 💡 典型使用场景 (Prompt Examples)

接入后，你可以直接对 AI 提问：

- *"在B站搜索关于 AI Agent 的最新视频，并总结播放量最高的那篇的主要内容。"*
- *"请读取 `BV1ph3T6sEHC` 的字幕内容，帮我整理出一份思维导图。"*
- *"这个视频里 UP 主展示的架构图在第 2 分钟左右，帮我抽取那一帧的画面并分析图中的架构。"*
- *"这段视频没有字幕，帮我提取前 60 秒的音频切片听听 UP 主讲了什么。"*

---

## 📄 开源许可 (License)

本项目基于 [MIT License](LICENSE) 开源。仅供学习交流与个人研究使用，请自觉遵守哔哩哔哩平台相关服务条款。
