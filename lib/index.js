import { dirname, join, sep } from "node:path";
import Schema from "@deepseek-ai/schemastery";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
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
	error: ["ShakeHead", "angry"],
	done: ["star"],
	waiting: ["Sway"],
	delivered: ["heart"]
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
		interval: 30,
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
	size: 240
};
const DEFAULT_BUBBLE_BG_COLOR = "#ffffff";
const DEFAULT_BUBBLE_TEXT_COLOR = "#222222";
/** AI 回复默认路由（DSH 已配置的 provider / 模型，ADR-025）。 */
const DEFAULT_AI_PROVIDER = "deepseek-official";
const DEFAULT_AI_MODEL = "deepseek-flash";
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
* 标量设置默认值（除 `model`：模型 id 由内置 preset 目录动态决定）。
* 与 `Config` schema 的 `.default()`、设置页 `DEFAULT_VALUE` 保持逐项一致。
*/
const DEFAULT_SETTINGS = {
	enabled: true,
	size: DEFAULT_DISPLAY.size,
	maxFps: 30,
	developerMode: true,
	debug: false,
	showTapZones: false,
	canvasPadX: 125,
	canvasPadY: 50,
	homeRight: 15,
	homeBottom: 24,
	bubbleOffsetX: 0,
	bubbleOffsetY: -15,
	bubbleBgColor: DEFAULT_BUBBLE_BG_COLOR,
	bubbleBgOpacity: 92,
	bubbleMaxSeconds: 30,
	bubbleTextColor: DEFAULT_BUBBLE_TEXT_COLOR,
	aiEnabled: true,
	aiTouchOnly: false,
	aiProvider: DEFAULT_AI_PROVIDER,
	aiModel: DEFAULT_AI_MODEL,
	aiHistoryCount: 10
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
	ctx;
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
		this.ctx = ctx;
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
				aiProvider: settings.aiProvider,
				aiModel: settings.aiModel,
				aiHistoryCount: settings.aiHistoryCount,
				thinkingAiDelay: settings.thinkingAiDelay,
				thinkingAiInterval: settings.thinkingAiInterval,
				thinkingAiMax: settings.thinkingAiMax,
				waitingAiDelay: settings.waitingAiDelay,
				waitingAiInterval: settings.waitingAiInterval,
				waitingAiMax: settings.waitingAiMax,
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
	const { service, packageRoot, settings, ai, aiSettings, onStream } = deps;
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
			...aiSettings.check ? [postRoute(`${PET_API_PREFIX}/ai-check`, (body) => aiSettings.check({
				provider: typeof body.provider === "string" && body.provider.length > 0 ? body.provider : void 0,
				model: typeof body.model === "string" && body.model.length > 0 ? body.model : void 0
			}))] : []
		] : [],
		...ai ? [postRoute(`${PET_API_PREFIX}/interact`, (body) => {
			const kind = body.kind === "state" ? "state" : "tap";
			const part = typeof body.part === "string" ? body.part.slice(0, 40) : void 0;
			const state = typeof body.state === "string" ? body.state.slice(0, 20) : void 0;
			const hint = typeof body.hint === "string" ? body.hint.slice(0, 120) : void 0;
			return ai.reply({
				kind,
				part,
				state,
				hint
			});
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

说话风格：
- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音。
- 被戳到敏感部位会害羞/炸毛，被摸头会软下来，被夸会装作不在意。
- 不要长篇大论，不要解释设定，不要复述主人做了什么。
- 不要自称 AI、模型或程序。`;
/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
const AI_HISTORY_MAX_ENTRIES = AI_HISTORY_LIMITS.max;
/**
* 把历史切成 `messages` 段：取最近 `count` 条，并丢掉开头没有配对提问的 assistant 条目
* （模型不喜欢以 assistant 开头的上下文）。
*/
function historyMessages(history, count, fallback) {
	const limit = normalizeHistoryCount(count, 0);
	if (limit <= 0 || history.length === 0) return [];
	const tail = history.slice(-limit);
	while (tail.length > 0 && tail[0].role === "assistant") tail.shift();
	return tail.filter((entry) => entry.text.trim().length > 0).map((entry, index) => ({
		id: `history-${index}`,
		role: entry.role,
		content: [{
			type: "text",
			text: entry.text
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
	const value = text.trim().slice(0, 8e3) || "# 简\n\n你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。\n你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。\n\n说话风格：\n- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音。\n- 被戳到敏感部位会害羞/炸毛，被摸头会软下来，被夸会装作不在意。\n- 不要长篇大论，不要解释设定，不要复述主人做了什么。\n- 不要自称 AI、模型或程序。";
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
	return `（${context.kind === "tap" ? `主人刚戳了你的「${context.part || "身体"}」` : `当前状态是「${state}」（${state === "thinking" ? "主人在等你想事情" : state === "error" ? "出错了，气氛有点僵" : state === "done" ? "事情办完了" : state === "waiting" ? "主人正在等你确认" : state === "delivered" ? "主人刚交付了成果" : "主人在看着你"}）`}。${!options.forHistory && context.hint ? `你下意识想说的是「${context.hint}」，但别照搬，也不必复述。` : ""}）按你的人设即兴演一下这一刻的反应，一句话。`;
}
/** 单行化 + 去引号 + 截断：气泡只放得下短短一句。 */
function sanitizeLine(raw) {
	const stripped = (raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "").replace(/^["'“”‘’「」『』]+/, "").replace(/["'“”‘’「」『』]+$/, "").trim();
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
async function generateReply(llm, options) {
	const timeoutMs = options.timeoutMs ?? 15e3;
	const attempt = async (reasoningEffort) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const stream = llm.stream({
				provider: options.provider,
				model: options.model,
				system: `${options.persona}

输出要求：只输出一句中文台词，不超过 60 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
不要复述或改写给你的参考台词：演出这个角色此刻的真实反应（嘴硬、反撩、撒娇、嫌弃、好奇都行），每次换个角度。`,
				messages: [...historyMessages(options.history ?? [], options.historyCount ?? 0, {
					provider: options.provider,
					model: options.model
				}), {
					role: "user",
					content: [{
						type: "text",
						text: buildSceneMessage(options.context)
					}]
				}],
				temperature: 1,
				maxTokens: 120,
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
const SETTINGS_HEADER = `// 桌宠设置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/settings.jsonc
// 建议通过设置页「桌宠配置」修改；直接编辑保存后刷新页面生效。
// 字段：enabled / size / maxFps / model / developerMode / debug / showTapZones / canvasPadX / canvasPadY /
//        homeRight / homeBottom / bubbleOffsetX / bubbleOffsetY / bubbleBgColor / bubbleBgOpacity / bubbleTextColor /
//        aiEnabled / aiTouchOnly / aiProvider / aiModel`;
/**
* 设置文件结构版本：
* - 2 起 homeRight/homeBottom 语义 = 显示区中心点距右/距下（px）
* - 3 起 homeRight/homeBottom 改为**视口宽/高的百分比**（0–100）；bubbleOffsetY 改为负值向下
* - 4 起去掉基础表情与连续表情强度（`expression` / `expr*`），表情改为挂在事件/触摸部位上（ADR-023）
*/
const SETTINGS_SCHEMA_VERSION = 4;
/** home 改成视口百分比的版本（3）；更早的文件 home 语义不同，直接回退 base。 */
const HOME_PERCENT_VERSION = 3;
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
		aiProvider: pickString(record.aiProvider) ?? base.aiProvider,
		aiModel: pickString(record.aiModel) ?? base.aiModel,
		aiHistoryCount: clampInt(record.aiHistoryCount, base.aiHistoryCount, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max),
		thinkingAiDelay: clampInt(record.thinkingAiDelay, base.thinkingAiDelay, LONG_AI_LIMITS.delay.min, LONG_AI_LIMITS.delay.max),
		thinkingAiInterval: clampInt(record.thinkingAiInterval, base.thinkingAiInterval, LONG_AI_LIMITS.interval.min, LONG_AI_LIMITS.interval.max),
		thinkingAiMax: clampInt(record.thinkingAiMax, base.thinkingAiMax, LONG_AI_LIMITS.max.min, LONG_AI_LIMITS.max.max),
		waitingAiDelay: clampInt(record.waitingAiDelay, base.waitingAiDelay, LONG_AI_LIMITS.delay.min, LONG_AI_LIMITS.delay.max),
		waitingAiInterval: clampInt(record.waitingAiInterval, base.waitingAiInterval, LONG_AI_LIMITS.interval.min, LONG_AI_LIMITS.interval.max),
		waitingAiMax: clampInt(record.waitingAiMax, base.waitingAiMax, LONG_AI_LIMITS.max.min, LONG_AI_LIMITS.max.max)
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
	homeRight: Schema.number().min(0).max(100).default(15),
	homeBottom: Schema.number().min(0).max(100).default(24),
	bubbleOffsetX: Schema.number().min(-1e3).max(1e3).default(0),
	bubbleOffsetY: Schema.number().min(-1e3).max(1e3).default(-15),
	bubbleBgColor: Schema.string().default(DEFAULT_BUBBLE_BG_COLOR),
	bubbleBgOpacity: Schema.number().min(0).max(100).default(92),
	/** 气泡最长连续可见秒数（0 = 不限）；默认 30。 */
	bubbleMaxSeconds: Schema.number().min(0).max(600).default(30),
	bubbleTextColor: Schema.string().default(DEFAULT_BUBBLE_TEXT_COLOR),
	aiEnabled: Schema.boolean().default(DEFAULT_SETTINGS.aiEnabled),
	aiTouchOnly: Schema.boolean().default(DEFAULT_SETTINGS.aiTouchOnly),
	aiProvider: Schema.string().default(DEFAULT_AI_PROVIDER),
	aiModel: Schema.string().default(DEFAULT_AI_MODEL),
	/** 注入到 prompt 的最近对话条数（0 = 不注入，默认 10；ADR-030）。 */
	aiHistoryCount: Schema.number().min(0).max(50).default(10),
	thinkingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.thinking.delay),
	thinkingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.thinking.interval),
	thinkingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.thinking.max),
	waitingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.waiting.delay),
	waitingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.waiting.interval),
	waitingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.waiting.max)
});
/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 回复，ADR-025）。 */
const inject = [
	"webServer",
	"settings",
	"llm"
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
		aiProvider: config.aiProvider,
		aiModel: config.aiModel,
		aiHistoryCount: config.aiHistoryCount,
		thinkingAiDelay: config.thinkingAiDelay,
		thinkingAiInterval: config.thinkingAiInterval,
		thinkingAiMax: config.thinkingAiMax,
		waitingAiDelay: config.waitingAiDelay,
		waitingAiInterval: config.waitingAiInterval,
		waitingAiMax: config.waitingAiMax
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
	let lastAiAt = 0;
	let aiHistory = [];
	const aiApi = { reply: async (input) => {
		const settings = settingsStore.get();
		if (!settings.aiEnabled) return {
			ok: false,
			error: "ai-disabled"
		};
		const now = Date.now();
		if (now - lastAiAt < 1200) return {
			ok: false,
			error: "cooldown"
		};
		lastAiAt = now;
		const attempt = await generateReply(ctx.llm, {
			provider: settings.aiProvider,
			model: settings.aiModel,
			persona: loadPersona(dirname(settingsStore.path)),
			context: input,
			history: aiHistory,
			historyCount: settings.aiHistoryCount
		});
		if (attempt.text) {
			aiHistory = appendHistory(aiHistory, {
				role: "user",
				text: buildSceneMessage(input, { forHistory: true })
			});
			aiHistory = appendHistory(aiHistory, {
				role: "assistant",
				text: attempt.text,
				provider: settings.aiProvider,
				model: settings.aiModel
			}, AI_HISTORY_MAX_ENTRIES);
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
	ctx.effect(() => {
		const openStreams = /* @__PURE__ */ new Set();
		const disposers = makePetRoutes({
			service,
			packageRoot: petPackageRoot(import.meta.url),
			settings: settingsApi,
			ai: aiApi,
			aiSettings: aiSettingsApi,
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
