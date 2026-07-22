import { beforeEach, describe, expect, it, vi } from 'vitest'

let isPackaged = true
let platform = 'win32'

vi.mock('electron', () => {
  return {
    app: {
      isPackaged: true,
      getVersion: () => '0.1.0'
    },
    shell: {
      openExternal: vi.fn()
    },
    Menu: {
      buildFromTemplate: vi.fn()
    }
  }
})

vi.mock('electron-updater', () => {
  return {
    autoUpdater: {
      once: vi.fn(),
      on: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    }
  }
})

describe('buildMenuTemplate', () => {
  beforeEach(() => {
    vi.resetModules()
    isPackaged = true
    platform = 'win32'
    Object.defineProperty(process, 'platform', { value: platform })
  })

  async function loadMenu(): Promise<typeof import('../../src/main/menu')> {
    const electron = await import('electron')
    // @ts-expect-error test-only mutation of the mocked module
    electron.app.isPackaged = isPackaged
    return import('../../src/main/menu')
  }

  it('has File, View, Help top-level menus in order', async () => {
    const { buildMenuTemplate } = await loadMenu()
    const template = buildMenuTemplate(() => null)
    expect(template.map((m) => m.label)).toEqual(['File', 'View', 'Help'])
  })

  it('File menu exposes New Process, Open Workspace Folder, Save, and export items', async () => {
    const { buildMenuTemplate } = await loadMenu()
    const template = buildMenuTemplate(() => null)
    const file = template.find((m) => m.label === 'File')
    const labels = (file?.submenu as Array<{ label?: string }>)
      .map((i) => i.label)
      .filter((l): l is string => Boolean(l))

    expect(labels).toContain('New Process')
    expect(labels).toContain('Open Workspace Folder…')
    expect(labels).toContain('Save')
    expect(labels).toContain('Export as SVG…')
    expect(labels).toContain('Export as PNG…')
  })

  it('File menu has a quit/close role item on the platform-appropriate branch', async () => {
    const { buildMenuTemplate } = await loadMenu()
    const template = buildMenuTemplate(() => null)
    const file = template.find((m) => m.label === 'File')
    const roles = (file?.submenu as Array<{ role?: string }>).map((i) => i.role).filter(Boolean)
    expect(roles).toContain('quit')
  })

  it('View menu exposes reload/zoom/fullscreen roles', async () => {
    const { buildMenuTemplate } = await loadMenu()
    const template = buildMenuTemplate(() => null)
    const view = template.find((m) => m.label === 'View')
    const roles = (view?.submenu as Array<{ role?: string }>).map((i) => i.role).filter(Boolean)
    expect(roles).toEqual(
      expect.arrayContaining(['reload', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen'])
    )
  })

  it('View menu includes toggleDevTools only in dev (unpackaged) builds', async () => {
    isPackaged = true
    let { buildMenuTemplate } = await loadMenu()
    let view = buildMenuTemplate(() => null).find((m) => m.label === 'View')
    let roles = (view?.submenu as Array<{ role?: string }>).map((i) => i.role)
    expect(roles).not.toContain('toggleDevTools')

    vi.resetModules()
    isPackaged = false
    ;({ buildMenuTemplate } = await loadMenu())
    view = buildMenuTemplate(() => null).find((m) => m.label === 'View')
    roles = (view?.submenu as Array<{ role?: string }>).map((i) => i.role)
    expect(roles).toContain('toggleDevTools')
  })

  it('Help menu exposes Check for Updates, a version label, and a GitHub link', async () => {
    const { buildMenuTemplate } = await loadMenu()
    const template = buildMenuTemplate(() => null)
    const help = template.find((m) => m.label === 'Help')
    const labels = (help?.submenu as Array<{ label?: string }>).map((i) => i.label)

    expect(labels).toContain('Check for Updates…')
    expect(labels).toContain('View on GitHub')
    expect(labels?.some((l) => l?.includes('0.1.0'))).toBe(true)
  })
})
