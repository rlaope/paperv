import { z } from 'zod'

export const IPC_CHANNELS = {
  systemGetInfo: 'system:get-info'
} as const

const emptyRequest = z.object({}).strict()
const systemInfo = z.object({
  platform: z.enum(['darwin', 'win32', 'linux']),
  version: z.string().min(1)
}).strict()

export const ipcContracts = {
  systemGetInfo: { channel: IPC_CHANNELS.systemGetInfo, request: emptyRequest, response: systemInfo }
} as const

export type SystemInfo = z.infer<typeof systemInfo>
export interface PaprvApi {
  system: { getInfo: () => Promise<SystemInfo> }
}
