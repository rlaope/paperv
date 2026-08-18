import type { PaprvApi } from '@paprv/contracts'

declare global {
  interface Window { paprv: PaprvApi }
}

export {}
