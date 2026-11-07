# ADR-051：语音合成走直连 + 自持连接池

- 状态：Accepted
- 日期：2026-11-07

## 背景

实测发现「TTS 那 1 秒」里有一半不是合成，而是**建连**：

| 测法 | 结果 |
|---|---|
| `robots.txt` 冷连接（走 `HTTPS_PROXY`） | TLS 握手 0.61–0.71 s，TTFB 0.85–1.02 s |
| 同一条连接发第二次 | TTFB 0.244 s，TLS 0 |
| Node 全局 `fetch` 冷 → 热 | 969 ms → 274 ms |
| Node 全局 `fetch` 闲置 10 s 后再发 | **956 ms（重新握手）** |
| `POST /tts` 冷 / 热 | 2.45 s、1.65 s / **1.19 s、1.18 s** |

两个结构性原因：

1. **走代理**：`NODE_USE_ENV_PROXY=1` 时全局 `fetch` 会连 `HTTPS_PROXY`（本机 `192.168.31.114:7890`）。代理多一跳，TLS 握手 0.6–1.3 s；直连实测 0.41 s。
2. **空闲窗口太短**：undici 默认 keep-alive 只有约 4 s。两轮对话之间通常隔十几秒，
   于是**每轮第一段合成几乎总是冷连接**，白付 0.6–1.3 s 握手。

## 决策

1. 语音合成**不走系统代理**：用 `node:https.request` + 自建 `https.Agent`。
2. 连接池 `keepAlive: true`、`keepAliveMsecs: 60_000`、`maxSockets: 4`、`maxFreeSockets: 2`。
   实测 60 s 空闲后仍复用（200–214 ms），对比全局 fetch 10 s 就要 956 ms 重连。
3. **直连失败自动回落代理**：公司网 / 被墙 / DNS 污染时退回全局 `fetch`，
   宁可慢一点也不要没声音。
4. `WAIFU_TTS_DIRECT=0` 可强制回到代理路径（给只能通过代理出网的环境）。
5. 只改 TTS 这一条链路；LLM 走 DSH 的 `llm` 服务、事件走 SSE，都不动。

## 取舍

- **不换成 `undici` 依赖**：只为拿一个 Agent 引入运行期依赖不值；`node:https` 同样能给连接池，
  且天然不读代理环境变量。
- **不动全局 `NODE_USE_ENV_PROXY`**：那是宿主进程的配置，插件无权替其他组件做决定。
- **不预建连接**（在 LLM 生成时预热）：本方案靠 60 s 池子跨轮复用，已覆盖大部分场景；
  预热只对「进程刚起步的第一轮」有效，等真出现再考虑。
- **保留 `fetcher` 注入口**：测试仍可注入假实现，不因换传输方式而失去覆盖。

## 影响

- `src/tts.ts`：新增 `directTtsFetcher` / `directPost` / `proxiedTtsFetcher` 与 `ttsAgent`；
  `OpenRouterTtsEngine` 的默认 `fetcher` 从全局 `fetch` 换成 `directTtsFetcher`（构造签名兼容，测试不改）。
- 预期收益：每轮第一段合成省掉一次 0.6–1.3 s 握手；稳定态单段开销 ~0.2 s（原来是 0.25–0.27 s 起、冷路径 0.9–2.4 s）。
- 风险与兜底：直连不通 → 自动回落代理；代理也不通 → 照旧抛 `tts-http`/网络错误，行为与改造前一致。
