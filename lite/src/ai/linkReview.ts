// Pure helpers for reviewing AI-proposed process links: partitioning them into
// confident / unsure / unmatched buckets, and applying a keep/strip decision to
// the generated XML. Kept free of React/bpmn-js so both can be unit-tested.

import { stripCalledElement } from '../links/linkOps'
import type { ProposedLink } from './browserAi'

export interface PartitionedLinks {
  /** high confidence AND the referenced process exists — link silently. */
  confident: ProposedLink[]
  /** low confidence but the referenced process exists — ask the user. */
  unsure: ProposedLink[]
  /** the referenced process is unknown — cannot link (regardless of confidence). */
  unmatched: ProposedLink[]
}

/**
 * Split proposed links by whether the referenced process is known (via
 * `isKnown`) and by the model's confidence. `unmatched` wins over confidence: a
 * link to a process the workspace does not contain can never be applied, so it
 * lands in `unmatched` whether the model was "high" or "low" about it.
 */
export function partitionLinks(
  links: ProposedLink[],
  isKnown: (id: string) => boolean
): PartitionedLinks {
  const confident: ProposedLink[] = []
  const unsure: ProposedLink[] = []
  const unmatched: ProposedLink[] = []
  for (const link of links) {
    if (!isKnown(link.calledProcess)) {
      unmatched.push(link)
    } else if (link.confidence === 'high') {
      confident.push(link)
    } else {
      unsure.push(link)
    }
  }
  return { confident, unsure, unmatched }
}

/**
 * Strip the `calledElement` attribute from every link in `links` whose
 * `elementId` is NOT in `acceptedIds` (the elements to KEEP linked). Links whose
 * id is accepted are left untouched. Returns the (possibly) transformed XML.
 */
export function applyLinkDecisions(
  xml: string,
  links: ProposedLink[],
  acceptedIds: Set<string>
): string {
  let result = xml
  for (const link of links) {
    if (!acceptedIds.has(link.elementId)) {
      result = stripCalledElement(result, link.elementId)
    }
  }
  return result
}
