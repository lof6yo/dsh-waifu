import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendMemory,
  loadMemory,
  memoryContext,
  memoryPath,
  parseMemory,
  saveMemory,
} from './memory.ts'

const dirs: string[] = []

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-memory-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('memory.md（ADR-037 / ADR-049 去重）', () => {
  it('追加条目带时间戳，解析回来能认出时间', () => {
    const dir = home()
    appendMemory(dir, '主人最喜欢猫')
    const file = readFileSync(memoryPath(dir), 'utf8')
    expect(file).toMatch(/^- \[\d{1,2}\/\d{1,2} \d\d:\d\d\] 主人最喜欢猫$/m)
    const entries = loadMemory(dir).entries
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toContain('主人最喜欢猫')
  })

  it('最近 5 条里已有同一件事就不再记（重复条目白占注入预算）', () => {
    const dir = home()
    appendMemory(dir, '主人怕黑')
    appendMemory(dir, '主人怕黑')
    appendMemory(dir, '  主人怕黑  ')
    expect(loadMemory(dir).entries).toHaveLength(1)
    appendMemory(dir, '主人喜欢猫')
    expect(loadMemory(dir).entries).toHaveLength(2)
  })

  it('不同内容照常追加，空白丢弃', () => {
    const dir = home()
    appendMemory(dir, '主人喜欢猫')
    appendMemory(dir, '   ')
    appendMemory(dir, '主人怕痒')
    expect(loadMemory(dir).entries.map((entry) => entry.text.split('] ')[1])).toEqual(['主人喜欢猫', '主人怕痒'])
  })

  it('memoryContext 取最近 N 条', () => {
    const entries = parseMemory('# 头\n- [1/1 10:00] a\n- [1/1 10:01] b\n- [1/1 10:02] c\n')
    expect(memoryContext(entries, 2)).toBe('- [1/1 10:01] b\n- [1/1 10:02] c')
    expect(memoryContext(entries, 0)).toBe('')
  })

  it('保存空文本回落文件头', () => {
    const dir = home()
    expect(saveMemory(dir, '   ').text).toContain('# 简 的记忆')
  })
})
