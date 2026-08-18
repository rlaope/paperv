import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  parseRendererReadyMarker,
  terminateVerifiedSmokeProcess,
  verifySmokeProcessIdentity
} from './runtime-smoke-process.mjs'

if (process.platform !== 'darwin') {
  console.error('Tauri runtime smoke requires macOS')
  process.exit(2)
}

const appBundle = resolve('src-tauri/target/debug/bundle/macos/Paprv.app')
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'paprv')
const canonicalTempDir = await realpath(tmpdir())
const runtimeDir = await mkdtemp(join(canonicalTempDir, 'paprv-runtime-smoke-'))
await chmod(runtimeDir, 0o700)
const markerPath = join(runtimeDir, 'renderer-ready')
const launcher = spawn('/usr/bin/open', [
  '-n', '-W', '--env', `PAPRV_RUNTIME_SMOKE_PATH=${markerPath}`, appBundle
], { stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
let appPid
launcher.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
launcher.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
const deadline = Date.now() + 15_000

try {
  let observed
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) {
      throw new Error(`LaunchServices failed before Paprv signaled readiness (exit ${launcher.exitCode})`)
    }
    try {
      const parsed = parseRendererReadyMarker(await readFile(markerPath, 'utf8'))
      verifySmokeProcessIdentity(parsed.pid, appExecutable)
      observed = parsed
      appPid = parsed.pid
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  if (!observed) throw new Error('renderer-owned readiness marker was not observed')
  console.log(`Tauri runtime smoke passed: ${observed.marker} (verified pid ${appPid})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  if (stdout) console.error(`open stdout:\n${stdout}`)
  if (stderr) console.error(`open stderr:\n${stderr}`)
  process.exitCode = 1
} finally {
  if (appPid) {
    try {
      terminateVerifiedSmokeProcess(appPid, appExecutable)
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.error(`failed to stop verified smoke app: ${String(error)}`)
        process.exitCode = 1
      }
    }
  }
  if (launcher.exitCode === null) launcher.kill('SIGTERM')
  await rm(runtimeDir, { recursive: true, force: true })
}
