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
- If stored totals become incomplete or exceed a safety bound, counts are
  marked as lower bounds with `≥`, cost becomes unavailable, and the UI states
  that usage is incomplete.
- Very small nonzero costs use additional decimal places or scientific notation
  instead of being displayed as zero.
- Usage events refresh the visible AI surfaces, but a provider invoice remains
  the source of truth.

Usage accounting is best effort. A provider can omit or revise usage fields,
and private/disabled browser storage can prevent all-time persistence. OrbitPM
does not enforce a budget or stop a provider account from spending.

## Bundled fallback prices

These estimates were reviewed on **2026-07-27** and are USD per one million
tokens. Prices can change without an OrbitPM release.

OpenRouter's provider-reported request cost remains authoritative when present.
The OpenRouter table is only a missing-cost fallback based on OpenRouter's own
model catalog; it is not inferred from a direct vendor's price.

| OpenRouter model ID          |   Input |  Output |
| ---------------------------- | ------: | ------: |
| `z-ai/glm-5.2`               | $0.8106 | $2.5476 |
| `moonshotai/kimi-k3`         |   $3.00 |  $15.00 |
| `deepseek/deepseek-v4-pro`   |  $0.435 |   $0.87 |
| `deepseek/deepseek-v4-flash` |   $0.14 |   $0.28 |
| `anthropic/claude-opus-4.8`  |   $5.00 |  $25.00 |
| `anthropic/claude-sonnet-5`  |   $2.00 |  $10.00 |
| `google/gemini-3.6-flash`    |   $1.50 |   $7.50 |

Direct-provider fallbacks are priced from the direct provider's published
rates:

| Direct model ID          | Prompt tier | Input | Output |
| ------------------------ | ----------- | ----: | -----: |
| `claude-opus-4-8`        | All         | $5.00 | $25.00 |
| `claude-sonnet-5`        | All         | $2.00 | $10.00 |
| `gemini-3.6-flash`       | All         | $1.50 |  $7.50 |
| `gemini-3.1-pro-preview` | <= 200k     | $2.00 | $12.00 |
| `gemini-3.1-pro-preview` | > 200k      | $4.00 | $18.00 |

Anthropic's direct Sonnet 5 price is temporarily $2/$10 through August 31,
2026, and that current promotion is modeled in this dated snapshot. Anthropic
has announced a $3/$15 standard price starting September 1; the bundled direct
fallback must be reviewed after the promotion expires. OpenRouter's separate
Sonnet 5 route fallback independently uses its current $2/$10 catalog price.

Direct Gemini output rates include thinking tokens. OrbitPM adds Gemini's
separately reported candidate and thought counts exactly once when it must
estimate a request. Anthropic's `output_tokens` is already the inclusive billed
output total; OrbitPM displays its `thinking_tokens` breakdown but does not add
that breakdown to the cost again.

Direct Anthropic prices and the Sonnet promotion dates are documented by
Anthropic's [pricing page](https://platform.claude.com/docs/en/about-claude/pricing).
The current IDs, shutdown replacement, and direct rates are documented by
Google's [current-model guide](https://ai.google.dev/gemini-api/docs/latest-model),
[deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations), and
[pricing page](https://ai.google.dev/gemini-api/docs/pricing). All OpenRouter
fallbacks above were independently checked against OpenRouter's
[live model catalog](https://openrouter.ai/api/v1/models); the Opus and Gemini
routes are also visible on their model pages:
[Claude Opus 4.8](https://openrouter.ai/anthropic/claude-opus-4.8) and
[Gemini 3.6 Flash](https://openrouter.ai/google/gemini-3.6-flash).

Reasoning-token charges, cached-token discounts, routing premiums, file-parser
fees, taxes, minimum charges, and provider-specific adjustments may not be
captured by a local estimate. Check the provider dashboard before and after
important work.

See [PRIVACY.md](PRIVACY.md) for exact storage and network behavior.
