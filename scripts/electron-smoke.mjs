import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const expectedFailureCodes = new Map([
  ['startup', 41],
  ['preload', 42],
  ['ipc', 43],
  ['unknown', 41],
  ['toString', 41]
])

function runProbe(failure, developmentUrl) {
  const userData = mkdtempSync(join(tmpdir(), 'paprv-smoke-'))
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  if (developmentUrl) env.ELECTRON_RENDERER_URL = developmentUrl
  env.PAPRV_SMOKE_USER_DATA = userData
  if (failure) env.PAPRV_SMOKE_FAILURE = failure
  else delete env.PAPRV_SMOKE_FAILURE
  try {
    return spawnSync(electron, ['.', '--smoke-test'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30_000
    })
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
}

const success = runProbe()
if (success.status !== 0) {
  process.stderr.write(success.stderr || success.stdout || `successful smoke exited ${String(success.status)}\n`)
  process.exit(1)
}

const rendererUrlInjection = runProbe(undefined, 'http://127.0.0.1:65535/injected-dev-renderer')
if (rendererUrlInjection.status !== 0) {
  process.stderr.write(rendererUrlInjection.stderr || rendererUrlInjection.stdout || `renderer URL injection probe exited ${String(rendererUrlInjection.status)}\n`)
  process.exit(1)
}

for (const [failure, expectedCode] of expectedFailureCodes) {
  const probe = runProbe(failure)
  if (probe.status !== expectedCode) {
    process.stderr.write(`${failure} failure probe exited ${String(probe.status)}, expected ${expectedCode} (signal=${String(probe.signal)})\n${probe.stderr || probe.stdout}`)
    process.exit(1)
  }
}

process.stdout.write('Electron smoke verified packaged renderer with success=0, startup=41, preload=42, ipc=43, unknown/prototype-key=41\n')
