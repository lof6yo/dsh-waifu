# dsh-waifu 🐾

[English](README.en.md) | 简体中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/lof6yo/dsh-waifu)](https://github.com/lof6yo/dsh-waifu/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

给 DeepSeek Harness 请了个看板娘「简」：你思考她歪头，你完成任务她接话，你戳她她会顶嘴。

**没有固定台词、没有手写映射表**——台词、动作、表情全靠 AI 按人设 + 场景 + 历史即兴（ADR-037）。触摸部位由你自己在角色上画 box 定义，每个部位还能配多套「交互」（捏 / 亲 / 抚摸……单击、双击、悬停各自触发）。

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-waifu 主视觉" width="920" />
</p>

## 特性

- **内置模型「简」**：随包分发（moc3 / 纹理 / 物理 / cdi3），装完即用，不需要下载模型；本版**不提供**模型选择与导入。
- **全 AI 驱动（ADR-037）**：输入 = 人设 + 场景（触摸部位与交互名、16 类 DSH 场景、交互框对话、静默超时）+ 带时间戳的历史 + 记忆；输出 = `[表情][动作] 正文`，另起一行的 `[记] …` 写进记忆。AI 不可用时角色**静默**（不编固定台词），物理反应照常。
- **自带 8 个动作 + 11 个表情**：动作 点头 / 摇头 / 歪头 / 左右晃 / 瞥一眼 / 竖起耳朵 / 换重心 / 叹气（外加 `Idle` 呼吸循环），由 `scripts/gen-jian-motions.mjs` 幂等生成；表情 脸红 / 生气 / 星星眼 / 白眼 / 泪花 / 爱心眼 / 眼泪 / 脸黑 / 羞愤 / 高光消失 / 眨眼（眨眼是俏皮单眼 wink，用一次性动作实现，播一遍即结束）。
- **自定义触摸部位（touchbox）**：部位 = 名称 + 一个或多个归一化矩形（相对角色包围盒，0–100%，以左下角为原点）+ 图层；重叠时上层优先。每个部位可定义多条**交互**：名字（原样告诉模型）+ 触发方式（单击 / 双击 / 悬停 N 秒）。内置「简」的十个部位已按手感命名好（脸 = 捏 / 亲 / 抚摸，胸 = 揉捏 / 舔 / 抚摸……）。
- **预览编辑**：设置页点「预览 box」，角色身上实时画出全部 box，边调边点就能试触发，不影响已保存内容。
- **语音（ADR-033）**：模型出字 → 按句读切段 → 每段 TTS 合成 → **该段音频开始播放时**气泡才出这一段字，口型由音频能量驱动，三者同步。两个通义千问音色模型、女声可选，走 OpenRouter，Key 复用 DSH 凭据。
- **状态镜像**：SSE 实时推送 agent 状态；工具执行、审批通过/拒绝、会话开关、子代理进出都会让角色抬眼看一眼（可按场景关掉）。
- **交互条**：模型上方一条胶囊，输入框回车就能跟角色说话；左边圆形按钮是语音静音开关。无操作 10 秒后自动收起，鼠标移到角色上再出现（时限可调、可关）；收起时气泡跟着下移贴近模型，不留空档。
- **不打扰**：默认右下角小尺寸、可拖动、可隐藏；画布透明区**点击穿透**（只有 touchbox 接点击，不挡 DSH 界面）；标签页隐藏时暂停渲染、限帧、低配回落静态头像。
- **调试面板**：默认开启。右上角按钮可折叠/展开，可拖动移动、拖四角改大小（几何记在浏览器 localStorage），默认按视口给足尺寸；含场景演示、动画/表情预览，以及一个按**真实发生顺序**记录整条链路的控制台（`trigger → llm.request → llm.reply → tts.request → tts.reply → play.*`），控制台吃满面板剩余高度、面板自身不滚动，一键复制。
- **可排查**：浏览器侧启动里程碑与错误写入 `$DSH_HOME/waifu/client.log`，没开控制台也能定位模型加载问题。

## 环境要求

- DeepSeek Harness（DSH）**0.2.x**（Desktop / Web 均可）
- 安装与更新时需要能访问 GitHub 与 npm registry
- 插件包已内置构建产物 `lib/`，安装端**不需要**本地编译
- 想用 AI 台词 / 语音：DSH 里要配好一个 LLM provider（默认 `openrouter` + `google/gemma-4-31b-it`）与 `OPENROUTER_API_KEY`（语音用同一份 Key）

## 安装

### 从 GitHub 直接安装（推荐）

```sh
dsh plugin --profile <profile> add github:lof6yo/dsh-waifu
```

`<profile>` 换成你的 DSH profile（`desktop` / `web` 等）。等价写法：完整地址 `https://github.com/lof6yo/dsh-waifu.git`、指定分支或提交 `github:lof6yo/dsh-waifu#main`、`github:lof6yo/dsh-waifu#<commit>`。

仓库里的 `lib/index.js`、`lib/client.js` 就是构建好的运行产物，git 安装后即可直接用。

安装后确认：

```sh
dsh plugin --profile <profile> list
```

列表中出现 **dsh-waifu** 即可；刷新页面，右下角出现「简」。也可以在 DSH 设置 → 插件管理里启用/停用。

> 装了新版代码但行为没变？**客户端**（`client.js`）每次刷新都从磁盘读，改完即生效；**Host 半区**（`lib/index.js`）受同进程模块缓存影响，更新后要重启 DSH 进程才会换。

### 本地开发安装

```sh
git clone https://github.com/lof6yo/dsh-waifu.git
cd dsh-waifu
bun install                 # 仓库约定用 bun 装依赖
bun run build               # 生成 lib/（改源码后必须重建并提交 lib/）
dsh plugin --profile <profile> add /绝对路径/dsh-waifu
```

### 卸载

```sh
dsh plugin --profile <profile> remove dsh-waifu
```

插件私有数据仍留在 `$DSH_HOME/waifu/`，不再需要可手动删掉。

## 使用

打开 DSH **设置 →「桌宠配置」**。单页从上到下五个分组：**显示 / 触摸部位 / AI 驱动 / 语音 / 开发者选项**。

### 显示

- **基础显示**：显示开关、尺寸（40–400px，默认 **280**）、渲染帧率（30 / 60 / 不限制）、待机小动作（空闲时随机来个偏头 / 抬眉 / 换重心 / 叹气）
- **视线跟随范围**：鼠标进入「模型外扩 x%」区域才跟随（默认 **100%**，0 = 只在模型框内），其余时间正视前方
- **画布与位置**：水平 / 垂直留白（每侧占尺寸百分比，默认 **125 / 50**，防止甩尾被裁）；默认位置（显示区中心距窗口右 / 底，按窗口宽高百分比，默认 **10 / 0**），旁边有「归位」（回默认位）与「捕捉」（把当前位置设为默认）
- **对白气泡**：水平 / 垂直偏移（相对角色包围盒顶部中心，默认 **0 / 24**，正值向上）、背景色（默认 `#ffffff`）、不透明度（默认 92）、文字颜色（`#222222`）、最长显示秒数（默认 **10**，0 = 不限）；交互条贴在模型上方且已自动收起时，气泡随之下移贴近模型
- **交互条**（设置页在「AI 驱动 → 触发」）：贴模型上方 / 下方 / 不显示（默认上方），偏移 px 微调（默认 **-30**）；无操作多久后自动收起（默认 **10 s**，0 = 一直显示）；收起时气泡下移填补交互条原来占的空档

### 触摸部位（当前模型）

1. 点「预览 box」：进入预览态，实时画出所有 box；此时点角色可**直接试触发**（不改数据）
2. 「+ 新建部位」→ 起名
3. 「+ 添加 box」→ 填 **左 / 上 / 右 / 下**（相对角色包围盒的百分比 0–100，**左下角为原点**：调大「上」box 往上长，调小「下」往下长）；一个部位可加多个 box 拼不规则区域
4. 点「+ 添加交互」给部位加交互：起名（会原样告诉模型，例如「捏」「舔」）+ 触发方式（单击 / 双击 / 悬停 N 毫秒，300–10000，默认 3000）；交互名不能为空。悬停 = 鼠标放在 box 内够久就触发，移出或按下即重置，单趟只触发一次。**没定义交互的部位点了不会有反应**
5. 部位有**图层**：列表从上到下 = 顶层到底层，box 重叠时上层生效，用「↑ / ↓」调，新建部位默认在最上层
6. 保存按部位粒度提示（卡片头「保存」，新建 / 删除 / 排序在分组顶部提示），落盘 `$DSH_HOME/waifu/touch-parts.jsonc`

### AI 驱动

- 总开关：开启后台词 / 动作 / 表情全部由模型现场生成（复用 DSH 已配的 provider 与 Key，不用另填）；关闭后角色完全静默
- **Provider / 模型**是下拉（候选取自 `GET /api/dsh-waifu/ai-options`，即 DSH 已注册的 LLM 目录），旁边「测试」按钮做一次自检，结果显示在「自检」行
- **注入对话历史**（默认 10 轮，1 轮 = 一问一答；0 = 不注入）：把最近的成功往来一起发过去，台词能接上前面的话。历史是一行式短句，**只有主人那侧带时间戳**、她的台词连着当时的标签一起记（`[blush][ShakeHead] 别…`），模型能从自己的历史里看到「该怎么写」；只有当前这轮用完整场景句
- **注入记忆**（默认 20 条）：`memory.md` 里最近 N 条拼进提示词
- **动作与表情**卡片：列出当前模型可被模型选用的动作（8 个）与表情（11 个），勾选框决定「是否发给模型供选择」（关掉 = 不进提示词目录、写出来也被过滤）；每行可改「给模型的释义」（留空用内置，≤80 字），还能点「预览」立刻在角色上播一下（表情「眨眼」是一次性动作，播一遍即结束）。表情「羞愤」默认不发给模型
- **触发方式**：`queue`（等上一轮说完，默认）或抢占（掐掉上一轮）
- **最小间隔**（默认 1s，0 = 不限）、**静默超时**（默认 600s = 10 分钟没动静就主动说一句，0 = 关）、**同类事件窗口**（默认 10s，窗口内同类事件合成一条）、**触摸连点窗口**（默认 1200ms，连点只留最后一次）、**合并上限**（默认 6 条）——这五个窗口都只在客户端调度器里判断，Host 不按频率拒绝（ADR-047）
- **触发场景**：16 类事件各自一个开关 + 一个文本框，可覆写「这件事怎么描述给模型」（留空用内置文案，截 60 字）。默认只开 8 个：思考中 / 出错 / 完成 / 交付成果 / 等确认 / 审批通过 / 审批拒绝 / 会话开启；工具调用五类、会话结束、子代理进出默认关（会话里太吵）
- **人设**：直接在下拉下方文本框编辑，点「保存人设」写入 `$DSH_HOME/waifu/persona.md`。插件只把这份文本原样放在 system 开头，不解析、不假设里面写了什么（像换卡带）；没有这个文件时用内置的通用默认人设，想回到它点「恢复默认」
- **记忆**：同页可查看 / 编辑 / 保存 `$DSH_HOME/waifu/memory.md`

活动类事件各播一个短动作（不写气泡、不压状态）：`tool-read → 瞥一眼`、`tool-write → 竖起耳朵`、`tool-run → 换重心`、`tool-agent → 点头`、`tool-other → 歪头`、`approval-granted → 点头`、`approval-denied → 摇头`、`session-open → 竖起耳朵`、`session-close → 叹气`、`subagent-start → 瞥一眼`、`subagent-end → 点头`。

### 语音

- 总开关 + **语音模型**（下拉，两个通义千问 TTS）：
  - `qwen/qwen-audio-3.0-tts-plus`（旗舰，支持指令控制）：龙安灵心（25 岁·知心温暖）
  - `qwen/qwen-audio-3.0-tts-flash`（女声最多、便宜，**默认**）：龙安元妃 / 风悦 / **灵希（默认音色，25 岁·可爱甜美）** / 小昕 / 欢 / 龙泡泡 / loongmary / loongeva
- 音色只收女声，列表见[千问 TTS 音色文档](https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts)；音色按模型区分，跨模型用会被供应商拒 400
- 合成走 OpenRouter 的 `/api/v1/audio/speech`（OpenAI 兼容），Key 直接用 DSH 凭据里的 `OPENROUTER_API_KEY`
- **同步方式**：文字按标点切段，每段合成完、**开始播这一段时**气泡才显示这一段，不会「字全出来声音还没跟上」，也不会「说着上一句、屏幕是下一句」
- **口型**：`ParamMouthOpenY` 由正在播放的音频能量驱动（张得快、收得慢），强度 0–300%（默认 130%），可单独关掉口型
- **试听**：设置页按钮，用当前模型 / 音色合成一句，调参不用反复戳宠物
- 容错：语音关闭或这句没有文字时回落一次性文字回复；个别小段失败只丢那段的音，文字照常上屏
- 成本：同文同参数命中本地缓存（`$DSH_HOME/waifu/tts-cache`，最多 200 段），重复句子不再计费；一句台词通常 2–4 段
- 浏览器只允许在用户交互后出声：第一次戳她会顺便解锁音频

### 开发者选项

- 总开关（默认开）→ 「调试面板」与「显示触摸部位色块」两个独立开关
- **调试面板**：从上到下是**场景演示**（下拉任一场景 + 播放，强制走真实触发链路——台词动作表情语音都由 AI 即兴，跳过场景开关与最小间隔，也不占真实事件的时间预算；AI 总开关关掉时只记日志）、**动画预览**、**表情预览**、**控制台**，最底下是一行实时状态：agent 状态 / 宠物状态 / 版本 / 部位数 / 当前表情 / 位置与尺寸 / 模型与画布尺寸
- **面板摆放**：默认自动跟随（水平居中在角色上方，空间不够贴顶部；此时气泡会再叠到面板上面）。右上角按钮折叠/展开（折叠只留标题栏）；按住标题栏拖动、拖四角改大小（最小 320×400，整块始终留在视口内），松手即记进 localStorage（键 `dsh-waifu.debug-panel:v1`）；拖过之后不再跟随模型、也不再影响气泡位置，双击标题栏回到自动跟随
- **控制台**：点「开始记录」后按真实发生顺序显示 `trigger`（这轮由什么触发）→ `llm.request`（完整请求 JSON，含 system 与每条 messages、采样参数）→ `llm.reply`（模型完整原始输出）→ `tts.request`（完整请求体）→ `tts.reply`（bytes / mime / cached / ms）→ `play.expression` / `play.motion` / `play.audio`（实际应用的表情动作与每段时长）。音频只记字节数，逐字增量不记；单行上限 20000 字。控制台占满面板剩余高度、多出的行在控制台内部滚动，「停止记录」只暂停不清空，「清空」与「复制」各一个按钮

## 默认值一览

| 项 | 默认 | 说明 |
|---|---|---|
| 尺寸 | 280 px | 40–400 |
| 渲染帧率 | 30 | 30 / 60 / 不限制 |
| 画布留白 | 125 / 50 | 每侧占尺寸百分比 |
| 默认位置 | 右 10 / 下 0 | 窗口宽高百分比 |
| 气泡偏移 | 0 / 24 | 正值向上 |
| 气泡最长 | 10 s | 0 = 不限 |
| 视线跟随范围 | 100% | 0 = 只在模型框内 |
| 待机小动作 | 开 | 空闲 7–16s 随机一次 |
| 交互条 | 模型上方，-30 px | 可关 |
| 交互条自动隐藏 | 10 s | 0 = 一直显示 |
| AI 驱动 | 开 | `openrouter` / `google/gemma-4-31b-it` |
| 注入历史 / 记忆 | 10 轮 / 20 条 | 0 = 不注入 |
| 触发方式 | queue | 或抢占 |
| 最小间隔 | 1 s | 0 = 不限 |
| 静默超时 | 600 s | 0 = 关 |
| 同类事件窗口 | 10 s | 同 kind 合并 |
| 触摸连点窗口 | 1200 ms | 连点只留最后一次 |
| 合并上限 | 6 条 | 超出丢最旧 |
| 场景开关 | 8 / 16 开 | 见上文 |
| 语音 | 开 | Flash + 龙安灵希 |
| 口型强度 | 130% | 0–300 |
| 开发者选项 / 调试面板 | 开 | |

## 配置文件

| 文件 | 内容 |
|---|---|
| `$DSH_HOME/waifu/settings.jsonc` | 显示 / 渲染 / 位置 / 气泡 / AI / 语音等标量设置 |
| `$DSH_HOME/waifu/touch-parts.jsonc` | 触摸部位（parts：图层 / box / 交互） |
| `$DSH_HOME/waifu/persona.md` | 人设提示词（ADR-025） |
| `$DSH_HOME/waifu/memory.md` | 角色记忆（模型写入，可编辑，ADR-037） |
| `$DSH_HOME/waifu/tts-cache/` | 语音缓存（最多 200 段，可随时清空） |
| `$DSH_HOME/waifu/client.log` | 浏览器侧诊断日志（启动里程碑 / 错误栈） |
| `$DSH_HOME/waifu.json` | 宠物显示位置（拖动 / 归位后持久化） |

都是插件私有 JSONC（允许注释），可直接编辑；写坏时沿用上一份好结果并在设置页提示。

## 项目结构

```text
dsh-waifu/
├── assets/
│   ├── icons/                 # 设置导航图标
│   ├── models/jian/           # 内置「简」模型（moc3 / 纹理 / physics3 / cdi3 / model3.json / motions）
│   └── vendor/                # 随包运行时：pixi、Cubism Core、live2d-display
├── src/
│   ├── index.ts               # Host 入口：插件行、settings、路由
│   ├── defaults.ts            # 全部默认值（设置项 / 场景文案 / 动作表情释义 / TTS 目录）
│   ├── service.ts             # 状态机 + 活动归类 + 配置快照
│   ├── routes.ts              # 同源 API / SSE / 素材路由 / 诊断日志
│   ├── models.ts              # 共享类型：AI_MOTIONS / 表情 / TouchPart / hitTest
│   ├── models-host.ts         # 内置 presets 读取与解析
│   ├── presets/presets.jsonc  # 内置模型与默认触摸部位（含交互）
│   ├── settings-store.ts      # settings.jsonc 读写
│   ├── touch-parts.ts         # touch-parts.jsonc 读写（parts / 交互）
│   ├── ai.ts                  # LLM 演绎：场景文案 / 标签解析 / 流式 / 人设
│   ├── trace.ts               # 链路记录（控制台的 debug 帧）
│   ├── memory.ts              # memory.md 读写
│   ├── speak.ts               # 句读流式管线（LLM 流 → TTS 段 → SSE）
│   ├── tts.ts                 # TTS 引擎（OpenRouter /audio/speech）
│   ├── persist.ts             # 显示位置持久化
│   ├── client-log.ts          # 浏览器诊断日志落盘
│   └── client/                # 浏览器半区：宠物渲染、设置页、事件通信
├── scripts/gen-jian-motions.mjs  # 「简」动作生成 / 校验（幂等）
├── docs/                      # 产品意图 / 行为规格 / ADR
├── lib/                       # 构建产物（随仓库提交，git 安装直接可用）
├── cordis.patch.yml           # DSH bundle patch（插入 dsh-waifu 插件行）
├── package.json
└── tsdown.config.ts
```

## 开发

```sh
bun install
bun run build        # tsdown：lib/index.js（Host）+ lib/client.js（浏览器）
bun run typecheck    # tsc --noEmit
bun run test         # vitest（固定 --pool=threads）
```

- **提交前必须重建 `lib/`**：git 安装直接用仓库里的 `lib/`，忘了提交就装到旧产物
- 改动作后跑 `bun scripts/gen-jian-motions.mjs`，会重建 `assets/models/jian/motions/` 并校验 Meta / 参数 / 引用
- 本机没有全局 node/bun 时，可以用 DSH Desktop 自带的运行时跑构建 / 检查 / 测试，见 [AGENTS.md](AGENTS.md)
- 需求先行：改用户可感知的行为 → 同步 `docs/spec/`；架构取舍 → 新增 ADR

## 文档

| 需求 | 文档 |
|---|---|
| 产品意图 | [`docs/intent/dsh-waifu.md`](docs/intent/dsh-waifu.md) |
| 行为规格 | [`docs/spec/dsh-waifu-v01.md`](docs/spec/dsh-waifu-v01.md) |
| 架构决策 | [`docs/adr/`](docs/adr/)（全文索引见 [`docs/adr/index.md`](docs/adr/index.md)） |
| 开发约定 | [AGENTS.md](AGENTS.md) |

## 许可

- **插件代码**：MIT，见 [LICENSE](LICENSE)；基于 [cyanfish-x/dsh-live2d-pets](https://github.com/cyanfish-x/dsh-live2d-pets) 分叉改造
- **内置模型「简」**：用户自备（VTube Studio 导出）随包内置；**公开分发 / 再发布前请确认模型作者授权**（许可标注见 [`src/presets/presets.jsonc`](src/presets/presets.jsonc)）
- **Live2D SDK / Cubism Core**：按 [Live2D 官方条款](https://www.live2d.com/eula/) 使用

## 常见问题

- **装完没看到宠物**：确认 `dsh plugin --profile <profile> list` 里有 `dsh-waifu`；刷新页面；看 `$DSH_HOME/waifu/client.log` 有无加载错误（模型加载失败会降级为静态头像）
- **点了没反应**：确认该部位定义了**交互**且 box 覆盖点击位置——没配交互的部位点了不会触发任何东西；开「预览 box」可以直接试
- **不出台词**：AI 驱动关着、或 DSH 没配 provider / Key；模型失败时角色故意保持静默（不会编固定台词）。用「AI 驱动 → 测试」自检
- **没有声音**：语音总开关、模型 / 音色是否匹配（音色跨模型会被拒），以及先点一下页面解锁音频
- **更新后行为没变**：客户端刷新即生效，Host 半区需要重启 DSH 进程
- **想换模型 / 导入自己的模型**：本版不支持（专注内置「简」）
