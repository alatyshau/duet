/*
 * ЧТО: Скачивание шаблона Duet-Instructions с GitHub.
 * ЗАЧЕМ: Onboarding — пользователь получает готовый набор инструкций без git.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC instructions:download-template, instructions:is-folder-empty).
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** GitHub direct-download URL for Duet-Instructions main branch. */
const TEMPLATE_ZIP_URL =
  'https://github.com/alatyshau/Duet-Instructions/archive/refs/heads/main.zip'

/** System files to ignore when checking folder emptiness. */
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitkeep'])

/**
 * Checks if a folder is empty (ignoring system files like .DS_Store).
 * Returns true for non-existent folders.
 */
export function isFolderEmpty(folderPath: string): boolean {
  if (!existsSync(folderPath)) return true
  const entries = readdirSync(folderPath)
  return entries.every((e) => IGNORED_FILES.has(e))
}

/**
 * Downloads Duet-Instructions template from GitHub and extracts to targetFolder.
 * Does NOT set instructionsPath — that's the caller's responsibility.
 *
 * Pipeline: fetch zip -> tmp file -> unzip -> copy contents -> cleanup.
 * Throws on any failure (network, unzip, fs).
 */
export async function downloadInstructionsTemplate(targetFolder: string): Promise<void> {
  mkdirSync(targetFolder, { recursive: true })

  const id = Date.now()
  const tmpZip = join(tmpdir(), `duet-instructions-${id}.zip`)
  const tmpExtract = join(tmpdir(), `duet-instructions-${id}`)

  try {
    // 1. Download zip
    const res = await fetch(TEMPLATE_ZIP_URL, {
      signal: AbortSignal.timeout(60_000)
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    writeFileSync(tmpZip, buffer)

    // 2. Extract to tmp dir
    mkdirSync(tmpExtract, { recursive: true })
    await unzip(tmpZip, tmpExtract)

    // 3. Find extracted root dir (GitHub wraps in Duet-Instructions-main/)
    const extracted = readdirSync(tmpExtract).filter((e) => !IGNORED_FILES.has(e))
    if (extracted.length !== 1) {
      throw new Error('Unexpected archive structure')
    }
    const sourceDir = join(tmpExtract, extracted[0])

    // 4. Copy contents to target folder
    for (const entry of readdirSync(sourceDir)) {
      cpSync(join(sourceDir, entry), join(targetFolder, entry), { recursive: true })
    }
  } finally {
    // 5. Cleanup tmp files
    if (existsSync(tmpZip)) rmSync(tmpZip, { force: true })
    if (existsSync(tmpExtract)) rmSync(tmpExtract, { recursive: true, force: true })
  }
}

/**
 * Platform-specific unzip. macOS: unzip, Windows: tar -xf.
 */
async function unzip(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir])
  } else {
    await execFileAsync('unzip', ['-o', zipPath, '-d', destDir])
  }
}
