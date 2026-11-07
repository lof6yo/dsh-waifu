/**
 * 时间与时区：把「现在几点」「多久以前」换算到请求方（浏览器）所在的时区。
 * 纯函数、不读全局状态——宿主跑在 UTC，靠这里把时间翻译成用户的时间感。
 * @module dsh-waifu/time
 */

const pad2 = (value: number) => String(value).padStart(2, '0')
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/**
 * 校验 IANA 时区名（浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 送来的）。
 * 只放行字母数字与 `_ + - /`，并真正让 Intl 解析一次——非法名字会让 `DateTimeFormat` 直接抛。
 */
export function normalizeTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== 'string') return undefined
  const value = tz.trim()
  if (value.length === 0 || value.length > 64) return undefined
  if (!/^[A-Za-z0-9_+/-]+$/.test(value)) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return value
  } catch {
    return undefined
  }
}

/** 某一时刻在指定时区里的年月日时分与星期（时区缺失/非法时回落宿主本地时区）。 */
function zoneParts(at: number, timeZone?: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number
} {
  const date = new Date(at)
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    }
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(at)
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
    const weekday = WEEKDAY_INDEX[pick('weekday')]
    return {
      year: Number(pick('year')),
      month: Number(pick('month')),
      day: Number(pick('day')),
      hour: Number(pick('hour')),
      minute: Number(pick('minute')),
      weekday: Number.isFinite(weekday) ? weekday : new Date(at).getDay(),
    }
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    }
  }
}

/**
 * 历史条目的时间戳前缀：同一天只给 `[21:03]`，跨天补上 `[11/04 21:03]`。
 * 只用于提示模型时间感，不进台词、不显示在气泡里。
 * `timeZone` 传浏览器时区——宿主机跑在 UTC，不传就会把「深夜」当「早上」。
 */
export function formatStamp(at: number, now = Date.now(), timeZone?: string): string {
  const then = zoneParts(at, timeZone)
  const today = zoneParts(now, timeZone)
  const clock = `${pad2(then.hour)}:${pad2(then.minute)}`
  const sameDay = then.year === today.year && then.month === today.month && then.day === today.day
  return sameDay ? clock : `${then.month}/${then.day} ${clock}`
}

/** 当前时间的口语描述（「11月5日 周四 21:10」），每次请求都重新取值。 */
export function formatNow(now = Date.now(), timeZone?: string): string {
  const parts = zoneParts(now, timeZone)
  return `${parts.month}月${parts.day}日 ${WEEKDAYS[parts.weekday]} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}
