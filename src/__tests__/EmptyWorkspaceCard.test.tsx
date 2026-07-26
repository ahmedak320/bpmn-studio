import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyWorkspaceCard } from '../workspace/EmptyWorkspaceCard'

// Component-level render assertions (no jsdom needed): the empty-state card is
// what an opened-but-empty folder must show instead of the old blank pane —
// the reported dead end. The App decides to render it when
// countBpmnFiles(tree) === 0 (covered in fsAccess.test.ts).

describe('EmptyWorkspaceCard', () => {
  it('renders the "no processes yet" state with a create-first button and folder hint', () => {
    const html = renderToStaticMarkup(
      <EmptyWorkspaceCard folderName="OneDrive-Processes" onCreateFirst={() => {}} />
    )
    expect(html).toContain('No processes yet')
    expect(html).toContain('Create your first process')
    // Explains the folder → files relationship, naming the opened folder.
    expect(html).toContain('OneDrive-Processes')
    expect(html).toContain('.bpmn')
    // The create action is a real button element.
    expect(html).toMatch(/<button[^>]*>[^<]*Create your first process/)
  })

  it('falls back to a generic folder label when no folder name is provided', () => {
    const html = renderToStaticMarkup(<EmptyWorkspaceCard onCreateFirst={() => {}} />)
    expect(html).toContain('this folder')
    expect(html).toContain('Create your first process')
  })
})
