window.__ModuleLoader__.load({
	id: "dsh-waifu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
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
				meaning: "害羞、被夸到、被碰到软处（正面）"
			},
			{
				id: "wink",
				name: "眨眼",
				params: {},
				meaning: "俏皮地眨一只眼（wink）、抛媚眼",
				oneShotMotion: "Wink"
			},
			{
				id: "angry",
				name: "生气",
				params: { ParamSwitch4: 1 },
				meaning: "被惹到当场发火"
			},
			{
				id: "star",
				name: "星星眼",
				params: { ParamSwitch5: 1 },
				exclusive: "eye",
				meaning: "开心、崇拜、被夸得两眼放光"
			},
			{
				id: "whites",
				name: "白眼",
				params: { ParamSwitch6: 1 },
				exclusive: "eye",
				meaning: "无语、嫌弃、被蠢到（不出声的不满）"
			},
			{
				id: "tear",
				name: "泪花",
				params: { ParamSwitch7: 1 },
				exclusive: "eye",
				meaning: "眼眶湿了，还在忍"
			},
			{
				id: "heart",
				name: "爱心眼",
				params: { ParamSwitch8: 1 },
				exclusive: "eye",
				meaning: "喜欢到眼睛发光"
			},
			{
				id: "cry",
				name: "眼泪",
				params: { ParamSwitch9: 1 },
				exclusive: "eye",
				meaning: "已经哭出来"
			},
			{
				id: "dark",
				name: "脸黑",
				params: { ParamSwitch1: 1 },
				exclusive: "skin",
				meaning: "不爽到脸沉下来，冷笑、要算账"
			},
			{
				id: "blood",
				name: "羞愤",
				params: { ParamSwitch3: 1 },
				exclusive: "skin",
				meaning: "羞到极点又要发作，脸绷不住"
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
				meaning: "同意、得意、被哄好"
			},
			{
				id: "ShakeHead",
				name: "摇头",
				meaning: "否认、嘴硬、拒绝、被说中要害"
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
				meaning: "无奈、认命、被折腾到没脾气"
			}
		];
		/** AI 可选动作组 id 列表。 */
		const AI_MOTION_IDS = AI_MOTIONS.map((motion) => motion.id);
		/** 一次性表情（动作驱动，如眨眼）对应的动作组名；普通常驻表情返回 undefined。 */
		function expressionOneShotMotion(id) {
			return EXPRESSIONS.find((expression) => expression.id === id)?.oneShotMotion;
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
		/** 该名字是否是表情 id。 */
		function isExpressionId(value) {
			return EXPRESSION_IDS.includes(value.trim());
		}
		/** 该名字是否是 AI 动作组 id。 */
		function isMotionId(value) {
			return AI_MOTION_IDS.includes(value.trim());
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
		/** 全部触发条件（设置页下拉顺序）。 */
		const INTERACTION_TRIGGERS = [
			"tap",
			"double",
			"hold"
		];
		/** 触发条件的中文名。 */
		const INTERACTION_TRIGGER_LABELS = {
			tap: "单击",
			double: "双击",
			hold: "悬停"
		};
		/** 「悬停停留」默认时长与允许范围（ms）：鼠标停在部位 box 内多久触发。 */
		const TOUCH_HOLD_DEFAULT_MS = 3e3;
		const TOUCH_HOLD_LIMITS = {
			min: 300,
			max: 1e4
		};
		/** 该部位是否定义了双击交互（决定单击要不要等 300ms 判双）。 */
		function hasDoubleInteraction(part) {
			return (part.interactions ?? []).some((item) => item.trigger === "double");
		}
		/**
		* 按压（点击）路径挑交互（ADR-038 修订）：「停留」已改成鼠标悬停触发，
		* 不再参与按压判定；这里只看单击/双击。
		*/
		function pickTapInteraction(part, clickCount) {
			const list = part.interactions ?? [];
			if (list.length === 0) return void 0;
			if (clickCount >= 2) {
				const double = list.find((item) => item.trigger === "double");
				if (double) return double;
			}
			return list.find((item) => item.trigger === "tap");
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
		/** 默认模型 id（与内置 preset 目录一致）。 */
		const DEFAULT_MODEL_ID = "jian";
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
		/** 触发场景中文名（设置页开关列表与调试面板场景演示共用）。 */
		const TRIGGER_EVENT_LABELS = {
			thinking: "思考中",
			error: "出错",
			done: "完成",
			delivered: "交付成果",
			waiting: "等确认",
			"tool-read": "工具·读取",
			"tool-write": "工具·写入",
			"tool-run": "工具·执行命令",
			"tool-agent": "工具·派出子代理",
			"tool-other": "工具·其他",
			"approval-granted": "审批·通过",
			"approval-denied": "审批·拒绝",
			"session-open": "会话·开启",
			"session-close": "会话·结束",
			"subagent-start": "子代理·出发",
			"subagent-end": "子代理·归来"
		};
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
		const TTS_MODELS = [
			{
				id: "qwen/qwen-audio-3.0-tts-plus",
				label: "通义千问 TTS Plus（旗舰音色，支持指令控制）",
				voices: [{
					id: "longanlingxin",
					label: "龙安灵心（25 岁·知心温暖）"
				}]
			},
			{
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
			},
			{
				id: "mimo-v2.5-tts",
				label: "小米 MiMo TTS（预置音色，支持风格指令）",
				provider: "mimo",
				voices: [
					{
						id: "冰糖",
						label: "冰糖（中文·女声，默认）"
					},
					{
						id: "茉莉",
						label: "茉莉（中文·女声）"
					},
					{
						id: "Mia",
						label: "Mia（英文·女声）"
					},
					{
						id: "Chloe",
						label: "Chloe（英文·女声）"
					}
				]
			}
		];
		/** 默认 TTS 模型：通义千问 TTS Flash（女声最多、便宜）。 */
		const DEFAULT_TTS_MODEL = "qwen/qwen-audio-3.0-tts-flash";
		/** 默认音色：Flash 的「龙安灵希」（25 岁·可爱甜美）。 */
		const DEFAULT_TTS_VOICE = "longanlingxi";
		/** 按 id 查模型选项。 */
		function ttsModelOption(id) {
			return TTS_MODELS.find((item) => item.id === id);
		}
		/** 该模型的供应商（目录里没写的都按 openrouter 走）。 */
		function ttsModelProvider(id) {
			return ttsModelOption(id)?.provider ?? "openrouter";
		}
		/** 模型的首个音色（随机音色模型返回空串）。 */
		function ttsDefaultVoice(model) {
			const option = ttsModelOption(model);
			return option && !option.randomVoice ? option.voices[0]?.id ?? "" : "";
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
		/** 归一化注入记忆条数。 */
		function normalizeMemoryCount(value, fallback) {
			return clampInt(value, fallback, AI_MEMORY_LIMITS.min, AI_MEMORY_LIMITS.max);
		}
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
		const BAR_AUTO_HIDE_LIMITS = {
			min: 0,
			max: 3600
		};
		/** 归一化交互条自动隐藏秒数：0–3600 的整数，非法值回退默认（0 = 常显）。 */
		function normalizeBarAutoHideSec(value, fallback) {
			return clampInt(value, fallback, BAR_AUTO_HIDE_LIMITS.min, BAR_AUTO_HIDE_LIMITS.max);
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
			bubbleBgColor: DEFAULT_BUBBLE_BG_COLOR,
			bubbleBgOpacity: 92,
			bubbleMaxSeconds: 10,
			bubbleTextColor: DEFAULT_BUBBLE_TEXT_COLOR,
			/** AI 总开关（ADR-037：关掉 = 角色完全静默，只剩物理反应）。 */
			aiEnabled: true,
			aiProvider: DEFAULT_AI_PROVIDER,
			aiModel: DEFAULT_AI_MODEL,
			aiHistoryCount: 10,
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
			/** 交互条无操作自动隐藏（秒；0 = 不自动隐藏，鼠标移到模型上重新出现）。 */
			barAutoHideSec: 10,
			ttsEnabled: true,
			ttsModel: DEFAULT_TTS_MODEL,
			ttsVoice: DEFAULT_TTS_VOICE,
			/** 风格控制（只对 MiMo 生效，ADR-062）：开启后由 LLM 决定每轮的语气指令。 */
			ttsStyleControl: true,
			/** 文字流式（ADR-063）。 */
			llmStreaming: true,
			/** 语音流式（ADR-063；只有 MiMo 支持）。 */
			ttsStreaming: false,
			lipsyncEnabled: true,
			lipsyncGain: 130,
			focusRange: 100
		};
		// src/client/client-log.ts
		/**
		* 浏览器侧诊断上报（Client 半区共用）：把桌宠/设置页的关键事件与错误发到 Host 的
		* `/api/dsh-waifu/client-log`，Host 落盘 `$DSH_HOME/waifu/client.log`，
		* 便于没有浏览器控制台的环境排查（spec §9）。失败静默，不影响主流程。
		* @module dsh-waifu/client/client-log
		*/
		/** 宠物 API 基路径（与 client/index.ts、settings.ts 保持一致）。 */
		const PET_API$2 = "/api/dsh-waifu";
		function clientLog(level, message, detail) {
			try {
				const text = detail === void 0 ? "" : (detail instanceof Error ? detail.stack ?? detail.message : String(detail)).slice(0, 4e3);
				fetch(`${PET_API$2}/client-log`, {
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
		* 把「当前 pos（右下角偏移，px）+ 画布尺寸 + 视口尺寸」换算成「画布几何中心距右/距下」的百分比。
		* 与 `homePositionFromConfig` 互逆：中心距右 = right + W/2（ADR-060）。
		* scale = 页面 UI 缩放（视觉 CSS px ÷ 逻辑 px）：换算回视觉视口百分比时要乘它（ADR-060）。
		* 任何尺寸非正时返回 null。
		*/
		function homePercentFromPos(pos, canvas, viewport, scale = 1) {
			if (!(canvas.width > 0 && canvas.height > 0 && viewport.width > 0 && viewport.height > 0)) return null;
			const clampPct = (value) => Math.round(Math.min(100, Math.max(0, value)));
			const s = scale > 0 && Number.isFinite(scale) ? scale : 1;
			return {
				right: clampPct((pos.right + canvas.width / 2) * s / viewport.width * 100),
				bottom: clampPct((pos.bottom + canvas.height / 2) * s / viewport.height * 100)
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
		// src/client/catalog-preview.ts
		/** 预览事件名。 */
		const CATALOG_PREVIEW_EVENT = "dsh-waifu:preview-catalog";
		/** 广播预览请求（设置页调用）。 */
		function emitCatalogPreview(target) {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent(CATALOG_PREVIEW_EVENT, { detail: target }));
		}
		/** 订阅预览请求（宠物层调用）；返回退订函数。 */
		function onCatalogPreview(handler) {
			if (typeof window === "undefined") return () => {};
			const listener = (event) => {
				const detail = event.detail;
				if (detail && typeof detail === "object") handler(detail);
			};
			window.addEventListener(CATALOG_PREVIEW_EVENT, listener);
			return () => window.removeEventListener(CATALOG_PREVIEW_EVENT, listener);
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
		* Waifu 设置页（`settings.section` 注册体，spec §2）。
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
		/** 插件 API 前缀（与 index.ts / client-log.ts 保持一致）。 */
		const PET_API$1 = "/api/dsh-waifu";
		/** 设置项兜底值：标量统一取自 defaults.ts（单一来源），模型 id 单独取默认。 */
		const DEFAULT_VALUE = {
			...DEFAULT_SETTINGS,
			model: DEFAULT_MODEL_ID
		};
		/** 触发场景开关顺序（ANIMATION_SLOTS 去掉 idle + ACTIVITY_EVENTS）。 */
		const TRIGGER_ORDER = [...ANIMATION_SLOTS.slice(1), ...ACTIVITY_EVENTS];
		/** 深拷贝部位草稿（避免设置页草稿与共享对象 / 事件 detail 互相污染）。 */
		function cloneTouchParts(parts) {
			return parts.map((part) => ({
				id: part.id,
				name: part.name,
				boxes: part.boxes.map((box) => ({ ...box })),
				...part.interactions && part.interactions.length > 0 ? { interactions: part.interactions.map((item) => ({ ...item })) } : {}
			}));
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
		* 保存当前模型的部位草稿（POST；Host 不可达返回 null）。
		*/
		async function saveTouchPartsToHost(model, parts) {
			try {
				const response = await fetch(TOUCH_PARTS_API, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						model,
						parts
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
		const SETTINGS_API = "/api/dsh-waifu/settings";
		const TOUCH_PARTS_API = "/api/dsh-waifu/touch-parts";
		const AI_OPTIONS_API = "/api/dsh-waifu/ai-options";
		const AI_CHECK_API = "/api/dsh-waifu/ai-check";
		const PERSONA_API = "/api/dsh-waifu/persona";
		const MEMORY_API = "/api/dsh-waifu/memory";
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
		/** 表单行左侧的 label：标题一行，说明（可选）挂在下面——说明永远在控件**前面**，不在后面。 */
		function FormLabel(props) {
			return (0, react.createElement)("div", { style: formLabelColumnStyle }, (0, react.createElement)("span", { style: {
				...formLabelInlineStyle,
				flex: "none"
			} }, props.title), props.hint ? (0, react.createElement)("span", { style: formLabelHintStyle }, props.hint) : null);
		}
		/**
		* 数字设置行（ADR-047）：调度窗口统一用这一副壳——输入框 + 失焦夹取 + 落库，
		* 省掉每个窗口各写一遍 onBlur 校验。
		*/
		function NumberRow(props) {
			const clamp = (n) => Math.round(Math.min(props.limits.max, Math.max(props.limits.min, n)));
			return (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, {
				title: props.title,
				hint: props.hint
			}), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: props.limits.min,
				max: props.limits.max,
				step: 1,
				value: props.draft ?? props.value,
				disabled: !props.writable,
				style: numberInputStyle,
				onChange: (e) => props.onDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (props.draft === void 0) return;
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed)) props.onCommit(clamp(parsed));
				}
			})));
		}
		/** 卡片内的折叠块：头部一行（标题 + 右侧展开/收起），展开内容用左侧细线缩进。 */
		const foldHeadStyle = {
			display: "flex",
			alignItems: "center",
			gap: GAP.sm,
			minHeight: 26
		};
		const foldTitleStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			fontSize: 12,
			color: C.textPrimary,
			lineHeight: 1.5,
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const foldMetaStyle = {
			fontSize: 11,
			color: C.textSecondary,
			flexShrink: 0
		};
		const foldBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: GAP.sm,
			marginTop: GAP.xs,
			marginLeft: 2,
			paddingLeft: GAP.md,
			borderLeft: `2px solid ${C.borderL1}`
		};
		/** 折叠块右侧的展开/收起按钮：与卡片里的次级按钮同款，但更矮更轻。 */
		function FoldToggle(props) {
			return (0, react.createElement)("button", {
				type: "button",
				className: "dsh-btn dsh-btn-secondary",
				style: {
					...buttonSecondaryStyle,
					height: 22,
					padding: "0 8px",
					fontSize: 11,
					lineHeight: 1,
					flexShrink: 0
				},
				disabled: props.disabled,
				onClick: props.onClick
			}, props.open ? "收起" : "编辑");
		}
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
		const cardBodyStyle = {
			display: "flex",
			flexDirection: "column",
			gap: GAP.sm,
			padding: "0 14px 12px"
		};
		const chevronButtonStyle = {
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
			transition: "transform .15s",
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
		/** 数字输入框（设置页窄列）：行内右侧对齐，宽度固定便于对齐。 */
		const numberInputStyle = {
			...inputStyle,
			flex: "0 0 88px",
			width: 88,
			textAlign: "right"
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
		/** 设置项行与下一行之间的统一间距（所有表单行共用，别再逐行覆盖 marginBottom）。 */
		const ROW_GAP = 10;
		const formRowStyle = {
			display: "grid",
			gridTemplateColumns: "96px minmax(0,1fr)",
			alignItems: "center",
			columnGap: GAP.md,
			marginBottom: ROW_GAP
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
			marginBottom: ROW_GAP
		};
		const formLabelInlineStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			fontSize: 12,
			color: C.textSecondary,
			lineHeight: 1.5,
			whiteSpace: "nowrap"
		};
		/** label 列：标题 + 可选说明（说明挂在标题下方，不放到控件后面）。 */
		const formLabelColumnStyle = {
			flex: "1 1 auto",
			minWidth: 0,
			display: "flex",
			flexDirection: "column",
			gap: 2
		};
		const formLabelHintStyle = {
			fontSize: 11,
			color: C.textSecondary,
			lineHeight: 1.5,
			whiteSpace: "normal"
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
			const [numDrafts, setNumDrafts] = (0, react.useState)({});
			const numDraftRef = (0, react.useRef)({});
			const setNumDraft = (key, raw) => {
				numDraftRef.current = {
					...numDraftRef.current,
					[key]: raw
				};
				setNumDrafts(numDraftRef.current);
			};
			/** 回车/失焦提交：先删草稿（让服务端回写的新值生效）再写盘；值没变就只删草稿。 */
			const commitNumDraft = (key, ops) => {
				const next = { ...numDraftRef.current };
				delete next[key];
				numDraftRef.current = next;
				setNumDrafts(next);
				const list = ops();
				if (list.length > 0) enqueueWrite(() => list);
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
			const [ttsStatus, setTtsStatus] = (0, react.useState)(null);
			const [ttsBusy, setTtsBusy] = (0, react.useState)(false);
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
			/** 用内置默认人设覆盖 persona.md（人设文件是用户的东西，所以要用户自己点）。 */
			async function resetPersona() {
				if (personaSaving || !writable) return;
				setPersonaSaving(true);
				setPersonaStatus(null);
				try {
					const res = await fetch(PERSONA_API, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text: "" })
					});
					const payload = await res.json();
					if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${res.status}`);
					setPersonaDraft(typeof payload.text === "string" ? payload.text : "");
					setPersonaStatus("已恢复内置默认人设");
				} catch (error) {
					setPersonaStatus(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
				} finally {
					setPersonaSaving(false);
				}
			}
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
			const [memoryDraft, setMemoryDraft] = (0, react.useState)(null);
			const [memoryStatus, setMemoryStatus] = (0, react.useState)(null);
			const [memorySaving, setMemorySaving] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!aiEnabled) return;
				let cancelled = false;
				fetch(`${MEMORY_API}`).then((res) => res.ok ? res.json() : null).then((view) => {
					if (cancelled || typeof view?.text !== "string") return;
					setMemoryDraft(view.text);
				}).catch(() => setMemoryStatus("记忆读取失败"));
				return () => {
					cancelled = true;
				};
			}, [aiEnabled]);
			const saveMemory = () => {
				if (memoryDraft === null || memorySaving) return;
				setMemorySaving(true);
				setMemoryStatus(null);
				fetch(`${MEMORY_API}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: memoryDraft })
				}).then((res) => res.ok ? res.json() : null).then((view) => {
					setMemoryStatus(view === null ? "保存失败" : "已保存，下一次反应生效");
				}).catch(() => setMemoryStatus("保存失败")).finally(() => setMemorySaving(false));
			};
			const memoryLineCount = (memoryDraft ?? "").split("\n").filter((line) => line.trim() !== "").length;
			const [openCatalog, setOpenCatalog] = (0, react.useState)({});
			const [catalogDrafts, setCatalogDrafts] = (0, react.useState)({});
			const catalogDraftRef = (0, react.useRef)({});
			const setCatalogDraft = (key, raw) => {
				catalogDraftRef.current = {
					...catalogDraftRef.current,
					[key]: raw
				};
				setCatalogDrafts(catalogDraftRef.current);
			};
			const commitCatalogDraft = (meta, key, raw) => {
				const next = { ...catalogDraftRef.current };
				delete next[key];
				catalogDraftRef.current = next;
				setCatalogDrafts(next);
				enqueueWrite(() => [{
					op: "set",
					path: [meta.field, meta.id],
					value: raw
				}]);
			};
			const [openScenes, setOpenScenes] = (0, react.useState)({});
			const [sceneDrafts, setSceneDrafts] = (0, react.useState)({});
			const sceneDraftRef = (0, react.useRef)({});
			const setSceneDraft = (event, raw) => {
				sceneDraftRef.current = {
					...sceneDraftRef.current,
					[event]: raw
				};
				setSceneDrafts(sceneDraftRef.current);
			};
			const dropSceneDraft = (event) => {
				if (!(event in sceneDraftRef.current)) return;
				const next = { ...sceneDraftRef.current };
				delete next[event];
				sceneDraftRef.current = next;
				setSceneDrafts(next);
			};
			const commitSceneDraft = (event, raw) => {
				dropSceneDraft(event);
				enqueueWrite(() => [{
					op: "set",
					path: ["eventTexts", event],
					value: raw
				}]);
			};
			const [personaOpen, setPersonaOpen] = (0, react.useState)(false);
			const [memoryOpen, setMemoryOpen] = (0, react.useState)(false);
			const modelDraftRef = (0, react.useRef)("");
			const [touchDraft, setTouchDraft] = (0, react.useState)([]);
			const touchDraftRef = (0, react.useRef)([]);
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
			const [saveState, setSaveState] = (0, react.useState)("idle");
			/** 触摸部位分组级「已保存」提示（结构变更保存时，约 3 秒）。 */
			const [touchSavedFlash, setTouchSavedFlash] = (0, react.useState)(null);
			/** 部位卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
			const [savedPartFlash, setSavedPartFlash] = (0, react.useState)(null);
			const savedPartTimer = (0, react.useRef)(null);
			/** 本次保存的来源（部位卡 / 结构行 / 事件卡），用于决定「已保存」提示落在哪里。 */
			const saveSourceRef = (0, react.useRef)(null);
			const flashTimers = (0, react.useRef)({});
			const partsDirty = dirtyPartIds.size > 0 || structureDirty;
			/** 写入串行化：避免并发 POST 在 Host 端出现读改写丢失。 */
			const saveQueue = (0, react.useRef)(Promise.resolve());
			/** 草稿编辑版本号：保存响应回来时据此判断是否还有更新改动未保存。 */
			const editVersionRef = (0, react.useRef)(0);
			const saveSeq = (0, react.useRef)(0);
			const loadSeq = (0, react.useRef)(0);
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
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
			/** 保存成功：清空全部部位/结构 dirty。 */
			const clearAllDirty = () => {
				dirtyPartIdsRef.current = /* @__PURE__ */ new Set();
				structureDirtyRef.current = false;
				setDirtyPartIds(/* @__PURE__ */ new Set());
				setStructureDirty(false);
			};
			/** 是否存在未保存的部位字段/结构改动。 */
			const hasPendingParts = () => dirtyPartIdsRef.current.size > 0 || structureDirtyRef.current;
			/**
			* 串行写回草稿（{model, parts}）；响应只更新保存状态，不 refetch 覆盖草稿。
			* quiet=true 用于切模型/卸载的防丢补存：只发请求 + clientLog，不改页面状态栏。
			*/
			const persistDraft = (model, parts, editVersion, quiet = false) => {
				const summary = `model=${model} parts=${parts.length}`;
				saveQueue.current = saveQueue.current.then(async () => {
					const seq = ++saveSeq.current;
					if (!quiet) setSaveState("saving");
					const result = await saveTouchPartsToHost(model, parts);
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
					setSaveState("idle");
				});
			};
			/** 保存动作（部位卡片「保存」/结构行共用）：显式写回当前完整草稿。 */
			const saveNow = () => {
				if ((touchDraftRef.current ?? []).some((part) => (part.interactions ?? []).some((item) => !item.name.trim()))) {
					if (saveSourceRef.current?.type === "part") setSaveState("error");
					clientLog("warn", "touch-parts save blocked: 有交互名为空，先补全名字");
					saveSourceRef.current = null;
					return;
				}
				if (readOnly || !hasPendingParts()) {
					saveSourceRef.current = null;
					return;
				}
				const model = modelDraftRef.current;
				if (!model) return;
				persistDraft(model, cloneTouchParts(touchDraftRef.current), editVersionRef.current);
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
			(0, react.useEffect)(() => {
				if (state.status !== "ready" || !selectedModel) return;
				const previousModel = modelDraftRef.current;
				if (previousModel && previousModel !== selectedModel && hasPendingParts()) persistDraft(previousModel, cloneTouchParts(touchDraftRef.current), editVersionRef.current, true);
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
				saveSourceRef.current = null;
				if (flashTimers.current.touch !== void 0) {
					clearTimeout(flashTimers.current.touch);
					flashTimers.current.touch = void 0;
				}
				if (savedPartTimer.current !== null) {
					clearTimeout(savedPartTimer.current);
					savedPartTimer.current = null;
				}
				touchDraftRef.current = [];
				setTouchDraft([]);
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
			(0, react.useEffect)(() => () => {
				const model = modelDraftRef.current;
				if (!model) return;
				if (hasPendingParts()) persistDraft(model, cloneTouchParts(touchDraftRef.current), editVersionRef.current, true);
				if (flashTimers.current.touch !== void 0) clearTimeout(flashTimers.current.touch);
				if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current);
				if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current);
				emitTouchEdit({
					active: false,
					model,
					parts: cloneTouchParts(touchDraftRef.current)
				});
			}, []);
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
					boxes: []
				};
				markStructureDirty();
				commitTouchDraft([part, ...touchDraftRef.current], part.id);
			};
			const removeTouchPart = (id) => {
				const next = touchDraftRef.current.filter((part) => part.id !== id);
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
			const addInteraction = (partId) => {
				updateTouchPart(partId, (part) => {
					const list = part.interactions ?? [];
					if (list.length >= 8) return part;
					const next = {
						id: `i${Date.now().toString(36)}${list.length}`,
						name: "新交互",
						trigger: "tap",
						holdMs: TOUCH_HOLD_DEFAULT_MS
					};
					return {
						...part,
						interactions: [...list, next]
					};
				});
			};
			const removeInteraction = (partId, interactionId) => {
				updateTouchPart(partId, (part) => {
					const list = (part.interactions ?? []).filter((item) => item.id !== interactionId);
					return list.length > 0 ? {
						...part,
						interactions: list
					} : {
						...part,
						interactions: void 0
					};
				});
			};
			const setInteractionName = (partId, interactionId, raw) => {
				updateTouchPart(partId, (part) => ({
					...part,
					interactions: (part.interactions ?? []).map((item) => item.id === interactionId ? {
						...item,
						name: raw.slice(0, 20)
					} : item)
				}));
			};
			const setInteractionTrigger = (partId, interactionId, trigger) => {
				updateTouchPart(partId, (part) => ({
					...part,
					interactions: (part.interactions ?? []).map((item) => item.id === interactionId ? {
						...item,
						trigger
					} : item)
				}));
			};
			const setInteractionHoldMs = (partId, interactionId, raw) => {
				const parsed = Number(raw);
				if (!Number.isFinite(parsed)) return;
				const holdMs = Math.round(Math.min(TOUCH_HOLD_LIMITS.max, Math.max(TOUCH_HOLD_LIMITS.min, parsed)));
				updateTouchPart(partId, (part) => ({
					...part,
					interactions: (part.interactions ?? []).map((item) => item.id === interactionId ? {
						...item,
						holdMs
					} : item)
				}));
			};
			const removeBox = (partId, boxIndex) => {
				updateTouchPart(partId, (part) => ({
					...part,
					boxes: part.boxes.filter((_box, index) => index !== boxIndex)
				}));
			};
			const reloadAll = () => {
				setReloadKey((key) => key + 1);
			};
			/** 部位卡片：header = [chevron][层号 chip][名称][↑][↓][删除部位]，统一 28 高垂直居中。 */
			const renderTouchPartCard = (part, index) => {
				const expanded = expandedPartId === part.id;
				const isTopLayer = index === 0;
				const isBottomLayer = index === touchDraft.length - 1;
				const layerLabel = `#${index + 1}`;
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
					disabled: saveState === "saving" || readOnly || hasInvalidInteractions,
					onClick: () => savePartNow(part.id)
				}, "保存")) : savedPartFlash?.partId === part.id ? (0, react.createElement)("div", {
					key: "part-saved",
					style: {
						padding: "0 14px 8px",
						fontSize: 12,
						color: C.success
					}
				}, `已保存 ${savedPartFlash.time}`) : null, expanded && (0, react.createElement)("div", { style: cardBodyStyle }, (0, react.createElement)("div", { style: hintStyle }, "原点在角色左下角（0–100%）：调大「上」= 往上长，调小「下」= 往下长；多个 box 命中任一即算该部位。"), part.boxes.length === 0 ? (0, react.createElement)("div", { style: hintStyle }, "还没有 box，点「+ 添加 box」画出点击区域。") : (0, react.createElement)("div", {
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
					key: "interactions",
					style: {
						marginTop: 14,
						display: "flex",
						flexDirection: "column",
						gap: 6
					}
				}, (0, react.createElement)(FormLabel, {
					title: "交互",
					hint: "名字自己起（会原样告诉模型，比如「抚摸」「捏脸」）；这个部位没有交互时，点它不会有任何反应"
				}), (part.interactions ?? []).length === 0 ? (0, react.createElement)("div", { style: hintStyle }, "还没有交互，点「+ 添加交互」造一个。") : (part.interactions ?? []).map((item) => (0, react.createElement)("div", {
					key: item.id,
					style: {
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexWrap: "wrap"
					}
				}, (0, react.createElement)("input", {
					type: "text",
					maxLength: 20,
					"aria-label": "交互名",
					placeholder: "抚摸",
					value: item.name,
					disabled: readOnly,
					style: {
						...inputStyle,
						width: 140,
						...item.name.trim() ? {} : { borderColor: C.error }
					},
					onChange: (e) => setInteractionName(part.id, item.id, e.target.value)
				}), item.name.trim() ? null : (0, react.createElement)("span", { style: {
					fontSize: 11,
					color: C.error
				} }, "名字不能为空"), (0, react.createElement)("select", {
					value: item.trigger,
					disabled: readOnly,
					style: {
						...selectStyle,
						width: 108
					},
					onChange: (e) => setInteractionTrigger(part.id, item.id, e.target.value)
				}, INTERACTION_TRIGGERS.map((trigger) => (0, react.createElement)("option", {
					key: trigger,
					value: trigger
				}, trigger === "hold" ? "悬停" : INTERACTION_TRIGGER_LABELS[trigger]))), item.trigger === "hold" ? (0, react.createElement)("input", {
					type: "number",
					"aria-label": "悬停时长（毫秒）",
					min: TOUCH_HOLD_LIMITS.min,
					max: TOUCH_HOLD_LIMITS.max,
					step: 1,
					value: item.holdMs,
					disabled: readOnly,
					style: {
						...numberInputStyle,
						width: 92
					},
					onChange: (e) => setInteractionHoldMs(part.id, item.id, e.target.value)
				}) : null, item.trigger === "hold" ? (0, react.createElement)("span", { style: {
					fontSize: 12,
					color: C.textSecondary
				} }, "ms") : null, (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-danger",
					style: deleteBoxButtonStyle,
					disabled: readOnly,
					onClick: () => removeInteraction(part.id, item.id)
				}, "删除"))), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-secondary",
					style: {
						...buttonSecondaryStyle,
						alignSelf: "flex-start"
					},
					disabled: readOnly || (part.interactions ?? []).length >= 8,
					onClick: () => addInteraction(part.id)
				}, (part.interactions ?? []).length >= 8 ? `交互已达上限（8）` : "+ 添加交互"))));
			};
			/** 任何部位存在空名交互 = 非法草稿（m12259）：保存按钮禁用，直到名字补全。 */
			const hasInvalidInteractions = touchDraft.some((part) => (part.interactions ?? []).some((item) => !item.name.trim()));
			const hasChanges = partsDirty;
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
				disabled: saveState === "saving" || readOnly || !hasChanges || hasInvalidInteractions,
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
			}, "Waifu 设置"), (0, react.createElement)("p", {
				key: "sub",
				style: {
					...sectionDescStyle,
					margin: "0 0 16px"
				}
			}, "设置立即生效；角色的台词、动作、表情由 AI 按人设与场景即兴决定。触摸部位分组修改后点「保存」写入。")];
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
			const bubbleBgColor = normalizeHexColor(state.value?.bubbleBgColor, "#ffffff");
			const bubbleBgOpacity = normalizeBubbleOpacity(state.value?.bubbleBgOpacity, 92);
			const bubbleTextColor = normalizeHexColor(state.value?.bubbleTextColor, "#222222");
			const bubbleMaxSeconds = normalizeBubbleMax(state.value?.bubbleMaxSeconds, DEFAULT_VALUE.bubbleMaxSeconds);
			/** 偏移类输入（气泡垂直偏移 / 交互条偏移）统一 5px 一档。 */
			const OFFSET_STEP = 1;
			const voiceBeforeAiOff = (0, react.useRef)(null);
			const barBeforeAiOff = (0, react.useRef)(null);
			const [barOffsetDraft, setBarOffsetDraft] = (0, react.useState)(null);
			const barOffsetTimer = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current);
			}, []);
			const commitBarOffset = (raw) => {
				const parsed = Number.parseInt(raw, 10);
				const next = Number.isFinite(parsed) ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, parsed))) : 0;
				if (next === value.barOffset) return;
				enqueueWrite(() => [{
					op: "set",
					path: ["barOffset"],
					value: next
				}]);
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
			} }, `${size}px`))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)("span", { style: formLabelStyle }, "渲染帧率"), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)(ThemeRadioGroup, {
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
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "视线跟随鼠标范围（模型尺寸%）" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: FOCUS_RANGE_LIMITS.min,
				max: FOCUS_RANGE_LIMITS.max,
				step: 1,
				style: numberInputStyle,
				value: numDrafts.focusRange ?? value.focusRange,
				disabled: !writable,
				onChange: (e) => setNumDraft("focusRange", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.focusRange === void 0) return;
					const next = normalizeFocusRange(e.target.value, DEFAULT_SETTINGS.focusRange);
					commitNumDraft("focusRange", () => [{
						op: "set",
						path: ["focusRange"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "待机小动作" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: value.idleMotionEnabled !== false,
				disabled: !writable,
				onChange: (next) => enqueueWrite(() => [{
					op: "set",
					path: ["idleMotionEnabled"],
					value: next
				}])
			})))), (0, react.createElement)("div", {
				key: "canvas-home",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "画布与位置"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "水平留白（% 模型宽）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 300,
				step: 1,
				value: numDrafts.canvasPadX ?? canvasPadX,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("canvasPadX", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.canvasPadX === void 0) return;
					const next = normalizeCanvasPad(e.target.value, 0);
					commitNumDraft("canvasPadX", () => [{
						op: "set",
						path: ["canvasPadX"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "垂直留白（% 模型高）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 300,
				step: 1,
				value: numDrafts.canvasPadY ?? canvasPadY,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("canvasPadY", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.canvasPadY === void 0) return;
					const next = normalizeCanvasPad(e.target.value, 0);
					commitNumDraft("canvasPadY", () => [{
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
				value: numDrafts.homeRight ?? homeRight,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("homeRight", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.homeRight === void 0) return;
					const next = normalizeHomePosition(e.target.value, 0);
					commitNumDraft("homeRight", () => [{
						op: "set",
						path: ["homeRight"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "中心距下（% 窗口高）"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 100,
				step: 1,
				value: numDrafts.homeBottom ?? homeBottom,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("homeBottom", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.homeBottom === void 0) return;
					const next = normalizeHomePosition(e.target.value, 0);
					commitNumDraft("homeBottom", () => [{
						op: "set",
						path: ["homeBottom"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "默认位置"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("button", {
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
				step: OFFSET_STEP,
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
			}))), (0, react.createElement)("div", { style: hintStyle }, "纵向位置跟随交互条：显示时气泡底边在交互条上方 10px，收起时补到交互条原来的位置；不再单独配置"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "背景不透明度"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: 100,
				step: 1,
				value: numDrafts.bubbleBgOpacity ?? bubbleBgOpacity,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("bubbleBgOpacity", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.bubbleBgOpacity === void 0) return;
					const next = normalizeBubbleOpacity(e.target.value, 0);
					commitNumDraft("bubbleBgOpacity", () => [{
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
				step: 1,
				value: numDrafts.bubbleMaxSeconds ?? bubbleMaxSeconds,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("bubbleMaxSeconds", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.bubbleMaxSeconds === void 0) return;
					const next = normalizeBubbleMax(e.target.value, 0);
					commitNumDraft("bubbleMaxSeconds", () => [{
						op: "set",
						path: ["bubbleMaxSeconds"],
						value: next
					}]);
				}
			}))))));
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
			}, "这个模型还没有触摸部位：新建部位后画 box，角色被摸到相应区域时就会触发反应。") : null, ...touchDraft.map((part, index) => renderTouchPartCard(part, index)), (0, react.createElement)("button", {
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
			/** 试听：把一句样例发给 /tts，拿回 mp3 直接播（不写缓存文件、不改设置）。 */
			const auditionVoice = async () => {
				if (ttsBusy) return;
				setTtsBusy(true);
				setTtsStatus("合成中…");
				try {
					const res = await fetch(`${PET_API$1}/tts`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ text: "哼，主人又在偷看我了？我可没那么好哄哦。" })
					});
					const payload = await res.json();
					if (!payload.ok || !payload.data) throw new Error(payload.error ?? `http ${res.status}`);
					new Audio(`data:audio/mpeg;base64,${payload.data}`).play().catch(() => void 0);
					setTtsStatus("试听已播放");
				} catch (error) {
					setTtsStatus(`试听失败：${error instanceof Error ? error.message : String(error)}`);
				} finally {
					setTtsBusy(false);
				}
			};
			children.push((0, react.createElement)("div", {
				key: "ai-reply",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "AI 驱动",
				description: "角色的台词、动作、表情全部由模型按人设 + 场景 + 历史 + 记忆即兴决定；关闭后角色完全静默（语音与交互条一并关闭）。",
				action: (0, react.createElement)(ThemeSwitch, {
					checked: !!value.aiEnabled,
					disabled: !writable,
					onChange: (next) => {
						if (next) {
							const ops = [{
								op: "set",
								path: ["aiEnabled"],
								value: true
							}];
							if (voiceBeforeAiOff.current !== null) {
								ops.push({
									op: "set",
									path: ["ttsEnabled"],
									value: voiceBeforeAiOff.current
								});
								voiceBeforeAiOff.current = null;
							}
							const bar = barBeforeAiOff.current;
							if (bar !== null) {
								if (bar !== "hidden") ops.push({
									op: "set",
									path: ["barPosition"],
									value: bar
								});
								barBeforeAiOff.current = null;
							}
							enqueueWrite(() => ops);
							return;
						}
						voiceBeforeAiOff.current = value.ttsEnabled;
						barBeforeAiOff.current = value.barPosition;
						enqueueWrite(() => [
							{
								op: "set",
								path: ["aiEnabled"],
								value: false
							},
							{
								op: "set",
								path: ["ttsEnabled"],
								value: false
							},
							{
								op: "set",
								path: ["barPosition"],
								value: "hidden"
							}
						]);
					}
				})
			}), !!value.aiEnabled && (0, react.createElement)("div", null, (0, react.createElement)("div", {
				key: "ai-model-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "模型"), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)(FormLabel, { title: "Provider" }), (0, react.createElement)("div", { style: formControlStyle }, providerChoices.length > 0 ? (0, react.createElement)("select", {
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
			}))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)(FormLabel, { title: "模型" }), (0, react.createElement)("div", { style: formControlStyle }, modelOptions.length > 0 ? (0, react.createElement)("select", {
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
			}, aiChecking ? "测试中…" : "测试"))), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)(FormLabel, { title: "LLM 流式输出" }), (0, react.createElement)("div", { style: {
				...formControlInlineStyle,
				justifyContent: "flex-end",
				width: "100%"
			} }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.llmStreaming,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["llmStreaming"],
						value: next
					}]);
				}
			}))), !!aiCheckStatus && (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)(FormLabel, { title: "自检" }), (0, react.createElement)("div", { style: {
				...formControlStyle,
				color: aiCheckStatus.ok ? C.success : C.error,
				fontSize: 12,
				lineHeight: 1.5,
				wordBreak: "break-all",
				maxHeight: 96,
				overflowY: "auto"
			} }, aiCheckStatus.text))), (0, react.createElement)("div", {
				key: "ai-context-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "上下文"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "注入对话历史（轮）" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: AI_HISTORY_LIMITS.min,
				max: AI_HISTORY_LIMITS.max,
				step: 1,
				value: numDrafts.aiHistoryCount ?? value.aiHistoryCount,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("aiHistoryCount", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.aiHistoryCount === void 0) return;
					const next = normalizeHistoryCount(e.target.value, 10);
					commitNumDraft("aiHistoryCount", () => [{
						op: "set",
						path: ["aiHistoryCount"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "注入记忆（条）" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: AI_MEMORY_LIMITS.min,
				max: AI_MEMORY_LIMITS.max,
				step: 1,
				value: numDrafts.aiMemoryCount ?? value.aiMemoryCount,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("aiMemoryCount", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.aiMemoryCount === void 0) return;
					const next = normalizeMemoryCount(e.target.value, 20);
					commitNumDraft("aiMemoryCount", () => [{
						op: "set",
						path: ["aiMemoryCount"],
						value: next
					}]);
				}
			})))), (0, react.createElement)("div", {
				key: "ai-catalog-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "动作与表情"), (0, react.createElement)("div", { style: formRowStartStyle }, (0, react.createElement)(FormLabel, {
				title: "动作与表情",
				hint: "勾选的才会发给模型挑选；点「预览」在角色上试一次，展开可改「这个动作/表情是什么意思」，留空用内置释义"
			}), (0, react.createElement)("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: GAP.xs
			} }, ...[{
				field: "motionTexts",
				title: "动作",
				items: AI_MOTIONS.map((motion) => ({
					id: motion.id,
					name: motion.name,
					meaning: motion.meaning
				})),
				custom: normalizeMotionTexts(value.motionTexts),
				enabled: normalizeMotionEnabled(value.motionEnabled)
			}, {
				field: "expressionTexts",
				title: "表情",
				items: EXPRESSIONS.filter((expression) => expression.id !== "none").map((expression) => ({
					id: expression.id,
					name: expression.name,
					meaning: expression.meaning
				})),
				custom: normalizeExpressionTexts(value.expressionTexts),
				enabled: normalizeExpressionEnabled(value.expressionEnabled)
			}].map((group) => (0, react.createElement)("div", {
				key: `catalog-${group.field}`,
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 2
				}
			}, (0, react.createElement)("div", { style: {
				fontSize: 11,
				color: C.textSecondary,
				padding: "4px 0 2px"
			} }, `${group.title}（${group.items.length}）`), ...group.items.map((item) => {
				const key = `${group.field}:${item.id}`;
				const custom = group.custom[item.id] ?? "";
				const open = openCatalog[key] === true;
				const switchField = group.field === "motionTexts" ? "motionEnabled" : "expressionEnabled";
				const enabled = group.enabled[item.id] !== false;
				return (0, react.createElement)("div", {
					key,
					style: {
						display: "flex",
						flexDirection: "column",
						paddingBottom: GAP.xs
					}
				}, (0, react.createElement)("div", { style: foldHeadStyle }, (0, react.createElement)("label", { style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					flex: "1 1 auto",
					minWidth: 0,
					fontSize: 12,
					color: C.textPrimary,
					whiteSpace: "nowrap",
					cursor: "pointer"
				} }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: enabled,
					disabled: !writable,
					onChange: (e) => {
						const next = e.target.checked;
						enqueueWrite(() => [{
							op: "set",
							path: [switchField, item.id],
							value: next
						}]);
					}
				}), item.id), (0, react.createElement)("span", { style: foldMetaStyle }, (catalogDrafts[key] ?? custom).trim() !== "" ? "已自定义" : ""), (0, react.createElement)(FoldToggle, {
					open,
					disabled: !writable,
					onClick: () => setOpenCatalog((prev) => ({
						...prev,
						[key]: !open
					}))
				}), (0, react.createElement)("button", {
					type: "button",
					className: "dsh-btn dsh-btn-secondary",
					title: group.field === "motionTexts" ? "在角色上播一次这个动作" : "在角色上亮一次这个表情",
					style: {
						...buttonSecondaryStyle,
						height: 22,
						padding: "0 8px",
						fontSize: 11,
						lineHeight: 1,
						flexShrink: 0
					},
					onClick: () => emitCatalogPreview({
						kind: group.field === "motionTexts" ? "motion" : "expression",
						id: item.id
					})
				}, "预览")), open && (0, react.createElement)("div", { style: foldBodyStyle }, (0, react.createElement)("textarea", {
					rows: 2,
					value: catalogDrafts[key] ?? custom,
					placeholder: `留空用内置释义：${item.meaning || "（无）"}`,
					maxLength: 80,
					disabled: !writable,
					style: {
						...textareaStyle,
						height: 46,
						minHeight: 46,
						maxHeight: 46,
						width: "100%",
						fontSize: 12,
						lineHeight: 1.45,
						resize: "none"
					},
					onChange: (e) => setCatalogDraft(key, e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							commitCatalogDraft({
								field: group.field,
								id: item.id
							}, key, e.target.value);
						}
					},
					onBlur: (e) => {
						if (catalogDrafts[key] === void 0) return;
						commitCatalogDraft({
							field: group.field,
							id: item.id
						}, key, e.target.value);
					}
				})));
			})))))), (0, react.createElement)("div", {
				key: "ai-trigger-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "触发"), (0, react.createElement)("div", { style: formRowStyle }, (0, react.createElement)(FormLabel, { title: "触发方式" }), (0, react.createElement)("div", { style: formControlStyle }, (0, react.createElement)("select", {
				value: value.triggerMode,
				disabled: !writable,
				style: {
					...selectStyle,
					width: 260
				},
				onChange: (e) => {
					const next = e.target.value === "queue" ? "queue" : "interrupt";
					if (next !== value.triggerMode) enqueueWrite(() => [{
						op: "set",
						path: ["triggerMode"],
						value: next
					}]);
				}
			}, (0, react.createElement)("option", { value: "interrupt" }, "截断抢占（新事件立刻掐掉上一轮，话可能说一半）"), (0, react.createElement)("option", { value: "queue" }, "排队等说完（等上一轮说完再开始，攒着的事件合并）")))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, {
				title: "最小间隔（秒）",
				hint: "事件类触发的冷却：间隔内的 DSH 事件不再触发（0 = 不限）"
			}), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: AI_MIN_INTERVAL_LIMITS.min,
				max: AI_MIN_INTERVAL_LIMITS.max,
				step: 1,
				value: numDrafts.aiMinIntervalSec ?? value.aiMinIntervalSec,
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("aiMinIntervalSec", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.aiMinIntervalSec === void 0) return;
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed)) {
						const next = Math.round(Math.min(AI_MIN_INTERVAL_LIMITS.max, Math.max(AI_MIN_INTERVAL_LIMITS.min, parsed)));
						if (next !== value.aiMinIntervalSec) commitNumDraft("aiMinIntervalSec", () => [{
							op: "set",
							path: ["aiMinIntervalSec"],
							value: next
						}]);
						else commitNumDraft("aiMinIntervalSec", () => []);
					}
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, {
				title: "静默超时（分钟）",
				hint: "多久没有任何事件/互动就主动说一句（0 = 关闭）"
			}), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("input", {
				type: "number",
				min: 0,
				max: Math.floor(IDLE_TIMEOUT_LIMITS.max / 60),
				step: 1,
				value: numDrafts.idleTimeoutMin ?? Math.round(value.idleTimeoutSec / 60),
				disabled: !writable,
				style: numberInputStyle,
				onChange: (e) => setNumDraft("idleTimeoutMin", e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") e.target.blur();
				},
				onBlur: (e) => {
					if (numDrafts.idleTimeoutMin === void 0) return;
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed)) {
						const next = Math.round(Math.min(Math.floor(IDLE_TIMEOUT_LIMITS.max / 60), Math.max(0, parsed))) * 60;
						if (next !== value.idleTimeoutSec) commitNumDraft("idleTimeoutMin", () => [{
							op: "set",
							path: ["idleTimeoutSec"],
							value: next
						}]);
						else commitNumDraft("idleTimeoutMin", () => []);
					}
				}
			}))), (0, react.createElement)(NumberRow, {
				title: "同类事件窗口（秒）",
				hint: "窗口内同类事件并进下一轮，不各自触发（如连续读文件）",
				limits: ACTIVITY_WINDOW_LIMITS,
				value: value.activityWindowSec,
				draft: numDrafts.activityWindowSec,
				writable,
				onDraft: (raw) => setNumDraft("activityWindowSec", raw),
				onCommit: (next) => {
					if (next !== value.activityWindowSec) commitNumDraft("activityWindowSec", () => [{
						op: "set",
						path: ["activityWindowSec"],
						value: next
					}]);
					else commitNumDraft("activityWindowSec", () => []);
				}
			}), (0, react.createElement)(NumberRow, {
				title: "触摸连点窗口（毫秒）",
				hint: "窗口内连点只保留最后一次，到点补发（0 = 每次触摸都响应）",
				limits: TAP_GAP_LIMITS,
				value: value.tapGapMs,
				draft: numDrafts.tapGapMs,
				writable,
				onDraft: (raw) => setNumDraft("tapGapMs", raw),
				onCommit: (next) => {
					if (next !== value.tapGapMs) commitNumDraft("tapGapMs", () => [{
						op: "set",
						path: ["tapGapMs"],
						value: next
					}]);
					else commitNumDraft("tapGapMs", () => []);
				}
			}), (0, react.createElement)(NumberRow, {
				title: "合并上限（条）",
				hint: "一轮场景句里最多拼进多少条被压下的触发；超出丢最旧的",
				limits: MERGE_MAX_LIMITS,
				value: value.mergeMax,
				draft: numDrafts.mergeMax,
				writable,
				onDraft: (raw) => setNumDraft("mergeMax", raw),
				onCommit: (next) => {
					if (next !== value.mergeMax) commitNumDraft("mergeMax", () => [{
						op: "set",
						path: ["mergeMax"],
						value: next
					}]);
					else commitNumDraft("mergeMax", () => []);
				}
			}), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "交互条" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("select", {
				style: selectStyle,
				value: value.barPosition,
				disabled: !writable,
				onChange: (e) => {
					const next = e.target.value;
					enqueueWrite(() => [{
						op: "set",
						path: ["barPosition"],
						value: next
					}]);
				}
			}, (0, react.createElement)("option", { value: "bottom" }, "模型下方"), (0, react.createElement)("option", { value: "top" }, "模型上方"), (0, react.createElement)("option", { value: "hidden" }, "不显示")), (0, react.createElement)("input", {
				type: "number",
				title: "偏移（px）：正数离模型更远，负数贴近/压住模型",
				min: BAR_OFFSET_LIMITS.min,
				max: BAR_OFFSET_LIMITS.max,
				step: OFFSET_STEP,
				value: barOffsetDraft ?? String(value.barOffset),
				disabled: !writable || value.barPosition === "hidden",
				style: numberInputStyle,
				onChange: (e) => {
					const raw = e.target.value;
					setBarOffsetDraft(raw);
					if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current);
					barOffsetTimer.current = window.setTimeout(() => commitBarOffset(raw), 200);
				},
				onBlur: (e) => {
					if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current);
					barOffsetTimer.current = null;
					commitBarOffset(e.target.value);
					setBarOffsetDraft(null);
				}
			}))), (0, react.createElement)(NumberRow, {
				title: "交互条自动隐藏（秒）",
				hint: "无操作多久后收起交互条，鼠标移到模型上重新出现（0 = 一直显示）",
				limits: BAR_AUTO_HIDE_LIMITS,
				value: value.barAutoHideSec,
				draft: numDrafts.barAutoHideSec,
				writable,
				onDraft: (raw) => setNumDraft("barAutoHideSec", raw),
				onCommit: (next) => {
					if (next !== value.barAutoHideSec) commitNumDraft("barAutoHideSec", () => [{
						op: "set",
						path: ["barAutoHideSec"],
						value: next
					}]);
					else commitNumDraft("barAutoHideSec", () => []);
				}
			}), (0, react.createElement)("div", { style: formRowStartStyle }, (0, react.createElement)(FormLabel, {
				title: "触发场景",
				hint: "打开的事件才会让角色反应；触摸与对话始终可触发。展开可改「这件事怎么描述给模型」，留空用内置文案"
			}), (0, react.createElement)("div", { style: {
				display: "flex",
				flexDirection: "column",
				gap: GAP.xs
			} }, TRIGGER_ORDER.map((event) => {
				const enabled = normalizeEventTriggers(value.eventTriggers)[event] !== false;
				const custom = normalizeEventTexts(value.eventTexts)[event] ?? "";
				const open = openScenes[event] === true;
				return (0, react.createElement)("div", {
					key: `trigger-${event}`,
					style: {
						display: "flex",
						flexDirection: "column",
						paddingBottom: GAP.xs
					}
				}, (0, react.createElement)("div", { style: foldHeadStyle }, (0, react.createElement)("label", { style: {
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					flex: "1 1 auto",
					minWidth: 0,
					fontSize: 12,
					color: C.textPrimary,
					whiteSpace: "nowrap",
					cursor: "pointer"
				} }, (0, react.createElement)("input", {
					type: "checkbox",
					checked: enabled,
					disabled: !writable,
					onChange: (e) => {
						const next = e.target.checked;
						enqueueWrite(() => [{
							op: "set",
							path: ["eventTriggers", event],
							value: next
						}]);
					}
				}), TRIGGER_EVENT_LABELS[event] ?? event), (0, react.createElement)("span", { style: foldMetaStyle }, (sceneDrafts[event] ?? custom).trim() !== "" ? "已自定义" : ""), (0, react.createElement)(FoldToggle, {
					open,
					disabled: !writable,
					onClick: () => setOpenScenes((prev) => ({
						...prev,
						[event]: !open
					}))
				})), open && (0, react.createElement)("div", { style: foldBodyStyle }, (0, react.createElement)("textarea", {
					rows: 2,
					value: sceneDrafts[event] ?? custom,
					placeholder: `留空用内置文案：${DEFAULT_EVENT_TEXTS[event] ?? event}`,
					maxLength: 60,
					disabled: !writable,
					style: {
						...textareaStyle,
						height: 46,
						minHeight: 46,
						maxHeight: 46,
						width: "100%",
						fontSize: 12,
						lineHeight: 1.45,
						resize: "none"
					},
					onChange: (e) => setSceneDraft(event, e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							commitSceneDraft(event, e.target.value);
						}
					},
					onBlur: (e) => {
						if (sceneDrafts[event] === void 0) return;
						commitSceneDraft(event, e.target.value);
					}
				})));
			})))), (0, react.createElement)("div", {
				key: "ai-prompt-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "人设与记忆"), (0, react.createElement)("div", { style: formRowStartStyle }, (0, react.createElement)(FormLabel, { title: "人设" }), (0, react.createElement)("div", { style: {
				...formControlStyle,
				flexDirection: "column",
				alignItems: "stretch"
			} }, (0, react.createElement)("div", { style: foldHeadStyle }, (0, react.createElement)("span", { style: foldTitleStyle }, personaStatus ?? "保存后立即写入 persona.md，下一次触摸生效"), (0, react.createElement)("span", { style: foldMetaStyle }, personaDraft === null ? "" : `${personaDraft.length} 字`), (0, react.createElement)(FoldToggle, {
				open: personaOpen,
				disabled: !writable || personaDraft === null,
				onClick: () => setPersonaOpen((prev) => !prev)
			})), personaOpen && (0, react.createElement)("div", { style: foldBodyStyle }, (0, react.createElement)("textarea", {
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
				gap: GAP.sm
			} }, (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonPrimaryStyle,
					opacity: personaSaving ? .6 : 1
				},
				disabled: !writable || personaSaving || personaDraft === null,
				onClick: () => savePersona()
			}, personaSaving ? "保存中…" : "保存人设"), (0, react.createElement)("button", {
				key: "ai-persona-reset",
				type: "button",
				style: {
					...buttonSecondaryStyle,
					opacity: personaSaving ? .6 : 1
				},
				disabled: !writable || personaSaving,
				title: "用内置默认人设覆盖当前 persona.md",
				onClick: () => {
					resetPersona();
				}
			}, "恢复默认"))))), (0, react.createElement)("div", { style: formRowStartStyle }, (0, react.createElement)(FormLabel, { title: "记忆" }), (0, react.createElement)("div", { style: {
				...formControlStyle,
				flexDirection: "column",
				alignItems: "stretch"
			} }, (0, react.createElement)("div", { style: foldHeadStyle }, (0, react.createElement)("span", { style: foldTitleStyle }, memoryStatus ?? "AI 觉得值得记的事会带时间戳写进来"), (0, react.createElement)("span", { style: foldMetaStyle }, memoryDraft === null ? "" : `${memoryLineCount} 条`), (0, react.createElement)(FoldToggle, {
				open: memoryOpen,
				disabled: !writable || memoryDraft === null,
				onClick: () => setMemoryOpen((prev) => !prev)
			})), memoryOpen && (0, react.createElement)("div", { style: foldBodyStyle }, (0, react.createElement)("textarea", {
				key: "ai-memory",
				rows: 8,
				value: memoryDraft ?? "",
				style: {
					...textareaStyle,
					height: 148,
					minHeight: 148,
					maxHeight: 148,
					lineHeight: 1.5,
					flex: "none",
					width: "100%",
					fontFamily: "ui-monospace, monospace",
					fontSize: 12
				},
				disabled: !writable || memoryDraft === null,
				placeholder: memoryDraft === null ? "读取中…" : "- [11-06 14:30] 主人喜欢…\n（一行一条，带时间戳）",
				onChange: (e) => setMemoryDraft(e.target.value)
			}), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: GAP.sm
			} }, (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonPrimaryStyle,
					opacity: memorySaving ? .6 : 1
				},
				disabled: !writable || memorySaving || memoryDraft === null,
				onClick: () => saveMemory()
			}, memorySaving ? "保存中…" : "保存记忆")))))))));
			const voiceModel = ttsModelOption(value.ttsModel);
			const randomVoice = voiceModel?.randomVoice === true;
			const voiceOptions = voiceModel?.voices ?? [];
			children.push((0, react.createElement)("div", {
				key: "voice",
				style: sectionStyle
			}, (0, react.createElement)(SectionHeader, {
				title: "语音",
				description: value.aiEnabled ? "开启后 AI 台词按句读逐段合成并播放，气泡跟着语音逐段显示，口型跟随音频。" : "AI 驱动已关闭，没有台词可念，语音随之关闭；重新打开 AI 驱动会恢复原来的选择。",
				action: (0, react.createElement)(ThemeSwitch, {
					checked: !!value.ttsEnabled,
					disabled: !writable || !value.aiEnabled,
					onChange: (next) => {
						enqueueWrite(() => [{
							op: "set",
							path: ["ttsEnabled"],
							value: next
						}]);
					}
				})
			}), !!value.ttsEnabled && (0, react.createElement)("div", {
				key: "voice-card",
				style: rowStyle
			}, (0, react.createElement)("div", { style: cardHeadingStyle }, "语音"), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "语音模型"), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)("select", {
				value: value.ttsModel,
				disabled: !writable,
				style: {
					...selectStyle,
					width: 260
				},
				onChange: (e) => {
					const next = e.target.value;
					if (next === value.ttsModel) return;
					const voice = ttsDefaultVoice(next);
					enqueueWrite(() => [{
						op: "set",
						path: ["ttsModel"],
						value: next
					}, {
						op: "set",
						path: ["ttsVoice"],
						value: voice
					}]);
				}
			}, (ttsModelOption(value.ttsModel) ? [] : [value.ttsModel]).concat(TTS_MODELS.map((item) => item.id)).map((id) => (0, react.createElement)("option", {
				key: id,
				value: id
			}, ttsModelOption(id)?.label ?? `自定义：${id}`))))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "音色" }), (0, react.createElement)("div", { style: {
				...formControlInlineStyle,
				gap: GAP.sm
			} }, (0, react.createElement)("select", {
				value: value.ttsVoice,
				disabled: !writable || randomVoice,
				style: {
					...selectStyle,
					width: 260
				},
				onChange: (e) => {
					const next = e.target.value;
					if (next === value.ttsVoice) return;
					enqueueWrite(() => [{
						op: "set",
						path: ["ttsVoice"],
						value: next
					}]);
				}
			}, (voiceOptions.length > 0 ? voiceOptions : [{
				id: "",
				label: "模型默认音色"
			}]).concat(value.ttsVoice && !voiceOptions.some((item) => item.id === value.ttsVoice) ? [{
				id: value.ttsVoice,
				label: `自定义：${value.ttsVoice}`
			}] : []).map((item) => (0, react.createElement)("option", {
				key: item.id,
				value: item.id
			}, item.label))))), ttsModelProvider(value.ttsModel) === "mimo" && (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, {
				title: "风格控制",
				hint: "角色每轮自己挑语气，只影响配音、不进气泡"
			}), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.ttsStyleControl,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["ttsStyleControl"],
						value: next
					}]);
				}
			}))), ttsModelProvider(value.ttsModel) === "mimo" && (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, {
				title: "语音流式",
				hint: "开：音频边收边播，首声更快；关：等合成完再播"
			}), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.ttsStreaming,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["ttsStreaming"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "口型跟随" }), (0, react.createElement)("div", { style: formControlInlineStyle }, (0, react.createElement)(ThemeSwitch, {
				checked: !!value.lipsyncEnabled,
				disabled: !writable,
				onChange: (next) => {
					enqueueWrite(() => [{
						op: "set",
						path: ["lipsyncEnabled"],
						value: next
					}]);
				}
			}))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)("span", { style: formLabelInlineStyle }, "口型强度"), (0, react.createElement)("div", { style: {
				...formControlInlineStyle,
				gap: GAP.sm
			} }, (0, react.createElement)("input", {
				type: "range",
				min: LIPSYNC_GAIN_LIMITS.min,
				max: LIPSYNC_GAIN_LIMITS.max,
				step: 1,
				value: value.lipsyncGain,
				disabled: !writable,
				style: { width: 180 },
				onChange: (e) => {
					const next = normalizeLipsyncGain(e.target.value, DEFAULT_SETTINGS.lipsyncGain);
					enqueueWrite(() => [{
						op: "set",
						path: ["lipsyncGain"],
						value: next
					}]);
				}
			}), (0, react.createElement)("span", { style: {
				fontSize: 12,
				color: C.textSecondary
			} }, `${value.lipsyncGain}%`))), (0, react.createElement)("div", { style: formRowInlineStyle }, (0, react.createElement)(FormLabel, { title: "试听" }), (0, react.createElement)("div", { style: {
				...formControlInlineStyle,
				gap: GAP.sm
			} }, (0, react.createElement)("button", {
				type: "button",
				style: {
					...buttonPrimaryStyle,
					opacity: ttsBusy ? .6 : 1
				},
				disabled: !writable || ttsBusy,
				onClick: () => {
					auditionVoice();
				}
			}, ttsBusy ? "合成中…" : "试听一句"), ttsStatus ? (0, react.createElement)("span", { style: {
				...noticeBaseStyle,
				margin: 0,
				color: C.textSecondary
			} }, ttsStatus) : null)))));
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
		* 因此在导航出现「Waifu 设置」时用爪印 SVG 替换齿轮，作为可随插件发布的兼容方案。
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
		const NAV_LABEL = "Waifu 设置";
		/**
		* 监视 DOM：把「Waifu 设置」导航行上的默认齿轮换成爪印。
		* 返回停止函数（插件卸载 / section 退订时调用）。
		*/
		function installPetSettingsNavIcon() {
			/** 已经换上去的那个 svg：还连着就不再扫（大多数 DOM 变更与导航无关）。 */
			let swapped = null;
			let scheduled = 0;
			const swap = () => {
				scheduled = 0;
				if (swapped !== null && swapped.isConnected) return;
				swapped = null;
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
					swapped = next;
				}
			};
			const schedule = () => {
				if (scheduled !== 0) return;
				scheduled = window.requestAnimationFrame(swap);
			};
			swap();
			const mo = new MutationObserver(schedule);
			mo.observe(document.documentElement, {
				childList: true,
				subtree: true
			});
			return () => {
				mo.disconnect();
				if (scheduled !== 0) window.cancelAnimationFrame(scheduled);
			};
		}
		/** 校验 Host 下发的 `cues`：形状不对直接丢弃，目录外的 id 也不算数。 */
		function readCues(raw, isExpression, isMotion) {
			if (!Array.isArray(raw)) return [];
			const out = [];
			for (const item of raw) {
				if (!item || typeof item !== "object") continue;
				const cue = item;
				if (typeof cue.id !== "string") continue;
				if (cue.kind === "expression" && isExpression(cue.id)) out.push({
					kind: "expression",
					id: cue.id
				});
				else if (cue.kind === "motion" && isMotion(cue.id)) out.push({
					kind: "motion",
					id: cue.id
				});
			}
			return out;
		}
		/** 把一条 cue 拆成「立刻生效的表情」和「要排队播的动作」（一个动作一组，按序串行）。 */
		function splitCues(cues) {
			const expressions = [];
			const motions = [];
			for (const cue of cues) {
				if (cue.kind === "expression") {
					if (!expressions.includes(cue.id)) expressions.push(cue.id);
					continue;
				}
				if (!motions.includes(cue.id)) motions.push(cue.id);
			}
			return {
				expressions,
				motions
			};
		}
		/**
		* 入队一个动作；队列满时丢最旧的那个并报告它（调用方负责留痕）。
		* 返回新队列与被丢弃的动作名（没有丢就是 `null`）。
		*/
		function pushMotion(queue, name, max = 2) {
			if (!name) return {
				queue: [...queue],
				dropped: null
			};
			const next = [...queue, name];
			let dropped = null;
			while (next.length > Math.max(1, max)) dropped = next.shift() ?? dropped;
			return {
				queue: next,
				dropped
			};
		}
		// src/client/schedule.ts
		/** 空状态。 */
		function initialScheduleState() {
			return {
				lastTapAt: 0,
				lastEventAt: 0,
				lastSeenAt: {},
				merged: []
			};
		}
		/** 把一条事件塞进合并队列（同类聚合、超出上限丢最旧）。 */
		function pushMerged(merged, event, max) {
			const index = merged.findIndex((item) => item.event === event);
			if (index >= 0) {
				const next = merged.slice();
				next[index] = {
					event,
					count: next[index].count + 1
				};
				return {
					merged: next,
					overflowed: 0
				};
			}
			const next = [...merged, {
				event,
				count: 1
			}];
			const limit = Math.max(1, max);
			if (next.length <= limit) return {
				merged: next,
				overflowed: 0
			};
			return {
				merged: next.slice(next.length - limit),
				overflowed: next.length - limit
			};
		}
		/**
		* 调度一支触发。
		*
		* @param state 调度器状态
		* @param incoming 这次进来的触发
		* @param config 策略配置
		* @param now 当前时间戳（由调用方注入，便于测试）
		*/
		function dispatchTrigger(state, incoming, config, now) {
			if (!config.aiEnabled) return {
				decision: {
					action: "drop",
					reason: "ai disabled"
				},
				state
			};
			if (config.hidden) return {
				decision: {
					action: "drop",
					reason: "page hidden"
				},
				state
			};
			if (incoming.kind === "idle") {
				if (config.busy) return {
					decision: {
						action: "drop",
						reason: "busy"
					},
					state
				};
				return {
					decision: {
						action: "run",
						merged: []
					},
					state
				};
			}
			if (incoming.kind === "tap" || incoming.kind === "chat") {
				if (incoming.kind === "tap" && config.tapGapMs > 0 && state.lastTapAt > 0) {
					const left = state.lastTapAt + config.tapGapMs - now;
					if (left > 0) return {
						decision: {
							action: "defer",
							delayMs: left,
							reason: "tap gap"
						},
						state
					};
				}
				const next = {
					...state,
					lastTapAt: incoming.kind === "tap" ? now : state.lastTapAt,
					merged: []
				};
				return {
					decision: {
						action: "run",
						merged: state.merged
					},
					state: next
				};
			}
			const event = incoming.event;
			if (event === void 0) return {
				decision: {
					action: "drop",
					reason: "event without key"
				},
				state
			};
			if (incoming.switchOff) return {
				decision: {
					action: "drop",
					reason: "scene switch off"
				},
				state
			};
			const seenAt = state.lastSeenAt[event];
			const inGap = config.eventGapMs > 0 && state.lastEventAt > 0 && now - state.lastEventAt < config.eventGapMs;
			const sameKind = config.sameKindWindowMs > 0 && seenAt !== void 0 && now - seenAt < config.sameKindWindowMs;
			const busyQueue = config.busy && config.triggerMode === "queue";
			const seenState = {
				...state,
				lastSeenAt: {
					...state.lastSeenAt,
					[event]: now
				}
			};
			if (inGap || sameKind || busyQueue) {
				const pushed = pushMerged(seenState.merged, event, config.mergeMax);
				return {
					decision: {
						action: "merge",
						reason: busyQueue ? "busy" : inGap ? "event gap" : "same kind",
						nextAt: busyQueue || state.lastEventAt <= 0 ? 0 : Math.max(now, state.lastEventAt + config.eventGapMs),
						overflowed: pushed.overflowed
					},
					state: {
						...seenState,
						merged: pushed.merged
					}
				};
			}
			const next = {
				...seenState,
				lastEventAt: now,
				merged: []
			};
			return {
				decision: {
					action: "run",
					merged: state.merged
				},
				state: next
			};
		}
		/**
		* 取走合并队列，凑成一次「补发」的触发（轮次结束或最小间隔到期时调用）。
		* 最后进来的那条当主场景，其余条目交给调用方拼进「这期间还发生了…」。
		*/
		function flushMerged(state) {
			if (state.merged.length === 0) return {
				incoming: null,
				merged: [],
				state
			};
			return {
				incoming: {
					kind: "event",
					event: state.merged[state.merged.length - 1].event
				},
				merged: state.merged,
				state: {
					...state,
					merged: []
				}
			};
		}
		// src/client/index.ts
		/**
		* dsh-waifu 浏览器半区：挂载 Live2D 桌宠 + 「Waifu 设置」页。
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
		/**
		* 判定「这是点击」的容差（px）：指针按下到抬起的位移不超过它就算点击（位置回滚）。
		* 触屏/触控板按一下常带 6–10px 抖动，若按 `DRAG_THRESHOLD` 直接算拖拽，点击就会被吞掉。
		*/
		const TAP_SLOP_PX = 12;
		/**
		* 浏览器所在时区（IANA 名）：宿主可能跑在 UTC，只发「HH:MM」的绝对时间会让模型把深夜当清晨。
		* 时区不会变，算一次缓存住。
		*/
		const CLIENT_TIME_ZONE = (() => {
			try {
				return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
			} catch {
				return "";
			}
		})();
		/**
		* 交互条静音按钮的图标：内联 SVG（`currentColor` 描边）。
		* 不用 emoji——各平台字体渲染差异太大、大小也对不齐。
		*/
		const ICON_SPEAKER_ON = "<svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M11 5 6 9H3v6h3l5 4z\"/><path d=\"M15.5 8.5a5 5 0 0 1 0 7\"/><path d=\"M18.5 5.5a9 9 0 0 1 0 13\"/></svg>";
		const ICON_SEND = "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4.5 12h13\"/><path d=\"m12 6.5 5.5 5.5-5.5 5.5\"/></svg>";
		const ICON_SPEAKER_OFF = "<svg width=\"15\" height=\"15\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M11 5 6 9H3v6h3l5 4z\"/><path d=\"m16.5 9.5 5 5\"/><path d=\"m21.5 9.5-5 5\"/></svg>";
		/** 瞬态气泡显示时长（ms）：到时自动隐藏或回落阶段文案。 */
		const BUBBLE_DISPLAY_MS = 2500;
		/** 气泡最长连续可见时长兜底（秒）：默认 10；0 = 不限（spec §3，ADR-027）。 */
		const BUBBLE_MAX_DEFAULT = 10;
		/**
		* 调试面板手动摆放（spec §2 / ADR-044）：拖动标题栏移动、拖四角缩放后，几何存浏览器本地。
		* 用 localStorage 而不是设置文件——这是纯客户端的调试工具状态，不该进 Host schema、也不该
		* 跟着设置同步到别的设备；键带版本号，几何结构再变时换键即可让旧记录自然失效。
		*/
		const DEBUG_PANEL_STORE_KEY = "dsh-waifu.debug-panel:v1";
		/** 面板尺寸下限（px）：再小按钮就点不准了。默认尺寸按视口另算（ADR-055），下限只约束手动缩放。 */
		const DEBUG_PANEL_MIN_W = 320;
		const DEBUG_PANEL_MIN_H = 400;
		/** 折叠态面板高度（px，只留标题栏；实际由内容撑开，这里只用于气泡避让估算）。 */
		const DEBUG_PANEL_COLLAPSED_H = 34;
		/** 面板与视口边缘的最小间距（px）。 */
		const DEBUG_PANEL_MARGIN = 8;
		/** AI 台词最短可见时长：状态切换再快，也要让这句露一脸（ADR-025 补丁）。 */
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
		/** AI 标签表情的临时保持时长（ms）：到期回落默认表情（ADR-037）。 */
		const TAG_EXPRESSION_HOLD_MS = 4200;
		/** 单个动作最长等多久（motionFinish 丢信号时不让队列卡死）。 */
		const MOTION_WAIT_MS = 6e3;
		/** 静默超时兜底步长（ms）：计时器误差容忍，避免和设置值贴边抖动。 */
		const IDLE_TIMER_SLACK_MS = 250;
		const IDLE_MICRO_MOTIONS = [
			"Glance",
			"Perk",
			"Shift",
			"Sigh"
		];
		const IDLE_MICRO_MIN_MS = 7e3;
		/** 被打断（非 idle / 正在互动）后重试的间隔。 */
		const IDLE_MICRO_RETRY_MS = 4e3;
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
			/** AI 回复（ADR-037）：上报触发场景，拿回台词 + 表情/动作 + 记忆（失败返回 ok:false）。 */
			interact: (body) => fetch(`${PET_API}/interact`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			}).then((res) => readJson(res)),
			/**
			* 流式演绎（ADR-033）：POST /speak 走 SSE，逐条回调 `text`/`clause`/`audio`/`done`/`error`。
			* 用 fetch + ReadableStream 手动解帧（EventSource 不支持 POST 带 body）。
			*/
			speak: async (body, onEvent, signal) => {
				const res = await fetch(`${PET_API}/speak`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal
				});
				if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					let split = buffer.indexOf("\n\n");
					while (split >= 0) {
						const frame = buffer.slice(0, split);
						buffer = buffer.slice(split + 2);
						let event = "message";
						const dataLines = [];
						for (const line of frame.split("\n")) if (line.startsWith("event:")) event = line.slice(6).trim();
						else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
						if (dataLines.length > 0) try {
							onEvent(event, JSON.parse(dataLines.join("\n")));
						} catch {}
						split = buffer.indexOf("\n\n");
					}
				}
			},
			/** 排查用（ADR-043）：最近一次 LLM / TTS 请求报文与历史。 */
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
		/** 气泡兜底：行首的 `[shy]`、`［害羞］`、`** [smug] **` 一律当控制标签剥掉（客户端没有情绪词表，就看位置）。 */
		const LEADING_TAG = /^\s*[*_`~]*\s*(?:<\s*[^<>\n]{1,24}>|[[［【][^\]］】\n]{1,24}[\]］】])\s*[*_`~]*\s*/;
		function stripLeadingTagText(text) {
			let out = text;
			for (let i = 0; i < 3; i += 1) {
				const next = out.replace(LEADING_TAG, "");
				if (next === out) break;
				out = next;
			}
			return out || text;
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
				clearIdleTimer();
				clearBubbleHideTimer();
				clearPendingTap();
				clearHover();
				if (mergeTimer !== void 0) {
					window.clearTimeout(mergeTimer);
					mergeTimer = void 0;
				}
				stopSpeaking();
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
			pushCleanup(onCatalogPreview((target) => {
				previewCatalog(target);
			}));
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
				}, viewport, uiScale());
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
			/** 调试面板状态文本容器：与场景演示/动画预览并列，避免被 textContent 覆盖。 */
			let debugTextEl = null;
			/** 是否正处于 debug 原生动画预览：预览期间抑制 focus，结束后只恢复跟随，不触发状态恢复。 */
			let previewActive = false;
			/** 调试面板顶部（逻辑画布 CSS px；NaN = 不可见/未定位），用于气泡避让（spec §2）。 */
			let debugPanelTopLogical = NaN;
			/** 调试面板底部（逻辑画布 CSS px；NaN = 不可见/未定位）：气泡避让只在面板整体位于模型上方时生效。 */
			let debugPanelBottomLogical = NaN;
			/** 调试面板手动几何（逻辑画布 CSS px；null = 自动跟随模型上方，spec §2 / ADR-044）。 */
			let debugPanelManual = null;
			/** 是否已从 localStorage 读过手动几何（首次建面板时读一次，之后以内存为准）。 */
			let debugPanelGeometryLoaded = false;
			/** 调试面板是否折叠（只留标题栏）：纯客户端瞬时状态，不写 localStorage，重开面板恢复展开。 */
			let debugPanelCollapsed = false;
			/** 标题栏折叠按钮与内容区：折叠/展开时切换（面板重建时重新赋值）。 */
			let debugFoldEl = null;
			let debugBodyEl = null;
			/** 四角缩放把手：折叠时隐藏（折叠态只留标题栏，尺寸交给内容撑开）。 */
			let debugGrips = [];
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
			/** 本次按压开始时间（pointerdown 记，pointerup 算时长 → 轻碰/戳戳/抚摸，ADR-037）。 */
			let tapDownAt = 0;
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
			/** 一轮演绎期间气泡不自动消失（ADR-052）：文字比声音早到，2.5s 计时会在播到一半时把气泡收走。 */
			let bubbleHeld = false;
			/** 气泡最长可见计时器：从「隐藏 → 可见」那一刻起算，替换文案不重置（ADR-027）。 */
			let bubbleMaxTimer;
			let bubbleMaxMs = BUBBLE_MAX_DEFAULT * 1e3;
			/** 气泡当前是否可见（用于判断一次新的显示是否要重新起算最长时长）。 */
			let bubbleVisible = false;
			let lastState = null;
			let view = null;
			let pos = {
				right: 24,
				bottom: 20,
				size: 240
			};
			/** 角色可见轮廓中心相对模型画布中心的偏移比例（ADR-059；0 = 与画布中心重合）。 */
			let visualOffsetXFrac = 0;
			let visualOffsetYFrac = 0;
			/** 可见轮廓是否已测量出有效值（调试状态文本展示用）。 */
			let visualMeasured = false;
			/** 已排过一次可见轮廓测量（ticker 首帧 + 900ms 兜底只跑一次）。 */
			let visualMeasurePending = false;
			/** 可见轮廓包围盒尺寸（画布比例）；仅调试排查展示（ADR-059）。 */
			let visualBoxWFrac = 0;
			let visualBoxHFrac = 0;
			let canvasPadXPct = 125;
			let canvasPadYPct = 50;
			let tempExpressions = [];
			let tempExpressionUntil = 0;
			/** 调试面板「表情预览」强制显示的表情（null = 不干预）。 */
			let debugExpression = null;
			let repaintDebugExpressions = null;
			/** 表达式开关参数当前混合值（每帧向目标逼近 → 淡入淡出）。 */
			const expressionMix = /* @__PURE__ */ new Map();
			/** AI 驱动总开关（SSE config.aiEnabled；ADR-037）：关闭后角色完全静默。 */
			let aiEnabled = false;
			/** 触发频率（SSE config.triggerMode；ADR-037）：interrupt = 截断抢占，queue = 排队等完成。 */
			let triggerMode = DEFAULT_TRIGGER_MODE;
			/** 事件类触发的最小间隔（秒，0 = 不限；触摸/对话豁免，ADR-037）。 */
			let aiMinIntervalSec = 0;
			/** 静默超时（秒，0 = 关闭）：多久没动静就让角色自己说一句（ADR-037）。 */
			let idleTimeoutSec = 0;
			/** 同类事件窗口（秒；ADR-047 起由客户端调度器执行，Host 不再节流）。 */
			let activityWindowSec = 10;
			/** 触摸连点窗口（毫秒，ADR-047）。 */
			let tapGapMs = DEFAULT_TAP_GAP_MS;
			/** 合并上限（条，ADR-047）。 */
			let mergeMax = 6;
			/** 触发调度的全部窗口/合并状态（ADR-047：唯一的判断来源）。 */
			let scheduleState = initialScheduleState();
			/** 合并补发计时器（最小间隔到期那一下）。 */
			let mergeTimer;
			/** 连点窗口内被延后的一次触摸（新的覆盖旧的）。 */
			let deferredTap = null;
			/** 静默超时计时器：任何触发都重排。 */
			let idleTimer;
			/** 按 DSH 事件类型的触发开关（SSE config.eventTriggers；触摸/对话不在表内，必触发）。 */
			let eventTriggers = {};
			/** 上一轮演绎是否还在进行中（调度器的 busy 门）。 */
			let speakingTurnActive = false;
			/** 说话时的身体语言（点头/挑眉）开关，与口型跟随一起生效。 */
			let bodyLanguageEnabled = true;
			/** 待机小动作开关（设置页「待机小动作」）。 */
			let idleMotionEnabled = DEFAULT_SETTINGS.idleMotionEnabled;
			let idleMicroTimer = null;
			/** 语音合成开关（SSE config.ttsEnabled；ADR-033）：开启后走 /speak 流式管线（气泡与语音同步）。 */
			let ttsEnabled = DEFAULT_SETTINGS.ttsEnabled;
			/** 口型跟随开关（SSE config.lipsyncEnabled）：按正在播放的音频能量驱动 ParamMouthOpenY。 */
			let lipsyncEnabled = DEFAULT_SETTINGS.lipsyncEnabled;
			/** 口型强度百分比（0–300，100 = 标准）。 */
			let lipsyncGain = DEFAULT_SETTINGS.lipsyncGain;
			/** 交互条（模型上下的静音按钮 + 对话输入框）位置与 DOM。 */
			let barPosition = "top";
			let barOffset = -30;
			let barEl = null;
			let barMuteEl = null;
			let barInputEl = null;
			let barSendEl = null;
			/** 交互条尺寸缓存（只在内容/位置变化时重新测量，避免每帧读布局）。 */
			let barW = 0;
			let barH = 0;
			let barKey = "";
			/** 交互条无操作自动隐藏（秒，0 = 不自动隐藏；SSE config.barAutoHideSec）。 */
			let barAutoHideSec = 10;
			/** 交互条当前是否已被「自动隐藏」收起（区别于 barPosition='hidden' 的永久不显示）。 */
			let barAutoHidden = false;
			/** 指针此刻是否停在模型或交互条上（离开的那一瞬才开始计无操作时间）。 */
			let barPointerOver = false;
			/** 计划收起交互条的时间戳（ms，0 = 不计划）：每次「有操作」顺延，到点按剩余时间重排。 */
			let barHideAt = 0;
			/** 自动隐藏计时器（全程单个 setTimeout；触发时若指针还在宠物上就等离开再排）。 */
			let barHideTimer;
			/** AI 回复请求序号：只采用最后一次请求的结果，避免连点时旧回复覆盖新回复。 */
			let aiRequestSeq = 0;
			/** 部位定义了双击交互时，单击要等一个双击窗口再结算（ADR-038）。 */
			let pendingDoublePart = null;
			let hoverState = null;
			const clearHover = () => {
				if (hoverState !== null) window.clearTimeout(hoverState.timer);
				hoverState = null;
			};
			let bubbleOffsetX = 0;
			/** 气泡底部与交互条顶端的间距（px，ADR-057）。 */
			const BUBBLE_BAR_GAP = 10;
			let bubbleBgColor = DEFAULT_BUBBLE_BG_COLOR;
			let bubbleBgOpacity = 92;
			let bubbleTextColor = DEFAULT_BUBBLE_TEXT_COLOR;
			/** 首次启动是否已套用配置默认中心位置（displaySaved=false 时只套用并回写一次，spec §2）。 */
			let homeApplied = false;
			let maxFps = 30;
			let enabled = true;
			/** 标签页/窗口是否可见（spec §7：只有它影响渲染循环）。 */
			let hidden = document.visibilityState === "hidden";
			/** 浏览器窗口是否有焦点：只影响鼠标跟随，不停渲染（用户可在别处时也让角色动）。 */
			let windowFocused = document.hasFocus();
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
			/** 到期隐藏气泡（ADR-052：只在一轮演完之后计时，演绎过程中由 bubbleHeld 按住）。 */
			function armBubbleHideTimer() {
				clearBubbleHideTimer();
				bubbleHideTimer = window.setTimeout(() => {
					bubbleHideTimer = void 0;
					bubbleVisible = false;
					clearBubbleMaxTimer();
					if (bubble) bubble.style.opacity = "0";
				}, BUBBLE_DISPLAY_MS);
			}
			/** 按住 / 放开气泡：演绎期间按住（不自动消失），放开时重新起算展示时长。 */
			function setBubbleHold(held) {
				bubbleHeld = held;
				if (held) {
					clearBubbleHideTimer();
					return;
				}
				if (bubbleVisible) armBubbleHideTimer();
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
					if (bubbleHeld) return;
					bubbleVisible = false;
					stopSpeaking();
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
			* 气泡定位（spec §3）：纵向不再单独配置，跟交互条几何绑定（ADR-057）——
			* - 交互条贴在模型上方且可见：气泡底部距交互条顶端 BUBBLE_BAR_GAP(10) px；
			* - 交互条自动收起 / `barPosition === 'hidden'`：气泡底部落到交互条原本的底边槽位，
			*   而不是模型包围盒顶端（包围盒比视觉头顶高，气泡会悬空）；
			* - 交互条贴在下方：气泡底部贴模型包围盒顶端。
			* 水平：气泡底部中点贴住 (bounds.x + width/2 + bubbleOffsetX, 锚点 y)，transform: translate(-50%, -100%)
			* 由样式居中/贴底。调试面板可见时锚点上移到面板顶部再往上 6px；目标视口 y clamp 到 ≥8。
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
				let anchorY;
				if (barPosition === "bottom") anchorY = bounds.y;
				else if (barPosition === "top" && !barAutoHidden && barH > 0) anchorY = bounds.y - barH - 8 - barOffset - BUBBLE_BAR_GAP;
				else anchorY = bounds.y - 8 - barOffset;
				if (!debugPanelManual && Number.isFinite(debugPanelTopLogical) && debugPanelBottomLogical <= bounds.y + 1) anchorY = debugPanelTopLogical - 6;
				const rect = layerRect();
				if (rect && rect.top + anchorY < 8) anchorY = 8 - rect.top;
				bubble.style.left = `${anchorX}px`;
				bubble.style.top = `${anchorY}px`;
			}
			/** 建交互条：圆形静音按钮 + 胶囊输入框，整体贴在模型上方或下方。 */
			function buildBar() {
				if (!petLayer || barEl) return;
				const bar = document.createElement("div");
				Object.assign(bar.style, {
					position: "absolute",
					display: "flex",
					alignItems: "center",
					gap: "6px",
					padding: "4px 4px 4px 4px",
					borderRadius: "999px",
					background: "rgba(24,26,34,.82)",
					border: "1px solid rgba(255,255,255,.16)",
					boxShadow: "0 6px 18px rgba(0,0,0,.28)",
					backdropFilter: "blur(6px)",
					pointerEvents: "auto",
					zIndex: "4",
					opacity: "0",
					transition: "opacity .18s ease"
				});
				const mute = document.createElement("button");
				mute.type = "button";
				mute.title = "静音 / 取消静音";
				Object.assign(mute.style, {
					width: "26px",
					height: "26px",
					flex: "0 0 auto",
					display: "grid",
					placeItems: "center",
					borderRadius: "50%",
					border: "none",
					background: "rgba(255,255,255,.10)",
					color: "#e8edf7",
					fontSize: "13px",
					lineHeight: "1",
					cursor: "pointer",
					padding: "0"
				});
				mute.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					toggleMute();
				});
				const send = document.createElement("button");
				send.type = "button";
				send.title = "发送";
				send.setAttribute("aria-label", "发送");
				Object.assign(send.style, {
					width: "26px",
					height: "26px",
					flex: "0 0 auto",
					display: "grid",
					placeItems: "center",
					borderRadius: "50%",
					border: "none",
					background: "rgba(120,170,255,.22)",
					color: "#e8edf7",
					cursor: "pointer",
					padding: "0",
					transition: "background .15s ease, opacity .15s ease"
				});
				send.innerHTML = ICON_SEND;
				send.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					sendChat();
				});
				const input = document.createElement("input");
				input.type = "text";
				input.maxLength = 200;
				input.placeholder = "跟我说句话…";
				input.setAttribute("aria-label", "和角色说话");
				Object.assign(input.style, {
					width: "150px",
					background: "transparent",
					border: "none",
					outline: "none",
					color: "#eef2f8",
					fontSize: "12px",
					padding: "0 6px",
					fontFamily: "inherit"
				});
				input.addEventListener("keydown", (event) => {
					event.stopPropagation();
					noteBarActivity();
					if (event.key !== "Enter" || event.isComposing) return;
					event.preventDefault();
					sendChat();
				});
				bar.addEventListener("pointerdown", (event) => {
					event.stopPropagation();
					noteBarActivity();
				});
				input.addEventListener("input", () => {
					syncSendState();
					noteBarActivity();
				});
				input.addEventListener("focus", () => noteBarActivity());
				input.addEventListener("blur", () => restartBarHideClock());
				bar.append(mute, input, send);
				petLayer.appendChild(bar);
				barEl = bar;
				barMuteEl = mute;
				barInputEl = input;
				barSendEl = send;
				barW = 0;
				barH = 0;
				barKey = "";
				syncBarVisual();
				window.requestAnimationFrame(() => {
					bar.style.opacity = "1";
				});
				syncOverlayLoop();
				restartBarHideClock();
			}
			/** 按当前语音/AI 开关刷新交互条外观（静音图标、禁用态）。 */
			function syncBarVisual() {
				if (!barMuteEl || !barInputEl) return;
				const muted = !ttsEnabled;
				barMuteEl.innerHTML = muted ? ICON_SPEAKER_OFF : ICON_SPEAKER_ON;
				barMuteEl.setAttribute("aria-pressed", muted ? "true" : "false");
				barMuteEl.title = muted ? "取消静音" : "静音";
				const canChat = aiEnabled;
				barInputEl.disabled = !canChat;
				barInputEl.placeholder = canChat ? "跟我说句话…" : "AI 回复未开启";
				barInputEl.style.opacity = canChat ? "1" : ".45";
				syncSendState();
				barW = 0;
				barH = 0;
				barKey = "";
			}
			/**
			* 发送按钮的可点击状态：只有「AI 开着 + 输入框非空」才算真正可发送。
			* 空输入不硬禁用（点一下能把光标放进输入框），但用 `aria-disabled` 与灰态说清楚它不会发。
			*/
			function syncSendState() {
				if (!barSendEl || !barInputEl) return;
				const hasText = barInputEl.value.trim().length > 0;
				const canSend = aiEnabled && hasText;
				barSendEl.disabled = !aiEnabled;
				barSendEl.setAttribute("aria-disabled", canSend ? "false" : "true");
				barSendEl.title = !aiEnabled ? "AI 回复未开启" : hasText ? "发送" : "先输入内容";
				barSendEl.style.opacity = canSend ? "1" : ".4";
				barSendEl.style.background = canSend ? "rgba(120,170,255,.42)" : "rgba(255,255,255,.10)";
				barSendEl.style.cursor = canSend ? "pointer" : "default";
			}
			/** 静音按钮：直接改设置里的 `ttsEnabled`（持久化，其它端也同步）。 */
			async function toggleMute() {
				const next = !ttsEnabled;
				ttsEnabled = next;
				syncBarVisual();
				try {
					await fetch(`${PET_API}/settings`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ ops: [{
							op: "set",
							path: ["ttsEnabled"],
							value: next
						}] })
					});
				} catch {}
			}
			/** 交互条输入框回车：把这句话交给模型（人设 + 场景 + 历史），回复照常走气泡/语音。 */
			async function sendChat() {
				const input = barInputEl;
				if (!input) return;
				const text = input.value.trim();
				if (text.length === 0) {
					input.focus();
					syncSendState();
					return;
				}
				if (!aiEnabled) return;
				input.value = "";
				syncSendState();
				if (ttsEnabled) ensureAudio();
				await fireTrigger({
					kind: "chat",
					text
				});
			}
			/**
			* 交互条定位：贴模型包围盒上方或下方居中。
			* 水平方向只按包围盒居中、随模型一起移动，不再夹取到视口（ADR-058）：
			* 手机上模型画布往往比视口宽，夹取会把条钉在屏幕边缘、与角色的可移动区域不一致。
			*/
			function updateBarPosition(boundsArg) {
				if (!barEl || !petLayer) return;
				if (barPosition === "hidden") {
					barEl.style.display = "none";
					barKey = "";
					return;
				}
				barEl.style.display = "flex";
				const bounds = boundsArg === void 0 ? modelBounds() : boundsArg;
				if (!bounds) return;
				if (barW === 0 || barH === 0) {
					barW = barEl.offsetWidth;
					barH = barEl.offsetHeight;
				}
				const left = bounds.x + bounds.width / 2 - barW / 2;
				const top = barPosition === "top" ? bounds.y - barH - 8 - barOffset : bounds.y + bounds.height + 8 + barOffset;
				barEl.style.left = `${Math.round(left)}px`;
				barEl.style.top = `${Math.round(top)}px`;
			}
			/** 指针是否落在交互条自身矩形内（读缓存的 left/top 与尺寸，不触发重新布局）。 */
			function pointerInBar(clientX, clientY) {
				if (!barEl || barAutoHidden || barPosition === "hidden" || barW <= 0 || barH <= 0) return false;
				const rect = layerRect();
				if (!rect) return false;
				const left = Number.parseFloat(barEl.style.left);
				const top = Number.parseFloat(barEl.style.top);
				if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
				const x = rect.left + left;
				const y = rect.top + top;
				return clientX >= x && clientX <= x + barW && clientY >= y && clientY <= y + barH;
			}
			/** 指针是否落在模型包围盒内（视口坐标；canvas rect 与包围盒都走缓存）。 */
			function pointerInModel(clientX, clientY) {
				if (!canvas || !model) return false;
				const bounds = modelBounds();
				if (!bounds) return false;
				if (!canvasRectCache) try {
					canvasRectCache = canvas.getBoundingClientRect();
				} catch {
					return false;
				}
				return pointToBoundsRatio(clientX - canvasRectCache.left, clientY - canvasRectCache.top, bounds) !== null;
			}
			/** 指针是否算「在宠物身上」（模型或交互条）。 */
			function pointerOnPet(clientX, clientY) {
				return pointerInModel(clientX, clientY) || pointerInBar(clientX, clientY);
			}
			/** 收起/显示交互条本体（只切可见性，不重建 DOM；barPosition='hidden' 的永久隐藏另管）。 */
			function setBarAutoHidden(hidden) {
				if (!barEl || barAutoHidden === hidden) return;
				barAutoHidden = hidden;
				barKey = "";
				if (hidden) {
					barEl.style.opacity = "0";
					barEl.style.pointerEvents = "none";
					barEl.setAttribute("inert", "");
				} else {
					barEl.style.opacity = "1";
					barEl.style.pointerEvents = "auto";
					barEl.removeAttribute("inert");
				}
				updateBubblePosition();
			}
			/** 清掉计时器（不动截止时间与可见状态）。 */
			function clearBarHideTimer() {
				if (barHideTimer !== void 0) {
					window.clearTimeout(barHideTimer);
					barHideTimer = void 0;
				}
			}
			/** 到点时指针仍停在宠物上、或正在输入框里打字，就不算「没操作」——等离开/失焦再排。 */
			function barHoverHeld() {
				if (barInputEl !== null && document.activeElement === barInputEl) return true;
				const pointer = lastPointerClient;
				return pointer !== null && pointerOnPet(pointer.x, pointer.y);
			}
			/** 按 barHideAt 排唯一计时器；到点时若截止时间被顺延，就按剩余时间重排。 */
			function armBarHideTimer() {
				clearBarHideTimer();
				if (barHideAt === 0) return;
				barHideTimer = window.setTimeout(() => {
					barHideTimer = void 0;
					if (barHideAt === 0) return;
					if (barHideAt - Date.now() > 0) {
						armBarHideTimer();
						return;
					}
					if (barHoverHeld()) {
						barHideAt = 0;
						return;
					}
					barHideAt = 0;
					setBarAutoHidden(true);
				}, Math.max(0, barHideAt - Date.now()));
			}
			/** 从「现在」重新计无操作时间（0 = 常显；交互条不可见/已在收起态时不计时）。 */
			function restartBarHideClock() {
				if (barAutoHideSec <= 0 || !barEl || barPosition === "hidden" || barAutoHidden) {
					barHideAt = 0;
					clearBarHideTimer();
					return;
				}
				barHideAt = Date.now() + barAutoHideSec * 1e3;
				if (barHideTimer === void 0) armBarHideTimer();
			}
			/** 交互条「有操作」：被自动收起时先显示，再把自动隐藏的截止时间顺延。 */
			function noteBarActivity() {
				if (!barEl || barPosition === "hidden") return;
				if (barAutoHidden) setBarAutoHidden(false);
				if (barAutoHideSec <= 0) {
					barHideAt = 0;
					clearBarHideTimer();
					return;
				}
				barHideAt = Date.now() + barAutoHideSec * 1e3;
				if (barHideTimer === void 0) armBarHideTimer();
			}
			/** 全局指针移动：只在「进入模型/交互条」与「离开」两个边界改计时，移动过程不重排 timer。 */
			function syncBarHover(clientX, clientY) {
				if (pointerOnPet(clientX, clientY)) {
					if (!barPointerOver) {
						barPointerOver = true;
						noteBarActivity();
					}
					return;
				}
				if (barPointerOver) {
					barPointerOver = false;
					restartBarHideClock();
				}
			}
			/** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
			function setBubbleText(text) {
				if (!bubble) return;
				clearBubbleHideTimer();
				bubble.textContent = stripLeadingTagText(stripTimestamps(text));
				bubble.style.opacity = "1";
				if (!bubbleVisible) {
					bubbleVisible = true;
					armBubbleMaxTimer();
				}
				updateBubblePosition();
			}
			/** 立刻替换气泡文案（不经 AI 排队），到时隐藏；演绎期间只换文案、不收气泡（ADR-052）。 */
			function showBubbleNow(text) {
				if (!bubble) return;
				clearBubbleHideTimer();
				setBubbleText(text);
				if (!bubbleHeld) armBubbleHideTimer();
			}
			/** AI 台词上屏（ADR-037：不再有预置台词排队，直接换文案）。 */
			function showAiBubble(text) {
				showBubbleNow(text);
			}
			/** 音频上下文（首次用户手势后才创建，遵守浏览器自动播放策略）。 */
			let audioCtx = null;
			/** 口型分析器：每段音频接到它上面，按波形 RMS 驱动张嘴。 */
			let lipsyncAnalyser = null;
			let lipsyncData = null;
			/** 当前口型开合（0–1，已按 lipsyncGain 缩放）。 */
			let mouthLevel = 0;
			/** 本轮演绎的中止器与序号（新的一轮直接作废旧一轮）。 */
			let speakAbort = null;
			let speakSeq = 0;
			/** 本轮已经下发的句读（气泡按音频进度逐段显示）。 */
			let speakClauses = [];
			/** 每段台词该演什么（ADR-048 P3）：`clause` 帧里的 cues，按段号索引。 */
			let speakCues = /* @__PURE__ */ new Map();
			/** 已经执行过 cue 的最大段号（跳过没音频的段也不漏演）。 */
			let speakCueIndex = -1;
			/** 还没被 cue 接管的 `tags` 帧（旧 Host 没有 cues 时仍按它播）。 */
			let pendingTags = null;
			/** 动作串行队列：一段一句，播完（motionFinish）再放下一个。 */
			let motionQueue = [];
			let motionBusy = false;
			let motionWaiters = [];
			/** 已经显示到第几段（-1 = 还没显示）。 */
			let speakRevealed = -1;
			/** 音频播放串行链：保证第 0 段播完才播第 1 段。 */
			let speakChain = Promise.resolve();
			/** 正在播的那一段：stopSpeaking 要真的把它掐掉（只 abort 请求停不下已排队的音频）。 */
			let activeSource = null;
			/** 对应段的 resolve：掐掉时按 null（没播完）结束，别让链一直挂着。 */
			let activeResolve = null;
			/** 流式 PCM 播放（ADR-063）：按时间轴排队，下一片接上一片，句间没有重启的空隙。 */
			let pcmIndex = -1;
			/** 下一片应该从 AudioContext 的哪个时刻开始（秒）。 */
			let pcmNextStart = 0;
			/** 已排进时间轴、还没播完的分片（打断时要全部停掉）。 */
			let pcmSources = [];
			/**
			* 整段模式下的「文字仍流式」（ADR-063 修订）：语音流式要让 TTS 拿到整段台词，
			* 但文字流式开关管的是 LLM 输出——此模式下气泡仍按 LLM 增量逐字长出。
			*/
			let speakWholeLive = false;
			/** 整段模式下已收到的台词（只在 speakWholeLive 时累积）。 */
			let speakWholeText = "";
			/** 懒创建 AudioContext + 分析器；被浏览器挂起时顺手恢复。 */
			function ensureAudio() {
				if (audioCtx) {
					if (audioCtx.state === "suspended") audioCtx.resume();
					return audioCtx;
				}
				try {
					const Ctor = window.AudioContext ?? window.webkitAudioContext;
					if (!Ctor) return null;
					audioCtx = new Ctor();
					lipsyncAnalyser = audioCtx.createAnalyser();
					lipsyncAnalyser.fftSize = 1024;
					lipsyncAnalyser.smoothingTimeConstant = .55;
					lipsyncData = new Uint8Array(new ArrayBuffer(lipsyncAnalyser.fftSize));
					lipsyncAnalyser.connect(audioCtx.destination);
				} catch {
					audioCtx = null;
				}
				return audioCtx;
			}
			/** 中止当前演绎（新触摸/状态切换/隐藏/卸载时调用）：连带掐掉正在播的音频与排队段。 */
			function stopSpeaking() {
				if (speakAbort !== null) {
					try {
						speakAbort.abort();
					} catch {}
					speakAbort = null;
				}
				speakSeq += 1;
				speakChain = Promise.resolve();
				const source = activeSource;
				const resolve = activeResolve;
				activeSource = null;
				activeResolve = null;
				if (source !== null) try {
					source.onended = null;
					source.stop();
				} catch {}
				for (const pcm of pcmSources) try {
					pcm.onended = null;
					pcm.stop();
				} catch {}
				pcmSources = [];
				pcmNextStart = 0;
				pcmIndex = -1;
				resolve?.(null);
				speakClauses = [];
				speakRevealed = -1;
				speakCues = /* @__PURE__ */ new Map();
				speakCueIndex = -1;
				pendingTags = null;
				motionQueue = [];
				const waiters = motionWaiters;
				motionWaiters = [];
				for (const wake of waiters) wake();
				clearStickyExpression();
				mouthLevel = 0;
			}
			/** 解码并播放一段音频（mp3 整段解码 → 播放 → 结束回调）。 */
			/** 播一段音频（驱动口型）。resolve 出这段的实际时长（秒）；播不了给 null。 */
			function playClip(base64, _mime) {
				const ctx = ensureAudio();
				const analyser = lipsyncAnalyser;
				if (!ctx || !analyser) return Promise.resolve(null);
				const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
				const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
				return new Promise((resolve) => {
					const finish = (seconds) => {
						activeResolve = null;
						resolve(seconds);
					};
					ctx.decodeAudioData(buffer, (decoded) => {
						try {
							const source = ctx.createBufferSource();
							source.buffer = decoded;
							source.connect(analyser);
							activeSource = source;
							activeResolve = finish;
							source.onended = () => {
								if (activeSource === source) activeSource = null;
								finish(decoded.duration);
							};
							source.start();
						} catch {
							finish(null);
						}
					}, () => resolve(null));
				});
			}
			/**
			* 排一片流式 PCM（ADR-063）：`16 bit 小端单声道` → AudioBuffer → 按时间轴无缝接上。
			* 不 await，晚到的分片只是排得更晚；`audio.end` 之后才等总时长。
			*/
			function schedulePcmChunk(base64, sampleRate) {
				const ctx = ensureAudio();
				const analyser = lipsyncAnalyser;
				if (!ctx || !analyser) return;
				const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
				const frames = Math.floor(bytes.byteLength / 2);
				if (frames <= 0) return;
				const buffer = ctx.createBuffer(1, frames, sampleRate);
				const channel = buffer.getChannelData(0);
				const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				for (let i = 0; i < frames; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(analyser);
				const startAt = Math.max(ctx.currentTime + .05, pcmNextStart);
				source.start(startAt);
				pcmNextStart = startAt + buffer.duration;
				pcmSources.push(source);
				source.onended = () => {
					const at = pcmSources.indexOf(source);
					if (at >= 0) pcmSources.splice(at, 1);
				};
			}
			/** 等已排进时间轴的流式分片全部播完（打断时由 speakSeq 兜底提前返回）。 */
			function waitPcmDone() {
				const ctx = audioCtx;
				if (!ctx || pcmSources.length === 0) return Promise.resolve();
				const remainingMs = Math.max(0, (pcmNextStart - ctx.currentTime) * 1e3) + 150;
				return new Promise((resolve) => {
					window.setTimeout(resolve, remainingMs);
				});
			}
			/** 把气泡文字补到第 `index` 段（含被跳过的段：合成失败也不能丢字）。 */
			function revealClausesUntil(index) {
				if (index <= speakRevealed) return;
				const visible = speakClauses.filter((item) => item.index <= index).map((item) => item.text).join("");
				if (!visible) return;
				speakRevealed = index;
				showBubbleNow(visible);
			}
			function revealAllClauses() {
				const last = speakClauses.length - 1;
				if (last >= 0) revealClausesUntil(speakClauses[last].index);
			}
			function clearPendingTap() {
				if (pendingDoublePart) {
					window.clearTimeout(pendingDoublePart.timer);
					pendingDoublePart = null;
				}
				if (deferredTap) {
					window.clearTimeout(deferredTap.timer);
					deferredTap = null;
				}
			}
			/**
			* 事件类触发开关（触摸/对话必触发，不在表内）。
			* 表内缺键按「开」处理：设置页只关显式关掉的那些。
			*/
			function eventTriggerEnabled(event) {
				return eventTriggers[event] !== false;
			}
			/** 当前策略配置：所有窗口都来自设置项，调度器自己不存默认值。 */
			function scheduleConfig() {
				return {
					aiEnabled,
					hidden,
					busy: speakingTurnActive,
					tapGapMs,
					eventGapMs: Math.round(aiMinIntervalSec * 1e3),
					sameKindWindowMs: Math.round(activityWindowSec * 1e3),
					mergeMax,
					triggerMode
				};
			}
			/**
			* 合并项 → 只报事实 `{event, count}`（同类合并计数，主事件扣掉已经算过的那一次）。
			* 文案由 Host 的剧本引擎用 `eventSceneText` 生成 —— 客户端不掺场景语言（ADR-049）。
			*/
			function mergeEvents(merged, mainEvent) {
				const out = [];
				for (const item of merged) {
					const count = item.event === mainEvent ? item.count - 1 : item.count;
					if (count <= 0) continue;
					const existing = out.find((entry) => entry.event === item.event);
					if (existing) existing.count += count;
					else out.push({
						event: item.event,
						count
					});
				}
				return out;
			}
			/** 连点窗口内的触摸：只留最后一次，到点补发（届时窗口已过，会直接触发）。 */
			function deferTrigger(input, delayMs) {
				if (deferredTap) window.clearTimeout(deferredTap.timer);
				deferredTap = {
					input,
					timer: window.setTimeout(() => {
						deferredTap = null;
						if (disposed) return;
						fireTrigger(input);
					}, delayMs + 30)
				};
			}
			/** 合并队列到点补发（只在空闲时发；忙的时候交给轮次结束那一刻）。 */
			function flushSchedule() {
				if (disposed || !aiEnabled || speakingTurnActive) return;
				const flushed = flushMerged(scheduleState);
				if (flushed.incoming === null) return;
				scheduleState = flushed.state;
				const mainEvent = flushed.incoming.event;
				startTurn({
					kind: "event",
					event: mainEvent,
					merged: mergeEvents(flushed.merged, mainEvent)
				});
			}
			/** 事件最小间隔到期后补发合并轮。 */
			function scheduleMergeFlush(nextAt) {
				if (mergeTimer !== void 0) window.clearTimeout(mergeTimer);
				const delay = Math.max(0, nextAt - Date.now());
				mergeTimer = window.setTimeout(() => {
					mergeTimer = void 0;
					flushSchedule();
				}, delay + 20);
			}
			/** 静默超时：任何真实触发都重排；0 = 关闭。 */
			function clearIdleTimer() {
				if (idleTimer !== void 0) {
					window.clearTimeout(idleTimer);
					idleTimer = void 0;
				}
			}
			function scheduleIdleTimer() {
				clearIdleTimer();
				if (hidden || !(idleTimeoutSec > 0)) return;
				idleTimer = window.setTimeout(() => {
					idleTimer = void 0;
					if (disposed || !aiEnabled) return;
					fireTrigger({ kind: "idle" });
				}, idleTimeoutSec * 1e3 + IDLE_TIMER_SLACK_MS);
			}
			/**
			* 唯一触发入口（ADR-047）：事件与互动**永远先到这里**，由策略表决定怎么处理。
			* - run：立刻开一轮（带上一轮攒下的合并项）；
			* - defer：连点窗口内，等窗口过了再发；
			* - merge：并进下一次触发（同类窗口 / 最小间隔 / 上一轮没演完），丢弃的每一条都有日志；
			* - drop：真的不发（AI 关、页面隐藏、场景开关关、静默撞上进行中的一轮）。
			* `force` 只给调试面板「场景演示」用：显式绕过策略表，也不改窗口状态。
			*/
			function fireTrigger(input, options) {
				const label = input.kind === "event" ? `${input.kind}:${input.event ?? "-"}` : input.kind;
				if (options?.force === true) {
					conPush("trigger", `force | ${label}`);
					scheduleIdleTimer();
					startTurn(input);
					return;
				}
				const switchOff = input.kind === "event" && input.event !== void 0 && !eventTriggerEnabled(input.event);
				const { decision, state } = dispatchTrigger(scheduleState, {
					kind: input.kind,
					event: input.event,
					switchOff
				}, scheduleConfig(), Date.now());
				scheduleState = state;
				switch (decision.action) {
					case "run":
						scheduleIdleTimer();
						startTurn({
							...input,
							merged: mergeEvents(decision.merged, input.event)
						});
						return;
					case "defer":
						conPush("trigger", `deferred | ${label} | ${decision.reason} ${decision.delayMs}ms`);
						deferTrigger(input, decision.delayMs);
						return;
					case "merge":
						conPush("trigger", `merged | ${label} | ${decision.reason}`);
						if (decision.overflowed > 0) conPush("trigger", `merge overflow | 丢掉最旧 ${decision.overflowed} 条`);
						if (decision.nextAt > 0) scheduleMergeFlush(decision.nextAt);
						return;
					case "drop":
						clientLog("info", `trigger dropped | ${label} | ${decision.reason}`);
						conPush("trigger", `dropped | ${label} | ${decision.reason}`);
						return;
				}
			}
			/** 开一轮：interrupt 模式作废旧轮；queue 模式下轮次结束时补发合并队列。 */
			function startTurn(input) {
				if (hidden) return Promise.resolve(null);
				conPushJson("trigger", input);
				if (triggerMode === "interrupt") stopSpeaking();
				speakingTurnActive = true;
				setBubbleHold(true);
				return requestSpeak(input).finally(() => {
					speakingTurnActive = false;
					setBubbleHold(false);
					flushSchedule();
				});
			}
			/** canvas 的视口 rect 缓存：pointermove 每次都要用，不能每次读布局。 */
			let canvasRectCache = null;
			/** 鼠标跟随范围（% 模型尺寸，0 = 只在模型框内跟随，spec §4）。 */
			let focusRangePct = 100;
			/** 指针当前是否落在跟随范围内；出范围时只复位一次，避免每帧重复写。 */
			let focusInRange = true;
			/** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
			function applyFocus(clientX, clientY) {
				if (!model || !canvas) return;
				if (!canvasRectCache) try {
					canvasRectCache = canvas.getBoundingClientRect();
				} catch {
					return;
				}
				const localX = clientX - canvasRectCache.left;
				const localY = clientY - canvasRectCache.top;
				let bounds;
				try {
					bounds = model.getBounds?.();
				} catch {
					bounds = void 0;
				}
				if (bounds && bounds.width > 0 && bounds.height > 0) {
					const padX = bounds.width * focusRangePct / 100;
					const padY = bounds.height * focusRangePct / 100;
					if (!(localX >= bounds.x - padX && localX <= bounds.x + bounds.width + padX && localY >= bounds.y - padY && localY <= bounds.y + bounds.height + padY)) {
						if (focusInRange) {
							focusInRange = false;
							model.internalModel?.focusController?.focus(0, 0, true);
						}
						return;
					}
					focusInRange = true;
				}
				model.focus(localX, localY);
			}
			/** 临时表情（AI 标签 / 设置页预览）是否还在保持窗口内。 */
			function expressionHoldActive() {
				return tempExpressions.length > 0 && Date.now() < tempExpressionUntil;
			}
			/**
			* 一次性表情（ADR-054）：从表情 id 里挑出用动作实现的瞬时表情（如眨眼），
			* 返回对应动作组名；普通常驻表情返回空数组。动作走串行队列，播一遍即结束。
			*/
			function oneShotExpressionMotions(ids) {
				const motions = [];
				for (const id of ids) {
					const motion = expressionOneShotMotion(id);
					if (motion) motions.push(motion);
				}
				return motions;
			}
			/** 当前 id 列表里还需要常驻保持的表情（剔除一次性表情）。 */
			function persistentExpressions(ids) {
				return ids.filter((id) => expressionOneShotMotion(id) === void 0);
			}
			/**
			* 演出一段临时表情：写目标值 + 这段时间内暂停鼠标跟随。
			* 演出（动作/表情）期间让头眼固定在正前方，避免跟随不断叠加到关键帧上；
			* 表情窗口结束、动作 motionFinish 时再恢复跟随（`releaseFocusSuppression`）。
			*/
			function holdTemporaryExpression(ids, sticky = false) {
				tempExpressions = [...ids];
				tempExpressionUntil = sticky ? Number.POSITIVE_INFINITY : Date.now() + TAG_EXPRESSION_HOLD_MS;
				repaintDebugExpressions?.();
				focusSuppressed = true;
				try {
					model?.internalModel?.focusController?.focus(0, 0, true);
				} catch {}
				refreshExpressionTargets();
			}
			/** 本轮结束：撤掉 sticky 表情，恢复常态（ADR-048 P3）。 */
			function clearStickyExpression() {
				if (tempExpressionUntil !== Number.POSITIVE_INFINITY) return;
				tempExpressions = [];
				tempExpressionUntil = 0;
				repaintDebugExpressions?.();
				refreshExpressionTargets();
				releaseFocusSuppression();
			}
			/** 解除非 idle 动作期间的 focus 抑制；若有最近指针位置则立即恢复跟随。 */
			function releaseFocusSuppression() {
				if (!focusSuppressed) return;
				if (interactionActive || expressionHoldActive()) return;
				focusSuppressed = false;
				if (model && lastPointerClient && !dragging && enabled && !hidden && windowFocused) applyFocus(lastPointerClient.x, lastPointerClient.y);
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
			/** 待机小动作调度：一次只挂一个 setTimeout（不轮询、空闲无开销），
			* 触发时只有「确实是 idle、没在互动/预览、页面可见」才播，否则延后重试。 */
			function clearIdleMicro() {
				if (idleMicroTimer !== null) {
					window.clearTimeout(idleMicroTimer);
					idleMicroTimer = null;
				}
			}
			function scheduleIdleMicro(delay) {
				clearIdleMicro();
				if (!idleMotionEnabled || !model) return;
				const ms = delay ?? IDLE_MICRO_MIN_MS + Math.random() * 9e3;
				idleMicroTimer = window.setTimeout(() => {
					idleMicroTimer = null;
					playIdleMicro();
				}, ms);
			}
			function playIdleMicro() {
				if (!model || !idleMotionEnabled) return;
				if (previewActive || interactionActive || lastState !== "idle" || document.visibilityState === "hidden") {
					scheduleIdleMicro(IDLE_MICRO_RETRY_MS);
					return;
				}
				const name = IDLE_MICRO_MOTIONS[Math.floor(Math.random() * IDLE_MICRO_MOTIONS.length)];
				startMotionWithPriority([name], MotionPriority.IDLE, {
					suppressFocus: true,
					isInteraction: true
				});
				scheduleIdleMicro();
			}
			/** MotionManager.motionFinish：动作真正播完。互动结束后恢复当前状态动作并解除 focus 抑制。
			* 注意该事件在库内部 state.complete()/自动回 idle 之前同步触发，恢复动作需延到微任务，
			* 避免在 MotionManager.update 中间重入修改 MotionState。 */
			function handleMotionFinish() {
				const waiters = motionWaiters;
				motionWaiters = [];
				for (const wake of waiters) wake();
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
					if (wasInteraction && gen === interactionGen && !interactionActive && lastState === "idle") startMotionWithPriority(["Idle"], MotionPriority.IDLE, {
						suppressFocus: false,
						isInteraction: false
					});
				});
			}
			/** 上一次应用过的快照签名（display + config）：一致就跳过整段 applyConfig。 */
			let viewSignature = "";
			/** 已播过的活动序号：SSE 每帧都带同一个 activity，靠它去重（不重复播）。 */
			let lastActivitySeq = 0;
			/**
			* 一次性活动（工具执行 / 审批结果 / 会话开关 / 子代理进出，ADR-036）→
			* ADR-037 起只作为「触发场景」交给 AI：动作/表情/台词全由模型选，本函数只去重 + 触发。
			*/
			function applyActivity(activity) {
				if (!activity || typeof activity.seq !== "number") return;
				if (activity.seq <= lastActivitySeq) return;
				lastActivitySeq = activity.seq;
				clientLog("info", `activity | ${activity.kind}`);
				fireTrigger({
					kind: "event",
					event: activity.kind
				});
			}
			function applyState(next) {
				const state = next?.state ?? "idle";
				applyActivity(next?.activity);
				if (state !== lastState) {
					lastState = state;
					if (state !== "idle") fireTrigger({
						kind: "event",
						event: state
					});
				}
				syncDebugStatusText();
			}
			/** 调试面板状态文本：状态/部位/位置/画布尺寸 + 可见轮廓偏移与视口（ADR-059，用于排查移动范围）。 */
			function syncDebugStatusText() {
				if (!debugTextEl) return;
				const state = view?.state ?? "idle";
				const offset = visualOffsetPx();
				const logical = logicalCanvasSize();
				const vv = window.visualViewport;
				const vvInfo = vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : "-";
				const r = box?.getBoundingClientRect();
				const boxInfo = r ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : "-";
				const vis = visualMeasured ? `vis: ${Math.round(offset.x)},${Math.round(offset.y)} px  bbox: ${Math.round(visualBoxWFrac * logical.width)}x${Math.round(visualBoxHFrac * logical.height)}` : "vis: n/a";
				const s = uiScale();
				const centerX = Math.round(window.innerWidth - s * (pos.right + logical.width / 2));
				const centerY = Math.round(window.innerHeight - s * (pos.bottom + logical.height / 2));
				debugTextEl.textContent = `agent: ${view?.agent ?? "-"}  pet: ${state}  v${view?.version ?? "-"}\nparts: ${touchParts.length}  expr: ${desiredExpressions().join("+") || "none"}\npos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}\nbounds: ${Math.round(baseModelW)}x${Math.round(baseModelH)}  canvas: ${canvas?.width ?? 0}x${canvas?.height ?? 0}\nvp: ${window.innerWidth}x${window.innerHeight}  vv: ${vvInfo}  s: ${uiScale().toFixed(3)}\nbox: ${boxInfo}\n${vis}  c: ${centerX},${centerY}`;
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
			/** 可见轮廓中心相对模型画布中心的偏移（逻辑画布 CSS px；未测得时为 0，ADR-059）。 */
			function visualOffsetPx() {
				const { width, height } = logicalCanvasSize();
				return {
					x: visualOffsetXFrac * width,
					y: visualOffsetYFrac * height
				};
			}
			/**
			* 页面 UI 缩放倍数（视觉 CSS px ÷ 逻辑画布 px）。
			* 某些外壳（如移动端 DSH 页面）会给整页施加 CSS `zoom`/等价缩放：此时
			* `getBoundingClientRect()` 返回视觉坐标，而画布逻辑尺寸、`right/bottom` 仍是缩放后的
			* CSS px，两者差一个倍数。拖动夹取、归位、捕捉都按「视觉坐标」计算，必须先归一化，
			* 否则角色会被提前拦住（ADR-059）。无缩放/测量不到时为 1，行为与之前一致。
			*/
			function uiScale() {
				try {
					const rectW = canvas?.getBoundingClientRect().width ?? 0;
					const logical = logicalCanvasSize().width;
					if (rectW > 0 && logical > 0) {
						const s = rectW / logical;
						if (Number.isFinite(s) && s > .05) return s;
					}
				} catch {}
				return 1;
			}
			/**
			* 测量角色可见轮廓（ADR-059）：把当前帧渲染到与逻辑画布同尺寸的 RenderTexture，
			* 读回 alpha 找包围盒，得到「可见轮廓中心」相对画布中心的偏移。
			* 画布四周有动作/物理留白（spec §7），可见角色中心 ≠ 画布矩形中心——只按画布中心夹取时，
			* 左/上方向会先碰到画布边，看起来「拖不到一半出画」。
			*/
			function measureVisualBounds() {
				if (!app || !model) return false;
				const logical = logicalCanvasSize();
				const w = Math.round(logical.width);
				const h = Math.round(logical.height);
				if (!(w > 0 && h > 0)) return false;
				const gl = app.renderer.gl;
				if (!gl) return false;
				const rt = PIXI.RenderTexture.create({
					width: w,
					height: h,
					resolution: 1
				});
				try {
					app.renderer.render(app.stage, {
						renderTexture: rt,
						clear: true
					});
					app.renderer.renderTexture?.bind(rt);
					const pixels = new Uint8Array(w * h * 4);
					gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
					let minX = w;
					let minY = h;
					let maxX = -1;
					let maxY = -1;
					for (let row = 0; row < h; row += 1) {
						const y = h - 1 - row;
						const base = row * w * 4;
						for (let x = 0; x < w; x += 1) {
							if (pixels[base + x * 4 + 3] <= 8) continue;
							if (x < minX) minX = x;
							if (x > maxX) maxX = x;
							if (y < minY) minY = y;
							if (y > maxY) maxY = y;
						}
					}
					if (maxX < minX || maxY < minY) return false;
					visualOffsetXFrac = ((minX + maxX + 1) / 2 - w / 2) / w;
					visualOffsetYFrac = ((minY + maxY + 1) / 2 - h / 2) / h;
					visualBoxWFrac = (maxX - minX + 1) / w;
					visualBoxHFrac = (maxY - minY + 1) / h;
					visualMeasured = true;
					return true;
				} catch {
					return false;
				} finally {
					try {
						app.renderer.renderTexture?.bind(null);
					} catch {}
					rt.destroy(true);
				}
			}
			/** 等首帧渲染完再测量可见轮廓（ticker 首帧为准，900ms 兜底）；测得后按可见轮廓重排位置。 */
			function scheduleVisualMeasure() {
				if (visualMeasurePending) return;
				visualMeasurePending = true;
				const run = () => {
					if (!visualMeasurePending || disposed) return;
					visualMeasurePending = false;
					if (!measureVisualBounds()) return;
					clampPosToViewport();
					applyPosToBox();
					updateBubblePosition();
					syncDebugStatusText();
				};
				try {
					app?.ticker.addOnce(run);
				} catch {}
				window.setTimeout(run, 900);
			}
			/**
			* 宠物画布（显示区）的几何中心必须留在视口内：允许一半移出窗口，但拖不丢、能拖回来。
			* right ∈ [−W/2, innerWidth/s − W/2]，bottom 同理；s 为页面 UI 缩放（uiScale()），
			* 未缩放（s=1）时即 spec §4 的原始语义。ADR-060。
			*/
			function clampPosToViewport() {
				const { width: w, height: h } = logicalCanvasSize();
				if (!(w > 0 && h > 0)) return;
				const halfW = w / 2;
				const halfH = h / 2;
				const s = uiScale();
				pos.right = Math.min(window.innerWidth / s - halfW, Math.max(-halfW, pos.right));
				pos.bottom = Math.min(window.innerHeight / s - halfH, Math.max(-halfH, pos.bottom));
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
			* 目标中心点 = (视口宽 × homeRight%、视口高 × homeBottom%)（相对右下角量）。
			* 中心点按可见轮廓算（ADR-059）：可见中心距右 = right + W/2 - offsetX、距下 = bottom + H/2 - offsetY，
			* 因此 right = 目标中心距右 - W/2 + offsetX、bottom = 目标中心距下 - H/2 + offsetY，最后 clamp。
			*/
			function homePositionFromConfig() {
				const { width: w, height: h } = logicalCanvasSize();
				const cfg = view?.config;
				if (!cfg || !(w > 0 && h > 0)) return;
				const homeRightPct = Number.isFinite(cfg.homeRight) ? cfg.homeRight : 10;
				const homeBottomPct = Number.isFinite(cfg.homeBottom) ? cfg.homeBottom : 0;
				const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
				const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
				if (!(viewportW > 0 && viewportH > 0)) return;
				const s = uiScale();
				pos.right = viewportW * homeRightPct / 100 / s - w / 2;
				pos.bottom = viewportH * homeBottomPct / 100 / s - h / 2;
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
				clearIdleMicro();
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
				visualOffsetXFrac = 0;
				visualOffsetYFrac = 0;
				visualBoxWFrac = 0;
				visualBoxHFrac = 0;
				visualMeasured = false;
				visualMeasurePending = false;
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
				debugPanelBottomLogical = NaN;
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
					buildBar();
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
					scheduleIdleMicro();
					const internal = loaded.internalModel;
					if (internal && typeof internal.update === "function") {
						const originalUpdate = internal.update.bind(internal);
						internal.update = (dt = 1 / 60, now = performance.now()) => {
							applyExpressionParams(internal.coreModel, dt);
							applyLipsync(internal.coreModel, dt);
							const result = originalUpdate(dt, now);
							applySpeakingBody(internal.coreModel);
							return result;
						};
					}
					refreshDebugMotionGroups();
					fitModel(pos.size);
					if (!(baseModelW > 0 && baseModelH > 0)) try {
						app.ticker.addOnce(() => fitModel(pos.size));
					} catch {}
					scheduleVisualMeasure();
					if (model) startMotionWithPriority(["Idle"], MotionPriority.IDLE, {
						suppressFocus: false,
						isInteraction: false
					});
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
				barKey = "";
				barW = 0;
				barH = 0;
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
				if (barEl) {
					const barSig = `${key}|${barPosition}|${barOffset}|${pos.size}|${barW}x${barH}`;
					if (barSig !== barKey) {
						barKey = barSig;
						updateBarPosition(bounds);
					}
				}
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
			function bindHitEvents(el, part) {
				el.addEventListener("pointerdown", handlePointerDown);
				el.addEventListener("pointermove", handlePointerMove);
				el.addEventListener("pointerup", handlePointerUp);
				el.addEventListener("pointercancel", () => {
					down = null;
					dragging = false;
				});
				el.addEventListener("pointerenter", syncHoverFromPointer);
				el.addEventListener("pointermove", syncHoverFromPointer);
				el.addEventListener("pointerleave", syncHoverFromPointer);
			}
			/** 按指针坐标取当前命中部位（与点击路径同一套：parts 顺序 = 图层顺序，上层优先）。 */
			function hoverPartAt(clientX, clientY) {
				if (!canvas || !model) return null;
				const bounds = model.getBounds?.();
				if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return null;
				if (!canvasRectCache) try {
					canvasRectCache = canvas.getBoundingClientRect();
				} catch {
					return null;
				}
				const rect = canvasRectCache;
				const ratio = pointToBoundsRatio(clientX - rect.left, clientY - rect.top, bounds);
				if (!ratio) return null;
				return hitTestTouchParts(editState?.parts ?? touchParts, ratio.nx, ratio.ny);
			}
			/** 指针进入/移动/离开命中区时同步悬停计时器（原地不动也保持计时）。 */
			function syncHoverFromPointer(e) {
				if (down) return;
				const part = hoverPartAt(e.clientX, e.clientY);
				if (!part) {
					if (hoverState !== null) clearHover();
					return;
				}
				if (hoverState?.partId === part.id) return;
				if ((part.interactions ?? []).filter((item) => item.trigger === "hold").length === 0) {
					if (hoverState !== null) clearHover();
					return;
				}
				beginHover(part);
			}
			function beginHover(part) {
				const holds = (part.interactions ?? []).filter((item) => item.trigger === "hold");
				if (holds.length === 0) return;
				clearHover();
				const hold = [...holds].sort((a, b) => a.holdMs - b.holdMs)[0];
				const holdMs = hold.holdMs;
				const timer = window.setTimeout(() => {
					if (hoverState === null) return;
					hoverState = null;
					if (aiEnabled && ttsEnabled) ensureAudio();
					clientLog("info", `tap | ${part.name} | ${hold.name}(hold 悬停) ${holdMs}ms`);
					fireTrigger({
						kind: "tap",
						part: part.name,
						interaction: hold.name
					});
				}, holdMs);
				hoverState = {
					partId: part.id,
					timer,
					fired: false
				};
			}
			/** 按当前部位 box 重建命中层 div；无任何 box 时回退为覆盖模型包围盒的一个命中区。 */
			function rebuildHitBoxes() {
				if (!hitLayer) return;
				hitLayer.textContent = "";
				hitBoxEntries = [];
				clearHover();
				const entries = [];
				for (const part of activeTouchParts()) for (const box of part.boxes) entries.push({
					part,
					box
				});
				if (entries.length === 0) entries.push({
					part: {
						id: "",
						name: "",
						boxes: []
					},
					box: {
						left: 0,
						top: 0,
						right: 1,
						bottom: 1
					}
				});
				for (const entry of entries) {
					const el = document.createElement("div");
					el.style.cssText = "position:absolute;pointer-events:auto;background:transparent;touch-action:none";
					bindHitEvents(el, entry.part);
					hitLayer.appendChild(el);
					hitBoxEntries.push({
						el,
						box: entry.box,
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
			/** 面板可用尺寸范围（视口内留 DEBUG_PANEL_MARGIN 边距）。 */
			function debugPanelSizeBounds() {
				const viewportW = window.innerWidth || document.documentElement?.clientWidth || 0;
				const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0;
				return {
					minW: DEBUG_PANEL_MIN_W,
					minH: DEBUG_PANEL_MIN_H,
					maxW: Math.max(DEBUG_PANEL_MIN_W, viewportW - 16),
					maxH: Math.max(DEBUG_PANEL_MIN_H, viewportH - 16)
				};
			}
			/** 把几何夹进视口：先收敛宽高，再把整块面板拉回 DEBUG_PANEL_MARGIN 边距内（纯视口坐标，不碰层坐标）。 */
			function clampDebugPanelGeometry(geometry) {
				const { minW, minH, maxW, maxH } = debugPanelSizeBounds();
				const viewportW = window.innerWidth || document.documentElement?.clientWidth || 0;
				const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0;
				const width = Math.round(Math.min(Math.max(geometry.width, minW), maxW));
				const height = Math.round(Math.min(Math.max(geometry.height, minH), maxH));
				const maxLeft = Math.max(DEBUG_PANEL_MARGIN, viewportW - DEBUG_PANEL_MARGIN - width);
				const maxTop = Math.max(DEBUG_PANEL_MARGIN, viewportH - DEBUG_PANEL_MARGIN - height);
				return {
					left: Math.round(Math.min(Math.max(geometry.left, DEBUG_PANEL_MARGIN), maxLeft)),
					top: Math.round(Math.min(Math.max(geometry.top, DEBUG_PANEL_MARGIN), maxTop)),
					width,
					height
				};
			}
			/** 读一次本地记住的手动几何（隐私模式/无 localStorage 视为没记过）。 */
			function readDebugPanelGeometry() {
				if (debugPanelGeometryLoaded) return debugPanelManual;
				debugPanelGeometryLoaded = true;
				try {
					const raw = window.localStorage.getItem(DEBUG_PANEL_STORE_KEY);
					if (!raw) return null;
					const parsed = JSON.parse(raw);
					const values = [
						parsed.left,
						parsed.top,
						parsed.width,
						parsed.height
					].map((value) => Number(value));
					if (!values.every((value) => Number.isFinite(value))) return null;
					debugPanelManual = {
						left: values[0],
						top: values[1],
						width: values[2],
						height: values[3]
					};
				} catch {}
				return debugPanelManual;
			}
			/** 手动几何写回本地；null = 清除记录（回到自动跟随）。 */
			function writeDebugPanelGeometry() {
				try {
					if (debugPanelManual) window.localStorage.setItem(DEBUG_PANEL_STORE_KEY, JSON.stringify(debugPanelManual));
					else window.localStorage.removeItem(DEBUG_PANEL_STORE_KEY);
				} catch {}
			}
			/** 面板当前几何（视口 px）：手动模式取记录值，自动模式量一次 rect（拖动起始时无缝接管）。 */
			function currentDebugPanelGeometry() {
				if (debugPanelManual && !debugPanelCollapsed) return { ...debugPanelManual };
				if (!debugEl) return null;
				let rect;
				try {
					rect = debugEl.getBoundingClientRect();
				} catch {
					return null;
				}
				if (!(rect.width > 0 && rect.height > 0)) return null;
				return {
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height
				};
			}
			/** 折叠态实际渲染尺寸（只留标题栏）：水平/垂直夹取都用它，不能用手动几何里的展开宽高。 */
			function collapsedPanelSize() {
				if (!debugEl) return {
					width: DEBUG_PANEL_MIN_W,
					height: DEBUG_PANEL_COLLAPSED_H
				};
				const width = debugEl.offsetWidth;
				const height = debugEl.offsetHeight;
				return {
					width: width > 0 ? width : DEBUG_PANEL_MIN_W,
					height: height > 0 ? height : DEBUG_PANEL_COLLAPSED_H
				};
			}
			/** 折叠态的位置夹取：按实际小条尺寸把面板留在视口内（不套用 320×400 的最小宽高）。 */
			function clampCollapsedPanelPosition(left, top) {
				const s = uiScale();
				const { width, height } = collapsedPanelSize();
				const visualW = width * s;
				const visualH = height * s;
				const maxLeft = Math.max(DEBUG_PANEL_MARGIN, window.innerWidth - visualW - DEBUG_PANEL_MARGIN);
				const maxTop = Math.max(DEBUG_PANEL_MARGIN, window.innerHeight - visualH - DEBUG_PANEL_MARGIN);
				return {
					left: Math.round(Math.min(Math.max(left, DEBUG_PANEL_MARGIN), maxLeft)),
					top: Math.round(Math.min(Math.max(top, DEBUG_PANEL_MARGIN), maxTop))
				};
			}
			/** 把手动几何落到面板样式：视口坐标换算成 layer 内坐标再写，并记录顶部/底部供气泡避让。 */
			function applyDebugPanelGeometry(geometry) {
				if (!debugEl) return;
				const rect = layerRect();
				const s = uiScale();
				const originLeft = rect ? rect.left : 0;
				const originTop = rect ? rect.top : 0;
				const layerLeft = (geometry.left - originLeft) / s;
				const layerTop = (geometry.top - originTop) / s;
				debugEl.style.left = `${Math.round(layerLeft)}px`;
				debugEl.style.top = `${Math.round(layerTop)}px`;
				if (!debugPanelCollapsed) {
					const layerWidth = geometry.width / s;
					const layerHeight = geometry.height / s;
					debugEl.style.width = `${Math.round(layerWidth)}px`;
					debugEl.style.height = `${Math.round(layerHeight)}px`;
					debugEl.style.maxHeight = "none";
					panelSizeCache = {
						width: Math.round(layerWidth),
						height: Math.round(layerHeight)
					};
				} else panelSizeCache = null;
				const appliedHeight = (debugPanelCollapsed ? DEBUG_PANEL_COLLAPSED_H : geometry.height) / s;
				debugPanelTopLogical = layerTop;
				debugPanelBottomLogical = layerTop + appliedHeight;
			}
			/** 恢复自动跟随（双击标题栏）：清掉手动几何与本地记录，重新按模型定位。 */
			function resetDebugPanelGeometry() {
				if (!debugPanelManual) return;
				debugPanelManual = null;
				writeDebugPanelGeometry();
				invalidateLayout();
				syncDebugPanelWidth();
				updateDebugPanelPosition();
			}
			/**
			* 折叠 / 展开调试面板（标题栏右上角按钮，ADR-055）：折叠只留标题栏，
			* 展开后恢复原来的手动几何或按视口算出的默认尺寸。
			*/
			function setDebugPanelCollapsed(collapsed) {
				debugPanelCollapsed = collapsed;
				if (debugFoldEl) {
					debugFoldEl.textContent = collapsed ? "▸" : "▾";
					debugFoldEl.title = collapsed ? "展开调试面板" : "折叠调试面板";
					debugFoldEl.setAttribute("aria-label", debugFoldEl.title);
					debugFoldEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
				}
				if (debugBodyEl) debugBodyEl.style.display = collapsed ? "none" : "flex";
				for (const grip of debugGrips) grip.style.display = collapsed ? "none" : "";
				invalidateLayout();
				syncDebugPanelWidth();
				updateDebugPanelPosition();
			}
			/**
			* 面板拖动/缩放（spec §2 / ADR-044）：mode='move' 为标题栏拖动，否则按四角缩放。
			* 拖动过程只改内存与样式（不写盘、不触发重排循环），松手才落 localStorage。
			*/
			function bindDebugPanelPointer(handle, mode) {
				handle.addEventListener("pointerdown", (event) => {
					if (event.button !== 0) return;
					if (mode === "move" && event.target?.closest("button")) return;
					const start = currentDebugPanelGeometry();
					if (!start) return;
					event.preventDefault();
					event.stopPropagation();
					const startX = event.clientX;
					const startY = event.clientY;
					let dragging = false;
					const onMove = (moveEvent) => {
						const dx = moveEvent.clientX - startX;
						const dy = moveEvent.clientY - startY;
						if (!dragging && Math.abs(dx) + Math.abs(dy) < 2) return;
						dragging = true;
						let next;
						if (mode === "move") next = {
							...start,
							left: start.left + dx,
							top: start.top + dy
						};
						else {
							const { minW, minH, maxW, maxH } = debugPanelSizeBounds();
							const right = start.left + start.width;
							const bottom = start.top + start.height;
							const rawWidth = mode === "nw" || mode === "sw" ? start.width - dx : start.width + dx;
							const rawHeight = mode === "nw" || mode === "ne" ? start.height - dy : start.height + dy;
							const width = Math.round(Math.min(Math.max(rawWidth, minW), maxW));
							const height = Math.round(Math.min(Math.max(rawHeight, minH), maxH));
							next = {
								left: mode === "nw" || mode === "sw" ? right - width : start.left,
								top: mode === "nw" || mode === "ne" ? bottom - height : start.top,
								width,
								height
							};
						}
						if (mode === "move" && debugPanelCollapsed) {
							const pos = clampCollapsedPanelPosition(next.left, next.top);
							debugPanelManual = {
								left: pos.left,
								top: pos.top,
								width: debugPanelManual?.width ?? DEBUG_PANEL_MIN_W,
								height: debugPanelManual?.height ?? DEBUG_PANEL_MIN_H
							};
						} else debugPanelManual = clampDebugPanelGeometry(next);
						applyDebugPanelGeometry(debugPanelManual);
					};
					const finish = () => {
						window.removeEventListener("pointermove", onMove);
						window.removeEventListener("pointerup", finish);
						window.removeEventListener("pointercancel", finish);
						if (!dragging) return;
						writeDebugPanelGeometry();
						invalidateLayout();
					};
					window.addEventListener("pointermove", onMove);
					window.addEventListener("pointerup", finish);
					window.addEventListener("pointercancel", finish);
				});
			}
			/**
			* 调试面板尺寸（浮层不占布局，spec §2 / ADR-055）：
			* - 折叠态：宽高都交给内容撑开（只留标题栏）；
			* - 手动几何（拖过四角）：完全由用户决定（ADR-044）；
			* - 自动跟随：按视口给足默认尺寸（宽 320–460、高 400–640 且不超过视口 70%），
			*   内容区自适应，控制台吃满剩余高度，面板本身不出现滚动条。
			*/
			function syncDebugPanelWidth() {
				if (!debugEl) return;
				if (debugPanelCollapsed) {
					debugEl.style.minWidth = "0";
					debugEl.style.minHeight = "0";
					debugEl.style.width = "auto";
					debugEl.style.height = "auto";
					debugEl.style.maxHeight = "none";
					panelSizeCache = null;
					return;
				}
				debugEl.style.minWidth = `${DEBUG_PANEL_MIN_W}px`;
				debugEl.style.minHeight = `${DEBUG_PANEL_MIN_H}px`;
				if (debugPanelManual) {
					applyDebugPanelGeometry(clampDebugPanelGeometry(debugPanelManual));
					return;
				}
				const maxW = Math.max(DEBUG_PANEL_MIN_W, window.innerWidth - 16);
				const maxH = Math.max(DEBUG_PANEL_MIN_H, window.innerHeight - 16);
				const width = Math.min(Math.max(320, Math.round(window.innerWidth - 32)), Math.min(460, maxW));
				const height = Math.min(Math.max(DEBUG_PANEL_MIN_H, Math.round(window.innerHeight * .7)), Math.min(640, maxH));
				debugEl.style.width = `${width}px`;
				debugEl.style.height = `${height}px`;
				debugEl.style.boxSizing = "border-box";
				debugEl.style.maxHeight = "none";
				panelSizeCache = null;
			}
			/**
			* 调试面板定位（spec §2）：
			* - 自动模式（默认）：浮在模型包围盒**上方**（不覆盖角色），允许伸出画布留白/画布上边缘
			*   （逻辑 top 可为负），但整体保持在视口内。先把 bounds / 面板尺寸换算成视觉 px：
			*   期望视口 top = rect.top + s·bounds.y − 8s − 面板视觉高，clamp 到视口内，
			*   再换算回 petLayer 层 CSS px = (clampedTop − rect.top) / s（页面缩放，ADR-059/060）；水平同理。
			* - 手动模式（用户拖过标题栏/角）：位置与大小都由用户决定，只在视口变化时重新夹回屏幕内。
			* 每帧由命中层 rAF 调用；拖动人物时 handlePointerMove 也同步调用，避免等 rAF 节流后面板回跳。
			*/
			function updateDebugPanelPosition(boundsArg) {
				debugPanelTopLogical = NaN;
				debugPanelBottomLogical = NaN;
				if (!debugEl || !petLayer || debugEl.parentNode !== petLayer || !model) return;
				if (debugPanelManual) {
					if (debugPanelCollapsed) {
						const pos = clampCollapsedPanelPosition(debugPanelManual.left, debugPanelManual.top);
						applyDebugPanelGeometry({
							...debugPanelManual,
							left: pos.left,
							top: pos.top
						});
					} else applyDebugPanelGeometry(clampDebugPanelGeometry(debugPanelManual));
					return;
				}
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
				const rect = layerRect();
				if (!rect) return;
				const s = uiScale();
				const panelVisualW = panelSizeCache.width * s;
				const panelVisualH = panelSizeCache.height * s;
				const modelTopVisual = rect.top + s * bounds.y;
				const maxViewportTop = Math.max(DEBUG_PANEL_MARGIN, window.innerHeight - panelVisualH - DEBUG_PANEL_MARGIN);
				const viewportTop = Math.min(Math.max(modelTopVisual - 8 * s - panelVisualH, DEBUG_PANEL_MARGIN), maxViewportTop);
				const modelCenterVisual = rect.left + s * (bounds.x + bounds.width / 2);
				const maxViewportLeft = Math.max(DEBUG_PANEL_MARGIN, window.innerWidth - panelVisualW - DEBUG_PANEL_MARGIN);
				const viewportLeft = Math.min(Math.max(modelCenterVisual - panelVisualW / 2, DEBUG_PANEL_MARGIN), maxViewportLeft);
				const top = (viewportTop - rect.top) / s;
				const left = (viewportLeft - rect.left) / s;
				debugEl.style.left = `${left}px`;
				debugEl.style.top = `${top}px`;
				debugPanelTopLogical = top;
				debugPanelBottomLogical = top + panelVisualH / s;
			}
			/** 是否在记录（关闭即清空缓冲区与 DOM）。 */
			let conRecording = false;
			/** 控制台滚动区（面板重建时随之重建）。 */
			let conBody = null;
			/** 记录行上限：超出从头部丢弃，避免长时间开启吃内存。 */
			const CON_MAX_LINES = 300;
			/** 单行原文字符上限（完整请求报文含 system 提示词，可能上万字符）。 */
			const CON_LINE_MAX = 2e4;
			/** 控制台行高（px）：font 11px 与 scrollTop 计算共用同一值。 */
			const CON_LINE_HEIGHT = 16;
			/** 「复制」按钮的临时文案计时器（只在点过按钮后短暂存在，面板关闭/再次点击即清）。 */
			let conCopyTimer = 0;
			/** 复制文本到剪贴板：优先 Clipboard API（https / localhost 才有），失败回落到 textarea + execCommand。 */
			async function copyToClipboard(text) {
				try {
					if (navigator.clipboard?.writeText) {
						await navigator.clipboard.writeText(text);
						return true;
					}
				} catch {}
				try {
					const area = document.createElement("textarea");
					area.value = text;
					area.setAttribute("readonly", "");
					area.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
					document.body.appendChild(area);
					area.select();
					const ok = document.execCommand("copy");
					document.body.removeChild(area);
					return ok;
				} catch {
					return false;
				}
			}
			function conClock() {
				const now = /* @__PURE__ */ new Date();
				const pad = (n, w = 2) => String(n).padStart(w, "0");
				return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
			}
			/** 追加一条原始报文（未开启记录时直接丢弃）。 */
			function conPush(tag, text) {
				if (!conRecording || !conBody) return;
				const line = document.createElement("div");
				line.style.cssText = "white-space:pre-wrap;word-break:break-all;color:#cfd6e6;border-bottom:1px solid rgba(128,128,128,.1);padding:2px 0";
				const time = document.createElement("span");
				time.style.cssText = "color:#6f7c93";
				time.textContent = `${conClock()} `;
				const kind = document.createElement("span");
				kind.style.cssText = "color:#78aaff;font-weight:600";
				kind.textContent = `${tag} `;
				line.appendChild(time);
				line.appendChild(kind);
				line.appendChild(document.createTextNode(text.slice(0, CON_LINE_MAX)));
				conBody.appendChild(line);
				while (conBody.childElementCount > CON_MAX_LINES) conBody.removeChild(conBody.firstElementChild);
				if (conBody.scrollHeight - conBody.scrollTop - conBody.clientHeight < 40) conBody.scrollTop = conBody.scrollHeight;
			}
			/** 「开始/停止记录」：停止只暂停追加，已记录内容保留（要清用「清空」按钮）。 */
			function setConsoleRecording(next) {
				conRecording = next;
				clientLog("info", `console recording ${next ? "on" : "off"}`);
			}
			/** 控制台当前全部记录（按行拼接）：DOM 就是缓冲区，逐行取 innerText 保留「时间 标签 原文」。 */
			function consoleText() {
				if (!conBody) return "";
				const lines = [];
				for (const child of Array.from(conBody.children)) {
					const element = child;
					const text = element.innerText ?? element.textContent ?? "";
					if (text.trim()) lines.push(text.replace(/\n+$/, ""));
				}
				return lines.join("\n");
			}
			/** 追加一条报文（JSON 两空格缩进：自读，也方便整段复制出去比对）。 */
			function conPushJson(tag, value) {
				let text;
				try {
					text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
				} catch {
					text = String(value);
				}
				conPush(tag, text);
			}
			/**
			* SSE 帧 → 控制台一行（ADR-043）：顺序即到达顺序，也就是真实发生顺序。
			* `debug` 帧由 Host 在「请求发出 / 回复收全 / 合成返回」的时刻推来，原样展开；
			* 音频帧只报大小（完整 base64 没有可读性）。
			*/
			function conPushFrame(event, data) {
				if (!conRecording) return;
				if (event === "text") return;
				if (event === "debug") {
					const step = data;
					if (step && typeof step.phase === "string") {
						conPushJson(step.phase, step.data ?? step);
						return;
					}
					conPushJson("debug", data);
					return;
				}
				if (event === "audio") {
					const item = data;
					const bytes = typeof item.data === "string" ? Math.round(item.data.length * 3 / 4) : 0;
					conPushJson("tts.audio.delta", {
						index: item.index,
						mime: item.mime,
						bytes
					});
					return;
				}
				conPushJson(event, data);
			}
			/** 调试面板动态开关（spec §2）。 */
			function ensureDebugPanel(show) {
				if (show && !debugEl && box) {
					readDebugPanelGeometry();
					debugEl = document.createElement("div");
					debugEl.style.cssText = `position:absolute;z-index:5;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;background:rgba(24,26,36,.94);color:#e8eaf0;border:1px solid rgba(128,128,128,.22);border-radius:10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.35);min-width:${DEBUG_PANEL_MIN_W}px;min-height:${DEBUG_PANEL_MIN_H}px`;
					const debugHeader = document.createElement("div");
					debugHeader.style.cssText = "display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 6px 6px 10px;background:rgba(255,255,255,.045);border-bottom:1px solid rgba(128,128,128,.16);cursor:move;user-select:none;-webkit-user-select:none;touch-action:none";
					debugHeader.title = "拖动标题栏移动面板，拖四角改大小，双击标题栏回到自动跟随";
					const debugTitle = document.createElement("div");
					debugTitle.style.cssText = "flex:1 1 auto;min-width:0;font-size:12px;font-weight:600;color:#aeb8cc;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
					debugTitle.textContent = "调试面板";
					const debugFold = document.createElement("button");
					debugFold.type = "button";
					debugFold.textContent = debugPanelCollapsed ? "▸" : "▾";
					debugFold.title = debugPanelCollapsed ? "展开调试面板" : "折叠调试面板";
					debugFold.setAttribute("aria-label", debugFold.title);
					debugFold.setAttribute("aria-expanded", debugPanelCollapsed ? "false" : "true");
					debugFold.style.cssText = "flex:0 0 auto;width:20px;height:20px;padding:0;display:grid;place-items:center;border:none;border-radius:5px;background:rgba(128,128,128,.16);color:#c8d1e2;font-size:13px;line-height:1;cursor:pointer;outline:none";
					debugFold.onmouseenter = () => {
						debugFold.style.background = "rgba(120,170,255,.28)";
					};
					debugFold.onmouseleave = () => {
						debugFold.style.background = "rgba(128,128,128,.16)";
					};
					debugFold.onclick = () => {
						setDebugPanelCollapsed(!debugPanelCollapsed);
					};
					debugHeader.ondblclick = () => {
						resetDebugPanelGeometry();
					};
					debugHeader.appendChild(debugTitle);
					debugHeader.appendChild(debugFold);
					debugFoldEl = debugFold;
					debugEl.appendChild(debugHeader);
					bindDebugPanelPointer(debugHeader, "move");
					const debugBody = document.createElement("div");
					debugBodyEl = debugBody;
					debugBody.style.cssText = "flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:8px 10px;box-sizing:border-box";
					if (debugPanelCollapsed) debugBody.style.display = "none";
					debugEl.appendChild(debugBody);
					debugGrips = [];
					for (const corner of [
						"nw",
						"ne",
						"sw",
						"se"
					]) {
						const grip = document.createElement("div");
						const horizontal = corner === "nw" || corner === "sw" ? "left" : "right";
						const vertical = corner === "nw" || corner === "ne" ? "top" : "bottom";
						grip.style.cssText = `position:absolute;${horizontal}:0;${vertical}:0;width:14px;height:14px;z-index:6;cursor:${corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize"};touch-action:none`;
						grip.title = "拖动改面板大小";
						if (corner === "se") grip.style.background = "linear-gradient(135deg,transparent 0 55%,rgba(150,180,230,.5) 55% 62%,transparent 62% 72%,rgba(150,180,230,.5) 72% 79%,transparent 79%)";
						debugGrips.push(grip);
						if (debugPanelCollapsed) grip.style.display = "none";
						bindDebugPanelPointer(grip, corner);
						debugEl.appendChild(grip);
					}
					const sectionLabel = (text) => {
						const el = document.createElement("div");
						el.style.cssText = "margin:10px 0 4px;color:#7f8aa0;font-size:11px;font-weight:600;letter-spacing:.3px";
						el.textContent = text;
						return el;
					};
					debugBody.appendChild(sectionLabel("场景演示"));
					const demoSelect = document.createElement("select");
					demoSelect.style.cssText = "flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none";
					for (const event of TRIGGER_EVENTS) {
						const option = document.createElement("option");
						option.value = event;
						option.textContent = TRIGGER_EVENT_LABELS[event] ?? event;
						demoSelect.appendChild(option);
					}
					const demoPlay = document.createElement("button");
					demoPlay.textContent = "播放";
					demoPlay.style.cssText = "padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none";
					demoPlay.onmouseenter = () => {
						demoPlay.style.background = "rgba(120,170,255,.4)";
					};
					demoPlay.onmouseleave = () => {
						demoPlay.style.background = "rgba(120,170,255,.28)";
					};
					const playScenario = () => {
						const event = demoSelect.value;
						if (!event) return;
						clientLog("info", `demo scenario | ${event}`);
						fireTrigger({
							kind: "event",
							event
						}, { force: true });
					};
					demoSelect.onchange = playScenario;
					demoPlay.onclick = playScenario;
					const demoRow = document.createElement("div");
					demoRow.style.cssText = "display:flex;gap:6px;align-items:center";
					demoRow.appendChild(demoSelect);
					demoRow.appendChild(demoPlay);
					debugBody.appendChild(demoRow);
					const motionLabel = sectionLabel("动画预览");
					debugBody.appendChild(motionLabel);
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
					debugBody.appendChild(motionRow);
					debugBody.appendChild(sectionLabel("表情预览"));
					const exprSelect = document.createElement("select");
					exprSelect.style.cssText = "flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none";
					for (const expression of EXPRESSIONS) {
						const option = document.createElement("option");
						option.value = expression.id;
						option.textContent = expression.name;
						exprSelect.appendChild(option);
					}
					/** 下拉框跟随当前生效的表情（外部改动/面板重建后同步）。 */
					const syncExprSelect = () => {
						exprSelect.value = debugExpression ?? "none";
					};
					/** 应用下拉框当前项：'none' 即清掉预览表情，回到默认脸；一次性表情（眨眼）每次选中/点播放都重播一遍。 */
					const applyDebugExpression = () => {
						const next = exprSelect.value === "none" ? null : exprSelect.value;
						const oneShot = next === null ? void 0 : expressionOneShotMotion(next);
						if (oneShot) startMotionWithPriority([oneShot], MotionPriority.FORCE, {
							suppressFocus: true,
							isInteraction: true
						});
						if (next === debugExpression) {
							syncExprSelect();
							return;
						}
						debugExpression = next;
						refreshExpressionTargets();
						syncExprSelect();
					};
					repaintDebugExpressions = syncExprSelect;
					const exprPlay = document.createElement("button");
					exprPlay.textContent = "播放";
					exprPlay.style.cssText = "padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none";
					exprPlay.onmouseenter = () => {
						exprPlay.style.background = "rgba(120,170,255,.4)";
					};
					exprPlay.onmouseleave = () => {
						exprPlay.style.background = "rgba(120,170,255,.28)";
					};
					exprSelect.onchange = applyDebugExpression;
					exprPlay.onclick = applyDebugExpression;
					const exprRow = document.createElement("div");
					exprRow.style.cssText = "display:flex;gap:6px;align-items:center";
					exprRow.appendChild(exprSelect);
					exprRow.appendChild(exprPlay);
					syncExprSelect();
					debugBody.appendChild(exprRow);
					const conSection = document.createElement("div");
					conSection.style.cssText = "flex:1 1 auto;min-height:0;display:flex;flex-direction:column";
					conSection.appendChild(sectionLabel("控制台"));
					const conRow = document.createElement("div");
					conRow.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";
					const conToggle = document.createElement("button");
					conToggle.textContent = "开始记录";
					conToggle.style.cssText = "padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none";
					const conClear = document.createElement("button");
					conClear.textContent = "清空";
					conClear.style.cssText = "padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(128,128,128,.14);color:#dbe2ef;border:1px solid rgba(128,128,128,.3);outline:none";
					const conCopy = document.createElement("button");
					conCopy.textContent = "复制";
					conCopy.style.cssText = "padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(128,128,128,.14);color:#dbe2ef;border:1px solid rgba(128,128,128,.3);outline:none";
					const flashConCopy = (label) => {
						conCopy.textContent = label;
						if (conCopyTimer) window.clearTimeout(conCopyTimer);
						conCopyTimer = window.setTimeout(() => {
							conCopy.textContent = "复制";
							conCopyTimer = 0;
						}, 1200);
					};
					conCopy.onclick = () => {
						const text = consoleText();
						if (!text) {
							flashConCopy("无内容");
							return;
						}
						copyToClipboard(text).then((ok) => flashConCopy(ok ? "已复制" : "复制失败"));
					};
					const conState = document.createElement("span");
					conState.style.cssText = "color:#7f8aa0;font-size:11px";
					const paintConState = () => {
						conToggle.textContent = conRecording ? "停止记录" : "开始记录";
						conToggle.style.background = conRecording ? "rgba(120,255,170,.26)" : "rgba(120,170,255,.28)";
						const hasLines = (conBody?.childElementCount ?? 0) > 0;
						conState.textContent = conRecording ? "记录中" : hasLines ? "已暂停（内容保留）" : "未记录";
					};
					paintConState();
					conToggle.onclick = () => {
						setConsoleRecording(!conRecording);
						paintConState();
					};
					conClear.onclick = () => {
						if (conBody) conBody.textContent = "";
						paintConState();
					};
					conRow.appendChild(conToggle);
					conRow.appendChild(conClear);
					conRow.appendChild(conCopy);
					conRow.appendChild(conState);
					conSection.appendChild(conRow);
					conBody = document.createElement("div");
					conBody.style.cssText = `margin-top:6px;flex:1 1 auto;min-height:60px;line-height:${CON_LINE_HEIGHT}px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:rgba(0,0,0,.32);border:1px solid rgba(128,128,128,.18);border-radius:6px;padding:6px;font:11px/${CON_LINE_HEIGHT}px ui-monospace,monospace;color:#cfd6e6`;
					conSection.appendChild(conBody);
					debugBody.appendChild(conSection);
					debugTextEl = document.createElement("div");
					debugTextEl.style.cssText = "flex:0 0 auto;margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.18);color:#9aa5b8;font-size:11px;white-space:pre-wrap;word-break:break-all";
					debugBody.appendChild(debugTextEl);
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
					conBody = null;
					debugFoldEl = null;
					debugBodyEl = null;
					debugGrips = [];
					conRecording = false;
					if (conCopyTimer) {
						window.clearTimeout(conCopyTimer);
						conCopyTimer = 0;
					}
					debugPanelTopLogical = NaN;
					debugPanelBottomLogical = NaN;
				} else if (show && debugEl && !debugEl.parentNode) {
					if (petLayer) petLayer.appendChild(debugEl);
					else if (box) box.appendChild(debugEl);
					updateDebugPanelPosition();
				}
			}
			/** 当前应显示的表情 id 列表（ADR-037）：调试预览 > AI 标签表情；无则空（默认脸）。 */
			function desiredExpressions() {
				if (tempExpressions.length > 0) {
					if (Date.now() < tempExpressionUntil) return tempExpressions;
					tempExpressions = [];
				}
				if (debugExpression) {
					const id = normalizeExpressionId(debugExpression);
					return id === "none" ? [] : [id];
				}
				return [];
			}
			/** 表情目标值缓存：只在表情/状态真的变化时重算（此前每帧重新映射 + 分配对象）。 */
			let expressionTargets = {};
			/** 目标是否已全部收敛：收敛后整帧跳过写入（动作/物理不会改这些开关参数）。 */
			let expressionSettled = false;
			/** 刷新表情目标值（状态/触摸/调试预览变化时调用）。 */
			function refreshExpressionTargets() {
				const ids = desiredExpressions();
				expressionTargets = expressionParams(ids);
				expressionSettled = false;
				expressionWriteLogged = false;
				clientLog("info", "expr targets", `${ids.join("+") || "none"} ${JSON.stringify(expressionTargets)}`);
			}
			/**
			* 写入表情参数：布尔开关按「当前表情」目标值 0/1，带淡入淡出。
			* 在 InternalModel.update 之前调用——动作/物理不会写这些参数，先写即生效。
			*/
			let expressionWriteLogged = false;
			function applyExpressionParams(coreModel, dt) {
				const set = coreModel?.setParameterValueById;
				if (typeof set !== "function") {
					if (!expressionWriteLogged && Object.keys(expressionTargets).length > 0) {
						expressionWriteLogged = true;
						clientLog("warn", "expr: coreModel.setParameterValueById is missing", String(typeof set));
					}
					return;
				}
				if (tempExpressions.length > 0 && Date.now() >= tempExpressionUntil) {
					tempExpressions = [];
					refreshExpressionTargets();
					releaseFocusSuppression();
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
							} catch (error) {
								clientLog("warn", "expr set failed", `${param}: ${String(error)}`);
							}
						}
						continue;
					}
					settled = false;
					const next = current + (target - current) * fade;
					if (!expressionWriteLogged) {
						expressionWriteLogged = true;
						clientLog("info", "expr write", `${param} ${current.toFixed(2)}→${target} (now ${next.toFixed(2)})`);
					}
					expressionMix.set(param, next);
					try {
						set.call(coreModel, param, next, 1);
					} catch (error) {
						clientLog("warn", "expr set failed", `${param}: ${String(error)}`);
					}
				}
				expressionSettled = settled;
			}
			/**
			* 口型跟随（ADR-033）：按正在播放的音频的波形 RMS 驱动 `ParamMouthOpenY`
			* （model3 里 `Groups.LipSync` 就声明了这个参数，别的参数不碰）。
			* 张得快、收得慢，接近真人说话的包络；没在放音时自然回到闭合。
			*/
			/**
			* 说话时的身体语言（优化项 ⑥）：口型张开量顺手带一点点点头与挑眉，
			* 让「说话」看起来有身体参与，而不是纯口型。写值放在 `update()` 之后追加，
			* 所以物理链不会被二次点燃（只做视觉叠加），音量为 0 时自然归零。
			*/
			function applySpeakingBody(coreModel) {
				const set = coreModel?.setParameterValueById;
				const get = coreModel?.getParameterValueById;
				if (typeof set !== "function" || typeof get !== "function") return;
				if (!bodyLanguageEnabled) return;
				const level = mouthLevel;
				if (level <= .02) return;
				const add = (id, delta) => {
					const base = get.call(coreModel, id);
					if (!Number.isFinite(base)) return;
					set.call(coreModel, id, base + delta, 1);
				};
				add("ParamAngleY", 3 * level);
				add("ParamAngleZ", .6 * level);
				add("ParamBrowLY", .12 * level);
				add("ParamBrowRY", .1 * level);
				add("ParamEyeBallY", -.06 * level);
			}
			function applyLipsync(coreModel, dt) {
				const set = coreModel?.setParameterValueById;
				if (typeof set !== "function") return;
				const gain = Math.max(0, Math.min(300, lipsyncGain)) / 100;
				let target = 0;
				if (lipsyncEnabled && lipsyncAnalyser && lipsyncData) {
					lipsyncAnalyser.getByteTimeDomainData(lipsyncData);
					let sum = 0;
					for (let i = 0; i < lipsyncData.length; i += 1) {
						const sample = (lipsyncData[i] - 128) / 128;
						sum += sample * sample;
					}
					const rms = Math.sqrt(sum / lipsyncData.length);
					target = Math.min(1, rms * 6) * gain;
				}
				const approach = (target > mouthLevel ? .6 : .28) * Math.min(1, dt * 60);
				mouthLevel += (target - mouthLevel) * Math.max(.05, approach);
				try {
					set.call(coreModel, "ParamMouthOpenY", Math.max(0, Math.min(1, mouthLevel)), 1);
				} catch {}
			}
			/** 运行时应用配置变化（spec §2/§3/§6/§7）：开关 / 尺寸 / 帧率 / 调试 / 触摸部位 / 事件绑定 / 模型。 */
			function applyConfig(next) {
				const cfg = next.config;
				enabled = cfg.enabled;
				syncPetVisibility();
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
				bubbleBgColor = typeof cfg.bubbleBgColor === "string" && cfg.bubbleBgColor.trim() ? cfg.bubbleBgColor : DEFAULT_BUBBLE_BG_COLOR;
				bubbleBgOpacity = Number.isFinite(cfg.bubbleBgOpacity) ? cfg.bubbleBgOpacity : 92;
				bubbleTextColor = typeof cfg.bubbleTextColor === "string" && cfg.bubbleTextColor.trim() ? cfg.bubbleTextColor : DEFAULT_BUBBLE_TEXT_COLOR;
				aiEnabled = cfg.aiEnabled === true;
				const nextTriggerMode = normalizeTriggerMode(cfg.triggerMode, triggerMode);
				const nextMinInterval = Number.isFinite(cfg.aiMinIntervalSec) ? cfg.aiMinIntervalSec : aiMinIntervalSec;
				const nextIdleTimeout = Number.isFinite(cfg.idleTimeoutSec) ? cfg.idleTimeoutSec : idleTimeoutSec;
				const nextTriggers = cfg.eventTriggers && typeof cfg.eventTriggers === "object" ? cfg.eventTriggers : eventTriggers;
				const scheduleChanged = nextTriggerMode !== triggerMode || nextMinInterval !== aiMinIntervalSec || nextIdleTimeout !== idleTimeoutSec;
				triggerMode = nextTriggerMode;
				aiMinIntervalSec = Math.max(0, nextMinInterval);
				idleTimeoutSec = Math.max(0, nextIdleTimeout);
				eventTriggers = nextTriggers;
				if (scheduleChanged) scheduleIdleTimer();
				idleMotionEnabled = cfg.idleMotionEnabled !== false;
				scheduleIdleMicro();
				ttsEnabled = cfg.ttsEnabled !== false;
				const prevBarPosition = barPosition;
				const prevBarAutoHideSec = barAutoHideSec;
				barPosition = normalizeBarPosition(cfg.barPosition, "top");
				barOffset = Number.isFinite(cfg.barOffset) ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, cfg.barOffset))) : -30;
				barAutoHideSec = normalizeBarAutoHideSec(cfg.barAutoHideSec, 10);
				if (barPosition === "hidden") {
					barAutoHidden = false;
					barHideAt = 0;
					clearBarHideTimer();
				} else if (prevBarPosition !== barPosition || prevBarAutoHideSec !== barAutoHideSec) {
					setBarAutoHidden(false);
					restartBarHideClock();
				}
				if (barEl) {
					barKey = "";
					syncBarVisual();
				}
				lipsyncEnabled = cfg.lipsyncEnabled !== false;
				bodyLanguageEnabled = cfg.lipsyncEnabled !== false;
				lipsyncGain = Number.isFinite(cfg.lipsyncGain) ? cfg.lipsyncGain : DEFAULT_SETTINGS.lipsyncGain;
				focusRangePct = normalizeFocusRange(cfg.focusRange, DEFAULT_SETTINGS.focusRange);
				applyBubbleMaxConfig(cfg);
				applyBubbleStyle();
				syncDebugPanelWidth();
				updateDebugPanelPosition();
				updateBubblePosition();
			}
			let down = null;
			let dragging = false;
			function handlePointerDown(e) {
				clearHover();
				noteBarActivity();
				down = {
					x: e.clientX,
					y: e.clientY,
					startRight: pos.right,
					startBottom: pos.bottom,
					scale: uiScale()
				};
				dragging = false;
				tapDownAt = Date.now();
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
					const s = down.scale || 1;
					pos.right = down.startRight - dx / s;
					pos.bottom = down.startBottom - dy / s;
					clampPosToViewport();
					applyPosToBox();
					const dragBounds = modelBounds();
					if (dragBounds) {
						updateDebugPanelPosition(dragBounds);
						updateBubblePosition(dragBounds);
					}
				}
			}
			function handlePointerUp(e) {
				if (!down) return;
				if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_SLOP_PX) {
					if (dragging) {
						pos.right = down.startRight;
						pos.bottom = down.startBottom;
						applyPosToBox();
					}
					handleTap(e);
				} else if (dragging) api.setDisplay({
					right: Math.round(pos.right),
					bottom: Math.round(pos.bottom)
				}).catch(() => {});
				down = null;
				dragging = false;
				syncDebugStatusText();
			}
			function handleGlobalPointerMove(e) {
				lastPointerClient = {
					x: e.clientX,
					y: e.clientY
				};
				syncBarHover(e.clientX, e.clientY);
				if (!model || !canvas || dragging || !petShown() || hidden || !windowFocused || focusSuppressed) return;
				applyFocus(e.clientX, e.clientY);
			}
			function handleGlobalMouseOut(e) {
				if (e.relatedTarget) return;
				lastPointerClient = null;
				barPointerOver = false;
				restartBarHideClock();
				focusInRange = true;
				if (!model || dragging || !petShown() || hidden) return;
				if (!focusSuppressed) model.internalModel?.focusController?.focus(0, 0, true);
			}
			/**
			* 一次性 AI 回复（ADR-025/037）：/interact 拿一句台词 + 动作/表情标签。
			* 由 startTurn 统一调度（触发过滤/冷却/合并都在那边）；本函数只负责发请求与落地结果。
			*/
			async function requestAiReply(input) {
				const seq = ++aiRequestSeq;
				try {
					const result = await api.interact(input);
					if (conRecording) {
						for (const step of result.trace ?? []) conPushJson(step.phase, step.data);
						conPushJson("interact.result", {
							ok: result.ok,
							text: result.text,
							error: result.error
						});
					}
					if (seq !== aiRequestSeq) return null;
					if (!result.ok || !result.text) return null;
					applyTags(result.expressions, result.motions);
					showAiBubble(result.text);
					return result.text;
				} catch {
					return null;
				}
			}
			/**
			* 流式演绎（ADR-033/037）：/speak 下发 text/clause/audio/tags/memory/done/error。
			* 气泡按「音频播到第几段」逐段显示，口型吃同一段音频的波形，tags 立刻换表情/动作。
			* 由 startTurn 统一调度；语音关闭时回落到一次性回复。
			*/
			/** 取走尚未落地的 `tags`（闭包里赋值不会被 TS 的控制流分析看见，故用函数取值）。 */
			function takePendingTags() {
				const tag = pendingTags;
				pendingTags = null;
				return tag;
			}
			async function requestSpeak(input) {
				const withTz = CLIENT_TIME_ZONE ? {
					...input,
					tz: CLIENT_TIME_ZONE
				} : input;
				if (!ttsEnabled) return requestAiReply(withTz);
				const seq = ++speakSeq;
				aiRequestSeq += 1;
				const controller = new AbortController();
				speakAbort = controller;
				speakClauses = [];
				speakRevealed = -1;
				speakCues = /* @__PURE__ */ new Map();
				speakCueIndex = -1;
				pendingTags = null;
				clearStickyExpression();
				speakChain = Promise.resolve();
				pcmIndex = -1;
				pcmNextStart = 0;
				pcmSources = [];
				speakWholeLive = false;
				speakWholeText = "";
				let finalText = null;
				let sawClause = false;
				try {
					await api.speak(withTz, (event, data) => {
						conPushFrame(event, data);
						if (seq !== speakSeq) return;
						if (event === "mode") {
							const item = data;
							speakWholeLive = item.whole === true && item.liveText === true;
							speakWholeText = "";
							return;
						}
						if (event === "text") {
							if (!speakWholeLive) return;
							const item = data;
							if (typeof item.delta !== "string") return;
							speakWholeText += item.delta;
							const shown = speakWholeText.replace(/<\s*[^<>\n]{1,32}\s*>/g, "").replace(/[\[［【]\s*[^\]］】\n]{1,40}\s*[\]］】]/g, "").replace(/[\[［【<]\s*[^\]］】<>\n]{0,16}$/, "");
							if (shown) showBubbleNow(shown);
							return;
						}
						if (event === "clause") {
							const item = data;
							if (typeof item.index !== "number" || typeof item.text !== "string") return;
							sawClause = true;
							speakClauses.push({
								index: item.index,
								text: item.text
							});
							revealClausesUntil(item.index);
							const cues = readCues(item.cues, isExpressionId, isMotionId);
							speakCues.set(item.index, cues);
							const tag = takePendingTags();
							if (tag !== null && cues.length === 0) applyTags(tag.expressions, tag.motions);
							return;
						}
						if (event === "audio.chunk") {
							const item = data;
							if (typeof item.data !== "string") return;
							const index = typeof item.index === "number" ? item.index : 0;
							const sampleRate = typeof item.sampleRate === "number" ? item.sampleRate : 24e3;
							speakChain = speakChain.then(async () => {
								if (seq !== speakSeq) return;
								if (pcmIndex !== index) {
									pcmIndex = index;
									enterClause(index);
								}
								schedulePcmChunk(item.data, sampleRate);
							});
							return;
						}
						if (event === "audio.end") {
							const payload = data;
							const index = typeof payload.index === "number" ? payload.index : 0;
							const seconds = typeof payload.seconds === "number" ? payload.seconds : null;
							speakChain = speakChain.then(async () => {
								if (seq !== speakSeq) return;
								await waitPcmDone();
								conPushJson("play.audio", {
									index,
									mime: "audio/pcm",
									seconds
								});
							});
							return;
						}
						if (event === "audio") {
							const item = data;
							if (typeof item.index !== "number" || typeof item.data !== "string") return;
							const mime = typeof item.mime === "string" ? item.mime : "audio/mpeg";
							const index = item.index;
							speakChain = speakChain.then(async () => {
								if (seq !== speakSeq) return;
								enterClause(index);
								const seconds = await playClip(item.data, mime);
								conPushJson("play.audio", {
									index,
									mime,
									seconds: seconds === null ? null : Math.round(seconds * 100) / 100
								});
							});
							return;
						}
						if (event === "tags") {
							const payload = data;
							pendingTags = {
								expressions: Array.isArray(payload.expressions) ? payload.expressions.filter((item) => typeof item === "string") : [],
								motions: Array.isArray(payload.motions) ? payload.motions.filter((item) => typeof item === "string") : []
							};
							if (Array.isArray(payload.dropped) && payload.dropped.length > 0) conPush("tags dropped", payload.dropped.join(", "));
							return;
						}
						if (event === "memory") {
							const payload = data;
							clientLog("info", "memory noted", typeof payload.note === "string" ? payload.note : "");
							return;
						}
						if (event === "done") {
							const payload = data;
							finalText = typeof payload.text === "string" ? payload.text : null;
							return;
						}
						if (event === "error") return;
					}, controller.signal);
				} catch {}
				if (seq !== speakSeq) return null;
				await speakChain.catch(() => void 0);
				if (seq !== speakSeq) return null;
				if (!sawClause && finalText === null) return null;
				revealAllClauses();
				const leftover = takePendingTags();
				if (leftover !== null) applyTags(leftover.expressions, leftover.motions);
				clearStickyExpression();
				if (finalText !== null) {
					showAiBubble(finalText);
					return finalText;
				}
				return null;
			}
			/**
			* AI 标签落地（ADR-037）：`[表情][动作]` 目录标签 → 临时表情 + 一次动作。
			* 目录外的 id 直接忽略（不让模型幻觉参数写进渲染层）；为空则什么都不做。
			*/
			function applyTags(expressions, motions) {
				debugExpression = null;
				const list = Array.isArray(expressions) ? expressions.filter((item) => typeof item === "string" && isExpressionId(item)) : [];
				if (list.length > 0) {
					clientLog("info", "ai expressions", list.join("+"));
					conPushJson("play.expression", { applied: list });
					for (const motion of oneShotExpressionMotions(list)) {
						clientLog("info", "one-shot expression", motion);
						enqueueCueMotion(motion);
					}
					const persistent = persistentExpressions(list);
					if (persistent.length > 0) holdTemporaryExpression(persistent);
				}
				const motionList = Array.isArray(motions) ? motions.filter((item) => typeof item === "string" && isMotionId(item)) : [];
				if (motionList.length > 0 && model && !dragging && !previewActive && !hidden) {
					clientLog("info", "ai motions", motionList.join("+"));
					conPushJson("play.motion", { applied: motionList });
					playInteractionMotion(motionList);
				}
			}
			/**
			* 设置页预览（ADR-040 修订 / ADR-054）：动作走互动动作通道播一次；常驻表情走临时表情通道
			* （与 AI 标签同一套落地逻辑，`TAG_EXPRESSION_HOLD_MS` 后回到常态）；一次性表情（眨眼）
			* 直接播对应动作一遍。
			*/
			function previewCatalog(target) {
				if (target.kind === "expression") {
					if (!isExpressionId(target.id)) return;
					debugExpression = null;
					const oneShot = expressionOneShotMotion(target.id);
					if (oneShot) startMotionWithPriority([oneShot], MotionPriority.FORCE, {
						suppressFocus: true,
						isInteraction: true
					});
					else holdTemporaryExpression([target.id]);
					clientLog("info", "preview expression", target.id);
					return;
				}
				if (!isMotionId(target.id)) return;
				clientLog("info", "preview motion", target.id);
				playInteractionMotion([target.id]);
			}
			function handleTap(e) {
				if (!canvas || !model) return;
				if (aiEnabled && ttsEnabled) ensureAudio();
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
					const durationMs = tapDownAt > 0 ? Math.max(0, now - tapDownAt) : 0;
					const fireTap = (clickCount) => {
						const picked = pickTapInteraction(part, clickCount);
						if (!picked) {
							clientLog("info", `tap | ${part.name} | 没有匹配的交互，忽略 ${durationMs}ms`);
							return;
						}
						const input = {
							kind: "tap",
							part: part.name,
							interaction: picked.name
						};
						clientLog("info", `tap | ${part.name} | ${picked.name}(${picked.trigger}) ${durationMs}ms`);
						fireTrigger(input);
					};
					if (!hasDoubleInteraction(part)) {
						fireTap(1);
						return;
					}
					if (pendingDoublePart) {
						const previous = pendingDoublePart;
						window.clearTimeout(previous.timer);
						pendingDoublePart = null;
						if (previous.id === part.id) {
							fireTap(2);
							return;
						}
						previous.flush();
					}
					const timer = window.setTimeout(() => {
						pendingDoublePart = null;
						fireTap(1);
					}, 300);
					pendingDoublePart = {
						id: part.id,
						timer,
						flush: () => fireTap(1)
					};
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
			/** 动作串行队列（ADR-048 P3）：一次只演一个，播完再放下一个；满了丢最旧。 */
			function enqueueCueMotion(name) {
				if (!model || !name) return;
				const result = pushMotion(motionQueue, name);
				if (result.dropped !== null) {
					clientLog("info", "cue dropped", result.dropped);
					conPush("cue.dropped", `queue full (2) | dropped ${result.dropped}`);
				}
				motionQueue = result.queue;
				drainCueMotions();
			}
			async function drainCueMotions() {
				if (motionBusy) return;
				motionBusy = true;
				try {
					while (motionQueue.length > 0) {
						const name = motionQueue.shift();
						if (name === void 0) break;
						if (!model || hidden) {
							motionQueue = [];
							break;
						}
						await playInteractionMotion([name]);
						await waitMotionFinish();
					}
				} finally {
					motionBusy = false;
				}
			}
			/** 等这一个动作真的播完（motionFinish）；拿不到信号就按上限兜底。 */
			function waitMotionFinish(timeoutMs = MOTION_WAIT_MS) {
				return new Promise((resolve) => {
					let settled = false;
					const done = () => {
						if (settled) return;
						settled = true;
						resolve();
					};
					motionWaiters.push(done);
					window.setTimeout(done, timeoutMs);
				});
			}
			/** 执行一段 cue：表情立刻换（sticky），动作进串行队列。 */
			function applyCues(cues) {
				debugExpression = null;
				const { expressions, motions } = splitCues(cues);
				if (expressions.length > 0) {
					clientLog("info", "ai expressions", expressions.join("+"));
					conPushJson("play.expression", { applied: expressions });
					for (const motion of oneShotExpressionMotions(expressions)) {
						clientLog("info", "one-shot expression", motion);
						enqueueCueMotion(motion);
					}
					const persistent = persistentExpressions(expressions);
					if (persistent.length > 0) holdTemporaryExpression(persistent, true);
				}
				for (const name of motions) {
					clientLog("info", "ai motions", name);
					conPushJson("play.motion", { applied: [name] });
					enqueueCueMotion(name);
				}
			}
			/** 进入第 `index` 段：执行这一段（含被跳过的段）的 cue。文字由 `clause` 帧到达时就上屏了。 */
			function enterClause(index) {
				for (let cursor = speakCueIndex + 1; cursor <= index; cursor += 1) {
					const cues = speakCues.get(cursor);
					if (cues !== void 0 && cues.length > 0) applyCues(cues);
				}
				if (index > speakCueIndex) speakCueIndex = index;
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
						bubbleBgColor = typeof view.config.bubbleBgColor === "string" && view.config.bubbleBgColor.trim() ? view.config.bubbleBgColor : DEFAULT_BUBBLE_BG_COLOR;
						bubbleBgOpacity = Number.isFinite(view.config.bubbleBgOpacity) ? view.config.bubbleBgOpacity : 92;
						bubbleTextColor = typeof view.config.bubbleTextColor === "string" && view.config.bubbleTextColor.trim() ? view.config.bubbleTextColor : DEFAULT_BUBBLE_TEXT_COLOR;
						aiEnabled = view.config.aiEnabled === true;
						triggerMode = normalizeTriggerMode(view.config.triggerMode, triggerMode);
						aiMinIntervalSec = Number.isFinite(view.config.aiMinIntervalSec) ? Math.max(0, view.config.aiMinIntervalSec) : aiMinIntervalSec;
						activityWindowSec = Number.isFinite(view.config.activityWindowSec) ? Math.max(0, view.config.activityWindowSec) : activityWindowSec;
						tapGapMs = Number.isFinite(view.config.tapGapMs) ? Math.max(0, view.config.tapGapMs) : tapGapMs;
						mergeMax = Number.isFinite(view.config.mergeMax) ? Math.max(1, view.config.mergeMax) : mergeMax;
						idleTimeoutSec = Number.isFinite(view.config.idleTimeoutSec) ? Math.max(0, view.config.idleTimeoutSec) : idleTimeoutSec;
						eventTriggers = view.config.eventTriggers && typeof view.config.eventTriggers === "object" ? view.config.eventTriggers : eventTriggers;
						idleMotionEnabled = view.config.idleMotionEnabled !== false;
						scheduleIdleMicro();
						ttsEnabled = view.config.ttsEnabled !== false;
						barPosition = normalizeBarPosition(view.config.barPosition, "top");
						barOffset = Number.isFinite(view.config.barOffset) ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, view.config.barOffset))) : -30;
						barAutoHideSec = normalizeBarAutoHideSec(view.config.barAutoHideSec, 10);
						lipsyncEnabled = view.config.lipsyncEnabled !== false;
						bodyLanguageEnabled = view.config.lipsyncEnabled !== false;
						lipsyncGain = Number.isFinite(view.config.lipsyncGain) ? view.config.lipsyncGain : DEFAULT_SETTINGS.lipsyncGain;
						focusRangePct = normalizeFocusRange(view.config.focusRange, DEFAULT_SETTINGS.focusRange);
						scheduleIdleTimer();
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
						clearBarHideTimer();
						barHideAt = 0;
						barPointerOver = false;
						barAutoHidden = false;
						barEl?.parentNode?.removeChild(barEl);
						barEl = null;
						barMuteEl = null;
						barInputEl = null;
						barSendEl = null;
					});
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
						const signature = `${next.display.right}|${next.display.bottom}|${next.displaySaved ? 1 : 0}|${JSON.stringify(next.config)}`;
						if (signature !== viewSignature) {
							viewSignature = signature;
							applyConfig(next);
						}
						applyState(next);
					};
					let closeEvents;
					try {
						closeEvents = api.events(handleState, () => {});
					} catch {}
					const onVisibility = () => {
						hidden = document.visibilityState === "hidden";
						if (hidden) {} else {
							if (audioCtx?.state === "suspended") audioCtx.resume();
							scheduleIdleTimer();
						}
						syncTicker();
					};
					const onBlur = () => {
						windowFocused = false;
					};
					const onFocus = () => {
						windowFocused = true;
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
					label: () => "Waifu 设置",
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