import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('packaged renderer runtime smoke wiring', () => {
  it('is an explicit package command and macOS CI gate', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')

    expect(packageJson.scripts['test:runtime']).toBe('node scripts/tauri-runtime-smoke.mjs')
    expect(workflow).toContain('pnpm test:runtime')
  })
})