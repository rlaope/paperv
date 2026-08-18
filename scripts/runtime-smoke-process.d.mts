export interface RendererReadyMarker {
  marker: string
  pid: number
}

export type ExecutableForPid = (pid: number) => string
export type KillProcess = (pid: number, signal: NodeJS.Signals) => void

export function parseRendererReadyMarker(marker: string): RendererReadyMarker
export function readProcessExecutable(pid: number): string
export function verifySmokeProcessIdentity(
  pid: number,
  expectedExecutable: string,
  executableForPid?: ExecutableForPid
): void
export function terminateVerifiedSmokeProcess(
  pid: number,
  expectedExecutable: string,
  executableForPid?: ExecutableForPid,
  kill?: KillProcess
): void
