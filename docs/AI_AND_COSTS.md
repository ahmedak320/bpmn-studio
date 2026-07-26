# AI, translation, usage, and cost disclosure

AI is optional. OrbitPM does not sell provider access, proxy requests, or pay
provider charges. Users supply their own provider credentials and are
responsible for provider terms, quotas, billing, and data policy.

## Browser-callable providers

| Provider      | Text | Reviewed PDF input | Reviewed image input              |
| ------------- | ---- | ------------------ | --------------------------------- |
| OpenRouter    | Yes  | Curated models     | Curated Claude/Gemini routes only |
| Anthropic     | Yes  | Curated models     | Curated models                    |
| Google Gemini | Yes  | Curated models     | Curated models                    |

The UI contains the authoritative curated model list. A free-text OpenRouter or
Gemini model ID remains usable for text, but PDF and image controls fail closed
until that exact model is in the reviewed capability registry.

Direct OpenAI, Azure OpenAI, DeepSeek, Moonshot/Kimi, and GLM vendor APIs are
not exposed because the single-file browser application cannot safely or
reliably call those endpoints. Compatible models can be selected through
OpenRouter. Arbitrary custom endpoints are not supported by the Lite CSP.

## What is reviewed before sending

Generation, assistant, interview, and translation surfaces require an explicit
provider/model selection and reviewed request. The review presents the exact
outbound text or attachment, relevant context, sensitivity indicators, privacy
controls, estimated requests, and consent. Workspace context is off by default;
when enabled, only lexically relevant processes are selected and process names
can remain redacted.

Large PDF/image attachments are included only in the first model turn. They are
not silently attached again during a semantic repair turn.

## Cancellation and retry

Requests and supported attachment parsing expose cancellation. Text-only
provider calls can make at most three attempts. Automatic retry is limited to
network/timeout failures, HTTP 408 or 429, and selected transient 5xx statuses.
The delay uses bounded exponential backoff, honors `Retry-After` within the
bound, and displays the attempt state.

Permanent 4xx failures are not retried. A request containing a large attachment
is not automatically resent; the user can review and retry it explicitly.

## Free translation

When no configured AI provider is selected for translation, the reviewed
free-service option can contact Google Translate and then MyMemory according to
the UI flow. These services require no OrbitPM API key, but they are still
external processors. Field text, provider terms, privacy policy, quotas, and
rate limits apply. A failed or rate-limited field remains in review and is not
reported as completed.

## Test Connection

**Test Connection performs a small inference and can be billable.** Settings
requires a separate disclosure checkbox before enabling the action. A
successful probe is provider usage even though it does not contain a BPMN
process.

## Usage and credits

- OpenRouter can expose its account balance through its credits API. The value
  shown is provider-reported and can require a network refresh.
- OrbitPM keeps separate in-memory session totals and browser-local all-time
  totals per provider.
- Totals include request count, input/output tokens, and reasoning/thought
  tokens when the provider returns them.
- Provider-reported request cost is preferred when present. Otherwise OrbitPM
  uses the bundled fallback prices below.
- If any request uses an unknown-price model, the aggregate cost is marked
  unknown instead of displaying a misleading partial total.
- Very small nonzero costs use additional decimal places.
- Usage events refresh the visible AI surfaces, but a provider invoice remains
  the source of truth.

Usage accounting is best effort. A provider can omit or revise usage fields,
and private/disabled browser storage can prevent all-time persistence. OrbitPM
does not enforce a budget or stop a provider account from spending.

## Bundled fallback prices

These estimates were reviewed on **2026-07-26** and are USD per one million
tokens. Prices can change without an OrbitPM release.

| Model ID                     |  Input | Output |
| ---------------------------- | -----: | -----: |
| `z-ai/glm-5.2`               |  $0.60 |  $2.20 |
| `moonshotai/kimi-k3`         |  $0.60 |  $2.50 |
| `deepseek/deepseek-v4-pro`   |  $0.55 |  $2.19 |
| `deepseek/deepseek-v4-flash` |  $0.14 |  $0.28 |
| `anthropic/claude-opus-4.8`  | $15.00 | $75.00 |
| `anthropic/claude-sonnet-5`  |  $3.00 | $15.00 |
| `google/gemini-3.6-flash`    |  $0.30 |  $2.50 |
| `claude-opus-4-8`            | $15.00 | $75.00 |
| `claude-sonnet-5`            |  $3.00 | $15.00 |
| `gemini-flash-latest`        |  $0.30 |  $2.50 |
| `gemini-3-pro-preview`       |  $1.25 | $10.00 |

Reasoning-token charges, cached-token discounts, routing premiums, file-parser
fees, taxes, minimum charges, and provider-specific adjustments may not be
captured by a local estimate. Check the provider dashboard before and after
important work.

See [PRIVACY.md](PRIVACY.md) for exact storage and network behavior.
