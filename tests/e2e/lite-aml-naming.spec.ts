import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// AML semantic-naming e2e. Like the other Lite directory-mode specs, this
// loads the BUILT single-file application and supplies an in-memory File
// System Access workspace. The AML itself is imported through the real hidden
// import input, so content sniffing, conversion, workspace refresh and bpmn-js
// rendering are all exercised.
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a built single file').toBeGreaterThan(500_000)
})

const AML_GATEWAYS = `<?xml version="1.0" encoding="UTF-8"?>
<AML>
  <Header-Info DatabaseName="Semantic naming" />
  <ObjDef ObjDef.ID="ObjDef.Start" TypeNum="OT_EVT" SymbolNum="ST_EV">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Request received" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="تم استلام الطلب" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.1" CxnDef.Type="CT_ACTIV_1" ToObjDef.IdRef="ObjDef.XorDefault" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.XorDefault" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="  xor RULE  " /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="XOR rule" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.2" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.Step1" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.Step1" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Check route" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="التحقق من المسار" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.3" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.OrDefault" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.OrDefault" TypeNum="OT_RULE" SymbolNum="ST_OPR_OR_1">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue=" OR rule " /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="or RULE" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.4" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.Step2" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.Step2" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Match conditions" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="مطابقة الشروط" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.5" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.AndDefault" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.AndDefault" TypeNum="OT_RULE" SymbolNum="ST_OPR_AND_1">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="and rule" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue=" AND RULE " /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.6" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.Step3" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.Step3" TypeNum="OT_FUNC" SymbolNum="ST_FUNC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Synchronize work" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="مزامنة العمل" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.7" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.Question" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.Question" TypeNum="OT_RULE" SymbolNum="ST_OPR_XOR_1">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Approved?" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="هل تمت الموافقة؟" /></AttrValue>
    </AttrDef>
    <CxnDef CxnDef.ID="CxnDef.8" CxnDef.Type="CT_LEADS_TO_1" ToObjDef.IdRef="ObjDef.End" />
  </ObjDef>
  <ObjDef ObjDef.ID="ObjDef.End" TypeNum="OT_EVT" SymbolNum="ST_EV">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Decision recorded" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="تم تسجيل القرار" /></AttrValue>
    </AttrDef>
  </ObjDef>
  <Model Model.ID="Model.GatewaySemantics" Model.Type="MT_EEPC">
    <AttrDef AttrDef.Type="AT_NAME">
      <AttrValue LocaleId="1033"><PlainText TextValue="Gateway semantics" /></AttrValue>
      <AttrValue LocaleId="14337"><PlainText TextValue="دلالات البوابات" /></AttrValue>
    </AttrDef>
    <AttrDef AttrDef.Type="AT_PROC_CODE">
      <AttrValue LocaleId="1033"><PlainText TextValue="Process_gateway_semantics" /></AttrValue>
    </AttrDef>
    <ObjOcc ObjOcc.ID="Occ.Start" ObjDef.IdRef="ObjDef.Start" SymbolNum="ST_EV" />
    <ObjOcc ObjOcc.ID="Occ.XorDefault" ObjDef.IdRef="ObjDef.XorDefault" SymbolNum="ST_OPR_XOR_1" />
    <ObjOcc ObjOcc.ID="Occ.Step1" ObjDef.IdRef="ObjDef.Step1" SymbolNum="ST_FUNC" />
    <ObjOcc ObjOcc.ID="Occ.OrDefault" ObjDef.IdRef="ObjDef.OrDefault" SymbolNum="ST_OPR_OR_1" />
    <ObjOcc ObjOcc.ID="Occ.Step2" ObjDef.IdRef="ObjDef.Step2" SymbolNum="ST_FUNC" />
    <ObjOcc ObjOcc.ID="Occ.AndDefault" ObjDef.IdRef="ObjDef.AndDefault" SymbolNum="ST_OPR_AND_1" />
    <ObjOcc ObjOcc.ID="Occ.Step3" ObjDef.IdRef="ObjDef.Step3" SymbolNum="ST_FUNC" />
    <ObjOcc ObjOcc.ID="Occ.Question" ObjDef.IdRef="ObjDef.Question" SymbolNum="ST_OPR_XOR_1" />
    <ObjOcc ObjOcc.ID="Occ.End" ObjDef.IdRef="ObjDef.End" SymbolNum="ST_EV" />
  </Model>
</AML>`

/**
 * Install an empty, writable in-memory directory behind showDirectoryPicker.
 * This deliberately implements only the File System Access surface the Lite
 * app uses while importing/scanning text BPMN files.
 */
async function installMockWorkspace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface MockFile {
      kind: 'file'
      name: string
      getFile(): Promise<{
        text(): Promise<string>
        arrayBuffer(): Promise<ArrayBuffer>
        lastModified: number
        size: number
      }>
      createWritable(): Promise<{
        write(value: string | Blob | ArrayBuffer): Promise<void>
        close(): Promise<void>
      }>
    }
    interface MockDirectory {
      kind: 'directory'
      name: string
      queryPermission(): Promise<PermissionState>
      requestPermission(): Promise<PermissionState>
      entries(): AsyncIterableIterator<[string, MockFile | MockDirectory]>
      getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectory>
      getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFile>
      removeEntry(name: string): Promise<void>
    }

    const missing = (): Error => {
      const error = new Error('Not found')
      error.name = 'NotFoundError'
      return error
    }
    const asText = async (value: string | Blob | ArrayBuffer): Promise<string> => {
      if (typeof value === 'string') return value
      if (value instanceof Blob) return value.text()
      return new TextDecoder().decode(value)
    }
    const fileHandle = (name: string, initial = ''): MockFile => {
      let text = initial
      let modified = Date.now()
      return {
        kind: 'file',
        name,
        async getFile() {
          const bytes = new TextEncoder().encode(text)
          return {
            text: async () => text,
            arrayBuffer: async () => bytes.buffer.slice(0),
            lastModified: modified,
            size: bytes.byteLength
          }
        },
        async createWritable() {
          let next = ''
          return {
            write: async (value) => {
              next += await asText(value)
            },
            close: async () => {
              text = next
              modified = Date.now()
            }
          }
        }
      }
    }
    const directoryHandle = (
      name: string,
      initial: Record<string, MockFile | MockDirectory> = {}
    ): MockDirectory => {
      const children = new Map<string, MockFile | MockDirectory>(Object.entries(initial))
      return {
        kind: 'directory',
        name,
        async queryPermission() {
          return 'granted'
        },
        async requestPermission() {
          return 'granted'
        },
        async *entries() {
          for (const entry of children) yield entry
        },
        async getDirectoryHandle(childName, options = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'directory') throw new TypeError(`${childName} is a file`)
            return existing
          }
          if (!options.create) throw missing()
          const created = directoryHandle(childName)
          children.set(childName, created)
          return created
        },
        async getFileHandle(childName, options = {}) {
          const existing = children.get(childName)
          if (existing) {
            if (existing.kind !== 'file') throw new TypeError(`${childName} is a directory`)
            return existing
          }
          if (!options.create) throw missing()
          const created = fileHandle(childName)
          children.set(childName, created)
          return created
        },
        async removeEntry(childName) {
          if (!children.delete(childName)) throw missing()
        }
      }
    }

    const root = directoryHandle('SemanticWorkspace')
    ;(
      window as unknown as { showDirectoryPicker: () => Promise<MockDirectory> }
    ).showDirectoryPicker = async () => root
  })
}

interface GatewayState {
  id: string
  type: string
  name: string | null
  nameEn: string | null
  nameAr: string | null
}

async function gatewayStates(page: Page): Promise<GatewayState[]> {
  return page.evaluate(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
      }
    ).__ORBITPM_LITE__.modeler
    type BusinessObject = {
      name?: unknown
      get?(key: string): unknown
      $attrs?: Record<string, unknown>
    }
    type DiagramElement = {
      id: string
      type?: string
      labelTarget?: unknown
      businessObject?: BusinessObject
    }
    const registry = modeler.get('elementRegistry') as { getAll(): DiagramElement[] }
    const attr = (bo: BusinessObject | undefined, key: string): string | null => {
      const viaGet = typeof bo?.get === 'function' ? bo.get(key) : undefined
      const value = viaGet ?? bo?.$attrs?.[key]
      return typeof value === 'string' ? value : null
    }
    return registry
      .getAll()
      .filter(
        (element) =>
          !element.labelTarget &&
          (element.type === 'bpmn:ExclusiveGateway' ||
            element.type === 'bpmn:InclusiveGateway' ||
            element.type === 'bpmn:ParallelGateway')
      )
      .map((element) => {
        const viaGet = element.businessObject?.get?.('name')
        const name = viaGet ?? element.businessObject?.name
        return {
          id: element.id,
          type: element.type as string,
          name: typeof name === 'string' ? name : null,
          nameEn: attr(element.businessObject, 'orbitpm:nameEn'),
          nameAr: attr(element.businessObject, 'orbitpm:nameAr')
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
  })
}

async function renderedElementText(page: Page, elementId: string): Promise<string> {
  return page.evaluate((id) => {
    const selectors = [
      `.djs-element[data-element-id="${CSS.escape(id)}"]`,
      `.djs-element[data-element-id="${CSS.escape(id)}_label"]`
    ]
    return Array.from(document.querySelectorAll(selectors.join(',')))
      .map((element) => {
        const runs = Array.from(element.querySelectorAll('tspan'))
          .map((run) => run.textContent ?? '')
          .filter(Boolean)
        return runs.length > 0 ? runs.join(' ') : (element.textContent ?? '')
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }, elementId)
}

async function compactRenderedElementText(page: Page, elementId: string): Promise<string> {
  return (await renderedElementText(page, elementId)).replace(/\s+/g, '')
}

async function activeProcessLanguage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const modeler = (
      window as unknown as {
        __ORBITPM_LITE__: { modeler: { get(name: string): unknown } }
      }
    ).__ORBITPM_LITE__.modeler
    const root = (
      modeler.get('canvas') as {
        getRootElement(): {
          businessObject?: { get?(key: string): unknown; $attrs?: Record<string, unknown> }
        }
      }
    ).getRootElement()
    const viaGet = root.businessObject?.get?.('orbitpm:activeLang')
    const value = viaGet ?? root.businessObject?.$attrs?.['orbitpm:activeLang']
    return typeof value === 'string' ? value : null
  })
}

test('AML import persists contextual standards-based gateway names in EN/AR and preserves real questions', async ({
  page
}) => {
  await installMockWorkspace(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Choose folder workspace', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Process catalog' })).toBeVisible({
    timeout: 20_000
  })

  // Drive the production import path. The mixed-case/whitespace aliases in
  // the inline AML must be suppressed conservatively in BOTH locales.
  const importInput = page.locator('input[type="file"][accept*=".apc"][multiple]')
  await importInput.setInputFiles({
    name: 'gateway-semantics.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from(AML_GATEWAYS, 'utf8')
  })
  const importReview = page.getByRole('dialog', {
    name: 'Review workspace import',
    exact: true
  })
  await expect(importReview).toBeVisible({ timeout: 30_000 })
  await expect(importReview).toContainText('gateway-semantics.xml')
  await expect(importReview).toContainText('Automatically complete (automatic-complete)')
  await expect(importReview).toContainText('ARIS conversion reports')
  const confirmImport = importReview.getByRole('button', {
    name: 'Confirm import',
    exact: true
  })
  await expect(confirmImport).toBeEnabled()
  await confirmImport.click()
  await expect(importReview).toBeHidden({ timeout: 30_000 })

  const canonical = page.locator(
    '.orbitpm-tree-row[data-rel-path="gateway-semantics.bpmn"]:not(.orbitpm-tree-reference-row)'
  )
  await expect(canonical).toBeVisible({ timeout: 20_000 })
  await canonical.click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => {
    const app = (window as unknown as { __ORBITPM_LITE__?: { modeler?: unknown } }).__ORBITPM_LITE__
    return Boolean(app?.modeler)
  })

  const english = await gatewayStates(page)
  expect(english).toHaveLength(4)
  const question = english.find((gateway) => gateway.nameEn === 'Approved?')
  const exclusiveDefault = english.find(
    (gateway) => gateway.type === 'bpmn:ExclusiveGateway' && gateway.nameEn === 'Exclusive gateway'
  )
  const inclusiveDefault = english.find(
    (gateway) => gateway.type === 'bpmn:InclusiveGateway' && gateway.nameEn === 'Inclusive gateway'
  )
  const parallelDefault = english.find(
    (gateway) => gateway.type === 'bpmn:ParallelGateway' && gateway.nameEn === 'Parallel gateway'
  )
  expect(question, 'the genuine bilingual question should survive import').toBeTruthy()
  expect(exclusiveDefault, 'generic XOR alias should become a useful name').toBeTruthy()
  expect(inclusiveDefault, 'generic OR alias should become a useful name').toBeTruthy()
  expect(parallelDefault, 'generic AND alias should become a useful name').toBeTruthy()

  expect(exclusiveDefault).toMatchObject({
    name: 'Exclusive gateway',
    nameEn: 'Exclusive gateway',
    nameAr: 'بوابة حصرية'
  })
  expect(inclusiveDefault).toMatchObject({
    name: 'Inclusive gateway',
    nameEn: 'Inclusive gateway',
    nameAr: 'بوابة شاملة'
  })
  expect(parallelDefault).toMatchObject({
    name: 'Parallel gateway',
    nameEn: 'Parallel gateway',
    nameAr: 'بوابة متوازية'
  })
  expect(question).toMatchObject({
    name: 'Approved?',
    nameEn: 'Approved?',
    nameAr: 'هل تمت الموافقة؟'
  })
  expect(await activeProcessLanguage(page)).toBe('en')

  await expect
    .poll(() => compactRenderedElementText(page, (exclusiveDefault as GatewayState).id))
    .toContain('Exclusivegateway')
  await expect
    .poll(() => compactRenderedElementText(page, (inclusiveDefault as GatewayState).id))
    .toContain('Inclusivegateway')
  await expect
    .poll(() => compactRenderedElementText(page, (parallelDefault as GatewayState).id))
    .toContain('Parallelgateway')
  await expect
    .poll(() => renderedElementText(page, (question as GatewayState).id))
    .toContain('Approved?')
  await expect(page.locator('.djs-container')).not.toContainText(/(?:XOR|OR|AND) rule/i)

  // The diagram-language control changes every stored label, including the
  // contextual gateway names and the genuine business question.
  await page.getByRole('button', { name: /EN⇄AR/ }).click()
  await expect.poll(() => activeProcessLanguage(page)).toBe('ar')

  await expect
    .poll(() => compactRenderedElementText(page, (exclusiveDefault as GatewayState).id))
    .toContain('بوابةحصرية')
  await expect
    .poll(() => compactRenderedElementText(page, (inclusiveDefault as GatewayState).id))
    .toContain('بوابةشاملة')
  await expect
    .poll(() => compactRenderedElementText(page, (parallelDefault as GatewayState).id))
    .toContain('بوابةمتوازية')
  await expect
    .poll(() => compactRenderedElementText(page, (question as GatewayState).id))
    .toContain('هلتمتالموافقة؟')

  const arabic = await gatewayStates(page)
  expect(
    arabic.find((gateway) => gateway.id === (exclusiveDefault as GatewayState).id)
  ).toMatchObject({
    name: 'بوابة حصرية',
    nameEn: 'Exclusive gateway',
    nameAr: 'بوابة حصرية'
  })
  expect(
    arabic.find((gateway) => gateway.id === (inclusiveDefault as GatewayState).id)
  ).toMatchObject({
    name: 'بوابة شاملة',
    nameEn: 'Inclusive gateway',
    nameAr: 'بوابة شاملة'
  })
  expect(
    arabic.find((gateway) => gateway.id === (parallelDefault as GatewayState).id)
  ).toMatchObject({
    name: 'بوابة متوازية',
    nameEn: 'Parallel gateway',
    nameAr: 'بوابة متوازية'
  })
  expect(arabic.find((gateway) => gateway.id === (question as GatewayState).id)).toMatchObject({
    name: 'هل تمت الموافقة؟',
    nameEn: 'Approved?',
    nameAr: 'هل تمت الموافقة؟'
  })
})
