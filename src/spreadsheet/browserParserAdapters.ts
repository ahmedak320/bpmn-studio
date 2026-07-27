import SpreadsheetParserWorker from './spreadsheet.worker?worker&inline'

import { createRetainedInlineWorker } from '../workers/inlineWorker'
import type {
  CsvParserAdapter,
  ParsedWorkbookData,
  SpreadsheetParseOptions,
  SpreadsheetValidationIssue,
  XlsxParserAdapter
} from './contracts'
import { parseCsvWorkbookBoundary } from './csv'
import { SpreadsheetError, throwIfAborted } from './errors'
import { validateSpreadsheetInput } from './fileFormat'
import { parseXlsxBoundary, type WorkbookBoundaryResult } from './workbookBoundary'
import type { SpreadsheetWorkerParseRequest, SpreadsheetWorkerResponse } from './workerProtocol'

interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  terminate(): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SpreadsheetWorkerResponse>) => void
  ): void
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<SpreadsheetWorkerResponse>) => void
  ): void
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void
}

export type SpreadsheetWorkerFactory = () => WorkerLike

let requestSequence = 0

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function nextRequestId(): string {
  requestSequence += 1
  return `spreadsheet-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

export const createSpreadsheetWorker: SpreadsheetWorkerFactory = () =>
  createRetainedInlineWorker(
    () =>
      new SpreadsheetParserWorker({
        name: 'orbitpm-spreadsheet-parser'
      })
  )

async function runWorker(
  request: Omit<SpreadsheetWorkerParseRequest, 'requestId'>,
  options: SpreadsheetParseOptions,
  workerFactory: SpreadsheetWorkerFactory
): Promise<SpreadsheetWorkerResponse> {
  throwIfAborted(options.signal)
  const worker = workerFactory()
  const requestId = nextRequestId()
  const copiedBytes = request.bytes.slice(0)

  return new Promise<SpreadsheetWorkerResponse>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
      callback()
    }
    const onAbort = (): void => {
      try {
        worker.postMessage({ type: 'cancel', requestId })
      } finally {
        finish(() => reject(new SpreadsheetError('parse-cancelled')))
      }
    }
    const onMessage = (event: MessageEvent<SpreadsheetWorkerResponse>): void => {
      const response = event.data
      if (!response || response.requestId !== requestId) return
      if (response.type === 'progress') {
        options.onProgress?.(response.progress)
        return
      }
      if (response.type === 'error') {
        finish(() => reject(new SpreadsheetError(response.code, { ...response.details })))
        return
      }
      finish(() => resolve(response))
    }
    const onError = (): void => {
      finish(() =>
        reject(
          new SpreadsheetError('adapter-contract-violation', {
            contract: 'spreadsheet-worker-crash'
          })
        )
      )
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ ...request, requestId, bytes: copiedBytes }, [copiedBytes])
  })
}

export class BrowserXlsxParserAdapter implements XlsxParserAdapter {
  constructor(private readonly workerFactory: SpreadsheetWorkerFactory = createSpreadsheetWorker) {}

  async parseDisplayedValues(
    bytes: Uint8Array,
    options: SpreadsheetParseOptions
  ): Promise<ParsedWorkbookData> {
    const response = await runWorker(
      {
        type: 'parse',
        format: 'xlsx',
        bytes: copyArrayBuffer(bytes)
      },
      options,
      this.workerFactory
    )
    if (response.type !== 'result' || response.format !== 'xlsx') {
      throw new SpreadsheetError('adapter-contract-violation', {
        contract: 'xlsx-worker-result'
      })
    }
    return response.workbook
  }
}

export class BrowserCsvParserAdapter implements CsvParserAdapter {
  constructor(private readonly workerFactory: SpreadsheetWorkerFactory = createSpreadsheetWorker) {}

  async parseUtf8(
    bytes: Uint8Array,
    options: SpreadsheetParseOptions & { readonly delimiter: string }
  ): Promise<readonly (readonly string[])[]> {
    const response = await runWorker(
      {
        type: 'parse',
        format: 'csv',
        delimiter: options.delimiter,
        bytes: copyArrayBuffer(bytes)
      },
      options,
      this.workerFactory
    )
    if (response.type !== 'result' || response.format !== 'csv') {
      throw new SpreadsheetError('adapter-contract-violation', {
        contract: 'csv-worker-result'
      })
    }
    return response.rows
  }
}

export interface BrowserSpreadsheetParseResult {
  readonly format: 'xlsx' | 'csv'
  readonly workbook: ParsedWorkbookData
  readonly issues: readonly SpreadsheetValidationIssue[]
  readonly xlsx?: WorkbookBoundaryResult['preflight']
}

export interface ParseBrowserSpreadsheetOptions extends SpreadsheetParseOptions {
  readonly delimiter?: string
  readonly worksheetName?: string
  readonly xlsxAdapter?: XlsxParserAdapter
  readonly csvAdapter?: CsvParserAdapter
}

export async function parseBrowserSpreadsheet(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
  options: ParseBrowserSpreadsheetOptions = {}
): Promise<BrowserSpreadsheetParseResult> {
  throwIfAborted(options.signal)
  const format = validateSpreadsheetInput(file.name, file.size)
  const bytes = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(options.signal)
  // Recheck the bytes supplied by the browser so the worker boundary remains
  // safe even if a non-native File-like object reports inconsistent metadata.
  validateSpreadsheetInput(file.name, bytes.length)
  if (format === 'xlsx') {
    const result = await parseXlsxBoundary(
      file.name,
      bytes,
      options.xlsxAdapter ?? new BrowserXlsxParserAdapter(),
      options
    )
    return Object.freeze({
      format,
      workbook: result.workbook,
      issues: result.issues,
      xlsx: result.preflight
    })
  }

  const workbook = await parseCsvWorkbookBoundary(
    file.name,
    bytes,
    options.worksheetName ?? 'CSV',
    {
      ...options,
      delimiter: options.delimiter,
      adapter: options.csvAdapter ?? new BrowserCsvParserAdapter()
    }
  )
  return Object.freeze({
    format,
    workbook,
    issues: Object.freeze([])
  })
}
