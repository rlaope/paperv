import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

export const systemInfoSchema = z.object({
  platform: z.enum(['macos', 'windows', 'linux']),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
}).strict()

export type SystemInfo = z.infer<typeof systemInfoSchema>

export async function systemGetInfo(): Promise<SystemInfo> {
  return systemInfoSchema.parse(await invoke('system_get_info'))
}
