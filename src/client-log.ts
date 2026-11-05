/**
 * 浏览器侧诊断日志：Client 半区经 POST /api/dsh-waifu/client-log 上报，
 * Host 追加到 `$DSH_HOME/waifu/client.log`（超过上限自动截断）。
 *
 * 用途：桌宠渲染在浏览器里失败时（WebGL / 模型加载 / 脚本注入），
 * 没有浏览器控制台也能在 Host 侧看到启动里程碑与错误栈（spec §9）。
 * @module dsh-waifu/client-log
 */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { petWaifuPath } from './home.ts'

/** 日志文件上限（字节）；超过后清空重写，避免无限增长。 */
const MAX_LOG_BYTES = 256 * 1024

/** 日志文件绝对路径。 */
export function clientLogPath(): string {
  return petWaifuPath('client.log')
}

/** 追加一行浏览器侧诊断日志（失败静默，不影响主流程）。 */
export function appendClientLog(level: string, message: string, detail?: string): void {
  try {
    const file = clientLogPath()
    mkdirSync(dirname(file), { recursive: true })
    // 只在超限时截断：一次 statSync 取代 existsSync + statSync 两次系统调用
    try {
      if (statSync(file).size > MAX_LOG_BYTES) writeFileSync(file, '', 'utf8')
    } catch {
      // 文件还不存在：首次 append 会创建
    }
    const safeLevel = String(level || 'info').slice(0, 16)
    const safeMessage = String(message ?? '').slice(0, 2000)
    const safeDetail = detail === undefined ? '' : ` | ${String(detail).slice(0, 4000)}`
    appendFileSync(file, `${new Date().toISOString()} [${safeLevel}] ${safeMessage}${safeDetail}\n`, 'utf8')
  } catch {
    // 日志写入失败不影响插件
  }
}
