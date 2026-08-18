import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

if (process.platform !== 'darwin') {
  console.error('Concurrent Tauri runtime smoke requires macOS')
  process.exit(2)
}

const executable = resolve('src-tauri/target/debug/bundle/macos/Paprv.app/Contents/MacOS/paprv')
const runner = resolve('scripts/tauri-runtime-smoke.mjs')
const unrelatedEnv = { ...process.env }
delete unrelatedEnv.PAPRV_RUNTIME_SMOKE_PATH
const unrelated = spawn(executable, [], { env: unrelatedEnv, stdio: 'ignore' })
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
const collect = (child) => new Promise((resolveChild) => {
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  child.on('exit', (code, signal) => resolveChild({ code, signal, stdout, stderr }))
})

let cleanupFailed = false
try {
  await delay(500)
  if (unrelated.exitCode !== null) throw new Error('unrelated Paprv probe exited before smoke runs')
  const results = await Promise.all([
    collect(spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] })),
    collect(spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] }))
  ])
  for (const result of results) {
    if (result.code !== 0) throw new Error(`concurrent smoke failed: ${result.stderr || result.stdout}`)
  }
  const smokePids = results.map(({ stdout }) => Number(/verified pid (\d+)/.exec(stdout)?.[1]))
  if (smokePids.some((pid) => !Number.isSafeInteger(pid)) || new Set(smokePids).size !== 2) {
    throw new Error('concurrent smoke did not verify two distinct processes')
  }
  if (smokePids.includes(unrelated.pid)) throw new Error('smoke claimed the unrelated Paprv process')
  process.kill(unrelated.pid, 0)
  console.log(`Concurrent runtime smoke passed: smoke pids ${smokePids.join(', ')}; unrelated pid ${unrelated.pid} survived`)
} finally {
  if (unrelated.exitCode === null && unrelated.signalCode === null) {
    unrelated.kill('SIGTERM')
    await Promise.race([once(unrelated, 'exit'), delay(5_000)])
  }
  cleanupFailed = unrelated.exitCode === null && unrelated.signalCode === null
}
if (cleanupFailed) throw new Error('unrelated Paprv probe did not terminate')
