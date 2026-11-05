window.__ModuleLoader__.load({
	id: "dsh-waifu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
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
		/** 动作组的显示名（下拉与卡片摘要用；未收录的自定义动作组回退成原名）。 */
		const MOTION_LABELS = {
			Idle: "待机",
			Nod: "点头",
			ShakeHead: "摇头",
			Tilt: "歪头",
			Sway: "左右晃"
		};
		/** 动作组的显示名（未知动作组回退原 id）。 */
		function motionLabel(id) {
			return MOTION_LABELS[id] ?? id;
		}
		/** 表情的互斥组（没有则返回空串 = 可自由叠加）。 */
		function expressionExclusiveGroup(id) {
			return EXPRESSIONS.find((expression) => expression.id === id)?.exclusive ?? "";
		}
		/** 表情的显示名（未知 id 回退原值）。 */
		function expressionLabel(id) {
			return EXPRESSIONS.find((expression) => expression.id === id)?.name ?? id;
		}
		/** 表情会触及的全部开关参数（未选中的一律淡出到 0，避免多个表情叠着）。 */
		const EXPRESSION_SWITCH_PARAMS = [
			"ParamSwitch1",
			"ParamSwitch2",
			"ParamSwitch3",
			"ParamSwitch4",
			"ParamSwitch5",
			"ParamSwitch6",
			"ParamSwitch7",
			"ParamSwitch8",
			"ParamSwitch9",
			"ParamSwitch21"
		];
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
		/** 表情列表 → 需要写 1 的参数集合（多个表情叠加时取并集）。 */
		function expressionParams(ids) {
			const params = {};
			for (const id of ids) {
				const def = EXPRESSIONS.find((expression) => expression.id === id);
				if (!def) continue;
				for (const [param, value] of Object.entries(def.params)) params[param] = value;
			}
			return params;
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
		/** 默认模型 id（与内置 preset 目录一致）。 */
		const DEFAULT_MODEL_ID = "jian";
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
			/** 全 AI 接管：不显示任何预置对白，气泡全靠模型；长状态延迟失效、入态即请求（ADR-031）。 */
			aiTakeover: false,
			aiProvider: DEFAULT_AI_PROVIDER,
			aiModel: DEFAULT_AI_MODEL,
			aiHistoryCount: 10,
			interactionMode: DEFAULT_INTERACTION_MODE
		};
		// src/client/client-log.ts
		/**
		* 浏览器侧诊断上报（Client 半区共用）：把桌宠/设置页的关键事件与错误发到 Host 的
		* `/api/dsh-waifu/client-log`，Host 落盘 `$DSH_HOME/waifu/client.log`，
		* 便于没有浏览器控制台的环境排查（spec §9）。失败静默，不影响主流程。
		* @module dsh-waifu/client/client-log
		*/
		/** 宠物 API 基路径（与 client/index.ts、settings.ts 保持一致）。 */
		const PET_API$1 = "/api/dsh-waifu";
		/** 上报一条客户端诊断日志。 */
		function clientLog(level, message, detail) {
			try {
				const text = detail === void 0 ? "" : (detail instanceof Error ? detail.stack ?? detail.message : String(detail)).slice(0, 4e3);
				fetch(`${PET_API$1}/client-log`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						level,
						message,
						detail: text
					})
				}).catch(() => {});
			} catch {}
		}
		// src/client/pet-commands.ts
		/**
		* 把「当前 pos（右下角偏移，px）+ 画布尺寸 + 视口尺寸」换算成「显示中心距右/距下」的百分比。
		* 与 `homePositionFromConfig` 互逆：画布中心距右 = right + W/2。任何尺寸非正时返回 null。
		*/
		function homePercentFromPos(pos, canvas, viewport) {
			if (!(canvas.width > 0 && canvas.height > 0 && viewport.width > 0 && viewport.height > 0)) return null;
			const clampPct = (value) => Math.round(Math.min(100, Math.max(0, value)));
			return {
				right: clampPct((pos.right + canvas.width / 2) / viewport.width * 100),
				bottom: clampPct((pos.bottom + canvas.height / 2) / viewport.height * 100)
			};
		}
		/** 捕捉命令事件名。 */
		const CAPTURE_HOME_EVENT = "dsh-waifu:capture-home";
		/** 归位命令事件名。 */
		const RECENTER_EVENT = "dsh-waifu:recenter";
		/** 广播归位命令（设置页调用）。 */
		function emitRecenter() {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(RECENTER_EVENT));
		}
		/** 订阅归位命令（宠物悬浮层调用）；返回退订函数。 */
		function onRecenter(handler) {
			if (typeof window === "undefined") return () => {};
			window.addEventListener(RECENTER_EVENT, handler);
			return () => window.removeEventListener(RECENTER_EVENT, handler);
		}
		/**
		* 广播「捕捉当前位置」命令；宠物半边把当前中心点换算成百分比后回调。
		* 没有宠物半边在页面里时不会回调（设置页据此不做任何写入）。
		*/
		function emitCaptureHome(captured) {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(CAPTURE_HOME_EVENT, { detail: { captured } }));
		}
		/** 订阅「捕捉」命令（宠物悬浮层调用）；返回退订函数。 */
		function onCaptureHome(handler) {
			if (typeof window === "undefined") return () => {};
			const listener = (event) => {
				const detail = event.detail;
				if (typeof detail?.captured === "function") handler(detail.captured);
			};
			window.addEventListener(CAPTURE_HOME_EVENT, listener);
			return () => window.removeEventListener(CAPTURE_HOME_EVENT, listener);
		}
		// src/client/touch-edit.ts
		/** 编辑态事件名。 */
		const TOUCH_EDIT_EVENT = "dsh-waifu:touch-edit";
		/** 广播编辑态（设置页调用）。 */
		function emitTouchEdit(state) {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(TOUCH_EDIT_EVENT, { detail: state }));
		}
		/** 订阅编辑态（宠物悬浮层调用）；返回退订函数。 */
		function onTouchEdit(handler) {
			if (typeof window === "undefined") return () => {};
			const listener = (event) => {
				const detail = event.detail;
				if (detail && typeof detail === "object") handler(detail);
			};
			window.addEventListener(TOUCH_EDIT_EVENT, listener);
			return () => window.removeEventListener(TOUCH_EDIT_EVENT, listener);
		}
		// src/client/settings.ts
		/**
		* 桌宠配置设置页（`settings.section` 注册体，spec §2）。
		* 单页信息架构（从上到下）：显示（开关 / 尺寸 / 留白 / 位置 / 气泡 / 帧率）/
		* 事件绑定（当前模型：6 事件的动作 / 表情 + 入态台词池）/ 触摸部位
		* （box / 台词 / 动作组）/ 开发者选项。仅内置「简」模型，不再有模型选择/导入、
		* 固定人设、跳转链接或文件路径展示。
		* 读写经插件自己的同源 API `/api/dsh-waifu/settings` 与 `/api/dsh-waifu/touch-parts`
		* （Host 直连插件私有配置文件 settings.jsonc / touch-parts.jsonc，ADR-013）——不走
		* client settingsScope wire，因为 dsh-host-apiproxy 只把内置 allowlist 的 namespace
		* 暴露给浏览器（见 docs/research/settings-tab.md「设置服务不可用」根因）。
		* 不引入任何非平台模块值导入。
		* @module dsh-waifu/client/settings
		*/
		/** 设置项兜底值：标量统一取自 defaults.ts（单一来源），只有模型 id 与长状态节奏就地取默认。 */
		const DEFAULT_VALUE = {
			...DEFAULT_SETTINGS,
			model: DEFAULT_MODEL_ID,
			thinkingAiDelay: DEFAULT_LONG_AI.thinking.delay,
			thinkingAiInterval: DEFAULT_LONG_AI.thinking.interval,
			thinkingAiMax: DEFAULT_LONG_AI.thinking.max,
			waitingAiDelay: DEFAULT_LONG_AI.waiting.delay,
			waitingAiInterval: DEFAULT_LONG_AI.waiting.interval,
			waitingAiMax: DEFAULT_LONG_AI.waiting.max
		};
		/** 事件卡片展示顺序（空闲/思考中/出错/完成/交付/等审批）。 */
		const EVENT_ORDER = [
			"idle",
			"thinking",
			"error",
			"done",
			"delivered",
			"waiting"
		];
		/** 事件中文名（事件绑定卡片标题）。 */
		const EVENT_LABELS = {
			idle: "空闲",
			thinking: "思考中",
			error: "出错",
			done: "完成",
			delivered: "交付",
			waiting: "等审批"
		};
		/** 事件台词池只有「入态」一组（ADR-026：多阶段固定台词已取消，长状态交给 AI 演绎）。 */
		function eventStageLabels(_event) {
			return ["入态"];
		}
		/** 深拷贝事件绑定（避免草稿与 API 对象 / 默认常量互相污染）。 */
		function cloneEventBindings(bindings) {
			const out = {};
			for (const event of PET_EVENTS) {
				const binding = bindings[event];
				out[event] = {
					motions: [...binding.motions],
					lines: binding.lines.map((pool) => [...pool])
				};
			}
			return out;
		}
		/** 把某事件绑定裁剪到「入态」一组（ADR-026）。 */
		function normalizeEventDraft(binding, event) {
			const stageCount = eventStageLabels(event).length;
			const lines = Array.from({ length: stageCount }, (_, stage) => [...binding.lines[stage] ?? []]);
			return {
				motions: [...binding.motions],
				lines
			};
		}
		/** GET /state 的事件绑定（完整表）→ 可编辑草稿（补齐阶段数）。 */
		function eventBindingsFromApi(raw) {
			const merged = mergeEventBindings(DEFAULT_EVENT_BINDINGS, normalizeEventBindings(raw));
			const out = {};
			for (const event of PET_EVENTS) out[event] = normalizeEventDraft(merged[event], event);
			return out;
		}
		/** 解析事件台词池 textarea：一行一条 → trim/去空/截断 120 字/去重/最多 20 条。 */
		function parseEventLines(raw) {
			const cleaned = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).map((line) => line.slice(0, 120)).slice(0, 20);
			return [...new Set(cleaned)];
		}
		/** 从 .model3.json 解析动作组名列表（FileReferences.Motions 或顶层 Motions）。 */
		async function fetchMotionGroups(url) {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			const motions = data?.FileReferences?.Motions ?? data?.Motions ?? {};
			return Object.keys(motions);
		}
		/** 深拷贝部位草稿（避免设置页草稿与共享对象 / 事件 detail 互相污染）。 */
		function cloneTouchParts(parts) {
			return parts.map((part) => ({
				id: part.id,
				name: part.name,
				boxes: part.boxes.map((box) => ({ ...box })),
				motions: [...part.motions],
				...part.lines && part.lines.length > 0 ? { lines: [...part.lines] } : {}
			}));
		}
		/** 解析部位台词 textarea：一行一条 → trim/去空/截断 120 字/去重/最多 30 条。 */
		function parsePartLines(raw) {
			const cleaned = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0).map((line) => line.slice(0, 120)).slice(0, 30);
			return [...new Set(cleaned)];
		}
		/** 0–1 → 百分比整数（设置页输入框按 0–100 显示）。 */
		function toPercent(value) {
			return Math.round(value * 100);
		}
		/** 百分比输入 → 0–1（clamp 0–100；非有限数按 0）。 */
		function fromPercentInput(raw) {
			const n = Number(raw);
			if (!Number.isFinite(n)) return 0;
			return Math.min(100, Math.max(0, n)) / 100;
		}
		/** 归一化草稿 box（与 Host normalizeTouchBox 一致：交换左右/上下顺序）。 */
		function orderTouchBox(box) {
			return {
				left: Math.min(box.left, box.right),
				top: Math.min(box.top, box.bottom),
				right: Math.max(box.left, box.right),
				bottom: Math.max(box.top, box.bottom)
			};
		}
		/**
		* 设置页把 box 坐标按**左下角**为原点显示（更符合直觉：上 = box 上边离底边的距离，调大即往上长）。
		* 存储仍是相对左上角的归一化 {left, top, right, bottom}，只在这一层做互补换算。
		*/
		function boxFieldPercent(box, key) {
			if (key === "top") return Math.round((1 - box.top) * 100);
			if (key === "bottom") return Math.round((1 - box.bottom) * 100);
			return toPercent(box[key]);
		}
		/** 以左下角为原点的百分比输入 → 归一化 box（写回存储前照旧校正左右/上下顺序）。 */
		function applyBoxField(box, key, raw) {
			const value = fromPercentInput(raw);
			if (key === "top") return orderTouchBox({
				...box,
				top: 1 - value
			});
			if (key === "bottom") return orderTouchBox({
				...box,
				bottom: 1 - value
			});
			return orderTouchBox({
				...box,
				[key]: value
			});
		}
		/** 触摸部位每个 box 的四个边（设置页输入框顺序：左 / 上 / 右 / 下；原点在左下角）。 */
		const TOUCH_BOX_FIELDS = [
			{
				key: "left",
				label: "左"
			},
			{
				key: "top",
				label: "上"
			},
			{
				key: "right",
				label: "右"
			},
			{
				key: "bottom",
				label: "下"
			}
		];
		/** 新 box 的默认位置（相对包围盒 30%–70%）。 */
		const DEFAULT_TOUCH_BOX = {
			left: .3,
			top: .3,
			right: .7,
			bottom: .7
		};
		/** 生成不重复的部位 id（part-1、part-2……）。 */
		function nextTouchPartId(parts) {
			const used = new Set(parts.map((part) => part.id));
			let index = parts.length + 1;
			let id = `part-${index}`;
			while (used.has(id)) {
				index += 1;
				id = `part-${index}`;
			}
			return id;
		}
		/** 读取当前选中模型的部位 + 事件绑定（GET；Host 不可达返回 null）。 */
		async function loadTouchParts() {
			try {
				const response = await fetch(TOUCH_PARTS_API);
				if (!response.ok) return null;
				return await response.json();
			} catch {
				return null;
			}
		}
		/**
		* 保存当前模型的部位草稿 + 可选事件绑定覆盖层（POST；Host 不可达返回 null）。
		* events 为 undefined 时**不写**该字段（保留已有覆盖）；传对象时整表写入。
		*/
		async function saveTouchPartsToHost(model, parts, events) {
			try {
				const response = await fetch(TOUCH_PARTS_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						model,
						parts,
						...events !== void 0 ? { events } : {}
					})
				});
				if (!response.ok) return {
					ok: false,
					error: `HTTP ${response.status}`
				};
				const data = await response.json();
				return {
					ok: data?.ok !== false,
					error: data?.error ?? null
				};
			} catch {
				return null;
			}
		}
		/** GET /state 的当前生效事件绑定（GET 的 events 缺失时兜底）。 */
		async function loadStateEvents() {
			try {
				const response = await fetch(STATE_API);
				if (!response.ok) return cloneEventBindings(DEFAULT_EVENT_BINDINGS);
				return eventBindingsFromApi((await response.json())?.config?.events);
			} catch {
				return cloneEventBindings(DEFAULT_EVENT_BINDINGS);
			}
		}
		/**
		* 当前模型 → 可 fetch 的 .model3.json URL（仅内置「简」）：从 /state 的
		* config.modelUrl 取；不可达/尚未同步时返回 null（动作组多选降级为空）。
		*/
		async function resolveSelectedModelUrl(model) {
			try {
				const response = await fetch(STATE_API);
				if (!response.ok) return null;
				const config = (await response.json())?.config;
				if (config?.model === model && typeof config.modelUrl === "string" && config.modelUrl) return config.modelUrl;
			} catch {}
			return null;
		}
		const SETTINGS_API = "/api/dsh-waifu/settings";
		const STATE_API = "/api/dsh-waifu/state";
		const TOUCH_PARTS_API = "/api/dsh-waifu/touch-parts";
		const AI_OPTIONS_API = "/api/dsh-waifu/ai-options";
		const AI_CHECK_API = "/api/dsh-waifu/ai-check";
		const PERSONA_API = "/api/dsh-waifu/persona";
		const C = {
			bgBase: "var(--dsw-alias-bg-base)",
			bgLayer1: "var(--dsw-alias-bg-layer-1)",
			bgLayer2: "var(--dsw-alias-bg-layer-2)",
			bgOverlay: "var(--dsw-alias-bg-overlay)",
			borderL1: "var(--dsw-alias-border-l1)",
			borderL2: "var(--dsw-alias-border-l2)",
			textPrimary: "var(--dsw-alias-label-primary)",
			textSecondary: "var(--dsw-alias-label-secondary)",
			brand: "var(--dsw-alias-brand-primary)",
			error: "var(--dsw-alias-state-error-primary)",
			success: "var(--dsw-alias-state-success-primary)",
			warn: "var(--dsw-alias-state-warn-primary)",
			idle: "var(--dsw-alias-state-idle-primary)"
		};
		/** 间距网格（4/8/12/16/24/32；分组之间 28）。 */
		const GAP = {
			xs: 4,
			sm: 8,
			md: 12,
			lg: 16,
			xl: 24,
			section: 28
		};
		/** Section：标题 15/600 primary + 说明 12 secondary + 右侧可选操作，组间距 28。 */
		const sectionStyle = { marginTop: GAP.section };
		/** 分组头：标题行（标题 + 右侧操作）在上，说明独占整行宽度在下方。 */
		const sectionHeaderStyle = {
			display: "flex",
			flexDirection: "column",
			alignItems: "stretch",
			gap: 0,
			marginBottom: GAP.sm
		};
		const sectionHeaderTitleRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: GAP.sm,
			minWidth: 0
		};
		const sectionHeadingStyle = {
			margin: 0,
			fontSize: 15,
			fontWeight: 600,
			color: C.textPrimary,
			lineHeight: 1.4
		};
		const sectionDescStyle = {
			margin: "4px 0 0",
			fontSize: 12,
			color: C.textSecondary,
			lineHeight: 1.6
		};
		const sectionHeaderActionStyle = {
			flexShrink: 0,
			display: "flex",
			alignItems: "center",
			gap: GAP.sm
		};
		/** 卡片内标题 13/600 primary。 */
		const cardHeadingStyle = {
			fontSize: 13,
			fontWeight: 600,
			color: C.textPrimary,
			marginBottom: GAP.sm
		};
		/** 统一 SectionHeader：标题 + 说明（放标题下方）+ 右侧可选操作。 */
		function SectionHeader(props) {
			const { title, description, action } = props;
			return (0, react.createElement)("div", { style: sectionHeaderStyle }, (0, react.createElement)("div", { style: sectionHeaderTitleRowStyle }, (0, react.createElement)("h3", { style: sectionHeadingStyle }, title), action !== void 0 ? (0, react.createElement)("div", { style: sectionHeaderActionStyle }, action) : null), description !== void 0 ? (0, react.createElement)("div", { style: sectionDescStyle }, description) : null);
		}
		/** Card：容器 0 padding；标题行/内容区分别控制，卡片间距 10。 */
		const cardStyle = {
			background: C.bgLayer1,
			border: `1px solid ${C.borderL1}`,
			borderRadius: 10,
			marginBottom: 10,
			color: C.textPrimary
		};
		const rowStyle = {
			...cardStyle,
			padding: "12px 14px"
		};
		const labelStyle = {
			display: "flex",
			alignItems: "center",
			gap: GAP.sm,
			cursor: "pointer",
			flex: 1,
			minWidth: 0,
			fontSize: 13,
			color: C.textPrimary
		};
		const hintStyle = {
			fontSize: 12,
			color: C.textSecondary,
			lineHeight: 1.6
		};
		/** CardHeader：一行 flex；[chevron][标题][摘要 flex1][右侧操作组]。 */
		const cardHeaderRowStyle = {
			display: "flex",
			alignItems: "center",
			gap: GAP.sm,
			padding: "12px 14px",
			minHeight: 44,
			boxSizing: "border-box"
		};
		const cardHeaderButtonStyle = {
			display: "flex",
			alignItems: "center",
			gap: GAP.sm,
			flex: 1,
			minWidth: 0,
			margin: 0,
			padding: 0,
			border: "none",
			background: "transparent",
			color: "inherit",
			fontFamily: "inherit",
			textAlign: "left",
			cursor: "pointer",
			outline: "none"
		};
		const cardHeaderActionsStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "flex-end",
			gap: 6,
			flexShrink: 0
		};
		const cardTitleStyle = {
			fontSize: 13,
			fontWeight: 600,
			color: C.textPrimary
		};
		const cardSummaryStyle = {
			fontSize: 12,
			color: C.textSecondary,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const cardBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: GAP.sm,
			padding: "0 14px 12px"
		};
		const chevronStyle = {
			width: 20,
			height: 20,
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			flexShrink: 0,
			borderRadius: 6,
			color: C.textSecondary,
			fontSize: 11,
			lineHeight: 1,
			transition: "transform .15s"
		};
		const chevronButtonStyle = {
			...chevronStyle,
			padding: 0,
			border: "none",
			background: "transparent",
			cursor: "pointer"
		};
		/** Buttons：统一 height 28 / padding 0 12 / radius 8 / font 12，明确边框与背景。 */
		const buttonBaseStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			height: 28,
			padding: "0 12px",
			borderRadius: 8,
			fontSize: 12,
			lineHeight: 1,
			fontFamily: "inherit",
			whiteSpace: "nowrap",
			flexShrink: 0,
			cursor: "pointer",
			border: "1px solid transparent",
			background: "transparent",
			color: C.textPrimary
		};
		/** secondary：layer-2 背景 + 1px border-l2 + label-primary。 */
		const buttonSecondaryStyle = {
			...buttonBaseStyle,
			background: C.bgLayer2,
			borderColor: C.borderL2
		};
		/** primary：brand 填充 + 白字。 */
		const buttonPrimaryStyle = {
			...buttonBaseStyle,
			background: C.brand,
			borderColor: C.brand,
			color: "#ffffff"
		};
		/** danger：error 边框 + error 文字 + 极浅 error 背景。 */
		const buttonDangerStyle = {
			...buttonBaseStyle,
			background: `color-mix(in srgb, ${C.error} 10%, transparent)`,
			borderColor: C.error,
			color: C.error
		};
		/** Input / Textarea：height 28 / radius 8 / border-l1 / font 13；focus 边框 brand（注入 CSS）。 */
		const inputStyle = {
			boxSizing: "border-box",
			height: 28,
			padding: "0 8px",
			borderRadius: 8,
			border: `1px solid ${C.borderL1}`,
			background: C.bgBase,
			color: C.textPrimary,
			fontSize: 13,
			fontFamily: "inherit",
			minWidth: 0,
			flex: 1,
			outline: "none"
		};
		/** 原生下拉：和输入框同尺寸（provider / 模型选择用）。 */
		const selectStyle = {
			...inputStyle,
			appearance: "none",
			paddingRight: 8,
			cursor: "pointer"
		};
		/** 台词输入框：固定高度（不随行数伸缩、不可拖拽），超出滚动。 */
		const textareaStyle = {
			...inputStyle,
			height: 96,
			minHeight: 96,
			maxHeight: 96,
			padding: "6px 8px",
			lineHeight: 1.45,
			overflowY: "auto",
			resize: "none"
		};
		const chipStyle = {
			display: "inline-flex",
			alignItems: "center",
			height: 20,
			padding: "0 8px",
			borderRadius: 999,
			background: C.bgLayer2,
			color: C.textSecondary,
			fontSize: 12,
			lineHeight: 1,
			whiteSpace: "nowrap",
			flexShrink: 0
		};
		const statusTextStyle = {
			fontSize: 12,
			lineHeight: 1.5
		};
		/** 表单行：grid 96px label + 1fr 控件；行距 8；textarea 行顶部对齐。 */
		const formRowStyle = {
			display: "grid",
			gridTemplateColumns: "96px minmax(0,1fr)",
			alignItems: "center",
			columnGap: GAP.md,
			marginBottom: GAP.sm
		};
		const formRowStartStyle = {
			...formRowStyle,
			alignItems: "start"
		};
		const formLabelStyle = {
			fontSize: 12,
			color: C.textSecondary,
			lineHeight: 1.5
		};
		const formLabelStartStyle = {
			...formLabelStyle,
			paddingTop: 6
		};
		const formControlStyle = {
			minWidth: 0,
			display: "flex",
			alignItems: "center",
			gap: GAP.sm
		};
		/**
		* 单行表单行：label 占满左侧剩余空间（不换行、不被挤扁），控件靠右固定宽度。
		* 比 96px 固定 label 列更省地方——「中心距右（% 窗口宽）」这类长 label 也能一行排下。
		*/
		const formRowInlineStyle = {
			display: "flex",
			alignItems: "center",
			gap: GAP.md,
			marginBottom: GAP.sm
		};
		const formLabelInlineStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			fontSize: 12,
			color: C.textSecondary,
			lineHeight: 1.5,
			whiteSpace: "nowrap"
		};
		/** 行内控件组：靠右、不参与 label 的拉伸。 */
		const formControlInlineStyle = {
			flex: "0 0 auto",
			display: "flex",
			alignItems: "center",
			gap: GAP.sm
		};
		/** box 编辑表格：列宽固定（# 24 / 四项 1fr / 删除 56）。 */
		const boxGridStyle = {
			display: "grid",
			gridTemplateColumns: "24px repeat(4, minmax(0, 1fr)) 56px",
			columnGap: GAP.sm,
			alignItems: "center"
		};
		const boxHeaderCellStyle = {
			fontSize: 12,
			color: C.textSecondary
		};
		const boxCellInputStyle = {
			...inputStyle,
			width: "100%",
			flex: "none"
		};
		/** 卡片头固定尺寸操作按钮。 */
		const moveButtonStyle = {
			...buttonSecondaryStyle,
			width: 34,
			minWidth: 34,
			padding: 0
		};
		const deletePartButtonStyle = {
			...buttonDangerStyle,
			width: 88,
			minWidth: 88,
			padding: 0
		};
		const deleteBoxButtonStyle = {
			...buttonDangerStyle,
			width: 56,
			minWidth: 56,
			padding: 0
		};
		/** 状态提示：已保存 success / 未保存 warn / 失败 error / 中性 secondary。 */
		const noticeBaseStyle = {
			margin: "0 0 8px",
			fontSize: 12,
			lineHeight: 1.6
		};
		const noticeErrorStyle = {
			...noticeBaseStyle,
			color: C.error
		};
		const noticeMutedStyle = {
			...noticeBaseStyle,
			color: C.textSecondary
		};
		/** 组内 sticky 保存行（半透明 + 模糊，避免遮挡内容时突兀）。 */
		const stickyRowStyle = {
			position: "sticky",
			top: 0,
			zIndex: 2,
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: GAP.sm,
			padding: "8px 12px",
			marginBottom: GAP.sm,
			borderRadius: 8,
			background: C.bgLayer2,
			backdropFilter: "blur(6px)",
			WebkitBackdropFilter: "blur(6px)",
			border: `1px solid ${C.borderL1}`
		};
		const MAX_FPS_OPTIONS = [
			{
				id: "30",
				name: "30"
			},
			{
				id: "60",
				name: "60"
			},
			{
				id: "0",
				name: "不限制帧率"
			}
		];
		/** 归一化设置里的帧率档（非法值回落默认 30）。 */
		function normalizeMaxFps$1(raw) {
			if (raw === 60 || raw === 0) return raw;
			return 30;
		}
		/**
		* 「动作 / 表情」混选选项（ADR-023 / ADR-024）：动作组与表情各成一组。
		* 动作组组内互斥；表情只在模型定义的互斥组（眼部 / 皮肤）内互斥，其余可叠加。
		* current 里可能出现模型没解析到的旧动作组名字（保证 tag 能显示）。
		*/
		function motionSelectionOptions(motionGroups, current = []) {
			const options = [];
			const taken = /* @__PURE__ */ new Set();
			for (const raw of [...motionGroups, ...current]) {
				const id = typeof raw === "string" ? raw.trim() : "";
				if (!id || taken.has(id) || isExpressionId(id)) continue;
				taken.add(id);
				options.push({
					id,
					name: motionLabel(id),
					group: "动作",
					exclusive: "motion"
				});
			}
			for (const expression of EXPRESSIONS) {
				if (expression.id === "none" || taken.has(expression.id)) continue;
				taken.add(expression.id);
				options.push({
					id: expression.id,
					name: expression.name,
					group: "表情",
					exclusive: expression.exclusive
				});
			}
			return options;
		}
		/** 混选里的单项显示名：表情走表情表、其余当动作组（未知 id 回退原名）。 */
		function selectionOptionLabel(id) {
			return isExpressionId(id) ? expressionLabel(id) : motionLabel(id);
		}
		/** 混选标签文案（卡片摘要用）：动作组 + 表情（可多个）。 */
		function motionSelectionLabel(selection) {
			const { motion, expressions } = splitMotionSelection(selection);
			const parts = [];
			if (motion) parts.push(motionLabel(motion));
			for (const expression of expressions) parts.push(expressionLabel(expression));
			return parts.join(" + ");
		}
		/** 画布留白（%）：clamp 到 0–300 的整数；非法值回落 fallback。 */
		function normalizeCanvasPad(raw, fallback) {
			const n = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(300, Math.max(0, Math.round(n)));
		}
		/** 默认停靠位置（px）：clamp 到 0–4000 的整数；非法值回落 fallback。 */
		function normalizeHomePosition(raw, fallback) {
			const n = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(100, Math.max(0, Math.round(n)));
		}
		/** 气泡偏移（px）：clamp 到 -1000–1000 的整数；非法值回落 fallback。 */
		function normalizeBubbleOffset(raw, fallback) {
			const n = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(1e3, Math.max(-1e3, Math.round(n)));
		}
		/** 气泡背景不透明度（0–100 整数）；非法值回落 fallback。 */
		function normalizeBubbleOpacity(raw, fallback) {
			const n = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(100, Math.max(0, Math.round(n)));
		}
		/** 气泡最长显示秒数（0–600 整数，0 = 不限）；非法值回落 fallback。 */
		function normalizeBubbleMax(raw, fallback) {
			const n = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(n)) return fallback;
			return Math.min(600, Math.max(0, Math.round(n)));
		}
		/** 颜色值统一为小写 #rrggbb；非法值回落 fallback。 */
		function normalizeHexColor(raw, fallback) {
			if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) return raw.trim().toLowerCase();
			return fallback;
		}
		/** 本地时间 HH:MM:SS（页面级保存状态栏显示「已保存 HH:MM:SS」）。 */
		function formatClock(date) {
			const pad = (n) => String(n).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
		}
		/** 选中态强调色（与设置页其它高亮一致，贴近系统 radio 蓝点观感）。 */
		const RADIO_ACCENT = C.brand;
		const RADIO_RING = C.borderL2;
		/** 自绘圆点：帧率档与模型列表共用，避免原生 radio 深色主题白框。 */
		function ThemeRadioDot(props) {
			const { selected } = props;
			return (0, react.createElement)("span", {
				"aria-hidden": true,
				style: {
					width: 14,
					height: 14,
					borderRadius: "50%",
					boxSizing: "border-box",
					border: `1.5px solid ${selected ? RADIO_ACCENT : RADIO_RING}`,
					background: "transparent",
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					flexShrink: 0
				}
			}, selected ? (0, react.createElement)("span", { style: {
				width: 6,
				height: 6,
				borderRadius: "50%",
				background: RADIO_ACCENT
			} }) : null);
		}
		/** 可点的圆点 + 文案行（帧率横排 / 模型行复用）。 */
		function ThemeRadioOption(props) {
			const { selected, disabled, onSelect, children, style } = props;
			return (0, react.createElement)("button", {
				type: "button",
				role: "radio",
				"aria-checked": selected,
				disabled: !!disabled,
				onClick: () => {
					if (!disabled && !selected) onSelect();
				},
				style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 8,
					margin: 0,
					padding: 0,
					border: "none",
					background: "transparent",
					color: "inherit",
					font: "inherit",
					fontSize: 13,
					cursor: disabled ? "not-allowed" : "pointer",
					outline: "none",
					minWidth: 0,
					...style
				}
			}, (0, react.createElement)(ThemeRadioDot, { selected }), children);
		}
		/** 自绘圆形单选组：一行多档；圆点走 ThemeRadioDot。 */
		function ThemeRadioGroup(props) {
			const { value, options, disabled, name, onChange } = props;
			return (0, react.createElement)("div", {
				role: "radiogroup",
				"aria-label": name,
				style: {
					display: "flex",
					flexWrap: "wrap",
					alignItems: "center",
					gap: "8px 16px",
					opacity: disabled ? .55 : 1
				}
			}, options.map((o) => (0, react.createElement)(ThemeRadioOption, {
				key: o.id,
				selected: o.id === value,
				disabled,
				onSelect: () => onChange(o.id),
				children: (0, react.createElement)("span", null, o.name)
			})));
		}
		/** 自绘 switch：用于开发者选项总开关等“组标题右侧开关”场景。 */
		function ThemeSwitch(props) {
			const { checked, disabled, onChange } = props;
			return (0, react.createElement)("button", {
				type: "button",
				role: "switch",
				"aria-checked": checked,
				disabled: !!disabled,
				onClick: () => {
					if (!disabled) onChange(!checked);
				},
				style: {
					position: "relative",
					width: 38,
					height: 20,
					flexShrink: 0,
					padding: 0,
					border: "none",
					borderRadius: 10,
					cursor: disabled ? "not-allowed" : "pointer",
					background: checked ? RADIO_ACCENT : C.borderL2,
					opacity: disabled ? .55 : 1,
					transition: "background .15s",
					outline: "none"
				}
			}, (0, react.createElement)("span", { style: {
				position: "absolute",
				top: 2,
				left: checked ? 20 : 2,
				width: 16,
				height: 16,
				borderRadius: "50%",
				background: C.textPrimary,
				boxShadow: "0 1px 3px rgba(0,0,0,.4)",
				transition: "left .15s"
			} }));
		}
		/** 多选下拉：选中项以 tag 展示在主按钮内；点击下拉项切换选中，保持打开以支持连续多选。 */
		function ThemeMultiSelect(props) {
			const { value, options, disabled, placeholder, exclusive, onChange } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const listRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onDoc = (e) => {
					if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
				};
				const onKey = (e) => {
					if (e.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onDoc);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onDoc);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const list = listRef.current;
				const item = list?.querySelector("[aria-selected=\"true\"]");
				if (!list || !item) return;
				const top = item.offsetTop - 8;
				const bottom = top + item.offsetHeight + 8;
				if (top < list.scrollTop) list.scrollTop = top;
				else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
			}, [open]);
			/** 按 group 首次出现顺序切块；无 group 的选项归到空标题组（不渲染标题）。 */
			const blocks = [];
			for (const option of options) {
				const label = option.group ?? "";
				const last = blocks[blocks.length - 1];
				if (last && last.label === label) last.items.push(option);
				else blocks.push({
					label,
					items: [option]
				});
			}
			const toggle = (option) => {
				if (value.includes(option.id)) {
					onChange(value.filter((id) => id !== option.id));
					return;
				}
				if (!exclusive || !option.exclusive) {
					onChange([...value, option.id]);
					return;
				}
				const keep = value.filter((id) => {
					return options.find((item) => item.id === id)?.exclusive !== option.exclusive;
				});
				onChange([...keep, option.id]);
			};
			return (0, react.createElement)("div", {
				ref: rootRef,
				style: {
					position: "relative",
					flex: 1,
					minWidth: 0
				}
			}, (0, react.createElement)("button", {
				type: "button",
				disabled: !!disabled,
				"aria-haspopup": "listbox",
				"aria-expanded": open,
				onClick: () => {
					if (!disabled) setOpen((v) => !v);
				},
				style: {
					...inputStyle,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 8,
					width: "100%",
					minHeight: 28,
					textAlign: "left",
					cursor: disabled ? "not-allowed" : "pointer",
					background: C.bgLayer2,
					outline: "none",
					boxShadow: "none",
					opacity: disabled ? .55 : 1
				}
			}, (0, react.createElement)("span", { style: {
				display: "flex",
				flexWrap: "wrap",
				gap: 4,
				alignItems: "center",
				flex: 1,
				minWidth: 0
			} }, value.length === 0 ? (0, react.createElement)("span", { style: { color: C.textSecondary } }, placeholder ?? "选择动作组") : [...new Set(value)].map((id) => (0, react.createElement)("span", {
				key: id,
				style: {
					height: 20,
					padding: "0 8px",
					display: "inline-flex",
					alignItems: "center",
					borderRadius: 999,
					background: C.bgLayer2,
					color: C.textPrimary,
					fontSize: 12,
					whiteSpace: "nowrap"
				}
			}, selectionOptionLabel(id)))), (0, react.createElement)("span", { style: {
				color: C.textSecondary,
				fontSize: 10,
				flexShrink: 0
			} }, open ? "▴" : "▾")), open && (0, react.createElement)("div", {
				ref: listRef,
				role: "listbox",
				"aria-multiselectable": true,
				style: {
					position: "absolute",
					left: 0,
					right: 0,
					top: "calc(100% + 4px)",
					zIndex: 20,
					margin: 0,
					padding: 4,
					borderRadius: 8,
					border: `1px solid ${C.borderL1}`,
					background: C.bgOverlay,
					color: C.textPrimary,
					boxShadow: "0 8px 24px rgba(0,0,0,.45)",
					maxHeight: 240,
					overflowY: "auto"
				}
			}, blocks.map((block, blockIndex) => (0, react.createElement)(react.Fragment, { key: `block-${blockIndex}` }, block.label ? (0, react.createElement)("div", { style: {
				padding: "6px 10px 2px",
				fontSize: 11,
				letterSpacing: ".08em",
				color: C.textSecondary
			} }, block.label) : null, block.items.map((o) => {
				const selected = value.includes(o.id);
				return (0, react.createElement)("button", {
					key: o.id,
					type: "button",
					role: "option",
					"aria-selected": selected,
					onClick: () => toggle(o),
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6,
						width: "100%",
						margin: 0,
						padding: "6px 10px",
						border: "none",
						borderRadius: 6,
						textAlign: "left",
						cursor: "pointer",
						fontSize: 13,
						color: C.textPrimary,
						background: selected ? C.bgLayer2 : "transparent",
						outline: "none"
					},
					onMouseEnter: (e) => {
						if (!selected) e.currentTarget.style.background = C.bgLayer2;
					},
					onMouseLeave: (e) => {
						e.currentTarget.style.background = selected ? C.bgLayer2 : "transparent";
					}
				}, (0, react.createElement)("span", { style: {
					width: 14,
					flexShrink: 0,
					textAlign: "center"
				} }, selected ? "☑" : "☐"), o.name);
			})))));
		}
		/** 读取设置（GET）。 */
		async function loadSettings() {
			try {
				const response = await fetch(SETTINGS_API);
				if (!response.ok) return null;
				return await response.json();
			} catch {
				return null;
			}
		}
		/** 写入设置（POST 路径 op；返回写后视图）。 */
		async function writeSettings(ops) {
			try {
				const response = await fetch(SETTINGS_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ops })
				});
				if (!response.ok) return null;
				return await response.json();
			} catch {
				return null;
			}
		}
		function PetSettingsSection(_props) {
			const [state, setState] = (0, react.useState)({
				status: "loading",
				writable: false
			});
			const stateRef = (0, react.useRef)(state);
			const setSettingsState = (next) => {
				const resolved = typeof next === "function" ? next(stateRef.current) : next;
				stateRef.current = resolved;
				setState(resolved);
			};
			const reload = (0, react.useCallback)(() => {
				loadSettings().then((view) => {
					if (view === null) {
						setSettingsState((prev) => prev.status === "ready" ? prev : {
							status: "unavailable",
							writable: false
						});
						return;
					}
					setSettingsState({
						status: "ready",
						value: view.value,
						writable: view.writable !== false,
						error: view.error ?? null
					});
				});
			}, []);
			(0, react.useEffect)(() => {
				reload();
			}, [reload]);
			const value = state.value ?? DEFAULT_VALUE;
			const writable = state.writable;
			/** 当前选中模型（设置未就绪时为空，事件绑定/触摸部位分组暂不加载）。 */
			const selectedModel = state.status === "ready" ? value.model : "";
			const [draftSize, setDraftSize] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setDraftSize(null);
			}, [value.size]);
			const size = draftSize ?? value.size;
			const commitSize = () => {
				if (draftSize === null) return;
				const nextSize = draftSize;
				enqueueWrite(() => [{
					op: "set",
					path: ["size"],
					value: nextSize
				}]);
				setDraftSize(null);
			};
			const [resetNotice, setResetNotice] = (0, react.useState)(null);
			const resetNoticeTimer = (0, react.useRef)(null);
			/** 归位：广播命令给宠物半边，按「显示区中心距右/距下」重新计算位置并持久化。 */
			const requestRecenter = () => {
				emitRecenter();
				setResetNotice("已归位");
				if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current);
				resetNoticeTimer.current = setTimeout(() => setResetNotice(null), 2e3);
			};
			const writeQueue = (0, react.useRef)(Promise.resolve());
			const enqueueWrite = (compose) => {
				writeQueue.current = writeQueue.current.then(async () => {
					const view = await writeSettings(compose(stateRef.current.value ?? DEFAULT_VALUE));
					if (view !== null) setSettingsState({
						status: "ready",
						value: view.value,
						writable: view.writable !== false,
						error: view.error ?? null
					});
				});
			};
			/**
			* 捕捉：向宠物半边要「角色现在的位置」，换算成「显示中心距右/距下」的百分比后写成新的默认位置。
			* 百分比按视口宽/高算（与 homePositionFromConfig 一致），所以换窗口尺寸后仍落在同一相对位置。
			*/
			const requestCapture = () => {
				emitCaptureHome((home) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["homeRight"],
						value: home.right
					}, {
						op: "set",
						path: ["homeBottom"],
						value: home.bottom
					}]);
					setResetNotice(`已捕捉默认位置：${home.right}% / ${home.bottom}%`);
					if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current);
					resetNoticeTimer.current = setTimeout(() => setResetNotice(null), 2400);
				});
			};
			const [aiOptions, setAiOptions] = (0, react.useState)(null);
			const [personaDraft, setPersonaDraft] = (0, react.useState)(null);
			const [personaStatus, setPersonaStatus] = (0, react.useState)(null);
			const [personaSaving, setPersonaSaving] = (0, react.useState)(false);
			const [aiCheckStatus, setAiCheckStatus] = (0, react.useState)(null);
			const [aiChecking, setAiChecking] = (0, react.useState)(false);
			/** 连通性自检：真实发一次请求，把成功台词或失败原因就地显示（排查 provider 差异用）。 */
			const checkAi = () => {
				if (aiChecking) return;
				setAiChecking(true);
				setAiCheckStatus(null);
				fetch(`${AI_CHECK_API}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						provider: value.aiProvider,
						model: value.aiModel
					})
				}).then((res) => res.ok ? res.json() : null).then((result) => {
					if (!result) {
						setAiCheckStatus({
							ok: false,
							text: "请求失败"
						});
						return;
					}
					setAiCheckStatus(result.ok ? {
						ok: true,
						text: result.text ?? "（空回复）"
					} : {
						ok: false,
						text: result.error ?? "未知错误"
					});
				}).catch(() => setAiCheckStatus({
					ok: false,
					text: "请求异常"
				})).finally(() => setAiChecking(false));
			};
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetch(`${AI_OPTIONS_API}`).then((res) => res.ok ? res.json() : null).then((view) => {
					if (!cancelled) setAiOptions(view);
				}).catch(() => {
					if (!cancelled) setAiOptions(null);
				});
				return () => {
					cancelled = true;
				};
			}, []);
			const aiEnabled = value.aiEnabled;
			(0, react.useEffect)(() => {
				if (!aiEnabled) return;
				let cancelled = false;
				fetch(`${PERSONA_API}`).then((res) => res.ok ? res.json() : null).then((view) => {
					if (cancelled || typeof view?.text !== "string") return;
					setPersonaDraft(view.text);
				}).catch(() => {
					if (!cancelled) setPersonaStatus("人设读取失败");
				});
				return () => {
					cancelled = true;
				};
			}, [aiEnabled]);
			/** 保存人设到 $DSH_HOME/waifu/persona.md。 */
			const savePersona = () => {
				if (personaDraft === null || personaSaving) return;
				setPersonaSaving(true);
				setPersonaStatus(null);
				fetch(`${PERSONA_API}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: personaDraft })
				}).then((res) => res.ok ? res.json() : null).then((view) => {
					setPersonaStatus(view === null ? "保存失败" : "已保存，下一次触摸生效");
				}).catch(() => setPersonaStatus("保存失败")).finally(() => setPersonaSaving(false));
			};
			const modelDraftRef = (0, react.useRef)("");
			const [touchDraft, setTouchDraft] = (0, react.useState)([]);
			const touchDraftRef = (0, react.useRef)([]);
			const [eventBindings, setEventBindings] = (0, react.useState)(() => cloneEventBindings(DEFAULT_EVENT_BINDINGS));
			const eventBindingsRef = (0, react.useRef)(eventBindings);
			const [partStatus, setPartStatus] = (0, react.useState)("idle");
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [touchEditing, setTouchEditing] = (0, react.useState)(false);
			const touchEditingRef = (0, react.useRef)(false);
			const [expandedPartId, setExpandedPartId] = (0, react.useState)(null);
			const expandedPartRef = (0, react.useRef)(null);
			/** 部位粒度 dirty（partId 集合）+ 结构变更（新建/删除/上下移没有卡片可挂提示）。 */
			const [dirtyPartIds, setDirtyPartIds] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const dirtyPartIdsRef = (0, react.useRef)(/* @__PURE__ */ new Set());
			const [structureDirty, setStructureDirty] = (0, react.useState)(false);
			const structureDirtyRef = (0, react.useRef)(false);
			/** 事件粒度 dirty（event key 集合）。 */
			const [dirtyEventKeys, setDirtyEventKeys] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const dirtyEventKeysRef = (0, react.useRef)(/* @__PURE__ */ new Set());
			const eventsDirty = dirtyEventKeys.size > 0;
			const [saveState, setSaveState] = (0, react.useState)("idle");
			/** 触摸部位分组级「已保存」提示（结构变更保存时，约 3 秒）。 */
			const [touchSavedFlash, setTouchSavedFlash] = (0, react.useState)(null);
			/** 部位卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
			const [savedPartFlash, setSavedPartFlash] = (0, react.useState)(null);
			const savedPartTimer = (0, react.useRef)(null);
			/** 事件卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
			const [savedEventFlash, setSavedEventFlash] = (0, react.useState)(null);
			const savedEventTimer = (0, react.useRef)(null);
			/** 本次保存的来源（部位卡 / 结构行 / 事件卡），用于决定「已保存」提示落在哪里。 */
			const saveSourceRef = (0, react.useRef)(null);
			const flashTimers = (0, react.useRef)({});
			/** 事件卡片展开状态（默认全部折叠；切换模型时重置）。 */
			const [expandedEventKeys, setExpandedEventKeys] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const partsDirty = dirtyPartIds.size > 0 || structureDirty;
			const [motionGroups, setMotionGroups] = (0, react.useState)([]);
			const [motionGroupsStatus, setMotionGroupsStatus] = (0, react.useState)("idle");
			/** 写入串行化：避免并发 POST 在 Host 端出现读改写丢失。 */
			const saveQueue = (0, react.useRef)(Promise.resolve());
			/** 草稿编辑版本号：保存响应回来时据此判断是否还有更新改动未保存。 */
			const editVersionRef = (0, react.useRef)(0);
			const saveSeq = (0, react.useRef)(0);
			const loadSeq = (0, react.useRef)(0);
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			/** 动作组解析重试。 */
			const [motionReloadKey, setMotionReloadKey] = (0, react.useState)(0);
			/** 部位台词 textarea 原始输入缓冲（按部位 id）：保留换行/空行，落盘前再清洗。 */
			const [partLineDrafts, setPartLineDrafts] = (0, react.useState)({});
			/** 事件台词 textarea 原始输入缓冲（按 `${event}:${stage}`）：同上。 */
			const [eventLineDrafts, setEventLineDrafts] = (0, react.useState)({});
			const readOnly = !writable || partStatus !== "ready";
			const setExpandedPart = (id) => {
				expandedPartRef.current = id;
				setExpandedPartId(id);
			};
			/** 广播当前编辑态草稿（宠物悬浮层实时重绘 box；只影响预览，不影响编辑权限）。 */
			const emitTouchDraft = (active, parts, highlight) => {
				const model = modelDraftRef.current;
				if (!model) return;
				emitTouchEdit({
					active,
					model,
					parts: cloneTouchParts(parts),
					highlightPartId: highlight
				});
			};
			/** 触摸部位分组级「已保存 HH:MM:SS」（结构变更保存时，约 3 秒）。 */
			const showTouchSavedFlash = (time) => {
				setTouchSavedFlash(time);
				const existing = flashTimers.current.touch;
				if (existing !== void 0) clearTimeout(existing);
				flashTimers.current.touch = setTimeout(() => setTouchSavedFlash(null), 3e3);
			};
			/** 事件卡片就地「已保存 HH:MM:SS」（约 3 秒）。 */
			const flashSavedEvent = (event, time) => {
				setSavedEventFlash({
					event,
					time
				});
				if (savedEventTimer.current !== null) clearTimeout(savedEventTimer.current);
				savedEventTimer.current = setTimeout(() => setSavedEventFlash(null), 3e3);
			};
			/** 部位卡片就地「已保存 HH:MM:SS」（约 3 秒，与脏提示同位置替换）。 */
			const flashSavedPart = (partId, time) => {
				setSavedPartFlash({
					partId,
					time
				});
				setTouchSavedFlash(null);
				if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current);
				savedPartTimer.current = setTimeout(() => setSavedPartFlash(null), 3e3);
			};
			/** 某部位字段变化：只把该部位标记为 dirty。 */
			const markPartDirty = (id) => {
				if (dirtyPartIdsRef.current.has(id)) return;
				const next = new Set(dirtyPartIdsRef.current);
				next.add(id);
				dirtyPartIdsRef.current = next;
				setDirtyPartIds(next);
			};
			/** 结构变化（新建/删除/上移/下移）：没有卡片可挂提示，置结构 dirty。 */
			const markStructureDirty = () => {
				structureDirtyRef.current = true;
				setStructureDirty(true);
			};
			/** 事件卡片字段变化：只把该事件标记为 dirty。 */
			const markEventDirty = (event) => {
				if (dirtyEventKeysRef.current.has(event)) return;
				const next = new Set(dirtyEventKeysRef.current);
				next.add(event);
				dirtyEventKeysRef.current = next;
				setDirtyEventKeys(next);
			};
			/** 保存成功：清空全部部位/结构/事件 dirty。 */
			const clearAllDirty = () => {
				dirtyPartIdsRef.current = /* @__PURE__ */ new Set();
				structureDirtyRef.current = false;
				dirtyEventKeysRef.current = /* @__PURE__ */ new Set();
				setDirtyPartIds(/* @__PURE__ */ new Set());
				setStructureDirty(false);
				setDirtyEventKeys(/* @__PURE__ */ new Set());
			};
			/** 是否存在未保存的部位字段/结构改动。 */
			const hasPendingParts = () => dirtyPartIdsRef.current.size > 0 || structureDirtyRef.current;
			/** 保存 payload 中的事件绑定：仅用户实际改过时携带（否则 undefined = 不写覆盖层）。 */
			const eventsForSave = () => dirtyEventKeysRef.current.size > 0 ? cloneEventBindings(eventBindingsRef.current) : void 0;
			/**
			* 串行写回草稿（{model, parts, events?}）；响应只更新保存状态，不 refetch 覆盖草稿。
			* quiet=true 用于切模型/卸载的防丢补存：只发请求 + clientLog，不改页面状态栏。
			*/
			const persistDraft = (model, parts, events, editVersion, quiet = false) => {
				const summary = `model=${model} parts=${parts.length} events=${events !== void 0 ? "yes" : "no"}`;
				saveQueue.current = saveQueue.current.then(async () => {
					const seq = ++saveSeq.current;
					if (!quiet) setSaveState("saving");
					const result = await saveTouchPartsToHost(model, parts, events);
					const isCurrent = seq === saveSeq.current && model === modelDraftRef.current;
					if (result === null) {
						clientLog("error", `touch-parts save failed: ${summary} error=host unreachable`);
						if (!quiet && isCurrent) {
							saveSourceRef.current = null;
							setSaveState("error");
						}
						return;
					}
					if (!result.ok || result.error) {
						clientLog("error", `touch-parts save failed: ${summary} error=${result.error ?? "unknown"}`);
						if (!quiet && isCurrent) {
							saveSourceRef.current = null;
							setSaveState("error");
						}
						return;
					}
					clientLog("info", `touch-parts saved: ${summary}`);
					if (quiet || !isCurrent) return;
					if (editVersion === editVersionRef.current) clearAllDirty();
					const savedTime = formatClock(/* @__PURE__ */ new Date());
					const source = saveSourceRef.current;
					saveSourceRef.current = null;
					if (source?.type === "part") flashSavedPart(source.id, savedTime);
					else if (source?.type === "structure") showTouchSavedFlash(savedTime);
					else if (source?.type === "event-card") flashSavedEvent(source.event, savedTime);
					setSaveState("idle");
				});
			};
			/** 保存动作（部位卡片「保存」/结构行/事件保存行共用）：显式写回当前完整草稿。 */
			const saveNow = () => {
				if (readOnly || !hasPendingParts() && dirtyEventKeysRef.current.size === 0) {
					saveSourceRef.current = null;
					return;
				}
				const model = modelDraftRef.current;
				if (!model) return;
				persistDraft(model, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current);
			};
			/** 部位卡片头部「保存」：成功后「已保存 HH:MM:SS」就地显示在该卡片。 */
			const savePartNow = (partId) => {
				saveSourceRef.current = {
					type: "part",
					id: partId
				};
				saveNow();
			};
			/** 结构变更行「保存」：成功后允许分组级短暂「已保存」提示。 */
			const saveStructureNow = () => {
				saveSourceRef.current = { type: "structure" };
				saveNow();
			};
			/** 事件卡片头部「保存」：成功后「已保存 HH:MM:SS」就地显示在该卡片。 */
			const saveEventCardNow = (event) => {
				saveSourceRef.current = {
					type: "event-card",
					event
				};
				saveNow();
			};
			/** 触摸部位草稿变更：更新 state/ref；仅对应部位置 dirty（不自动保存、不自动开预览）。 */
			const commitTouchDraft = (next, highlight, dirtyPartId) => {
				touchDraftRef.current = next;
				setTouchDraft(next);
				if (dirtyPartId) markPartDirty(dirtyPartId);
				editVersionRef.current += 1;
				setSaveState("idle");
				const highlightId = highlight === void 0 ? expandedPartRef.current : highlight;
				if (highlight !== void 0) setExpandedPart(highlight);
				emitTouchDraft(touchEditingRef.current, next, highlightId);
			};
			/** 事件绑定草稿变更：更新 ref/state，只把对应事件标脏（不自动保存）。 */
			const commitEventBindings = (next, dirtyEvent) => {
				eventBindingsRef.current = next;
				setEventBindings(next);
				if (dirtyEvent) markEventDirty(dirtyEvent);
				editVersionRef.current += 1;
				setSaveState("idle");
			};
			(0, react.useEffect)(() => {
				if (state.status !== "ready" || !selectedModel) return;
				const previousModel = modelDraftRef.current;
				const hadUnsaved = hasPendingParts() || dirtyEventKeysRef.current.size > 0;
				if (previousModel && previousModel !== selectedModel && hadUnsaved) persistDraft(previousModel, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current, true);
				if (touchEditingRef.current) {
					touchEditingRef.current = false;
					setTouchEditing(false);
					emitTouchDraft(false, touchDraftRef.current, expandedPartRef.current);
				}
				const seq = ++loadSeq.current;
				setPartStatus("loading");
				setLoadError(null);
				setExpandedPart(null);
				setSaveState("idle");
				clearAllDirty();
				setTouchSavedFlash(null);
				setSavedPartFlash(null);
				setSavedEventFlash(null);
				saveSourceRef.current = null;
				setExpandedEventKeys(/* @__PURE__ */ new Set());
				if (flashTimers.current.touch !== void 0) {
					clearTimeout(flashTimers.current.touch);
					flashTimers.current.touch = void 0;
				}
				if (savedPartTimer.current !== null) {
					clearTimeout(savedPartTimer.current);
					savedPartTimer.current = null;
				}
				if (savedEventTimer.current !== null) {
					clearTimeout(savedEventTimer.current);
					savedEventTimer.current = null;
				}
				touchDraftRef.current = [];
				setTouchDraft([]);
				eventBindingsRef.current = cloneEventBindings(DEFAULT_EVENT_BINDINGS);
				setEventBindings(eventBindingsRef.current);
				setPartLineDrafts({});
				setEventLineDrafts({});
				let alive = true;
				loadTouchParts().then((view) => {
					if (!alive || seq !== loadSeq.current) return;
					if (view === null) {
						setPartStatus("error");
						setLoadError("读取当前模型的配置失败（Host 不可达）");
						return;
					}
					modelDraftRef.current = view.model;
					const parts = cloneTouchParts(Array.isArray(view.parts) ? view.parts : []);
					touchDraftRef.current = parts;
					setTouchDraft(parts);
					if (view.events) {
						const draft = eventBindingsFromApi(view.events);
						eventBindingsRef.current = draft;
						setEventBindings(draft);
					} else loadStateEvents().then((draft) => {
						if (!alive || seq !== loadSeq.current) return;
						eventBindingsRef.current = draft;
						setEventBindings(draft);
					});
					setPartStatus("ready");
					setLoadError(view.error ?? null);
				});
				return () => {
					alive = false;
				};
			}, [
				selectedModel,
				state.status,
				reloadKey
			]);
			(0, react.useEffect)(() => {
				if (state.status !== "ready" || !selectedModel) return;
				let alive = true;
				setMotionGroupsStatus("loading");
				resolveSelectedModelUrl(selectedModel).then((url) => {
					if (!alive) return;
					if (!url) {
						setMotionGroups([]);
						setMotionGroupsStatus("error");
						return;
					}
					return fetchMotionGroups(url).then((groups) => {
						if (!alive) return;
						setMotionGroups(groups);
						setMotionGroupsStatus("ready");
					}).catch(() => {
						if (!alive) return;
						setMotionGroups([]);
						setMotionGroupsStatus("error");
					});
				});
				return () => {
					alive = false;
				};
			}, [
				selectedModel,
				state.status,
				motionReloadKey
			]);
			(0, react.useEffect)(() => () => {
				const model = modelDraftRef.current;
				if (!model) return;
				if (hasPendingParts() || dirtyEventKeysRef.current.size > 0) persistDraft(model, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current, true);
				if (flashTimers.current.touch !== void 0) clearTimeout(flashTimers.current.touch);
				if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current);
				if (savedEventTimer.current !== null) clearTimeout(savedEventTimer.current);
				if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current);
				emitTouchEdit({
					active: false,
					model,
					parts: cloneTouchParts(touchDraftRef.current)
				});
			}, []);
			const setEventBinding = (event, binding) => {
				commitEventBindings({
					...eventBindingsRef.current,
					[event]: binding
				}, event);
			};
			const setEventLinePool = (event, stage, raw) => {
				const current = eventBindingsRef.current[event];
				const pool = parseEventLines(raw);
				const lines = current.lines.map((existing, index) => index === stage ? pool : existing);
				setEventBinding(event, {
					...current,
					lines
				});
			};
			/** 恢复某个事件为 DEFAULT_EVENT_BINDINGS 的动作组 + 台词池。 */
			const resetEventBinding = (event) => {
				if (readOnly) return;
				const draft = normalizeEventDraft(DEFAULT_EVENT_BINDINGS[event], event);
				commitEventBindings({
					...eventBindingsRef.current,
					[event]: draft
				}, event);
				setEventLineDrafts((prev) => {
					const next = { ...prev };
					for (const key of Object.keys(next)) if (key.startsWith(`${event}:`)) delete next[key];
					return next;
				});
			};
			const toggleTouchEditing = () => {
				const next = !touchEditingRef.current;
				touchEditingRef.current = next;
				setTouchEditing(next);
				if (next && !expandedPartRef.current && touchDraftRef.current.length > 0) setExpandedPart(touchDraftRef.current[0].id);
				emitTouchDraft(next, touchDraftRef.current, expandedPartRef.current);
			};
			const updateTouchPart = (id, mutate, highlight) => {
				const next = touchDraftRef.current.map((part) => part.id === id ? mutate(part) : part);
				commitTouchDraft(next, highlight === void 0 ? id : highlight, id);
			};
			const addTouchPart = () => {
				const part = {
					id: nextTouchPartId(touchDraftRef.current),
					name: "新部位",
					boxes: [],
					motions: []
				};
				markStructureDirty();
				commitTouchDraft([part, ...touchDraftRef.current], part.id);
			};
			const removeTouchPart = (id) => {
				const next = touchDraftRef.current.filter((part) => part.id !== id);
				setPartLineDrafts((prev) => {
					if (!(id in prev)) return prev;
					const cleared = { ...prev };
					delete cleared[id];
					return cleared;
				});
				markStructureDirty();
				commitTouchDraft(next, expandedPartRef.current === id ? null : expandedPartRef.current);
			};
			/** 调整图层顺序：direction=-1 上移（更靠顶层，数组索引更小），1 下移。 */
			const moveTouchPart = (id, direction) => {
				const parts = touchDraftRef.current;
				const index = parts.findIndex((part) => part.id === id);
				const target = index + direction;
				if (index < 0 || target < 0 || target >= parts.length) return;
				const next = [...parts];
				const [moved] = next.splice(index, 1);
				next.splice(target, 0, moved);
				markStructureDirty();
				commitTouchDraft(next);
			};
			const renameTouchPart = (id, name) => {
				updateTouchPart(id, (part) => ({
					...part,
					name: name.slice(0, 24)
				}));
			};
			const setBoxField = (partId, boxIndex, key, raw) => {
				updateTouchPart(partId, (part) => ({
					...part,
					boxes: part.boxes.map((box, index) => index === boxIndex ? applyBoxField(box, key, raw) : box)
				}));
			};
			const addBox = (partId) => {
				updateTouchPart(partId, (part) => part.boxes.length >= 12 ? part : {
					...part,
					boxes: [...part.boxes, { ...DEFAULT_TOUCH_BOX }]
				});
			};
			const removeBox = (partId, boxIndex) => {
				updateTouchPart(partId, (part) => ({
					...part,
					boxes: part.boxes.filter((_box, index) => index !== boxIndex)
				}));
			};
			/** 部位「动作 / 表情」混选（最多各 1 项，见 ADR-023）。 */
			const setPartMotions = (partId, next) => {
				updateTouchPart(partId, (part) => ({
					...part,
					motions: normalizeMotionSelection(next)
				}));
			};
			/** 部位台词变更：一行一条；全空时删除 lines 字段（回退全局默认台词）。 */
			const setPartLines = (partId, raw) => {
				const lines = parsePartLines(raw);
				updateTouchPart(partId, (part) => {
					const next = { ...part };
					if (lines.length > 0) next.lines = lines;
					else delete next.lines;
					return next;
				});
			};
			const reloadAll = () => {
				setReloadKey((key) => key + 1);
			};
			const retryMotionGroups = () => {
				setMotionReloadKey((key) => key + 1);
			};
			/** 事件绑定卡片：header = [chevron][事件名][摘要][右侧操作组：脏提示/保存/恢复默认]。 */
			const renderEventCard = (event) => {
				const binding = eventBindings[event];
				const stages = eventStageLabels(event);
				const expanded = expandedEventKeys.has(event);
				const dirty = dirtyEventKeys.has(event);
				const summary = `${motionSelectionLabel(binding.motions) || "不触发"} · ${binding.lines[0]?.length ?? 0} 条台词`;
				const options = motionSelectionOptions(motionGroups, binding.motions);
				const toggleExpanded = () => {
					setExpandedEventKeys((prev) => {
						const next = new Set(prev);
						if (next.has(event)) next.delete(event);
						else next.add(event);
						return next;
					});
				};
				return (0, react.createElement)("div", {
					key: event,
					style: cardStyle
				}, (0, react.createElement)("div", {
					className: "dsh-card-header-row",
					style: cardHeaderRowStyle
				}, (0, react.createElement)("button", {
					type: "button",
					"aria-expanded": expanded,
					onClick: toggleExpanded,
					className: "dsh-card-header",
					style: cardHeaderButtonStyle
				}, (0, react.createElement)("span", { style: {
					...chevronStyle,
					transform: expanded ? "rotate(90deg)" : "none"
				} }, "▸"), (0, react.createElement)("span", { style: cardTitleStyle }, EVENT_LABELS[event]), (0, react.createElement)("span", { style: {
					...cardSummaryStyle,
					flex: 1,
					minWidth: 0
				} }, summary)), (0, react.createElement)("div", { style: cardHeaderActionsStyle }, dirty ? (0, react.createElement)("span", { style: {
					...statusTextStyle,
					color: C.warn
				} }, "● 未保存改动") : savedEventFlash?.event === event ? (0, react.createElement)("span", { style: {
					...statusTextStyle,
					color: C.success
				} }, `已保存 ${savedEventFlash.time}`) : null, dirty ? (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-primary",
					style: buttonPrimaryStyle,
					disabled: saveState === "saving" || readOnly,
					onClick: () => saveEventCardNow(event)
				}, "保存") : null, (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-secondary",
					style: buttonSecondaryStyle,
					disabled: readOnly,
					onClick: () => resetEventBinding(event)
				}, "恢复默认"))), expanded && (0, react.createElement)("div", { style: cardBodyStyle }, (0, react.createElement)("div", { style: {
					...formRowStyle,
					marginBottom: 0
				} }, (0, react.createElement)("span", { style: formLabelStyle }, "动作 / 表情"), (0, react.createElement)(ThemeMultiSelect, {
					value: binding.motions,
					options,
					exclusive: true,
					disabled: readOnly,
					placeholder: "不选 = 只出气泡",
					onChange: (next) => {
						const current = eventBindingsRef.current[event];
						setEventBinding(event, {
							...current,
							motions: normalizeMotionSelection(next)
						});
					}
				})), motionGroupsStatus !== "ready" && (0, react.createElement)("div", { style: {
					fontSize: 12,
					color: motionGroupsStatus === "error" ? C.error : C.textSecondary
				} }, motionGroupsStatus === "loading" ? "正在解析动作列表…（表情现在就能选）" : "无法解析动作列表（表情仍可选）"), ...stages.map((stageLabel, stage) => {
					const draftKey = `${event}:${stage}`;
					const pool = binding.lines[stage] ?? [];
					return (0, react.createElement)("div", {
						key: `stage-${stage}`,
						style: {
							...formRowStartStyle,
							marginBottom: 0
						}
					}, (0, react.createElement)("span", { style: formLabelStartStyle }, `台词池 · ${stageLabel}`), (0, react.createElement)("textarea", {
						style: textareaStyle,
						value: eventLineDrafts[draftKey] ?? pool.join("\n"),
						placeholder: "一行一条；留空 = 该阶段不显示气泡",
						disabled: readOnly,
						onChange: (e) => {
							const raw = e.target.value;
							setEventLineDrafts((prev) => ({
								...prev,
								[draftKey]: raw
							}));
							setEventLinePool(event, stage, raw);
						},
						onBlur: () => setEventLineDrafts((prev) => {
							if (!(draftKey in prev)) return prev;
							const next = { ...prev };
							delete next[draftKey];
							return next;
						})
					}));
				})));
			};
			/** 部位卡片：header = [chevron][层号 chip][名称][↑][↓][删除部位]，统一 28 高垂直居中。 */
			const renderTouchPartCard = (part, index) => {
				const expanded = expandedPartId === part.id;
				const isTopLayer = index === 0;
				const isBottomLayer = index === touchDraft.length - 1;
				const layerLabel = `#${index + 1}`;
				const groups = [...motionGroups, ...part.motions.filter((motion) => !motionGroups.includes(motion) && !isExpressionId(motion))];
				const dirty = dirtyPartIds.has(part.id);
				const toggleExpanded = () => {
					const next = expanded ? null : part.id;
					setExpandedPart(next);
					emitTouchDraft(touchEditingRef.current, touchDraftRef.current, next);
				};
				return (0, react.createElement)("div", {
					key: part.id,
					style: cardStyle
				}, (0, react.createElement)("div", {
					className: "dsh-card-header-row",
					style: cardHeaderRowStyle
				}, (0, react.createElement)("button", {
					type: "button",
					title: expanded ? "收起" : "展开",
					"aria-expanded": expanded,
					className: "dsh-chevron-button",
					style: {
						...chevronButtonStyle,
						transform: expanded ? "rotate(90deg)" : "none"
					},
					onClick: toggleExpanded
				}, "▸"), (0, react.createElement)("span", {
					title: isTopLayer ? `图层 #${index + 1}（最上层，box 重叠时优先）` : `图层 #${index + 1}`,
					style: {
						...chipStyle,
						color: isTopLayer ? C.brand : C.textSecondary
					}
				}, layerLabel), (0, react.createElement)("input", {
					style: {
						...inputStyle,
						flex: 1,
						minWidth: 80
					},
					value: part.name,
					maxLength: 24,
					placeholder: `部位 ${index + 1} 名称（如：头）`,
					disabled: readOnly,
					onChange: (e) => renameTouchPart(part.id, e.target.value),
					onFocus: () => {
						if (!expanded) {
							setExpandedPart(part.id);
							emitTouchDraft(touchEditingRef.current, touchDraftRef.current, part.id);
						}
					}
				}), (0, react.createElement)("button", {
					type: "button",
					title: "上移（更靠顶层）",
					"aria-label": "上移",
					className: "dsh-btn dsh-btn-secondary",
					style: moveButtonStyle,
					disabled: readOnly || isTopLayer,
					onClick: () => moveTouchPart(part.id, -1)
				}, "↑"), (0, react.createElement)("button", {
					type: "button",
					title: "下移（更靠底层）",
					"aria-label": "下移",
					className: "dsh-btn dsh-btn-secondary",
					style: moveButtonStyle,
					disabled: readOnly || isBottomLayer,
					onClick: () => moveTouchPart(part.id, 1)
				}, "↓"), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-danger",
					style: deletePartButtonStyle,
					disabled: readOnly,
					onClick: () => removeTouchPart(part.id)
				}, "删除部位")), dirty ? (0, react.createElement)("div", {
					key: "part-dirty",
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: GAP.sm,
						padding: "0 14px 8px",
						fontSize: 12,
						color: C.warn
					}
				}, (0, react.createElement)("span", null, "● 未保存改动"), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-primary",
					style: buttonPrimaryStyle,
					disabled: saveState === "saving" || readOnly,
					onClick: () => savePartNow(part.id)
				}, "保存")) : savedPartFlash?.partId === part.id ? (0, react.createElement)("div", {
					key: "part-saved",
					style: {
						padding: "0 14px 8px",
						fontSize: 12,
						color: C.success
					}
				}, `已保存 ${savedPartFlash.time}`) : null, expanded && (0, react.createElement)("div", { style: cardBodyStyle }, (0, react.createElement)("div", { style: hintStyle }, "原点在角色左下角（0–100%）：调大「上」= 往上长，调小「下」= 往下长；多个 box 命中任一即算该部位。"), part.boxes.length === 0 ? (0, react.createElement)("div", { style: {
					...hintStyle,
					marginBottom: GAP.sm
				} }, "还没有 box，点「+ 添加 box」画出点击区域。") : (0, react.createElement)("div", {
					key: "box-table",
					style: {
						display: "flex",
						flexDirection: "column",
						gap: 6,
						marginBottom: GAP.sm
					}
				}, (0, react.createElement)("div", {
					key: "box-head",
					style: {
						...boxGridStyle,
						padding: "0 2px"
					}
				}, (0, react.createElement)("span", { style: boxHeaderCellStyle }, "#"), ...TOUCH_BOX_FIELDS.map(({ key, label }) => (0, react.createElement)("span", {
					key,
					style: boxHeaderCellStyle
				}, label)), (0, react.createElement)("span", { style: boxHeaderCellStyle }, "")), ...part.boxes.map((box, boxIndex) => (0, react.createElement)("div", {
					key: `box-${boxIndex}`,
					style: boxGridStyle
				}, (0, react.createElement)("span", { style: {
					fontSize: 12,
					color: C.textSecondary
				} }, `#${boxIndex + 1}`), ...TOUCH_BOX_FIELDS.map(({ key, label }) => (0, react.createElement)("input", {
					key,
					type: "number",
					min: 0,
					max: 100,
					step: 1,
					"aria-label": `${label}（%，左下角原点）`,
					value: boxFieldPercent(box, key),
					disabled: readOnly,
					style: boxCellInputStyle,
					onChange: (e) => setBoxField(part.id, boxIndex, key, e.target.value)
				})), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-danger",
					style: deleteBoxButtonStyle,
					disabled: readOnly,
					onClick: () => removeBox(part.id, boxIndex)
				}, "删除")))), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-secondary",
					style: {
						...buttonSecondaryStyle,
						alignSelf: "flex-start"
					},
					disabled: readOnly || part.boxes.length >= 12,
					onClick: () => addBox(part.id)
				}, part.boxes.length >= 12 ? `box 已达上限（12）` : "+ 添加 box"), (0, react.createElement)("div", {
					key: "part-lines",
					style: {
						...formRowStartStyle,
						marginBottom: 0
					}
				}, (0, react.createElement)("span", { style: formLabelStartStyle }, "台词"), (0, react.createElement)("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: GAP.xs,
					minWidth: 0
				} }, (0, react.createElement)("div", { style: hintStyle }, "一行一条；留空 = 使用全局默认台词池"), (0, react.createElement)("textarea", {
					style: textareaStyle,
					value: partLineDrafts[part.id] ?? (part.lines ?? []).join("\n"),
					placeholder: "留空 = 使用全局默认台词池；一行一条",
					disabled: readOnly,
					onChange: (e) => {
						const raw = e.target.value;
						setPartLineDrafts((prev) => ({
							...prev,
							[part.id]: raw
						}));
						setPartLines(part.id, raw);
					},
					onBlur: () => setPartLineDrafts((prev) => {
						if (!(part.id in prev)) return prev;
						const next = { ...prev };
						delete next[part.id];
						return next;
					})
				}), (0, react.createElement)("div", { style: {
					fontSize: 12,
					color: C.textSecondary
				} }, part.lines && part.lines.length > 0 ? `${part.lines.length} 条（随机选一条）` : `最多 30 条 × 120 字`))), (0, react.createElement)("div", {
					key: "part-motions",
					style: {
						...formRowStyle,
						marginBottom: 0
					}
				}, (0, react.createElement)("span", { style: formLabelStyle }, "动作 / 表情"), (0, react.createElement)(ThemeMultiSelect, {
					value: part.motions,
					options: motionSelectionOptions(groups, part.motions),
					exclusive: true,
					disabled: readOnly,
					placeholder: "不选 = 只出气泡",
					onChange: (next) => setPartMotions(part.id, next)
				})), motionGroupsStatus !== "ready" && (0, react.createElement)("div", { style: {
					fontSize: 12,
					color: motionGroupsStatus === "error" ? C.error : C.textSecondary
				} }, motionGroupsStatus === "loading" ? "正在解析动作列表…（表情现在就能选）" : "无法解析动作列表（表情仍可选，部位照常保存）")));
			};
			const hasChanges = partsDirty || eventsDirty;
			const motionGroupsHint = motionGroupsStatus === "loading" ? "正在解析模型动画列表…" : motionGroupsStatus === "error" ? "无法解析动画列表（动作组可留空，配置仍会保存）" : motionGroupsStatus === "ready" ? `已解析到 ${motionGroups.length} 个动作组` : null;
			/** 组内 sticky 保存行：左侧状态文本（warn/error/success 语义色）+ 右侧 primary 保存按钮。 */
			const saveRow = (key, text, tone, onSave) => (0, react.createElement)("div", {
				key,
				style: stickyRowStyle
			}, (0, react.createElement)("span", { style: {
				...statusTextStyle,
				color: tone === "success" ? C.success : tone === "error" ? C.error : C.warn
			} }, text), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-btn dsh-btn-primary",
				style: buttonPrimaryStyle,
				disabled: saveState === "saving" || readOnly || !hasChanges,
				onClick: onSave
			}, "保存"));
			const children = [(0, react.createElement)("h3", {
				key: "title",
				style: {
					margin: "0 0 4px",
					fontSize: 16,
					fontWeight: 600,
					color: C.textPrimary
				}
			}, "桌宠配置"), (0, react.createElement)("p", {
				key: "sub",
				style: {
					...sectionDescStyle,
					margin: "0 0 16px"
				}
			}, "设置立即生效；动画与台词按「事件」绑定，触摸部位可单独覆盖触摸时的表现。修改后点击分组内「保存」写入。")];
			if (state.status !== "ready") children.push((0, react.createElement)("div", {
				key: "notice",
				style: noticeMutedStyle
			}, state.status === "unavailable" ? "设置服务不可用（Host 插件未加载）。" : "设置加载中…"));
			if (state.error) children.push((0, react.createElement)("div", {
				key: "settings-error",
				style: {
					...noticeErrorStyle,
					wordBreak: "break-all"
				}
			}, `设置文件：${state.error}`));
			const maxFps = normalizeMaxFps$1(value.maxFps);
			const canvasPadX = normalizeCanvasPad(state.value?.canvasPadX, 125);
			const canvasPadY = normalizeCanvasPad(state.value?.canvasPadY, 50);
			const homeRight = normalizeHomePosition(state.value?.homeRight, DEFAULT_VALUE.homeRight);
			const homeBottom = normalizeHomePosition(state.value?.homeBottom, DEFAULT_VALUE.homeBottom);
			const bubbleOffsetX = normalizeBubbleOffset(state.value?.bubbleOffsetX, DEFAULT_VALUE.bubbleOffsetX);
			const bubbleOffsetY = normalizeBubbleOffset(state.value?.bubbleOffsetY, DEFAULT_VALUE.bubbleOffsetY);
			const bubbleBgColor = normalizeHexColor(state.value?.bubbleBgColor, "#ffffff");
			const bubbleBgOpacity = normalizeBubbleOpacity(state.value?.bubbleBgOpacity, 92);
			const bubbleTextColor = normalizeHexColor(state.value?.bubbleTextColor, "#222222");
			const bubbleMaxSeconds = normalizeBubbleMax(state.value?.bubbleMaxSeconds, DEFAULT_VALUE.bubbleMaxSeconds);
			const numberInputStyle = {
				...inputStyle,
				flex: "0 0 88px",
				width: 88,
				textAlign: "right"
			};
			const colorInputStyle = {
				...inputStyle,
				flex: "0 0 48px",
				width: 48,
				padding: 2,
				cursor: writable ? "pointer" : "not-allowed"
			};
			children.push((0, react.createElement)("div", {
				key: "display-section",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "显示",
				description: "基础显示、画布与位置、对白气泡。"
			}), (0, react.createElement)("div", {
				key: "basic-display",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "基础显示"), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("span", { style: formLabelStyle }, "显示"), (0, react.createElement)("label", { style: {
				...labelStyle,
				flex: "none"
			} }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: !!value.enabled,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.checked;
					enqueueWrite(() => [{
						op: "set",
						path: ["enabled"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", null, "显示宠物"))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("span", { style: formLabelStyle }, "尺寸"), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)("input", {
				type: "range",
				min: 40,
				max: 400,
				step: 1,
				value: size,
				disabled: !writable,
				style: {
					flex: 1,
					minWidth: 0
				},
				onChange: (e) => setDraftSize(Number(e.target.value)),
				onPointerUp: commitSize,
				onKeyUp: commitSize,
				onBlur: commitSize
			}), (0, react.createElement)("span", { style: {
				width: 56,
				textAlign: "right",
				color: C.textSecondary,
				fontSize: 12
			} }, `${size}px`))), (0, react.createElement)("div", { style: {
				...formRowStyle,
				marginBottom: 0
			} }, (0, react.createElement)("span", { style: formLabelStyle }, "渲染帧率"), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)(ThemeRadioGroup, {
				name: "渲染帧率",
				value: String(maxFps),
				options: MAX_FPS_OPTIONS,
				disabled: !writable,
				onChange: (id) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["maxFps"],
						value: normalizeMaxFps$1(Number(id))
					}]);
				}
			})))), (0, react.createElement)("div", {
				key: "canvas-home",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "画布与位置"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "水平留白（%）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 300,
				step: 5,
				value: canvasPadX,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeCanvasPad(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["canvasPadX"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "垂直留白（%）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 300,
				step: 5,
				value: canvasPadY,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeCanvasPad(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["canvasPadY"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "中心距右（% 窗口宽）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 100,
				step: 1,
				value: homeRight,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeHomePosition(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["homeRight"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: {
				...formRowInlineStyle,
				marginBottom: GAP.sm
			} }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "中心距下（% 窗口高）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 100,
				step: 1,
				value: homeBottom,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeHomePosition(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["homeBottom"],
						value: next
					}]);
				}
			}), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-btn dsh-btn-secondary",
				style: buttonSecondaryStyle,
				disabled: !writable,
				onClick: requestRecenter
			}, "归位"), (0, react.createElement)("button", {
				type: "button",
				className: "dsh-btn dsh-btn-secondary",
				style: buttonSecondaryStyle,
				title: "把角色现在的位置设为默认位置",
				disabled: !writable,
				onClick: requestCapture
			}, "捕捉"))), resetNotice ? (0, react.createElement)("div", {
				key: "reset-notice",
				style: {
					...statusTextStyle,
					color: C.success,
					marginTop: 2
				}
			}, resetNotice) : null), (0, react.createElement)("div", {
				key: "bubble-style",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "对白气泡"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "水平偏移（px）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: -1e3,
				max: 1e3,
				step: 5,
				value: bubbleOffsetX,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeBubbleOffset(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleOffsetX"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "垂直偏移（px，正值向上）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: -1e3,
				max: 1e3,
				step: 5,
				value: bubbleOffsetY,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeBubbleOffset(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleOffsetY"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "背景不透明度"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 100,
				step: 1,
				value: bubbleBgOpacity,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeBubbleOpacity(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleBgOpacity"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "背景色 / 文字色"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "color",
				value: bubbleBgColor,
				title: `背景色 ${bubbleBgColor}`,
				disabled: !writable,
				style: colorInputStyle,
				onChange: (e) => {
					const next = normalizeHexColor(e.target.value, "#ffffff");
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleBgColor"],
						value: next
					}]);
				}
			}), (0, react.createElement)("input", {
				type: "color",
				value: bubbleTextColor,
				title: `文字颜色 ${bubbleTextColor}`,
				disabled: !writable,
				style: colorInputStyle,
				onChange: (e) => {
					const next = normalizeHexColor(e.target.value, "#222222");
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleTextColor"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "最长显示（秒，0 = 不限）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 600,
				step: 5,
				value: bubbleMaxSeconds,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeBubbleMax(e.target.value, 0);
					enqueueWrite(() => [{
						op: "set",
						path: ["bubbleMaxSeconds"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", {
				key: "interaction-mode",
				style: {
					...formRowInlineStyle,
					marginBottom: 0
				}
			}, (0, react.createElement)("span", { style: formLabelInlineStyle }, "打断优先级"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("select", {
				style: selectStyle,
				value: value.interactionMode,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.value;
					enqueueWrite(() => [{
						op: "set",
						path: ["interactionMode"],
						value: next
					}]);
				}
			}, (0, react.createElement)("option", { value: "touch-first" }, "触摸优先"), (0, react.createElement)("option", { value: "mutual" }, "互相打断"), (0, react.createElement)("option", { value: "event-first" }, "事件优先")))))));
			children.push((0, react.createElement)("div", {
				key: "event-bindings",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "事件绑定（当前模型）",
				description: (0, react.createElement)("div", null, "每个事件 = 动作 / 表情 + 入态台词；长状态（思考/等确认）之后交给 AI 演绎。改完点卡片内的「保存」。", motionGroupsStatus === "error" ? (0, react.createElement)("div", { style: {
					...noticeErrorStyle,
					marginTop: 8,
					marginBottom: 0
				} }, "无法解析当前模型的动作组，动作多选暂不可用（可稍后重试）。", (0, react.createElement)("button", {
					className: "dsh-btn dsh-btn-secondary",
					style: {
						...buttonSecondaryStyle,
						marginLeft: 8
					},
					onClick: retryMotionGroups
				}, "重试")) : null),
				action: motionGroupsHint ? (0, react.createElement)("span", {
					style: statusTextStyle,
					color: C.textSecondary
				}, motionGroupsHint) : void 0
			}), ...EVENT_ORDER.map((event) => renderEventCard(event))));
			children.push((0, react.createElement)("div", {
				key: "touch-parts",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "触摸部位（当前模型）",
				description: (0, react.createElement)("div", null, "#1 在最上层，box 重叠时上层优先，用 ↑ / ↓ 调层级；预览只控制角色上的 box 显示，不影响编辑与保存。"),
				action: (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-secondary",
					style: buttonSecondaryStyle,
					disabled: readOnly,
					onClick: toggleTouchEditing
				}, touchEditing ? "退出预览" : "预览 box")
			}), structureDirty ? saveRow("touch-structure-save-row", "部位顺序/新增/删除未保存", "warn", saveStructureNow) : null, touchSavedFlash && !structureDirty ? (0, react.createElement)("div", {
				key: "touch-saved-flash",
				style: stickyRowStyle
			}, (0, react.createElement)("span", { style: {
				...statusTextStyle,
				color: C.success
			} }, `已保存 ${touchSavedFlash}`)) : null, partStatus === "loading" ? (0, react.createElement)("div", {
				key: "touch-loading",
				style: noticeMutedStyle
			}, "正在读取当前模型的配置…") : partStatus === "error" ? (0, react.createElement)("div", {
				key: "touch-error",
				style: noticeErrorStyle
			}, loadError ?? "读取失败", (0, react.createElement)("button", {
				className: "dsh-btn dsh-btn-secondary",
				style: {
					...buttonSecondaryStyle,
					marginLeft: 8
				},
				onClick: reloadAll
			}, "重新读取")) : null, partStatus === "ready" && loadError ? (0, react.createElement)("div", {
				key: "touch-warn",
				style: noticeErrorStyle
			}, loadError, (0, react.createElement)("button", {
				className: "dsh-btn dsh-btn-secondary",
				style: {
					...buttonSecondaryStyle,
					marginLeft: 8
				},
				onClick: reloadAll
			}, "重新读取")) : null, partStatus === "ready" && touchDraft.length === 0 ? (0, react.createElement)("div", {
				key: "touch-empty",
				style: noticeMutedStyle
			}, "这个模型还没有触摸部位：新建部位后画 box、勾选动作，角色被摸到相应区域时就会有反应。") : null, ...touchDraft.map((part, index) => renderTouchPartCard(part, index)), (0, react.createElement)("button", {
				key: "add-part",
				className: "dsh-btn dsh-btn-primary",
				style: {
					...buttonPrimaryStyle,
					marginTop: 2,
					alignSelf: "flex-start"
				},
				disabled: readOnly,
				onClick: addTouchPart
			}, "+ 新建部位")));
			const providerChoices = aiOptions === null ? [] : aiOptions.providers.some((provider) => provider.id === value.aiProvider) ? aiOptions.providers : [{
				id: value.aiProvider,
				name: value.aiProvider
			}, ...aiOptions.providers];
			const modelChoices = aiOptions?.models?.[value.aiProvider] ?? [];
			const modelOptions = modelChoices.some((model) => model.id === value.aiModel) ? modelChoices : [{
				id: value.aiModel,
				name: value.aiModel
			}, ...modelChoices];
			children.push((0, react.createElement)("div", {
				key: "ai-reply",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "AI 回复",
				description: "开启后触摸与状态变化改由 DSH 已配置的模型生成一句台词（失败自动回落下面的预置台词）。",
				action: (0, react.createElement)(ThemeSwitch, {
					checked: !!value.aiEnabled,
					disabled: !writable,
					onChange: (next) => {
						enqueueWrite(() => [{
							op: "set",
							path: ["aiEnabled"],
							value: next
						}]);
					}
				})
			}), !!value.aiEnabled && (0, react.createElement)("div", null, (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("label", { style: formLabelStyle }, "仅触摸"), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.aiTouchOnly,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["aiTouchOnly"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", { style: {
				fontSize: 12,
				color: C.textSecondary,
				lineHeight: 1.5
			} }, value.aiTouchOnly ? "状态变化只用预置台词（状态切换太快，AI 来不及说完）" : "状态变化也会请 AI 说一句"))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("label", { style: formLabelStyle }, "全 AI 接管"), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.aiTakeover,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["aiTakeover"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", { style: {
				fontSize: 12,
				color: C.textSecondary,
				lineHeight: 1.5
			} }, value.aiTakeover ? "不显示固定对白，气泡只等模型（人设 + 场景 + 历史）；长状态入态即请求，延迟失效" : "固定对白先出、AI 台词到了再替换"))), ...["thinking", "waiting"].map((state) => {
				const keys = state === "thinking" ? {
					delay: "thinkingAiDelay",
					interval: "thinkingAiInterval",
					max: "thinkingAiMax"
				} : {
					delay: "waitingAiDelay",
					interval: "waitingAiInterval",
					max: "waitingAiMax"
				};
				const title = state === "thinking" ? "思考" : "等确认";
				const takeoverDelayDisabled = !!value.aiTakeover;
				const commit = (key, raw, min, max) => {
					const parsed = Number(raw);
					if (!Number.isFinite(parsed)) return;
					const next = Math.round(Math.min(max, Math.max(min, parsed)));
					if (next === value[key]) return;
					enqueueWrite(() => [{
						op: "set",
						path: [key],
						value: next
					}]);
				};
				const numberInput = (key, label, unit, min, max) => (0, react.createElement)("label", {
					key: `${key}`,
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 4
					}
				}, (0, react.createElement)("span", { style: {
					fontSize: 12,
					color: C.textSecondary
				} }, label), (0, react.createElement)("input", {
					type: "number",
					min,
					max,
					step: 1,
					defaultValue: value[key],
					style: {
						...inputStyle,
						width: 64,
						padding: "4px 6px",
						opacity: takeoverDelayDisabled ? .5 : 1
					},
					disabled: !writable || takeoverDelayDisabled && key === keys.delay,
					onBlur: (e) => commit(key, e.target.value, min, max)
				}), (0, react.createElement)("span", { style: {
					fontSize: 12,
					color: C.textSecondary
				} }, unit));
				return (0, react.createElement)("div", {
					key: `long-ai-${state}`,
					style: formRowStyle
				}, (0, react.createElement)("label", { style: formLabelStyle }, `${title}节奏`), (0, react.createElement)("div", { style: {
					...formControlStyle,
					gap: 12,
					flexWrap: "wrap"
				} }, numberInput(keys.delay, "延迟", "秒", 0, 120), numberInput(keys.interval, "间隔", "秒", 5, 600), numberInput(keys.max, "上限", "次", 1, 10)));
			}), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("label", { style: formLabelStyle }, "Provider"), (0, react.createElement)("div", { style: formControlStyle }, providerChoices.length > 0 ? (0, react.createElement)("select", {
				key: `ai-provider-${value.aiProvider}-${providerChoices.length}`,
				value: value.aiProvider,
				style: selectStyle,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.value;
					if (!next || next === value.aiProvider) return;
					const firstModel = aiOptions?.models?.[next]?.[0]?.id;
					enqueueWrite(() => firstModel ? [{
						op: "set",
						path: ["aiProvider"],
						value: next
					}, {
						op: "set",
						path: ["aiModel"],
						value: firstModel
					}] : [{
						op: "set",
						path: ["aiProvider"],
						value: next
					}]);
				}
			}, providerChoices.map((provider) => (0, react.createElement)("option", {
				key: provider.id,
				value: provider.id
			}, provider.name))) : (0, react.createElement)("input", {
				type: "text",
				defaultValue: value.aiProvider,
				style: inputStyle,
				disabled: !writable,
				placeholder: "deepseek-official",
				onBlur: (e) => {
					const next = e.target.value.trim();
					if (next && next !== value.aiProvider) enqueueWrite(() => [{
						op: "set",
						path: ["aiProvider"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("label", { style: formLabelStyle }, "模型"), (0, react.createElement)("div", { style: formControlStyle }, modelOptions.length > 0 ? (0, react.createElement)("select", {
				key: `ai-model-${value.aiModel}-${modelOptions.length}`,
				value: value.aiModel,
				style: selectStyle,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.value;
					if (next && next !== value.aiModel) enqueueWrite(() => [{
						op: "set",
						path: ["aiModel"],
						value: next
					}]);
				}
			}, modelOptions.map((model) => (0, react.createElement)("option", {
				key: model.id,
				value: model.id
			}, model.name))) : (0, react.createElement)("input", {
				type: "text",
				defaultValue: value.aiModel,
				style: inputStyle,
				disabled: !writable,
				placeholder: "deepseek-flash",
				onBlur: (e) => {
					const next = e.target.value.trim();
					if (next && next !== value.aiModel) enqueueWrite(() => [{
						op: "set",
						path: ["aiModel"],
						value: next
					}]);
				}
			}), (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonPrimaryStyle,
					marginLeft: 8,
					opacity: aiChecking ? .6 : 1
				},
				disabled: aiChecking,
				onClick: () => checkAi()
			}, aiChecking ? "测试中…" : "测试"))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "注入历史（条，0 = 不注入）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: AI_HISTORY_LIMITS.min,
				max: AI_HISTORY_LIMITS.max,
				step: 1,
				value: value.aiHistoryCount,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => {
					const next = normalizeHistoryCount(e.target.value, 10);
					enqueueWrite(() => [{
						op: "set",
						path: ["aiHistoryCount"],
						value: next
					}]);
				}
			}))), !!aiCheckStatus && (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("label", { style: formLabelStyle }, "自检"), (0, react.createElement)("div", { style: {
				...formControlStyle,
				color: aiCheckStatus.ok ? C.success : C.error,
				fontSize: 12,
				lineHeight: 1.5,
				wordBreak: "break-all",
				maxHeight: 96,
				overflowY: "auto"
			} }, aiCheckStatus.text)), (0, react.createElement)("div", { style: formRowStartStyle }, (0, react.createElement)("label", { style: formLabelStartStyle }, "人设"), (0, react.createElement)("div", { style: {
				...formControlStyle,
				flexDirection: "column",
				alignItems: "stretch"
			} }, (0, react.createElement)("textarea", {
				key: "ai-persona",
				rows: 8,
				value: personaDraft ?? "",
				style: {
					...textareaStyle,
					height: 148,
					minHeight: 148,
					maxHeight: 148,
					lineHeight: 1.5,
					flex: "none",
					width: "100%"
				},
				disabled: !writable || personaDraft === null,
				placeholder: personaDraft === null ? "读取中…" : "写下「简」的人设与说话风格",
				onChange: (e) => setPersonaDraft(e.target.value)
			}), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: GAP.sm,
				marginTop: 8
			} }, (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonPrimaryStyle,
					opacity: personaSaving ? .6 : 1
				},
				disabled: !writable || personaSaving || personaDraft === null,
				onClick: () => savePersona()
			}, personaSaving ? "保存中…" : "保存人设"), (0, react.createElement)("span", { style: {
				...noticeBaseStyle,
				margin: 0,
				color: C.textSecondary
			} }, personaStatus ?? "保存后立即写入 persona.md，下一次触摸生效")))))));
			children.push((0, react.createElement)("div", {
				key: "devtools",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "开发者选项",
				description: "调试面板与触摸部位色块叠加（仅开发排查用）。",
				action: (0, react.createElement)(ThemeSwitch, {
					checked: !!value.developerMode,
					disabled: !writable,
					onChange: (next) => {
						enqueueWrite(() => [{
							op: "set",
							path: ["developerMode"],
							value: next
						}]);
					}
				})
			}), !!value.developerMode && (0, react.createElement)("div", { style: rowStyle }, (0, react.createElement)("label", { style: labelStyle }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: !!value.debug,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.checked;
					enqueueWrite(() => [{
						op: "set",
						path: ["debug"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", null, "调试面板")), (0, react.createElement)("label", { style: {
				...labelStyle,
				marginTop: 12
			} }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: !!value.showTapZones,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.checked;
					enqueueWrite(() => [{
						op: "set",
						path: ["showTapZones"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", null, "显示触摸部位色块")))));
			return (0, react.createElement)("div", {
				className: "dsh-waifu-settings",
				style: {
					padding: "16px 20px",
					maxWidth: 560,
					color: C.textPrimary,
					fontSize: 13
				}
			}, (0, react.createElement)("style", { key: "dsh-waifu-settings-css" }, ".dsh-waifu-settings input:focus, .dsh-waifu-settings textarea:focus { border-color: var(--dsw-alias-brand-primary) !important; outline: none; }.dsh-waifu-settings input[type=\"checkbox\"], .dsh-waifu-settings input[type=\"range\"] { accent-color: var(--dsw-alias-brand-primary); }.dsh-waifu-settings button:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }.dsh-waifu-settings .dsh-card-header { border-radius: 6px; transition: background .15s; }.dsh-waifu-settings .dsh-card-header-row { border-radius: 10px 10px 0 0; transition: background .15s; }.dsh-waifu-settings .dsh-card-header-row:hover { background: var(--dsw-alias-bg-layer-2); }.dsh-waifu-settings .dsh-card-header:hover { background: var(--dsw-alias-bg-layer-2); }.dsh-waifu-settings .dsh-chevron-button:hover { background: var(--dsw-alias-bg-layer-2); border-radius: 6px; }.dsh-waifu-settings .dsh-btn { transition: background .12s, border-color .12s; }.dsh-waifu-settings .dsh-btn:disabled { opacity: .55; cursor: not-allowed; }.dsh-waifu-settings .dsh-btn-secondary:enabled:hover { background: var(--dsw-alias-bg-overlay); border-color: var(--dsw-alias-border-l2); }.dsh-waifu-settings .dsh-btn-secondary:enabled:active { background: var(--dsw-alias-bg-base); }.dsh-waifu-settings .dsh-btn-primary:enabled:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-label-primary)); }.dsh-waifu-settings .dsh-btn-primary:enabled:active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 78%, var(--dsw-alias-label-primary)); }.dsh-waifu-settings .dsh-btn-danger:enabled:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); }.dsh-waifu-settings .dsh-btn-danger:enabled:active { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent); }.dsh-waifu-settings ::placeholder { color: var(--dsw-alias-label-secondary); opacity: .85; }"), ...children);
		}
		// src/client/paw-icon.ts
		/**
		* 设置导航爪印图标（用户提供的「动物足迹」SVG；currentColor 跟随侧栏主题色）。
		*
		* DSH `dsh-client-ui-settings-general` 当前按 section id 硬编码导航图标
		* （未知 id 一律齿轮），settings.section 的 `icon` 选项尚未接入投影。
		* 因此在导航出现「桌宠配置」时用爪印 SVG 替换齿轮，作为可随插件发布的兼容方案。
		* @module dsh-waifu/client/paw-icon
		*/
		/** 足迹 path（源：动物足迹.svg，viewBox 0 0 56 56）。 */
		const PAW_PATH = "M16.881 50.83c-.202-.014-.404-.025-.605-.043c-1.13-.106-2.167-.475-3.087-1.14c-1.587-1.15-2.602-2.679-3.006-4.602a8.149 8.149 0 0 1-.147-2.188a9.757 9.757 0 0 1 .498-2.521c.439-1.308 1.1-2.495 1.937-3.589A14.948 14.948 0 0 1 14.6 34.5a18.334 18.334 0 0 0 2.031-2.077c.788-.935 1.5-1.926 2.205-2.924c.622-.882 1.234-1.77 1.894-2.622a16.959 16.959 0 0 1 1.605-1.83c.73-.707 1.536-1.305 2.486-1.694a6.161 6.161 0 0 1 2.224-.462a9.855 9.855 0 0 1 2.579.273a7.418 7.418 0 0 1 3.387 1.867c.662.63 1.222 1.344 1.742 2.09c.553.792 1.06 1.613 1.583 2.424c.59.913 1.2 1.812 1.88 2.662a18.325 18.325 0 0 0 2.242 2.344a15.79 15.79 0 0 1 2.611 2.909a12.18 12.18 0 0 1 1.518 2.979a9.4 9.4 0 0 1 .504 2.556c.07 1.332-.16 2.606-.765 3.804c-.56 1.11-1.37 2.003-2.386 2.71c-.748.521-1.555.917-2.443 1.137a6.49 6.49 0 0 1-.957.167c-.045.004-.088.012-.132.02c-.042.023-.088.005-.133.01c-.037.006-.075-.01-.11.012h-.828c-.033-.023-.07-.007-.105-.011h-.175c-.706-.023-1.391-.17-2.075-.329c-1.157-.27-2.292-.625-3.444-.918a21.385 21.385 0 0 0-2.83-.538a13.409 13.409 0 0 0-1.992-.062c-.53.018-1.058.1-1.58.197c-1.03.194-2.039.47-3.049.746c-1.068.294-2.136.585-3.23.764c-.445.072-.89.134-1.343.13c-.093-.002-.185.012-.279.01c-.12-.007-.237.014-.355-.013m20.41-45.81c1.488.179 2.626.936 3.495 2.129c.595.818.97 1.736 1.202 2.717a9.8 9.8 0 0 1 .245 2.57a11.205 11.205 0 0 1-1.12 4.546a9.43 9.43 0 0 1-1.886 2.668c-.703.688-1.498 1.238-2.426 1.581c-.652.24-1.322.36-2.016.318c-1.202-.069-2.223-.547-3.08-1.381c-.732-.712-1.23-1.574-1.575-2.527a8.93 8.93 0 0 1-.47-2.057a9.994 9.994 0 0 1-.06-1.446c.035-1.138.24-2.246.61-3.322a10.273 10.273 0 0 1 1.709-3.147c.64-.794 1.387-1.466 2.283-1.962a5.63 5.63 0 0 1 2.112-.686c.023-.013.048-.007.071-.009h.071c.035-.004.071.012.102-.012h.488c.031.025.067.008.101.012h.072c.023 0 .048-.005.072.008M3.045 22.6c.023-.454.105-.9.224-1.339c.232-.853.61-1.63 1.2-2.295a4.33 4.33 0 0 1 2.448-1.418c.792-.156 1.574-.09 2.342.148c.884.272 1.665.736 2.36 1.34c1.078.935 1.852 2.086 2.387 3.402a8.815 8.815 0 0 1 .666 3.218a7.539 7.539 0 0 1-.226 2.023c-.227.885-.609 1.69-1.217 2.38a4.322 4.322 0 0 1-2.612 1.453c-.766.124-1.519.04-2.255-.198c-.99-.321-1.84-.873-2.588-1.588a8.66 8.66 0 0 1-1.76-2.402a9.25 9.25 0 0 1-.896-2.787c-.025-.173-.046-.346-.07-.518c-.018-.079-.01-.16-.03-.238c-.009-.033-.004-.064-.005-.098c-.006-.041.013-.086-.013-.127v-.634c.04-.058.02-.122.024-.184c.004-.046-.008-.095.021-.137m10.453-10.158c.005-1.258.184-2.391.605-3.483c.317-.825.753-1.579 1.36-2.228c.653-.702 1.429-1.204 2.365-1.441c.936-.238 1.856-.17 2.76.157c.797.29 1.492.745 2.11 1.32c.985.916 1.69 2.023 2.193 3.264c.32.788.54 1.604.665 2.445c.071.476.112.957.122 1.44a9.947 9.947 0 0 1-.128 1.817c-.209 1.256-.635 2.426-1.395 3.46a5.32 5.32 0 0 1-1.751 1.555a4.47 4.47 0 0 1-2.522.536c-.806-.061-1.55-.325-2.243-.736c-.904-.535-1.636-1.257-2.246-2.107a10.024 10.024 0 0 1-1.534-3.325a11.078 11.078 0 0 1-.332-2a6.138 6.138 0 0 1-.029-.674m39.5 10.895v.146c-.055 1.213-.38 2.354-.903 3.442a9.148 9.148 0 0 1-1.59 2.319c-.835.885-1.804 1.576-2.957 1.99a5.366 5.366 0 0 1-2.137.33a4.4 4.4 0 0 1-2.829-1.194c-.658-.612-1.091-1.364-1.365-2.21a6.832 6.832 0 0 1-.32-2.338c.054-1.752.607-3.344 1.567-4.801a8.613 8.613 0 0 1 1.112-1.366c.857-.854 1.837-1.51 2.998-1.883a5.277 5.277 0 0 1 2.025-.252a4.39 4.39 0 0 1 2.749 1.21c.696.657 1.136 1.468 1.401 2.38c.147.503.233 1.018.25 1.543v.147a9.116 9.116 0 0 0 0 .537";
		/** 填充式爪印 SVG（16–20px 侧栏清晰可读）。 */
		function PawPrintIcon(props) {
			const size = props.size ?? 16;
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 56 56",
				fill: "currentColor",
				className: props.className,
				"aria-hidden": true,
				focusable: false,
				"data-pet-nav-icon": "paw"
			}, (0, react.createElement)("path", {
				fillRule: "evenodd",
				d: PAW_PATH
			}));
		}
		/** 设置.section 注册用：按尺寸渲染爪印（待平台投影 icon 字段后可直接生效）。 */
		function pawNavIcon(size) {
			return (0, react.createElement)(PawPrintIcon, { size });
		}
		const NAV_LABEL = "桌宠配置";
		/**
		* 监视 DOM：把「桌宠配置」导航行上的默认齿轮换成爪印。
		* 返回停止函数（插件卸载 / section 退订时调用）。
		*/
		function installPetSettingsNavIcon() {
			const swap = () => {
				for (const btn of document.querySelectorAll("button")) {
					if (!Array.from(btn.querySelectorAll("span")).find((s) => s.textContent?.trim() === NAV_LABEL)) continue;
					const svg = btn.querySelector("svg");
					if (!svg || svg.getAttribute("data-pet-nav-icon") === "paw") continue;
					const next = document.createElementNS("http://www.w3.org/2000/svg", "svg");
					next.setAttribute("width", svg.getAttribute("width") || "16");
					next.setAttribute("height", svg.getAttribute("height") || "16");
					next.setAttribute("viewBox", "0 0 56 56");
					next.setAttribute("fill", "currentColor");
					next.setAttribute("aria-hidden", "true");
					next.setAttribute("focusable", "false");
					next.setAttribute("data-pet-nav-icon", "paw");
					const cls = svg.getAttribute("class");
					if (cls) next.setAttribute("class", cls);
					next.innerHTML = `<path fill-rule="evenodd" d="${PAW_PATH}"/>`;
					svg.replaceWith(next);
				}
			};
			swap();
			const mo = new MutationObserver(() => {
				swap();
			});
			mo.observe(document.documentElement, {
				childList: true,
				subtree: true
			});
			return () => mo.disconnect();
		}
		// src/client/index.ts
		/**
		* dsh-waifu 浏览器半区：挂载 Live2D 桌宠 + 「桌宠配置」设置页。
		*
		* 架构（ADR-005 / 004，spike pkg-9 实证）：
		* - `shell.overlay` 注册零尺寸锚点（生命周期/设置锚点）
		* - 视觉层用 Popover API（top layer，零 z-index）渲染，旧浏览器回退 body + 最大 z-index
		* - 运行时脚本与预设模型走 Host 同源路由（/waifu-assets/*），无 CDN 依赖
		* - agent 状态经 /api/dsh-waifu/events SSE 推送（首帧快照 + 变更推送，ADR-006）；
		*   标签页隐藏/窗口失焦暂停渲染循环，恢复时继续（spec §7）
		* - 点击/拖动按 6px 阈值判定；自由位置拖动，松手持久化（spec §4）
		* - 触摸部位完全由用户自定义 box 决定（相对模型包围盒 0–1 归一化矩形）；点击命中部位后
		*   播放该部位动作组，有该部位自定义台词时随机说一句；编辑态实时叠加绘制草稿 box（spec §4）
		* - 画布在模型显示尺寸外留白（约 20–25% 边距），避免动作/物理甩尾被裁切；模型缩放仍按
		*   「size = 模型可见宽度」计算（spec §7）
		* - 点击穿透：canvas/容器 pointer-events:none，按触摸部位 box 生成透明命中层承接点击/拖动，
		*   透明区域不拦截下层 UI（spec §4）
		* - 鼠标跟随：document 级 pointermove 调用 model.focus()，头/眼/身体看向鼠标；移出页面复位；
		*   非 idle 动作播放期间抑制 focus，避免动作关键帧被鼠标跟随叠加（spec §4）
		* - 配置（enabled/size/maxFps/debug/model/events）经状态推送运行时应用：开关→显隐+停启渲染、
		*   尺寸→重设画布与模型适配、帧率→ticker.maxFPS、调试→动态面板、模型→按 modelUrl 重载、
		*   事件绑定（动作组 + 台词池）→热更新状态表现（spec §2/§3/§6/§7）
		* @module dsh-waifu/client
		*/
		/** 注入所需服务。 */
		const inject = ["slots"];
		/** 点击/拖动判定阈值（px）。 */
		const DRAG_THRESHOLD = 6;
		/** 点击互动防抖（ms）：仅挡同一次 pointer 误触双发，不等气泡播完（spec §4）。 */
		const TAP_DEBOUNCE_MS = 80;
		/** 瞬态气泡显示时长（ms）：到时自动隐藏或回落阶段文案。 */
		const BUBBLE_DISPLAY_MS = 2500;
		/** 气泡最长连续可见时长兜底（秒）：默认 30；0 = 不限（spec §3，ADR-027）。 */
		const BUBBLE_MAX_DEFAULT = 30;
		/** AI 台词最短可见时长：状态切换再快，也要让这句露一脸（ADR-025 补丁）。 */
		const AI_BUBBLE_HOLD_MS = 1400;
		/**
		* 默认渲染帧率上限（spec §2/§7）：未封顶时 PIXI ticker 可达 120–140fps，
		* 长时间挂页会持续占满 GPU/主线程；桌宠动画默认 30fps 足够，用户可在设置中改档。
		* 取值来自 defaults.ts，与 Host schema 单一来源。
		*/
		/**
		* 画布四周留白（模型可见尺寸之外，每侧）：百分比来自 settings.canvasPadX/Y（0–300，默认 125/50），
		* 实际留白 = max(CANVAS_PAD_MIN, size * pct / 100)。动作/物理甩尾（尾巴等）会超出模型静止包围盒，
		* 留白不足会被 canvas 裁切（spec §7）。
		*/
		const CANVAS_PAD_MIN = 40;
		/** #rgb/#rrggbb + 0–100 不透明度 → CSS rgba()（非法颜色回退白色，spec §3）。 */
		function colorWithOpacity(color, opacityPct) {
			const raw = String(color).trim().replace(/^#/, "");
			const hex = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
			const alpha = Math.min(100, Math.max(0, Number.isFinite(opacityPct) ? opacityPct : 100)) / 100;
			if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(255,255,255,${alpha})`;
			const n = Number.parseInt(hex, 16);
			return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
		}
		/** 渲染分辨率倍数（HiDPI 屏用 2x 缓冲，避免 1x 缓冲被放大产生锯齿；上限 2 控制显存）。 */
		function renderScale() {
			const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
			return Math.min(2, Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
		}
		/** pixi-live2d-display MotionPriority（对应库内枚举：NONE=0, IDLE=1, NORMAL=2, FORCE=3）。 */
		const MotionPriority = {
			IDLE: 1,
			NORMAL: 2,
			FORCE: 3
		};
		/**
		* 触摸部位 box 叠加层调色板（按部位 index 循环；编辑态高亮部位用更亮描边，
		* spec §2 开发者选项「显示触摸部位」/ 设置页编辑态）。
		*/
		const TOUCHBOX_PALETTE = [
			{
				fill: "rgba(80,160,255,.24)",
				stroke: "rgba(160,210,255,.9)"
			},
			{
				fill: "rgba(80,200,120,.24)",
				stroke: "rgba(150,255,190,.9)"
			},
			{
				fill: "rgba(255,160,60,.26)",
				stroke: "rgba(255,210,140,.9)"
			},
			{
				fill: "rgba(255,120,170,.24)",
				stroke: "rgba(255,180,210,.9)"
			},
			{
				fill: "rgba(180,140,255,.24)",
				stroke: "rgba(215,190,255,.9)"
			},
			{
				fill: "rgba(100,225,225,.24)",
				stroke: "rgba(170,255,255,.9)"
			}
		];
		/** 表情淡入淡出时长（ms）：切换表情时开关参数按该时长线性逼近目标值。 */
		const EXPRESSION_FADE_MS = 280;
		/** 触摸部位表情的临时保持时长（ms）：到点自动回到当前事件绑定的表情。 */
		/** 触摸互动的「保持窗口」：这段时间内触摸拥有气泡与动作（ADR-032）。 */
		const TAP_INTERACTION_HOLD_MS = 2600;
		const EXPRESSION_TEMP_MS = 2200;
		/** 归一化配置帧率档（非法值回落默认 30）。 */
		function normalizeMaxFps(raw) {
			if (raw === 60 || raw === 0) return raw;
			return 30;
		}
		const VENDOR_SCRIPTS = [
			"/waifu-assets/vendor/pixi.min.js",
			"/waifu-assets/vendor/live2dcubismcore.min.js",
			"/waifu-assets/vendor/live2d-display.cubism4.min.js"
		];
		const PET_API = "/api/dsh-waifu";
		/** 从台词池随机取一句；可选避开上一条（池 ≥2 时，spec §4）。 */
		function pickLine(pool, avoid) {
			if (pool.length === 0) return void 0;
			if (pool.length === 1) return pool[0];
			const candidates = avoid ? pool.filter((line) => line !== avoid) : pool;
			const list = candidates.length > 0 ? candidates : pool;
			return list[Math.floor(Math.random() * list.length)];
		}
		/** JSON 响应读取:非 2xx 抛错——错误响应不得当作合法视图/结果解析。 */
		async function readJson(res) {
			if (!res.ok) throw new Error(`http ${res.status}`);
			return await res.json();
		}
		const api = {
			state: () => fetch(`${PET_API}/state`).then((res) => readJson(res)),
			/** SSE 状态订阅（ADR-006）：每次推送回调最新快照；断线由 EventSource
			*  自动重连（服务端 retry 3s），重连后首帧即全量快照。返回退订函数。 */
			events: (onState, onError) => {
				const es = new EventSource(`${PET_API}/events`);
				es.onmessage = (ev) => {
					try {
						onState(JSON.parse(ev.data));
					} catch {}
				};
				es.onerror = onError;
				return () => es.close();
			},
			/** AI 回复（ADR-025）：上报「戳了哪里/变成什么状态」，拿回一句台词（失败返回 ok:false）。 */
			interact: (body) => fetch(`${PET_API}/interact`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}).then((res) => readJson(res)),
			setDisplay: (patch) => fetch(`${PET_API}/set-display`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch)
			}).then((res) => readJson(res))
		};
		/** vendor 脚本加载去重：同一 src 只注入一次、只等待同一份结果
		* （boot 在 StrictMode/HMR 下会重复执行，避免二次注入与重复初始化）。 */
		const scriptPromises = /* @__PURE__ */ new Map();
		function loadScript(src) {
			let pending = scriptPromises.get(src);
			if (!pending) {
				pending = new Promise((resolve, reject) => {
					const s = document.createElement("script");
					s.src = src;
					s.onload = () => resolve();
					s.onerror = () => reject(/* @__PURE__ */ new Error(`script load failed: ${src}`));
					document.head.appendChild(s);
				});
				scriptPromises.set(src, pending);
			}
			return pending;
		}
		/** 零尺寸锚点组件：占位 shell.overlay 席位，实际渲染在 popover 顶层容器。 */
		function PetAnchor() {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				clientLog("info", "anchor mounted");
				return boot(ref.current);
			}, []);
			return (0, react.createElement)("div", {
				ref,
				style: {
					width: 0,
					height: 0
				}
			});
		}
		function boot(anchor) {
			if (!anchor) {
				clientLog("warn", "boot skipped: anchor missing");
				return;
			}
			clientLog("info", "boot start");
			const cleanup = [];
			const pushCleanup = (fn) => {
				cleanup.push(fn);
			};
			let disposed = false;
			pushCleanup(() => {
				disposed = true;
			});
			pushCleanup(() => {
				clearLongState();
				clearTapHold();
				clearBubbleHideTimer();
			});
			pushCleanup(() => {
				if (sizeRaf) {
					window.cancelAnimationFrame(sizeRaf);
					sizeRaf = 0;
				}
				pendingSize = null;
			});
			pushCleanup(() => {
				stopOverlayLoop();
				showTapZones = false;
				editState = null;
			});
			pushCleanup(onTouchEdit(handleTouchEdit));
			pushCleanup(onRecenter(() => {
				homePositionFromConfig();
				applyPosToBox();
				persistDisplay();
			}));
			pushCleanup(onCaptureHome((captured) => {
				const { width, height } = logicalCanvasSize();
				const viewport = {
					width: window.innerWidth || document.documentElement.clientWidth || 0,
					height: window.innerHeight || document.documentElement.clientHeight || 0
				};
				const home = homePercentFromPos(pos, {
					width,
					height
				}, viewport);
				if (home !== null) captured(home);
			}));
			let box = null;
			let bubble = null;
			let debugEl = null;
			/** 调试面板“动画预览”数据：当前模型 MotionManager 暴露的全部具体动画。 */
			let debugMotionList = [];
			/** 按模型 URL 缓存原生动画列表，避免重复请求同一份 .model3.json。 */
			const motionListCache = /* @__PURE__ */ new Map();
			let debugMotionSelect = null;
			/** 调试面板状态文本容器：与演示按钮/动画预览并列，避免被 textContent 覆盖。 */
			let debugTextEl = null;
			/** 是否正处于 debug 原生动画预览：预览期间抑制 focus，结束后只恢复跟随，不触发状态恢复。 */
			let previewActive = false;
			/** 调试面板顶部（逻辑画布 CSS px；NaN = 不可见/未定位），用于气泡避让（spec §2）。 */
			let debugPanelTopLogical = NaN;
			let canvas = null;
			/** 画布外包一层，便于绝对定位触摸部位叠加层。 */
			let petLayer = null;
			let touchboxOverlay = null;
			/** 开发者选项：显示触摸部位色块（SSE config.showTapZones；编辑态强制显示，spec §2）。 */
			let showTapZones = false;
			/** 触摸部位编辑态（设置页草稿；null = 非编辑态）。编辑态强制显示宠物与草稿 box（spec §4）。 */
			let editState = null;
			/** 当前模型生效的触摸部位（SSE config.touchParts；编辑态改用 editState.parts，spec §4）。 */
			let touchParts = [];
			/** 当前模型生效的事件绑定（SSE config.events；缺省 DEFAULT_EVENT_BINDINGS，spec §3）。 */
			let eventBindings = DEFAULT_EVENT_BINDINGS;
			/** 事件绑定内容签名：配置变化时刷新长状态当前阶段文案（spec §3）。 */
			let eventBindingsSignature = "";
			/** 统一浮层逐帧循环句柄（命中层 / 触摸色块 / 调试面板 / 气泡共用一条 rAF，spec §3/§4）。 */
			let overlayRaf = 0;
			/** 上一次真正执行帧的时间戳：按 settings.maxFps 节流（0 = 不限），不再固定 60fps 空转。 */
			let overlayLastAt = 0;
			/** 上一次写入命中层的包围盒签名（0.5px 粒度）：未变则整帧跳过位置写。 */
			let overlayHitKey = "";
			/** 上一次触摸色块绘制的签名（包围盒 + 部位/box + 高亮 + 画布尺寸）。 */
			let overlayPaintKey = "";
			/** petLayer 的视口 rect 缓存：气泡/面板定位用，样式变化时失效（避免每帧强制布局）。 */
			let layerRectCache = null;
			/** 调试面板尺寸缓存：面板内容变化/窗口 resize 时失效（避免每帧读 offsetWidth/offsetHeight）。 */
			let panelSizeCache = null;
			/** 命中层容器（点击穿透，spec §4）：覆盖 canvas，子 div 按触摸部位 box 定位并接收指针事件。 */
			let hitLayer = null;
			/** 命中 div ↔ 部位 box 归一化坐标的对应关系（每帧按 model.getBounds 更新 CSS 位置）。
			*  `last` 记录上一次写入的值（0.5px 粒度），值没变就不写样式，避免无谓的样式失效。 */
			let hitBoxEntries = [];
			/** 当前命中 box 集合签名：部位/box 变化时才重建 div，避免每帧重建。 */
			let hitBoxesSignature = "";
			let app = null;
			let model = null;
			let currentModelUrl = null;
			let fallbackShown = false;
			let fallbackEl = null;
			let baseModelW = 0;
			let baseModelH = 0;
			let pendingSize = null;
			let sizeRaf = 0;
			let lastTapAt = 0;
			/** 各部位自定义台词（part.lines）上一次抽中的句子，按 part.id 记录（部位间互不干扰，spec §4）。 */
			const lastPartLine = /* @__PURE__ */ new Map();
			/** 各事件阶段上一次抽中的台词（key = 状态 + 阶段下标，避开连抽同一句，spec §3）。 */
			const lastEventLine = /* @__PURE__ */ new Map();
			/** 互动动作世代：新互动或新非 idle 状态动作会作废上一次互动的恢复回调。 */
			let interactionGen = 0;
			/** 动作启动世代：任何新动作都会使异步 fallback/旧启动失效，避免被 stopAllMotions 打断后继续启动。 */
			let motionSeq = 0;
			/** 是否正在播放互动动作（motionFinish 后据此恢复当前状态动作）。 */
			let interactionActive = false;
			/** 是否抑制鼠标跟随：非 idle 动作播放期间为 true（spec §4）。 */
			let focusSuppressed = false;
			/** 最近一次全局 pointermove 的 client 坐标；动作结束后用于立即恢复跟随。 */
			let lastPointerClient = null;
			/** 当前模型 motionManager 的 motionFinish 解绑函数（模型重载/卸载时清理）。 */
			let detachMotionFinish = null;
			let bubbleHideTimer;
			/** 气泡最长可见计时器：从「隐藏 → 可见」那一刻起算，替换文案不重置（ADR-027）。 */
			let bubbleMaxTimer;
			let bubbleMaxMs = BUBBLE_MAX_DEFAULT * 1e3;
			/** 气泡当前是否可见（用于判断一次新的显示是否要重新起算最长时长）。 */
			let bubbleVisible = false;
			/** 长状态的 AI 演绎计时器（入态延迟 + 间隔重试，ADR-026）。 */
			let longAiTimers = [];
			/** 当前长状态（thinking/waiting）；非空时气泡常驻。 */
			let longState = null;
			/** 长状态常驻气泡的底稿：入态台词，AI 演绎成功后换成 AI 那句。 */
			let bubbleStickyText = null;
			let lastState = null;
			let demoState = null;
			let view = null;
			let pos = {
				right: 24,
				bottom: 20,
				size: 240
			};
			let canvasPadXPct = 125;
			let canvasPadYPct = 50;
			let tempExpressions = [];
			let tempExpressionUntil = 0;
			/** 调试面板「表情预览」强制显示的表情（null = 不干预）。 */
			let debugExpression = null;
			/** 表达式开关参数当前混合值（每帧向目标逼近 → 淡入淡出）。 */
			const expressionMix = /* @__PURE__ */ new Map();
			/** AI 回复开关（SSE config.aiEnabled；ADR-025）：开启后触摸/状态台词改由 Host 调 LLM 生成。 */
			let aiEnabled = false;
			/** 仅触摸（SSE config.aiTouchOnly）：开启后状态气泡只用预置台词，AI 只在触摸时发言。 */
			let aiTouchOnly = false;
			/**
			* 全 AI 接管（SSE config.aiTakeover；ADR-031）：不显示任何预置对白，气泡内容全部来自模型；
			* 长状态的「延迟」失效——入态立刻请求一句，之后仍按间隔/上限反复演绎。
			*/
			let aiTakeover = false;
			/** 打断优先级（ADR-032）：触摸互动与状态事件抢气泡/动作/AI 演绎时的规则。 */
			let interactionMode = DEFAULT_INTERACTION_MODE;
			/** 触摸互动保持窗口的截止时间戳；窗口内状态事件按优先级决定是否接管。 */
			let tapHoldUntil = 0;
			let tapResumeTimer;
			/** 长状态 AI 演绎节奏（SSE config.*AiDelay/Interval/Max，秒/秒/次；ADR-026）。 */
			let thinkingAiDelay = 3;
			let thinkingAiInterval = 20;
			let thinkingAiMax = 3;
			let waitingAiDelay = 4;
			let waitingAiInterval = 30;
			let waitingAiMax = 3;
			/** AI 回复请求序号：只采用最后一次请求的结果，避免连点时旧回复覆盖新回复。 */
			let aiRequestSeq = 0;
			/** AI 台词的最短可见时间截止点：其间状态/预置台词先排队，避免「刚到就被状态切走」。 */
			let aiTextUntil = 0;
			/** 被 AI 台词短暂压住的预置台词（等 AI 台词显示够久再换上）。 */
			let pendingBubbleText = null;
			let pendingBubbleTimer;
			let bubbleOffsetX = 0;
			let bubbleOffsetY = -15;
			let bubbleBgColor = DEFAULT_BUBBLE_BG_COLOR;
			let bubbleBgOpacity = 92;
			let bubbleTextColor = DEFAULT_BUBBLE_TEXT_COLOR;
			/** 首次启动是否已套用配置默认中心位置（displaySaved=false 时只套用并回写一次，spec §2）。 */
			let homeApplied = false;
			let maxFps = 30;
			let enabled = true;
			let hidden = document.visibilityState !== "visible";
			/** 宠物是否应可见/渲染：插件开启，或设置页正在编辑触摸部位（编辑态强制显示，spec §4）。 */
			function petShown() {
				return enabled || editState !== null;
			}
			/** 合并 enabled/编辑态/隐藏/失焦状态，启停渲染循环（spec §7：暂停渲染保留最后画面）。 */
			function syncTicker() {
				if (!app) return;
				if (petShown() && !hidden) try {
					app.ticker.start();
				} catch {}
				else try {
					app.ticker.stop();
				} catch {}
			}
			/** 按 enabled / 编辑态同步宠物容器显隐（编辑态即使插件关闭也强制显示）。 */
			function syncPetVisibility() {
				if (box) box.style.display = petShown() ? "" : "none";
				syncTicker();
				syncOverlayLoop();
			}
			/** 应用渲染帧率上限（spec §2/§7；0 = PIXI 不设上限）。 */
			function applyMaxFps(next) {
				maxFps = normalizeMaxFps(next);
				if (!app?.ticker) return;
				try {
					app.ticker.maxFPS = maxFps;
				} catch {}
			}
			function clearBubbleHideTimer() {
				if (bubbleHideTimer !== void 0) {
					window.clearTimeout(bubbleHideTimer);
					bubbleHideTimer = void 0;
				}
			}
			function clearBubbleMaxTimer() {
				if (bubbleMaxTimer !== void 0) {
					window.clearTimeout(bubbleMaxTimer);
					bubbleMaxTimer = void 0;
				}
			}
			/**
			* 气泡最长可见时长（ADR-027）：出态事件丢失时长状态会永久常驻，这里做兜底。
			* 从「隐藏 → 可见」起算，替换文案不重置；到时连常驻底稿与 AI 演绎一起收掉。
			*/
			function armBubbleMaxTimer() {
				if (bubbleMaxMs <= 0) {
					clearBubbleMaxTimer();
					return;
				}
				if (bubbleMaxTimer !== void 0) return;
				bubbleMaxTimer = window.setTimeout(() => {
					bubbleMaxTimer = void 0;
					bubbleVisible = false;
					clearLongState();
					if (pendingBubbleTimer !== void 0) {
						window.clearTimeout(pendingBubbleTimer);
						pendingBubbleTimer = void 0;
					}
					pendingBubbleText = null;
					aiTextUntil = 0;
					clearBubbleHideTimer();
					if (bubble) bubble.style.opacity = "0";
				}, bubbleMaxMs);
			}
			/** 应用「气泡最长显示」配置（秒；0 = 不限）；非法值保留当前值。 */
			function applyBubbleMaxConfig(cfg) {
				const raw = cfg.bubbleMaxSeconds;
				if (typeof raw === "number" && Number.isFinite(raw)) {
					const next = Math.round(Math.min(600, Math.max(0, raw)));
					if (next !== bubbleMaxMs / 1e3) {
						bubbleMaxMs = next * 1e3;
						if (bubbleVisible) {
							clearBubbleMaxTimer();
							armBubbleMaxTimer();
						}
					}
				}
			}
			/** 上一次写入气泡的样式签名：配置没变就不重复写（SSE 每条推送都会走到这里）。 */
			let bubbleStyleKey = "";
			/** 应用气泡样式（背景 rgba / 文字色 / 最大宽度；不重建元素，spec §3）。 */
			function applyBubbleStyle() {
				if (!bubble) return;
				const maxWidth = Math.max(80, Math.min(320, window.innerWidth - 24));
				const key = `${bubbleBgColor}|${bubbleBgOpacity}|${bubbleTextColor}|${maxWidth}`;
				if (key === bubbleStyleKey) return;
				bubbleStyleKey = key;
				bubble.style.background = colorWithOpacity(bubbleBgColor, bubbleBgOpacity);
				bubble.style.color = bubbleTextColor;
				bubble.style.maxWidth = `${maxWidth}px`;
			}
			/**
			* 气泡相对模型包围盒定位（spec §3）：气泡底部中点贴住
			* (bounds.x + width/2 + bubbleOffsetX, bounds.y - bubbleOffsetY)（画布逻辑 CSS px；
			* bubbleOffsetY 正值向上、负值向下），transform: translate(-50%, -100%) 由样式居中/贴底。
			* 调试面板可见时锚点上移到面板顶部再往上 6px；目标视口 y clamp 到 ≥8，避免跑出视口。
			*/
			function updateBubblePosition(boundsArg) {
				if (!bubble) return;
				if (!petLayer || bubble.parentNode !== petLayer) {
					bubble.style.left = "50%";
					bubble.style.top = "0px";
					return;
				}
				const bounds = boundsArg === void 0 ? modelBounds() : boundsArg;
				if (!bounds) return;
				const anchorX = bounds.x + bounds.width / 2 + bubbleOffsetX;
				let anchorY = Number.isFinite(debugPanelTopLogical) ? debugPanelTopLogical - 6 : bounds.y - bubbleOffsetY;
				const rect = layerRect();
				if (rect && rect.top + anchorY < 8) anchorY = 8 - rect.top;
				bubble.style.left = `${anchorX}px`;
				bubble.style.top = `${anchorY}px`;
			}
			/** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
			function setBubbleText(text) {
				if (!bubble) return;
				clearBubbleHideTimer();
				bubble.textContent = text;
				bubble.style.opacity = "1";
				if (!bubbleVisible) {
					bubbleVisible = true;
					armBubbleMaxTimer();
				}
				updateBubblePosition();
			}
			/** 取事件某阶段的台词池：index 越界用最后一组；无台词 → 空数组（不回退固定人设）。 */
			function eventLinesFor(state, index) {
				const pools = eventBindings[state]?.lines ?? [];
				if (pools.length === 0) return [];
				return pools[Math.min(index, pools.length - 1)] ?? [];
			}
			/** 随机取事件某阶段的一句台词（避开该阶段上一条，spec §3）；无台词返回 undefined。 */
			function pickEventLine(state, index) {
				const pool = eventLinesFor(state, index);
				if (pool.length === 0) return void 0;
				const key = `${state}\u0000${index}`;
				const line = pickLine(pool, lastEventLine.get(key));
				if (line !== void 0) lastEventLine.set(key, line);
				return line;
			}
			/** 隐藏气泡并取消瞬态隐藏计时（事件台词池为空时不显示气泡，spec §3）。 */
			function hideBubble() {
				clearBubbleHideTimer();
				clearBubbleMaxTimer();
				bubbleVisible = false;
				if (bubble) bubble.style.opacity = "0";
			}
			/** 重绘长状态的常驻气泡（瞬态气泡到时回落/事件绑定变化或拖拽结束后恢复）。 */
			function showStickyText() {
				if (longState === null) return;
				if (bubbleStickyText === null) {
					hideBubble();
					return;
				}
				showBubble(bubbleStickyText);
			}
			/**
			* 瞬态气泡（交互/短状态，spec §3/§4）：立刻换文案并重置隐藏计时（连点可打断）；
			* 到时隐藏——若正处于阶段演进状态则回落到当前阶段文案（交互短暂抢占常驻气泡，过后归还）。
			*/
			function showBubble(text) {
				if (!bubble) return;
				const now = Date.now();
				if (now < aiTextUntil) {
					pendingBubbleText = text;
					if (pendingBubbleTimer !== void 0) return;
					pendingBubbleTimer = window.setTimeout(() => {
						pendingBubbleTimer = void 0;
						const next = pendingBubbleText;
						pendingBubbleText = null;
						if (next !== null) showBubble(next);
					}, aiTextUntil - now);
					return;
				}
				showBubbleNow(text);
			}
			/** 立刻替换气泡文案（不经 AI 排队），到时隐藏并回落到阶段文案。 */
			function showBubbleNow(text) {
				if (!bubble) return;
				clearBubbleHideTimer();
				setBubbleText(text);
				bubbleHideTimer = window.setTimeout(() => {
					bubbleHideTimer = void 0;
					if (longState !== null) showStickyText();
					else {
						bubbleVisible = false;
						clearBubbleMaxTimer();
						if (bubble) bubble.style.opacity = "0";
					}
				}, BUBBLE_DISPLAY_MS);
			}
			/** AI 台词上屏：比预置台词多留一点时间，并在这段时间内挡住后面的状态切换。 */
			function showAiBubble(text) {
				if (!bubble) return;
				aiTextUntil = Date.now() + AI_BUBBLE_HOLD_MS;
				if (pendingBubbleTimer !== void 0) {
					window.clearTimeout(pendingBubbleTimer);
					pendingBubbleTimer = void 0;
				}
				pendingBubbleText = null;
				showBubbleNow(text);
			}
			/** 退出长状态：取消演绎计时、清掉常驻底稿。 */
			function clearLongState() {
				for (const t of longAiTimers) window.clearTimeout(t);
				longAiTimers = [];
				longState = null;
				bubbleStickyText = null;
			}
			/** 触摸是否还处于「保持窗口」内（窗口内由 interactionMode 决定谁优先）。 */
			function tapActive() {
				return Date.now() < tapHoldUntil;
			}
			/** 结束触摸保持窗口（事件优先/互相打断里由状态变化调用）。 */
			function clearTapHold() {
				tapHoldUntil = 0;
				if (tapResumeTimer !== void 0) {
					window.clearTimeout(tapResumeTimer);
					tapResumeTimer = void 0;
				}
			}
			/**
			* 触摸接管（ADR-032）：进入保持窗口；非「事件优先」时立刻停掉长状态的演绎计时与
			* 常驻底稿，让触摸台词/AI 台词拥有气泡；窗口结束后若长状态仍在，再把演绎交还。
			*/
			function beginTapHold() {
				tapHoldUntil = Date.now() + TAP_INTERACTION_HOLD_MS;
				if (tapResumeTimer !== void 0) window.clearTimeout(tapResumeTimer);
				if (interactionMode !== "event-first" && longState !== null) {
					for (const t of longAiTimers) window.clearTimeout(t);
					longAiTimers = [];
					bubbleStickyText = null;
				}
				tapResumeTimer = window.setTimeout(() => {
					tapResumeTimer = void 0;
					if (interactionMode === "event-first") return;
					if (longState !== null && longState === lastState) enterLongState(longState, pickEventLine(longState, 0));
				}, TAP_INTERACTION_HOLD_MS);
			}
			/** 读取长状态 AI 节奏配置（缺省/非法值保留当前值）。 */
			function applyLongAiConfig(cfg) {
				const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
				thinkingAiDelay = num(cfg.thinkingAiDelay, thinkingAiDelay);
				thinkingAiInterval = num(cfg.thinkingAiInterval, thinkingAiInterval);
				thinkingAiMax = num(cfg.thinkingAiMax, thinkingAiMax);
				waitingAiDelay = num(cfg.waitingAiDelay, waitingAiDelay);
				waitingAiInterval = num(cfg.waitingAiInterval, waitingAiInterval);
				waitingAiMax = num(cfg.waitingAiMax, waitingAiMax);
			}
			/** 长状态的 AI 演绎节奏（秒 → ms）；取自 SSE config，越界值按默认兜底。 */
			function longAiCadence(state) {
				return {
					delay: Math.max(0, state === "thinking" ? thinkingAiDelay : waitingAiDelay),
					interval: Math.max(1, state === "thinking" ? thinkingAiInterval : waitingAiInterval),
					max: Math.max(0, Math.round(state === "thinking" ? thinkingAiMax : waitingAiMax))
				};
			}
			/**
			* 进入长状态（ADR-026）：入态台词常驻，之后按设置节奏让 AI 反复演绎同一状态——
			* 第一次等 `delay` 秒，之后每 `interval` 秒一次，最多 `max` 次；出态即停。
			*/
			function enterLongState(state, hint) {
				clearLongState();
				longState = state;
				const takeover = aiTakeover && aiEnabled;
				bubbleStickyText = takeover ? null : hint ?? null;
				if (bubbleStickyText === null) hideBubble();
				else showStickyText();
				if (!aiEnabled || aiTouchOnly) return;
				const cadence = longAiCadence(state);
				if (cadence.max <= 0) return;
				let attempts = 0;
				const tick = () => {
					if (longState !== state) return;
					attempts += 1;
					requestAiReply({
						kind: "state",
						state,
						hint: takeover ? void 0 : hint
					}, { sticky: true });
					if (attempts < cadence.max) longAiTimers.push(window.setTimeout(tick, cadence.interval * 1e3));
				};
				longAiTimers.push(window.setTimeout(tick, takeover ? 0 : cadence.delay * 1e3));
			}
			/** canvas 的视口 rect 缓存：pointermove 每次都要用，不能每次读布局。 */
			let canvasRectCache = null;
			/** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
			function applyFocus(clientX, clientY) {
				if (!model || !canvas) return;
				if (!canvasRectCache) try {
					canvasRectCache = canvas.getBoundingClientRect();
				} catch {
					return;
				}
				model.focus(clientX - canvasRectCache.left, clientY - canvasRectCache.top);
			}
			/** 解除非 idle 动作期间的 focus 抑制；若有最近指针位置则立即恢复跟随。 */
			function releaseFocusSuppression() {
				if (!focusSuppressed) return;
				focusSuppressed = false;
				if (model && lastPointerClient && !dragging && enabled && !hidden) applyFocus(lastPointerClient.x, lastPointerClient.y);
			}
			/**
			* 按候选动作链启动动作，统一处理优先级、重播前 stopAllMotions、布尔返回值 fallback。
			* - idle 用 IDLE 优先级；状态/互动用 FORCE（NORMAL 不能打断 NORMAL，无法满足状态立即切换）。
			* - 非 idle 动作启动时抑制 focus，并等 motionFinish 真正播完后再恢复。
			*/
			async function startMotionWithPriority(names, priority, options) {
				if (!model || names.length === 0) return false;
				const seq = ++motionSeq;
				const currentModel = model;
				previewActive = false;
				if (options.suppressFocus) {
					focusSuppressed = true;
					currentModel.internalModel?.focusController?.focus(0, 0, true);
				} else releaseFocusSuppression();
				if (options.isInteraction) interactionActive = true;
				currentModel.internalModel?.motionManager?.stopAllMotions?.();
				for (const name of names) {
					if (seq !== motionSeq || !model) return false;
					try {
						const ok = await model.motion(name, void 0, priority);
						if (seq !== motionSeq || !model) return false;
						if (ok) return true;
					} catch {
						if (seq !== motionSeq || !model) return false;
					}
				}
				if (seq === motionSeq) {
					if (options.isInteraction) interactionActive = false;
					if (options.suppressFocus) releaseFocusSuppression();
				}
				return false;
			}
			/**
			* 播放状态动作：取该事件绑定的动作组随机打乱后逐个尝试；空数组 → 不播动作（spec §3）。
			* 状态动作会取代正在播放的互动/旧状态动作。
			*/
			function playState(state) {
				if (!model) return;
				const motion = splitMotionSelection(eventBindings[state]?.motions ?? []).motion;
				if (!motion) return;
				const names = [motion];
				interactionGen += 1;
				interactionActive = false;
				startMotionWithPriority(names, state === "idle" ? MotionPriority.IDLE : MotionPriority.FORCE, {
					suppressFocus: state !== "idle",
					isInteraction: false
				});
			}
			/** MotionManager.motionFinish：动作真正播完。互动结束后恢复当前状态动作并解除 focus 抑制。
			* 注意该事件在库内部 state.complete()/自动回 idle 之前同步触发，恢复动作需延到微任务，
			* 避免在 MotionManager.update 中间重入修改 MotionState。 */
			function handleMotionFinish() {
				const wasPreview = previewActive;
				previewActive = false;
				const wasInteraction = interactionActive;
				const gen = interactionGen;
				const seq = motionSeq;
				interactionActive = false;
				queueMicrotask(() => {
					if (seq !== motionSeq) return;
					releaseFocusSuppression();
					if (wasPreview) return;
					if (wasInteraction && gen === interactionGen && !interactionActive && lastState) playState(lastState);
				});
			}
			function applyState(next) {
				const state = demoState ?? next?.state ?? "idle";
				if (state !== lastState) {
					lastState = state;
					refreshExpressionTargets();
					if (interactionMode === "mutual") clearTapHold();
					const touchHolding = interactionMode === "touch-first" && tapActive();
					const line = pickEventLine(state, 0);
					if (isLongState(state)) {
						if (touchHolding) {
							clearLongState();
							longState = state;
						} else enterLongState(state, line);
					} else {
						clearLongState();
						const takeover = aiTakeover && aiEnabled;
						if (touchHolding) {} else if (takeover) hideBubble();
						else if (line !== void 0) showBubble(line);
						else hideBubble();
						if (state !== "idle" && !touchHolding) requestAiReply({
							kind: "state",
							state,
							hint: takeover ? void 0 : line
						});
					}
					if (!touchHolding) playState(state);
				}
				if (debugTextEl) debugTextEl.textContent = `agent: ${next?.agent ?? "-"}  pet: ${state}  v${next?.version ?? "-"}\nparts: ${touchParts.length}  expr: ${desiredExpressions().join("+") || "none"}\npos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}\nbounds: ${Math.round(baseModelW)}x${Math.round(baseModelH)}  canvas: ${canvas?.width ?? 0}x${canvas?.height ?? 0}`;
			}
			/** 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）。 */
			function showFallback() {
				if (!box || fallbackShown) return;
				fallbackShown = true;
				fallbackEl = document.createElement("div");
				fallbackEl.style.cssText = "pointer-events:auto;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;color:#fff";
				fallbackEl.textContent = "🐾";
				box.appendChild(fallbackEl);
			}
			/** 移除静态头像占位（模型（重新）加载前调用，避免降级与画布叠加）。 */
			function removeFallback() {
				if (fallbackEl && fallbackEl.parentNode) fallbackEl.parentNode.removeChild(fallbackEl);
				fallbackEl = null;
				fallbackShown = false;
			}
			/**
			* 画布逻辑尺寸 = 模型显示尺寸 + 四周留白（spec §7）：留白让动作/物理甩尾（尾巴等）不被
			* 画布裁切。模型缩放仍按「size = 模型可见宽度」计算（fitModel 用 (size-8)/baseW），
			* 模型大小不变、画布更大。每侧留白来自配置 canvasPadX/Y（size 百分比，下限 40px）。
			*/
			function modelCanvasSize(baseW, baseH, size) {
				const padX = Math.max(CANVAS_PAD_MIN, Math.round(size * canvasPadXPct / 100));
				const padY = Math.max(CANVAS_PAD_MIN, Math.round(size * canvasPadYPct / 100));
				if (!(baseW > 0 && baseH > 0)) return {
					width: size + padX * 2,
					height: Math.round(size * 1.2) + padY * 2
				};
				const scale = (size - 8) / baseW;
				const modelW = baseW * scale;
				const modelH = baseH * scale;
				return {
					width: Math.max(1, Math.round(modelW + padX * 2)),
					height: Math.max(1, Math.round(modelH + padY * 2))
				};
			}
			/**
			* 画布的逻辑尺寸（CSS px）：PIXI resolution 只放大内部缓冲，
			* 舞台/包围盒/指针坐标都用逻辑尺寸；autoDensity 会把 canvas.style 设成同一 LOGICAL 尺寸。
			*/
			function logicalCanvasSize() {
				try {
					const screen = app?.screen;
					if (screen && Number(screen.width) > 0 && Number(screen.height) > 0) return {
						width: Number(screen.width),
						height: Number(screen.height)
					};
				} catch {}
				const scale = renderScale();
				return {
					width: canvas ? canvas.width / scale : 0,
					height: canvas ? canvas.height / scale : 0
				};
			}
			/** 同步触摸部位叠加层的缓冲/CSS 尺寸（缓冲按渲染倍数放大，绘制时 ctx 再缩放）。 */
			function resizeOverlay(width, height) {
				if (!touchboxOverlay) return;
				const scale = renderScale();
				const bufferW = Math.max(1, Math.round(width * scale));
				const bufferH = Math.max(1, Math.round(height * scale));
				if (touchboxOverlay.width !== bufferW) touchboxOverlay.width = bufferW;
				if (touchboxOverlay.height !== bufferH) touchboxOverlay.height = bufferH;
				touchboxOverlay.style.width = `${width}px`;
				touchboxOverlay.style.height = `${height}px`;
			}
			/** 按当前尺寸重新适配模型（画布已就绪时调用；基准尺寸为 scale=1 时捕获值）。 */
			function fitModel(size) {
				if (!model || !canvas) return;
				const w = baseModelW;
				if (w > 0 && baseModelH > 0) {
					const s = (size - 8) / w;
					model.scale.set(s);
					model.anchor.set(.5, .5);
					const logical = logicalCanvasSize();
					model.position.set(logical.width / 2, logical.height / 2);
				}
			}
			/**
			* 画布中心点必须留在视口内（允许一半移出窗口，但拖不丢、能拖回来）：逻辑画布 W×H 时
			* right ∈ [-W/2, innerWidth-W/2]，bottom ∈ [-H/2, innerHeight-H/2]（spec §4）。
			*/
			function clampPosToViewport() {
				const { width: w, height: h } = logicalCanvasSize();
				if (!(w > 0 && h > 0)) return;
				const halfW = w / 2;
				const halfH = h / 2;
				pos.right = Math.min(window.innerWidth - halfW, Math.max(-halfW, pos.right));
				pos.bottom = Math.min(window.innerHeight - halfH, Math.max(-halfH, pos.bottom));
			}
			/** 把当前 pos 应用到宠物容器样式（不写盘；拖动/尺寸/窗口变化时调用）。 */
			function applyPosToBox() {
				if (!box) return;
				box.style.right = `${Math.round(pos.right)}px`;
				box.style.bottom = `${Math.round(pos.bottom)}px`;
				invalidateLayout();
			}
			/** 持久化当前位置（right/bottom，px）；失败静默，下次拖动/归位会再写。 */
			function persistDisplay() {
				api.setDisplay({
					right: Math.round(pos.right),
					bottom: Math.round(pos.bottom)
				}).catch(() => {});
			}
			/**
			* 按配置的默认位置计算 pos（spec §2）：「显示区中心点距右/距下」是**视口宽/高的百分比**——
			* 目标中心点 = (视口宽 × homeRight%、视口高 × homeBottom%)（相对右下角量），
			* 画布中心距右 = right + W/2、距下 = bottom + H/2，因此
			* right = 目标中心距右 - W/2、bottom = 目标中心距下 - H/2，最后按视口规则 clamp。
			*/
			function homePositionFromConfig() {
				const { width: w, height: h } = logicalCanvasSize();
				const cfg = view?.config;
				if (!cfg || !(w > 0 && h > 0)) return;
				const homeRightPct = Number.isFinite(cfg.homeRight) ? cfg.homeRight : 15;
				const homeBottomPct = Number.isFinite(cfg.homeBottom) ? cfg.homeBottom : 24;
				const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
				const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
				if (!(viewportW > 0 && viewportH > 0)) return;
				pos.right = viewportW * homeRightPct / 100 - w / 2;
				pos.bottom = viewportH * homeBottomPct / 100 - h / 2;
				clampPosToViewport();
			}
			/** 立即应用画布尺寸（size 视为模型可见宽度，高度按模型比例 + 四周留白自适应）。 */
			function applySizeNow(nextSize) {
				if (canvas && app) {
					const canvasSize = modelCanvasSize(baseModelW, baseModelH, nextSize);
					try {
						app.renderer.resize(canvasSize.width, canvasSize.height);
					} catch {}
					resizeOverlay(canvasSize.width, canvasSize.height);
					invalidateLayout();
					pos.size = nextSize;
					syncDebugPanelWidth();
					if (model) fitModel(nextSize);
					refreshHitBoxes();
					clampPosToViewport();
					applyPosToBox();
					updateDebugPanelPosition();
					updateBubblePosition();
				} else pos.size = nextSize;
			}
			/** 合并同帧/连发的尺寸变更：只落地最后一档（防 SSE 风暴卡死主线程）。 */
			function scheduleSize(nextSize) {
				if (nextSize === pos.size && pendingSize === null) return;
				pendingSize = nextSize;
				if (sizeRaf) return;
				sizeRaf = window.requestAnimationFrame(() => {
					sizeRaf = 0;
					const size = pendingSize;
					pendingSize = null;
					if (size !== null && size !== pos.size) applySizeNow(size);
				});
			}
			/** 销毁当前渲染层（app/canvas/模型引用/静态头像占位）。 */
			function teardownLayer() {
				motionSeq += 1;
				interactionGen += 1;
				interactionActive = false;
				previewActive = false;
				focusSuppressed = false;
				lastPointerClient = null;
				detachMotionFinish?.();
				detachMotionFinish = null;
				if (sizeRaf) {
					window.cancelAnimationFrame(sizeRaf);
					sizeRaf = 0;
				}
				pendingSize = null;
				stopOverlayLoop();
				hitBoxEntries = [];
				hitBoxesSignature = "";
				hitLayer = null;
				if (app) try {
					app.destroy(true);
				} catch {}
				app = null;
				model = null;
				baseModelW = 0;
				baseModelH = 0;
				if (touchboxOverlay && touchboxOverlay.parentNode) touchboxOverlay.parentNode.removeChild(touchboxOverlay);
				touchboxOverlay = null;
				if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
				canvas = null;
				if (bubble && petLayer && bubble.parentNode === petLayer && box) {
					bubble.style.opacity = "0";
					box.appendChild(bubble);
				}
				if (petLayer && petLayer.parentNode) petLayer.parentNode.removeChild(petLayer);
				petLayer = null;
				invalidateLayout();
				debugPanelTopLogical = NaN;
				removeFallback();
			}
			/** 加载/重载模型层：销毁旧层 → 新建画布与 PIXI app → 绑定指针事件。 */
			async function loadModelLayer(url) {
				teardownLayer();
				if (disposed) return;
				if (!url || !box) {
					showFallback();
					return;
				}
				try {
					petLayer = document.createElement("div");
					petLayer.style.cssText = "position:relative;display:inline-block;pointer-events:none";
					canvas = document.createElement("canvas");
					const size = pos.size;
					const placeholder = modelCanvasSize(0, 0, size);
					canvas.width = placeholder.width;
					canvas.height = placeholder.height;
					canvas.style.cssText = "pointer-events:none;display:block";
					touchboxOverlay = document.createElement("canvas");
					touchboxOverlay.width = Math.round(canvas.width * renderScale());
					touchboxOverlay.height = Math.round(canvas.height * renderScale());
					touchboxOverlay.style.cssText = `position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;pointer-events:none;z-index:2;display:${touchboxOverlayVisible() ? "block" : "none"}`;
					hitLayer = document.createElement("div");
					hitLayer.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3";
					petLayer.appendChild(canvas);
					petLayer.appendChild(touchboxOverlay);
					petLayer.appendChild(hitLayer);
					if (bubble && bubble.parentNode !== petLayer) petLayer.appendChild(bubble);
					if (debugEl) petLayer.appendChild(debugEl);
					box.appendChild(petLayer);
					const M = PIXI.live2d?.Live2DModel;
					if (!M) throw new Error("Live2DModel 不可用");
					app = new PIXI.Application({
						view: canvas,
						width: canvas.width,
						height: canvas.height,
						backgroundAlpha: 0,
						antialias: true,
						resolution: renderScale(),
						autoDensity: true,
						powerPreference: "low-power"
					});
					try {
						app.ticker.maxFPS = maxFps;
					} catch {}
					pushCleanup(() => {
						try {
							app?.destroy(true);
						} catch {}
					});
					const loaded = await M.from(url, { autoInteract: false });
					if (disposed) {
						teardownLayer();
						return;
					}
					model = loaded;
					baseModelW = Number(loaded.width) || 0;
					baseModelH = Number(loaded.height) || 0;
					app.stage.addChild(loaded);
					try {
						const b = loaded.getBounds?.();
						if (b && b.width > 0 && b.height > 0) {
							baseModelW = b.width;
							baseModelH = b.height;
						}
					} catch {}
					const canvasSize = modelCanvasSize(baseModelW, baseModelH, pos.size);
					try {
						app.renderer.resize(canvasSize.width, canvasSize.height);
					} catch {}
					resizeOverlay(canvasSize.width, canvasSize.height);
					syncDebugPanelWidth();
					const motionManager = loaded.internalModel?.motionManager;
					if (motionManager?.on) {
						motionManager.on("motionFinish", handleMotionFinish);
						detachMotionFinish?.();
						detachMotionFinish = () => motionManager.off?.("motionFinish", handleMotionFinish);
					}
					const internal = loaded.internalModel;
					if (internal && typeof internal.update === "function") {
						const originalUpdate = internal.update.bind(internal);
						internal.update = (dt = 1 / 60, now = performance.now()) => {
							applyExpressionParams(internal.coreModel, dt);
							return originalUpdate(dt, now);
						};
					}
					refreshDebugMotionGroups();
					fitModel(pos.size);
					if (!(baseModelW > 0 && baseModelH > 0)) try {
						app.ticker.addOnce(() => fitModel(pos.size));
					} catch {}
					if (lastState) playState(lastState);
					syncTouchboxOverlay();
					refreshHitBoxes();
					clampPosToViewport();
					applyPosToBox();
					invalidateLayout();
					applyBubbleStyle();
					syncDebugPanelWidth();
					updateDebugPanelPosition();
					updateBubblePosition();
				} catch (error) {
					clientLog("error", "model layer load failed", error);
					teardownLayer();
					if (!disposed) showFallback();
				}
			}
			/** 模型重载队列：串行执行，避免快速切换时并发加载。 */
			let modelLoadQueue = Promise.resolve();
			function queueModelLoad(url) {
				modelLoadQueue = modelLoadQueue.then(() => loadModelLayer(url)).catch(() => {});
			}
			/** 当前是否显示触摸部位叠加层：编辑态强制显示草稿 box，否则看开发者选项（spec §2/§4）。 */
			function touchboxOverlayVisible() {
				return editState !== null || showTapZones;
			}
			/** 模型包围盒（画布逻辑 px）；无效时 null。命中/气泡/色块/面板共用，避免每帧重复取。 */
			function modelBounds() {
				try {
					const b = model?.getBounds?.();
					if (b && b.width > 0 && b.height > 0) return {
						x: b.x,
						y: b.y,
						width: b.width,
						height: b.height
					};
				} catch {}
				return null;
			}
			/** 包围盒签名（0.5px 粒度）：只有包围盒真的变了才重排浮层（静止时整帧跳过）。 */
			function boundsKey(bounds) {
				if (!bounds) return "";
				const q = (v) => Math.round(v * 2) / 2;
				return `${q(bounds.x)},${q(bounds.y)},${q(bounds.width)},${q(bounds.height)}`;
			}
			/** petLayer 的视口 rect（带缓存；位置/尺寸/模型/窗口变化时用 invalidateLayout 失效）。 */
			function layerRect() {
				if (!petLayer) return null;
				if (!layerRectCache) try {
					layerRectCache = petLayer.getBoundingClientRect();
				} catch {
					return null;
				}
				return layerRectCache;
			}
			/** 失效布局缓存（下一次需要时重新测量一次），避免每帧强制同步布局。 */
			function invalidateLayout() {
				layerRectCache = null;
				panelSizeCache = null;
				canvasRectCache = null;
			}
			/** 浮层循环的帧间隔（跟随 settings.maxFps；0 = 不限，按 rAF 自然节奏）。 */
			function overlayFrameIntervalMs() {
				if (!(maxFps > 0)) return 0;
				return Math.max(8, 1e3 / maxFps);
			}
			/**
			* 单条 rAF 驱动全部浮层跟随（spec §3/§4）：命中层、调试面板、气泡、触摸色块。
			* - 按 settings.maxFps 节流（此前固定 60fps，不受帧率档影响）；
			* - 包围盒未变（待机/静止）时整帧跳过样式写；
			* - 布局读取走缓存，避免每帧 getBoundingClientRect / offsetWidth 触发同步布局。
			*/
			function overlayTick(now) {
				if (!overlayRaf || disposed) return;
				overlayRaf = window.requestAnimationFrame(overlayTick);
				if (now - overlayLastAt < overlayFrameIntervalMs()) return;
				overlayLastAt = now;
				const bounds = modelBounds();
				const key = boundsKey(bounds);
				if (key !== overlayHitKey) {
					overlayHitKey = key;
					updateHitBoxPositions(bounds);
				}
				updateDebugPanelPosition(bounds);
				updateBubblePosition(bounds);
				if (touchboxOverlayVisible()) paintTouchBoxes(bounds, key);
			}
			/** 停止浮层循环（并复位签名，下次启动强制重算一次位置）。 */
			function stopOverlayLoop() {
				if (overlayRaf) {
					window.cancelAnimationFrame(overlayRaf);
					overlayRaf = 0;
				}
				overlayLastAt = 0;
				overlayHitKey = "";
				overlayPaintKey = "";
			}
			/** 按当前显隐状态启停浮层循环：宠物可见/编辑态才跑，隐藏或卸载即停。 */
			function syncOverlayLoop() {
				if (!(petShown() && hitLayer !== null || touchboxOverlayVisible() && touchboxOverlay !== null)) {
					stopOverlayLoop();
					return;
				}
				if (overlayRaf) return;
				overlayLastAt = 0;
				overlayHitKey = "";
				overlayPaintKey = "";
				overlayRaf = window.requestAnimationFrame(overlayTick);
			}
			/**
			* 绘制当前触摸部位的全部 box（spec §4）：编辑态用设置页草稿 parts，否则用已保存 parts。
			* box 归一化坐标（相对模型包围盒 0–1）换算成 canvas 像素矩形；半透明填充 + 部位名标签，
			* 不同部位按调色板循环取色，highlightPartId 高亮部位用更亮更粗的描边。
			*/
			function paintTouchBoxes(boundsArg, keyHint) {
				if (!touchboxOverlayVisible() || !touchboxOverlay || !canvas || !model) return;
				const { width: w, height: h } = logicalCanvasSize();
				if (!(w > 0 && h > 0)) return;
				resizeOverlay(w, h);
				if (touchboxOverlay.style.display !== "block") touchboxOverlay.style.display = "block";
				const bounds = boundsArg === void 0 ? modelBounds() : boundsArg;
				if (!bounds) return;
				const parts = editState?.parts ?? touchParts;
				const highlightId = editState?.highlightPartId ?? null;
				const paintKey = `${keyHint ?? boundsKey(bounds)}|${hitBoxesKey()}|${highlightId ?? ""}|${w}x${h}`;
				if (paintKey === overlayPaintKey) return;
				overlayPaintKey = paintKey;
				const overlayScale = touchboxOverlay.width / w;
				const ctx = touchboxOverlay.getContext("2d");
				if (!ctx) return;
				ctx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0);
				ctx.clearRect(0, 0, w, h);
				const { x: bx, y: by, width: bw, height: bh } = bounds;
				for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
					const part = parts[partIndex];
					const scheme = TOUCHBOX_PALETTE[partIndex % TOUCHBOX_PALETTE.length];
					const highlighted = highlightId !== null && part.id === highlightId;
					for (const box of part.boxes) {
						const x = bx + bw * box.left;
						const y = by + bh * box.top;
						const rw = bw * (box.right - box.left);
						const rh = bh * (box.bottom - box.top);
						if (!(rw > 0 && rh > 0)) continue;
						ctx.fillStyle = scheme.fill;
						ctx.fillRect(x, y, rw, rh);
						ctx.lineWidth = highlighted ? 3 : 1.5;
						ctx.strokeStyle = highlighted ? "rgba(255,255,255,.98)" : scheme.stroke;
						ctx.strokeRect(x + .5, y + .5, rw - 1, rh - 1);
						ctx.save();
						ctx.beginPath();
						ctx.rect(x, y, rw, rh);
						ctx.clip();
						ctx.font = "bold 11px ui-monospace,monospace";
						ctx.fillStyle = "rgba(255,255,255,.96)";
						ctx.shadowColor = "rgba(0,0,0,.7)";
						ctx.shadowBlur = 3;
						ctx.fillText(part.name, x + 4, y + 14);
						ctx.restore();
					}
				}
			}
			/** 同步叠加层显隐与重绘（编辑态强制显示；非编辑态由 showTapZones 决定，spec §2/§4）。
			*  逐帧重绘由统一浮层循环（overlayTick）驱动，这里只管启停与首帧。 */
			function syncTouchboxOverlay() {
				const on = touchboxOverlayVisible();
				if (touchboxOverlay) touchboxOverlay.style.display = on ? "block" : "none";
				if (on) {
					overlayPaintKey = "";
					paintTouchBoxes();
				}
				syncOverlayLoop();
			}
			/** 命中判定当前使用的部位列表：预览/编辑态用设置页草稿，否则用已保存部位（spec §4）。 */
			function activeTouchParts() {
				return editState?.parts ?? touchParts;
			}
			/** 命中 box 集合签名：仅部位/box 变化时重建命中 div（位置每帧单独更新）。 */
			function hitBoxesKey() {
				return JSON.stringify(activeTouchParts().flatMap((part) => part.boxes.map((b) => [
					b.left,
					b.top,
					b.right,
					b.bottom
				])));
			}
			/** 每帧按模型当前包围盒把命中 div 换算成 CSS 像素矩形（跟随动作/物理/尺寸变化）。
			*  bounds 由统一浮层循环传入；每格记录上次写入值，值没变就不写样式。 */
			function updateHitBoxPositions(bounds = modelBounds()) {
				if (!hitLayer || hitBoxEntries.length === 0) return;
				if (!bounds) {
					for (const entry of hitBoxEntries) {
						if (entry.last === "hidden") continue;
						entry.last = "hidden";
						entry.el.style.display = "none";
					}
					return;
				}
				const { x: bx, y: by, width: bw, height: bh } = bounds;
				for (const entry of hitBoxEntries) {
					const { el, box } = entry;
					const x = bx + bw * box.left;
					const y = by + bh * box.top;
					const w = bw * (box.right - box.left);
					const h = bh * (box.bottom - box.top);
					if (!(w > 0 && h > 0)) {
						if (entry.last !== "hidden") {
							entry.last = "hidden";
							el.style.display = "none";
						}
						continue;
					}
					const key = `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2},${Math.round(w * 2) / 2},${Math.round(h * 2) / 2}`;
					if (key === entry.last) continue;
					entry.last = key;
					el.style.display = "";
					el.style.left = `${x}px`;
					el.style.top = `${y}px`;
					el.style.width = `${Math.max(1, w)}px`;
					el.style.height = `${Math.max(1, h)}px`;
				}
			}
			/** 指针事件统一挂在命中 div 上（canvas 已 pointer-events:none，命中层外事件穿透下层 UI）。 */
			function bindHitEvents(el) {
				el.addEventListener("pointerdown", handlePointerDown);
				el.addEventListener("pointermove", handlePointerMove);
				el.addEventListener("pointerup", handlePointerUp);
				el.addEventListener("pointercancel", () => {
					down = null;
					dragging = false;
				});
			}
			/** 按当前部位 box 重建命中层 div；无任何 box 时回退为覆盖模型包围盒的一个命中区。 */
			function rebuildHitBoxes() {
				if (!hitLayer) return;
				hitLayer.textContent = "";
				hitBoxEntries = [];
				const boxes = activeTouchParts().flatMap((part) => part.boxes);
				if (boxes.length === 0) boxes.push({
					left: 0,
					top: 0,
					right: 1,
					bottom: 1
				});
				for (const box of boxes) {
					const el = document.createElement("div");
					el.style.cssText = "position:absolute;pointer-events:auto;background:transparent;touch-action:none";
					bindHitEvents(el);
					hitLayer.appendChild(el);
					hitBoxEntries.push({
						el,
						box,
						last: ""
					});
				}
				updateHitBoxPositions();
			}
			/** 部位/box 或尺寸/模型变化后刷新命中层（签名不变时只更新位置，不重建 div）。 */
			function refreshHitBoxes() {
				if (!hitLayer) return;
				const key = hitBoxesKey();
				if (key !== hitBoxesSignature || hitBoxEntries.length === 0) {
					hitBoxesSignature = key;
					rebuildHitBoxes();
				} else updateHitBoxPositions();
				syncOverlayLoop();
			}
			/** 退出触摸部位编辑态：恢复常规显隐逻辑（尊重 enabled）；showTapZones 开启时继续显示已保存部位。 */
			function exitTouchEdit() {
				if (!editState) return;
				editState = null;
				syncPetVisibility();
				syncTouchboxOverlay();
				refreshHitBoxes();
				if (touchboxOverlayVisible()) paintTouchBoxes();
			}
			/**
			* 设置页「编辑触摸部位」事件（spec §4）：编辑态强制显示宠物（即使插件关闭）并实时绘制草稿 box；
			* 编辑事件里的模型与当前快照不一致时忽略该编辑态（设置页负责退出）。
			*/
			function handleTouchEdit(state) {
				if (!state.active) {
					exitTouchEdit();
					return;
				}
				if (view && state.model !== view.config.model) {
					exitTouchEdit();
					return;
				}
				editState = state;
				syncPetVisibility();
				syncTouchboxOverlay();
				refreshHitBoxes();
				paintTouchBoxes();
			}
			/** 调试面板的动画下拉同步（模型加载/切换时刷新选项）。 */
			function updateDebugMotionSelect() {
				if (!debugMotionSelect) return;
				const previous = debugMotionSelect.value;
				debugMotionSelect.textContent = "";
				if (debugMotionList.length === 0) {
					const opt = document.createElement("option");
					opt.value = "";
					opt.textContent = "（无动画或模型未加载）";
					debugMotionSelect.appendChild(opt);
					debugMotionSelect.value = "";
					return;
				}
				const groups = [...new Set(debugMotionList.map((item) => item.group))];
				for (const group of groups) {
					const optgroup = document.createElement("optgroup");
					optgroup.label = group;
					for (const item of debugMotionList) {
						if (item.group !== group) continue;
						const opt = document.createElement("option");
						opt.value = `${item.group}\u0000${item.index}`;
						opt.textContent = item.label;
						optgroup.appendChild(opt);
					}
					debugMotionSelect.appendChild(optgroup);
				}
				if (debugMotionList.some((item) => `${item.group}\u0000${item.index}` === previous)) debugMotionSelect.value = previous;
				else debugMotionSelect.value = "";
			}
			/** 从模型原生 .model3.json 拉取全部具体动画列表（不经过插件状态/映射逻辑）。 */
			async function refreshDebugMotionGroups() {
				const url = currentModelUrl;
				const currentModel = model;
				if (!url || !currentModel) return;
				const cached = motionListCache.get(url);
				if (cached) {
					if (model === currentModel && debugMotionSelect) {
						debugMotionList = cached;
						updateDebugMotionSelect();
					}
					return;
				}
				try {
					const res = await fetch(url);
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json();
					const motions = data?.FileReferences?.Motions ?? data?.Motions ?? {};
					const list = [];
					for (const [group, items] of Object.entries(motions)) {
						if (!Array.isArray(items)) continue;
						items.forEach((motion, index) => {
							const file = typeof motion === "object" && motion !== null && "File" in motion ? String(motion.File ?? index) : String(index);
							list.push({
								group,
								index,
								label: `${group} / ${file}`
							});
						});
					}
					motionListCache.set(url, list);
					if (model !== currentModel || !debugMotionSelect) return;
					debugMotionList = list;
					updateDebugMotionSelect();
				} catch {
					const defs = currentModel.internalModel?.motionManager?.definitions ?? {};
					const list = [];
					for (const [group, motions] of Object.entries(defs)) {
						if (!Array.isArray(motions)) continue;
						motions.forEach((motion, index) => {
							const file = typeof motion === "object" && motion !== null && "File" in motion ? String(motion.File ?? index) : String(index);
							list.push({
								group,
								index,
								label: `${group} / ${file}`
							});
						});
					}
					if (model !== currentModel || !debugMotionSelect) return;
					debugMotionList = list;
					updateDebugMotionSelect();
				}
			}
			/** debug 预览：直接播放模型原生指定动画（动作组 + 下标）。
			*  每次点击都 stopAllMotions 后重播，因此同一动画也可反复预览；
			*  预览期间抑制 focus，播完只恢复跟随，不触发状态动作恢复。 */
			function previewMotion(value) {
				if (!model || !value) return;
				const sep = value.indexOf("\0");
				if (sep < 0) return;
				const group = value.slice(0, sep);
				const index = Number(value.slice(sep + 1));
				if (!Number.isInteger(index)) return;
				const currentModel = model;
				++motionSeq;
				previewActive = true;
				focusSuppressed = true;
				currentModel.internalModel?.focusController?.focus(0, 0, true);
				currentModel.internalModel?.motionManager?.stopAllMotions?.();
				currentModel.motion(group, index, MotionPriority.FORCE);
			}
			/** 调试面板宽度/最大高度（浮层不占布局，spec §2）：宽度 min(280, 画布逻辑宽度-16)，
			*  最大高度 min(420, 视口高*0.5) 且可滚动，避免面板过高无处放。 */
			function syncDebugPanelWidth() {
				if (!debugEl) return;
				const canvasWidth = app ? logicalCanvasSize().width : canvas?.width ?? pos.size;
				const width = Math.max(120, Math.min(280, Math.round(canvasWidth - 16)));
				debugEl.style.width = `${width}px`;
				debugEl.style.boxSizing = "border-box";
				debugEl.style.maxHeight = `${Math.max(80, Math.min(420, Math.round(window.innerHeight * .5)))}px`;
				debugEl.style.overflowY = "auto";
			}
			/**
			* 调试面板定位（spec §2）：浮在模型包围盒**上方**（不覆盖角色），允许伸出画布留白/画布
			* 上边缘（逻辑 top 可为负），但整体保持在视口内。用 petLayer 的视口 rect 换算：
			* 期望视口 top = rect.top + bounds.y - 8 - panelHeight，clamp 到 [8, innerHeight-panelH-8]，
			* 再换算回 petLayer 逻辑 top = clampedTop - rect.top；水平同理。
			* 每帧由命中层 rAF 调用（跟随动作/内容高度变化），并记录逻辑顶部供气泡避让。
			*/
			function updateDebugPanelPosition(boundsArg) {
				debugPanelTopLogical = NaN;
				if (!debugEl || !petLayer || debugEl.parentNode !== petLayer || !model) return;
				const bounds = boundsArg === void 0 ? modelBounds() : boundsArg;
				if (!bounds) return;
				if (!panelSizeCache) {
					const width = debugEl.offsetWidth;
					const height = debugEl.offsetHeight;
					if (!(width > 0 && height > 0)) return;
					panelSizeCache = {
						width,
						height
					};
				}
				const { width: panelWidth, height: panelHeight } = panelSizeCache;
				const rect = layerRect();
				if (!rect) return;
				const maxViewportTop = Math.max(8, window.innerHeight - panelHeight - 8);
				const viewportTop = Math.min(Math.max(rect.top + bounds.y - 8 - panelHeight, 8), maxViewportTop);
				const maxViewportLeft = Math.max(8, window.innerWidth - panelWidth - 8);
				const viewportLeft = Math.min(Math.max(rect.left + bounds.x + bounds.width / 2 - panelWidth / 2, 8), maxViewportLeft);
				const top = viewportTop - rect.top;
				const left = viewportLeft - rect.left;
				debugEl.style.left = `${left}px`;
				debugEl.style.top = `${top}px`;
				debugPanelTopLogical = top;
			}
			/** 调试面板动态开关（spec §2）。 */
			function ensureDebugPanel(show) {
				if (show && !debugEl && box) {
					debugEl = document.createElement("div");
					debugEl.style.cssText = "position:absolute;z-index:5;pointer-events:auto;padding:10px 12px;background:rgba(24,26,36,.94);color:#e8eaf0;border:1px solid rgba(128,128,128,.22);border-radius:10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.35)";
					const debugTitle = document.createElement("div");
					debugTitle.style.cssText = "font-size:12px;font-weight:600;color:#aeb8cc;letter-spacing:.3px;margin-bottom:2px";
					debugTitle.textContent = "调试面板";
					debugEl.appendChild(debugTitle);
					const sectionLabel = (text) => {
						const el = document.createElement("div");
						el.style.cssText = "margin:10px 0 4px;color:#7f8aa0;font-size:11px;font-weight:600;letter-spacing:.3px";
						el.textContent = text;
						return el;
					};
					const demoLabel = sectionLabel("状态演示");
					debugEl.appendChild(demoLabel);
					const demoRow = document.createElement("div");
					demoRow.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:4px";
					for (const st of [
						"idle",
						"thinking",
						"waiting",
						"done",
						"delivered",
						"error"
					]) {
						const btn = document.createElement("button");
						btn.textContent = st;
						btn.style.cssText = "padding:4px 0;border-radius:6px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.1);color:#dbe2ef;font-size:11px;font-family:inherit;cursor:pointer;outline:none";
						btn.onmouseenter = () => {
							btn.style.background = "rgba(120,170,255,.22)";
						};
						btn.onmouseleave = () => {
							btn.style.background = "rgba(128,128,128,.1)";
						};
						btn.onclick = () => {
							demoState = demoState === st ? null : st;
							applyState(view);
						};
						demoRow.appendChild(btn);
					}
					debugEl.appendChild(demoRow);
					const motionLabel = sectionLabel("动画预览");
					debugEl.appendChild(motionLabel);
					const motionSelect = document.createElement("select");
					motionSelect.style.cssText = "flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none";
					motionSelect.onchange = () => previewMotion(motionSelect.value);
					const motionPlay = document.createElement("button");
					motionPlay.textContent = "播放";
					motionPlay.style.cssText = "padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none";
					motionPlay.onmouseenter = () => {
						motionPlay.style.background = "rgba(120,170,255,.4)";
					};
					motionPlay.onmouseleave = () => {
						motionPlay.style.background = "rgba(120,170,255,.28)";
					};
					motionPlay.onclick = () => previewMotion(motionSelect.value);
					const motionRow = document.createElement("div");
					motionRow.style.cssText = "display:flex;gap:6px;align-items:center";
					motionRow.appendChild(motionSelect);
					motionRow.appendChild(motionPlay);
					debugMotionSelect = motionSelect;
					debugEl.appendChild(motionRow);
					const exprLabel = sectionLabel("表情预览");
					debugEl.appendChild(exprLabel);
					const exprRow = document.createElement("div");
					exprRow.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:4px";
					const exprButtons = [];
					const paintExprButtons = () => {
						for (const { id, btn } of exprButtons) {
							const active = (debugExpression ?? "none") === id;
							btn.style.background = active ? "rgba(120,170,255,.38)" : "rgba(128,128,128,.1)";
							btn.style.borderColor = active ? "rgba(120,170,255,.55)" : "rgba(128,128,128,.25)";
						}
					};
					for (const expression of EXPRESSIONS) {
						const btn = document.createElement("button");
						btn.textContent = expression.name;
						btn.style.cssText = "padding:3px 0;border-radius:6px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.1);color:#dbe2ef;font-size:11px;font-family:inherit;cursor:pointer;outline:none";
						btn.onclick = () => {
							debugExpression = debugExpression === expression.id ? null : expression.id;
							refreshExpressionTargets();
							paintExprButtons();
						};
						exprButtons.push({
							id: expression.id,
							btn
						});
						exprRow.appendChild(btn);
					}
					paintExprButtons();
					debugEl.appendChild(exprRow);
					debugTextEl = document.createElement("div");
					debugTextEl.style.cssText = "margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.18);color:#9aa5b8;font-size:11px;white-space:pre-wrap;word-break:break-all";
					debugEl.appendChild(debugTextEl);
					syncDebugPanelWidth();
					refreshDebugMotionGroups();
					if (petLayer) petLayer.appendChild(debugEl);
					else box.appendChild(debugEl);
					updateDebugPanelPosition();
					applyState(view);
				} else if (!show && debugEl) {
					previewActive = false;
					focusSuppressed = false;
					debugEl.parentNode?.removeChild(debugEl);
					debugEl = null;
					debugMotionSelect = null;
					debugTextEl = null;
					debugPanelTopLogical = NaN;
				} else if (show && debugEl && !debugEl.parentNode) {
					if (petLayer) petLayer.appendChild(debugEl);
					else if (box) box.appendChild(debugEl);
					updateDebugPanelPosition();
				}
			}
			/** 当前应显示的表情 id 列表：调试预览 > 触摸临时表情 > 当前事件绑定（spec §5）。 */
			function desiredExpressions() {
				if (debugExpression) {
					const id = normalizeExpressionId(debugExpression);
					return id === "none" ? [] : [id];
				}
				if (tempExpressions.length > 0) {
					if (Date.now() < tempExpressionUntil) return tempExpressions;
					tempExpressions = [];
				}
				if (!lastState) return [];
				return splitMotionSelection(eventBindings[lastState]?.motions ?? []).expressions;
			}
			/** 表情目标值缓存：只在表情/状态真的变化时重算（此前每帧重新映射 + 分配对象）。 */
			let expressionTargets = {};
			/** 目标是否已全部收敛：收敛后整帧跳过写入（动作/物理不会改这些开关参数）。 */
			let expressionSettled = false;
			/** 刷新表情目标值（状态/触摸/调试预览变化时调用）。 */
			function refreshExpressionTargets() {
				expressionTargets = expressionParams(desiredExpressions());
				expressionSettled = false;
			}
			/**
			* 写入表情参数：布尔开关按「当前表情」目标值 0/1，带淡入淡出。
			* 在 InternalModel.update 之前调用——动作/物理不会写这些参数，先写即生效。
			*/
			function applyExpressionParams(coreModel, dt) {
				const set = coreModel?.setParameterValueById;
				if (typeof set !== "function") return;
				if (tempExpressions.length > 0 && Date.now() >= tempExpressionUntil) {
					tempExpressions = [];
					refreshExpressionTargets();
				}
				if (expressionSettled) return;
				const fade = Math.min(1, Math.max(.02, dt * 1e3 / EXPRESSION_FADE_MS));
				let settled = true;
				for (const param of EXPRESSION_SWITCH_PARAMS) {
					const target = expressionTargets[param] ?? 0;
					const current = expressionMix.get(param) ?? 0;
					if (Math.abs(target - current) < .004) {
						if (current !== target) {
							expressionMix.set(param, target);
							try {
								set.call(coreModel, param, target, 1);
							} catch {}
						}
						continue;
					}
					settled = false;
					const next = current + (target - current) * fade;
					expressionMix.set(param, next);
					try {
						set.call(coreModel, param, next, 1);
					} catch {}
				}
				expressionSettled = settled;
			}
			/** 运行时应用配置变化（spec §2/§3/§6/§7）：开关 / 尺寸 / 帧率 / 调试 / 触摸部位 / 事件绑定 / 模型。 */
			function applyConfig(next) {
				const cfg = next.config;
				enabled = cfg.enabled;
				syncPetVisibility();
				const nextEvents = cfg.events ?? DEFAULT_EVENT_BINDINGS;
				const eventsSignature = JSON.stringify(nextEvents);
				if (eventsSignature !== eventBindingsSignature) {
					eventBindings = nextEvents;
					eventBindingsSignature = eventsSignature;
					if (longState !== null && !dragging) showStickyText();
				}
				ensureDebugPanel(cfg.debug);
				showTapZones = !!cfg.showTapZones;
				touchParts = Array.isArray(cfg.touchParts) ? cfg.touchParts : [];
				syncTouchboxOverlay();
				if (touchboxOverlayVisible()) paintTouchBoxes();
				refreshHitBoxes();
				applyMaxFps(cfg.maxFps);
				const nextPadX = Number.isFinite(cfg.canvasPadX) ? cfg.canvasPadX : 125;
				const nextPadY = Number.isFinite(cfg.canvasPadY) ? cfg.canvasPadY : 50;
				const padChanged = nextPadX !== canvasPadXPct || nextPadY !== canvasPadYPct;
				canvasPadXPct = nextPadX;
				canvasPadYPct = nextPadY;
				const nextSize = cfg.size;
				if (nextSize !== pos.size) scheduleSize(nextSize);
				else if (padChanged && canvas && app) applySizeNow(nextSize);
				const nextUrl = cfg.modelUrl || null;
				if (nextUrl !== currentModelUrl) {
					currentModelUrl = nextUrl;
					queueModelLoad(nextUrl);
				}
				if (!next.displaySaved && !homeApplied) {
					homeApplied = true;
					homePositionFromConfig();
					applyPosToBox();
					persistDisplay();
				}
				clampPosToViewport();
				applyPosToBox();
				bubbleOffsetX = Number.isFinite(cfg.bubbleOffsetX) ? cfg.bubbleOffsetX : 0;
				bubbleOffsetY = Number.isFinite(cfg.bubbleOffsetY) ? cfg.bubbleOffsetY : -15;
				bubbleBgColor = typeof cfg.bubbleBgColor === "string" && cfg.bubbleBgColor.trim() ? cfg.bubbleBgColor : DEFAULT_BUBBLE_BG_COLOR;
				bubbleBgOpacity = Number.isFinite(cfg.bubbleBgOpacity) ? cfg.bubbleBgOpacity : 92;
				bubbleTextColor = typeof cfg.bubbleTextColor === "string" && cfg.bubbleTextColor.trim() ? cfg.bubbleTextColor : DEFAULT_BUBBLE_TEXT_COLOR;
				aiEnabled = cfg.aiEnabled === true;
				aiTouchOnly = cfg.aiTouchOnly === true;
				aiTakeover = cfg.aiTakeover === true;
				interactionMode = normalizeInteractionMode(cfg.interactionMode, interactionMode);
				applyLongAiConfig(cfg);
				applyBubbleMaxConfig(cfg);
				applyBubbleStyle();
				syncDebugPanelWidth();
				updateDebugPanelPosition();
				updateBubblePosition();
			}
			let down = null;
			let dragging = false;
			function handlePointerDown(e) {
				down = {
					x: e.clientX,
					y: e.clientY,
					startRight: pos.right,
					startBottom: pos.bottom
				};
				dragging = false;
				e.currentTarget?.setPointerCapture?.(e.pointerId);
			}
			function handlePointerMove(e) {
				if (!down) return;
				const dx = e.clientX - down.x;
				const dy = e.clientY - down.y;
				if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
					dragging = true;
					if (bubble) bubble.style.opacity = "0";
				}
				if (dragging && box) {
					pos.right = down.startRight - dx;
					pos.bottom = down.startBottom - dy;
					clampPosToViewport();
					applyPosToBox();
				}
			}
			function handlePointerUp(e) {
				if (!down) return;
				if (dragging) {
					api.setDisplay({
						right: Math.round(pos.right),
						bottom: Math.round(pos.bottom)
					}).catch(() => {});
					showStickyText();
				} else handleTap(e);
				down = null;
				dragging = false;
			}
			function handleGlobalPointerMove(e) {
				lastPointerClient = {
					x: e.clientX,
					y: e.clientY
				};
				if (!model || !canvas || dragging || !petShown() || hidden || focusSuppressed) return;
				applyFocus(e.clientX, e.clientY);
			}
			function handleGlobalMouseOut(e) {
				if (e.relatedTarget) return;
				lastPointerClient = null;
				if (!model || dragging || !petShown() || hidden) return;
				if (!focusSuppressed) model.internalModel?.focusController?.focus(0, 0, true);
			}
			/**
			* AI 回复（ADR-025）：Host 生成一句台词后替换气泡；失败/超时保持预置台词不动。
			* 连点时只采用最新一次请求的结果（`aiRequestSeq`）。
			*/
			async function requestAiReply(input, options) {
				if (!aiEnabled) return null;
				if (aiTouchOnly && input.kind === "state") return null;
				if (input.kind === "state" && interactionMode !== "event-first" && tapActive()) return null;
				const seq = ++aiRequestSeq;
				const targetState = input.state;
				try {
					const result = await api.interact(input);
					if (seq !== aiRequestSeq) return null;
					if (targetState !== void 0 && targetState !== lastState) return null;
					if (!result.ok || !result.text) return null;
					if (options?.sticky) bubbleStickyText = result.text;
					showAiBubble(result.text);
					return result.text;
				} catch {
					return null;
				}
			}
			function handleTap(e) {
				if (!canvas || !model) return;
				const now = Date.now();
				if (now - lastTapAt < TAP_DEBOUNCE_MS) return;
				lastTapAt = now;
				try {
					const rect = canvas.getBoundingClientRect();
					const localX = e.clientX - rect.left;
					const localY = e.clientY - rect.top;
					const bounds = model.getBounds?.();
					if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return;
					const ratio = pointToBoundsRatio(localX, localY, bounds);
					if (!ratio) return;
					const part = hitTestTouchParts(editState?.parts ?? touchParts, ratio.nx, ratio.ny);
					if (!part) return;
					beginTapHold();
					let spoken;
					const takeover = aiTakeover && aiEnabled;
					if (!takeover && part.lines && part.lines.length > 0) {
						const line = pickLine(part.lines, lastPartLine.get(part.id));
						if (line !== void 0) {
							lastPartLine.set(part.id, line);
							showBubble(line);
							spoken = line;
						}
					}
					requestAiReply({
						kind: "tap",
						part: part.name,
						hint: takeover ? void 0 : spoken
					});
					const selection = splitMotionSelection(part.motions);
					if (selection.expressions.length > 0) {
						tempExpressions = selection.expressions;
						tempExpressionUntil = Date.now() + EXPRESSION_TEMP_MS;
						refreshExpressionTargets();
					}
					if (selection.motion) playInteractionMotion([selection.motion]);
				} catch {}
			}
			/**
			* 播放互动动作（触摸部位动作组）：FORCE 可打断状态动画与上一次互动；动作真正播完
			* （motionFinish）后恢复当前状态动画（spec §4）。motion() 的 Promise 只代表开始，
			* 因此不再用 Promise 完成时间或 3s 兜底来恢复。
			*/
			async function playInteractionMotion(names) {
				if (!model || names.length === 0) return;
				++interactionGen;
				await startMotionWithPriority(names, MotionPriority.FORCE, {
					suppressFocus: true,
					isInteraction: true
				});
			}
			(async () => {
				try {
					try {
						view = await api.state();
					} catch (error) {
						clientLog("warn", "state fetch failed", error);
					}
					if (disposed) return;
					if (view) {
						pos = {
							...view.display,
							size: view.config.size
						};
						canvasPadXPct = Number.isFinite(view.config.canvasPadX) ? view.config.canvasPadX : 125;
						canvasPadYPct = Number.isFinite(view.config.canvasPadY) ? view.config.canvasPadY : 50;
						bubbleOffsetX = Number.isFinite(view.config.bubbleOffsetX) ? view.config.bubbleOffsetX : 0;
						bubbleOffsetY = Number.isFinite(view.config.bubbleOffsetY) ? view.config.bubbleOffsetY : -15;
						bubbleBgColor = typeof view.config.bubbleBgColor === "string" && view.config.bubbleBgColor.trim() ? view.config.bubbleBgColor : DEFAULT_BUBBLE_BG_COLOR;
						bubbleBgOpacity = Number.isFinite(view.config.bubbleBgOpacity) ? view.config.bubbleBgOpacity : 92;
						bubbleTextColor = typeof view.config.bubbleTextColor === "string" && view.config.bubbleTextColor.trim() ? view.config.bubbleTextColor : DEFAULT_BUBBLE_TEXT_COLOR;
						aiEnabled = view.config.aiEnabled === true;
						aiTouchOnly = view.config.aiTouchOnly === true;
						aiTakeover = view.config.aiTakeover === true;
						interactionMode = normalizeInteractionMode(view.config.interactionMode, interactionMode);
						applyLongAiConfig(view.config);
						applyBubbleMaxConfig(view.config);
					}
					clientLog("info", `state ready: model=${view?.config.model ?? "?"} url=${view?.config.modelUrl ?? "none"}`);
					box = document.createElement("div");
					const popoverSupported = typeof box.showPopover === "function";
					box.style.cssText = `position:fixed;inset:auto;top:auto;left:auto;right:${pos.right}px;bottom:${pos.bottom}px;margin:0;padding:0;border:none;background:transparent;width:auto;height:auto;overflow:visible;pointer-events:none${popoverSupported ? "" : ";z-index:2147483647"}`;
					if (popoverSupported) box.setAttribute("popover", "manual");
					document.body.appendChild(box);
					if (popoverSupported) try {
						box.showPopover();
					} catch {}
					pushCleanup(() => {
						box?.parentNode?.removeChild(box);
					});
					clientLog("info", `container created (popover=${String(popoverSupported)})`);
					bubble = document.createElement("div");
					bubble.style.cssText = "position:absolute;left:0;top:0;transform:translate(-50%,-100%);padding:4px 10px;border-radius:10px;font:12px/1.5 sans-serif;white-space:normal;word-break:break-word;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4";
					box.appendChild(bubble);
					applyBubbleStyle();
					for (const src of VENDOR_SCRIPTS) {
						await loadScript(src);
						if (disposed) return;
					}
					clientLog("info", "vendor scripts loaded");
					const initialUrl = view?.config.modelUrl || null;
					currentModelUrl = initialUrl;
					await loadModelLayer(initialUrl);
					if (disposed) return;
					clientLog("info", `model layer loaded: ${initialUrl ?? "fallback"}`);
					const onGlobalPointerMove = handleGlobalPointerMove;
					const onGlobalMouseOut = handleGlobalMouseOut;
					document.addEventListener("pointermove", onGlobalPointerMove, { passive: true });
					document.addEventListener("mouseout", onGlobalMouseOut);
					pushCleanup(() => {
						document.removeEventListener("pointermove", onGlobalPointerMove);
						document.removeEventListener("mouseout", onGlobalMouseOut);
					});
					const handleState = (next) => {
						if (disposed) return;
						view = next;
						pos = {
							right: next.display.right,
							bottom: next.display.bottom,
							size: pos.size
						};
						applyConfig(next);
						applyState(next);
					};
					let closeEvents;
					try {
						closeEvents = api.events(handleState, () => {});
					} catch {}
					const onVisibility = () => {
						hidden = document.visibilityState !== "visible";
						syncTicker();
					};
					const onBlur = () => {
						hidden = true;
						syncTicker();
					};
					const onFocus = () => {
						hidden = false;
						syncTicker();
					};
					const onResize = () => {
						invalidateLayout();
						clampPosToViewport();
						applyPosToBox();
						applyBubbleStyle();
						syncDebugPanelWidth();
						updateDebugPanelPosition();
						updateBubblePosition();
					};
					document.addEventListener("visibilitychange", onVisibility);
					window.addEventListener("blur", onBlur);
					window.addEventListener("focus", onFocus);
					window.addEventListener("resize", onResize);
					pushCleanup(() => {
						closeEvents?.();
						document.removeEventListener("visibilitychange", onVisibility);
						window.removeEventListener("blur", onBlur);
						window.removeEventListener("focus", onFocus);
						window.removeEventListener("resize", onResize);
					});
					if (view) {
						applyConfig(view);
						applyState(view);
					}
				} catch (error) {
					clientLog("error", "boot failed", error);
					showFallback();
				}
			})();
			return () => {
				for (const fn of cleanup) try {
					fn();
				} catch {}
			};
		}
		/** 插件入口。 */
		function apply(ctx) {
			clientLog("info", "apply entered");
			ctx.effect(() => {
				const onError = (event) => {
					clientLog("error", `window error: ${event.message}`, event.error);
				};
				const onRejection = (event) => {
					clientLog("error", "unhandled rejection", event.reason);
				};
				window.addEventListener("error", onError);
				window.addEventListener("unhandledrejection", onRejection);
				return () => {
					window.removeEventListener("error", onError);
					window.removeEventListener("unhandledrejection", onRejection);
				};
			});
			const slots = ctx.get("slots");
			if (slots === void 0) {
				clientLog("warn", "apply: slots service unavailable");
				return;
			}
			slots.inject("shell.overlay", () => slots.register({
				name: "shell.overlay",
				id: "waifu"
			}, () => (0, react.createElement)(PetAnchor)));
			slots.inject("settings.section", () => {
				const stopNavIcon = installPetSettingsNavIcon();
				const disposeSection = slots.register({
					name: "settings.section",
					id: "waifu",
					order: 200,
					label: () => "桌宠配置",
					icon: pawNavIcon
				}, () => (0, react.createElement)(PetSettingsSection, {}));
				return () => {
					stopNavIcon();
					disposeSection();
				};
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map