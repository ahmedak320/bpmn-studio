// Typed contract between the Settings UI and whatever wires it to IPC in
// wave C (C1). The component itself never talks to window.orbitpm directly —
// it only calls these injected handlers, so it can be unit/storybook-tested
// standalone and rewired later without touching this file.
import type { ProviderId } from '../../../shared/providers'

/** Per-provider vault status as reported by src/main/secrets.ts getStatus(). */
export interface ProviderStatusView {
  id: ProviderId
  configured: boolean
}

export interface SettingsStatus {
  encryptionAvailable: boolean
  providers: ProviderStatusView[]
}

export type TestConnectionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** Per-field status for one provider's credential form — NEVER the decrypted
 * value itself (the app's invariant is that keys never enter the renderer).
 * `last4` powers a "Configured (****abcd)" placeholder hint. */
export interface KeyFieldStatus {
  configured: boolean
  last4?: string
}

export interface SettingsHandlers {
  /** Fetch current vault status (encryption availability + per-provider configured flag). */
  onGetStatus: () => Promise<SettingsStatus>
  /** Fetch per-field configured/last4 status for one provider (write-only
   * fields — the form never receives a decryptable value back). */
  onGetKeys: (providerId: ProviderId) => Promise<Record<string, KeyFieldStatus>>
  /** Persist one or more fields for a provider. */
  onSetKey: (providerId: ProviderId, fields: Record<string, string>) => Promise<void>
  /** Clear all stored fields for a provider. */
  onDeleteKey: (providerId: ProviderId) => Promise<void>
  /** Optional: exercise the provider's API with the currently-saved key.
   * Implementation lands in C1 — omit to hide the "Test connection" button. */
  onTestConnection?: (providerId: ProviderId, modelId: string) => Promise<TestConnectionResult>
}

export interface SettingsModalProps extends SettingsHandlers {
  open: boolean
  onClose: () => void
}
