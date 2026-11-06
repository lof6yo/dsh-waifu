import { dirname, join, sep } from "node:path";
import Schema from "@deepseek-ai/schemastery";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// src/models.ts
/** 全部状态动画映射槽位（设置页表单 / 默认映射共用）。 */
const ANIMATION_SLOTS = [
	"idle",
	"thinking",
	"error",
	"done",
	"waiting",
	"delivered"
];
/** 默认动画映射：动作组 + 表情混选（表情 id 与动作组同列存放，见 MotionSelection）。 */
const DEFAULT_MOTION_MAP = {
	idle: ["Idle"],
	thinking: ["Tilt"],
	error: [
		"ShakeHead",
		"whites",
		"dark"
	],
	done: ["Nod", "star"],
	waiting: ["Sway"],
	delivered: ["Tilt", "star"]
};
/** 全部内置表情（设置页下拉、事件绑定、触摸部位共用；`none` 表示恢复无表情）。 */
const EXPRESSIONS = [
	{
		id: "none",
		name: "无",
		params: {}
	},
	{
		id: "blush",
		name: "脸红",
		params: { ParamSwitch2: 1 },
		exclusive: "skin"
	},
	{
		id: "angry",
		name: "生气",
		params: { ParamSwitch4: 1 }
	},
	{
		id: "star",
		name: "星星眼",
		params: { ParamSwitch5: 1 },
		exclusive: "eye"
	},
	{
		id: "whites",
		name: "白眼",
		params: { ParamSwitch6: 1 },
		exclusive: "eye"
	},
	{
		id: "tear",
		name: "泪花",
		params: { ParamSwitch7: 1 },
		exclusive: "eye"
	},
	{
		id: "heart",
		name: "爱心眼",
		params: { ParamSwitch8: 1 },
		exclusive: "eye"
	},
	{
		id: "cry",
		name: "眼泪",
		params: { ParamSwitch9: 1 },
		exclusive: "eye"
	},
	{
		id: "dark",
		name: "脸黑",
		params: { ParamSwitch1: 1 },
		exclusive: "skin"
	},
	{
		id: "blood",
		name: "血",
		params: { ParamSwitch3: 1 },
		exclusive: "skin"
	},
	{
		id: "dim",
		name: "高光消失",
		params: { ParamSwitch21: 1 }
	}
];
/** 表情的互斥组（没有则返回空串 = 可自由叠加）。 */
function expressionExclusiveGroup(id) {
	return EXPRESSIONS.find((expression) => expression.id === id)?.exclusive ?? "";
}
/** 可选表情 id（不含 `none`）。 */
const EXPRESSION_IDS = EXPRESSIONS.filter((expression) => expression.id !== "none").map((expression) => expression.id);
/** 表情 id 是否合法（未知 id 回退 `none`）。 */
function normalizeExpressionId(value) {
	if (typeof value !== "string") return "none";
	const id = value.trim();
	return EXPRESSIONS.some((expression) => expression.id === id) ? id : "none";
}
/** 该名字是否是表情 id（「动作组」混选列表里靠它区分动作与表情）。 */
function isExpressionId(value) {
	return EXPRESSION_IDS.includes(value.trim());
}
/**
* 拆解混选数组：第一个非表情名当动作组，其余都当表情；
* 同一互斥组里后出现的替换先出现的，重复项只留最后一个。
*/
function splitMotionSelection(list) {
	let motion = "";
	const expressions = [];
	for (const raw of list) {
		if (typeof raw !== "string") continue;
		const id = raw.trim();
		if (!id) continue;
		if (!isExpressionId(id)) {
			if (!motion) motion = id;
			continue;
		}
		const group = expressionExclusiveGroup(id);
		for (let i = expressions.length - 1; i >= 0; i -= 1) {
			const other = expressions[i];
			if (other === id) {
				expressions.splice(i, 1);
				continue;
			}
			if (group && expressionExclusiveGroup(other) === group) expressions.splice(i, 1);
		}
		expressions.push(id);
	}
	return {
		motion,
		expressions
	};
}
/** 由动作组 + 表情列表拼出混选数组（顺序固定：动作组在前，空项省略）。 */
function joinMotionSelection(motion, expressions) {
	const out = [];
	const name = typeof motion === "string" ? motion.trim() : "";
	if (name) out.push(name);
	for (const raw of expressions) {
		if (typeof raw !== "string") continue;
		const expr = normalizeExpressionId(raw);
		if (expr !== "none" && !out.includes(expr)) out.push(expr);
	}
	return out;
}
/** 归一化混选数组（动作组最多 1 项、表情按互斥组收敛；非数组返回空）。 */
function normalizeMotionSelection(raw) {
	if (!Array.isArray(raw)) return [];
	const { motion, expressions } = splitMotionSelection(raw);
	return joinMotionSelection(motion, expressions);
}
/** 全部宠物事件（设置页「事件绑定」顺序）。 */
const PET_EVENTS = ANIMATION_SLOTS;
/** 长状态（思考/等确认）：入态台词常驻，之后由 AI 演绎按节奏刷新（ADR-026）。 */
const LONG_STATES = ["thinking", "waiting"];
/** 是否长状态：气泡常驻、台词可被 AI 反复演绎替换。 */
function isLongState(state) {
	return LONG_STATES.includes(state);
}
/** 长状态 AI 演绎的默认节奏（delay/interval 单位秒，max 为每次入态最多演绎次数）。 */
const DEFAULT_LONG_AI = {
	thinking: {
		delay: 5,
		interval: 10,
		max: 3
	},
	waiting: {
		delay: 5,
		interval: 20,
		max: 3
	}
};
/** 长状态 AI 演绎节奏的取值范围（设置页滑杆/校验共用）。 */
const LONG_AI_LIMITS = {
	delay: {
		min: 0,
		max: 120
	},
	interval: {
		min: 5,
		max: 600
	},
	max: {
		min: 1,
		max: 10
	}
};
/**
* 默认事件绑定：中性口吻的默认台词（不再有固定人设；后续可由 LLM 人设提示词接管）。
* motions 末位的表情 id（angry/star/heart）与动作组同时触发。
*/
const DEFAULT_EVENT_BINDINGS = {
	idle: {
		motions: ["Idle"],
		lines: [[
			"（安静地待着）",
			"……在的。",
			"有什么要做的吗？"
		]]
	},
	thinking: {
		motions: ["Tilt"],
		lines: [["思考中…"]]
	},
	error: {
		motions: [
			"ShakeHead",
			"whites",
			"dark"
		],
		lines: [["出错了…"]]
	},
	done: {
		motions: ["Nod", "star"],
		lines: [["搞定！"]]
	},
	delivered: {
		motions: ["Tilt", "star"],
		lines: [["交付！"]]
	},
	waiting: {
		motions: ["Sway"],
		lines: [["喂，你定一下啦！"]]
	}
};
/**
* 归一化单个事件绑定：motions 收敛为「动作组 + 表情」混选（旧版 `expression` 字段并入）；
* lines 只保留**入态**一组（ADR-026 取消多阶段固定台词，其余阶段丢弃；旧文件的多阶段
* 二维数组取第一组）。
*/
function normalizeEventBinding(raw) {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw;
	const legacyExpression = normalizeExpressionId(record.expression);
	const motions = normalizeMotionSelection([...Array.isArray(record.motions) ? record.motions : [], ...legacyExpression === "none" ? [] : [legacyExpression]]);
	const rawLines = Array.isArray(record.lines) ? record.lines : [];
	const lines = [];
	for (const pool of rawLines) {
		if (!Array.isArray(pool)) continue;
		const cleaned = [...new Set(pool.filter((line) => typeof line === "string" && line.trim().length > 0).map((line) => line.trim().slice(0, 120)).slice(0, 20))];
		lines.push(cleaned);
		break;
	}
	if (lines.length === 0) lines.push([]);
	return {
		motions,
		lines
	};
}
/** 归一化用户事件绑定（只保留合法事件键；缺失事件不出现，由调用方回退默认/内置）。 */
function normalizeEventBindings(raw) {
	const out = {};
	if (typeof raw !== "object" || raw === null) return out;
	const record = raw;
	for (const event of PET_EVENTS) {
		const binding = normalizeEventBinding(record[event]);
		if (binding) out[event] = binding;
	}
	return out;
}
/** 合并事件绑定：base 为默认/内置，override 为用户覆盖（整事件替换，阶段数可不同）。 */
function mergeEventBindings(base, override) {
	const out = {};
	for (const event of PET_EVENTS) out[event] = override?.[event] ?? base[event];
	return out;
}
/** 无默认触摸部位时的空表（用户未创建部位 → 点击不触发互动，spec §4）。 */
const DEFAULT_TOUCH_PARTS = [];
/** 单个部位最多 box 数（防止配置失控；设置页同步限制）。 */
const MAX_BOXES_PER_PART = 12;
/** 部位 id 合法形式（保存时生成，仅用于持久化与映射键）。 */
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
* 供 Host 存储与设置页保存共用（纯函数，client 可安全打包）。
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
		const legacyExpression = normalizeExpressionId(record.expression);
		const motions = normalizeMotionSelection([...Array.isArray(record.motions) ? record.motions : [], ...legacyExpression === "none" ? [] : [legacyExpression]]);
		const rawLines = Array.isArray(record.lines) ? record.lines.filter((line) => typeof line === "string" && line.trim().length > 0).map((line) => line.trim().slice(0, 120)).slice(0, 30) : [];
		const lines = [...new Set(rawLines)];
		seen.add(id);
		const part = {
			id,
			name,
			boxes,
			motions
		};
		if (lines.length > 0) part.lines = lines;
		out.push(part);
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
* 触摸命中判定（spec §4）：按**图层顺序**（parts 数组顺序，第 0 项最上层）遍历，
* 返回第一个命中任意 box 的部位；box 重叠时上层部位生效，不再按面积比较。
* 未命中返回 null。
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
// src/models-host.ts
/**
* Host 侧模型清单读取与解析：内置 presets.jsonc（JSONC 支持注释）由 Node 读取。
* 本模块不可被 client 打包引入（依赖 node:fs / node:path / node:url）。
* 共享类型与默认值见 `models.ts`。
* @module dsh-waifu/models-host
*/
/** 简易 JSONC 解析：去掉行注释和块注释（字符串内的注释保留）后 JSON.parse。 */
function parseJsonc(text) {
	let out = "";
	let inString = false;
	let quote = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (inString) {
			out += ch;
			if (ch === "\\") {
				out += next ?? "";
				i++;
			} else if (ch === quote) inString = false;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			inString = true;
			quote = ch;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i++;
			continue;
		}
		out += ch;
	}
	return JSON.parse(out);
}
/** 包根目录（从本模块位置解析：源码测试时指向仓库根，构建后 lib/ 的上一级即包根）。 */
function packageRoot() {
	return fileURLToPath(new URL("../", import.meta.url));
}
const presetsData = parseJsonc(readFileSync(join(packageRoot(), "src/presets/presets.jsonc"), "utf8"));
/** 内置策展清单（只读，来自 presets.jsonc）。 */
function listBuiltinPresets() {
	return presetsData.presets;
}
/** 默认内置模型 id（presets.jsonc 第一条；配置里的旧模型 id 失配时也回退到它）。 */
function defaultModelId() {
	return presetsData.presets[0]?.id ?? "jian";
}
/**
* 按当前模型解析生效状态动画映射：内置 preset 的 animationMap 覆盖默认映射。
* 只做浅合并：配置过的槽位覆盖，未配置槽位沿用默认。
*/
function resolveMotionMap(model) {
	const preset = presetsData.presets.find((p) => p.id === model);
	if (preset?.animationMap) return {
		...DEFAULT_MOTION_MAP,
		...preset.animationMap
	};
	return { ...DEFAULT_MOTION_MAP };
}
/**
* 按当前选中模型解析「默认触摸部位」（内置 preset 随包提供的默认值）：
* 用户保存过自定义部位时由 TouchPartsStore 覆盖，这里只给回退值。
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
* @module dsh-waifu/defaults
*/
/** 显示/位置持久化默认值（`$DSH_HOME/waifu.json`，px 相对视口右下角）。 */
const DEFAULT_DISPLAY = {
	right: 24,
	bottom: 20,
	size: 300
};
const DEFAULT_BUBBLE_BG_COLOR = "#ffffff";
const DEFAULT_BUBBLE_TEXT_COLOR = "#222222";
/** AI 回复默认路由（DSH 已配置的 provider / 模型，ADR-025）。 */
const DEFAULT_AI_PROVIDER = "openrouter";
const DEFAULT_AI_MODEL = "google/gemma-4-31b-it";
/** 引擎 id（目前只有 openrouter；留给将来直连 ElevenLabs / MiniMax 的实现）。 */
const DEFAULT_TTS_ENGINE = "openrouter";
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
/** 默认 TTS 模型：通义千问 TTS Plus（旗舰音色）。 */
const DEFAULT_TTS_MODEL = "qwen/qwen-audio-3.0-tts-flash";
/** 默认音色：Flash 的「龙安小昕」（22 岁·亲切活泼）。 */
const DEFAULT_TTS_VOICE = "longanxiaoxin";
/** 按 id 查模型选项。 */
function ttsModelOption(id) {
	return TTS_MODELS.find((item) => item.id === id);
}
/** 该模型是否每次随机音色。 */
function ttsModelRandomVoice(id) {
	return ttsModelOption(id)?.randomVoice === true;
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
/**
* 打断优先级（ADR-032）：状态事件与触摸互动抢占同一套「气泡 + 动作 + AI 演绎」通道时的规则。
* - `mutual`：互相打断——触摸立刻接管，状态一变也立刻收回；
* - `touch-first`：触摸优先——触摸期间状态事件不改气泡、不恢复演绎（默认）；
* - `event-first`：事件优先——长状态演绎不被触摸打断，触摸只播动作/表情与 AI 台词。
*/
const INTERACTION_MODES = [
	"mutual",
	"touch-first",
	"event-first"
];
const DEFAULT_INTERACTION_MODE = "touch-first";
/** 交互条（模型上方/下方的静音按钮 + 对话输入框）的位置：上方 `top` / 下方 `bottom`。 */
const BAR_POSITIONS = [
	"top",
	"bottom",
	"hidden"
];
const DEFAULT_BAR_POSITION = "bottom";
const BAR_OFFSET_LIMITS = {
	min: -200,
	max: 200
};
/** 归一化交互条位置：未知值回退默认。 */
function normalizeBarPosition(value, fallback) {
	return BAR_POSITIONS.includes(value) ? value : fallback;
}
/** 归一化打断优先级：未知值回退默认。 */
function normalizeInteractionMode(value, fallback) {
	return INTERACTION_MODES.includes(value) ? value : fallback;
}
/**
* 标量设置默认值（除 `model`：模型 id 由内置 preset 目录动态决定）。
* 与 `Config` schema 的 `.default()`、设置页 `DEFAULT_VALUE` 保持逐项一致。
*/
const DEFAULT_SETTINGS = {
	enabled: true,
	size: DEFAULT_DISPLAY.size,
	maxFps: 30,
	developerMode: false,
	debug: false,
	showTapZones: false,
	canvasPadX: 125,
	canvasPadY: 50,
	homeRight: 12,
	homeBottom: 31,
	bubbleOffsetX: 0,
	bubbleOffsetY: -15,
	bubbleBgColor: DEFAULT_BUBBLE_BG_COLOR,
	bubbleBgOpacity: 92,
	bubbleMaxSeconds: 30,
	bubbleTextColor: DEFAULT_BUBBLE_TEXT_COLOR,
	aiEnabled: true,
	aiTouchOnly: false,
	/** 全 AI 接管：不显示任何预置对白，气泡全靠模型；长状态延迟失效、入态即请求（ADR-031）。 */
	aiTakeover: true,
	aiProvider: DEFAULT_AI_PROVIDER,
	aiModel: DEFAULT_AI_MODEL,
	aiHistoryCount: 20,
	interactionMode: DEFAULT_INTERACTION_MODE,
	/** 交互条：模型上下的静音按钮 + 对话输入框。 */
	barPosition: DEFAULT_BAR_POSITION,
	barOffset: 0,
	ttsEnabled: true,
	ttsEngine: DEFAULT_TTS_ENGINE,
	ttsModel: DEFAULT_TTS_MODEL,
	ttsVoice: DEFAULT_TTS_VOICE,
	lipsyncEnabled: true,
	lipsyncGain: 140
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
/** 文件头注释：每次写回时保留，提示用户这是插件私有配置。 */
const TOUCH_PARTS_HEADER = `// 触摸部位配置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/touch-parts.jsonc
// 建议通过设置页「触摸部位」编辑；直接编辑后刷新页面即可生效。
// 结构：models[<模型 id>].parts[] = { id, name, boxes[{left,top,right,bottom}], motions[] }
// left/top/right/bottom 为相对模型包围盒的 0–1 归一化坐标（左上右下）。`;
function serializeTouchParts(models) {
	return `${TOUCH_PARTS_HEADER}\n${JSON.stringify({
		version: 1,
		models
	}, null, 2)}\n`;
}
const TOUCH_PARTS_TEMPLATE = serializeTouchParts({});
/** 旧格式 animationMap（状态 → 动作组）→ events（只填动作组）。 */
function normalizeLegacyMotionMap(raw) {
	const out = {};
	if (typeof raw !== "object" || raw === null) return out;
	const record = raw;
	for (const [event, value] of Object.entries(record)) {
		if (!Array.isArray(value)) continue;
		const motions = [...new Set(value.filter((m) => typeof m === "string" && m.trim().length > 0).map((m) => m.trim()))];
		if (motions.length === 0) continue;
		out[event] = {
			motions,
			lines: [[]]
		};
	}
	return out;
}
/** 归一化「模型 id → 部位列表」映射（丢弃空值/非法结构）。 */
function normalizeModelMap(raw) {
	const out = {};
	if (typeof raw !== "object" || raw === null) return out;
	for (const [modelId, value] of Object.entries(raw)) {
		if (!modelId.trim() || typeof value !== "object" || value === null) continue;
		const record = value;
		const entry = { parts: normalizeTouchParts(record.parts) };
		const events = normalizeEventBindings(record.events);
		if (Object.keys(events).length > 0) entry.events = events;
		else if (record.animationMap && typeof record.animationMap === "object") {
			const legacy = normalizeLegacyMotionMap(record.animationMap);
			if (Object.keys(legacy).length > 0) entry.events = legacy;
		}
		out[modelId] = entry;
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
	/**
	* 写回某个模型的部位列表 +（可选）事件绑定覆盖（设置页保存用；保留文件头注释）。
	* events 传 undefined 表示不改动已有覆盖；传 {} 表示清空覆盖（回到内置/自定义默认）。
	*/
	save(modelId, parts, events) {
		const id = modelId.trim();
		if (!id) throw new Error("model id 不能为空");
		const view = this.load();
		const previous = view.models[id];
		const entry = { parts: normalizeTouchParts(parts) };
		const mergedEvents = events === void 0 ? previous?.events : normalizeEventBindings(events);
		if (mergedEvents && Object.keys(mergedEvents).length > 0) entry.events = mergedEvents;
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
			const status = payload?.status;
			if (!status) return;
			this.agent = String(status);
			if (status === "running") this.set("thinking");
			else if (status === "idle" && this.state !== "done" && this.state !== "delivered") this.set("idle");
		});
		ctx.on("agent/error", () => this.set("error"));
		ctx.on("agent/turn-stopping", () => {
			if (this.state !== "delivered") this.setDone();
		});
		ctx.on("approval/request", (_req, next) => {
			this.set("waiting");
			return next();
		});
		ctx.on("user-questions/request", (_request, next) => {
			this.set("waiting");
			return next?.();
		});
		ctx.on("session/event", (_session, event) => {
			if (event?.type === "deliverables/presented") this.setDelivered();
		});
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
	/**
	* 当前模型生效的事件绑定：内置默认台词 + 模型动作组（preset/自定义 animationMap），
	* 再叠加用户在该模型上的覆盖（touch-parts.jsonc 的 events；整事件替换）。
	*/
	effectiveEvents(model) {
		const resolvedMotions = resolveMotionMap(model);
		const base = {};
		for (const event of PET_EVENTS) {
			const fallback = DEFAULT_EVENT_BINDINGS[event];
			base[event] = {
				motions: resolvedMotions[event] ?? fallback.motions,
				lines: fallback.lines
			};
		}
		const override = this.touchPartsStore?.load().models[model]?.events;
		return mergeEventBindings(base, override);
	}
	/** 浏览器轮询用的状态快照（配置实时读取设置文件快照，spec §2）。 */
	snapshot() {
		const settings = this.getSettings();
		return {
			state: this.state,
			agent: this.agent,
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
				aiTouchOnly: settings.aiTouchOnly,
				aiTakeover: settings.aiTakeover,
				interactionMode: settings.interactionMode,
				barPosition: settings.barPosition,
				barOffset: settings.barOffset,
				aiProvider: settings.aiProvider,
				aiModel: settings.aiModel,
				aiHistoryCount: settings.aiHistoryCount,
				thinkingAiDelay: settings.thinkingAiDelay,
				thinkingAiInterval: settings.thinkingAiInterval,
				thinkingAiMax: settings.thinkingAiMax,
				waitingAiDelay: settings.waitingAiDelay,
				waitingAiInterval: settings.waitingAiInterval,
				waitingAiMax: settings.waitingAiMax,
				ttsEnabled: settings.ttsEnabled,
				ttsModel: settings.ttsModel,
				ttsVoice: settings.ttsVoice,
				lipsyncEnabled: settings.lipsyncEnabled,
				lipsyncGain: settings.lipsyncGain,
				events: this.effectiveEvents(settings.model),
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
	/** 写回某个模型的触摸部位（+ 可选事件绑定覆盖）并推送（设置页保存后调用；spec §4）。 */
	saveTouchParts(model, parts, events) {
		const view = this.touchPartsStore?.save(model, parts, events) ?? {
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
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
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
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			run().then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
function postRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "POST")) return Promise.resolve();
			return readJsonBody(req).then((body) => {
				return run(typeof body === "object" && body !== null ? body : {}).then((value) => json(res, 200, value), (error) => json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				}));
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/**
* 同一 path 上挂 GET + POST（webServer 按 path 唯一注册，不按 method 分表；
* 见 dsh-host-webserver register：duplicate exact route）。
*/
function getPostRoute(path, get, post) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (req.method === "GET") return Promise.resolve().then(get).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
			if (req.method === "POST") return readJsonBody(req).then((body) => {
				const record = typeof body === "object" && body !== null ? body : {};
				return Promise.resolve().then(() => post(record)).then((value) => json(res, 200, value), (error) => json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				}));
			}, (error) => {
				json(res, 400, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
			json(res, 405, {
				ok: false,
				error: "method-not-allowed"
			});
		}
	};
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
			onStream?.(close);
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
/** 通用静态文件响应（含 HEAD；文件不存在 404）。 */
function serveFile(req, res, file) {
	return readFile(file).then((body) => {
		res.writeHead(200, {
			"content-type": mimeForFile(file),
			"content-length": String(body.byteLength),
			"cache-control": "no-cache"
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
}
/** 构建完整路由族（API + SSE + 素材 + 本地模型）供 ctx.webServer.register。 */
function makePetRoutes(deps) {
	const { service, packageRoot, settings, ai, aiSettings, speak, onStream } = deps;
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
				events: service.effectiveEvents(model),
				error: view.error,
				path: view.path
			};
		}, (body) => {
			const model = typeof body.model === "string" ? body.model.trim() : "";
			if (!model) throw new Error("model 不能为空");
			const parts = Array.isArray(body.parts) ? body.parts : [];
			const events = body.events === void 0 ? void 0 : typeof body.events === "object" && body.events !== null ? body.events : {};
			const view = service.saveTouchParts(model, parts, events);
			return {
				ok: true,
				model,
				touchParts: service.touchPartsFor(model),
				events: service.effectiveEvents(model),
				error: view.error,
				path: view.path
			};
		}),
		getPostRoute(`${PET_API_PREFIX}/settings`, () => settings.view(), (body) => {
			const ops = Array.isArray(body.ops) ? body.ops : [];
			return Promise.resolve(settings.write(ops)).then(() => settings.view());
		}),
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
			const kind = body.kind === "state" ? "state" : body.kind === "chat" ? "chat" : "tap";
			const part = typeof body.part === "string" ? body.part.slice(0, 40) : void 0;
			const state = typeof body.state === "string" ? body.state.slice(0, 20) : void 0;
			const hint = typeof body.hint === "string" ? body.hint.slice(0, 120) : void 0;
			const text = typeof body.text === "string" ? body.text.slice(0, 200) : void 0;
			const tz = typeof body.tz === "string" ? body.tz.slice(0, 64) : void 0;
			return ai.reply({
				kind,
				part,
				state,
				hint,
				text,
				tz
			});
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
					const record = typeof body === "object" && body !== null ? body : {};
					const input = {
						kind: record.kind === "state" ? "state" : record.kind === "chat" ? "chat" : "tap",
						part: typeof record.part === "string" ? record.part.slice(0, 40) : void 0,
						state: typeof record.state === "string" ? record.state.slice(0, 20) : void 0,
						hint: typeof record.hint === "string" ? record.hint.slice(0, 120) : void 0,
						text: typeof record.text === "string" ? record.text.slice(0, 200) : void 0,
						tz: typeof record.tz === "string" ? record.tz.slice(0, 64) : void 0
					};
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
					onStream?.(close);
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
- 100 过载：彻底失守——只剩破碎的气音和半句话（「不、不行…真的…」这种），
  说完就没声了，接着摊在那里一动也不动

## 过载之后

到了 100 并说出那句之后：敏感度直接回落到 45 左右，进入几轮的「余韵」——
声音发懒、话很少、不接梗、被碰也只轻轻躲一下，用「…别碰」这种半句应付；
这段时间很难再被推高（同样的刺激只加一半），等缓过来了才恢复原本的节奏。

## 说话风格

- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音；敏感度越高，停顿与破音越多。
- 被摸头会软下来，被夸会装作不在意；反应强弱始终跟上面那一档走。
- 不要长篇大论，不要解释设定，不要复述主人做了什么，不要提「敏感度」「分数」这类词。
- 不要自称 AI、模型或程序。`;
/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
const AI_HISTORY_MAX_ENTRIES = AI_HISTORY_LIMITS.max;
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
function historyMessages(history, count, fallback, timeZone) {
	const limit = normalizeHistoryCount(count, 0);
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
	const value = text.trim().slice(0, 8e3) || "# 简\n\n你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。\n你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。\n\n## 敏感度\n\n每次开口前，先在心里根据对话历史估一个 0–100 的「敏感度」，再用它决定这一句的反应强弱。\n看不到历史就从 30 起；只在心里算，绝对不要说出口，也不要解释这个过程。\n\n敏感度越高，身体越不受控、反应越激烈；越低越迟钝、越懒得理人。加减参考（按历史里主人做过的事累积，连着算）：\n\n- +5 被戳胸、臀、大腿、腰、脚这类地方\n- +3 同一处地方短时间内被连戳两下以上，或明明拒绝了还继续戳\n- +2 被突然从背后 / 看不见的角度碰到、被戳脸\n- +1 被盯着看、被调侃、被夸\n- -2 被好好摸头、被牵手（安抚，会软下来）\n- -3 隔了好几轮没人理，身体自己缓和下来（最低回到 30，不会归零）\n\n## 五种状态（按敏感度选最贴近的一档，不要报数字）\n\n- 0–19 迟钝：懒得动，声音很小，回的句子极短，被碰了也只用「……」「嗯」应付\n- 20–39 平常：正常的傲娇毒舌，嫌弃归嫌弃，反应还在掌控内\n- 40–59 微热：话变多，开始嘴硬遮掩，耳朵会不自觉动，反过来吐槽你手欠\n- 60–79 绷不住：语气发虚，句子断断续续，说着说着自己先乱了，会求你别再碰那里\n- 80–99 一碰就炸：几乎无法组织语言，短促、气音、慌乱，说完才想起要凶你\n- 100 过载：彻底失守——只剩破碎的气音和半句话（「不、不行…真的…」这种），\n  说完就没声了，接着摊在那里一动也不动\n\n## 过载之后\n\n到了 100 并说出那句之后：敏感度直接回落到 45 左右，进入几轮的「余韵」——\n声音发懒、话很少、不接梗、被碰也只轻轻躲一下，用「…别碰」这种半句应付；\n这段时间很难再被推高（同样的刺激只加一半），等缓过来了才恢复原本的节奏。\n\n## 说话风格\n\n- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音；敏感度越高，停顿与破音越多。\n- 被摸头会软下来，被夸会装作不在意；反应强弱始终跟上面那一档走。\n- 不要长篇大论，不要解释设定，不要复述主人做了什么，不要提「敏感度」「分数」这类词。\n- 不要自称 AI、模型或程序。";
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
/**
* 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。
*
* `forHistory: true` 时去掉「你下意识想说的是『…』」这半句（ADR-030 修订）：
* 历史只该记录真实发生的事——参考台词并没有上屏，留着会让模型把预置台词当成自己说过的话。
*/
function buildSceneMessage(context, options = {}) {
	const state = context.state ?? "idle";
	const said = (context.text ?? "").replace(/\s+/g, " ").trim();
	const where = context.kind === "chat" ? `主人刚对你说「${said || "（没说话）"}」` : context.kind === "tap" ? `主人刚戳了你的「${context.part || "身体"}」` : `当前状态是「${state}」（${state === "thinking" ? "主人在等你想事情" : state === "error" ? "出错了，气氛有点僵" : state === "done" ? "事情办完了" : state === "waiting" ? "主人正在等你确认" : state === "delivered" ? "主人刚交付了成果" : "主人在看着你"}）`;
	const hint = !options.forHistory && context.hint ? `你下意识想说的是「${context.hint}」，但别照搬，也不必复述。` : "";
	const ask = context.kind === "chat" ? "按你的人设回应主人这句话，一句话。" : "按你的人设即兴演一下这一刻的反应，一句话。";
	return `（现在是 ${formatNow(Date.now(), context.tz)}。${where}。${hint}）${ask}`;
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
* 拼 system 提示词：人设 + 输出要求（长度/单行/不旁白/不复述参考台词）。
* 一次性回复与流式回复共用，保证两条路径的口味一致。
* @param persona - 人设正文（`$DSH_HOME/waifu/persona.md`）。
* @returns 完整 system 字符串。
*/
function systemPrompt(persona) {
	return `${persona}

输出要求：只输出一句中文台词，不超过 60 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
不要复述或改写给你的参考台词：演出这个角色此刻的真实反应（嘴硬、反撩、撒娇、嫌弃、好奇都行），每次换个角度。`;
}
/** 采样参数：两个入口共用（台词要短、要活，temperature 拉满）。 */
const TEMPERATURE = 1;
const MAX_TOKENS = 120;
/** 一次请求的「人设 + 历史 + 当前场景」组装（generateReply 与 streamReply 共用）。 */
function assembleRequest(options) {
	const system = systemPrompt(options.persona);
	const messages = [...historyMessages(options.history ?? [], options.historyCount ?? 0, {
		provider: options.provider,
		model: options.model
	}, options.context.tz), {
		role: "user",
		content: [{
			type: "text",
			text: buildSceneMessage(options.context)
		}]
	}];
	options.onPayload?.({
		provider: options.provider,
		model: options.model,
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
async function generateReply(llm, options) {
	const timeoutMs = options.timeoutMs ?? 15e3;
	const attempt = async (reasoningEffort) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const { system, messages } = assembleRequest(options);
			const stream = llm.stream({
				provider: options.provider,
				model: options.model,
				system,
				messages,
				temperature: TEMPERATURE,
				maxTokens: MAX_TOKENS,
				...reasoningEffort === void 0 ? {} : { reasoningEffort },
				signal: controller.signal
			});
			let text = "";
			let finish;
			for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
			else if (chunk.type === "finish") finish = describeFinish(chunk.reason);
			const line = sanitizeLine(text);
			if (line) return { text: line };
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
	const first = await attempt();
	if (first.text !== null) return first;
	if (!first.error?.startsWith("empty")) return first;
	const retry = await attempt("off");
	return retry.text === null ? first : retry;
}
/**
* 流式回复：把 LLM 的 `text-delta` 原样吐给调用方（供气泡逐字显示 + 句读切分），
* 结束时给出清洗后的整句（与 `generateReply` 同一套 `sanitizeLine` / system 提示词）。
*
* 与 `generateReply` 的差别：这里不重试。重试要重发整段请求，流式下会把已经说出口的
* 半句再念一遍，反而更糟；空回复由调用方按「无台词」处理。
* @param llm - DSH 的 `ctx.llm`。
* @param options - provider/model/人设/场景/历史与载荷回调。
* @yields 文本增量、收尾整句或失败原因。
*/
async function* streamReply(llm, options) {
	const timeoutMs = options.timeoutMs ?? 2e4;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const forward = () => controller.abort();
	options.signal?.addEventListener("abort", forward, { once: true });
	let raw = "";
	try {
		const { system, messages } = assembleRequest(options);
		const stream = llm.stream({
			provider: options.provider,
			model: options.model,
			system,
			messages,
			temperature: TEMPERATURE,
			maxTokens: MAX_TOKENS,
			signal: controller.signal
		});
		let finish;
		for await (const chunk of stream) if (chunk.type === "text-delta" && typeof chunk.text === "string" && chunk.text.length > 0) {
			raw += chunk.text;
			yield {
				type: "delta",
				text: chunk.text
			};
		} else if (chunk.type === "finish") finish = describeFinish(chunk.reason);
		const line = sanitizeLine(raw);
		if (line) yield {
			type: "done",
			text: line
		};
		else yield {
			type: "error",
			error: raw ? "empty-after-sanitize" : `empty-stream${finish === void 0 ? "" : ` (${finish})`}`
		};
	} catch (error) {
		yield {
			type: "error",
			error: (error instanceof Error ? error.message : String(error)).slice(0, 200) || "stream-failed"
		};
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", forward);
	}
}
const SETTINGS_HEADER = `// 桌宠设置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/settings.jsonc
// 建议通过设置页「桌宠配置」修改；直接编辑保存后刷新页面生效。
// 字段：enabled / size / maxFps / model / developerMode / debug / showTapZones / canvasPadX / canvasPadY /
//        homeRight / homeBottom / bubbleOffsetX / bubbleOffsetY / bubbleBgColor / bubbleBgOpacity / bubbleTextColor /
//        aiEnabled / aiTouchOnly / aiProvider / aiModel / aiHistoryCount /
//        ttsEnabled / ttsEngine / ttsModel / ttsVoice / lipsyncEnabled / lipsyncGain`;
/**
* 设置文件结构版本：
* - 2 起 homeRight/homeBottom 语义 = 显示区中心点距右/距下（px）
* - 3 起 homeRight/homeBottom 改为**视口宽/高的百分比**（0–100）；bubbleOffsetY 改为负值向下
* - 4 起去掉基础表情与连续表情强度（`expression` / `expr*`），表情改为挂在事件/触摸部位上（ADR-023）
* - 5 起默认语音模型换成音色可固定的 MAI-Voice 2.1 Flash（Drama 3 每句都换人声，ADR-033 修订）
* - 6 起默认回到 Fish Audio Drama 3（MAI-Voice 只存活一个版本）
* - 7 起语音目录只剩通义千问 TTS，目录外的旧模型（Drama 3 / MAI / Kokoro）统一回落到新默认
*/
const SETTINGS_SCHEMA_VERSION = 7;
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
		aiTouchOnly: bool("aiTouchOnly"),
		aiTakeover: bool("aiTakeover"),
		aiProvider: pickString(record.aiProvider) ?? base.aiProvider,
		aiModel: pickString(record.aiModel) ?? base.aiModel,
		aiHistoryCount: clampInt(record.aiHistoryCount, base.aiHistoryCount, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max),
		interactionMode: normalizeInteractionMode(record.interactionMode, base.interactionMode),
		barPosition: normalizeBarPosition(record.barPosition, base.barPosition),
		barOffset: clampInt(record.barOffset, base.barOffset, BAR_OFFSET_LIMITS.min, BAR_OFFSET_LIMITS.max),
		thinkingAiDelay: clampInt(record.thinkingAiDelay, base.thinkingAiDelay, LONG_AI_LIMITS.delay.min, LONG_AI_LIMITS.delay.max),
		thinkingAiInterval: clampInt(record.thinkingAiInterval, base.thinkingAiInterval, LONG_AI_LIMITS.interval.min, LONG_AI_LIMITS.interval.max),
		thinkingAiMax: clampInt(record.thinkingAiMax, base.thinkingAiMax, LONG_AI_LIMITS.max.min, LONG_AI_LIMITS.max.max),
		waitingAiDelay: clampInt(record.waitingAiDelay, base.waitingAiDelay, LONG_AI_LIMITS.delay.min, LONG_AI_LIMITS.delay.max),
		waitingAiInterval: clampInt(record.waitingAiInterval, base.waitingAiInterval, LONG_AI_LIMITS.interval.min, LONG_AI_LIMITS.interval.max),
		waitingAiMax: clampInt(record.waitingAiMax, base.waitingAiMax, LONG_AI_LIMITS.max.min, LONG_AI_LIMITS.max.max),
		ttsEnabled: bool("ttsEnabled"),
		ttsEngine: pickString(record.ttsEngine) ?? base.ttsEngine,
		ttsModel: voiceFix.model,
		ttsVoice: voiceFix.voice,
		lipsyncEnabled: bool("lipsyncEnabled"),
		lipsyncGain: normalizeLipsyncGain(record.lipsyncGain, base.lipsyncGain)
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
	* 应用设置页的 path 操作（`{op:'set',path:['size'],value}` / `{op:'unset'}`），
	* 过滤未知路径与非法值，写回文件并返回最新视图。
	*/
	applyOps(ops) {
		const current = this.get();
		let next = {
			...current,
			version: SETTINGS_SCHEMA_VERSION
		};
		for (const op of ops) {
			if (!Array.isArray(op.path) || op.path.length !== 1) continue;
			const key = op.path[0];
			if (typeof key !== "string" || !(key in current)) continue;
			if (op.op === "unset") {
				delete next[key];
				continue;
			}
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
	async synthesize(text, options, signal) {
		const trimmed = text.trim();
		if (!trimmed) throw new Error("empty-text");
		const key = ttsCacheKey(trimmed, options);
		const dir = ttsCacheDir(this.cacheHome);
		const hit = await readCache(dir, key);
		if (hit) {
			this.onPayload?.({
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
			this.onPayload?.({
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
/**
* 跑一轮流式演绎。
* @param options - 文本流、合成函数与事件出口。
* @returns 最终整句、段数与成功出声的段数。
*/
async function runSpeakPipeline(options) {
	const { chunks, synthesize, emit, signal } = options;
	const tasks = /* @__PURE__ */ new Map();
	let nextIndex = 0;
	let pumpIndex = 0;
	let audioCount = 0;
	let buffer = "";
	let total = "";
	let result = "";
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
	/** 把缓冲区里已完整的段落切出去（最后一段可能还没说完，留到下次）。 */
	const flush = (final) => {
		if (!buffer) return;
		const pieces = splitClauses(buffer);
		if (pieces.length === 0) {
			if (final) buffer = "";
			return;
		}
		const ready = final ? pieces : pieces.slice(0, -1);
		buffer = final ? "" : pieces[pieces.length - 1] ?? "";
		for (const piece of ready) {
			const index = nextIndex;
			nextIndex += 1;
			emit("clause", {
				index,
				text: piece
			});
			const task = synthesize(piece).catch(() => null);
			tasks.set(index, task);
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
				buffer = `${buffer}${delta}`;
				flush(false);
			}
			continue;
		}
		if (chunk.type === "done") {
			result = chunk.text;
			continue;
		}
		if (chunk.type === "error") {
			flush(true);
			await kick();
			emit("error", { error: chunk.error });
			emit("done", { text: result || total });
			return {
				text: result || total,
				clauses: nextIndex,
				audio: audioCount
			};
		}
	}
	flush(true);
	while (pumpIndex < nextIndex) {
		if (!tasks.has(pumpIndex)) {
			pumpIndex += 1;
			continue;
		}
		await kick();
	}
	emit("done", { text: result || total });
	return {
		text: result || total,
		clauses: nextIndex,
		audio: audioCount
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
*   隐藏自动生成的设置页（插件自带「桌宠配置」页）。
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
	homeRight: Schema.number().min(0).max(100).default(12),
	homeBottom: Schema.number().min(0).max(100).default(31),
	bubbleOffsetX: Schema.number().min(-1e3).max(1e3).default(0),
	bubbleOffsetY: Schema.number().min(-1e3).max(1e3).default(-15),
	bubbleBgColor: Schema.string().default(DEFAULT_BUBBLE_BG_COLOR),
	bubbleBgOpacity: Schema.number().min(0).max(100).default(92),
	/** 气泡最长连续可见秒数（0 = 不限）；默认 30。 */
	bubbleMaxSeconds: Schema.number().min(0).max(600).default(30),
	bubbleTextColor: Schema.string().default(DEFAULT_BUBBLE_TEXT_COLOR),
	aiEnabled: Schema.boolean().default(DEFAULT_SETTINGS.aiEnabled),
	aiTouchOnly: Schema.boolean().default(DEFAULT_SETTINGS.aiTouchOnly),
	aiTakeover: Schema.boolean().default(DEFAULT_SETTINGS.aiTakeover),
	aiProvider: Schema.string().default(DEFAULT_AI_PROVIDER),
	aiModel: Schema.string().default(DEFAULT_AI_MODEL),
	interactionMode: Schema.union([
		Schema.const("mutual"),
		Schema.const("touch-first"),
		Schema.const("event-first")
	]).default(DEFAULT_INTERACTION_MODE),
	/** 交互条贴在模型上方 / 下方，或干脆不显示（静音 + 对话输入）。 */
	barPosition: Schema.union([
		Schema.const("top"),
		Schema.const("bottom"),
		Schema.const("hidden")
	]).default(DEFAULT_BAR_POSITION),
	/** 交互条沿吸附边的额外偏移（px，正数远离模型）。 */
	barOffset: Schema.number().min(BAR_OFFSET_LIMITS.min).max(BAR_OFFSET_LIMITS.max).default(0),
	/** 注入到 prompt 的最近对话条数（0 = 不注入，默认 10；ADR-030）。 */
	aiHistoryCount: Schema.number().min(0).max(50).default(20),
	thinkingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.thinking.delay),
	thinkingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.thinking.interval),
	thinkingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.thinking.max),
	waitingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.waiting.delay),
	waitingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.waiting.interval),
	waitingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.waiting.max),
	ttsEnabled: Schema.boolean().default(DEFAULT_SETTINGS.ttsEnabled),
	ttsEngine: Schema.string().default(DEFAULT_SETTINGS.ttsEngine),
	ttsModel: Schema.string().default(DEFAULT_SETTINGS.ttsModel),
	ttsVoice: Schema.string().default(DEFAULT_SETTINGS.ttsVoice),
	lipsyncEnabled: Schema.boolean().default(DEFAULT_SETTINGS.lipsyncEnabled),
	lipsyncGain: Schema.number().min(LIPSYNC_GAIN_LIMITS.min).max(LIPSYNC_GAIN_LIMITS.max).default(DEFAULT_SETTINGS.lipsyncGain)
});
/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 回复，ADR-025）。 */
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
		aiTouchOnly: config.aiTouchOnly,
		aiTakeover: config.aiTakeover,
		aiProvider: config.aiProvider,
		aiModel: config.aiModel,
		interactionMode: config.interactionMode,
		barPosition: config.barPosition,
		barOffset: config.barOffset,
		aiHistoryCount: config.aiHistoryCount,
		thinkingAiDelay: config.thinkingAiDelay,
		thinkingAiInterval: config.thinkingAiInterval,
		thinkingAiMax: config.thinkingAiMax,
		waitingAiDelay: config.waitingAiDelay,
		waitingAiInterval: config.waitingAiInterval,
		waitingAiMax: config.waitingAiMax,
		ttsEnabled: config.ttsEnabled,
		ttsEngine: config.ttsEngine,
		ttsModel: config.ttsModel,
		ttsVoice: config.ttsVoice,
		lipsyncEnabled: config.lipsyncEnabled,
		lipsyncGain: config.lipsyncGain
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
	const AI_COOLDOWN_MS = 1200;
	let lastAiAt = 0;
	let aiHistory = [];
	let lastAiPayload = null;
	let lastTtsPayload = null;
	let lastSpeakPayload = null;
	let payloadSink = "tts";
	/**
	* AI 触发的公共前置（/interact 与 /speak 共用，ADR-025/028/031）：
	* 开关 → 1.2s 冷却 → 全 AI 接管时丢掉参考台词（旧客户端/手工调用也不再泄露固定对白）。
	*/
	const beginAiTurn = (input) => {
		const settings = settingsStore.get();
		if (!settings.aiEnabled) return {
			ok: false,
			error: "ai-disabled"
		};
		const now = Date.now();
		if (now - lastAiAt < AI_COOLDOWN_MS) return {
			ok: false,
			error: "cooldown"
		};
		lastAiAt = now;
		const tz = normalizeTimeZone(input.tz);
		return {
			ok: true,
			settings,
			context: settings.aiTakeover ? {
				...input,
				hint: void 0,
				tz
			} : {
				...input,
				tz
			}
		};
	};
	/** 两个入口共用的请求参数（provider/model/人设/历史注入）。 */
	const aiRequest = (settings, context, onPayload, signal) => ({
		provider: settings.aiProvider,
		model: settings.aiModel,
		persona: loadPersona(dirname(settingsStore.path)),
		context,
		history: aiHistory,
		historyCount: settings.aiHistoryCount,
		onPayload,
		signal
	});
	/** 只记录成功的往来：失败的请求不该污染上下文；参考台词不进历史（ADR-030）。 */
	const recordAiTurn = (context, text, settings) => {
		const at = Date.now();
		aiHistory = appendHistory(aiHistory, {
			role: "user",
			text: buildSceneMessage(context, { forHistory: true }),
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
		const attempt = await generateReply(ctx.llm, aiRequest(turn.settings, turn.context, (payload) => {
			lastAiPayload = payload;
		}));
		if (attempt.text) {
			recordAiTurn(turn.context, attempt.text, turn.settings);
			return {
				ok: true,
				text: attempt.text
			};
		}
		return {
			ok: false,
			error: `no-reply: ${attempt.error ?? "unknown"}`
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
			const home = dirname(settingsStore.path);
			return {
				text: loadPersona(home),
				path: personaPath(home)
			};
		},
		writePersona: (text) => savePersona(dirname(settingsStore.path), text),
		check: async (input) => {
			const settings = settingsStore.get();
			const attempt = await generateReply(ctx.llm, {
				provider: input?.provider || settings.aiProvider,
				model: input?.model || settings.aiModel,
				persona: loadPersona(dirname(settingsStore.path)),
				context: {
					kind: "tap",
					part: "脸",
					hint: "有人戳了戳你的脸"
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
	const ttsEngine = new OpenRouterTtsEngine(resolveOpenRouterKey, dirname(settingsStore.path), fetch, OPENROUTER_SPEECH_URL, (payload) => {
		if (payloadSink === "speak") lastSpeakPayload = payload;
		else lastTtsPayload = payload;
	});
	const voiceOptions = () => {
		const settings = settingsStore.get();
		return {
			model: settings.ttsModel,
			voice: settings.ttsVoice.trim() || void 0
		};
	};
	const speakApi = {
		synthesize: async (text) => {
			payloadSink = "tts";
			const audio = await ttsEngine.synthesize(text, voiceOptions());
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
			}, signal));
			const speakOptions = voiceOptions();
			payloadSink = "speak";
			const synthesize = async (text) => {
				if (!speakOn || signal.aborted) return null;
				try {
					return await ttsEngine.synthesize(text, speakOptions, signal);
				} catch {
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
			speak: speakApi,
			onStream: (close) => {
				openStreams.add(close);
			}
		}).map((route) => ctx.webServer.register(route));
		return () => {
			for (const close of openStreams) close();
			for (const dispose of disposers) dispose();
		};
	}, "waifu: routes");
}
export { ANIMATION_SLOTS, Config, DEFAULT_LONG_AI, DEFAULT_MOTION_MAP, DEFAULT_TOUCH_PARTS, LONG_AI_LIMITS, LONG_STATES, MAX_BOXES_PER_PART, PET_API_PREFIX, PET_ASSET_PREFIX, PetService, apply, defaultModelId, hitTestTouchParts, inject, isLongState, listBuiltinPresets, makePetRoutes, name, normalizeTouchBox, normalizeTouchParts, petPackageRoot, pointToBoundsRatio, resolveDefaultTouchParts, resolveModelUrl, resolveMotionMap };
