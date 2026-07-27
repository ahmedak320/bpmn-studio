import { test, expect, type Locator, type Page } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const NO_DI_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:orbitpm="http://orbitpm.ae/schema/bpmn/1.0"
  id="Definitions_source_layout" targetNamespace="urn:orbitpm:source-layout">
  <bpmn:process id="Process_source_layout" name="Source layout" isExecutable="false"
    orbitpm:nameEn="Source layout" orbitpm:nameAr="تخطيط المصدر" orbitpm:activeLang="en">
    <bpmn:startEvent id="Start_source_layout" name="Start"
      orbitpm:nameEn="Start" orbitpm:nameAr="البداية">
      <bpmn:outgoing>Flow_source_layout</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:endEvent id="End_source_layout" name="End"
      orbitpm:nameEn="End" orbitpm:nameAr="النهاية">
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
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
})

async function openStandaloneLayoutReview(page: Page, name: string): Promise<Locator> {
  const input = page.locator(
    'input[type="file"][accept=".bpmn,application/xml,text/xml"]:not([multiple])'
  )
  await expect(input).toHaveCount(1)
  await input.setInputFiles({
    name: `${name}.bpmn`,
    mimeType: 'application/xml',
    buffer: Buffer.from(NO_DI_XML)
  })
  const dialog = page.getByRole('dialog', {
    name: 'A generated diagram layout is ready to review.'
  })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(
    dialog.getByRole('button', { name: 'Accept generated layout', exact: true })
  ).toBeEnabled({ timeout: 30_000 })
  return dialog
}

async function assertStandaloneLayoutReviewGeometry(page: Page, dialog: Locator): Promise<void> {
  const scrollRegion = dialog.locator('[data-single-file-layout-scroll-region]')
  const footer = dialog.locator('.orbitpm-validation__footer')
  const cancel = footer.getByRole('button', { name: 'Cancel', exact: true })
  const accept = footer.getByRole('button', { name: 'Accept generated layout', exact: true })

  const beforeScroll = await scrollRegion.evaluate((region) => ({
    clientHeight: region.clientHeight,
    scrollHeight: region.scrollHeight,
    scrollTop: region.scrollTop
  }))
  expect(beforeScroll.clientHeight).toBeGreaterThan(0)
  expect(beforeScroll.scrollHeight).toBeGreaterThanOrEqual(beforeScroll.clientHeight)
  const footerTop = await footer.evaluate((node) => node.getBoundingClientRect().top)

  if (beforeScroll.scrollHeight > beforeScroll.clientHeight) {
    await scrollRegion.evaluate((region) => {
      region.scrollTop = region.scrollHeight
    })
    await expect
      .poll(() => scrollRegion.evaluate((region) => region.scrollTop))
      .toBeGreaterThan(beforeScroll.scrollTop)
  }
  expect(await footer.evaluate((node) => node.getBoundingClientRect().top)).toBeCloseTo(
    footerTop,
    1
  )

  const geometry = await dialog.evaluate((dialogNode) => {
    const region = dialogNode.querySelector<HTMLElement>('[data-single-file-layout-scroll-region]')
    const footerNode = dialogNode.querySelector<HTMLElement>('.orbitpm-validation__footer')
    const buttons = Array.from(footerNode?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const cancelNode = buttons.find((button) => button.textContent?.trim() === 'Cancel')
    const acceptNode = buttons.find(
      (button) => button.textContent?.trim() === 'Accept generated layout'
    )
    if (!region || !footerNode || !cancelNode || !acceptNode) {
      throw new Error('Standalone layout review geometry is unavailable')
    }
    const box = (node: Element): DOMRect => node.getBoundingClientRect()
    const dialogBox = box(dialogNode)
    const regionBox = box(region)
    const footerBox = box(footerNode)
    const cancelBox = box(cancelNode)
    const acceptBox = box(acceptNode)
    const ownsCenterPoint = (button: HTMLButtonElement, buttonBox: DOMRect): boolean => {
      const target = document.elementFromPoint(
        buttonBox.left + buttonBox.width / 2,
        buttonBox.top + buttonBox.height / 2
      )
      return target === button || button.contains(target)
    }
    return {
      dialog: {
        top: dialogBox.top,
        right: dialogBox.right,
        bottom: dialogBox.bottom,
        left: dialogBox.left
      },
      region: {
        top: regionBox.top,
        right: regionBox.right,
        bottom: regionBox.bottom,
        left: regionBox.left
      },
      footer: {
        top: footerBox.top,
        right: footerBox.right,
        bottom: footerBox.bottom,
        left: footerBox.left
      },
      cancel: {
        top: cancelBox.top,
        right: cancelBox.right,
        bottom: cancelBox.bottom,
        left: cancelBox.left,
        hit: ownsCenterPoint(cancelNode, cancelBox)
      },
      accept: {
        top: acceptBox.top,
        right: acceptBox.right,
        bottom: acceptBox.bottom,
        left: acceptBox.left,
        hit: ownsCenterPoint(acceptNode, acceptBox)
      },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }
    }
  })

  expect(geometry.dialog.top).toBeGreaterThanOrEqual(-1)
  expect(geometry.dialog.left).toBeGreaterThanOrEqual(-1)
  expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.viewport.width + 1)
  expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
  expect(geometry.region.bottom).toBeLessThanOrEqual(geometry.footer.top + 1)
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
  for (const button of [geometry.cancel, geometry.accept]) {
    expect(button.left).toBeGreaterThanOrEqual(geometry.footer.left - 1)
    expect(button.right).toBeLessThanOrEqual(geometry.footer.right + 1)
    expect(button.top).toBeGreaterThanOrEqual(geometry.footer.top - 1)
    expect(button.bottom).toBeLessThanOrEqual(geometry.footer.bottom + 1)
    expect(button.hit).toBe(true)
  }

  await cancel.click({ trial: true })
  await accept.click({ trial: true })
  await cancel.focus()
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(accept).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(cancel).toBeFocused()
}

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
  await expect(
    source
      .locator('.orbitpm-source-editor__layout-preview')
      .getByText(/changed · \d+ added · \d+ removed/)
  ).toBeVisible()
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

for (const viewport of [
  { width: 640, height: 360, label: '640x360' },
  { width: 320, height: 568, label: '320x568' },
  {
    width: 320,
    height: 180,
    label: '1280x720 at 400%-zoom equivalent'
  }
] as const) {
  test(`standalone generated layout keeps both decisions reachable at ${viewport.label}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    const cancelledReview = await openStandaloneLayoutReview(
      page,
      `cancel-layout-${viewport.width}-${viewport.height}`
    )
    await assertStandaloneLayoutReviewGeometry(page, cancelledReview)
    const cancel = cancelledReview.getByRole('button', { name: 'Cancel', exact: true })
    await cancel.focus()
    await page.keyboard.press('Enter')
    await expect(cancelledReview).toHaveCount(0)

    const acceptedReview = await openStandaloneLayoutReview(
      page,
      `accept-layout-${viewport.width}-${viewport.height}`
    )
    await assertStandaloneLayoutReviewGeometry(page, acceptedReview)
    const accept = acceptedReview.getByRole('button', {
      name: 'Accept generated layout',
      exact: true
    })
    await accept.focus()
    await page.keyboard.press('Enter')
    await expect(acceptedReview).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible({
      timeout: 30_000
    })
  })
}

test.describe('compact source review', () => {
  test.use({ viewport: { width: 320, height: 568 } })

  test('keeps a one-line diff reachable above the separate action footer', async ({ page }) => {
    const moreActions = page.getByRole('button', { name: 'More editor actions', exact: true })
    await expect(moreActions).toBeVisible()
    await moreActions.click()
    await page
      .getByRole('menu', { name: 'More editor actions' })
      .getByRole('menuitem', { name: 'Source', exact: true })
      .click()

    const source = page.getByRole('dialog', { name: 'BPMN XML source' })
    const editor = source.getByRole('textbox')
    const original = await editor.inputValue()
    expect(original).toContain('isExecutable="false"')
    const longName = `Long review ${'x'.repeat(8_000)}`
    await editor.fill(
      original.replace('isExecutable="false"', `name="${longName}" isExecutable="true"`)
    )

    await expect(source.getByText(/1 changed · 1 added · 1 removed/)).toBeVisible()
    const hunks = source.locator('.orbitpm-source-diff__hunk')
    await expect(hunks).toHaveCount(1)
    const diffViewport = source.locator('.orbitpm-source-diff__hunks')
    const scrollRegion = source.locator('[data-source-editor-scroll-region]')
    const footer = source.locator('.orbitpm-validation__footer')
    const apply = footer.getByRole('button', { name: 'Apply source', exact: true })
    await expect(apply).toBeEnabled()

    const horizontalScroll = await diffViewport.evaluate((viewport) => ({
      clientWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth
    }))
    expect(horizontalScroll.scrollWidth).toBeGreaterThan(horizontalScroll.clientWidth)
    const bodyWidth = await scrollRegion.evaluate((region) => ({
      clientWidth: region.clientWidth,
      scrollWidth: region.scrollWidth
    }))
    expect(bodyWidth.scrollWidth).toBeLessThanOrEqual(bodyWidth.clientWidth + 1)
    await diffViewport.evaluate((viewport) => {
      viewport.scrollLeft = viewport.scrollWidth
    })
    await expect
      .poll(() => diffViewport.evaluate((viewport) => viewport.scrollLeft))
      .toBeGreaterThan(horizontalScroll.scrollLeft)

    const initialScroll = await scrollRegion.evaluate((region) => ({
      clientHeight: region.clientHeight,
      scrollHeight: region.scrollHeight,
      scrollTop: region.scrollTop
    }))
    expect(initialScroll.scrollHeight).toBeGreaterThan(initialScroll.clientHeight)

    await scrollRegion.evaluate((region) => {
      region.scrollTop = region.scrollHeight
    })
    await expect
      .poll(() => scrollRegion.evaluate((region) => region.scrollTop))
      .toBeGreaterThan(initialScroll.scrollTop)

    const geometry = await source.evaluate((dialog) => {
      const region = dialog.querySelector<HTMLElement>('[data-source-editor-scroll-region]')
      const footerNode = dialog.querySelector<HTMLElement>('.orbitpm-validation__footer')
      const hunkNode = dialog.querySelector<HTMLElement>('.orbitpm-source-diff__hunk')
      const applyNode = Array.from(footerNode?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.trim() === 'Apply source'
      )
      if (!region || !footerNode || !hunkNode || !applyNode) {
        throw new Error('Compact source review geometry is unavailable')
      }
      const dialogBox = dialog.getBoundingClientRect()
      const regionBox = region.getBoundingClientRect()
      const footerBox = footerNode.getBoundingClientRect()
      const hunkBox = hunkNode.getBoundingClientRect()
      const applyBox = applyNode.getBoundingClientRect()
      const hitTarget = document.elementFromPoint(
        applyBox.left + applyBox.width / 2,
        applyBox.top + applyBox.height / 2
      )
      return {
        dialogTop: dialogBox.top,
        dialogRight: dialogBox.right,
        dialogBottom: dialogBox.bottom,
        dialogLeft: dialogBox.left,
        regionTop: regionBox.top,
        regionBottom: regionBox.bottom,
        footerTop: footerBox.top,
        footerRight: footerBox.right,
        footerBottom: footerBox.bottom,
        footerLeft: footerBox.left,
        hunkTop: hunkBox.top,
        hunkBottom: hunkBox.bottom,
        applyTop: applyBox.top,
        applyRight: applyBox.right,
        applyBottom: applyBox.bottom,
        applyLeft: applyBox.left,
        applyHit: hitTarget === applyNode || applyNode.contains(hitTarget),
        viewportHeight: document.documentElement.clientHeight,
        viewportWidth: document.documentElement.clientWidth
      }
    })

    expect(geometry.dialogTop).toBeGreaterThanOrEqual(-1)
    expect(geometry.dialogLeft).toBeGreaterThanOrEqual(-1)
    expect(geometry.dialogRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.dialogBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.regionBottom).toBeLessThanOrEqual(geometry.footerTop + 1)
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.hunkTop).toBeGreaterThanOrEqual(geometry.regionTop - 1)
    expect(geometry.hunkBottom).toBeLessThanOrEqual(geometry.regionBottom + 1)
    expect(geometry.applyTop).toBeGreaterThanOrEqual(geometry.footerTop - 1)
    expect(geometry.applyBottom).toBeLessThanOrEqual(geometry.footerBottom + 1)
    expect(geometry.applyLeft).toBeGreaterThanOrEqual(geometry.footerLeft - 1)
    expect(geometry.applyRight).toBeLessThanOrEqual(geometry.footerRight + 1)
    expect(geometry.applyHit).toBe(true)
    await apply.click({ trial: true })
    await expect(apply).toBeEnabled()

    await page.setViewportSize({ width: 320, height: 180 })
    await expect(source).toBeVisible()
    await scrollRegion.evaluate((region) => {
      region.scrollTop = region.scrollHeight
    })
    const lastDiffLine = source.locator('.orbitpm-source-diff__line').last()
    await lastDiffLine.scrollIntoViewIfNeeded()
    const shortGeometry = await source.evaluate((dialog) => {
      const region = dialog.querySelector<HTMLElement>('[data-source-editor-scroll-region]')
      const footerNode = dialog.querySelector<HTMLElement>('.orbitpm-validation__footer')
      const line = dialog.querySelectorAll<HTMLElement>('.orbitpm-source-diff__line')
      const lastLine = line.item(line.length - 1)
      const applyNode = Array.from(footerNode?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.trim() === 'Apply source'
      )
      if (!region || !footerNode || !lastLine || !applyNode) {
        throw new Error('Short-height source review geometry is unavailable')
      }
      const regionBox = region.getBoundingClientRect()
      const footerBox = footerNode.getBoundingClientRect()
      const lineBox = lastLine.getBoundingClientRect()
      const applyBox = applyNode.getBoundingClientRect()
      const hitTarget = document.elementFromPoint(
        applyBox.left + applyBox.width / 2,
        applyBox.top + applyBox.height / 2
      )
      return {
        regionHeight: region.clientHeight,
        regionTop: regionBox.top,
        regionBottom: regionBox.bottom,
        footerBottom: footerBox.bottom,
        lineTop: lineBox.top,
        lineBottom: lineBox.bottom,
        applyHit: hitTarget === applyNode || applyNode.contains(hitTarget),
        viewportHeight: document.documentElement.clientHeight,
        dialogRight: dialog.getBoundingClientRect().right,
        viewportWidth: document.documentElement.clientWidth
      }
    })
    expect(shortGeometry.regionHeight).toBeGreaterThan(0)
    expect(shortGeometry.footerBottom).toBeLessThanOrEqual(shortGeometry.viewportHeight + 1)
    expect(shortGeometry.lineBottom).toBeGreaterThan(shortGeometry.regionTop)
    expect(shortGeometry.lineTop).toBeLessThan(shortGeometry.regionBottom)
    expect(shortGeometry.dialogRight).toBeLessThanOrEqual(shortGeometry.viewportWidth + 1)
    expect(shortGeometry.applyHit).toBe(true)
    await apply.click({ trial: true })
    await apply.focus()
    await expect(apply).toBeFocused()
  })
})
