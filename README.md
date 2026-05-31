# Desktop AI VTuber

一个基于 **Electron** + **Live2D/VRM** + **LLM** + **GPT-SoVITS** 的桌面 AI 伴侣应用。在你的桌面上放置一个可爱的 2D Live2D 或 3D VRM 角色，她可以与你对话、拥有语音交互能力，并带有完整的 AI 大脑。

![screenshot](./assets/live2d/ggc-10qpt01/10qpt01__l2d_355.u_thumbnail.png)

## 功能特性

- **2D/3D 桌面角色** — 支持 Live2D (2D) 和 VRM (3D) 模型，透明窗口常驻桌面，拖拽移动
- **AI 对话** — 接入 LLM API，角色拥有个性设定和对话记忆
- **语音合成 (TTS)** — 基于 GPT-SoVITS，让角色用选定音色说话
- **语音识别 (ASR)** — 支持麦克风语音输入，自动转文字后对话
- **系统托盘** — 托盘图标快捷显示/隐藏，不影响工作
- **全局快捷键** — `Ctrl+Alt+V` 快速切换窗口可见性
- **嘴型同步** — Live2D 模型随 TTS 播放自动张嘴闭嘴

## 项目结构

```
desktop-vtuber/
├── main.js                    # Electron 主进程
├── preload.js                 # 预加载脚本（安全桥接）
├── config.json                # 用户配置文件（不提交到 Git）
├── config.example.json        # 配置模板
├── package.json               # 项目依赖
├── start-all.bat              # 一键启动（含 GPT-SoVITS）
├── start-app-only.bat         # 仅启动桌面应用
├── renderer/
│   ├── index.html             # 渲染进程页面
│   ├── renderer.js            # 渲染进程逻辑
│   └── style.css              # 样式
├── scripts/
│   ├── ensure-sovits.ps1      # GPT-SoVITS 启动保障脚本
│   └── local_asr.py           # 本地语音识别脚本
└── assets/
    ├── live2d/                # Live2D 模型文件
    │   └── ggc-10qpt01/       # 示例模型
    ├── vrm/                   # VRM 3D 模型文件（用户自行添加）
    └── vendor/                # 第三方库（Live2D Cubism Core）
```

## 前置依赖

| 依赖 | 说明 |
|------|------|
| [Node.js](https://nodejs.org/) | >= 18.x，运行 Electron 应用 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) | 本地 TTS 语音合成服务 |
| Live2D 模型 | Cubism 4 或 3 格式的 `.model3.json` 模型 |

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/Gunian7/Desktop-companion.git
cd Desktop-companion
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置

复制配置模板并修改：

```bash
cp config.example.json config.json
```

然后编辑 `config.json`：

#### LLM 配置

```json
{
  "llm": {
    "baseURL": "https://api.openai.com/v1",
    "apiKey": "sk-your-api-key",
    "model": "gpt-4o",
    "systemPrompt": "你的角色设定提示词",
    "maxHistoryTurns": 4
  }
}
```

支持任何兼容 OpenAI API 格式的服务（OpenAI、Anthropic、本地 ollama 等）。

#### 模型类型选择

在 `config.json` 中设置 `modelType` 切换模型类型：

```json
{
  "modelType": "live2d"
}
```

- `"live2d"` — 2D Live2D 模型（默认）
- `"vrm"` — 3D VRM 模型
- `"image"` — 静态图片 + CSS 动画（最简单）

#### TTS 配置

`provider` 选择引擎，`apiType` 选择具体后端：

**方案一：Edge TTS（推荐，免费）— provider: "api", apiType: "edge"**

```json
{
  "tts": {
    "provider": "api",
    "apiType": "edge",
    "apiVoice": "zh-CN-XiaoxiaoNeural",
    "apiFormat": "mp3"
  }
}
```
无需 API key。可用语音：`zh-CN-XiaoxiaoNeural`（晓晓）、`zh-CN-YunxiNeural`（云希）、`zh-CN-XiaoyiNeural`（晓伊）。

**方案二：OpenAI 兼容 TTS — provider: "api", apiType: "openai"**

```json
{
  "tts": {
    "provider": "api",
    "apiType": "openai",
    "apiBaseURL": "https://api.openai.com/v1",
    "apiKey": "sk-your-key",
    "apiModel": "tts-1",
    "apiVoice": "alloy",
    "apiFormat": "wav"
  }
}
```

**方案三：DashScope CosyVoice — provider: "api", apiType: "dashscope"**

```json
{
  "tts": {
    "provider": "api",
    "apiType": "dashscope",
    "apiKey": "sk-your-key",
    "apiModel": "cosyvoice-v1",
    "apiVoice": "longxiaochun",
    "apiFormat": "wav"
  }
}
```
需在阿里云百炼开通语音合成服务。

**方案四：GPT-SoVITS 本地 — provider: "sovits"**

```json
{
  "tts": {
    "provider": "sovits",
    "baseURL": "http://127.0.0.1:9880",
    "refAudioPath": "参考音频.wav",
    "promptText": "参考音频文本"
  }
}
```

#### Live2D 模型

将你的 Live2D 模型文件放入 `assets/live2d/` 目录，修改 `config.json` 中的 `live2d.modelPath` 指向模型 JSON 文件。

#### 图片头像（image）

最简单模式，用静态 PNG/JPG 图片作为头像，CSS 动画驱动：

```json
{
  "modelType": "image",
  "image": {
    "src": "assets/image/avatar.png",
    "scale": 0.8,
    "idleAnimation": true
  }
}
```

- `src` — 图片路径（支持相对路径和 URL）
- `scale` — 缩放比例（0.8 = 80%）
- `idleAnimation` — 是否启用待机呼吸动画
- 说话时自动切换为脉冲动画

#### VRM 3D 模型

将你的 `.vrm` 模型文件放入 `assets/vrm/` 目录，设置 `modelType: "vrm"` 并配置：

```json
{
  "modelType": "vrm",
  "vrm": {
    "modelPath": "assets/vrm/your-model.vrm",
    "scale": 12,
    "x": 0,
    "y": -200,
    "cameraFov": 30,
    "cameraDistance": 2.5,
    "autoRotate": false,
    "idleAnimation": ""
  }
}
```

- `scale` — 模型缩放（建议 8-15）
- `x`/`y` — 模型在窗口中的位置偏移
- `cameraFov` — 相机视角（越小模型越大）
- `cameraDistance` — 相机距离（越大模型越小）

VRM 模型自动支持嘴型同步、自动眨眼和视线跟随。

### 4. 启动

#### 方式一：完整启动（推荐）

双击 `start-all.bat`，自动完成：
1. 检查 GPT-SoVITS 环境
2. 安装 npm 依赖（如需要）
3. 启动 GPT-SoVITS API 服务
4. 等待 GPT-SoVITS 就绪后启动桌面应用

#### 方式二：仅启动桌面应用

```bash
npm start
```

或双击 `start-app-only.bat`（需手动先启动 GPT-SoVITS）。

> **注意：** GPT-SoVITS API 默认监听 `http://127.0.0.1:9880`，请确保在启动应用前该服务可用。

## 使用说明

### 基本操作

- **鼠标拖拽** — 拖动角色窗口移动位置
- **文本输入** — 底部输入框输入文字，点击"发送"或按 Enter 对话
- **语音输入** — 点击麦克风按钮，说话后自动识别并发送
- **系统托盘** — 右键点击托盘图标可隐藏/显示窗口或退出
- **全局快捷键** — `Ctrl+Alt+V` 切换窗口显示/隐藏

### 配置详解

| 配置项 | 说明 |
|--------|------|
| `llm.baseURL` | LLM API 地址 |
| `llm.apiKey` | API 密钥 |
| `llm.model` | 模型名称 |
| `llm.systemPrompt` | 角色 system prompt |
| `llm.maxHistoryTurns` | 对话记忆轮数 |
| `modelType` | 模型类型：`"live2d"`（默认）或 `"vrm"` |
| `tts.baseURL` | GPT-SoVITS API 地址 |
| `tts.refAudioPath` | 参考音频路径（用于音色克隆）|
| `tts.promptText` | 参考音频的文本内容 |
| `tts.provider` | TTS 模式：`"sovits"` 或 `"api"` |
| `tts.apiBaseURL` | 第三方 TTS API 地址 |
| `tts.apiKey` | 第三方 TTS API 密钥 |
| `tts.apiModel` | 第三方 TTS 模型（如 tts-1）|
| `tts.apiVoice` | 第三方 TTS 音色（如 alloy）|
| `live2d.modelPath` | Live2D 模型 JSON 路径 |
| `live2d.scale` | Live2D 模型缩放比例 |
| `live2d.x` / `live2d.y` | Live2D 模型位置偏移 |
| `vrm.modelPath` | VRM 模型文件路径 |
| `vrm.scale` | VRM 模型缩放（默认 12）|
| `vrm.x` / `vrm.y` | VRM 模型位置偏移 |
| `vrm.cameraFov` | VRM 相机视角（默认 30）|
| `vrm.cameraDistance` | VRM 相机距离（默认 2.5）|
| `live2d.modelPath` | Live2D 模型 JSON 路径 |
| `live2d.scale` | 模型缩放比例 |
| `live2d.x` / `live2d.y` | 模型位置偏移 |
| `window.clickThrough` | 是否启用鼠标穿透 |
| `window.bubbleAutoHideDelay` | 对话气泡自动消失延迟(ms) |

## 部署说明

本项目为本地桌面应用，无需服务端部署。如需在不同机器上运行：

1. **安装 GPT-SoVITS** — 在目标机器上部署 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)，确保 API 服务可访问
2. **安装 Node.js** — 目标机器需要 Node.js >= 18.x
3. **复制项目** — 克隆或复制本项目到目标机器
4. **安装依赖** — 运行 `npm install`
5. **配置** — 修改 `config.json` 中的 API 密钥和服务地址
6. **启动** — 先启动 GPT-SoVITS，再运行 `npm start`

### 仅使用 LLM（无需 TTS）

如果你不需要语音功能，可以将 `tts.baseURL` 留空或指向无效地址，应用会仅以文字气泡形式回复。

### 更换 Live2D 模型

1. 将模型文件夹放入 `assets/live2d/` 目录
2. 修改 `config.json` 中 `live2d.modelPath` 为相对路径
3. 调整 `live2d.scale` 和位置偏移适配新模型

## 技术栈

- **[Electron](https://www.electronjs.org/)** — 跨平台桌面框架
- **[PixiJS](https://pixijs.com/) v7** — 2D Live2D 渲染引擎
- **[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)** — Live2D 渲染插件
- **[Cubism 4 Core](https://www.live2d.com/sdk/about/cubism-core/)** — Live2D 运行时
- **[Three.js](https://threejs.org/)** — 3D VRM 渲染引擎
- **[@pixiv/three-vrm](https://github.com/pixiv/three-vrm)** — VRM 模型加载与渲染
- **[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)** — 语音合成
- **OpenAI-compatible API** — LLM 接口

## 许可证

本项目采用 **MIT** 协议开源。详见 [LICENSE](./LICENSE) 文件。

### 第三方依赖许可

| 组件 | 协议 |
|------|------|
| Electron | MIT |
| PixiJS | MIT |
| pixi-live2d-display | MIT |
| Three.js | MIT |
| @pixiv/three-vrm | MIT |
| GPT-SoVITS | MIT |
| Live2D Cubism Core | Live2D 专有许可（免费非商业使用）|

