import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('web build contract', () => {
  it('exposes web build scripts and relative base', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.['build:web']).toContain('vite.web.config.ts')
    expect(readFileSync(resolve(process.cwd(), 'vite.web.config.ts'), 'utf8')).toContain("base: './'")
  })

  it('parses common image response shapes and shares the timeout with downloads', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/visual-self-check.mjs'), 'utf8')
    expect(source).toContain('Array.isArray(data?.output)')
    expect(source).toContain('typeof candidate === \'string\'')
    expect(source.match(/signal: controller\.signal/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('keeps the approved weekly reference wording', () => {
    const prompt = readFileSync(resolve(process.cwd(), 'docs/visual-self-check/weekly-prompt.txt'), 'utf8')
    expect(prompt).toContain('本周计划')
    expect(prompt).toContain('蓝色实心圆')
  })
})
