/**
 * Per-diagram translation controller for the mounted ARIS tab.
 *
 * It owns the imperative `openReview` seam the toolbar's "Translate…" button
 * calls, the surviving {@link TranslationReviewDialog} it drives, and the
 * automatic translation that fills every opened model's missing languages
 * with no dialog at all.
 *
 * UX (locked):
 *  - Every visible tab auto-fills both missing language directions through the
 *    FREE chain, applies the capped batch as ONE undoable gesture, and never
 *    opens a dialog. Running, partial and failed outcomes stay visible.
 *  - The `arisAutoTranslate` preference remains the explicit opt-out; the
 *    toolbar badge opens the reviewed/manual recovery surface.
 *  - The AI provider is never auto-selected: the free chain is the default and
 *    the configured AI provider is offered only when a key is stored.
 *
 * The reviewed run, the field extraction/apply, and the AI transport all come
 * from Lane L5b's `../localization` adapter; the disclosure is built locally
 * (mirroring `ai/translate.ts`'s `buildTranslationExternalReview`) so this file
 * never runtime-imports `ai/translate.ts`, which pulls the forbidden
 * `@/generation` barrel.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'

import { t } from '../../i18n'
import { getKey, getPref, hasKey } from '../../ai/keys'
import { getProviderSelection, type ProviderSelection } from '../../ai/providerSelection'
import { getLiteProvider } from '../../ai/providersLite'
import { makeBrowserCallLLM } from '../../ai/browserAi'
import { FreeTranslateError, makeFreeTranslateTexts } from '../../ai/freeTranslate'
import type { TranslateTextsFn } from '../../ai/translate'
import {
  createExternalRequestDisclosure,
  type ExternalRequestDisclosure
} from '../../localization/externalRequestReview'
import type { DiagramLocalizationReview } from '../../localization/modelerAdapter'
import {
  InvalidTranslationRecoveryValueError,
  validateTranslationRecoveryValue,
  type TranslationRecoveryField,
  type TranslationRecoveryFieldId
} from '../../localization/translationRecovery'
import {
  TranslationReviewDialog,
  type TranslationOutputProposal
} from '../../localization/TranslationReviewDialog'
import type {
  LocalizationPatch,
  LocalizationResources,
  TranslationQueueItem
} from '../../localization/types'
import {
  applyArisTranslations,
  buildArisLocalizationReview,
  makeArisAiTranslateTexts,
  runArisReviewedTranslation,
  toArisTranslationUpdates,
  type ArisLocalizationReviewResult
} from '../localization'
import type { ArisCanvas } from '../canvas/ArisCanvas'
import type { ArisWorkingDocument } from '../model/types'
import { tk } from './shellI18n'

export interface ArisTranslateControllerHandle {
  openReview(target?: 'en' | 'ar'): void
}

export type ArisAutoTranslateState = 'idle' | 'running' | 'done' | 'partial' | 'failed' | 'off'

export interface ArisTranslateControllerProps {
  readonly getCanvas: () => ArisCanvas | null
  readonly liveDocument: ArisWorkingDocument
  readonly contentLang: 'en' | 'ar'
  readonly documentName: string
  /** Mount-level rollback seam; every studio tab currently supplies `true`. */
  readonly autoTranslateEligible: boolean
  readonly onAutoTranslateState?: (state: ArisAutoTranslateState) => void
  readonly autoTranslateMaxItems?: number
  /** `null` ⇒ the review uses SEEDED_GLOSSARY + an empty translation memory. */
  readonly resources: LocalizationResources | null
  readonly onAcceptedPair?: (pair: { en: string; ar: string }) => void
  readonly onToast: (message: string, tone?: 'info' | 'error' | 'success') => void
}

/** Automatic translation sends at most this many labels, then reports the remainder. */
const AUTO_TRANSLATE_MAX_ITEMS = 500
const DEFAULT_CHUNK_SIZE = 60

/** Fields whose text may carry a person's name or similar data. */
function sensitiveTranslationField(field: string): boolean {
  return (
    field === 'owner' ||
    field === 'ownerRole' ||
    field === 'respList' ||
    field === 'ccList' ||
    field === 'ccTo'
  )
}

interface DisclosureProvider {
  readonly providerId: string
  readonly modelId?: string
  readonly kind: 'ai' | 'free'
  readonly chunkSize?: number
}

/**
 * Local twin of `ai/translate.ts`'s `buildTranslationExternalReview`, kept
 * byte-faithful so the disclosure the dialog shows matches the outbound the
 * transport actually sends — without importing that boundary-forbidden module.
 */
function buildArisTranslationDisclosure(
  review: DiagramLocalizationReview,
  provider: DisclosureProvider
): ExternalRequestDisclosure {
  const outbound = review.queue
    .filter((item) => item.requiresSegmentationReview !== true)
    .map((item, index) => ({
      id: `loc_${index + 1}`,
      text: item.sourceValue,
      context: `${item.processId} / ${item.elementId} / ${item.field} / ${item.sourceLanguage}→${item.target}`,
      sensitive: sensitiveTranslationField(item.field)
    }))
  const chunkSize = Math.max(1, Math.floor(provider.chunkSize ?? DEFAULT_CHUNK_SIZE))
  let requests = 0
  for (const target of ['ar', 'en'] as const) {
    const count = review.queue.filter(
      (item) => item.target === target && item.requiresSegmentationReview !== true
    ).length
    requests += Math.ceil(count / chunkSize)
  }
  return createExternalRequestDisclosure({
    purpose: 'diagram-localization',
    providerId: provider.providerId,
    ...(provider.modelId === undefined ? {} : { modelId: provider.modelId }),
    outbound,
    estimatedRequests:
      provider.kind === 'free'
        ? { min: outbound.length, max: outbound.length * 6 }
        : { min: requests, max: requests * 6 }
  })
}

/** Stable identity of one proposal/field target, for de-duplicating merges. */
function proposalKey(
  value: Pick<TranslationOutputProposal, 'processId' | 'elementId' | 'field' | 'target'>
): string {
  return JSON.stringify([value.processId, value.elementId, value.field, value.target])
}

function mergeProposals(
  previous: readonly TranslationOutputProposal[],
  incoming: readonly TranslationOutputProposal[]
): TranslationOutputProposal[] {
  const byKey = new Map(previous.map((proposal) => [proposalKey(proposal), proposal]))
  for (const proposal of incoming) byKey.set(proposalKey(proposal), proposal)
  return [...byKey.values()]
}

function removeProposal(
  previous: readonly TranslationOutputProposal[],
  target: TranslationOutputProposal
): TranslationOutputProposal[] {
  const key = proposalKey(target)
  return previous.filter((proposal) => proposalKey(proposal) !== key)
}

function freeErrorMessage(error: unknown): string {
  if (error instanceof FreeTranslateError) {
    switch (error.code) {
      case 'rate':
        return t('translate.free.rate')
      case 'offline':
        return t('translate.free.offline')
      case 'service':
        return t('translate.free.down')
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Turn an accepted/manual proposal into a metadata patch, routing the value to
 * the ARIS write-locale id the extraction recorded for that field.
 */
function proposalToPatch(
  proposal: TranslationOutputProposal,
  review: DiagramLocalizationReview
): LocalizationPatch | null {
  const field = review.fields.find(
    (candidate) =>
      candidate.processId === proposal.processId &&
      candidate.elementId === proposal.elementId &&
      candidate.field === proposal.field
  )
  if (!field) return null
  const property = proposal.target === 'ar' ? field.storage.arProperty : field.storage.enProperty
  if (!property) return null
  return {
    source: field.source,
    processId: proposal.processId,
    elementId: proposal.elementId,
    field: proposal.field,
    property,
    value: proposal.value,
    reason: 'review'
  }
}

/** The bilingual pair an accepted proposal contributes to translation memory. */
function proposalPair(proposal: TranslationOutputProposal): { en: string; ar: string } {
  return proposal.target === 'ar'
    ? { en: proposal.sourceValue, ar: proposal.value }
    : { en: proposal.value, ar: proposal.sourceValue }
}

interface ReviewSession {
  readonly result: ArisLocalizationReviewResult
  readonly target: 'en' | 'ar'
}

function ArisTranslateControllerInner(
  props: ArisTranslateControllerProps,
  ref: React.ForwardedRef<ArisTranslateControllerHandle>
): JSX.Element | null {
  const {
    getCanvas,
    liveDocument,
    contentLang,
    documentName,
    autoTranslateEligible,
    autoTranslateMaxItems = AUTO_TRANSLATE_MAX_ITEMS,
    resources
  } = props
  const { onAcceptedPair, onAutoTranslateState, onToast } = props

  const [session, setSession] = useState<ReviewSession | null>(null)
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [aiSelection, setAiSelection] = useState<ProviderSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [technicalDetail, setTechnicalDetail] = useState<string | null>(null)
  const [retryingFieldId, setRetryingFieldId] = useState<TranslationRecoveryFieldId | null>(null)
  const [proposals, setProposals] = useState<readonly TranslationOutputProposal[]>([])
  const [acceptedValues, setAcceptedValues] = useState<readonly TranslationOutputProposal[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const autoRanRef = useRef(false)
  const autoControllerRef = useRef<AbortController | null>(null)

  // The imperative seam always calls the latest closure, so the handle can be
  // created once (no re-subscription for the toolbar that holds the ref).
  const openReviewRef = useRef<(target?: 'en' | 'ar') => void>(() => undefined)

  const resetSession = (): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setSession(null)
    setOpen(false)
    setProviderId('')
    setAiSelection(null)
    setBusy(false)
    setStatus(null)
    setTechnicalDetail(null)
    setRetryingFieldId(null)
    setProposals([])
    setAcceptedValues([])
  }

  const transportFor = (id: string, signal: AbortSignal): TranslateTextsFn | null => {
    if (id === 'free') return makeFreeTranslateTexts({ signal })
    if (id === 'selected-ai' && aiSelection) {
      const callLLM = makeBrowserCallLLM(
        {
          providerId: aiSelection.providerId,
          model: aiSelection.modelId,
          apiKey: getKey(aiSelection.providerId)
        },
        { signal }
      )
      return makeArisAiTranslateTexts(callLLM)
    }
    return null
  }

  openReviewRef.current = (target?: 'en' | 'ar'): void => {
    const resolvedTarget = target ?? (contentLang === 'en' ? 'ar' : 'en')
    const document = getCanvas()?.document ?? liveDocument
    const result = buildArisLocalizationReview({
      document,
      target: resolvedTarget,
      active: contentLang,
      ...(resources ? { resources } : {})
    })
    if (result.review.complete) {
      onToast(
        tk('aris.translate.nothingMissing', 'Every label already has both languages.'),
        'info'
      )
      return
    }
    // The AI provider is never pre-armed; the free chain is the default and its
    // "Translate now" click is the outbound consent. The configured AI provider
    // is offered only when a key is actually stored.
    const selection = getProviderSelection()
    setAiSelection(selection && hasKey(selection.providerId) ? selection : null)
    setSession({ result, target: resolvedTarget })
    setProviderId('free')
    setProposals([])
    setAcceptedValues([])
    setStatus(null)
    setTechnicalDetail(null)
    setRetryingFieldId(null)
    setBusy(false)
    setOpen(true)
  }

  useImperativeHandle(ref, () => ({ openReview: (target) => openReviewRef.current(target) }), [])

  // Abort any in-flight run when the controller unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  // Abort the automatic translation run only when the controller unmounts — the
  // auto-run effect deliberately owns no cleanup so a churning dep (getCanvas)
  // can't abort its own in-flight run one commit later.
  useEffect(() => () => autoControllerRef.current?.abort(), [])

  const providers = useMemo(() => {
    const options: { id: string; label: string; description: string }[] = []
    if (aiSelection) {
      const spec = getLiteProvider(aiSelection.providerId)
      options.push({
        id: 'selected-ai',
        label: `${spec.label} · ${aiSelection.modelId}`,
        description: t('translationReview.provider.ai')
      })
    }
    options.push({
      id: 'free',
      label: 'Google Translate → MyMemory',
      description: t('translationReview.provider.free')
    })
    return options
  }, [aiSelection])

  const disclosure = useMemo<ExternalRequestDisclosure | null>(() => {
    if (!session) return null
    if (providerId === 'free') {
      return buildArisTranslationDisclosure(session.result.review, {
        providerId: 'free',
        kind: 'free'
      })
    }
    if (providerId === 'selected-ai' && aiSelection) {
      return buildArisTranslationDisclosure(session.result.review, {
        providerId: aiSelection.providerId,
        modelId: aiSelection.modelId,
        kind: 'ai'
      })
    }
    return null
  }, [session, providerId, aiSelection])

  const handleTranslateNow = async (): Promise<void> => {
    if (!session) return
    const controller = new AbortController()
    const transport = transportFor(providerId, controller.signal)
    if (!transport) {
      const message = t('translationReview.noProvider')
      setStatus(message)
      onToast(message, 'error')
      return
    }
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setStatus(t('translationReview.running'))
    setTechnicalDetail(null)
    try {
      const run = await runArisReviewedTranslation(
        session.result.review,
        transport,
        controller.signal
      )
      if (abortRef.current !== controller) return
      setProposals((previous) => mergeProposals(previous, run.proposals))
      if (run.failures.length > 0) {
        const document = getCanvas()?.document ?? liveDocument
        const result = buildArisLocalizationReview({
          document,
          target: session.target,
          active: contentLang,
          providerFailures: run.failures,
          ...(resources ? { resources } : {})
        })
        setSession({ result, target: session.target })
      }
      setStatus(
        t('translationReview.runSummary', {
          proposals: run.proposals.length,
          failed: run.failures.length
        })
      )
    } catch (error) {
      if (controller.signal.aborted) return
      setStatus(
        tk('aris.translate.failed', 'The translation could not be completed: {error}', {
          error: freeErrorMessage(error)
        })
      )
      setTechnicalDetail(error instanceof Error ? error.message : String(error))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }

  const handleRetryField = async (field: TranslationRecoveryField): Promise<void> => {
    if (!session || !field.queueItem) return
    const controller = new AbortController()
    const transport = transportFor(providerId, controller.signal)
    if (!transport) return
    abortRef.current?.abort()
    abortRef.current = controller
    setRetryingFieldId(field.id)
    try {
      const singleQueue: TranslationQueueItem[] = [field.queueItem]
      const run = await runArisReviewedTranslation(
        { ...session.result.review, queue: singleQueue },
        transport,
        controller.signal
      )
      if (abortRef.current !== controller) return
      setProposals((previous) => mergeProposals(previous, run.proposals))
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRetryingFieldId(null)
    }
  }

  const handleManualEdit = async (
    field: TranslationRecoveryField,
    value: string
  ): Promise<void> => {
    if (!session) return
    const validation = validateTranslationRecoveryValue(session.result.review, field, value)
    if (!validation.valid) throw new InvalidTranslationRecoveryValueError(validation.issues)
    const proposal: TranslationOutputProposal = {
      processId: field.processId,
      elementId: field.elementId,
      field: field.field,
      sourceLanguage: field.sourceLanguage,
      sourceValue: field.sourceValue,
      target: field.target,
      value: validation.value
    }
    setAcceptedValues((previous) => mergeProposals(previous, [proposal]))
  }

  const handleApply = async (): Promise<void> => {
    if (!session) return
    const canvas = getCanvas()
    if (!canvas) return
    const { target } = session

    // Staleness gate: re-extract and compare the raw source signature. If the
    // model moved under review, refresh the dialog rather than write stale text.
    const fresh = buildArisLocalizationReview({
      document: canvas.document,
      target,
      active: contentLang,
      ...(resources ? { resources } : {})
    })
    if ((fresh.sourceSignature ?? '') !== (session.result.sourceSignature ?? '')) {
      onToast(
        tk('aris.translate.stale', 'The model changed during review — the list was refreshed.'),
        'info'
      )
      setSession({ result: fresh, target })
      setProposals([])
      setAcceptedValues([])
      setStatus(null)
      setTechnicalDetail(null)
      return
    }

    const review = session.result.review
    const proposalPatches = acceptedValues
      .map((proposal) => proposalToPatch(proposal, review))
      .filter((patch): patch is LocalizationPatch => patch !== null)
    const updates = toArisTranslationUpdates(
      [...proposalPatches, ...review.localUpdates],
      session.result.owners
    )

    let count = 0
    try {
      count = applyArisTranslations(
        canvas,
        updates,
        tk('aris.translate.gestureLabel', 'Translate labels')
      )
    } catch (error) {
      onToast(
        tk('aris.translate.failed', 'The translation could not be applied: {error}', {
          error: error instanceof Error ? error.message : String(error)
        }),
        'error'
      )
      return
    }

    onToast(
      tk('aris.translate.applied', 'Applied {count} translations as one undoable step.', { count }),
      'success'
    )
    // Only the explicitly accepted provider/manual pairs are persisted; the
    // glossary/TM local updates already live in the resources.
    for (const proposal of acceptedValues) onAcceptedPair?.(proposalPair(proposal))
    resetSession()
  }

  // --- automatic translation for every opened model ----------------------------
  useEffect(() => {
    if (!autoTranslateEligible) return
    if (autoRanRef.current) return
    if (getPref('arisAutoTranslate') === 'off') {
      onAutoTranslateState?.('off')
      return
    }
    const canvas = getCanvas()
    if (!canvas) return
    autoRanRef.current = true

    const controller = new AbortController()
    autoControllerRef.current = controller
    void (async () => {
      const target = contentLang === 'en' ? 'ar' : 'en'
      const result = buildArisLocalizationReview({
        document: canvas.document,
        target,
        active: contentLang,
        queueDirections: 'both',
        ...(resources ? { resources } : {})
      })
      const sendable = result.review.queue.filter(
        (item) => item.requiresSegmentationReview !== true
      )
      const maxItems = Math.max(0, Math.floor(autoTranslateMaxItems))
      const capped = sendable.slice(0, maxItems)
      if (capped.length > 0) {
        onAutoTranslateState?.('running')
        onToast(
          tk('aris.translate.autoRunning', 'Translating {count} labels automatically…', {
            count: capped.length
          }),
          'info'
        )
      }

      let autoProposals: readonly TranslationOutputProposal[] = []
      let failedCount = 0
      if (capped.length > 0) {
        try {
          const run = await runArisReviewedTranslation(
            { ...result.review, queue: capped },
            makeFreeTranslateTexts({ signal: controller.signal }),
            controller.signal
          )
          autoProposals = run.proposals
          failedCount = run.failures.length
        } catch (error) {
          if (controller.signal.aborted) return
          onAutoTranslateState?.('failed')
          onToast(
            tk('aris.translate.autoFailed', 'Automatic translation failed: {error}', {
              error: freeErrorMessage(error)
            }),
            'error'
          )
          return
        }
      }
      if (controller.signal.aborted) return

      const fresh = buildArisLocalizationReview({
        document: canvas.document,
        target,
        active: contentLang,
        queueDirections: 'both',
        ...(resources ? { resources } : {})
      })
      if ((fresh.sourceSignature ?? '') !== (result.sourceSignature ?? '')) {
        onAutoTranslateState?.('partial')
        return
      }

      const patches = autoProposals
        .map((proposal) => proposalToPatch(proposal, result.review))
        .filter((patch): patch is LocalizationPatch => patch !== null)
      const updates = toArisTranslationUpdates(
        [...patches, ...result.review.localUpdates],
        result.owners
      )
      let count = 0
      if (updates.length > 0) {
        try {
          count = applyArisTranslations(
            canvas,
            updates,
            tk('aris.translate.gestureLabel', 'Translate labels')
          )
        } catch (error) {
          onAutoTranslateState?.('failed')
          onToast(
            tk('aris.translate.autoFailed', 'Automatic translation failed: {error}', {
              error: freeErrorMessage(error)
            }),
            'error'
          )
          return
        }
      }

      const remaining = sendable.length - capped.length + failedCount
      onAutoTranslateState?.(remaining > 0 ? 'partial' : 'done')
      if (remaining > 0) {
        onToast(
          tk(
            'aris.translate.autoPartial',
            'Translated {applied} labels automatically; {remaining} could not be translated — open Translate… to review.',
            { applied: count, remaining }
          ),
          'info'
        )
      } else if (count > 0) {
        onToast(
          tk(
            'aris.translate.autoDone',
            'Translated {count} labels automatically — Undo reverts, review from the toolbar.',
            { count }
          ),
          'success'
        )
      }
      for (const proposal of autoProposals) onAcceptedPair?.(proposalPair(proposal))
    })()
  }, [
    autoTranslateEligible,
    autoTranslateMaxItems,
    getCanvas,
    contentLang,
    resources,
    onToast,
    onAcceptedPair,
    onAutoTranslateState
  ])

  if (!open || !session) return null

  return (
    <TranslationReviewDialog
      review={session.result.review}
      documentName={documentName}
      disclosure={disclosure}
      providers={providers}
      providerId={providerId}
      busy={busy}
      status={status}
      technicalDetail={technicalDetail}
      retryingFieldId={retryingFieldId}
      proposals={proposals}
      acceptedValues={acceptedValues}
      onProviderChange={setProviderId}
      onTranslateNow={() => void handleTranslateNow()}
      onPartialPreview={() => void handleApply()}
      onApplyCompleted={() => void handleApply()}
      onRetryField={handleRetryField}
      onManualEdit={handleManualEdit}
      onAcceptProposal={(_field, proposal) =>
        setAcceptedValues((previous) => mergeProposals(previous, [proposal]))
      }
      onRejectProposal={(_field, proposal) =>
        setProposals((previous) => removeProposal(previous, proposal))
      }
      onPostpone={resetSession}
      onCancelTranslation={() => {
        abortRef.current?.abort()
        abortRef.current = null
        setBusy(false)
        setStatus(null)
      }}
    />
  )
}

export const ArisTranslateController = forwardRef(ArisTranslateControllerInner)
ArisTranslateController.displayName = 'ArisTranslateController'
