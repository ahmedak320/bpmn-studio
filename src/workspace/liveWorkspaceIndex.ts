import BpmnModdle from 'bpmn-moddle'

import { parseProcessesFromXml, type ProcessEntry, type ProcessIndex } from '@/core/processIndex'
import { orbitpmModdleDescriptor } from '../org/orbitpmModdle'
import { validateBpmnXml, type ParsedBpmnValidation, type ValidationSource } from '../validation'
import { buildSearchDoc, type SearchDoc } from './searchIndex'

export interface LiveWorkspaceFile {
  relPath: string
  xml: string
  lastModified: number
  size: number
}

export interface DuplicateProcessOccurrence {
  processId: string
  relPath: string
  /** Zero-based occurrence within the physical file. */
  occurrence: number
  processName?: string
}

export interface DuplicateProcessDiagnostic {
  processId: string
  paths: string[]
  occurrences: DuplicateProcessOccurrence[]
}

export interface DuplicateProcessRepair {
  relPath: string
  previousProcessId: string
  processId: string
  xml: string
}

/**
 * Exact state of the repair target when its candidate XML was prepared.
 *
 * `pathRevision` is deliberately path-scoped: unrelated workspace updates do
 * not invalidate a prepared repair, while delete/reopen and change-away/change-
 * back (ABA) races on this path do.
 */
export interface DuplicateProcessRepairTargetState {
  readonly relPath: string
  readonly pathRevision: number
  readonly effectiveXml: string
  readonly dirtyXml: string | null
  readonly saved: Readonly<LiveWorkspaceFile> | null
}

/**
 * Purely prepared duplicate-id rewrite. Call `commitDuplicateProcessIdRepair`
 * only after any additional asynchronous validation/UI coordination has
 * completed.
 */
export interface PreparedDuplicateProcessRepair {
  readonly relPath: string
  readonly previousProcessId: string
  readonly processId: string
  readonly xml: string
  readonly target: Readonly<DuplicateProcessRepairTargetState>
}

interface IndexedFile {
  saved?: LiveWorkspaceFile
  dirtyXml?: string
  processes: ProcessEntry[]
  search: SearchDoc
}

const XML_NCNAME_RE = /^[A-Za-z_][A-Za-z0-9._-]*$/
const REPAIR_GATE_SOURCES = new Set<ValidationSource>(['xml', 'moddle', 'structure', 'di'])

interface RepairModdleElement {
  $type?: string
  id?: string
  rootElements?: RepairModdleElement[]
  [key: string]: unknown
}

interface RepairModdle {
  toXML(
    root: RepairModdleElement,
    options: { format: boolean; preamble: boolean }
  ): Promise<{ xml: string }>
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function normalizedFile(file: LiveWorkspaceFile): LiveWorkspaceFile {
  return {
    relPath: file.relPath,
    xml: file.xml,
    lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0,
    size: Number.isFinite(file.size) && file.size >= 0 ? file.size : byteLength(file.xml)
  }
}

function sameFile(
  current: LiveWorkspaceFile | undefined,
  expected: Readonly<LiveWorkspaceFile> | null
): boolean {
  if (!current || !expected) return current === undefined && expected === null
  return (
    current.relPath === expected.relPath &&
    current.xml === expected.xml &&
    current.lastModified === expected.lastModified &&
    current.size === expected.size
  )
}

function effectiveFile(path: string, entry: IndexedFile): LiveWorkspaceFile {
  const saved = entry.saved
  const xml = entry.dirtyXml ?? saved?.xml ?? ''
  return {
    relPath: path,
    xml,
    lastModified: saved?.lastModified ?? 0,
    size: entry.dirtyXml === undefined ? (saved?.size ?? byteLength(xml)) : byteLength(xml)
  }
}

function indexFile(file: LiveWorkspaceFile): IndexedFile {
  return {
    saved: file,
    processes: parseProcessesFromXml(file.xml, file.relPath),
    search: buildSearchDoc(file)
  }
}

function comparePath(left: string, right: string): number {
  return left.localeCompare(right, 'en-US')
}

function assertProcessId(value: string): void {
  if (!XML_NCNAME_RE.test(value)) {
    throw new Error(
      `Process id "${value}" must be an XML NCName (letters, digits, ".", "_", or "-").`
    )
  }
}

function topLevelProcesses(definitions: RepairModdleElement): RepairModdleElement[] {
  return (definitions.rootElements ?? []).filter((element) => element.$type === 'bpmn:Process')
}

function repairValidationDetails(validation: ParsedBpmnValidation): string {
  const issues = validation.summary.issues.filter(
    (issue) => issue.blocking && REPAIR_GATE_SOURCES.has(issue.source)
  )
  return issues
    .slice(0, 6)
    .map((issue) => issue.code)
    .join(', ')
}

function assertRepairValidation(
  validation: ParsedBpmnValidation,
  phase: 'before' | 'after'
): RepairModdleElement {
  const details = repairValidationDetails(validation)
  if (!validation.definitions || !validation.summary.xmlWellFormed || details) {
    throw new Error(
      `Duplicate process-id repair failed ${phase} secure BPMN validation${
        details ? ` (${details})` : ''
      }.`
    )
  }
  return validation.definitions as RepairModdleElement
}

function fallbackBase(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
  return cleaned || 'Process'
}

/**
 * Mutable, application-owned projection of saved files plus live dirty XML.
 *
 * One file update reparses only that file. Callers may then use `files()`,
 * `processIndex()`, and `searchDocuments()` as coherent snapshots for catalog,
 * links, owners, unresolved references, and assistant retrieval. Duplicate
 * process ids are deliberately omitted from the safe process index.
 */
export class LiveWorkspaceIndex {
  private readonly byPath = new Map<string, IndexedFile>()
  private readonly declarations = new Map<string, DuplicateProcessOccurrence[]>()
  private readonly pathRevisions = new Map<string, number>()
  private pathRevisionSequence = 0
  private revision = 0

  constructor(files: readonly LiveWorkspaceFile[] = []) {
    this.replaceSavedFiles(files)
  }

  get version(): number {
    return this.revision
  }

  replaceSavedFiles(files: readonly LiveWorkspaceFile[]): void {
    const touchedPaths = new Set(this.byPath.keys())
    const dirty = new Map<string, string>()
    for (const [path, entry] of this.byPath) {
      if (entry.dirtyXml !== undefined) dirty.set(path, entry.dirtyXml)
    }

    this.byPath.clear()
    for (const input of files) {
      const file = normalizedFile(input)
      touchedPaths.add(file.relPath)
      this.byPath.set(file.relPath, indexFile(file))
    }
    for (const [path, xml] of dirty) {
      const entry = this.byPath.get(path)
      if (entry) {
        entry.dirtyXml = xml
        this.reindex(path, entry)
      } else {
        const dirtyOnly = indexFile({
          relPath: path,
          xml,
          lastModified: 0,
          size: byteLength(xml)
        })
        dirtyOnly.saved = undefined
        dirtyOnly.dirtyXml = xml
        this.byPath.set(path, dirtyOnly)
      }
    }
    this.rebuildDeclarations()
    for (const path of touchedPaths) this.bumpPathRevision(path)
    this.revision += 1
  }

  updateSaved(fileInput: LiveWorkspaceFile): void {
    const file = normalizedFile(fileInput)
    const current = this.byPath.get(file.relPath)
    if (!current) {
      const added = indexFile(file)
      this.byPath.set(file.relPath, added)
      this.addDeclarations(added.processes)
    } else {
      this.removeDeclarations(current.processes)
      current.saved = file
      this.reindex(file.relPath, current)
      this.addDeclarations(current.processes)
    }
    this.bumpPathRevision(file.relPath)
    this.revision += 1
  }

  removeSaved(path: string): void {
    const current = this.byPath.get(path)
    if (!current) return
    if (current.dirtyXml !== undefined) {
      current.saved = undefined
      this.bumpPathRevision(path)
      this.revision += 1
      return
    }
    this.removeDeclarations(current.processes)
    this.byPath.delete(path)
    this.bumpPathRevision(path)
    this.revision += 1
  }

  updateDirty(path: string, xml: string): void {
    let current = this.byPath.get(path)
    if (!current) {
      const file: LiveWorkspaceFile = {
        relPath: path,
        xml,
        lastModified: 0,
        size: byteLength(xml)
      }
      current = indexFile(file)
      current.saved = undefined
      current.dirtyXml = xml
      this.byPath.set(path, current)
      this.addDeclarations(current.processes)
      this.bumpPathRevision(path)
      this.revision += 1
      return
    }
    if (current.dirtyXml === xml) return
    this.removeDeclarations(current.processes)
    current.dirtyXml = xml
    this.reindex(path, current)
    this.addDeclarations(current.processes)
    this.bumpPathRevision(path)
    this.revision += 1
  }

  clearDirty(path: string): void {
    const current = this.byPath.get(path)
    if (!current || current.dirtyXml === undefined) return
    this.removeDeclarations(current.processes)
    current.dirtyXml = undefined
    if (!current.saved) {
      this.byPath.delete(path)
    } else {
      this.reindex(path, current)
      this.addDeclarations(current.processes)
    }
    this.bumpPathRevision(path)
    this.revision += 1
  }

  move(from: string, to: string): void {
    if (from === to) return
    if (this.byPath.has(to)) {
      throw new Error(`Workspace index destination "${to}" already exists.`)
    }
    const current = this.byPath.get(from)
    if (!current) return
    this.removeDeclarations(current.processes)
    this.byPath.delete(from)
    if (current.saved) current.saved = { ...current.saved, relPath: to }
    this.reindex(to, current)
    this.byPath.set(to, current)
    this.addDeclarations(current.processes)
    this.bumpPathRevision(from)
    this.bumpPathRevision(to)
    this.revision += 1
  }

  files(): LiveWorkspaceFile[] {
    return [...this.byPath.entries()]
      .map(([path, entry]) => effectiveFile(path, entry))
      .sort((left, right) => comparePath(left.relPath, right.relPath))
  }

  searchDocuments(): SearchDoc[] {
    return [...this.byPath.entries()]
      .sort(([left], [right]) => comparePath(left, right))
      .map(([, entry]) => entry.search)
  }

  processIndex(): ProcessIndex {
    const index: ProcessIndex = new Map()
    for (const [processId, occurrences] of this.declarations) {
      if (occurrences.length !== 1) continue
      const occurrence = occurrences[0]
      index.set(processId, {
        processId,
        processName: occurrence.processName,
        relPath: occurrence.relPath
      })
    }
    return index
  }

  duplicateDiagnostics(): DuplicateProcessDiagnostic[] {
    const diagnostics: DuplicateProcessDiagnostic[] = []
    for (const [processId, occurrences] of this.declarations) {
      if (occurrences.length < 2) continue
      const sorted = [...occurrences].sort((left, right) => {
        const pathOrder = comparePath(left.relPath, right.relPath)
        return pathOrder || left.occurrence - right.occurrence
      })
      diagnostics.push({
        processId,
        paths: [...new Set(sorted.map((item) => item.relPath))],
        occurrences: sorted
      })
    }
    return diagnostics.sort((left, right) => left.processId.localeCompare(right.processId))
  }

  allocateProcessId(preferred = 'Process'): string {
    const base = fallbackBase(preferred)
    if (!this.declarations.has(base)) return base
    for (let suffix = 2; suffix <= 1_000_000; suffix += 1) {
      const candidate = `${base}_${suffix}`
      if (!this.declarations.has(candidate)) return candidate
    }
    throw new Error(`Could not allocate a unique process id for "${preferred}".`)
  }

  async repairDuplicateProcessId(
    relPath: string,
    duplicateId: string,
    options: { occurrence?: number; processId?: string } = {}
  ): Promise<DuplicateProcessRepair> {
    const prepared = await this.prepareDuplicateProcessIdRepair(relPath, duplicateId, options)
    return this.commitDuplicateProcessIdRepair(prepared)
  }

  async prepareDuplicateProcessIdRepair(
    relPath: string,
    duplicateId: string,
    options: { occurrence?: number; processId?: string } = {}
  ): Promise<PreparedDuplicateProcessRepair> {
    const diagnostic = this.duplicateDiagnostics().find((item) => item.processId === duplicateId)
    if (!diagnostic) {
      throw new Error(`Process id "${duplicateId}" is not duplicated.`)
    }
    const occurrence = options.occurrence ?? 0
    const target = diagnostic.occurrences.find(
      (item) => item.relPath === relPath && item.occurrence === occurrence
    )
    if (!target) {
      throw new Error(
        `Duplicate process id "${duplicateId}" occurrence ${occurrence} was not found in "${relPath}".`
      )
    }
    const processId = options.processId ?? this.allocateProcessId(`${duplicateId}_copy`)
    assertProcessId(processId)
    if (this.declarations.has(processId)) {
      throw new Error(`Process id "${processId}" already exists.`)
    }

    const entry = this.byPath.get(relPath)
    if (!entry) throw new Error(`Workspace file "${relPath}" was not found.`)
    const source = effectiveFile(relPath, entry).xml
    const targetState = Object.freeze({
      relPath,
      pathRevision: this.pathRevisions.get(relPath) ?? 0,
      effectiveXml: source,
      dirtyXml: entry.dirtyXml ?? null,
      saved: entry.saved ? Object.freeze({ ...entry.saved }) : null
    }) satisfies Readonly<DuplicateProcessRepairTargetState>

    // Validate the exact current bytes before parsing/mutating them. This runs
    // the secure XML preflight, bpmn-moddle import, structural references, and
    // DI gates. Semantic authoring warnings may pre-exist, but unsafe,
    // malformed, unresolved-IDREF, structural, and DI inputs are never
    // rewritten.
    const knownProcessIds = [...this.declarations.keys(), processId]
    const before = await validateBpmnXml(source, { knownProcessIds })
    if (!before.definitions || !before.summary.xmlWellFormed) {
      assertRepairValidation(before, 'before')
    }
    const definitions = before.definitions as RepairModdleElement
    const processes = topLevelProcesses(definitions)
    const matches = processes.filter((process) => process.id === duplicateId)
    if (matches.length > 1) {
      throw new Error(
        `Process id "${duplicateId}" is ambiguous in "${relPath}"; repair one process per file.`
      )
    }
    if (matches.length !== 1 || occurrence !== 0) {
      throw new Error(
        `Process id "${duplicateId}" occurrence ${occurrence} could not be repaired in "${relPath}".`
      )
    }
    assertRepairValidation(before, 'before')

    // Moddle represents BPMN IDREF attributes as object references. Mutating
    // the selected Process object therefore updates every reference that
    // points to it during serialization, including Participant.processRef and
    // BPMNPlane.bpmnElement, without touching unrelated element IDs.
    const beforeProcessIds = processes.map((process) => process.id)
    matches[0].id = processId
    const moddle = new BpmnModdle({
      orbitpm: orbitpmModdleDescriptor as unknown as Record<string, unknown>
    }) as unknown as RepairModdle
    const xml = (await moddle.toXML(definitions, { format: true, preamble: true })).xml

    const after = await validateBpmnXml(xml, { knownProcessIds })
    const afterDefinitions = assertRepairValidation(after, 'after')
    const afterProcessIds = topLevelProcesses(afterDefinitions).map((process) => process.id)
    const expectedProcessIds = beforeProcessIds.map((id) => (id === duplicateId ? processId : id))
    if (
      afterProcessIds.length !== expectedProcessIds.length ||
      afterProcessIds.some((id, index) => id !== expectedProcessIds[index])
    ) {
      throw new Error('Duplicate process-id repair changed an unintended process id.')
    }

    return Object.freeze({
      relPath,
      previousProcessId: duplicateId,
      processId,
      xml,
      target: targetState
    })
  }

  commitDuplicateProcessIdRepair(prepared: PreparedDuplicateProcessRepair): DuplicateProcessRepair {
    const { relPath, processId, target } = prepared
    const current = this.byPath.get(relPath)
    const currentPathRevision = this.pathRevisions.get(relPath) ?? 0
    const targetMatches =
      target.relPath === relPath &&
      current !== undefined &&
      currentPathRevision === target.pathRevision &&
      (current.dirtyXml ?? null) === target.dirtyXml &&
      sameFile(current.saved, target.saved) &&
      effectiveFile(relPath, current).xml === target.effectiveXml

    if (!targetMatches) {
      throw new Error(
        `Workspace file "${relPath}" changed after duplicate process-id repair preparation; repair was not committed.`
      )
    }
    assertProcessId(processId)
    if (this.declarations.has(processId)) {
      throw new Error(
        `Process id "${processId}" already exists; duplicate process-id repair was not committed.`
      )
    }

    this.updateDirty(relPath, prepared.xml)
    return {
      relPath,
      previousProcessId: prepared.previousProcessId,
      processId,
      xml: prepared.xml
    }
  }

  private reindex(path: string, entry: IndexedFile): void {
    const file = effectiveFile(path, entry)
    entry.processes = parseProcessesFromXml(file.xml, path)
    entry.search = buildSearchDoc(file)
  }

  private bumpPathRevision(path: string): void {
    this.pathRevisionSequence += 1
    this.pathRevisions.set(path, this.pathRevisionSequence)
  }

  private rebuildDeclarations(): void {
    this.declarations.clear()
    for (const entry of this.byPath.values()) this.addDeclarations(entry.processes)
  }

  private addDeclarations(processes: readonly ProcessEntry[]): void {
    const occurrenceById = new Map<string, number>()
    for (const process of processes) {
      const occurrence = occurrenceById.get(process.processId) ?? 0
      occurrenceById.set(process.processId, occurrence + 1)
      const item: DuplicateProcessOccurrence = {
        processId: process.processId,
        relPath: process.relPath,
        occurrence,
        processName: process.processName
      }
      const existing = this.declarations.get(process.processId)
      if (existing) existing.push(item)
      else this.declarations.set(process.processId, [item])
    }
  }

  private removeDeclarations(processes: readonly ProcessEntry[]): void {
    const countsById = new Map<string, number>()
    for (const process of processes) {
      countsById.set(process.processId, (countsById.get(process.processId) ?? 0) + 1)
    }
    for (const [processId, count] of countsById) {
      const existing = this.declarations.get(processId)
      if (!existing) continue
      const removeByPath = new Map<string, number>()
      for (const process of processes) {
        if (process.processId !== processId) continue
        removeByPath.set(process.relPath, (removeByPath.get(process.relPath) ?? 0) + 1)
      }
      const retained = existing.filter((occurrence) => {
        const remaining = removeByPath.get(occurrence.relPath) ?? 0
        if (remaining === 0) return true
        removeByPath.set(occurrence.relPath, remaining - 1)
        return false
      })
      if (retained.length === 0 || retained.length === existing.length - count) {
        if (retained.length === 0) this.declarations.delete(processId)
        else this.declarations.set(processId, retained)
      } else {
        this.rebuildDeclarations()
        return
      }
    }
  }
}

export function uniqueFallbackProcessId(
  existingIds: Iterable<string>,
  preferred = 'Process'
): string {
  const taken = new Set(existingIds)
  const base = fallbackBase(preferred)
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix <= 1_000_000; suffix += 1) {
    const candidate = `${base}_${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`Could not allocate a unique process id for "${preferred}".`)
}
