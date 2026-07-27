import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// The BUILT single file (must be built first: `cd lite && npm run build`).
const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(HERE, '../../dist/index.html')
const FILE_URL = pathToFileURL(DIST).toString()
const FIXTURE_PDF = resolve(HERE, 'fixtures/tiny.pdf')

test.beforeAll(() => {
  const html = readFileSync(DIST, 'utf8')
  expect(html.length, 'dist/index.html should be a multi-hundred-KB single file').toBeGreaterThan(
    500_000
  )
})

test('BUILT dist CSP has embedded WASM plus the exact five-host external-request allowlist', () => {
  // Strip HTML comments first — the CSP rationale comment also mentions
  // "connect-src", and we want the real directive, not the prose.
  const html = readFileSync(DIST, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const m = html.match(/connect-src ([^;]+)/)
  expect(m, 'built HTML must carry a connect-src directive').not.toBeNull()
  const connectSources = (m as RegExpMatchArray)[1].trim().split(/\s+/).sort()
  expect(connectSources).toEqual(
    [
      'data:',
      'https://api.anthropic.com',
      'https://api.mymemory.translated.net',
      'https://generativelanguage.googleapis.com',
      'https://openrouter.ai',
      'https://translate.googleapis.com'
    ].sort()
  )
})

test('BUILT dist CSP carries the hardening directives (object-src/base-uri/form-action)', () => {
  const csp = readFileSync(DIST, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .match(/Content-Security-Policy"\s+content="([^"]+)"/)
  expect(csp, 'built HTML must carry a CSP meta').not.toBeNull()
  const policy = (csp as RegExpMatchArray)[1]
  // Codex NEW-minor CSP hardening — added beyond default-src.
  expect(policy).toContain("object-src 'none'")
  expect(policy).toContain("base-uri 'self'")
  expect(policy).toContain("form-action 'self'")
  expect(policy).toContain("worker-src 'self' blob:")
})

function recordOffendingRequests(page: import('@playwright/test').Page): string[] {
  const offending: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url === FILE_URL) return
    if (url.startsWith('data:') || url.startsWith('blob:')) return
    offending.push(`${req.method()} ${url}`)
  })
  return offending
}

async function forceFallbackMode(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    delete window.showDirectoryPicker
    delete window.showOpenFilePicker
  })
}

/** Opening a diagram auto-collapses the left sidebar (which holds the AI
 *  generator). Restore it via the rail, then expand the AI section if a stored
 *  pref left it collapsed. */
async function expandAiPanel(page: import('@playwright/test').Page): Promise<void> {
  const aside = page.locator('aside')
  if (!(await aside.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Toggle side panel' }).click()
    await expect(aside).toBeVisible()
  }
  const aiHeader = page.getByRole('button', { name: /Generate with AI/i })
  if ((await aiHeader.getAttribute('aria-expanded')) === 'false') {
    await aiHeader.click()
  }
}

/** Get into the ready app (fallback mode) with the AI generator on screen. The
 *  blank diagram auto-collapses the sidebar, so re-open it and its AI section. */
async function openApp(page: import('@playwright/test').Page): Promise<void> {
  await forceFallbackMode(page)
  await page.goto(FILE_URL, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New blank diagram/i }).click()
  await expect(page.locator('.djs-container svg').first()).toBeVisible({ timeout: 20_000 })
  await expandAiPanel(page)
}

test('Settings lists only the three supported browser providers', async ({ page }) => {
  const offending = recordOffendingRequests(page)
  await openApp(page)

  await page
    .getByRole('button', { name: /Settings/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: /Settings/i })
  await expect(dialog).toBeVisible()

  for (const label of ['OpenRouter', 'Anthropic', 'Google Gemini']) {
    await expect(dialog.getByRole('region', { name: label })).toBeVisible()
  }
  await expect(dialog.getByRole('region', { name: 'Custom OpenAI-compatible' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Test connection' })).toHaveCount(3)

  await expect(dialog.getByText(/only in memory for this browser session/i)).toBeVisible()
  await expect(dialog.getByLabel('Encryption passphrase')).toBeVisible()
  await expect(
    dialog.getByText(/small inference request that may be billable/i).first()
  ).toBeVisible()

  // Opening Settings made ZERO network requests (we haven't probed yet).
  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})

test('AI panel documents the updated browser-capable provider set', async ({ page }) => {
  await openApp(page)
  // OpenRouter is now a browser-capable provider alongside Anthropic/Gemini.
  await expect(page.getByText(/can be called directly from a web page/i)).toBeVisible()
  await expect(page.getByText(/Reach GLM, Kimi, and DeepSeek through OpenRouter/i)).toBeVisible()
  await expect(page.getByText(/don.?t allow browser \(CORS\) access/i)).toBeVisible()
})

test('OpenRouter generation sends only the consent-reviewed payload and opens the result', async ({
  page
}) => {
  const apiKey = 'e2e-openrouter-key'
  const modelId = 'z-ai/glm-5.2'
  const description = 'Review a permit request and record the decision.'
  const generatedProcess = [
    {
      type: 'startEvent',
      id: 'Start_Request',
      label: 'Request received',
      labelEn: 'Request received',
      labelAr: 'استلام الطلب'
    },
    {
      type: 'userTask',
      id: 'Review_Request',
      label: 'Review request',
      labelEn: 'Review request',
      labelAr: 'مراجعة الطلب'
    },
    {
      type: 'endEvent',
      id: 'End_Request',
      label: 'Decision recorded',
      labelEn: 'Decision recorded',
      labelAr: 'تسجيل القرار'
    }
  ]
  const chatRequests: Array<{
    headers: Record<string, string>
    body: Record<string, unknown>
  }> = []

  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request()
    const requestHeaders = request.headers()
    const corsHeaders = {
      'access-control-allow-origin': requestHeaders.origin ?? '*',
      'access-control-allow-headers':
        requestHeaders['access-control-request-headers'] ??
        'authorization, content-type, http-referer, x-title',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
      return
    }
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/v1/credits') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { total_credits: 10, total_usage: 1 } })
      })
      return
    }
    if (pathname === '/api/v1/chat/completions' && request.method() === 'POST') {
      chatRequests.push({
        headers: requestHeaders,
        body: request.postDataJSON() as Record<string, unknown>
      })
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ process: generatedProcess })
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150
          }
        })
      })
      return
    }
    await route.abort()
  })

  await openApp(page)
  await page
    .getByRole('button', { name: /Settings/i })
    .first()
    .click()
  const settings = page.getByRole('dialog', { name: /Settings/i })
  const aiSelection = settings.getByRole('region', { name: 'AI provider and model' })
  await aiSelection
    .getByRole('combobox', { name: 'Provider', exact: true })
    .selectOption('openrouter')
  await aiSelection.getByRole('combobox', { name: 'Model', exact: true }).fill(modelId)
  await settings.getByLabel('OpenRouter API key').fill(apiKey)
  await settings.getByRole('button', { name: 'Save keys' }).click()
  await expect(settings.getByText('Saved.')).toBeVisible()
  await settings.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(settings).toBeHidden()
  await expandAiPanel(page)

  const aiPanel = page.locator('aside')
  await aiPanel.getByLabel('Description', { exact: true }).fill(description)
  await aiPanel.getByRole('textbox', { name: 'Name', exact: true }).fill('Consent path')
  const preview = aiPanel.getByRole('region', { name: 'External request preview' })
  await expect(preview.getByText(`Provider/model: OpenRouter / ${modelId}`)).toBeVisible()
  await expect(preview.getByLabel('Included description')).toHaveValue(description)
  await expect(preview.getByText(/Workspace context: 0 included/)).toBeVisible()

  const generate = aiPanel.getByRole('button', { name: 'Generate', exact: true })
  await expect(generate).toBeDisabled()
  expect(chatRequests).toEqual([])
  await preview
    .getByLabel('I reviewed this request and consent to sending the listed data.')
    .check()
  await expect(generate).toBeEnabled()
  await generate.click()

  await expect(
    page.getByRole('status').filter({ hasText: 'Created: Opened consent-path.bpmn' })
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('.djs-container:visible .djs-label', { hasText: 'Review request' }).first()
  ).toBeVisible({ timeout: 30_000 })

  expect(chatRequests).toHaveLength(1)
  const outbound = chatRequests[0]
  expect(outbound.headers.authorization).toBe(`Bearer ${apiKey}`)
  expect(outbound.headers['content-type']).toContain('application/json')
  expect(outbound.headers['x-title']).toBe('OrbitPM Process Studio Lite')
  expect(outbound.body).toMatchObject({
    model: modelId,
    max_tokens: 6000,
    provider: {
      zdr: true,
      data_collection: 'deny'
    },
    response_format: { type: 'json_object' }
  })
  expect(outbound.body).not.toHaveProperty('plugins')
  const messages = outbound.body.messages as Array<{ role: string; content: string }>
  expect(messages).toHaveLength(2)
  expect(messages.map(({ role }) => role)).toEqual(['system', 'user'])
  expect(messages[0].content).toContain('SECURITY BOUNDARY:')
  expect(messages[1].content).toContain(JSON.stringify(`User: ${description}`))
  expect(messages[1].content).not.toContain('# Existing processes in this workspace')
  expect(messages[1].content.split(description)).toHaveLength(2)
})

test('PDF flow: pick a PDF + Arabic hint, hit the no-key provider gate', async ({ page }) => {
  const offending = recordOffendingRequests(page)
  await openApp(page)

  // Bind the flow to an explicit reviewed route. Provider/model defaults are
  // presentation details and must never decide whether an attachment is safe.
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openrouter')
  const model = page.locator('input[list="models-openrouter"]')
  await model.fill('google/gemini-3.6-flash')
  await expect(model).toHaveValue('google/gemini-3.6-flash')

  // Switch the AI panel to the PDF source.
  await page.getByRole('tab', { name: /From PDF/i }).click()

  // The explicitly reviewed OpenRouter model supports PDF, so the input is
  // present. Select the tiny fixture PDF.
  const fileInput = page.locator('input[type="file"][accept*="pdf"]')
  await fileInput.setInputFiles(FIXTURE_PDF)

  // The chosen file name + size are surfaced (and it's within the size gate).
  await expect(page.getByText(/^tiny\.pdf · \d+\.\d+ MB$/i)).toBeVisible()

  // The "which process?" hint accepts Arabic text (RTL, no translation).
  const arabicHint = 'عملية استلام الطلب'
  const hint = page.getByPlaceholder(/Which process from this document|العملية المطلوبة/i)
  await hint.fill(arabicHint)
  await expect(hint).toHaveValue(arabicHint)

  // With no API key stored, the UX stops at the provider gate (not a crash).
  // The generate button is now labelled "Generate from document" (the source
  // accepts PDFs and images alike).
  await expect(page.getByText(/No key stored for OpenRouter/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Generate from document/i })).toBeDisabled()

  // The whole PDF-selection UX path ran with zero network requests (no key, no
  // send) — proving the client-side flow up to the gate.
  expect(offending, `unexpected requests: ${offending.join(', ')}`).toEqual([])
})
