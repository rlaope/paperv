import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const releaseBinary = resolve('src-tauri/target/release/paprv')
const binary = await readFile(releaseBinary)
const forbidden = ['runtime_smoke_ready', 'PAPRV_RUNTIME_SMOKE_PATH', 'PAPRV_RENDERER_READY']
const exposed = forbidden.filter((value) => binary.includes(Buffer.from(value)))

if (exposed.length > 0) {
  throw new Error(`release binary exposes debug runtime-smoke surface: ${exposed.join(', ')}`)
}
console.log('Release runtime-smoke gate passed: command, environment seam, and marker are absent')
