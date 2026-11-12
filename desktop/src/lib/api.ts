// Calls into the Rust side (src-tauri/src/lib.rs). Everything stays on this computer.
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import type { Package, Transcript } from './model'

export const importZip = (path: string) => invoke<string>('import_zip', { path })
export const listPackages = () => invoke<Package[]>('list_packages')
export const deletePackage = (id: string) => invoke<void>('delete_package', { id })
export const saveText = (path: string, text: string) => invoke<void>('save_text', { path, text })
export const readAppFile = (name: string) => invoke<string | null>('read_app_file', { name })
export const writeAppFile = (name: string, text: string) => invoke<void>('write_app_file', { name, text })
export const listZips = (dir: string) => invoke<string[]>('list_zips', { dir })
export const modelStatus = () => invoke<{ installed: boolean; path: string; engine: boolean }>('model_status')
export const installModel = (src: string) => invoke<void>('install_model', { src })

export async function readTranscript(pkg: string, record: string): Promise<Transcript | null> {
  const t = await invoke<string | null>('read_transcript', { pkg, record })
  return t ? (JSON.parse(t) as Transcript) : null
}
export const writeTranscript = (pkg: string, record: string, t: Transcript) => invoke<void>('write_transcript', { pkg, record, json: JSON.stringify(t) })

/** Audio file inside the library, playable by <audio> through Tauri's asset protocol. */
export const audioUrl = (dir: string, file: string) => convertFileSrc(`${dir}/${file}`)

/** Sends the 16 kHz WAV as the raw request body (no JSON encoding of hundreds of MB). */
export const runWhisper = (wav: Uint8Array) => invoke<string>('transcribe', wav)
