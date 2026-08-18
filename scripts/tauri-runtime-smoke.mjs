import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'darwin') {
  console.error('Tauri runtime smoke requires macOS')
  process.exit(2)
}

const appBundle = resolve('src-tauri/target/debug/bundle/macos/Paprv.app')
const runtimeDir = await mkdtemp(join(tmpdir(), 'paprv-runtime-smoke-'))
const markerPath = join(runtimeDir, 'renderer-ready')
const paprvPids = () => {
  try {
    return new Set(execFileSync('/usr/bin/pgrep', ['-x', 'paprv'], { encoding: 'utf8' })
      .trim().split(/\s+/).filter(Boolean).map(Number))
  } catch {
    return new Set()
  }
}
const existingPids = paprvPids()
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
  let marker
  while (Date.now() < deadline) {
    appPid ??= [...paprvPids()].find((pid) => !existingPids.has(pid))
    if (launcher.exitCode !== null && !appPid) {
      throw new Error(`LaunchServices failed before Paprv started (exit ${launcher.exitCode})`)
    }
    try {
      marker = await readFile(markerPath, 'utf8')
      break
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  if (!appPid) throw new Error('LaunchServices did not start the packaged Paprv app')
  if (!marker || !/^PAPRV_RENDERER_READY:macos:\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(marker)) {
    throw new Error('renderer-owned readiness marker was not observed')
  }
  console.log(`Tauri runtime smoke passed: ${marker} (pid ${appPid})`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  if (stdout) console.error(`open stdout:\n${stdout}`)
  if (stderr) console.error(`open stderr:\n${stderr}`)
  process.exitCode = 1
} finally {
  if (appPid) {
    try {
      process.kill(appPid, 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.error(`failed to stop smoke app: ${String(error)}`)
        process.exitCode = 1
      }
    }
  }
  if (launcher.exitCode === null) launcher.kill('SIGTERM')
  await rm(runtimeDir, { recursive: true, force: true })
}
