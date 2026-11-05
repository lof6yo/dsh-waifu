# 028 AI 回复失败原因回传

## 背景

AI 回复失败时（provider 没配 API Key、模型/端点不可用、超时、模型只吐空白），插件此前一律返回
`{"ok":false,"error":"no-reply"}` 并静默回落到预置台词。实机排查成本很高：明明设置页看着都开好了，
桌宠就是不说话，日志里也什么都没有。

## 决策

1. `generateReply()` 返回 `{ text, error? }` 而不是裸字符串：`text` 为空时带上简短原因
   （异常消息截断 200 字符；流里没文本 → `empty-stream`；清洗后为空 → `empty-after-sanitize`）。
2. `/api/dsh-waifu/interact` 把原因拼进错误码：`no-reply: <原因>`，客户端仍按「失败」处理
   （保持预置台词，不把错误显示给用户）。
3. 不新增日志文件：排查时 `curl POST /interact` 一次即可看到 DSH LLM 层给出的原文。

4. 空正文时自动关推理重试一次：`google/gemma-4-31b-it` 这类推理模型开着思维链会把预算花在
   reasoning 上、`content` 整段为空（实测 `reasoning: {enabled: true}` + `max_tokens: 80` → 正文空、
   `completion_tokens` 只 3 个）。`generateReply()` 首轮空正文就带 `reasoningEffort: 'off'` 再来一次，
   仍失败才回落预置台词；`maxTokens` 提到 120、超时 15s。

## 后果

- 排障从「桌宠不说话」变成「一句 curl 看到 openrouter 401 / model not found / timeout」。
- 错误字符串只回传给本机调用方，不进气泡、不落盘。
- 默认 provider 回退到本机可用的 `deepseek-official` / `deepseek-flash`（`openrouter` 需要
  `OPENROUTER_API_KEY`，缺 key 时整条 `llm-pi-ai` provider 不可用）。
