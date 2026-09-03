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
})
