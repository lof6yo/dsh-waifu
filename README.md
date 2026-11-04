# dsh-live2d-pets 🐾

[English](README.en.md) | 简体中文

[![npm](https://img.shields.io/npm/v/dsh-live2d-pets.svg)](https://www.npmjs.com/package/dsh-live2d-pets)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/dsh-live2d-pets.svg)](https://nodejs.org/)
[![GitHub release](https://img.shields.io/github/v/release/cyanfish-x/dsh-live2d-pets)](https://github.com/cyanfish-x/dsh-live2d-pets/releases)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-1f6feb)](https://github.com/topics/dsh-plugin)

给 DeepSeek Harness 请了个看板娘：你思考它歪头，你完成它撒花，还能摸头！

<p align="center">
  <img src="docs/media/hero.jpg" alt="dsh-live2d-pets 主视觉" width="920" />
</p>

## 特性

- **内置模型「简」**：随插件包分发（Cubism 4 半身像：moc3 / 纹理 / 物理 / cdi3），开箱即用；自带插件创建的 5 个状态动作（Idle / Thinking / Error / Done / Waiting）+ 3 个触摸动作（TapHead / TapFace / TapBody），并启用眨眼与口型参数组
- **自定义模型**：仍可用任意 `.model3.json` 的 **https / http URL**，或填写**本机绝对路径**（如 `/Users/me/models/foo/foo.model3.json`，由插件 Host 转成同源 HTTP 加载）；可配置**状态动画映射**，把模型原生动作组挂到 6 个状态
- **用户自定义触摸部位（touchbox）**：部位不再固定「头/手/腿/身体」——在设置 →「桌宠配置」→「触摸部位」点「编辑触摸部位」，宠物进入编辑态并实时显示 box；新建部位、输入名称、添加 box、输入左上/右下百分比（0–100），一个部位可对应多个 box；每个部位可多选触摸时播放的动作组。命中判定按 box（重叠时最小 box 优先），不依赖模型 HitArea
- **状态镜像**：宠物实时反映 agent 思考 / 空闲 / 出错 / 完成 / 交付 / 等审批（动画 + 气泡，SSE 推送）
- **事件绑定（动画 + 台词）**：空闲 / 思考中 / 出错 / 完成 / 交付 / 等审批各配动作组与台词池（长状态三阶段），设置页直接编辑、可恢复默认；不再有固定人设（后续规划 LLM 人设提示词说话）
- **互动陪伴**：分部位触摸反应 / 鼠标跟随（头、眼、身体看向鼠标）/ 拖动停靠，任务完成庆祝
- **桌宠配置设置面板**：DSH 设置 →「桌宠配置」，单页流程：显示 → 模型 → 事件绑定 → 触摸部位 → 开发者选项；设置写入插件私有 `$DSH_HOME/live2d-pet/settings.jsonc`（DSH 0.2.x 适配，见 ADR-013），事件绑定与触摸部位存 `~/.dsh/live2d-pet/touch-parts.jsonc`，自定义模型存 `custom-models.jsonc`，即时生效
- **不打扰**：默认右下角、小尺寸、可拖动、可隐藏、标签页隐藏暂停渲染、限帧渲染、低配降级静态头像
- **清晰不拖慢**：内置贴图 4096²（4.9MB），渲染按设备像素比 2x 缓冲 + antialias，Retina 上边缘清晰



## 快速开始



### 方式一：复制提示词让 agent 安装（推荐）

把下面这段提示词复制给你的 DSH agent（在 Web GUI 对话中直接粘贴即可），它会自己安装并验证：

```text
请帮我安装 dsh-live2d-pets 插件（DSH 的 Live2D 桌宠插件）：
1. 执行 dsh plugin --profile web add dsh-live2d-pets 安装
2. 执行 dsh plugin --profile web list，确认 dsh-live2d-pets 出现在已安装列表中
3. 告诉我安装结果；如果失败，请附上错误信息
```



### 方式二：手动安装

在终端执行（`web` profile 首次使用时自动初始化）：

```sh
dsh plugin --profile web add dsh-live2d-pets
```

安装后插件默认启用。启动 DSH：

```sh
dsh web
```

浏览器打开后，右下角会出现默认宠物（尺寸 160px）。默认模型为内置「简」（随包分发，无需联网加载模型）。

### 互动

- **鼠标跟随**：默认开启。鼠标在页面任意位置移动时，宠物的头、眼睛、身体会平滑看向鼠标；鼠标移出页面后复位正视前方。拖拽中不跟随，隐藏或页面失焦时自动暂停。
- **触摸互动**：按你在设置里定义的触摸部位触发台词与动作；未命中部位不响应。
- **拖动**：按住宠物拖动到任意位置，松手后停靠并持久化。

自定义模型：打开设置 →「桌宠配置」→「我的模型」，填写名称与 `.model3.json` 地址（外网 CDN、自建静态站、本机 HTTP 服务，或**本机绝对路径**如 `/Users/me/models/foo/foo.model3.json` 均可；本地路径由插件 Host 通过 `/pet-local-models/...` 同源路由加载）。可展开 **「动画映射」** 实时解析模型动作组，为 6 个状态选择动作组。

### 触摸部位（touchbox）

打开设置 →「桌宠配置」→「触摸部位」：

1. 点「编辑触摸部位」——宠物进入编辑态，当前部位 box 实时显示在角色上；
2. 点「新建部位」输入名称（如「头」「手」「尾巴」）；
3. 点「添加 box」，输入左上 / 上 / 右 / 下四个值（相对模型包围盒的百分比 0–100），box 随输入实时显示；
4. 一个部位可加多个 box 拼出不规则区域；每个部位可写自己的**台词**（一行一条，留空则只播动作不出气泡）并勾选触摸时随机播放的动作组；
5. 部位有**图层**：列表从上到下 = 从顶层到底层，box 重叠时上层部位生效，可用「↑ 上移 / ↓ 下移」排序（新建部位默认在最上层）；
6. 「触摸部位」分组内还有「状态动画映射（当前模型）」：6 个状态各可多选动作组，可覆盖内置「简」的默认映射；
7. 改动自动保存到 `$DSH_HOME/live2d-pet/touch-parts.jsonc`，退出编辑即生效。

<p align="center">
  <img src="docs/media/settings-pet-config.png" alt="DSH 设置中的「桌宠配置」入口与面板" width="920" />
</p>

### 配置设置

打开 **DSH 设置 →「桌宠配置」**，改完立刻生效，无需重启。

- **显示**：开关宠物
- **尺寸**：40–400px（默认 160）
- **画布留白**：水平/垂直（每侧 %，默认 130/70）——防止动作甩尾被裁切
- **默认停靠 / 归位**：配置距右/距下位置，一键归位
- **渲染帧率**：30 / 60 / 不限制（默认 30）
- **模型**：内置「简」（只读，含许可信息）；「我的模型」可添加名称 + `.model3.json` URL（可选状态动画映射）；自定义模型存于 `$DSH_HOME/live2d-pet/custom-models.jsonc`
- **事件绑定**：6 个事件的动作组 + 台词池（思考/等审批为三阶段），可恢复默认
- **触摸部位**：编辑部位 / box / 台词 / 触摸动作映射（见上）
- **开发者选项**：总开关（默认关）；开启后可显示调试面板（含模型原生动画列表预览）、显示触摸部位色块

### 卸载

```sh
dsh plugin --profile web remove dsh-live2d-pets
```



## 文档


| 需求        | 文档                                                                     |
| --------- | ---------------------------------------------------------------------- |
| 英文 README | `[README.en.md](README.en.md)`                                         |
| 产品意图      | `[docs/intent/live2d-pet-plugin.md](docs/intent/live2d-pet-plugin.md)` |
| 行为规格      | `[docs/spec/live2d-pet-v01.md](docs/spec/live2d-pet-v01.md)`           |
| 架构决策      | `[docs/adr/](docs/adr/)`（渲染栈见 ADR-003，内置模型与 touchbox 见 ADR-014）       |
| 调研记录      | `[docs/research/](docs/research/)`（设置面板接入机制见 settings-tab.md）          |




## 技术栈

- pixi-live2d-display 0.4.0 + PixiJS 6.5.10 + Cubism Core 4（[ADR-003](docs/adr/003-spike-results-and-rendering-stack.md)）
- 客户端渲染于 DSH Web GUI 的 `shell.overlay` 悬浮层（视觉层 Popover 顶层，[ADR-005](docs/adr/005-pet-visual-top-layer-popover.md)），设置页注册于 `settings.section`（[ADR-002](docs/adr/002-pet-mount-and-state-source.md)）
- 状态推送：Host 订阅 `agent/*` 事件 → 同源 SSE `/api/live2d-pet/events`（[ADR-006](docs/adr/006-push-state-sse.md)）；标签页隐藏 / 失焦暂停渲染
- 内置模型与自建动作：`assets/models/jian/` + `scripts/gen-jian-motions.mjs`（幂等生成 motion3.json，[ADR-014](docs/adr/014-bundled-jian-model-and-touchbox-parts.md)）；事件绑定与触摸部位存 `~/.dsh/live2d-pet/touch-parts.jsonc`，设置/自定义模型同为插件私有 JSONC
- 设置持久化：插件私有 `$DSH_HOME/live2d-pet/settings.jsonc`（DSH 0.2.x settings 服务适配，[ADR-013](docs/adr/013-dsh-0.2.x-settings-plugin-private-file.md)）；传输走插件自身 API `/api/live2d-pet/settings`



## 许可

- **插件代码**：MIT
- **内置模型「简」**：用户自备模型（VTube Studio 导出），随插件包内置；**公开分发前请确认模型作者授权**（清单见 `[src/presets/presets.jsonc](src/presets/presets.jsonc)`）
- **模型清单**：清单门槛为「许可可标注」——每条记录许可类型与链接，NC（禁止商用）模型标注"仅限非商用"
- **Live2D SDK**：按 [Live2D 官方条款](https://help.live2d.com/zh-CHS/sdk/)（免费商用，需遵守版权声明等）
