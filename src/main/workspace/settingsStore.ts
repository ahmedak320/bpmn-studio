// Persists the chosen workspace root in a small JSON settings file under
// Electron's userData directory. fs + the userData path are injected so
// this is unit-testable without Electron.

import { join } from 'node:path'

export interface SettingsStoreFs {
  readFile(path: string, encoding: 'utf-8'): Promise<string>
  writeFile(path: string, data: string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
}

export interface WorkspaceSettings {
  root: string | null
}

const SETTINGS_FILE = 'workspace-settings.json'

export class SettingsStore {
  private readonly filePath: string

  constructor(
    private readonly fs: SettingsStoreFs,
    userDataDir: string
  ) {
    this.filePath = join(userDataDir, SETTINGS_FILE)
  }

  async read(): Promise<WorkspaceSettings> {
    try {
      const raw = await this.fs.readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>
      return { root: typeof parsed.root === 'string' ? parsed.root : null }
    } catch {
      return { root: null }
    }
  }

  async write(settings: WorkspaceSettings): Promise<void> {
    await this.fs.mkdir(join(this.filePath, '..'), { recursive: true })
    await this.fs.writeFile(this.filePath, JSON.stringify(settings, null, 2))
  }
}
