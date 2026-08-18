import { describe, expect, it } from 'vitest'
import { ipcContracts } from '../../packages/contracts/src/index'

describe('typed IPC contract', () => {
  it('accepts the minimal system info request and response', () => {
    expect(ipcContracts.systemGetInfo.request.parse({})).toEqual({})
    expect(ipcContracts.systemGetInfo.response.parse({ platform: 'darwin', version: '0.0.1' })).toEqual({ platform: 'darwin', version: '0.0.1' })
  })

  it('rejects unknown request fields and unsupported platforms', () => {
    expect(() => ipcContracts.systemGetInfo.request.parse({ secret: 'nope' })).toThrow()
    expect(() => ipcContracts.systemGetInfo.response.parse({ platform: 'plan9', version: '1' })).toThrow()
  })
})
