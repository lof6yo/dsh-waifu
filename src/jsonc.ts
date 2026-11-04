/**
 * 插件私有 JSONC 文件解析工具：去注释后交给 JSON.parse。
 * 供 settings-store / touch-parts 等插件私有配置文件共用。
 * @module dsh-waifu/jsonc
 */

export function stripJsonComments(text: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        // 转义字符：连下一个字符一起原样保留
        if (i + 1 < text.length) out += next
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i += 1
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      // 行注释：跳到行尾
      i += 2
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      // 块注释：跳到 */（保留一个换行，避免行拼接改变语义）
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i = Math.min(i + 2, text.length)
      out += ' '
      continue
    }
    out += ch
    i += 1
  }
  return out
}
