import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function runProbe(failure) {
  const env = { ...process.env }
  if (failure) env.PAPRV_SMOKE_FAILURE = failure
  else delete env.PAPRV_SMOKE_FAILURE
  return spawnSync(electron, ['.', '--smoke-test'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000
  })
}

const success = runProbe()
if (success.status !== 0) {
  process.stderr.write(success.stderr || success.stdout || `successful smoke exited ${String(success.status)}\n`)
  process.exit(1)
}

for (const failure of ['startup', 'preload', 'ipc']) {
  const probe = runProbe(failure)
  if (typeof probe.status !== 'number' || probe.status === 0) {
    process.stderr.write(`${failure} failure probe did not exit nonzero (status=${String(probe.status)}, signal=${String(probe.signal)})\n`)
    process.exit(1)
  }
}

process.stdout.write('Electron smoke verified success=0 and startup/preload/ipc failures!=0\n')
