/**
 * 调试链路追踪（ADR-043）：让调试控制台按**真实发生顺序**展示一次 AI 反应的全过程。
 *
 * 为什么由 Host 产出：触发场景句由客户端上报，但「发给 LLM 的完整请求」「模型完整回复」
 * 「发给 TTS 的完整请求」「TTS 回复多大」这些只存在于 Host 侧，而且只有 Host 知道它们
 * **什么时候**发生。客户端事后拉 `/ai-debug` 只能拿到最后一份快照，顺序必然错乱。
 *
 * 分发方式：`/speak` 直接把每一步 emit 成 SSE `debug` 帧（实时到达 = 真实顺序）；
 * `/interact` 是一次性响应，把 steps 随响应回带（`trace` 字段），客户端按数组顺序展出。
 * @module dsh-waifu/trace
 */

/** 一次调用里需要记录的时刻。 */
export type TracePhase = 'llm.request' | 'llm.reply' | 'tts.request' | 'tts.reply'

/** 一条链路记录：阶段 + 发生时刻 + 原始报文。 */
export interface TraceStep {
  phase: TracePhase
  /** 发生时刻（epoch ms，Host 时钟）；同一次调用内单调递增。 */
  at: number
  /** 原始报文：请求带完整 body，回复带完整原文或字节摘要。 */
  data: unknown
}

/** 造一条 step（时间戳取调用时刻，不依赖调用方传）。 */
export function traceStep(phase: TracePhase, data: unknown): TraceStep {
  return { phase, at: Date.now(), data }
}
