# dsh-waifu 🐾

[English](README.en.md) | 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/lof6yo/dsh-waifu)](https://github.com/lof6yo/dsh-waifu/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

给 DeepSeek Harness 请了个看板娘：你思考它歪头，你完成它撒花，还能摸头——**触摸部位由你自己画 box 定义**。

内置唯一模型「简」（随包分发，开箱即用）。角色的**台词、动作、表情全部由 AI 驱动**（ADR-037）：没有固定对白，没有人手维护的映射表；模型按人设 + 场景 + 历史即兴反应。触摸部位是用户自定义的 **touchbox**（名称 + 多个矩形 + 图层）。

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-waifu 主视觉" width="920" />
</p>

## 特性

- **内置模型「简」**：随插件包分发（moc3 / 纹理 / 物理 / cdi3），无需下载模型；动作资源为 5 个自建动作（`Idle` 呼吸/微摆/眨眼、`Nod` 点头、`ShakeHead` 摇头、`Tilt` 歪头、`Sway` 左右晃），由 `scripts/gen-jian-motions.mjs` 幂等生成（ADR-021）；本版**不提供**模型选择 / 导入。
- **全 AI 驱动（ADR-037）**：台词 / 动作 / 表情 / 记忆全部由模型决定。输入 = 人设 + 场景（触摸按力度分轻碰 / 戳戳 / 抚摸、DSH 事件、交互框对话、静默超时）+ 带时间戳历史 + 记忆文件；输出 = `[表情][动作] 正文` + `[记]` 记忆行；AI 失败时角色静默。触发调度可配：事件开关（16 类）、最小间隔、同类窗口、截断抢占 / 排队等说完。
- **用户自定义触摸部位（touchbox）**：不再依赖模型 HitArea。部位 = 名称 + 一个或多个归一化矩形 box（相对角色包围盒 0–100% 输入，**以左下角为原点**，上 = 调大往上长）+ 图层。重叠时按**图层顺序**（上层部位优先），支持 ↑/↓ 排序。
- **预览编辑**：设置页「触摸部位」→「预览 box」在角色上实时显示全部 box；边调数值边看效果，预览态点击角色可直接试触发台词 / 动作。
- **状态镜像**：SSE 实时推送 agent 状态与 17 种 DSH 事件；完成与文件交付会触发模型演绎。
- **显示配置**：开关 / 尺寸 / 渲染帧率 / 画布留白（防动作甩尾被裁切）/ 默认位置（显示区中心距右/距下）+ 一键归位 / 对白气泡位置、背景、文字样式与最长显示时长（默认 30s，0 = 不限）。
- **不打扰**：默认右下角、小尺寸、可拖动、可隐藏；画布透明区**点击穿透**（只有 touchbox 接收点击，不会挡住 DSH UI）；允许拖到窗口外一半但中心点不出视口；标签页隐藏暂停渲染、限帧渲染、低配回退静态头像。
- **渲染质量**：HiDPI 2x 缓冲 + antialias；触摸部位叠加层同倍率绘制。
- **可排查**：浏览器侧启动里程碑 / 错误会写入 `$DSH_HOME/waifu/client.log`，无控制台也能定位模型加载问题。

## 环境要求

- DeepSeek Harness（DSH）**0.2.x**（Desktop 或 Web 均可）
- 安装 / 更新插件时需要能访问 GitHub 与 npm registry 的网络
- 插件包已内置构建产物 `lib/`，安装端**不需要**本地编译

## 安装

### 从 GitHub 直接安装（推荐）

在终端执行（`<profile>` 换成你的 DSH profile，如 `desktop` / `web`）：

```sh
dsh plugin --profile <profile> add github:lof6yo/dsh-waifu
```

也可以用完整 Git 地址：

```sh
dsh plugin --profile <profile> add https://github.com/lof6yo/dsh-waifu.git
```

> 其他等价写法（取决于 dsh 版本）：`github:lof6yo/dsh-waifu#main`、`github:lof6yo/dsh-waifu#<commit>`。
> 仓库根目录的 `lib/index.js`、`lib/client.js` 是构建好的运行产物，所以 git 安装后即可直接使用。

安装完成后确认：

```sh
dsh plugin --profile <profile> list
```

插件会以 **dsh-waifu** 出现在列表中。刷新（或重启）DSH 页面，右下角出现「简」；也可以在 DSH 设置 → Plugins / 插件管理中查看并启用。

### 本地开发安装

```sh
git clone https://github.com/lof6yo/dsh-waifu.git
cd dsh-waifu
bun install          # 依赖安装（仓库约定使用 bun）
bun run build        # 生成 lib/（修改源码后必须重新构建并提交 lib/，否则 git 安装仍是旧产物）
dsh plugin --profile <profile> add /绝对路径/dsh-waifu
```

### 卸载

```sh
dsh plugin --profile <profile> remove dsh-waifu
```

卸载后插件私有数据仍保留在 `$DSH_HOME/waifu/`，如不需要可手动删除。

## 使用

打开 DSH **设置 →「桌宠配置」**，页面为单页分组流程：

### 显示

- **基础显示**：显示宠物开关 / 尺寸滑杆（40–400px，默认 300）/ 渲染帧率（30 / 60 / 不限制）
- **鼠标跟随范围**：头/眼睛只在鼠标进入「模型外扩 x%」的矩形内才跟随（默认 60%，0 = 只在模型框内），其余时候正视前方
- **画布与位置**：水平 / 垂直留白（每侧占尺寸百分比，默认 125 / 50，防止甩尾被裁切）；默认位置（显示区中心点距窗口右 / 底，**按窗口宽高的百分比**，默认 15 / 24）与「归位」（回到默认位置）、「捕捉」（把当前位置设为默认位置）两个按钮
- **对白气泡**：水平 / 垂直偏移（相对角色包围盒顶部中心；垂直偏移正值向上、负值向下）、背景色、背景不透明度、文字颜色

### 触发调度（全 AI 驱动）

没有固定台词，也没有手动映射——一切反应都是一次 AI 演绎（ADR-037）：

- **场景输入**：触摸（部位 + 交互名；部位没配自定义交互时按按压时长分轻碰 <250ms / 戳戳 250–900ms / 抚摸 ≥900ms）、DSH 事件（17 键：思考 / 出错 / 完成 / 交付 / 等审批 + 11 种活动事件）、交互框对话（用户原话）、静默超时（多久没互动就主动说一句）
- **模型输出**：`[表情][动作] 正文` 开头标签驱动表情与动作（表情保持 4.2s、动作 FORCE 播放）；另起一行的 `[记] …` 写入记忆文件
- **触发规则**：触摸与对话必可触发；事件类按 16 个开关 + 最小间隔（默认 3s）+ 同类窗口（默认 3s，窗口内同类合并进下一次场景）；新触发可选「截断抢占」（掐掉上一轮）或「排队等说完」
- **AI 失败 = 静默**：模型不可用时角色不出气泡不播动作（物理反应照常），没有固定台词可回落

### 触摸部位（当前模型）

1. 点「预览 box」：角色进入预览态，实时显示当前所有 touchbox；预览态下点击角色可试触发对应台词 / 动作（不影响编辑与保存）
2. 「+ 新建部位」→ 输入名称
3. 「+ 添加 box」→ 输入 **左 / 上 / 右 / 下**（相对角色包围盒的百分比 0–100，**以左下角为原点**：调大「上」box 往上长、调小「下」box 往下长），box 实时显示；一个部位可加多个 box 拼出不规则区域
4. 部位只定义**位置与名字**——台词与动作由 AI 按场景即兴（ADR-037）
5. 部位有**图层**：列表从上到下 = 从顶层到底层，box 重叠时上层生效；用「↑ / ↓」调整，新建部位默认在最上层
6. 修改按部位粒度提示保存（卡片头「保存」；新建 / 删除 / 排序在分组顶部提示保存），保存后写入 `$DSH_HOME/waifu/touch-parts.jsonc`

### AI 驱动

- 开关在设置页「AI 驱动」分组；开启后角色的一切反应（台词 / 动作 / 表情）由 DSH 已配置的模型现场生成（复用 provider 与账号，不需要另外填 Key）；关闭后角色完全静默
- `Provider` / `模型` 是**下拉选择**：候选取自 DSH 已注册的 LLM provider 与模型目录（`GET /api/dsh-waifu/ai-options`）；某个 provider 不提供模型清单时回落成手填输入框
- 人设直接在设置页的文本框里改，点「保存人设」写入 `$DSH_HOME/waifu/persona.md`（首次开启自动生成模板：短句、口语、不要旁白），下一次触摸即生效
- **记忆**：设置页可查看 / 编辑 / 保存 `$DSH_HOME/waifu/memory.md`；模型觉得值得记的事会以 `[记]` 行落盘（每条带时间戳），下轮注入最近 N 条（默认 20，0 = 不注入）
- 「注入对话历史（轮）」默认 20（1 轮 = 一问一答）：把最近的成功往来一起发给模型，台词能接上前面的话；每条带 `[HH:MM]` 时间戳（跨天 `[11/4 21:03]`），当前情景里也写着「现在是 X月X日 周X HH:MM」；设为 0 = 每次独立（历史只存在内存，重启即清空）
- **输出格式**：模型在正文开头用 `[表情][动作]` 标签选择表现（标签不显示也不念出来），正文按句读流式合成语音（见下）；`[记]` 行单独处理
- **活动提示**：跑命令 / 读文件 / 写文件 / 派子代理、审批被批准或被拒、会话开关、子代理进出时也走 AI 演绎（设置页可按事件类型关掉；上下文压缩/记忆/待办这类内部工具不触发）
- **情绪联动**：表情标签驱动表情（害羞→脸红、开心→星星眼、生气→生气……）；说话时会有轻微点头与挑眉。
- **交互条**：模型上方 / 下方的一条胶囊（设置页「显示 → 交互条」选贴哪一侧、或直接不显示，旁边还能填偏移像素微调远近）；右边输入框回车或点圆形发送按钮都能发。左边圆形按钮是语音静音开关，右边输入框回车就能跟角色说话——走人设 + 场景 + 最近历史，回复照常有气泡、语音和口型
- **待机小动作**：空闲时每 7–16s 随机来一个微动作（偏头 / 抬眉 / 换重心 / 叹气），关掉只剩 Idle 循环（设置页「显示 → 待机小动作」）。
- 排查：`GET /api/dsh-waifu/ai-debug` 返回最近一次**真正发给模型的载荷**（system 人设 + 逐条 messages）与当前历史缓冲，用来确认历史注入到底进没进请求

### 语音

- 开关在设置页「语音」分组：开启后 AI 台词会**说出来**，并且气泡、语音、口型三者同步
- 模型与音色都是**下拉**：只有两个通义千问 TTS 模型——`qwen/qwen-audio-3.0-tts-flash`（默认，`longanxiaoxin` 龙安小昕）与 `qwen/qwen-audio-3.0-tts-flash`（便宜、女声最多，`longanyuanfei` 高傲妃子 / `longanlingxi` 可爱甜美 / `longanxiaoxin` 亲切活泼 等）。音色只收女声，来源是[千问 TTS 音色列表](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)
- 合成走 OpenRouter 的 `/api/v1/audio/speech`（OpenAI 兼容），默认模型 `qwen/qwen-audio-3.0-tts-flash`；Key 直接用 DSH 凭据里的 `OPENROUTER_API_KEY`（就是在「设置 → 模型」里填过的那份），不用在这里再填一次
- **同步方式**：模型出字的同时按标点切成小段，每段立刻合成 → 该段音频**开始播放时**气泡才出现这一段文字。所以不会出现「字全出来了声音还没跟上」，也不会出现「说着上一句、屏幕上是下一句」
- **口型**：`ParamMouthOpenY` 由正在播放的那段音频的波形能量驱动（张得快、收得慢），强度 0–300% 可调；不想要口型可以单独关掉
- **试听一句**：设置页按钮，直接用当前模型 / 音色合成一句话播放，调参不用反复去戳宠物
- 容错：语音关掉、或这一句模型没吐出任何文字时，自动回落成原来的一次性文字回复；个别小段合成失败只是那段没声音，文字照常上屏（不会丢字）
- 成本：同文同参数命中本地缓存（`$DSH_HOME/waifu/tts-cache`，最多留 200 段），重复的句子不再计费；一句台词通常 2–4 段
- 注意：浏览器只允许在用户交互后播放声音，所以第一次出声前需要点一下页面（插件在你第一次戳她时会自动解锁音频）

### 开发者选项

- 总开关；开启后可打开调试面板（状态演示、模型原生动画预览）与「显示触摸部位色块」叠加层

### 配置文件

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/waifu/settings.jsonc` | 显示 / 渲染 / 画布 / 气泡等标量设置 |
| `$DSH_HOME/waifu/touch-parts.jsonc` | 触摸部位（parts：图层 / box） |
| `$DSH_HOME/waifu/persona.md` | AI 驱动的人设提示词（ADR-025） |
| `$DSH_HOME/waifu/memory.md` | 角色记忆（模型写入，可编辑，ADR-037） |
| `$DSH_HOME/waifu/tts-cache/` | 语音合成缓存（ADR-033，最多 200 段 mp3，可随时清空） |
| `$DSH_HOME/waifu/client.log` | 浏览器侧诊断日志（启动里程碑 / 错误栈） |
| `$DSH_HOME/waifu.json` | 宠物显示位置（拖动 / 归位后持久化） |

这些文件都是插件私有 JSONC（允许注释），可直接编辑；文件写坏时插件沿用上一份好结果并在设置页提示。

每个部位还可以定义自己的**交互**：起一个名字（会原样告诉模型，例如「抚摸」「捏脸」）+ 触发条件（单击 / 双击 / 停留）。没定义交互的部位仍按内置的轻碰 / 戳戳 / 抚摸三档交给模型。

## 项目结构

```text
dsh-waifu/
├── assets/
│   ├── icons/                 # 设置导航图标
│   ├── models/jian/           # 内置「简」模型（moc3 / 纹理 / physics3 / cdi3 / model3.json / motions）
│   └── vendor/                # 随包运行时：pixi、Cubism Core、live2d-display
├── src/
│   ├── index.ts               # Host 入口：插件行、settings、路由
│   ├── service.ts             # 状态机 + 活动归类 + 触摸部位 / 显示配置快照
│   ├── routes.ts              # 同源 API / SSE / 素材路由 / 诊断日志
│   ├── models.ts              # 共享类型：AI_MOTIONS / 表情 / TouchPart/TouchBox、hitTest
│   ├── models-host.ts         # 内置 presets 读取与解析
│   ├── settings-store.ts      # 插件私有 settings.jsonc
│   ├── touch-parts.ts         # 插件私有 touch-parts.jsonc（parts）
│   ├── ai.ts                  # LLM 演绎：场景文案 / 标签解析 / 流式
│   ├── memory.ts              # 角色记忆 memory.md 读写
│   ├── speak.ts               # 句读流式管线（LLM 流 → TTS 段 → SSE）
│   ├── persist.ts             # 显示位置持久化
│   ├── client-log.ts          # 浏览器诊断日志落盘
│   └── client/                # 浏览器半区（React）：宠物、设置页、事件通信
├── scripts/gen-jian-motions.mjs  # 「简」动作生成 / 校验（幂等）
├── docs/                      # 产品意图 / 行为规格 / ADR
├── lib/                       # 构建产物（随仓库提交，GitHub 安装直接可用）
├── cordis.patch.yml           # DSH bundle patch（插入 dsh-waifu 插件行）
├── package.json
└── tsdown.config.ts
```

## 开发

```sh
bun install
bun run build        # tsdown：lib/index.js（Host）+ lib/client.js（浏览器）
bun run typecheck    # tsc --noEmit
bun run test         # vitest（--pool=threads）
```

- **提交前必须重新构建 `lib/`**：GitHub / git 安装直接使用仓库里的 `lib/`，不提交新构建会安装到旧产物。
- 修改模型动作后运行 `bun scripts/gen-jian-motions.mjs`（或本机用 DSH 自带 node 运行），脚本会重建 `assets/models/jian/motions/` 并校验 Meta / 参数 / 引用。
- 本机没有全局 node/bun 时可用 DSH Desktop 自带的运行时执行构建 / 类型检查 / 测试，见 [AGENTS.md](AGENTS.md)。

## 文档

| 需求 | 文档 |
|------|------|
| 产品意图 | [`docs/intent/dsh-waifu.md`](docs/intent/dsh-waifu.md) |
| 行为规格 | [`docs/spec/dsh-waifu-v01.md`](docs/spec/dsh-waifu-v01.md) |
| 架构决策 | [`docs/adr/`](docs/adr/)（渲染栈 ADR-003、内置模型与 touchbox ADR-014、事件绑定 ADR-015、更名与移除自定义模型 ADR-016） |
| 开发约定 | [AGENTS.md](AGENTS.md) |

## 许可

- **插件代码**：MIT，见 [LICENSE](LICENSE)；基于 [cyanfish-x/dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets) 分叉改造。
- **内置模型「简」**：用户自备模型（VTube Studio 导出），随插件包内置；**公开分发 / 再发布前请确认模型作者授权**（许可标注见 [`src/presets/presets.jsonc`](src/presets/presets.jsonc)）。
- **Live2D SDK / Cubism Core**：按 [Live2D 官方条款](https://www.live2d.com/eula/) 使用。

## 常见问题

- **安装后没看到宠物**：确认 `dsh plugin --profile <profile> list` 中有 `dsh-waifu`；刷新页面；查看 `$DSH_HOME/waifu/client.log` 是否有加载错误（模型加载失败时宠物会降级为静态头像）。
- **触摸没反应**：确认「触摸部位」里已有部位且 box 覆盖点击位置；预览态下可以点击试触发；未命中任何 box 时不会响应。
- **想换模型 / 导入自己的模型**：本版不支持（专注内置「简」）。
- **没有声音 / 让 LLM 用人设说话**：当前版本不含，后续规划。
