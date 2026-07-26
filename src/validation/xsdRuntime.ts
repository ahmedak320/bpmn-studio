import XmllintWorker from 'xmllint-wasm/xmllint-browser.mjs?worker&inline'
import { BPMN_20_XSD } from './bpmnSchemas'
import type { XsdDiagnostic } from './adapters'

interface WorkerOutput {
  exitCode: number
  stdout: string
  stderr: string
}

interface XmllintNodeResult {
  valid: boolean
  errors: readonly {
    rawMessage: string
    message: string
    loc: null | {
      fileName: string
      lineNumber: number
    }
  }[]
}

function parsedDiagnostics(stderr: string): XsdDiagnostic[] {
  const lines = stderr.trim().split('\n').filter(Boolean)
  return lines
    .filter((line) => !line.trim().endsWith(' validates'))
    .map((line, index) => {
      const [fileName, lineNumber, ...messageParts] = line.split(':')
      const parsedLine = Number.parseInt(lineNumber ?? '', 10)
      return {
        code: `schema-${index + 1}`,
        message:
          fileName && Number.isFinite(parsedLine) && messageParts.length > 0
            ? messageParts.join(':').trim()
            : line.trim(),
        ...(Number.isFinite(parsedLine) ? { line: parsedLine } : {})
      }
    })
}

async function validateInInlineBrowserWorker(xml: string): Promise<readonly XsdDiagnostic[]> {
  const worker = new XmllintWorker()
  return await new Promise<readonly XsdDiagnostic[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('BPMN 2.0 schema validation exceeded 30 seconds.'))
    }, 30_000)
    const cleanup = (): void => {
      clearTimeout(timeout)
      worker.terminate()
    }
    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerOutput>) => {
        cleanup()
        if (event.data.exitCode === 0) {
          resolve([])
          return
        }
        if (event.data.exitCode === 3 || event.data.exitCode === 4) {
          const diagnostics = parsedDiagnostics(event.data.stderr)
          resolve(
            diagnostics.length > 0
              ? diagnostics
              : [
                  {
                    code: 'schema-invalid',
                    message:
                      event.data.stderr.trim() ||
                      event.data.stdout.trim() ||
                      'BPMN 2.0 schema validation failed.'
                  }
                ]
          )
          return
        }
        reject(
          new Error(
            event.data.stderr.trim() || `xmllint worker exited with code ${event.data.exitCode}.`
          )
        )
      },
      { once: true }
    )
    worker.addEventListener(
      'error',
      (event) => {
        cleanup()
        reject(event.error ?? new Error(event.message || 'xmllint worker failed.'))
      },
      { once: true }
    )
    worker.postMessage({
      inputFiles: [
        { fileName: 'diagram.bpmn', contents: xml },
        BPMN_20_XSD.root,
        ...BPMN_20_XSD.dependencies
      ],
      args: ['--schema', 'BPMN20.xsd', '--noout', 'diagram.bpmn'],
      initialMemory: 256,
      maxMemory: 512
    })
  })
}

async function validateInNode(xml: string): Promise<readonly XsdDiagnostic[]> {
  // The browser build must not bundle the node adapter (it imports node:fs).
  // Vite leaves this branch untouched, and browsers never enter it because
  // module Workers are a release requirement.
  const nodeAdapter = ['xmllint-wasm', 'index-node.js'].join('/')
  const { validateXML } = (await import(/* @vite-ignore */ nodeAdapter)) as {
    validateXML(options: unknown): Promise<XmllintNodeResult>
  }
  const result = await validateXML({
    xml: { fileName: 'diagram.bpmn', contents: xml },
    schema: BPMN_20_XSD.root,
    preload: BPMN_20_XSD.dependencies
  })
  if (result.valid) return []
  const diagnostics = result.errors.map((error, index) => ({
    code: `schema-${index + 1}`,
    message: error.message || error.rawMessage || 'BPMN 2.0 schema validation failed.',
    line: error.loc?.lineNumber
  }))
  return diagnostics.length > 0
    ? diagnostics
    : [
        {
          code: 'schema-invalid',
          message: 'BPMN 2.0 schema validation failed.'
        }
      ]
}

/**
 * Validate through an inline module Worker in browsers and the package's
 * libxml2 node adapter in Vitest. The inline worker is essential to Lite's
 * single-file distribution: its JS and WASM bytes are embedded in index.html.
 */
export async function validateBpmnXsd(xml: string): Promise<readonly XsdDiagnostic[]> {
  return typeof Worker === 'undefined'
    ? await validateInNode(xml)
    : await validateInInlineBrowserWorker(xml)
}
