import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { systemGetInfo } from '../../src/api/system'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const invokeMock = vi.mocked(invoke)

beforeEach(() => invokeMock.mockReset())

describe('system command client', () => {
  it('invokes only system_get_info without a payload and validates its response', async () => {
    invokeMock.mockResolvedValue({ platform: 'macos', version: '0.0.1' })
    await expect(systemGetInfo()).resolves.toEqual({ platform: 'macos', version: '0.0.1' })
    expect(invokeMock).toHaveBeenCalledWith('system_get_info')
  })

  it.each([
    { platform: 'plan9', version: '0.0.1' },
    { platform: 'macos', version: 'secret' },
    { platform: 'macos', version: '0.0.1', extra: true }
  ])('rejects malformed backend output: %j', async (output) => {
    invokeMock.mockResolvedValue(output)
    await expect(systemGetInfo()).rejects.toThrow()
  })
})
