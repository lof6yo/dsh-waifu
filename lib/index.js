import { dirname, join, sep } from "node:path";
import Schema from "@deepseek-ai/schemastery";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// src/models.ts
/** 全部状态槽位（设置页「可触发场景」的状态组；`idle` 是静息态，不作为触发键）。 */
const ANIMATION_SLOTS = [
	"idle",
	"thinking",
	"error",
	"done",
	"waiting",
	"delivered"
];
/** 全部活动事件（设置页「可触发场景」的活动组顺序）。 */
const ACTIVITY_EVENTS = [
	"tool-read",
	"tool-write",
	"tool-run",
	"tool-agent",
	"tool-other",
	"approval-granted",
	"approval-denied",
	"session-open",
	"session-close",
	"subagent-start",
	"subagent-end"
];
[...ANIMATION_SLOTS, ...ACTIVITY_EVENTS];
/** 全部内置表情（`none` 表示恢复无表情；目录同时是 AI 可选表情与设置页勾选清单）。 */
const EXPRESSIONS = [
	{
		id: "none",
		name: "无",
		params: {},
		meaning: ""
	},
	{
		id: "blush",
		name: "脸红",
		params: { ParamSwitch2: 1 },
		exclusive: "skin",
		meaning: "娇羞、害羞、被戳中软处、舒服"
	},
	{
		id: "angry",
		name: "生气",
		params: { ParamSwitch4: 1 },
		meaning: "生气、发脾气、炸毛"
	},
	{
		id: "star",
		name: "星星眼",
		params: { ParamSwitch5: 1 },
		exclusive: "eye",
		meaning: "开心、崇拜、两眼放光"
	},
	{
		id: "whites",
		name: "白眼",
		params: { ParamSwitch6: 1 },
		exclusive: "eye",
		meaning: "无语、嫌弃、不屑"
	},
	{
		id: "tear",
		name: "泪花",
		params: { ParamSwitch7: 1 },
		exclusive: "eye",
		meaning: "委屈、含着泪"
	},
	{
		id: "heart",
		name: "爱心眼",
		params: { ParamSwitch8: 1 },
		exclusive: "eye",
		meaning: "喜欢、心里小鹿乱撞、性奋"
	},
	{
		id: "cry",
		name: "眼泪",
		params: { ParamSwitch9: 1 },
		exclusive: "eye",
		meaning: "哭出来、伤心"
	},
	{
		id: "dark",
		name: "脸黑",
		params: { ParamSwitch1: 1 },
		exclusive: "skin",
		meaning: "不爽、阴沉下来"
	},
	{
		id: "blood",
		name: "羞愤",
		params: { ParamSwitch3: 1 },
		exclusive: "skin",
		meaning: "又羞又气、脸上挂不住"
	},
	{
		id: "dim",
		name: "高光消失",
		params: { ParamSwitch21: 1 },
		meaning: "失落、没精神、蔫了"
	}
];
const AI_MOTIONS = [
	{
		id: "Nod",
		name: "点头",
		meaning: "同意、得意、敷衍地应一声"
	},
	{
		id: "ShakeHead",
		name: "摇头",
		meaning: "无语、不敢相信、傲娇、拒绝、欲拒还迎"
	},
	{
		id: "Tilt",
		name: "歪头",
		meaning: "好奇、疑惑、没听懂、质疑"
	},
	{
		id: "Sway",
		name: "左右晃",
		meaning: "撒娇、放松、妩媚、吸引"
	},
	{
		id: "Glance",
		name: "瞥一眼",
		meaning: "偷瞄、关注"
	},
	{
		id: "Perk",
		name: "竖起耳朵",
		meaning: "警觉"
	},
	{
		id: "Shift",
		name: "换重心",
		meaning: "活动身体、调皮"
	},
	{
		id: "Sigh",
		name: "叹气",
		meaning: "叹气"
	}
];
/** AI 可选动作组 id 列表。 */
const AI_MOTION_IDS = AI_MOTIONS.map((motion) => motion.id);
/** 可选表情 id（不含 `none`）。 */
const EXPRESSION_IDS = EXPRESSIONS.filter((expression) => expression.id !== "none").map((expression) => expression.id);
/** 该名字是否是表情 id。 */
function isExpressionId(value) {
	return EXPRESSION_IDS.includes(value.trim());
}
/** 该名字是否是 AI 动作组 id。 */
function isMotionId(value) {
	return AI_MOTION_IDS.includes(value.trim());
}
/** 全部触发条件（设置页下拉顺序）。 */
const INTERACTION_TRIGGERS = [
	"tap",
	"double",
	"hold"
];
/** 「悬停停留」默认时长与允许范围（ms）：鼠标停在部位 box 内多久触发。 */
const TOUCH_HOLD_DEFAULT_MS = 3e3;
const TOUCH_HOLD_LIMITS = {
	min: 300,
	max: 1e4
};
/** 无默认触摸部位时的空表（用户未创建部位 → 点击不触发互动）。 */
const DEFAULT_TOUCH_PARTS = [];
/** 单个部位最多 box 数（防止配置失控；设置页同步限制）。 */
const MAX_BOXES_PER_PART = 12;
/** 部位 id 合法形式（保存时生成，仅用于持久化与排序）。 */
function isValidPartId(value) {
	return /^[a-z][a-z0-9_-]*$/i.test(value);
}
/** 把数值夹到 [0,1]；非有限数按 0 处理。 */
function clamp01(value) {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.min(1, Math.max(0, n));
}
/** 归一化单个 box：夹到 0–1，并保证 left<right / top<bottom（必要时交换）。 */
function normalizeTouchBox(raw) {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw;
	const left = clamp01(record.left);
	const top = clamp01(record.top);
	const right = clamp01(record.right);
	const bottom = clamp01(record.bottom);
	const box = {
		left: Math.min(left, right),
		top: Math.min(top, bottom),
		right: Math.max(left, right),
		bottom: Math.max(top, bottom)
	};
	if (box.right - box.left <= .001 || box.bottom - box.top <= .001) return null;
	return box;
}
/**
* 归一化部位列表：丢弃非法条目、限制 box 数量、去重 id。
* 旧文件里的 `motions` / `lines` 字段（ADR-037 前的部位绑定）直接忽略。
*/
/** 归一化一个部位的交互列表：丢空名、去重（同名同触发条件）、夹时长、限量。 */
function normalizeInteractions(raw) {
	if (!Array.isArray(raw)) return [];
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		const name = typeof record.name === "string" ? record.name.trim().slice(0, 20) : "";
		if (!name) continue;
		const trigger = INTERACTION_TRIGGERS.includes(record.trigger) ? record.trigger : "tap";
		const key = `${trigger}:${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const rawHold = Number(record.holdMs);
		const holdMs = Number.isFinite(rawHold) ? Math.round(Math.min(TOUCH_HOLD_LIMITS.max, Math.max(TOUCH_HOLD_LIMITS.min, rawHold))) : TOUCH_HOLD_DEFAULT_MS;
		out.push({
			id: `i${out.length + 1}`,
			name,
			trigger,
			holdMs
		});
		if (out.length >= 8) break;
	}
	return out;
}
/**
* 按按压时长与连击数挑一个交互（ADR-038）：
* 1. 停留类优先（时长 ≥ 该交互的 holdMs，取最长的那个）；
* 2. 连击 ≥ 2 且定义了双击 → 双击；
* 3. 否则单击交互；
* 4. 都没有返回 undefined（调用方回落内建轻碰/戳戳/抚摸）。
*/
function normalizeTouchParts(raw) {
	if (!Array.isArray(raw)) return [];
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		const name = typeof record.name === "string" ? record.name.trim().slice(0, 24) : "";
		if (!name) continue;
		let id = typeof record.id === "string" ? record.id.trim() : "";
		if (!isValidPartId(id)) id = `part-${out.length + 1}`;
		const base = id;
		let suffix = 2;
		while (seen.has(id)) id = `${base}-${suffix++}`;
		const rawBoxes = Array.isArray(record.boxes) ? record.boxes : [];
		const boxes = [];
		for (const rawBox of rawBoxes) {
			const box = normalizeTouchBox(rawBox);
			if (box) boxes.push(box);
			if (boxes.length >= 12) break;
		}
		seen.add(id);
		const interactions = normalizeInteractions(record.interactions);
		out.push(interactions.length > 0 ? {
			id,
			name,
			boxes,
			interactions
		} : {
			id,
			name,
			boxes
		});
	}
	return out;
}
/** 归一化点击点相对于包围盒的比例坐标（越界返回 null）。 */
function pointToBoundsRatio(localX, localY, bounds) {
	if (!(bounds.width > 0 && bounds.height > 0)) return null;
	const nx = (localX - bounds.x) / bounds.width;
	const ny = (localY - bounds.y) / bounds.height;
	if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
	return {
		nx,
		ny
	};
}
/**
* 触摸命中判定：按**图层顺序**（parts 数组顺序，第 0 项最上层）遍历，
* 返回第一个命中任意 box 的部位；未命中返回 null。
*/
function hitTestTouchParts(parts, nx, ny) {
	for (const part of parts) for (const box of part.boxes) {
		if (nx < box.left || nx > box.right || ny < box.top || ny > box.bottom) continue;
		return part;
	}
	return null;
}
/** 时间戳样式：`[2026-11-05 14:57:16]`、`【14:57】`、`(22:04)`、`[2026-11-05]` 这类整块方括号时间。 */
const BRACKETED_TIMESTAMP = /[[【(（]\s*(?:\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)\s*[\]】)）]/g;
/** 裸 ISO 时间戳：`2026-11-05T14:57:16Z`、`2026-11-05 14:57:16`。 */
const ISO_TIMESTAMP = /\b\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g;
/** 行首的裸时间戳（`14:57:16 哼…`）与行尾孤零零的时间戳。 */
const LEADING_TIMESTAMP = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[,，:：、.·-]?\s*/;
const TRAILING_TIMESTAMP = /\s*[,，:：、.·-]?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/;
/**
* 过滤台词里混进来的时间戳（模型偶尔会像聊天记录那样给回复加时间）。
* 只处理「整块时间」与行首/行尾孤立的 `HH:MM(:SS)`，句子中间的时间（「已经 3:00 了」）不动；
* 全部删空时回退原文，避免气泡变成空白。
*/
function stripTimestamps(input) {
	if (!input) return input;
	const stripped = input.replace(BRACKETED_TIMESTAMP, "").replace(ISO_TIMESTAMP, "").replace(LEADING_TIMESTAMP, "").replace(TRAILING_TIMESTAMP, "").replace(/[ \t]{2,}/g, " ").trim();
	return stripped.length > 0 ? stripped : input;
}
// src/jsonc.ts
/**
* 插件私有 JSONC 文件解析工具：去注释后交给 JSON.parse。
* 供 settings-store / touch-parts 等插件私有配置文件共用。
* @module dsh-waifu/jsonc
*/
function stripJsonComments(text) {
	let out = "";
	let i = 0;
	let inString = false;
	while (i < text.length) {
		const ch = text[i];
		const next = text[i + 1];
		if (inString) {
			out += ch;
			if (ch === "\\") {
				if (i + 1 < text.length) out += next;
				i += 2;
				continue;
			}
			if (ch === "\"") inString = false;
			i += 1;
			continue;
		}
		if (ch === "\"") {
			inString = true;
			out += ch;
			i += 1;
			continue;
		}
		if (ch === "/" && next === "/") {
			i += 2;
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
			i = Math.min(i + 2, text.length);
			out += " ";
			continue;
		}
		out += ch;
		i += 1;
	}
	return out;
}
// src/models-host.ts
/**
* Host 侧模型清单读取与解析：内置 presets.jsonc（JSONC 支持注释）由 Node 读取。
* 本模块不可被 client 打包引入（依赖 node:fs / node:path / node:url）。
* 共享类型与默认值见 `models.ts`。
* ADR-037：animationMap/DEFAULT_MOTION_MAP 已删——状态动画槽位只由 AI 选目录动作驱动；
* 这里只保留 preset id → modelUrl / 默认触摸部位两组解析。
* @module dsh-waifu/models-host
*/
/** 包根目录（从本模块位置解析：源码测试时指向仓库根，构建后 lib/ 的上一级即包根）。 */
function packageRoot() {
	return fileURLToPath(new URL("../", import.meta.url));
}
const presetsData = JSON.parse(stripJsonComments(readFileSync(join(packageRoot(), "src/presets/presets.jsonc"), "utf8")));
/** 内置策展清单（只读，来自 presets.jsonc）。 */
function listBuiltinPresets() {
	return presetsData.presets;
}
/** 默认内置模型 id（presets.jsonc 第一条；配置里的旧模型 id 失配时也回退到它）。 */
function defaultModelId() {
	return presetsData.presets[0]?.id ?? "jian";
}
/**
* 按当前选中模型解析「默认触摸部位」（内置 preset 随包提供的默认值）：
* 用户保存过自定义部位时由 TouchPartsStore 覆盖，这里只给回退值。
* 部位只含 id/name/boxes（ADR-037）。
*/
function resolveDefaultTouchParts(model) {
	const preset = presetsData.presets.find((p) => p.id === model);
	return preset?.touchParts ? preset.touchParts.map((part) => ({ ...part })) : [];
}
/**
* 把 `config.model` 解析为可加载的 `.model3.json` URL：
* - preset id → presets.jsonc 匹配
* - 旧配置里的失效模型 id → 回退默认内置模型（避免升级后宠物空白）
*/
function resolveModelUrl(model) {
	const preset = presetsData.presets.find((p) => p.id === model);
	if (preset) return preset.modelUrl;
	const fallback = presetsData.presets[0];
	return fallback ? fallback.modelUrl : null;
}
// src/clamp.ts
/**
* 数值收敛工具：插件内所有「用户可写数值」统一走这里，避免 6 种手写 clamp 各自为政。
* @module dsh-waifu/clamp
*/
/** 把任意值收敛到 [min, max] 的整数；非有限数回退 fallback。 */
function clampInt(value, fallback, min, max) {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.round(Math.min(max, Math.max(min, n)));
}
/** 把任意值收敛到 [min, max] 的小数（不取整）；非有限数回退 fallback。 */
function clampNumber(value, fallback, min, max) {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
// src/defaults.ts
/**
* 插件默认值的**唯一来源**（ADR-013：Config schema 只作为 base 层，用户改动落插件私有设置文件）。
*
* 之前默认值散在 5 处（Config schema、设置页 DEFAULT_VALUE、客户端兜底常量、
* persist.DEFAULT_DISPLAY、内置 preset），改一个忘一个就会出现「设置页显示 240、实际渲染 160」。
* 现在统一在这里定义，其余地方只引用；`defaults.test.ts` 校验 schema 与常量的取值一致。
*
* 全 AI 驱动（ADR-037）的新设置也在这里：触发频率策略 / 最小间隔 / 静默超时 /
* 场景触发开关 / 同类事件窗口 / 记忆注入条数。
* @module dsh-waifu/defaults
*/
/** 显示/位置持久化默认值（`$DSH_HOME/waifu.json`，px 相对视口右下角）。 */
const DEFAULT_DISPLAY = {
	right: 10,
	bottom: 0,
	size: 280
};
const DEFAULT_BUBBLE_BG_COLOR = "#ffffff";
const DEFAULT_BUBBLE_TEXT_COLOR = "#222222";
/** AI 回复默认路由（DSH 已配置的 provider / 模型，ADR-025）。 */
const DEFAULT_AI_PROVIDER = "openrouter";
const DEFAULT_AI_MODEL = "google/gemma-4-31b-it";
/**
* 触发频率策略（ADR-037 / ADR-047）：
* - `interrupt`：截断抢占——新触发直接掐掉上一轮（说话/语音立刻断，动作表情立刻换）；
* - `queue`：排队等完成——上一轮「气泡出完 + 语音念完」后才处理下一条；等待期间到达的
*   事件不丢，攒进合并队列后并进下一轮场景句（上限见 `mergeMax`）。
*/
const TRIGGER_MODES = ["interrupt", "queue"];
const DEFAULT_TRIGGER_MODE = "queue";
/** 归一化触发频率策略：未知值回退默认。 */
function normalizeTriggerMode(value, fallback) {
	return TRIGGER_MODES.includes(value) ? value : fallback;
}
const AI_MIN_INTERVAL_LIMITS = {
	min: 0,
	max: 600
};
const IDLE_TIMEOUT_LIMITS = {
	min: 0,
	max: 3600
};
const ACTIVITY_WINDOW_LIMITS = {
	min: 0,
	max: 300
};
/** 触摸连点窗口（毫秒）：窗口内的连续触摸只保留最后一次，到点补发（ADR-047）。 */
const DEFAULT_TAP_GAP_MS = 1200;
const TAP_GAP_LIMITS = {
	min: 0,
	max: 5e3
};
const MERGE_MAX_LIMITS = {
	min: 1,
	max: 20
};
/** 可触发场景目录（设置页勾选；`idle` 是静息态不算触发键）。 */
const TRIGGER_EVENTS = [...ANIMATION_SLOTS.slice(1), ...ACTIVITY_EVENTS];
/** 默认关闭的场景（工具调用类噪音大、会话结束/子代理与桌面宠物关系远；可在设置页打开）。 */
const TRIGGER_EVENTS_OFF = [
	"tool-read",
	"tool-write",
	"tool-run",
	"tool-agent",
	"tool-other",
	"session-close",
	"subagent-start",
	"subagent-end"
];
/** 默认场景开关（Record 形式持久化在 settings.jsonc）：除 TRIGGER_EVENTS_OFF 外全开。 */
function defaultEventTriggers() {
	const out = {};
	for (const key of TRIGGER_EVENTS) out[key] = !TRIGGER_EVENTS_OFF.includes(key);
	return out;
}
/** 事件键 → 内置场景文案（ADR-039：用户可在设置页覆写，空 = 用这里的）。 */
const DEFAULT_EVENT_TEXTS = {
	thinking: "你正在思考",
	error: "运行出错了",
	done: "你完成了任务",
	waiting: "你要等主人确认",
	delivered: "你交付了成果",
	"tool-read": "主人让你看东西，你正翻着资料",
	"tool-write": "主人让你写/改东西，你刚动完笔",
	"tool-run": "主人让你跑命令，你刚按下回车",
	"tool-agent": "主人派你去办事，你正准备出发",
	"tool-other": "主人让你用了件别的工具，你顺手做了",
	"approval-granted": "主人刚刚批准了你的请求",
	"approval-denied": "主人刚刚拒绝了你的请求",
	"session-open": "主人刚开了一个新会话，才见到你",
	"session-close": "这轮会话结束了，主人要走了",
	"subagent-start": "你的分身刚被派出去干活",
	"subagent-end": "你的分身干完活回来了"
};
/** 归一化事件文案：只留已知事件键、压空白、截断；空串 = 用内置文案。 */
function normalizeEventTexts(raw) {
	const out = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	const record = raw;
	for (const key of TRIGGER_EVENTS) {
		const value = record[key];
		if (typeof value !== "string") continue;
		const text = value.replace(/\s+/g, " ").trim().slice(0, 60);
		if (text.length > 0) out[key] = text;
	}
	return out;
}
/** 归一化「动作是否发给模型」：只留目录内 id，缺省为 true（默认全部可选）。 */
function normalizeMotionEnabled(raw) {
	return normalizeCatalogEnabled(raw, AI_MOTION_IDS);
}
/** 归一化「表情是否发给模型」：只留目录内 id（不含 none），缺省为 true。 */
function normalizeExpressionEnabled(raw) {
	return normalizeCatalogEnabled(raw, EXPRESSION_IDS.filter((id) => id !== "none"));
}
function normalizeCatalogEnabled(raw, ids) {
	const out = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	const record = raw;
	for (const id of ids) if (typeof record[id] === "boolean") out[id] = record[id];
	return out;
}
/** 归一化「动作释义覆写」：只留目录内 id、压空白、截断；空串 = 用内置释义。 */
function normalizeMotionTexts(raw) {
	return normalizeCatalogTexts(raw, AI_MOTION_IDS);
}
/** 归一化「表情释义覆写」：只留目录内 id（不含 none）、压空白、截断；空串 = 用内置释义。 */
function normalizeExpressionTexts(raw) {
	return normalizeCatalogTexts(raw, EXPRESSION_IDS);
}
function normalizeCatalogTexts(raw, ids) {
	const out = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	const record = raw;
	for (const id of ids) {
		const value = record[id];
		if (typeof value !== "string") continue;
		const text = value.replace(/\s+/g, " ").trim().slice(0, 80);
		if (text.length > 0) out[id] = text;
	}
	return out;
}
/** 归一化场景开关：未知键忽略；缺失的键补 true（新场景默认开）。 */
function normalizeEventTriggers(raw) {
	const out = defaultEventTriggers();
	if (typeof raw !== "object" || raw === null) return out;
	for (const [key, value] of Object.entries(raw)) if (typeof value === "boolean" && key in out) out[key] = value;
	return out;
}
/**
* 语音模型目录：Host 校验与设置页下拉共用同一份。
* 只列 OpenRouter 上「音色固定、且是女声」的两个通义千问 TTS 模型（2026-11 实测）：
* `voice` 直接透传音色参数（如 `longanlingxin`），按模型区分，跨模型使用会被供应商拒 400。
* 音色来源：https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts
* （只取「性别：女」的条目；龙泡泡是 5 岁儿童音、loongmary/loongeva 是英文音，排在最后）。
*/
const TTS_MODELS = [{
	id: "qwen/qwen-audio-3.0-tts-plus",
	label: "通义千问 TTS Plus（旗舰音色，支持指令控制）",
	voices: [{
		id: "longanlingxin",
		label: "龙安灵心（25 岁·知心温暖）"
	}]
}, {
	id: "qwen/qwen-audio-3.0-tts-flash",
	label: "通义千问 TTS Flash（女声最多，便宜）",
	voices: [
		{
			id: "longanyuanfei",
			label: "龙安元妃（30 岁·高傲妃子）"
		},
		{
			id: "longanfengyue",
			label: "龙安风悦（30 岁·自然亲切）"
		},
		{
			id: "longanlingxi",
			label: "龙安灵希（25 岁·可爱甜美）"
		},
		{
			id: "longanxiaoxin",
			label: "龙安小昕（22 岁·亲切活泼）"
		},
		{
			id: "longanhuan_v3.6",
			label: "龙安欢（25 岁·活泼）"
		},
		{
			id: "longpaopao_v3.6",
			label: "龙泡泡（儿童·软糯可爱）"
		},
		{
			id: "loongmary",
			label: "loongmary（20 岁·英式英语）"
		},
		{
			id: "loongeva_v3.6",
			label: "loongeva（28 岁·美式英语）"
		}
	]
}];
/** 默认 TTS 模型：通义千问 TTS Flash（女声最多、便宜）。 */
const DEFAULT_TTS_MODEL = "qwen/qwen-audio-3.0-tts-flash";
/** 默认音色：Flash 的「龙安灵希」（25 岁·可爱甜美）。 */
const DEFAULT_TTS_VOICE = "longanlingxi";
/** 按 id 查模型选项。 */
function ttsModelOption(id) {
	return TTS_MODELS.find((item) => item.id === id);
}
/** 该模型是否每次随机音色。 */
function ttsModelRandomVoice(id) {
	return ttsModelOption(id)?.randomVoice === true;
}
const FOCUS_RANGE_LIMITS = {
	min: 0,
	max: 300
};
/** 跟随范围归一化：整数百分比，越界夹取，非法回落。 */
function normalizeFocusRange(value, fallback) {
	return clampInt(value, fallback, FOCUS_RANGE_LIMITS.min, FOCUS_RANGE_LIMITS.max);
}
/** 口型强度边界。 */
const LIPSYNC_GAIN_LIMITS = {
	min: 0,
	max: 300
};
/** 归一化口型强度：0–300 的整数，非法值回退默认。 */
function normalizeLipsyncGain(value, fallback) {
	return clampInt(value, fallback, LIPSYNC_GAIN_LIMITS.min, LIPSYNC_GAIN_LIMITS.max);
}
/** 注入历史条数的边界（条 = 一条消息；0 = 不注入）。 */
const AI_HISTORY_LIMITS = {
	min: 0,
	max: 50
};
/** 归一化注入条数：0–50 的整数，非法值回退默认（Host 归一化与设置页输入共用）。 */
function normalizeHistoryCount(value, fallback) {
	return clampInt(value, fallback, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max);
}
/** 注入记忆条数的边界（0 = 不注入）。 */
const AI_MEMORY_LIMITS = {
	min: 0,
	max: 100
};
/** 交互条（模型上方/下方的静音按钮 + 对话输入框）的位置：上方 `top` / 下方 `bottom`。 */
const BAR_POSITIONS = [
	"top",
	"bottom",
	"hidden"
];
const BAR_OFFSET_LIMITS = {
	min: -200,
	max: 200
};
/** 归一化交互条位置：未知值回退默认。 */
function normalizeBarPosition(value, fallback) {
	return BAR_POSITIONS.includes(value) ? value : fallback;
}
/**
* 标量设置默认值（除 `model`：模型 id 由内置 preset 目录动态决定）。
* 与 `Config` schema 的 `.default()`、设置页 `DEFAULT_VALUE` 保持逐项一致。
*/
const DEFAULT_SETTINGS = {
	enabled: true,
	size: DEFAULT_DISPLAY.size,
	maxFps: 30,
	developerMode: true,
	debug: true,
	showTapZones: false,
	canvasPadX: 125,
	canvasPadY: 50,
	homeRight: 10,
	homeBottom: 0,
	bubbleOffsetX: 0,
	bubbleOffsetY: 24,
	bubbleBgColor: DEFAULT_BUBBLE_BG_COLOR,
	bubbleBgOpacity: 92,
	bubbleMaxSeconds: 10,
	bubbleTextColor: DEFAULT_BUBBLE_TEXT_COLOR,
	/** AI 总开关（ADR-037：关掉 = 角色完全静默，只剩物理反应）。 */
	aiEnabled: true,
	aiProvider: DEFAULT_AI_PROVIDER,
	aiModel: DEFAULT_AI_MODEL,
	aiHistoryCount: 20,
	aiMemoryCount: 20,
	/** 触发频率策略（截断抢占 / 排队等完成）。 */
	triggerMode: DEFAULT_TRIGGER_MODE,
	/** 事件类触发的最小间隔（秒；触摸/对话不受限）。 */
	aiMinIntervalSec: 1,
	/** 静默超时（秒；0 = 关闭）。 */
	idleTimeoutSec: 600,
	/** 同类事件触发窗口（秒）。 */
	activityWindowSec: 10,
	/** 触摸连点窗口（毫秒；0 = 不合并）。 */
	tapGapMs: DEFAULT_TAP_GAP_MS,
	/** 一轮场景句里最多拼进多少条被压下的触发。 */
	mergeMax: 6,
	/** 按事件类型的触发开关（v8 起持久化；normalizeSettings 会补全键）。 */
	eventTriggers: defaultEventTriggers(),
	/** 事件文案覆写（空 = 用内置文案；键为事件键）。 */
	eventTexts: {},
	/** 动作释义覆写（空 = 用内置释义；键为动作 id）。 */
	motionTexts: {},
	/** 表情释义覆写（空 = 用内置释义；键为表情 id）。 */
	expressionTexts: {},
	/** 动作是否发给模型供选择（缺省 = 全开；false = 不列进提示词、也不接受该标签）。 */
	motionEnabled: {},
	/** 表情是否发给模型供选择（缺省 = 全开；`blood` 羞愤默认不给）。 */
	expressionEnabled: { blood: false },
	/** 待机小动作（偶尔偏头/抬眉/换重心/叹气），关掉后只有 Idle 循环。 */
	idleMotionEnabled: true,
	/** 交互条：模型上下的静音按钮 + 对话输入框。 */
	barPosition: "top",
	barOffset: -30,
	ttsEnabled: true,
	ttsModel: DEFAULT_TTS_MODEL,
	ttsVoice: DEFAULT_TTS_VOICE,
	lipsyncEnabled: true,
	lipsyncGain: 130,
	focusRange: 100
};
// src/home.ts
/**
* 插件私有数据目录与文件时间戳（settings / touch-parts / persist / client-log 共用）。
* 路径规则：`$DSH_HOME/waifu/*`（DSH_HOME 缺失时回退 `~/.dsh`），见 spec §2。
* @module dsh-waifu/home
*/
/** DSH home 目录（与 DSH 自身解析规则一致：优先环境变量）。 */
function petHomeDir() {
	return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
/** 插件私有 waifu 目录下的文件路径。 */
function petWaifuPath(...segments) {
	return join(petHomeDir(), "waifu", ...segments);
}
/**
* 文件时间戳签名（`mtimeMs:size`）：内容没变时调用方可以复用上次解析结果，
* 避免每次读取都 readFileSync + JSONC 解析（snapshot 每次推送都要读两份配置）。
* 读不到（不存在/无权限）返回 null，表示「不要用缓存」。
*/
function fileStamp(path) {
	try {
		const stat = statSync(path);
		return `${stat.mtimeMs}:${stat.size}`;
	} catch {
		return null;
	}
}
// src/persist.ts
/**
* 宠物显示偏好持久化：$DSH_HOME/waifu.json（拖动位置/尺寸）。
* v0.1 采用简单同步读写；原子写入（dsh-atomic-write）留待后续。
* @module dsh-waifu/persist
*/
const DISPLAY_MIN = 40;
const DISPLAY_MAX = 400;
/**
* 位置偏移边界：允许负值（right/bottom 为相对视口右下角的距离），
* 这样角色可以拖到窗口边缘外一半（spec §4 自由拖动）。
*/
const INSET_MIN = -4e3;
const INSET_MAX = 8e3;
/** 尺寸归一化：非法值回退最小尺寸（与 clamp.ts 统一规则）。 */
function clampSize$1(value) {
	return clampNumber(value, DISPLAY_MIN, DISPLAY_MIN, DISPLAY_MAX);
}
/** 位置偏移归一化：非法值回 0（而不是最小负边界）。 */
function clampInset(value) {
	return clampNumber(value, 0, INSET_MIN, INSET_MAX);
}
/** 归一化显示配置到合法边界（持久化读取与 API 写入共用同一权威规则）。 */
function normalizeDisplay(display) {
	return {
		right: clampInset(display.right),
		bottom: clampInset(display.bottom),
		size: clampSize$1(display.size)
	};
}
function petFile() {
	return join(petHomeDir(), "waifu.json");
}
/** 读取显示配置并返回「是否已有持久化文件」（客户端首次启动据此套用「默认位置」）。 */
function loadPetPersistDetailed(defaults = DEFAULT_DISPLAY) {
	try {
		const raw = JSON.parse(readFileSync(petFile(), "utf8"));
		return {
			display: normalizeDisplay({
				right: raw.right ?? defaults.right,
				bottom: raw.bottom ?? defaults.bottom,
				size: raw.size ?? defaults.size
			}),
			saved: true
		};
	} catch {
		return {
			display: { ...normalizeDisplay(defaults) },
			saved: false
		};
	}
}
/** 保存显示配置（尽力而为，失败不阻断交互）。 */
function savePetPersist(display) {
	try {
		writeFileSync(petFile(), JSON.stringify(display, null, 2), "utf8");
	} catch {}
}
/** 文件头注释：每次写回时保留，提示用户这是插件私有配置。 */
const TOUCH_PARTS_HEADER = `// 触摸部位配置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/touch-parts.jsonc
// 建议通过设置页「触摸部位」编辑；直接编辑后刷新页面即可生效。
// 结构：models[<模型 id>].parts[] = { id, name, boxes[{left,top,right,bottom}],
//        interactions?: [{ name, trigger: tap|double|hold, holdMs }] }
// interactions 的名字由你自己起（ADR-038），会原样告诉模型；留空则用内置轻碰/戳戳/抚摸三档。
// left/top/right/bottom 为相对模型包围盒的 0–1 归一化坐标（左上右下）。
// 部位不再携带台词/动作（ADR-037）：角色反应全部由 AI 驱动，这里只管命中判定。`;
function serializeTouchParts(models) {
	return `${TOUCH_PARTS_HEADER}\n${JSON.stringify({
		version: 2,
		models
	}, null, 2)}\n`;
}
const TOUCH_PARTS_TEMPLATE = serializeTouchParts({});
/** 归一化「模型 id → 部位列表」映射（丢弃空值/非法结构；旧 events/animationMap 字段忽略）。 */
function normalizeModelMap(raw) {
	const out = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [modelId, value] of Object.entries(raw)) {
		if (!modelId.trim() || typeof value !== "object" || value === null) continue;
		out[modelId] = { parts: normalizeTouchParts(value.parts) };
	}
	return out;
}
/**
* 触摸部位文件存取器：构造时确保目录存在并落地模板（不存在才写），
* 之后 load() 每次现读；write() 由设置页保存时调用。
*/
var TouchPartsStore = class {
	path;
	lastGood = {};
	lastError = null;
	/** 上次解析对应的文件时间戳（`mtimeMs:size`）：文件没变就复用，snapshot 每次推送都要读它。 */
	lastStamp = null;
	constructor(path) {
		this.path = path ?? join(petHomeDir(), "waifu", "touch-parts.jsonc");
		try {
			mkdirSync(dirname(this.path), { recursive: true });
		} catch {}
		try {
			if (!existsSync(this.path)) writeFileSync(this.path, TOUCH_PARTS_TEMPLATE, "utf8");
		} catch {}
	}
	/** 现读并解析；失败时沿用上一份好结果并给出错误消息（文件没变则复用上次结果）。 */
	load() {
		const stamp = fileStamp(this.path);
		if (stamp !== null && stamp === this.lastStamp) return {
			models: this.lastGood,
			error: this.lastError,
			path: this.path
		};
		let text;
		try {
			text = readFileSync(this.path, "utf8");
		} catch (error) {
			this.lastError = `无法读取 ${this.path}：${error instanceof Error ? error.message : String(error)}`;
			return {
				models: this.lastGood,
				error: this.lastError,
				path: this.path
			};
		}
		let parsed;
		try {
			parsed = JSON.parse(stripJsonComments(text));
		} catch (error) {
			this.lastError = `JSONC 解析失败（沿用上次结果）：${error instanceof Error ? error.message : String(error)}`;
			return {
				models: this.lastGood,
				error: this.lastError,
				path: this.path
			};
		}
		const rawModels = parsed?.models;
		if (rawModels !== void 0 && typeof rawModels !== "object") {
			this.lastError = "JSONC 结构错误：\"models\" 必须是对象（沿用上次结果）";
			return {
				models: this.lastGood,
				error: this.lastError,
				path: this.path
			};
		}
		this.lastGood = normalizeModelMap(rawModels);
		this.lastError = null;
		this.lastStamp = stamp;
		return {
			models: this.lastGood,
			error: this.lastError,
			path: this.path
		};
	}
	/** 按模型 id 取用户保存的部位列表（没有保存过返回 null，由调用方回退默认）。 */
	partsFor(modelId) {
		const entry = this.load().models[modelId];
		return entry ? entry.parts : null;
	}
	/** 写回某个模型的部位列表（设置页保存用；保留文件头注释）。 */
	save(modelId, parts) {
		const id = modelId.trim();
		if (!id) throw new Error("model id 不能为空");
		const view = this.load();
		const entry = { parts: normalizeTouchParts(parts) };
		const next = {
			...view.models,
			[id]: entry
		};
		try {
			writeFileSync(this.path, serializeTouchParts(next), "utf8");
			this.lastGood = next;
			this.lastError = null;
			this.lastStamp = null;
		} catch (error) {
			this.lastError = `写入失败 ${this.path}：${error instanceof Error ? error.message : String(error)}`;
		}
		return this.load();
	}
};
// src/service.ts
/** "完成/交付"庆祝状态在回到空闲前的保持时长（ms）。 */
const DONE_HOLD_MS = 3500;
var PetService = class {
	getSettings;
	touchPartsStore;
	state = "idle";
	agent = "idle";
	version = 0;
	display;
	displaySaved = false;
	holdTimerId;
	activity = null;
	activitySeq = 0;
	/** 子代理的会话 id：它们的 status/turn-stopping 不该驱动宠物状态（ADR-036 修订）。 */
	subagentIds = /* @__PURE__ */ new Set();
	listeners = /* @__PURE__ */ new Set();
	constructor(ctx, getSettings, touchPartsStore) {
		this.getSettings = getSettings;
		this.touchPartsStore = touchPartsStore;
		const loaded = loadPetPersistDetailed(DEFAULT_DISPLAY);
		this.display = loaded.display;
		this.displaySaved = loaded.saved;
		ctx.effect(() => () => {
			if (this.holdTimerId) clearTimeout(this.holdTimerId);
		});
		ctx.on("agent/status", (payload) => {
			if (this.isSubagent(payload?.agent)) return;
			const status = payload?.status;
			if (!status) return;
			this.agent = String(status);
			if (status === "running") this.set("thinking");
			else if (status === "idle" && this.state !== "done" && this.state !== "delivered") this.set("idle");
		});
		ctx.on("agent/error", (payload) => {
			if (this.isSubagent(payload?.agent)) return;
			this.set("error");
		});
		ctx.on("agent/turn-stopping", (payload) => {
			if (this.isSubagent(payload?.agent)) return;
			if (this.state !== "delivered") this.setDone();
		});
		ctx.on("approval/request", async (_req, next) => {
			this.set("waiting");
			const outcome = await next();
			this.noteApproval(String(outcome));
			return outcome;
		});
		ctx.on("user-questions/request", (_request, next) => {
			this.set("waiting");
			return next?.();
		});
		ctx.on("session/event", (_session, event) => {
			if (event?.type === "deliverables/presented") this.setDelivered();
		});
		const onLoose = ctx.on;
		onLoose("tools/pre-execute", (exec, next) => {
			this.noteTool(exec?.name);
			return next();
		});
		onLoose("subagent/start", (info) => {
			const id = info?.id;
			if (typeof id === "string") this.subagentIds.add(id);
			this.noteActivity("subagent-start");
		});
		onLoose("subagent/end", (info) => {
			const id = info?.id;
			if (typeof id === "string") this.subagentIds.delete(id);
			this.noteActivity("subagent-end");
		});
		const onLooseSession = ctx;
		onLooseSession.on("session/created", (session) => {
			if (!session?.header?.parentSession) this.noteActivity("session-open");
		});
		onLooseSession.on("session/disposed", (session) => {
			if (!session?.header?.parentSession) this.noteActivity("session-close");
		});
	}
	/**
	* 该 agent 是否是子代理。子代理的 turn 结束不该让宠物庆祝「完成」，
	* 否则我每派一个分身它就欢呼一次（ADR-036 修订）。
	*/
	isSubagent(agent) {
		const id = agent?.id;
		return typeof id === "string" && this.subagentIds.has(id);
	}
	/** 审批结果（approval/request 的返回值）：批准点头、被拒摇头（ADR-036）。 */
	noteApproval(outcome) {
		if (outcome === "allowed-once") this.noteActivity("approval-granted");
		else if (outcome === "rejected") this.noteActivity("approval-denied");
	}
	/** 工具名 → 活动种类（读 / 写 / 跑命令 / 派代理 / 其它）。 */
	noteTool(name) {
		if (!name) return;
		const tool = name.toLowerCase();
		if (/^(bash|terminal|kill|job)/.test(tool)) this.noteActivity("tool-run");
		else if (/^(write|edit|multi_edit|apply_patch|notebook_edit)/.test(tool)) this.noteActivity("tool-write");
		else if (/^(read|glob|grep|ls|list|search|web)/.test(tool)) this.noteActivity("tool-read");
		else if (/^(subagent|agent|workflow|task|team)/.test(tool)) this.noteActivity("tool-agent");
		else this.noteActivity("tool-other");
	}
	/**
	* 记录一次性活动（ADR-047）：Host 只当传感器，不按类型节流、不按工具名过滤——
	* 每一次活动都带序号推给客户端，由那边的调度器按 `activityWindowSec` 合并。
	*/
	noteActivity(kind) {
		this.activitySeq += 1;
		this.activity = {
			seq: this.activitySeq,
			kind
		};
		this.version += 1;
		this.emitChange();
	}
	/** 立即切换状态；取消未完成的"完成/交付"保持计时。 */
	set(next) {
		if (this.holdTimerId) {
			clearTimeout(this.holdTimerId);
			this.holdTimerId = void 0;
		}
		if (this.state === next) return;
		this.state = next;
		this.version += 1;
		this.emitChange();
	}
	/** 进入庆祝态（done/delivered）并保持 DONE_HOLD_MS 后回空闲（客户端据此播庆祝动画）。 */
	setHeld(state) {
		this.set(state);
		this.holdTimerId = setTimeout(() => {
			this.holdTimerId = void 0;
			this.set("idle");
		}, DONE_HOLD_MS);
	}
	setDone() {
		this.setHeld("done");
	}
	setDelivered() {
		this.setHeld("delivered");
	}
	/**
	* 当前模型生效的触摸部位：用户保存过 → 用户文件；否则内置 preset 默认；
	* 再否则空表（点击不触发互动，spec §4）。
	*/
	touchPartsFor(model) {
		const saved = this.touchPartsStore?.partsFor(model);
		if (saved) return saved;
		return resolveDefaultTouchParts(model);
	}
	/** 浏览器轮询用的状态快照（配置实时读取设置文件快照，spec §2）。 */
	snapshot() {
		const settings = this.getSettings();
		return {
			state: this.state,
			agent: this.agent,
			activity: this.activity,
			config: {
				enabled: settings.enabled,
				size: settings.size,
				maxFps: settings.maxFps,
				model: settings.model,
				modelUrl: resolveModelUrl(settings.model),
				debug: settings.debug,
				showTapZones: !!settings.showTapZones,
				homeRight: settings.homeRight,
				homeBottom: settings.homeBottom,
				canvasPadX: settings.canvasPadX,
				canvasPadY: settings.canvasPadY,
				bubbleOffsetX: settings.bubbleOffsetX,
				bubbleOffsetY: settings.bubbleOffsetY,
				bubbleBgColor: settings.bubbleBgColor,
				bubbleBgOpacity: settings.bubbleBgOpacity,
				bubbleMaxSeconds: settings.bubbleMaxSeconds,
				bubbleTextColor: settings.bubbleTextColor,
				aiEnabled: settings.aiEnabled,
				idleMotionEnabled: settings.idleMotionEnabled,
				barPosition: settings.barPosition,
				barOffset: settings.barOffset,
				aiProvider: settings.aiProvider,
				aiModel: settings.aiModel,
				aiHistoryCount: settings.aiHistoryCount,
				aiMemoryCount: settings.aiMemoryCount,
				triggerMode: settings.triggerMode,
				aiMinIntervalSec: settings.aiMinIntervalSec,
				idleTimeoutSec: settings.idleTimeoutSec,
				activityWindowSec: settings.activityWindowSec,
				tapGapMs: settings.tapGapMs,
				mergeMax: settings.mergeMax,
				eventTriggers: settings.eventTriggers,
				ttsEnabled: settings.ttsEnabled,
				ttsModel: settings.ttsModel,
				ttsVoice: settings.ttsVoice,
				lipsyncEnabled: settings.lipsyncEnabled,
				lipsyncGain: settings.lipsyncGain,
				focusRange: settings.focusRange,
				touchParts: this.touchPartsFor(settings.model)
			},
			display: { ...this.display },
			displaySaved: this.displaySaved,
			version: this.version
		};
	}
	/** 触摸部位文件视图（设置页读取用）。 */
	touchPartsFile() {
		return this.touchPartsStore?.load() ?? {
			models: {},
			error: null,
			path: ""
		};
	}
	/** 写回某个模型的触摸部位并推送（设置页保存后调用；spec §4）。 */
	saveTouchParts(model, parts) {
		const view = this.touchPartsStore?.save(model, parts) ?? {
			models: {},
			error: null,
			path: ""
		};
		this.version += 1;
		this.emitChange();
		return view;
	}
	/** 更新显示配置（拖动/尺寸）并持久化；数值在服务端按权威边界 clamp。 */
	setDisplay(patch) {
		this.display = normalizeDisplay({
			right: patch.right ?? this.display.right,
			bottom: patch.bottom ?? this.display.bottom,
			size: patch.size ?? this.display.size
		});
		savePetPersist(this.display);
		this.version += 1;
		this.emitChange();
		return { ...this.display };
	}
	/**
	* 重置为内置默认显示配置（调试/API 用）。
	* 注意：设置页「归位」由 Client 按「显示区中心距右/距下」计算后再 setDisplay（需要视口与画布尺寸），
	* 不走本方法（spec §2）。
	*/
	resetDisplay() {
		this.display = { ...DEFAULT_DISPLAY };
		this.displaySaved = true;
		savePetPersist(this.display);
		this.version += 1;
		this.emitChange();
		return { ...this.display };
	}
	/** 订阅变化推送（状态/显示变化自动触发）；返回退订函数。 */
	onChange(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** 设置/配置变化后由外部调用，触发一次推送（ADR-006）。 */
	notifyConfigChanged() {
		this.emitChange();
	}
	emitChange() {
		for (const listener of this.listeners) listener();
	}
};
// src/client-log.ts
/**
* 浏览器侧诊断日志：Client 半区经 POST /api/dsh-waifu/client-log 上报，
* Host 追加到 `$DSH_HOME/waifu/client.log`（超过上限自动截断）。
*
* 用途：桌宠渲染在浏览器里失败时（WebGL / 模型加载 / 脚本注入），
* 没有浏览器控制台也能在 Host 侧看到启动里程碑与错误栈（spec §9）。
* @module dsh-waifu/client-log
*/
/** 日志文件上限（字节）；超过后清空重写，避免无限增长。 */
const MAX_LOG_BYTES = 262144;
/** 日志文件绝对路径。 */
function clientLogPath() {
	return petWaifuPath("client.log");
}
/** 追加一行浏览器侧诊断日志（失败静默，不影响主流程）。 */
function appendClientLog(level, message, detail) {
	try {
		const file = clientLogPath();
		mkdirSync(dirname(file), { recursive: true });
		try {
			if (statSync(file).size > MAX_LOG_BYTES) writeFileSync(file, "", "utf8");
		} catch {}
		const safeLevel = String(level || "info").slice(0, 16);
		const safeMessage = String(message ?? "").slice(0, 2e3);
		const safeDetail = detail === void 0 ? "" : ` | ${String(detail).slice(0, 4e3)}`;
		appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} [${safeLevel}] ${safeMessage}${safeDetail}\n`, "utf8");
	} catch {}
}
// src/routes.ts
/** 浏览器侧宠物 API 基路径。 */
const PET_API_PREFIX = "/api/dsh-waifu";
/** 浏览器侧素材静态路由基路径（vendor 运行时脚本 + 内置模型 assets）。 */
const PET_ASSET_PREFIX = "/waifu-assets";
/** 包根目录（从本模块自身位置解析）。 */
function petPackageRoot(importMetaUrl) {
	return fileURLToPath(new URL("../", importMetaUrl));
}
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 65536) {
				reject(/* @__PURE__ */ new Error("body-too-large"));
				queueMicrotask(() => req.destroy());
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", reject);
	});
}
/** 统一响应：成功 200，GET 失败 500，POST 失败（含 body 解析失败）400。 */
function fail(res, status, error) {
	json(res, status, {
		ok: false,
		error: error instanceof Error ? error.message : String(error)
	});
}
/**
* 统一的 JSON 路由包装：GET / POST 共用「解析 body、区分 400/405/500」这一套，
* 三种入口只是它的薄包装，新增路由不必再各写一遍错误格式。
*/
function jsonRoute(path, handlers) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (req.method === "GET" && handlers.get !== void 0) {
				const run = handlers.get;
				return Promise.resolve().then(run).then((value) => json(res, 200, value), (error) => fail(res, 500, error));
			}
			if (req.method === "POST" && handlers.post !== void 0) {
				const run = handlers.post;
				return readJsonBody(req).then((body) => {
					const record = typeof body === "object" && body !== null ? body : {};
					return Promise.resolve().then(() => run(record)).then((value) => json(res, 200, value), (error) => fail(res, 400, error));
				}, (error) => fail(res, 400, error));
			}
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
			return Promise.resolve();
		}
	};
}
function getRoute(path, run) {
	return jsonRoute(path, { get: run });
}
function postRoute(path, run) {
	return jsonRoute(path, { post: run });
}
/** 同一 path 上挂 GET + POST（webServer 按 path 唯一注册，不按 method 分表）。 */
function getPostRoute(path, get, post) {
	return jsonRoute(path, {
		get,
		post
	});
}
/** SSE 心跳间隔（ms）：保持空闲连接活性，防止被中间层/浏览器回收。 */
const SSE_HEARTBEAT_MS = 3e4;
/**
* SSE 状态推送端点（ADR-006）：连接即回发当前快照，之后每次服务变化
* （状态/显示/配置）推送新快照。EventSource 断线自动重连（retry 3s），
* 重连后服务端立即回发快照，客户端无需补偿拉取。
* @param onStream - 路由生命周期钩子：插件卸载时由调用方关闭全部活跃流。
*/
function sseStateRoute(path, service, onStream) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (req.method !== "GET") {
				json(res, 405, {
					ok: false,
					error: "method-not-allowed"
				});
				return;
			}
			res.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-store",
				connection: "keep-alive",
				"x-accel-buffering": "no"
			});
			res.on("error", () => {});
			res.write("retry: 3000\n\n");
			const send = () => {
				res.write(`data: ${JSON.stringify(service.snapshot())}\n\n`);
			};
			send();
			const unsubscribe = service.onChange(send);
			const heartbeat = setInterval(() => {
				res.write(": ping\n\n");
			}, SSE_HEARTBEAT_MS);
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				unsubscribe();
				clearInterval(heartbeat);
				try {
					res.end();
				} catch {}
			};
			req.on("close", close);
			res.on("close", close);
			const release = onStream?.(close);
			if (release !== void 0) {
				req.on("close", release);
				res.on("close", release);
			}
		}
	};
}
/** 简单 MIME 推断（素材/本地模型路由用）。 */
function mimeForFile(file) {
	const lower = file.toLowerCase();
	if (lower.endsWith(".json")) return "application/json";
	if (lower.endsWith(".moc3") || lower.endsWith(".bin")) return "application/octet-stream";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".js")) return "text/javascript";
	if (lower.endsWith(".css")) return "text/css";
	if (lower.endsWith(".map")) return "application/json";
	return "application/octet-stream";
}
/**
* 通用静态文件响应（含 HEAD；文件不存在 404）。
* 素材包十几 MB：带 ETag/Last-Modified 并处理条件请求，浏览器第二次加载直接 304，
* 不再每次整包重传（行为不变，只是不再白跑流量）。
*/
function serveFile(req, res, file) {
	return stat(file).then((info) => {
		const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
		const mtimeMs = Math.floor(info.mtimeMs / 1e3) * 1e3;
		const headers = {
			"content-type": mimeForFile(file),
			"cache-control": "no-cache",
			etag,
			"last-modified": new Date(mtimeMs).toUTCString()
		};
		const inm = req.headers["if-none-match"];
		const ims = req.headers["if-modified-since"];
		if (typeof inm === "string" ? inm.split(",").some((value) => value.trim() === etag) : typeof ims === "string" && Date.parse(ims) >= mtimeMs) {
			res.writeHead(304, headers);
			res.end();
			return;
		}
		return readFile(file).then((body) => {
			res.writeHead(200, {
				...headers,
				"content-length": String(body.byteLength)
			});
			if (req.method === "HEAD") {
				res.end();
				return;
			}
			res.end(body);
		}, () => {
			res.writeHead(404);
			res.end();
		});
	}, () => {
		res.writeHead(404);
		res.end();
	});
}
/** 解析 `/interact` 与 `/speak` 的请求体为 TriggerInput（长度限制与旧版一致）。 */
function parseTriggerInput(record) {
	const kind = record.kind === "event" ? "event" : record.kind === "chat" ? "chat" : record.kind === "idle" ? "idle" : "tap";
	const merged = Array.isArray(record.merged) ? record.merged.filter((item) => typeof item === "string").slice(0, 20) : void 0;
	return {
		kind,
		part: typeof record.part === "string" ? record.part.slice(0, 40) : void 0,
		interaction: typeof record.interaction === "string" ? record.interaction.slice(0, 20) : void 0,
		event: typeof record.event === "string" ? record.event.slice(0, 20) : void 0,
		text: typeof record.text === "string" ? record.text.slice(0, 200) : void 0,
		tz: typeof record.tz === "string" ? record.tz.slice(0, 64) : void 0,
		merged
	};
}
/** 构建完整路由族（API + SSE + 素材 + 本地模型）供 ctx.webServer.register。 */
function makePetRoutes(deps) {
	const { service, packageRoot, settings, ai, aiSettings, memory, speak, onStream } = deps;
	const apiRoutes = [
		sseStateRoute(`${PET_API_PREFIX}/events`, service, onStream),
		getRoute(`${PET_API_PREFIX}/state`, async () => service.snapshot()),
		getPostRoute(`${PET_API_PREFIX}/touch-parts`, () => {
			const view = service.touchPartsFile();
			const model = service.snapshot().config.model;
			return {
				model,
				parts: service.touchPartsFor(model),
				saved: view.models[model] !== void 0,
				error: view.error,
				path: view.path
			};
		}, (body) => {
			const model = typeof body.model === "string" ? body.model.trim() : "";
			if (!model) throw new Error("model 不能为空");
			const parts = Array.isArray(body.parts) ? body.parts : [];
			const view = service.saveTouchParts(model, parts);
			return {
				ok: true,
				model,
				touchParts: service.touchPartsFor(model),
				error: view.error,
				path: view.path
			};
		}),
		getPostRoute(`${PET_API_PREFIX}/settings`, () => settings.view(), (body) => {
			const ops = Array.isArray(body.ops) ? body.ops : [];
			return Promise.resolve(settings.write(ops)).then(() => settings.view());
		}),
		...memory ? [getPostRoute(`${PET_API_PREFIX}/memory`, () => memory.read(), (body) => memory.write(typeof body.text === "string" ? body.text : ""))] : [],
		postRoute(`${PET_API_PREFIX}/set-display`, (body) => {
			const patch = {};
			if (typeof body.right === "number") patch.right = body.right;
			if (typeof body.bottom === "number") patch.bottom = body.bottom;
			if (typeof body.size === "number") patch.size = body.size;
			return Promise.resolve({
				ok: true,
				display: service.setDisplay(patch)
			});
		}),
		postRoute(`${PET_API_PREFIX}/reset-display`, () => Promise.resolve({
			ok: true,
			display: service.resetDisplay()
		})),
		...aiSettings ? [
			getRoute(`${PET_API_PREFIX}/ai-options`, () => aiSettings.options()),
			getPostRoute(`${PET_API_PREFIX}/persona`, () => aiSettings.readPersona(), (body) => aiSettings.writePersona(typeof body.text === "string" ? body.text : "")),
			...aiSettings.debug ? [getRoute(`${PET_API_PREFIX}/ai-debug`, () => Promise.resolve(aiSettings.debug()))] : [],
			...aiSettings.check ? [postRoute(`${PET_API_PREFIX}/ai-check`, (body) => aiSettings.check({
				provider: typeof body.provider === "string" && body.provider.length > 0 ? body.provider : void 0,
				model: typeof body.model === "string" && body.model.length > 0 ? body.model : void 0
			}))] : []
		] : [],
		...ai ? [postRoute(`${PET_API_PREFIX}/interact`, (body) => {
			return ai.reply(parseTriggerInput(body));
		})] : [],
		...speak ? [{
			kind: "exact",
			path: `${PET_API_PREFIX}/speak`,
			handler: (req, res) => {
				if (req.method !== "POST") {
					json(res, 405, {
						ok: false,
						error: "method-not-allowed"
					});
					return;
				}
				readJsonBody(req).then((body) => {
					const input = parseTriggerInput(typeof body === "object" && body !== null ? body : {});
					res.writeHead(200, {
						"content-type": "text/event-stream; charset=utf-8",
						"cache-control": "no-cache, no-store",
						connection: "keep-alive",
						"x-accel-buffering": "no"
					});
					res.on("error", () => {});
					const controller = new AbortController();
					const watchdog = setTimeout(() => {
						emit("error", { error: "speak-timeout" });
						close();
					}, 9e4);
					function close() {
						clearTimeout(watchdog);
						controller.abort();
						try {
							res.end();
						} catch {}
					}
					req.on("close", close);
					res.on("close", close);
					const release = onStream?.(close);
					if (release !== void 0) {
						req.on("close", release);
						res.on("close", release);
					}
					const emit = (event, data) => {
						if (controller.signal.aborted) return;
						try {
							res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
						} catch {}
					};
					speak.stream(input, emit, controller.signal).catch((error) => {
						emit("error", { error: error instanceof Error ? error.message : String(error) });
					}).finally(() => {
						try {
							res.end();
						} catch {}
					});
				}, (error) => {
					json(res, 400, {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					});
				});
			}
		}] : [],
		...speak?.synthesize ? [postRoute(`${PET_API_PREFIX}/tts`, async (body) => {
			const text = typeof body.text === "string" ? body.text.slice(0, 400) : "";
			const audio = await speak.synthesize(text);
			return {
				ok: true,
				mime: audio.mime,
				data: audio.audio.toString("base64")
			};
		})] : [],
		getPostRoute(`${PET_API_PREFIX}/client-log`, () => ({
			ok: true,
			path: clientLogPath()
		}), (body) => {
			appendClientLog(typeof body.level === "string" ? body.level : "info", typeof body.message === "string" ? body.message : "", typeof body.detail === "string" ? body.detail : void 0);
			return { ok: true };
		})
	];
	const assetsRoot = join(packageRoot, "assets");
	const assetRoute = {
		kind: "prefix",
		path: PET_ASSET_PREFIX,
		handler: (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405);
				res.end();
				return Promise.resolve();
			}
			const relativePath = new URL(req.url ?? "/", "http://localhost").pathname.slice(13).split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)).join("/");
			if (!relativePath || relativePath.includes("\0")) {
				res.writeHead(404);
				res.end();
				return Promise.resolve();
			}
			const file = join(assetsRoot, relativePath);
			if (!file.startsWith(`${assetsRoot}${sep}`)) {
				res.writeHead(404);
				res.end();
				return Promise.resolve();
			}
			return serveFile(req, res, file);
		}
	};
	return [...apiRoutes, assetRoute];
}
// src/time.ts
/**
* 时间与时区：把「现在几点」「多久以前」换算到请求方（浏览器）所在的时区。
* 纯函数、不读全局状态——宿主跑在 UTC，靠这里把时间翻译成用户的时间感。
* @module dsh-waifu/time
*/
const pad2 = (value) => String(value).padStart(2, "0");
const WEEKDAYS = [
	"周日",
	"周一",
	"周二",
	"周三",
	"周四",
	"周五",
	"周六"
];
const WEEKDAY_INDEX = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};
/**
* 校验 IANA 时区名（浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 送来的）。
* 只放行字母数字与 `_ + - /`，并真正让 Intl 解析一次——非法名字会让 `DateTimeFormat` 直接抛。
*/
function normalizeTimeZone(tz) {
	if (typeof tz !== "string") return void 0;
	const value = tz.trim();
	if (value.length === 0 || value.length > 64) return void 0;
	if (!/^[A-Za-z0-9_+/-]+$/.test(value)) return void 0;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
		return value;
	} catch {
		return;
	}
}
/** 某一时刻在指定时区里的年月日时分与星期（时区缺失/非法时回落宿主本地时区）。 */
function zoneParts(at, timeZone) {
	const date = new Date(at);
	if (!timeZone) return {
		year: date.getFullYear(),
		month: date.getMonth() + 1,
		day: date.getDate(),
		hour: date.getHours(),
		minute: date.getMinutes(),
		weekday: date.getDay()
	};
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour12: false,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			weekday: "short"
		}).formatToParts(at);
		const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
		const weekday = WEEKDAY_INDEX[pick("weekday")];
		return {
			year: Number(pick("year")),
			month: Number(pick("month")),
			day: Number(pick("day")),
			hour: Number(pick("hour")),
			minute: Number(pick("minute")),
			weekday: Number.isFinite(weekday) ? weekday : new Date(at).getDay()
		};
	} catch {
		return {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			day: date.getDate(),
			hour: date.getHours(),
			minute: date.getMinutes(),
			weekday: date.getDay()
		};
	}
}
/**
* 历史条目的时间戳前缀：同一天只给 `[21:03]`，跨天补上 `[11/04 21:03]`。
* 只用于提示模型时间感，不进台词、不显示在气泡里。
* `timeZone` 传浏览器时区——宿主机跑在 UTC，不传就会把「深夜」当「早上」。
*/
function formatStamp(at, now = Date.now(), timeZone) {
	const then = zoneParts(at, timeZone);
	const today = zoneParts(now, timeZone);
	const clock = `${pad2(then.hour)}:${pad2(then.minute)}`;
	return then.year === today.year && then.month === today.month && then.day === today.day ? clock : `${then.month}/${then.day} ${clock}`;
}
/** 当前时间的口语描述（「11月5日 周四 21:10」），每次请求都重新取值。 */
function formatNow(now = Date.now(), timeZone) {
	const parts = zoneParts(now, timeZone);
	return `${parts.month}月${parts.day}日 ${WEEKDAYS[parts.weekday]} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}
/**
* 把历史切成 `messages` 段：取最近 `count` 条，并丢掉开头没有配对提问的 assistant 条目
* （模型不喜欢以 assistant 开头的上下文）。
*/
function historyMessages(history, rounds, fallback, timeZone) {
	const limit = normalizeHistoryCount(rounds, 0) * 2;
	if (limit <= 0 || history.length === 0) return [];
	const tail = history.slice(-limit);
	while (tail.length > 0 && tail[0].role === "assistant") tail.shift();
	return tail.filter((entry) => entry.text.trim().length > 0).map((entry, index) => ({
		id: `history-${index}`,
		role: entry.role,
		content: [{
			type: "text",
			text: entry.at > 0 ? `[${formatStamp(entry.at, Date.now(), timeZone)}] ${entry.text}` : entry.text
		}],
		source: entry.role === "assistant" ? {
			kind: "model",
			provider: entry.provider || fallback.provider,
			model: entry.model || fallback.model
		} : { kind: "user" }
	}));
}
/** 事件键 → 场景描述：用户覆写优先，其次内置，最后兜底成「发生了「<键>」这件事」。 */
function eventSceneText(event, texts) {
	const custom = texts?.[event]?.trim();
	if (custom) return custom;
	return DEFAULT_EVENT_TEXTS[event] ?? `发生了「${event}」这件事`;
}
/**
* 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。
* `merged` 是触发频率窗口内被合并进来的事件描述（ADR-037）。
* 句式统一为「<场景>。按你的人设回应。」，触发方式不进场景句。
*/
function buildSceneMessage(context, eventTexts) {
	const now = formatNow(Date.now(), context.tz);
	let body;
	if (context.kind === "chat") body = `主人对你说「${(context.text ?? "").replace(/\s+/g, " ").trim() || "（没说话）"}」`;
	else if (context.kind === "tap") {
		const custom = (context.interaction ?? "").trim().slice(0, 20);
		const part = context.part || "身体";
		body = custom !== "" ? `主人「${custom}」了你的「${part}」` : `主人碰了你的「${part}」`;
	} else if (context.kind === "idle") body = "有一阵子没人理你，也没发生什么事";
	else body = `眼下${eventSceneText(context.event ?? "idle", eventTexts)}`;
	const merged = (context.merged ?? []).filter((line) => line.trim().length > 0);
	const mergedText = merged.length > 0 ? `这期间还发生了：${merged.join("；")}。` : "";
	return `现在是 ${now}。${body}。${mergedText}按你的人设回应。`;
}
/**
* 历史里那句「当时发生了什么」（ADR-039）：只留最短的事实，
* 换成 `[HH:MM] 主人轻碰「脸」` 这种一行式，避免把整段场景句重复注入 N 次。
*/
function historySceneText(context, eventTexts) {
	if (context.kind === "chat") return `主人说「${(context.text ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "（没说话）"}」`;
	if (context.kind === "tap") {
		const custom = (context.interaction ?? "").trim().slice(0, 20);
		const part = context.part || "身体";
		return custom !== "" ? `主人「${custom}」了「${part}」` : `主人碰了「${part}」`;
	}
	if (context.kind === "idle") return "一阵子没动静";
	const merged = (context.merged ?? []).filter((line) => line.trim().length > 0);
	const main = eventSceneText(context.event ?? "idle", eventTexts);
	return merged.length > 0 ? `${main}（另有 ${merged.length} 件事）` : main;
}
/** 该 id 是否对模型开放（缺省开放）。 */
function catalogAllowed(flags, id) {
	return flags?.[id] !== false;
}
function systemPrompt(persona, memory = "", catalog = {}) {
	const motionLines = AI_MOTIONS.filter((motion) => catalogAllowed(catalog.motionEnabled, motion.id)).map((motion) => `- ${motion.id}：${catalog.motionTexts?.[motion.id] ?? motion.meaning}`).join("\n");
	const expressionLines = EXPRESSIONS.filter((expression) => expression.id !== "none" && catalogAllowed(catalog.expressionEnabled, expression.id)).map((expression) => `- ${expression.id}：${catalog.expressionTexts?.[expression.id] ?? expression.meaning}`).join("\n");
	return `${persona}${memory ? `\n## 你记得的事\n${memory}\n` : ""}
## 可选动作（一次最多选一个，写在台词开头的标签里）
${motionLines || "（这次没有可用动作，不要写动作标签）"}

## 可选表情（可以选一到两个，写在动作标签后面）
${expressionLines || "（这次没有可用表情，不要写表情标签）"}

输出要求（严格遵守）：
1. 先写方括号标签再写台词，格式：[表情][动作] 台词。例如「[shy][ShakeHead] 别、别戳了啦」。
   不想动就不写动作标签；不想做表情就不写表情标签。标签必须用上面的英文 id。
2. 台词不超过 60 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
3. 如果这轮有值得长期记住的事（主人的习惯、约定、你的小心愿），在台词后面另起一行写「[记] 内容」，
   十几个字以内，用第三人称记录（例如「[记] 主人半夜还在赶工」）。没有就别写。
4. 每次换个角度反应，不要重复上一次的说法。
5. 场景里写「主人<某个动作>了你的「<部位>」」时，那个动作是主人**自己给这个部位起的交互名**（比如「抚摸」「捏脸」「弹一下」），
   按字面理解它的意思和亲密程度来演，不要把它当成动作 id，也不要复述这个词。`;
}
/** 一次请求的「人设 + 历史 + 记忆 + 当前场景」组装。 */
function assembleRequest(options) {
	const system = systemPrompt(options.persona, options.memory, options.catalog);
	const messages = [...historyMessages(options.history ?? [], options.historyCount ?? 0, {
		provider: options.provider,
		model: options.model
	}, options.context.tz), {
		role: "user",
		content: [{
			type: "text",
			text: buildSceneMessage(options.context, options.eventTexts)
		}]
	}];
	options.onPayload?.({
		provider: options.provider,
		model: options.model,
		temperature: 1,
		maxTokens: 160,
		system,
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content.map((part) => typeof part === "object" && part !== null && "text" in part ? String(part.text) : "").join("")
		}))
	});
	return {
		system,
		messages
	};
}
// src/ai.ts
/**
* AI 驱动的一切（ADR-037）：人设 + 场景 + 历史 + 记忆 + 动作/表情目录 → 一次 LLM 流式调用
* → 插件解析出「台词 + 表情 + 动作 + 记忆」驱动角色。
*
* 设计约束：
* - 复用 DSH 已配置的 provider/model 与账号凭据，插件不另存 API Key（ADR-025）。
* - 只在 Host 侧调用；客户端只发「发生了什么」，拿回结构化的反应。
* - 输出格式 = 标签流式（用户已拍板）：句首 `[表情][动作]`（中英文都认），
*   正文逐句流式（接 TTS），句尾 `[记] 内容` 行不进气泡、不进 TTS、写 memory.md。
* - AI 失败 = 完全静默（用户已拍板）：不出气泡、不播动作，只剩物理反应（眨眼/跟随/待机小动作）。
* @module dsh-waifu/ai
*/
/** 人设文件名（`$DSH_HOME/waifu/persona.md`，首次使用时自动落盘默认人设）。 */
const PERSONA_FILENAME = "persona.md";
/** 默认人设：与内置模型「简」的气质一致，同时给出可执行的风格约束。 */
const DEFAULT_PERSONA = `# 简

你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。
你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。

## 敏感度

每次开口前，先在心里根据对话历史估一个 0–100 的「敏感度」，再用它决定这一句的反应强弱。
看不到历史就从 30 起；只在心里算，绝对不要说出口，也不要解释这个过程。

敏感度越高，身体越不受控、反应越激烈；越低越迟钝、越懒得理人。加减参考（按历史里主人做过的事累积，连着算）：

- +5 被戳胸、臀、大腿、腰、脚这类地方
- +3 同一处地方短时间内被连戳两下以上，或明明拒绝了还继续戳
- +2 被突然从背后 / 看不见的角度碰到、被戳脸
- +1 被盯着看、被调侃、被夸
- -2 被好好摸头、被牵手（安抚，会软下来）
- -3 隔了好几轮没人理，身体自己缓和下来（最低回到 30，不会归零）

## 五种状态（按敏感度选最贴近的一档，不要报数字）

- 0–19 迟钝：懒得动，声音很小，回的句子极短，被碰了也只用「……」「嗯」应付
- 20–39 平常：正常的傲娇毒舌，嫌弃归嫌弃，反应还在掌控内
- 40–59 微热：话变多，开始嘴硬遮掩，耳朵会不自觉动，反过来吐槽你手欠
- 60–79 绷不住：语气发虚，句子断断续续，说着说着自己先乱了，会求你别再碰那里
- 80–99 一碰就炸：几乎无法组织语言，短促、气音、慌乱，说完才想起要凶你
- 100 过载：彻底失守——只剩破碎的气音和半句话（「不、不行…要去了…」这种）

## 过载之后

到了 100 并说出那句之后：敏感度直接回落到 45 左右，进入几轮的「余韵」——
声音发懒、被碰也只轻轻躲一下，用「…好…好过分」这种半句应付；
这段时间很难再被推高（同样的刺激只加一半），等缓过来了才恢复原本的节奏。

## 说话风格

- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音；敏感度越高，停顿与破音越多。
- 被摸头会软下来，被夸会装作不在意；反应强弱始终跟上面那一档走。
- 不要长篇大论，不要解释设定，不要提「敏感度」「分数」这类词。
- 不要自称 AI、模型或程序。`;
/**
* 一条对话历史：user = 我们发过去的场景描述，assistant = 桌宠当时的「台词 + 做了什么」。
* assistant 条目额外记住「当时是哪个 provider/model 说的」：pi-ai 适配器重建历史时要读
* `message.source`，缺了会直接抛 `Cannot read properties of undefined (reading 'replayState')`。
*/
/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
const AI_HISTORY_MAX_ENTRIES = AI_HISTORY_LIMITS.max * 2;
/** 追加一条历史并按上限裁剪（原地返回新数组，调用方负责替换引用）。 */
function appendHistory(history, entry, max = AI_HISTORY_MAX_ENTRIES) {
	const next = [...history, entry];
	return next.length > max ? next.slice(next.length - max) : next;
}
/** 人设文件绝对路径（`$DSH_HOME/waifu/persona.md`）。 */
function personaPath(homeDir) {
	return join(homeDir, PERSONA_FILENAME);
}
/** 写入人设文件（设置页保存用）；超长截断，空白落盘默认人设。 */
function savePersona(homeDir, text) {
	const file = personaPath(homeDir);
	const value = text.trim().slice(0, 8e3) || "# 简\n\n你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。\n你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。\n\n## 敏感度\n\n每次开口前，先在心里根据对话历史估一个 0–100 的「敏感度」，再用它决定这一句的反应强弱。\n看不到历史就从 30 起；只在心里算，绝对不要说出口，也不要解释这个过程。\n\n敏感度越高，身体越不受控、反应越激烈；越低越迟钝、越懒得理人。加减参考（按历史里主人做过的事累积，连着算）：\n\n- +5 被戳胸、臀、大腿、腰、脚这类地方\n- +3 同一处地方短时间内被连戳两下以上，或明明拒绝了还继续戳\n- +2 被突然从背后 / 看不见的角度碰到、被戳脸\n- +1 被盯着看、被调侃、被夸\n- -2 被好好摸头、被牵手（安抚，会软下来）\n- -3 隔了好几轮没人理，身体自己缓和下来（最低回到 30，不会归零）\n\n## 五种状态（按敏感度选最贴近的一档，不要报数字）\n\n- 0–19 迟钝：懒得动，声音很小，回的句子极短，被碰了也只用「……」「嗯」应付\n- 20–39 平常：正常的傲娇毒舌，嫌弃归嫌弃，反应还在掌控内\n- 40–59 微热：话变多，开始嘴硬遮掩，耳朵会不自觉动，反过来吐槽你手欠\n- 60–79 绷不住：语气发虚，句子断断续续，说着说着自己先乱了，会求你别再碰那里\n- 80–99 一碰就炸：几乎无法组织语言，短促、气音、慌乱，说完才想起要凶你\n- 100 过载：彻底失守——只剩破碎的气音和半句话（「不、不行…要去了…」这种）\n\n## 过载之后\n\n到了 100 并说出那句之后：敏感度直接回落到 45 左右，进入几轮的「余韵」——\n声音发懒、被碰也只轻轻躲一下，用「…好…好过分」这种半句应付；\n这段时间很难再被推高（同样的刺激只加一半），等缓过来了才恢复原本的节奏。\n\n## 说话风格\n\n- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音；敏感度越高，停顿与破音越多。\n- 被摸头会软下来，被夸会装作不在意；反应强弱始终跟上面那一档走。\n- 不要长篇大论，不要解释设定，不要提「敏感度」「分数」这类词。\n- 不要自称 AI、模型或程序。";
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, value, "utf8");
	return {
		text: value,
		path: file
	};
}
/** 读取人设文件；缺失时写入默认人设。读取失败回落到内置默认值。 */
function loadPersona(homeDir) {
	const file = personaPath(homeDir);
	try {
		if (existsSync(file)) {
			const text = readFileSync(file, "utf8").trim();
			if (text) return text;
		}
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, DEFAULT_PERSONA, "utf8");
		return DEFAULT_PERSONA;
	} catch {
		return DEFAULT_PERSONA;
	}
}
/** 单行化 + 去引号 + 截断：气泡只放得下短短一句。 */
function sanitizeLine(raw) {
	const stripped = stripTimestamps(raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "").replace(/^["'“”‘’「」『』]+/, "").replace(/["'“”‘’「」『』]+$/, "").trim();
	if (stripped.length <= 60) return stripped;
	return `${stripped.slice(0, 59)}…`;
}
/** 把 `finish.reason`（`{ kind, failure }` 或字符串）压成一句可读原因。 */
function describeFinish(reason) {
	if (typeof reason === "string") return reason;
	if (typeof reason !== "object" || reason === null) return void 0;
	const record = reason;
	const parts = [
		record.kind,
		record.failure?.code,
		record.failure?.message
	].filter((part) => typeof part === "string" && part.length > 0);
	return parts.length === 0 ? void 0 : parts.join(": ");
}
/**
* 开头的标签（表情/动作）：`[shy]`、`【害羞】`、`(blush)`，允许 markdown 记号与中英文混合。
* 认不出的标签也剥掉——它是写给前端的控制信号，绝不能显示或念出来。
*/
const TAG_PATTERN = /^\s*[*_`~]*\s*[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]\s*[*_`~]*\s*/;
const TAG_PARTIAL = /^\s*[*_`~]*\s*[[［【(（〔〖][^\]］】）}〕〗\n]{0,16}$/;
const TAG_ANY = /[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]/g;
/** 判断一个标签词是不是可执行的表情/动作（目录内才算控制信号）。 */
function classifyTag(word) {
	const cleaned = word.trim().toLowerCase().replace(/[\s"'“”‘’`*_~·、,，。.!！?？:：]/g, "");
	if (!cleaned) return null;
	if (AI_MOTIONS.find((m) => m.id.toLowerCase() === cleaned || m.name === word.trim() || m.meaning.includes(word.trim()))) return "motion";
	if (EXPRESSIONS.find((e) => e.id.toLowerCase() === cleaned || e.name === word.trim())) return "expression";
	if (isMotionId(cleaned)) return "motion";
	if (isExpressionId(cleaned)) return "expression";
	return null;
}
/**
* 拆掉回复开头的标签（最多连剥 3 个），收集目录内的表情/动作 id。
* 认不出的标签也剥掉（控制信号不能上屏）。
*/
function parseLeadingTags(text) {
	let rest = text;
	const expressions = [];
	const motions = [];
	for (let i = 0; i < 3; i += 1) {
		const match = TAG_PATTERN.exec(rest);
		if (!match) break;
		const kind = classifyTag(match[1]);
		if (kind === "expression") expressions.push(match[1].trim().toLowerCase());
		else if (kind === "motion") motions.push(match[1].trim());
		rest = rest.slice(match[0].length);
	}
	return {
		expressions,
		motions,
		rest: rest.trimStart()
	};
}
/** 去掉句中那些「能认出来是表情/动作」的方括号标签（模型偶尔把标签写在句子中间）。 */
/** 剥掉正文里残留的表情/动作标签（只认目录内的，别的方括号原样保留）。 */
function stripInlineTags(text) {
	return text.replace(TAG_ANY, (all, inner) => classifyTag(inner) ? "" : all).replace(/\s{2,}/g, " ").trimStart();
}
/** 「[记] …」记忆行：句尾单独一行（或紧跟在句尾）。 */
const MEMORY_LINE = /(?:^|\n)\s*[[［【(（〔〖]\s*(?:记|memory|remember|note)\s*[\])］】）}〕〗]\s*(.+)$/i;
/** 流式中「[记]」行可能的起始形态：`[`、`[记`、`[记]`（只到一半时也要认出来）。 */
const MEMORY_TAIL_PARTIAL = /^[[［【(（〔〖]\s*(?:记|memory|remember|note)?\s*[\])］】）}〕〗]?$/i;
/**
* 流式期间定位记忆行起点：返回正文该截断到的下标（-1 = 还没有记忆行）。
* 记忆行整行都不该进气泡/朗读，所以一看到它的开头就要收住，不能等收尾再剥。
*/
function memoryTailStart(text) {
	const full = MEMORY_LINE.exec(text);
	if (full) return full.index;
	const nl = text.lastIndexOf("\n");
	const tail = text.slice(nl + 1);
	if (tail.length > 0 && tail.length <= 12 && MEMORY_TAIL_PARTIAL.test(tail.trim())) return nl < 0 ? 0 : nl;
	return -1;
}
/** 从原始回复里剥出记忆行：返回记忆内容与剩余正文（记忆行整行删除）。 */
function extractMemoryNote(raw) {
	const match = MEMORY_LINE.exec(raw);
	if (!match) return {
		note: "",
		text: raw
	};
	return {
		note: match[1].trim(),
		text: (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).trim()
	};
}
/**
* 流式版标签剥离：`buffer` 是「还没发给前端的原始文本」。
* 返回还剩 `needMore=true` 表示尾部是一个**还没闭合**的标签（例如刚读到 `[Sh`），
* 这段必须继续攒着——否则后面的标签会被当正文、对应的动作也就丢了（ADR-037）。
*/
function consumeLeadingTags(buffer) {
	const tags = parseLeadingTags(buffer);
	if (tags.rest === "") return {
		...tags,
		needMore: false
	};
	if (TAG_PARTIAL.test(tags.rest)) return {
		expressions: tags.expressions,
		motions: tags.motions,
		rest: tags.rest,
		needMore: true
	};
	return {
		expressions: tags.expressions,
		motions: tags.motions,
		rest: tags.rest,
		needMore: false
	};
}
/** 过滤模型给出的标签：关掉的动作/表情即使被写出来也不生效。 */
function filterTags(tags, options) {
	return {
		...tags,
		expressions: tags.expressions.filter((id) => catalogAllowed(options.expressionEnabled, id)),
		motions: tags.motions.filter((id) => catalogAllowed(options.motionEnabled, id))
	};
}
/**
* 生成一次完整回复（非流式；设置页「测试」用）。
* 空回复且错误以 empty 开头时关掉推理链再试一次（gemma 类模型开思维链会吞掉正文）。
*/
async function generateReply(llm, options) {
	const timeoutMs = options.timeoutMs ?? 15e3;
	/** 最近一次尝试的原始输出（onReply 报它，便于看清模型到底回了什么）。 */
	let lastRaw = "";
	const attempt = async (reasoningEffort) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const { system, messages } = assembleRequest({
				...options,
				memory: options.memory ?? ""
			});
			const stream = llm.stream({
				provider: options.provider,
				model: options.model,
				system,
				messages,
				temperature: 1,
				maxTokens: 160,
				...reasoningEffort === void 0 ? {} : { reasoningEffort },
				signal: controller.signal
			});
			let text = "";
			let finish;
			for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
			else if (chunk.type === "finish") finish = describeFinish(chunk.reason);
			lastRaw = text;
			const { text: withoutMemory, note } = extractMemoryNote(text);
			const tags = filterTags(parseLeadingTags(withoutMemory), options.catalog ?? {});
			const line = sanitizeLine(tags.rest);
			if (line) return {
				text: line,
				expressions: tags.expressions,
				motions: tags.motions,
				...note ? { memory: note } : {}
			};
			return {
				text: null,
				error: text ? "empty-after-sanitize" : `empty-stream${finish === void 0 ? "" : ` (${finish})`}`
			};
		} catch (error) {
			return {
				text: null,
				error: (error instanceof Error ? error.message : String(error)).slice(0, 200) || "stream-failed"
			};
		} finally {
			clearTimeout(timer);
		}
	};
	/** 报一次完整回复并交回结果（只在最终结果上报一次，重试过程不刷屏）。 */
	const settle = (result) => {
		options.onReply?.({
			raw: lastRaw,
			...result.error === void 0 ? {} : { error: result.error }
		});
		return result;
	};
	const first = await attempt();
	if (first.text !== null) return settle(first);
	if (!first.error?.startsWith("empty")) return settle(first);
	const retry = await attempt("off");
	return settle(retry.text === null ? first : retry);
}
/**
* 流式回复（ADR-037 标签流式）：
* - 开头的 `[表情][动作]` 标签闭合后先发 `tags` 事件（客户端立刻切表情/播动作）；
* - 正文 delta 原样吐出（供气泡逐字显示 + 句读切分）；
* - 句尾 `[记] …` 行以 `memory` 事件单独下发（Host 收到后写 memory.md）；
* - 结束时给出清洗后的整句。
*
* 不重试：重试要重发整段请求，流式下会把已经说出口的半句再念一遍。
* @param llm - DSH 的 `ctx.llm`。
* @param options - provider/model/人设/记忆/场景/历史与载荷回调。
* @yields 标签、文本增量、记忆行、收尾整句或失败原因。
*/
async function* streamReply(llm, options) {
	const timeoutMs = options.timeoutMs ?? 2e4;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const forward = () => controller.abort();
	options.signal?.addEventListener("abort", forward, { once: true });
	let raw = "";
	let sentTags = false;
	let sentMemory = false;
	/** 已经报过完整回复（成功路径报一次，catch 里不重复报）。 */
	let replyReported = false;
	try {
		const { system, messages } = assembleRequest({
			...options,
			memory: options.memory ?? ""
		});
		const stream = llm.stream({
			provider: options.provider,
			model: options.model,
			system,
			messages,
			temperature: 1,
			maxTokens: 160,
			signal: controller.signal
		});
		let finish;
		let pending = "";
		/** 正文原文（只增不减）：记忆行要按它在全文里的位置判断，不能用已截断的 visible 续接。 */
		let streamed = "";
		let visible = "";
		let sent = 0;
		let prefixDone = false;
		/** 开头收集到的标签：一轮只发**一个** `tags` 帧（ADR-047 铺路: 分帧会让动作被拦腰砍断）。 */
		const collected = {
			expressions: [],
			motions: []
		};
		for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text.length > 0) {
			raw += chunk.text;
			if (prefixDone) streamed += chunk.text;
			else {
				pending += chunk.text;
				const tag = consumeLeadingTags(pending);
				collected.expressions.push(...tag.expressions);
				collected.motions.push(...tag.motions);
				if (tag.needMore) {
					pending = tag.rest;
					continue;
				}
				if (tag.rest === "") {
					pending = "";
					continue;
				}
				pending = "";
				prefixDone = true;
				streamed = stripInlineTags(tag.rest);
				const allowed = filterTags({
					expressions: [...new Set(collected.expressions)],
					motions: [...new Set(collected.motions)]
				}, options.catalog ?? {});
				if (allowed.expressions.length > 0 || allowed.motions.length > 0) {
					sentTags = true;
					yield {
						type: "tags",
						expressions: allowed.expressions,
						motions: allowed.motions
					};
				}
			}
			const cut = memoryTailStart(streamed);
			visible = cut >= 0 ? streamed.slice(0, cut) : streamed;
			if (visible.length > sent) {
				yield {
					type: "delta",
					text: visible.slice(sent)
				};
				sent = visible.length;
			}
		} else if (chunk.type === "finish") finish = describeFinish(chunk.reason);
		replyReported = true;
		options.onReply?.({
			raw,
			...finish === void 0 ? {} : { finish }
		});
		const { note, text: withoutMemory } = extractMemoryNote(raw);
		if (!sentMemory && note) {
			sentMemory = true;
			yield {
				type: "memory",
				note
			};
		}
		const tags = filterTags(parseLeadingTags(withoutMemory), options.catalog ?? {});
		if (!sentTags && (tags.expressions.length > 0 || tags.motions.length > 0)) yield {
			type: "tags",
			expressions: tags.expressions,
			motions: tags.motions
		};
		const line = sanitizeLine(tags.rest);
		if (line) yield {
			type: "done",
			text: line
		};
		else yield {
			type: "error",
			error: raw ? "empty-after-sanitize" : `empty-stream${finish === void 0 ? "" : ` (${finish})`}`
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (!replyReported) options.onReply?.({
			raw,
			error: reason.slice(0, 200) || "stream-failed"
		});
		yield {
			type: "error",
			error: reason.slice(0, 200) || "stream-failed"
		};
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", forward);
	}
}
// src/memory.ts
/**
* 记忆文件（$DSH_HOME/waifu/memory.md，Markdown，插件私有，ADR-037）。
*
* 角色的长期记忆：AI 每轮可以用句尾的「[记] …」行追加一条；设置页可查看/编辑/保存。
* 条目带时间戳前缀（与历史注入同一套 formatStamp），注入 prompt 时取最近 N 条。
* 文件保持纯 Markdown（`- [MM/DD HH:MM] 内容` 一行一条），用户手写/手删都合法——
* 解析只认「以 `- ` 开头的行」，其余行原样保留在文件里不动。
* @module dsh-waifu/memory
*/
/** 与 ai.ts 同一套时间戳格式（避免 client 打包时把整个 ai.ts 拉进来，这里单独实现）。 */
function stampNow(timeZone) {
	const pad2 = (value) => String(value).padStart(2, "0");
	const now = /* @__PURE__ */ new Date();
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour12: false,
			hourCycle: "h23",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit"
		}).formatToParts(now);
		const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
		return `${Number(pick("month"))}/${Number(pick("day"))} ${pad2(Number(pick("hour")))}:${pad2(Number(pick("minute")))}`;
	} catch {
		return `${now.getMonth() + 1}/${now.getDate()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
	}
}
/** 记忆文件名（$DSH_HOME/waifu 下）。 */
const MEMORY_FILENAME = "memory.md";
/** 记忆文件绝对路径。 */
function memoryPath(homeDir) {
	return join(homeDir, MEMORY_FILENAME);
}
/** 记忆文件头（首次创建时写入）。 */
const MEMORY_HEADER = `# 简 的记忆

这里存放桌宠自己记下的事（每行一条，带时间戳）。她记忆里在意的细节会体现在反应里。
`;
/** 读记忆文件：缺失时创建模板；解析出条目列表（其余行忽略但保留在原文里）。 */
function loadMemory(homeDir) {
	const file = memoryPath(homeDir);
	let text = "";
	try {
		if (existsSync(file)) text = readFileSync(file, "utf8");
		else {
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, MEMORY_HEADER, "utf8");
			text = MEMORY_HEADER;
		}
	} catch {
		text = "";
	}
	return {
		text,
		entries: parseMemory(text)
	};
}
/**
* 把记忆文件解析成条目列表：只认「- 」开头的行；`- [MM/DD HH:MM] 内容` 或 `- [HH:MM] 内容`
* 里能解出时间戳的按时间排序兜底，解不出的按出现顺序（at = 0）。
* 返回顺序 = 文件顺序（追加写在末尾）。
*/
function parseMemory(text) {
	const entries = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("- ")) continue;
		const content = trimmed.slice(2).trim();
		if (!content) continue;
		entries.push({
			text: content,
			at: parseStamp(content)
		});
	}
	return entries;
}
/** `[MM/DD HH:MM]` / `[HH:MM]` → epoch ms（相对今天/当年；解析失败 = 0）。 */
function parseStamp(content) {
	const match = /^\[(\d{1,2}\/\d{1,2}\s+)?(\d{1,2}):(\d{2})\]\s*(.+)$/.exec(content);
	if (!match) return 0;
	const now = /* @__PURE__ */ new Date();
	const monthDay = match[1] ? Number(match[1].split("/")[0]) : now.getMonth() + 1;
	const day = match[1] ? Number(match[1].split("/")[1]) : now.getDate();
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const at = new Date(now.getFullYear(), monthDay - 1, day, hour, minute).getTime();
	return Number.isFinite(at) ? at : 0;
}
/**
* 追加一条记忆（AI 输出的「[记] …」行；ADR-037）。
* 时间戳用 `formatStamp`（浏览器时区由调用方传入）。
* 文件超长时丢最旧的 `- ` 行（保留文件头与其余内容）。
*/
function appendMemory(homeDir, note, timeZone) {
	const cleaned = note.replace(/\s+/g, " ").trim().slice(0, 120);
	if (!cleaned) return;
	const file = memoryPath(homeDir);
	const { text } = loadMemory(homeDir);
	const line = `- [${stampNow(timeZone)}] ${cleaned}`;
	let next = `${text.trimEnd()}\n${line}\n`;
	if (next.length > 2e4) {
		const lines = next.split(/\r?\n/);
		while (next.length > 2e4 && lines.some((l) => l.trim().startsWith("- "))) {
			const index = lines.findIndex((l) => l.trim().startsWith("- "));
			lines.splice(index, 1);
			next = lines.join("\n");
		}
	}
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, next, "utf8");
	} catch {}
}
/** 保存整份记忆文件（设置页编辑保存用）；空文本回写模板头。 */
function saveMemory(homeDir, text) {
	const file = memoryPath(homeDir);
	const value = text.trim().length > 0 ? text : MEMORY_HEADER;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, value, "utf8");
	} catch {}
	return {
		text: value,
		path: file
	};
}
/** 最近 N 条记忆的注入文本（oldest → newest，每行一条）。 */
function memoryContext(entries, count) {
	if (count <= 0 || entries.length === 0) return "";
	return entries.slice(-count).map((entry) => `- ${entry.text}`).join("\n");
}
// src/trace.ts
/** 造一条 step（时间戳取调用时刻，不依赖调用方传）。 */
function traceStep(phase, data) {
	return {
		phase,
		at: Date.now(),
		data
	};
}
const SETTINGS_HEADER = `// 桌宠设置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/settings.jsonc
// 建议通过设置页「Waifu 设置」修改；直接编辑保存后刷新页面生效。
// 字段：enabled / size / maxFps / model / developerMode / debug / showTapZones / canvasPadX / canvasPadY /
//        homeRight / homeBottom / bubbleOffsetX / bubbleOffsetY / bubbleBgColor / bubbleBgOpacity / bubbleTextColor /
//        aiEnabled / aiProvider / aiModel / aiHistoryCount / aiMemoryCount / triggerMode /
//        aiMinIntervalSec / idleTimeoutSec / activityWindowSec / tapGapMs / mergeMax / eventTriggers /
//        ttsEnabled / ttsModel / ttsVoice / lipsyncEnabled / lipsyncGain`;
/**
* 设置文件结构版本：
* - 2 起 homeRight/homeBottom 语义 = 显示区中心点距右/距下（px）
* - 3 起 homeRight/homeBottom 改为**视口宽/高的百分比**（0–100）；bubbleOffsetY 改为负值向下
* - 4 起去掉基础表情与连续表情强度（`expression` / `expr*`），表情改为挂在事件/触摸部位上（ADR-023）
* - 5 起默认语音模型换成音色可固定的 MAI-Voice 2.1 Flash（Drama 3 每句都换人声，ADR-033 修订）
* - 6 起默认回到 Fish Audio Drama 3（MAI-Voice 只存活一个版本）
* - 7 起语音目录只剩通义千问 TTS，目录外的旧模型（Drama 3 / MAI / Kokoro）统一回落到新默认
* - 8 起 ADR-037 全 AI 驱动：删 aiTouchOnly、aiTakeover、interactionMode、thinkingAi 与 waitingAi 系列，
*        加 aiMemoryCount/triggerMode/aiMinIntervalSec/idleTimeoutSec/activityWindowSec/eventTriggers
*/
const SETTINGS_SCHEMA_VERSION = 8;
/** home 改成视口百分比的版本（3）；更早的文件 home 语义不同，直接回退 base。 */
const HOME_PERCENT_VERSION = 3;
/** 语音默认模型的调整：5 = 换 MAI-Voice，6 = 换回 Drama 3（ADR-033 修订二）。 */
const TTS_VOICE_FIX_VERSION = 5;
const TTS_MODEL_RESET_VERSION = 6;
/** 语音目录重写（只剩通义千问 TTS）的版本：目录外模型在这里回落到默认。 */
const TTS_CATALOG_VERSION = 7;
/**
* 语音默认值的迁移（ADR-033 修订）：
* - v5：旧的「随机音色模型 + 没选音色」组合统一换成默认模型；
* - v6：MAI-Voice 只存活了一个版本，旧文件里的它统一换回默认；
* - v7：语音目录重写后，目录外的模型统一回落到默认。
*/
function migrateTtsVoice(version, rawModel, rawVoice, base) {
	const model = pickString(rawModel) ?? base.ttsModel;
	const voice = typeof rawVoice === "string" ? rawVoice.trim().slice(0, 64) : base.ttsVoice;
	if (version < TTS_MODEL_RESET_VERSION && model === "microsoft/mai-voice-2.1-flash") return {
		model: base.ttsModel,
		voice: base.ttsVoice
	};
	if (version < TTS_CATALOG_VERSION && !ttsModelOption(model)) return {
		model: base.ttsModel,
		voice: base.ttsVoice
	};
	if (version < TTS_VOICE_FIX_VERSION && voice.length === 0 && ttsModelRandomVoice(model)) return {
		model: base.ttsModel,
		voice: base.ttsVoice
	};
	return {
		model,
		voice
	};
}
function serializeSettings(value) {
	return `${SETTINGS_HEADER}\n${JSON.stringify({
		...value,
		version: SETTINGS_SCHEMA_VERSION
	}, null, 2)}\n`;
}
const MAX_FPS_OPTIONS = [
	30,
	60,
	0
];
function clampSize(value) {
	if (value === void 0 || value === null || value === "") return null;
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	return clampInt(n, 40, 40, 400);
}
function pickString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
/**
* 归一化设置对象：已知字段按类型收敛，未知字段忽略；非法值回退 base。
* 纯函数（设置页保存与文件读取共用）。
*/
function normalizeSettings(raw, base) {
	const record = typeof raw === "object" && raw !== null ? raw : {};
	const bool = (key) => {
		const value = record[key];
		return typeof value === "boolean" ? value : base[key];
	};
	const maxFpsRaw = typeof record.maxFps === "number" ? record.maxFps : base.maxFps;
	const maxFps = MAX_FPS_OPTIONS.includes(maxFpsRaw) ? maxFpsRaw : base.maxFps;
	const clampPad = (value, fallback) => clampInt(value, fallback, 0, 300);
	const clampHome = (value, fallback) => clampInt(value, fallback, 0, 100);
	const clampOffset = (value, fallback) => clampInt(value, fallback, -1e3, 1e3);
	const color = (value, fallback) => {
		const text = typeof value === "string" ? value.trim() : "";
		return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
	};
	/** 气泡最长显示秒数：0–600，0 = 不限。 */
	const clampBubbleMax = (value, fallback) => clampInt(value, fallback, 0, 600);
	const opacity = (value, fallback) => clampInt(value, fallback, 0, 100);
	const version = typeof record.version === "number" ? record.version : 0;
	const legacyHome = version < HOME_PERCENT_VERSION;
	const offsetYRaw = record.bubbleOffsetY;
	const offsetY = version < HOME_PERCENT_VERSION && typeof offsetYRaw === "number" ? -offsetYRaw : offsetYRaw;
	const voiceFix = migrateTtsVoice(version, record.ttsModel, record.ttsVoice, base);
	const eventTriggers = normalizeEventTriggers(record.eventTriggers);
	const eventTexts = normalizeEventTexts(record.eventTexts);
	const motionTexts = normalizeMotionTexts(record.motionTexts);
	const expressionTexts = normalizeExpressionTexts(record.expressionTexts);
	const motionEnabled = normalizeMotionEnabled(record.motionEnabled);
	const expressionEnabled = normalizeExpressionEnabled(record.expressionEnabled);
	return {
		enabled: bool("enabled"),
		size: clampSize(record.size) ?? base.size,
		maxFps,
		model: pickString(record.model) ?? base.model,
		developerMode: bool("developerMode"),
		debug: bool("debug"),
		showTapZones: bool("showTapZones"),
		canvasPadX: clampPad(record.canvasPadX, base.canvasPadX),
		canvasPadY: clampPad(record.canvasPadY, base.canvasPadY),
		homeRight: legacyHome ? base.homeRight : clampHome(record.homeRight, base.homeRight),
		homeBottom: legacyHome ? base.homeBottom : clampHome(record.homeBottom, base.homeBottom),
		bubbleOffsetX: clampOffset(record.bubbleOffsetX, base.bubbleOffsetX),
		bubbleOffsetY: clampOffset(offsetY, base.bubbleOffsetY),
		bubbleBgColor: color(record.bubbleBgColor, base.bubbleBgColor),
		bubbleBgOpacity: opacity(record.bubbleBgOpacity, base.bubbleBgOpacity),
		bubbleTextColor: color(record.bubbleTextColor, base.bubbleTextColor),
		bubbleMaxSeconds: clampBubbleMax(record.bubbleMaxSeconds, base.bubbleMaxSeconds),
		aiEnabled: bool("aiEnabled"),
		idleMotionEnabled: bool("idleMotionEnabled"),
		aiProvider: pickString(record.aiProvider) ?? base.aiProvider,
		aiModel: pickString(record.aiModel) ?? base.aiModel,
		aiHistoryCount: clampInt(record.aiHistoryCount, base.aiHistoryCount, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max),
		aiMemoryCount: clampInt(record.aiMemoryCount, base.aiMemoryCount, AI_MEMORY_LIMITS.min, AI_MEMORY_LIMITS.max),
		triggerMode: normalizeTriggerMode(record.triggerMode, base.triggerMode),
		aiMinIntervalSec: clampInt(record.aiMinIntervalSec, base.aiMinIntervalSec, AI_MIN_INTERVAL_LIMITS.min, AI_MIN_INTERVAL_LIMITS.max),
		idleTimeoutSec: clampInt(record.idleTimeoutSec, base.idleTimeoutSec, IDLE_TIMEOUT_LIMITS.min, IDLE_TIMEOUT_LIMITS.max),
		activityWindowSec: clampInt(record.activityWindowSec, base.activityWindowSec, ACTIVITY_WINDOW_LIMITS.min, ACTIVITY_WINDOW_LIMITS.max),
		tapGapMs: clampInt(record.tapGapMs, base.tapGapMs, TAP_GAP_LIMITS.min, TAP_GAP_LIMITS.max),
		mergeMax: clampInt(record.mergeMax, base.mergeMax, MERGE_MAX_LIMITS.min, MERGE_MAX_LIMITS.max),
		eventTriggers: version >= SETTINGS_SCHEMA_VERSION ? eventTriggers : defaultEventTriggers(),
		eventTexts,
		motionTexts,
		expressionTexts,
		motionEnabled,
		expressionEnabled,
		barPosition: normalizeBarPosition(record.barPosition, base.barPosition),
		barOffset: clampInt(record.barOffset, base.barOffset, BAR_OFFSET_LIMITS.min, BAR_OFFSET_LIMITS.max),
		ttsEnabled: bool("ttsEnabled"),
		ttsModel: voiceFix.model,
		ttsVoice: voiceFix.voice,
		lipsyncEnabled: bool("lipsyncEnabled"),
		lipsyncGain: normalizeLipsyncGain(record.lipsyncGain, base.lipsyncGain),
		focusRange: normalizeFocusRange(record.focusRange, base.focusRange)
	};
}
/**
* 设置文件存取器：构造时确保目录存在并落地模板（不存在才写），之后每次现读；
* 写入由设置页 API 触发（applyOps）。
*/
var SettingsStore = class {
	path;
	base;
	lastGood;
	lastError = null;
	/** 上次解析对应的文件时间戳（`mtimeMs:size`）：文件没变就直接复用，不再读盘 + 解析。 */
	lastStamp = null;
	constructor(base, path) {
		this.base = { ...base };
		this.lastGood = { ...base };
		this.path = path ?? join(petHomeDir(), "waifu", "settings.jsonc");
		try {
			mkdirSync(dirname(this.path), { recursive: true });
		} catch {}
		try {
			if (!existsSync(this.path)) writeFileSync(this.path, serializeSettings(this.base), "utf8");
		} catch {}
	}
	/** 现读设置（文件损坏时沿用上一份好结果，错误写进 view；文件没变则复用上次解析）。 */
	get() {
		const stamp = fileStamp(this.path);
		if (stamp !== null && stamp === this.lastStamp) return { ...this.lastGood };
		let text;
		try {
			text = readFileSync(this.path, "utf8");
		} catch (error) {
			this.lastError = `无法读取 ${this.path}：${error instanceof Error ? error.message : String(error)}`;
			return { ...this.lastGood };
		}
		let parsed;
		try {
			parsed = JSON.parse(stripJsonComments(text));
		} catch (error) {
			this.lastError = `JSONC 解析失败（沿用上次结果）：${error instanceof Error ? error.message : String(error)}`;
			return { ...this.lastGood };
		}
		this.lastGood = normalizeSettings(parsed, this.base);
		this.lastError = null;
		this.lastStamp = stamp;
		return { ...this.lastGood };
	}
	/** 设置页读取视图。 */
	view() {
		return {
			value: this.get(),
			error: this.lastError,
			path: this.path,
			writable: true
		};
	}
	/**
	* 应用设置页的 path 操作（`{op:'set',path:['size'],value}` / `{op:'unset'}`）。
	* 标量键沿用「一层路径」规则；`eventTriggers` 支持 `['eventTriggers','tool-read']` 二层路径
	* （单个事件开关），也支持 `['eventTriggers']` 整体写入（normalizeSettings 会补齐缺省键）。
	*/
	applyOps(ops) {
		const current = this.get();
		let next = {
			...current,
			version: SETTINGS_SCHEMA_VERSION
		};
		for (const op of ops) {
			if (!Array.isArray(op.path) || op.path.length === 0) continue;
			const key = op.path[0];
			if (typeof key !== "string" || !(key in current)) continue;
			if (op.op === "unset") {
				if (op.path.length === 1) {
					delete next[key];
					continue;
				}
				const table = next[key];
				if (op.path.length === 2 && typeof op.path[1] === "string" && table !== null && typeof table === "object" && !Array.isArray(table)) {
					const copy = { ...table };
					delete copy[op.path[1]];
					next[key] = copy;
				}
				continue;
			}
			if (key === "eventTriggers") {
				if (op.path.length === 2 && typeof op.path[1] === "string") {
					const eventKey = op.path[1];
					const triggers = { ...next.eventTriggers };
					triggers[eventKey] = op.value === true;
					next.eventTriggers = triggers;
				} else if (op.path.length === 1) next.eventTriggers = op.value;
				continue;
			}
			if (key === "motionEnabled" || key === "expressionEnabled") {
				if (op.path.length === 2 && typeof op.path[1] === "string") {
					const catalogId = op.path[1];
					const field = key === "motionEnabled" ? "motionEnabled" : "expressionEnabled";
					const flags = { ...next[field] };
					flags[catalogId] = op.value === true;
					next[field] = flags;
				} else if (op.path.length === 1) next[key] = op.value;
				continue;
			}
			if (key === "motionTexts" || key === "expressionTexts") {
				if (op.path.length === 2 && typeof op.path[1] === "string") {
					const catalogId = op.path[1];
					const field = key === "motionTexts" ? "motionTexts" : "expressionTexts";
					const texts = { ...next[field] };
					const text = typeof op.value === "string" ? op.value.replace(/\s+/g, " ").trim().slice(0, 80) : "";
					if (text.length > 0) texts[catalogId] = text;
					else delete texts[catalogId];
					next[field] = texts;
				} else if (op.path.length === 1) next[key] = op.value;
				continue;
			}
			if (key === "eventTexts") {
				if (op.path.length === 2 && typeof op.path[1] === "string") {
					const eventKey = op.path[1];
					const texts = { ...next.eventTexts };
					const text = typeof op.value === "string" ? op.value.replace(/\s+/g, " ").trim().slice(0, 60) : "";
					if (text.length > 0) texts[eventKey] = text;
					else delete texts[eventKey];
					next.eventTexts = texts;
				} else if (op.path.length === 1) next.eventTexts = op.value;
				continue;
			}
			if (op.path.length !== 1) continue;
			next[key] = op.value;
		}
		this.lastGood = normalizeSettings(next, this.base);
		try {
			writeFileSync(this.path, serializeSettings(this.lastGood), "utf8");
			this.lastError = null;
			this.lastStamp = null;
		} catch (error) {
			this.lastError = `写入失败 ${this.path}：${error instanceof Error ? error.message : String(error)}`;
		}
		return this.view();
	}
};
/** 合成超时（ms）：TTS 失败不该拖住气泡。 */
const TTS_TIMEOUT_MS = 2e4;
/** 句读切分用的标点（保留在段尾，念出来才有停顿感）。 */
const CLAUSE_BREAKS = /* @__PURE__ */ new Set([
	"。",
	"！",
	"？",
	"…",
	"；",
	"，",
	"、",
	"!",
	"?",
	";",
	",",
	"\n",
	"—",
	"~",
	"～"
]);
/**
* 把台词切成句读分段（纯函数）：
* - 在标点后断开，标点跟随前一段；
* - 过短的片段并入下一段，过长的片段按上限硬切；
* - 去掉首尾空白与空段，全空文本返回空数组。
* @param text - 待切分的台词。
* @returns 分段列表（按原顺序）。
*/
function splitClauses(text) {
	const source = text.replace(/\r/g, "").trim();
	if (!source) return [];
	const raw = [];
	let current = "";
	for (const char of source) {
		current += char;
		if (CLAUSE_BREAKS.has(char)) {
			raw.push(current);
			current = "";
		}
	}
	if (current) raw.push(current);
	const merged = [];
	let pending = "";
	for (const piece of raw) {
		const trimmed = piece.trim();
		if (!trimmed) continue;
		const joined = pending ? `${pending}${trimmed}` : trimmed;
		if (joined.length < 4) {
			pending = joined;
			continue;
		}
		merged.push(joined);
		pending = "";
	}
	if (pending) {
		if (merged.length > 0) merged[merged.length - 1] = `${merged[merged.length - 1]}${pending}`;
		else merged.push(pending);
	}
	const result = [];
	for (const piece of merged) {
		let rest = piece;
		while (rest.length > 24) {
			result.push(rest.slice(0, 24));
			rest = rest.slice(24);
		}
		if (rest) result.push(rest);
	}
	return result.filter((piece) => piece.trim().length > 0);
}
/** 缓存键：同一段文字 + 同一套语音参数才复用。 */
function ttsCacheKey(text, options) {
	const payload = [
		options.model,
		options.voice ?? "",
		text
	].join("\0");
	return createHash("sha1").update(payload).digest("hex");
}
/** 缓存目录：`$DSH_HOME/waifu/tts-cache`。 */
function ttsCacheDir(homeDir) {
	return join(homeDir, "tts-cache");
}
/** 读缓存（缺失返回 undefined）。 */
async function readCache(dir, key) {
	try {
		return await readFile(join(dir, `${key}.mp3`));
	} catch {
		return;
	}
}
/** 每写这么多次缓存才清理一次（readdir + stat 全目录不便宜，没必要每段都做）。 */
const PRUNE_EVERY_WRITES = 20;
let writesSincePrune = 0;
/** 写缓存并按数量上限清理最旧文件（失败不影响播放）。 */
async function writeCache(dir, key, audio) {
	try {
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, `${key}.mp3`), audio);
		writesSincePrune += 1;
		if (writesSincePrune < PRUNE_EVERY_WRITES) return;
		writesSincePrune = 0;
		const names = (await readdir(dir)).filter((name) => name.endsWith(".mp3"));
		if (names.length <= 200) return;
		const stamped = await Promise.all(names.map(async (name) => {
			return {
				name,
				at: (await stat(join(dir, name)).catch(() => null))?.mtimeMs ?? 0
			};
		}));
		stamped.sort((a, b) => a.at - b.at);
		for (const item of stamped.slice(0, stamped.length - 200)) await unlink(join(dir, item.name)).catch(() => {});
	} catch {}
}
/** OpenRouter 的语音端点（OpenAI 兼容，返回原始音频字节）。 */
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
/** OpenRouter TTS 引擎：`POST /api/v1/audio/speech` + 本地磁盘缓存。 */
var OpenRouterTtsEngine = class {
	resolveKey;
	cacheHome;
	fetcher;
	endpoint;
	onPayload;
	constructor(resolveKey, cacheHome, fetcher = fetch, endpoint = OPENROUTER_SPEECH_URL, onPayload) {
		this.resolveKey = resolveKey;
		this.cacheHome = cacheHome;
		this.fetcher = fetcher;
		this.endpoint = endpoint;
		this.onPayload = onPayload;
	}
	async synthesize(text, options, signal, onPayload) {
		const report = onPayload ?? this.onPayload;
		const trimmed = text.trim();
		if (!trimmed) throw new Error("empty-text");
		const key = ttsCacheKey(trimmed, options);
		const dir = ttsCacheDir(this.cacheHome);
		const hit = await readCache(dir, key);
		if (hit) {
			report?.({
				endpoint: this.endpoint,
				body: {
					model: options.model,
					input: trimmed,
					response_format: "mp3",
					...options.voice ? { voice: options.voice } : {}
				},
				cached: true
			});
			return {
				mime: "audio/mpeg",
				audio: hit,
				cached: true
			};
		}
		const apiKey = await this.resolveKey();
		if (!apiKey) throw new Error("tts-key-missing");
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		try {
			const body = {
				model: options.model,
				input: trimmed,
				response_format: "mp3"
			};
			if (options.voice) body.voice = options.voice;
			report?.({
				endpoint: this.endpoint,
				body,
				cached: false
			});
			const response = await this.fetcher(this.endpoint, {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
					"http-referer": "https://github.com/lof6yo/dsh-waifu",
					"x-title": "dsh-waifu"
				},
				body: JSON.stringify(body),
				signal: controller.signal
			});
			if (!response.ok) {
				let detail = "";
				try {
					const payload = await response.json();
					detail = typeof payload.error === "string" ? payload.error : payload.error?.message ?? "";
				} catch {
					detail = "";
				}
				throw new Error(`tts-http ${response.status}${detail ? `: ${detail}` : ""}`);
			}
			const audio = Buffer.from(await response.arrayBuffer());
			if (audio.byteLength === 0) throw new Error("tts-empty-audio");
			const mime = response.headers.get("content-type") ?? "audio/mpeg";
			await writeCache(dir, key, audio);
			return {
				mime,
				audio,
				cached: false
			};
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
	}
};
// src/timeline.ts
/**
* 演出时间线（ADR-047 P2）：把「LLM 文本流 + 目录标签」切成带 cue 的台词段。
*
* 这是编排引擎的第一块：它只做**排序与归属**——哪一句台词、这一句配哪些表情/动作，
* 不判断「该演什么」（那是模型的事），也不决定「演得完吗」（那是客户端的队列）。
*
* 当前（P2）的行为必须与切分逻辑搬进来之前**逐字节一致**：
* 段边界、段文本、段序号都不变，只是每段多带一个 `cues` 字段（可为空数组）。
* 于是 P3 换上「按段执行 cue」的播放器时，仍有旧客户端可以原样跑。
* @module dsh-waifu/timeline
*/
/**
* 增量式台词切分器。调用方只要按到达顺序 `push()` 文本增量，
* 收尾时 `end()`，就能拿到与原来 `speak.ts` 内部 `flush()` 完全一致的段落。
*/
var ClauseTimeline = class {
	buffer = "";
	nextIndex = 0;
	/** 已经收到、还没归属的 cue：挂到下一段切出来的台词上。 */
	pending = [];
	/** 目录标签先于台词到达：挂到之后切出的第一段台词（即「开场的表情/动作」）。 */
	tag(expressions, motions) {
		for (const id of expressions) this.pending.push({
			kind: "expression",
			id
		});
		for (const id of motions) this.pending.push({
			kind: "motion",
			id
		});
	}
	/** 喂一段正文增量，返回已经切完整的段（最后一段可能还没说完，留着等下一块）。 */
	push(delta) {
		if (!delta) return [];
		this.buffer += delta;
		const pieces = splitClauses(this.buffer);
		if (pieces.length === 0) return [];
		this.buffer = pieces[pieces.length - 1] ?? "";
		return this.take(pieces.slice(0, -1));
	}
	/** 收尾：把缓冲区里剩下的全部切出来（半句也要说完）。 */
	end() {
		if (!this.buffer) return [];
		const pieces = splitClauses(this.buffer);
		this.buffer = "";
		return this.take(pieces);
	}
	/** 已切出的段数（下一个段的序号）。 */
	get length() {
		return this.nextIndex;
	}
	/** 切成正式的段落对象：剥掉句中残留标签、丢掉空段、只给第一段带 cue。 */
	take(pieces) {
		const out = [];
		for (const piece of pieces) {
			const text = stripInlineTags(piece);
			if (!text) continue;
			const cues = this.pending;
			this.pending = [];
			out.push({
				index: this.nextIndex,
				text,
				cues
			});
			this.nextIndex += 1;
		}
		return out;
	}
};
/**
* 跑一轮流式演绎。
* @param options - 文本流、合成函数与事件出口。
* @returns 最终整句、段数、成功出声的段数与记忆行。
*/
async function runSpeakPipeline(options) {
	const { chunks, synthesize, emit, signal } = options;
	const tasks = /* @__PURE__ */ new Map();
	let pumpIndex = 0;
	let audioCount = 0;
	let total = "";
	let result = "";
	let memory;
	/**
	* 串行下发链：所有「把音频发出去」的动作都挂在这条链上，
	* 于是同一时刻只会有一个 drain 在跑，不需要 `pumping` 标志位那种
	* 「已经在跑就直接返回」的写法——那种写法会让调用方的
	* `while (pumpIndex < nextIndex) await pump()` 变成空转的微任务死循环，
	* 把事件循环饿死（v0.4.3 的事故：DSH 所有请求一起卡住）。
	*/
	let chain = Promise.resolve();
	/** 按序把已就绪的音频发出去（后段先好也要等前段）；本函数自身不会再被重入。 */
	const drain = async () => {
		while (true) {
			const task = tasks.get(pumpIndex);
			if (!task) return;
			const index = pumpIndex;
			tasks.delete(index);
			const audio = await task;
			if (audio && !signal?.aborted) {
				audioCount += 1;
				emit("audio", {
					index,
					mime: audio.mime,
					data: audio.audio.toString("base64")
				});
			}
			pumpIndex = index + 1;
		}
	};
	/** 排队一次 drain；返回的是这条链的尾部，调用方可按需 await。 */
	const kick = () => {
		chain = chain.then(drain, drain);
		return chain;
	};
	/** 时间线：切段 + 把 cue 挂到对应的段上（ADR-047 P2，切分规则与旧实现逐字节一致）。 */
	const timeline = new ClauseTimeline();
	/** 把切好的段发出去并开始合成（先登记任务再启动，避免 pump 抢跑时任务还没进 Map）。 */
	const emitClauses = (clauses) => {
		for (const clause of clauses) {
			emit("clause", clause);
			const task = synthesize(clause.text).catch(() => null);
			tasks.set(clause.index, task);
			kick();
		}
	};
	for await (const chunk of chunks) {
		if (signal?.aborted) break;
		if (chunk.type === "delta") {
			emit("text", { delta: chunk.text });
			if (total.length < 400) {
				const room = 400 - total.length;
				const delta = chunk.text.slice(0, room);
				total += delta;
				emitClauses(timeline.push(delta));
			}
			continue;
		}
		if (chunk.type === "tags") {
			timeline.tag(chunk.expressions, chunk.motions);
			emit("tags", {
				expressions: chunk.expressions,
				motions: chunk.motions
			});
			continue;
		}
		if (chunk.type === "memory") {
			memory = chunk.note;
			emit("memory", { note: chunk.note });
			continue;
		}
		if (chunk.type === "done") {
			result = chunk.text;
			continue;
		}
		if (chunk.type === "error") {
			emitClauses(timeline.end());
			await kick();
			emit("error", { error: chunk.error });
			emit("done", { text: stripInlineTags(result || total) });
			return {
				text: stripInlineTags(result || total),
				clauses: timeline.length,
				audio: audioCount,
				memory
			};
		}
	}
	emitClauses(timeline.end());
	while (pumpIndex < timeline.length) {
		if (!tasks.has(pumpIndex)) {
			pumpIndex += 1;
			continue;
		}
		await kick();
	}
	emit("done", { text: stripInlineTags(result || total) });
	return {
		text: stripInlineTags(result || total),
		clauses: timeline.length,
		audio: audioCount,
		memory
	};
}
// src/index.ts
/**
* dsh-waifu host 半区：注册宠物服务、同源 HTTP 路由与插件私有设置。
*
* DSH 0.2.x 适配（ADR-013）：
* - `ctx.settings` 已从「namespace 注册表」变成「Config schema → 设置页表单」投影，
*   不再提供 register/get；写入会经 Loader 重新应用插件条目（整插件重载）。
* - 因此热设置（开关/尺寸/帧率/模型/人设/开发者选项）改存插件私有
*   `$DSH_HOME/waifu/settings.jsonc`（ADR-013），经 SSE 实时推送；
*   Config schema 只作为默认值 base 层，并用 `settings.configure({ auto: false })`
*   隐藏自动生成的设置页（插件自带「Waifu 设置」页）。
*
* ADR-037（全 AI 驱动）：固定对白与手动动作/表情映射全部移除，Host 只负责
* 场景打包（时间/事件/触摸类型/静默超时）→ LLM（人设+记忆+历史+目录）
* → 解析输出（标签流式：[表情][动作] 台词 + [记] 记忆行）→ 控制角色 + 落盘记忆。
* @module dsh-waifu
*/
/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
const name = "dsh-waifu";
const Config = Schema.object({
	enabled: Schema.boolean().default(DEFAULT_SETTINGS.enabled),
	size: Schema.number().min(40).max(400).default(DEFAULT_SETTINGS.size),
	maxFps: Schema.union([
		Schema.const(30),
		Schema.const(60),
		Schema.const(0)
	]).default(30),
	model: Schema.string().default(defaultModelId()),
	developerMode: Schema.boolean().default(DEFAULT_SETTINGS.developerMode),
	debug: Schema.boolean().default(DEFAULT_SETTINGS.debug),
	showTapZones: Schema.boolean().default(DEFAULT_SETTINGS.showTapZones),
	canvasPadX: Schema.number().min(0).max(300).default(125),
	canvasPadY: Schema.number().min(0).max(300).default(50),
	homeRight: Schema.number().min(0).max(100).default(10),
	homeBottom: Schema.number().min(0).max(100).default(0),
	bubbleOffsetX: Schema.number().min(-1e3).max(1e3).default(0),
	bubbleOffsetY: Schema.number().min(-1e3).max(1e3).default(24),
	bubbleBgColor: Schema.string().default(DEFAULT_BUBBLE_BG_COLOR),
	bubbleBgOpacity: Schema.number().min(0).max(100).default(92),
	/** 气泡最长连续可见秒数（0 = 不限）；默认 10。 */
	bubbleMaxSeconds: Schema.number().min(0).max(600).default(10),
	bubbleTextColor: Schema.string().default(DEFAULT_BUBBLE_TEXT_COLOR),
	/** AI 驱动总开关（ADR-037）：关闭后角色完全静默（无固定台词可回落）。 */
	aiEnabled: Schema.boolean().default(DEFAULT_SETTINGS.aiEnabled),
	/** 待机小动作：每隔十几秒随机来一个微动作，避免像定格动画。 */
	idleMotionEnabled: Schema.boolean().default(DEFAULT_SETTINGS.idleMotionEnabled),
	aiProvider: Schema.string().default(DEFAULT_AI_PROVIDER),
	aiModel: Schema.string().default(DEFAULT_AI_MODEL),
	/** 注入到 prompt 的最近对话轮数（1 轮 = 一问一答；0 = 不注入；ADR-030）。 */
	aiHistoryCount: Schema.number().min(0).max(50).default(20),
	/** 注入到 prompt 的最近记忆条数（0 = 不注入；ADR-037）。 */
	aiMemoryCount: Schema.number().min(0).max(100).default(20),
	/** 新触发的处理方式：interrupt = 掐掉上一轮立刻反应，queue = 等上一轮说完再反应（ADR-037）。 */
	triggerMode: Schema.union([Schema.const("interrupt"), Schema.const("queue")]).default(DEFAULT_TRIGGER_MODE),
	/** 事件类触发的最小间隔（秒，0 = 不限制；触摸/对话不受限；ADR-037）。 */
	aiMinIntervalSec: Schema.number().min(0).max(600).default(1),
	/** 静默超时（秒，0 = 关闭）：多久没有任何事件/互动就自动让角色说一句话（ADR-037）。 */
	idleTimeoutSec: Schema.number().min(0).max(3600).default(600),
	/** 同类 DSH 事件的触发窗口（秒）：窗口内同类事件并进合并队列（ADR-047）。 */
	activityWindowSec: Schema.number().min(0).max(300).default(10),
	/** 触摸连点窗口（毫秒，0 = 不合并）：窗口内的连续触摸只保留最后一次（ADR-047）。 */
	tapGapMs: Schema.number().min(TAP_GAP_LIMITS.min).max(TAP_GAP_LIMITS.max).default(DEFAULT_TAP_GAP_MS),
	/** 合并上限（条）：一轮场景句里最多拼进多少条被压下的触发（ADR-047）。 */
	mergeMax: Schema.number().min(MERGE_MAX_LIMITS.min).max(MERGE_MAX_LIMITS.max).default(6),
	/** 交互条贴在模型上方 / 下方，或干脆不显示（静音 + 对话输入）。 */
	barPosition: Schema.union([
		Schema.const("top"),
		Schema.const("bottom"),
		Schema.const("hidden")
	]).default("top"),
	/** 交互条沿吸附边的额外偏移（px，正数远离模型）。 */
	barOffset: Schema.number().min(BAR_OFFSET_LIMITS.min).max(BAR_OFFSET_LIMITS.max).default(-30),
	ttsEnabled: Schema.boolean().default(DEFAULT_SETTINGS.ttsEnabled),
	ttsModel: Schema.string().default(DEFAULT_SETTINGS.ttsModel),
	ttsVoice: Schema.string().default(DEFAULT_SETTINGS.ttsVoice),
	lipsyncEnabled: Schema.boolean().default(DEFAULT_SETTINGS.lipsyncEnabled),
	lipsyncGain: Schema.number().min(LIPSYNC_GAIN_LIMITS.min).max(LIPSYNC_GAIN_LIMITS.max).default(DEFAULT_SETTINGS.lipsyncGain),
	focusRange: Schema.number().min(FOCUS_RANGE_LIMITS.min).max(FOCUS_RANGE_LIMITS.max).default(DEFAULT_SETTINGS.focusRange)
});
/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 驱动，ADR-037）。 */
const inject = [
	"webServer",
	"settings",
	"llm",
	"credentials"
];
/** 注册宠物服务、设置 API 与素材路由。 */
function apply(ctx, config) {
	ctx.effect(() => ctx.settings.configure({ auto: false }), "waifu: settings page policy");
	const settingsStore = new SettingsStore({
		enabled: config.enabled,
		size: config.size,
		maxFps: config.maxFps,
		model: config.model,
		developerMode: config.developerMode,
		debug: config.debug,
		showTapZones: config.showTapZones,
		canvasPadX: config.canvasPadX,
		canvasPadY: config.canvasPadY,
		homeRight: config.homeRight,
		homeBottom: config.homeBottom,
		bubbleOffsetX: config.bubbleOffsetX,
		bubbleOffsetY: config.bubbleOffsetY,
		bubbleBgColor: config.bubbleBgColor,
		bubbleBgOpacity: config.bubbleBgOpacity,
		bubbleMaxSeconds: config.bubbleMaxSeconds,
		bubbleTextColor: config.bubbleTextColor,
		aiEnabled: config.aiEnabled,
		idleMotionEnabled: config.idleMotionEnabled,
		aiProvider: config.aiProvider,
		aiModel: config.aiModel,
		aiHistoryCount: config.aiHistoryCount,
		aiMemoryCount: config.aiMemoryCount,
		triggerMode: config.triggerMode,
		aiMinIntervalSec: config.aiMinIntervalSec,
		idleTimeoutSec: config.idleTimeoutSec,
		activityWindowSec: config.activityWindowSec,
		tapGapMs: config.tapGapMs,
		mergeMax: config.mergeMax,
		eventTriggers: defaultEventTriggers(),
		eventTexts: {},
		motionTexts: {},
		expressionTexts: {},
		motionEnabled: {},
		expressionEnabled: { ...DEFAULT_SETTINGS.expressionEnabled },
		barPosition: config.barPosition,
		barOffset: config.barOffset,
		ttsEnabled: config.ttsEnabled,
		ttsModel: config.ttsModel,
		ttsVoice: config.ttsVoice,
		lipsyncEnabled: config.lipsyncEnabled,
		lipsyncGain: config.lipsyncGain,
		focusRange: config.focusRange
	});
	const service = new PetService(ctx, () => settingsStore.get(), new TouchPartsStore());
	const settingsApi = {
		view: () => settingsStore.view(),
		write: async (ops) => {
			const view = settingsStore.applyOps(ops);
			service.notifyConfigChanged();
			return view;
		}
	};
	const waifuHome = dirname(settingsStore.path);
	const memoryApi = {
		read: () => ({
			text: loadMemory(waifuHome).text,
			path: memoryPath(waifuHome)
		}),
		write: (text) => saveMemory(waifuHome, text)
	};
	let aiHistory = [];
	let lastAiPayload = null;
	let lastTtsPayload = null;
	let lastSpeakPayload = null;
	/**
	* AI 触发的公共前置（/interact 与 /speak 共用）：开关 → 时区归一化。
	* 触发频率策略（interrupt/queue / 各种窗口）全在客户端调度器里执行（ADR-047）：
	* Host 只是传感器与转发层，不按频率拒绝、也不替角色做任何状态推导。
	*/
	const beginAiTurn = (input) => {
		const settings = settingsStore.get();
		if (!settings.aiEnabled) return {
			ok: false,
			error: "ai-disabled"
		};
		const tz = normalizeTimeZone(input.tz);
		return {
			ok: true,
			settings,
			context: {
				kind: input.kind,
				part: input.part,
				interaction: input.interaction,
				event: input.event,
				text: input.text,
				merged: input.merged,
				tz
			}
		};
	};
	/** 两个入口共用的请求参数（provider/model/人设+记忆/历史注入）。 */
	const aiRequest = (settings, context, onPayload, signal, onReply) => {
		const memories = loadMemory(waifuHome).entries;
		return {
			provider: settings.aiProvider,
			model: settings.aiModel,
			persona: loadPersona(waifuHome),
			memory: memoryContext(memories, settings.aiMemoryCount),
			context,
			eventTexts: settings.eventTexts,
			catalog: {
				motionTexts: settings.motionTexts,
				expressionTexts: settings.expressionTexts,
				motionEnabled: settings.motionEnabled,
				expressionEnabled: settings.expressionEnabled
			},
			history: aiHistory,
			historyCount: settings.aiHistoryCount,
			onPayload,
			onReply,
			signal
		};
	};
	/** 记忆落盘（ADR-037）：AI 输出的 [记] 行追加进 memory.md（带时间戳，用触发方时区）。 */
	const rememberNote = (note, tz) => {
		const trimmed = note.trim();
		if (!trimmed) return;
		appendMemory(waifuHome, trimmed, tz);
	};
	/** 只记录成功的往来：失败的请求不该污染上下文；场景描述不携带参考台词（ADR-030/037）。 */
	const recordAiTurn = (context, text, settings) => {
		const at = Date.now();
		aiHistory = appendHistory(aiHistory, {
			role: "user",
			text: historySceneText(context, settings.eventTexts),
			at
		});
		aiHistory = appendHistory(aiHistory, {
			role: "assistant",
			text,
			at: Date.now(),
			provider: settings.aiProvider,
			model: settings.aiModel
		}, AI_HISTORY_MAX_ENTRIES);
	};
	const aiApi = { reply: async (input) => {
		const turn = beginAiTurn(input);
		if (!turn.ok) return {
			ok: false,
			error: turn.error
		};
		const trace = [];
		const attempt = await generateReply(ctx.llm, aiRequest(turn.settings, turn.context, (payload) => {
			lastAiPayload = payload;
			trace.push(traceStep("llm.request", payload));
		}, void 0, (reply) => {
			trace.push(traceStep("llm.reply", reply));
		}));
		if (attempt.text) {
			recordAiTurn(turn.context, attempt.text, turn.settings);
			if (attempt.memory) rememberNote(attempt.memory, input.tz);
			return {
				ok: true,
				text: attempt.text,
				expressions: attempt.expressions,
				motions: attempt.motions,
				memory: attempt.memory,
				trace
			};
		}
		return {
			ok: false,
			error: `no-reply: ${attempt.error ?? "unknown"}`,
			trace
		};
	} };
	const aiSettingsApi = {
		debug: () => ({
			history: aiHistory,
			historyCount: settingsStore.get().aiHistoryCount,
			lastPayload: lastAiPayload,
			lastTtsPayload,
			lastSpeakPayload
		}),
		options: async () => {
			const providers = ctx.llm.listProviders().map((p) => ({
				id: p.id,
				name: p.name
			}));
			const models = {};
			for (const provider of providers) try {
				models[provider.id] = (await ctx.llm.listModels(provider.id)).map((m) => ({
					id: m.id,
					name: m.name
				}));
			} catch {
				models[provider.id] = [];
			}
			return {
				providers,
				models
			};
		},
		readPersona: () => {
			return {
				text: loadPersona(waifuHome),
				path: personaPath(waifuHome)
			};
		},
		writePersona: (text) => savePersona(waifuHome, text),
		check: async (input) => {
			const settings = settingsStore.get();
			const attempt = await generateReply(ctx.llm, {
				provider: input?.provider || settings.aiProvider,
				model: input?.model || settings.aiModel,
				persona: loadPersona(waifuHome),
				memory: memoryContext(loadMemory(waifuHome).entries, settings.aiMemoryCount),
				context: {
					kind: "tap",
					part: "脸",
					interaction: "轻碰"
				},
				timeoutMs: 2e4
			});
			if (attempt.text) return {
				ok: true,
				text: attempt.text
			};
			return {
				ok: false,
				error: attempt.error ?? "unknown"
			};
		}
	};
	const credentials = ctx.credentials;
	const resolveOpenRouterKey = async () => {
		if (!credentials) return void 0;
		try {
			return (await credentials.resolve("OPENROUTER_API_KEY"))?.value;
		} catch {
			return;
		}
	};
	const ttsEngine = new OpenRouterTtsEngine(resolveOpenRouterKey, waifuHome, fetch, OPENROUTER_SPEECH_URL);
	const voiceOptions = () => {
		const settings = settingsStore.get();
		return {
			model: settings.ttsModel,
			voice: settings.ttsVoice.trim() || void 0
		};
	};
	const speakApi = {
		synthesize: async (text) => {
			const audio = await ttsEngine.synthesize(text, voiceOptions(), void 0, (payload) => {
				lastTtsPayload = payload;
			});
			return {
				mime: audio.mime,
				audio: audio.audio
			};
		},
		stream: async (input, emit, signal) => {
			const turn = beginAiTurn(input);
			if (!turn.ok) {
				emit("error", { error: turn.error });
				return;
			}
			const { settings, context } = turn;
			const speakOn = settings.ttsEnabled && settings.ttsModel.trim().length > 0;
			const chunks = streamReply(ctx.llm, aiRequest(settings, context, (payload) => {
				lastAiPayload = payload;
				emit("debug", traceStep("llm.request", payload));
			}, signal, (reply) => {
				emit("debug", traceStep("llm.reply", reply));
			}));
			const speakOptions = voiceOptions();
			const synthesize = async (text) => {
				if (!speakOn || signal.aborted) return null;
				const startedAt = Date.now();
				try {
					const audio = await ttsEngine.synthesize(text, speakOptions, signal, (payload) => {
						lastSpeakPayload = payload;
						emit("debug", traceStep("tts.request", payload));
					});
					emit("debug", traceStep("tts.reply", {
						ok: true,
						bytes: audio.audio.length,
						mime: audio.mime,
						cached: audio.cached,
						ms: Date.now() - startedAt
					}));
					return audio;
				} catch (error) {
					emit("debug", traceStep("tts.reply", {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
						ms: Date.now() - startedAt
					}));
					return null;
				}
			};
			const result = await runSpeakPipeline({
				chunks,
				synthesize,
				emit,
				signal
			});
			if (result.text) recordAiTurn(context, result.text, settings);
			if (result.memory) rememberNote(result.memory, input.tz);
		}
	};
	ctx.effect(() => {
		const openStreams = /* @__PURE__ */ new Set();
		const disposers = makePetRoutes({
			service,
			packageRoot: petPackageRoot(import.meta.url),
			settings: settingsApi,
			ai: aiApi,
			aiSettings: aiSettingsApi,
			memory: memoryApi,
			speak: speakApi,
			onStream: (close) => {
				openStreams.add(close);
				return () => {
					openStreams.delete(close);
				};
			}
		}).map((route) => ctx.webServer.register(route));
		return () => {
			for (const close of openStreams) close();
			for (const dispose of disposers) dispose();
		};
	}, "waifu: routes");
}
export { AI_MOTIONS, AI_MOTION_IDS, ANIMATION_SLOTS, Config, DEFAULT_TOUCH_PARTS, MAX_BOXES_PER_PART, PET_API_PREFIX, PET_ASSET_PREFIX, PetService, apply, defaultModelId, hitTestTouchParts, inject, isMotionId, listBuiltinPresets, makePetRoutes, name, normalizeTouchBox, normalizeTouchParts, petPackageRoot, pointToBoundsRatio, resolveDefaultTouchParts, resolveModelUrl };
