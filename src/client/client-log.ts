/**
 * 浏览器侧诊断上报（Client 半区共用）：把桌宠/设置页的关键事件与错误发到 Host 的
 * `/api/dsh-waifu/client-log`，Host 落盘 `$DSH_HOME/waifu/client.log`，
 * 便于没有浏览器控制台的环境排查（spec §9）。失败静默，不影响主流程。
 * @module dsh-waifu/client/client-log
 */

/** 宠物 API 基路径（与 client/index.ts、settings.ts 保持一致）。 */
const PET_API = '/api/dsh-waifu'

/** 上报一条客户端诊断日志。 */
export function clientLog(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  try {
    const text = detail === undefined
      ? ''
      : (detail instanceof Error ? (detail.stack ?? detail.message) : String(detail)).slice(0, 4000)
    void fetch(`${PET_API}/client-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level, message, detail: text }),
    }).catch(() => {})
  } catch {
    // 上报失败不影响主流程
  }
}
