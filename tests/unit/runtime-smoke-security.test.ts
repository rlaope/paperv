import { describe, expect, it, vi } from 'vitest'
import {
  parseRendererReadyMarker,
  verifySmokeProcessIdentity,
  terminateVerifiedSmokeProcess
} from '../../scripts/runtime-smoke-process.mjs'

const expectedExecutable = '/tmp/Paprv.app/Contents/MacOS/paprv'

describe('runtime smoke process ownership', () => {
  it('accepts an exact renderer marker with a valid PID', () => {
    expect(parseRendererReadyMarker('PAPRV_RENDERER_READY:macos:0.0.1:4242')).toEqual({
      marker: 'PAPRV_RENDERER_READY:macos:0.0.1:4242',
      pid: 4242
    })
  })

  it.each([
    'PAPRV_RENDERER_READY:macos:0.0.1',
    'PAPRV_RENDERER_READY:macos:0.0.1:0',
    'PAPRV_RENDERER_READY:macos:0.0.1:-1',
    'PAPRV_RENDERER_READY:macos:0.0.1:12x',
    'PAPRV_RENDERER_READY:linux:0.0.1:42',
    'PAPRV_RENDERER_READY:macos:0.0.1:42\n'
  ])('rejects invalid or spoofable marker %j', (marker) => {
    expect(() => parseRendererReadyMarker(marker)).toThrow('renderer-owned readiness marker was not observed')
  })

  it('rejects a PID whose executable is not the launched bundle', () => {
    expect(() => verifySmokeProcessIdentity(4242, expectedExecutable, () => '/Applications/Paprv.app/Contents/MacOS/paprv'))
      .toThrow('smoke PID executable identity mismatch')
  })

  it('terminates only the PID after executable identity verification', () => {
    const kill = vi.fn()
    terminateVerifiedSmokeProcess(4242, expectedExecutable, () => expectedExecutable, kill)
    expect(kill).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM')
  })

  it('does not terminate a spoofed unrelated PID', () => {
    const kill = vi.fn()
    expect(() => terminateVerifiedSmokeProcess(4242, expectedExecutable, () => '/usr/bin/false', kill))
      .toThrow('smoke PID executable identity mismatch')
    expect(kill).not.toHaveBeenCalled()
  })
})
