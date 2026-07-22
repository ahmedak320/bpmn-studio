// AI + provider-settings IPC surface for the main process.
//
// Registers three groups of handlers via a single register function pushed
// into index.ts's REGISTRATIONS array:
//   - secrets:*            (B4 vault: getStatus/getKeys/setKey/deleteKey)
//   - providers:available  (B4 registry)
//   - ai:generate          (this lane: adapter -> pipeline -> workspace file)
//   - ai:testConnection    (this lane: minimal 1-token reachability call)
//
// All LLM calls run here in main (keys never enter the renderer). Failures are
// turned into short, user-friendly strings for the renderer while the full
// detail (stack, provider/model, description) is appended to
// <userData>/logs/ai.log.

import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { generateText } from 'ai'

import { generateFromDescription } from '../../gen'
import { availableProviders, createModel, makeCallLLM, type CallLLMResult } from '../providers'
import * as secrets from '../secrets'
import type { ProviderId } from '../../shared/providers'
import { slugify, dedupeSlug } from '../../shared/slug'
import { writeFileText, createFolder } from '../workspace/fsOps'
import { resolveWithinRoot } from '../workspace/pathGuard'
import { SettingsStore } from '../workspace/settingsStore'
import { bridgeCallLLM, classifyError } from './adapter'
// E2E-only fake-LLM hook (see fakeLlm.ts). All three helpers are inert unless
// ORBITPM_E2E_FAKE_LLM is set; they let the Playwright suite exercise the AI
// path with no network/keys. Nothing else in this file's real behavior changes.
import { isFakeLlmEnabled, makeFakeCallLLM, fakeAvailableProviders } from './fakeLlm'
import {
  AI_CHANNELS,
  PROVIDER_CHANNELS,
  SECRETS_CHANNELS,
  type AiProgress,
  type GenerateRequest,
  type GenerateResult,
  type TestConnectionResult
} from './ipcContract'

// --- workspace root (read from the same settings file B1's workspace uses) ---

async function getWorkspaceRoot(): Promise<string | null> {
  const store = new SettingsStore(fs, app.getPath('userData'))
  const { root } = await store.read()
  return root
}

/** Bare `.bpmn` slugs (lowercased, no extension) already present in a folder. */
async function takenSlugsIn(root: string, targetFolder: string): Promise<Set<string>> {
  const taken = new Set<string>()
  let dirAbs: string
  try {
    dirAbs = resolveWithinRoot(root, targetFolder)
  } catch {
    return taken // guard rejects — caller's write will fail with the real reason
  }
  let entries: string[]
  try {
    entries = await fs.readdir(dirAbs)
  } catch {
    return taken // folder does not exist yet: nothing taken
  }
  for (const name of entries) {
    const lower = name.toLowerCase()
    if (lower.endsWith('.bpmn')) taken.add(lower.slice(0, -'.bpmn'.length))
  }
  return taken
}

// --- error logging ----------------------------------------------------------

function errorDetail(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

async function appendAiLog(kind: string, context: unknown, error: unknown): Promise<void> {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    await fs.mkdir(dir, { recursive: true })
    let ctx: string
    try {
      ctx = JSON.stringify(context)
    } catch {
      ctx = String(context)
    }
    const line = `[${new Date().toISOString()}] ${kind} ${ctx}\n${errorDetail(error)}\n\n`
    await fs.appendFile(join(dir, 'ai.log'), line, 'utf8')
  } catch {
    // Logging must never break the flow.
  }
}

// --- generation --------------------------------------------------------------

function sendProgress(win: BrowserWindow, progress: AiProgress): void {
  if (!win.isDestroyed()) {
    win.webContents.send(AI_CHANNELS.progress, progress)
  }
}

function relJoin(targetFolder: string, fileName: string): string {
  const folder = targetFolder.replace(/^\/+|\/+$/g, '')
  return folder ? `${folder}/${fileName}` : fileName
}

async function handleGenerate(
  win: BrowserWindow,
  req: GenerateRequest
): Promise<GenerateResult> {
  const description = (req.description ?? '').trim()
  if (!description) {
    return { ok: false, error: 'Enter a description of the process to generate.' }
  }

  const root = await getWorkspaceRoot()
  if (!root) {
    return { ok: false, error: 'No workspace folder is selected yet.' }
  }

  let usedFallback = false
  const onResult = (r: CallLLMResult): void => {
    if (r.usedFallback) usedFallback = true
  }

  try {
    sendProgress(win, { stage: 'contacting-model' })
    // E2E fake-LLM hook: when enabled, bypass the real provider and return a
    // deterministic fixture IR chosen by a [fixture:NAME] marker in `description`.
    const call = isFakeLlmEnabled()
      ? makeFakeCallLLM(description)
      : bridgeCallLLM(makeCallLLM(req.providerId, req.modelId), onResult)
    const { layoutedXml } = await generateFromDescription(call, description)

    sendProgress(win, { stage: 'writing-file' })
    const baseName = (req.name ?? '').trim() || description
    const baseSlug = slugify(baseName.slice(0, 80))
    const taken = await takenSlugsIn(root, req.targetFolder)
    const finalSlug = dedupeSlug(baseSlug, (candidate) => taken.has(candidate.toLowerCase()))

    // Make sure the target folder exists (it normally does — it came from the
    // tree — but a freshly-typed path or a since-deleted folder shouldn't 500).
    if (req.targetFolder) {
      await createFolder(root, req.targetFolder)
    }

    const relPath = relJoin(req.targetFolder, `${finalSlug}.bpmn`)
    await writeFileText(root, relPath, layoutedXml)

    return { ok: true, relPath, usedFallback }
  } catch (err) {
    await appendAiLog(
      'ai:generate',
      { providerId: req.providerId, modelId: req.modelId, targetFolder: req.targetFolder, name: req.name },
      err
    )
    const classified = classifyError(err)
    return { ok: false, error: classified.message, offline: classified.offline, usedFallback }
  }
}

async function handleTestConnection(
  providerId: ProviderId,
  modelId: string
): Promise<TestConnectionResult> {
  try {
    const model = await createModel(providerId, modelId)
    // Cheapest possible reachability probe: one output token.
    await generateText({ model, prompt: 'ping', maxOutputTokens: 1 })
    return { ok: true, message: 'Connection OK.' }
  } catch (err) {
    await appendAiLog('ai:testConnection', { providerId, modelId }, err)
    return { ok: false, message: classifyError(err).message }
  }
}

/**
 * Registers every AI/settings/provider IPC handler. Pushed into index.ts's
 * REGISTRATIONS array (called once per app lifetime with the main window).
 */
export function registerAiIpc(mainWindow: BrowserWindow): void {
  // Secrets vault (B4).
  ipcMain.handle(SECRETS_CHANNELS.getStatus, () => secrets.getStatus())
  ipcMain.handle(SECRETS_CHANNELS.getKeys, (_e: IpcMainInvokeEvent, providerId: ProviderId) =>
    secrets.getKeys(providerId)
  )
  ipcMain.handle(
    SECRETS_CHANNELS.setKey,
    (_e: IpcMainInvokeEvent, providerId: ProviderId, fields: Record<string, string>) =>
      secrets.setKey(providerId, fields)
  )
  ipcMain.handle(SECRETS_CHANNELS.deleteKey, (_e: IpcMainInvokeEvent, providerId: ProviderId) =>
    secrets.deleteKey(providerId)
  )

  // Provider registry (B4). E2E fake-LLM hook: report a single fake-configured
  // provider so the AI panel enables without any real keys (gated on the env var).
  ipcMain.handle(PROVIDER_CHANNELS.available, () =>
    isFakeLlmEnabled() ? fakeAvailableProviders() : availableProviders()
  )

  // AI (this lane).
  ipcMain.handle(AI_CHANNELS.generate, (_e: IpcMainInvokeEvent, req: GenerateRequest) =>
    handleGenerate(mainWindow, req)
  )
  ipcMain.handle(
    AI_CHANNELS.testConnection,
    (_e: IpcMainInvokeEvent, providerId: ProviderId, modelId: string) =>
      handleTestConnection(providerId, modelId)
  )
}
