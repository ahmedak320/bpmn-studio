import { tk } from './shellI18n'

/**
 * Source copy for the DMT drawing library.
 *
 * This lane cannot edit the shared dictionaries. Keeping every new message in
 * one manifest still routes all UI copy through the shell's `tk()` bridge and
 * gives the dictionary-owning lane one mechanical registration list.
 */
export const DMT_LIBRARY_MESSAGE_KEYS = Object.freeze({
  'aris.library.aria': 'DMT object library',
  'aris.library.search': 'Search objects by name, type, symbol, or alias',
  'aris.library.noResults': 'No DMT objects match this search.',
  'aris.library.group.flowDecisions': 'Flow & Decisions',
  'aris.library.group.rolesOrganization': 'Roles & Organization',
  'aris.library.group.systemsData': 'Systems & Data',
  'aris.library.group.governancePerformance': 'Governance & Performance',
  'aris.library.group.services': 'Services',
  'aris.library.group.vacd': 'VACD',
  'aris.library.group.tools': 'Drawing tools',
  'aris.library.group.annotations': 'Annotations',
  'aris.library.group.toggle': '{state} {name}',
  'aris.library.group.expand': 'Expand',
  'aris.library.group.collapse': 'Collapse',
  'aris.library.item.aria': 'Place {name}. {variants} variants.',
  'aris.library.item.tooltip': '{name}',
  'aris.library.quickConnect': '{relation}: add {peer} {direction} the selected object',
  'aris.library.direction.before': 'before',
  'aris.library.direction.after': 'after'
})

export type DmtLibraryMessageKey = keyof typeof DMT_LIBRARY_MESSAGE_KEYS

export function dmtLibraryText(
  key: DmtLibraryMessageKey,
  vars?: Record<string, string | number>
): string {
  return tk(key, DMT_LIBRARY_MESSAGE_KEYS[key], vars)
}
