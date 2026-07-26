import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const NO_DI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  id="Definitions_source_layout" targetNamespace="urn:orbitpm:source-layout">
  <bpmn:process id="Process_source_layout" name="Source layout" isExecutable="false">
    <bpmn:startEvent id="Start_source_layout" name="Start">
      <bpmn:outgoing>Flow_source_layout</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="End_source_layout" name="End">
      <bpmn:incoming>Flow_source_layout</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_source_layout"
      sourceRef="Start_source_layout" targetRef="End_source_layout" />
  </bpmn:process>
</bpmn:definitions>`

test.beforeAll(() => {
  expect(readFileSync(DIST, 'utf8').length).toBeGreaterThan(500_000)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error test-only fallback mode
    delete window.showDirectoryPicker
    // @ts-expect-error test-only fallback mode
    delete window.showOpenFilePicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
})

test('worker validation, safe source preview, and direct PDF work from the single file', async ({
  page
}) => {
  await page.getByRole('button', { name: 'Validate', exact: true }).click()
  const validation = page.getByRole('dialog', { name: 'Validation Center' })
  await expect(validation).toBeVisible()
  await expect(validation.getByText('Validating…')).toHaveCount(0, { timeout: 30_000 })
  await expect(validation.getByText('bpmnlint.end-event-required', { exact: true })).toBeVisible()
  await expect(validation.getByText('xsd.adapter-failure', { exact: true })).toHaveCount(0)
  await expect(validation.getByRole('button', { name: 'Export report' })).toBeEnabled()
  await validation.getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.getByRole('button', { name: 'Source', exact: true }).click()
  const source = page.getByRole('dialog', { name: 'BPMN XML source' })
  await expect(source).toBeVisible()
  const editor = source.getByRole('textbox')
  await editor.fill('<not-bpmn>')
  await source.getByRole('button', { name: 'Preview changes' }).click()
  await expect(source.getByText('moddle.parse-error', { exact: true })).toBeVisible()
  await expect(source.getByRole('button', { name: 'Apply source' })).toBeDisabled()
  await source.getByRole('button', { name: 'Roll back' }).click()
  await expect(source.getByText('No source changes.')).toBeVisible()

  await editor.fill(NO_DI_XML)
  await source.getByRole('button', { name: 'Preview changes' }).click()
  await expect(source.getByText('di.process-missing', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await source.getByRole('button', { name: 'Preview generated layout' }).click()
  await expect(source.getByText('A generated diagram layout is ready to review.')).toBeVisible({
    timeout: 30_000
  })
  await expect(source.getByText(/changed · \d+ added · \d+ removed/)).toBeVisible()
  const acceptLayout = source.getByRole('button', { name: 'Accept generated layout' })
  await expect(acceptLayout).toBeEnabled()
  await acceptLayout.click()
  const applySource = source.getByRole('button', { name: 'Apply source' })
  await expect(applySource).toBeEnabled()
  await applySource.click()
  await expect(source).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.djs-container svg').first()).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PDF', exact: true }).click()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const pdf = Buffer.concat(chunks)
  expect(pdf.subarray(0, 8).toString('ascii')).toBe('%PDF-1.3')
  expect(pdf.length).toBeGreaterThan(1_000)
})
