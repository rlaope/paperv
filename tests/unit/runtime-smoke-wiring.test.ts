import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('packaged renderer runtime smoke wiring', () => {
  it('is an explicit package command and macOS CI gate', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const runner = readFileSync('scripts/tauri-runtime-smoke.mjs', 'utf8')

    expect(packageJson.scripts['test:runtime']).toBe('node scripts/tauri-runtime-smoke.mjs')
    expect(packageJson.scripts['test:release-smoke-gate']).toContain('verify-release-smoke-gate.mjs')
    expect(workflow).toContain('pnpm test:runtime')
    expect(workflow).toContain('pnpm test:release-smoke-gate')
    expect(runner).not.toContain('pgrep')
    expect(runner).toContain('terminateVerifiedSmokeProcess')
  })
})