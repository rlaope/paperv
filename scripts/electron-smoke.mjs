import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  ['renderer', 44],
  ['unknown', 41],
  ['toString', 41]
])

function runProbe(failure, developmentUrl, appRoot = root) {
  const userData = mkdtempSync(join(tmpdir(), 'paprv-smoke-'))
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  if (developmentUrl) env.ELECTRON_RENDERER_URL = developmentUrl
  env.PAPRV_SMOKE_USER_DATA = userData
  if (failure) env.PAPRV_SMOKE_FAILURE = failure
  else delete env.PAPRV_SMOKE_FAILURE
  try {
    return spawnSync(electron, ['.', '--smoke-test'], {
      cwd: appRoot,
      env,
      encoding: 'utf8',
      timeout: 30_000
    })
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
}

function runRendererDamageProbe() {
  const appCopy = mkdtempSync(join(tmpdir(), 'paprv-renderer-damage-'))
  try {
    copyFileSync(join(root, 'package.json'), join(appCopy, 'package.json'))
    cpSync(join(root, 'out'), join(appCopy, 'out'), { recursive: true })
    writeFileSync(
      join(appCopy, 'out/renderer/index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>\n',
      'utf8'
    )
    return runProbe(undefined, undefined, appCopy)
  } finally {
    rmSync(appCopy, { recursive: true, force: true })
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

const rendererDamage = runRendererDamageProbe()
if (rendererDamage.status !== 44) {
  process.stderr.write(`renderer damage probe exited ${String(rendererDamage.status)}, expected 44 (signal=${String(rendererDamage.signal)})\n${rendererDamage.stderr || rendererDamage.stdout}`)
  process.exit(1)
}

process.stdout.write('Electron smoke verified packaged React readiness with success=0, startup=41, preload=42, ipc=43, renderer=44, renderer-damage=44, unknown/prototype-key=41\n')
