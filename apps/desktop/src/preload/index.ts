import { contextBridge, ipcRenderer } from 'electron'
import { ipcContracts, type PaprvApi } from '@paprv/contracts'

const api: PaprvApi = {
  system: {
    getInfo: async () => {
      const response: unknown = await ipcRenderer.invoke(
        ipcContracts.systemGetInfo.channel,
        ipcContracts.systemGetInfo.request.parse({})
      )
      return ipcContracts.systemGetInfo.response.parse(response)
    }
  }
}

contextBridge.exposeInMainWorld('paprv', api)
