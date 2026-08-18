import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const markerPattern = /^PAPRV_RENDERER_READY:macos:\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?:([1-9]\d*)$/

export function parseRendererReadyMarker(marker) {
  const match = markerPattern.exec(marker)
  const pid = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(pid)) {
    throw new Error('renderer-owned readiness marker was not observed')
  }
  return { marker, pid }
}

export function readProcessExecutable(pid) {
  return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim()
}

export function verifySmokeProcessIdentity(pid, expectedExecutable, executableForPid = readProcessExecutable) {
  let actualExecutable
  try {
    actualExecutable = executableForPid(pid)
  } catch {
    throw new Error('smoke PID is not running')
  }
  if (!actualExecutable || resolve(actualExecutable) !== resolve(expectedExecutable)) {
    throw new Error('smoke PID executable identity mismatch')
  }
}

export function terminateVerifiedSmokeProcess(
  pid,
  expectedExecutable,
  executableForPid = readProcessExecutable,
  kill = process.kill
) {
  verifySmokeProcessIdentity(pid, expectedExecutable, executableForPid)
  kill(pid, 'SIGTERM')
}
