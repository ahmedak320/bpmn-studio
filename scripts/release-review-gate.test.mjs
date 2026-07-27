import assert from 'node:assert/strict'
import test from 'node:test'
import { selectEffectiveApprovals } from './release-review-gate.mjs'

const headSha = '0123456789abcdef0123456789abcdef01234567'
const mergedAt = '2026-07-20T12:00:00Z'

function review(
  id,
  login,
  state,
  submittedAt,
  { commitId = headSha, authorAssociation = 'COLLABORATOR', type = 'User' } = {}
) {
  return {
    id,
    state,
    submitted_at: submittedAt,
    commit_id: commitId,
    author_association: authorAssociation,
    user: { login, type }
  }
}

function select(reviews) {
  return selectEffectiveApprovals(reviews, {
    author: 'pull-author',
    headSha,
    mergedAt
  })
}

test('uses all paginated reviews and the latest effective state per reviewer', () => {
  const comments = Array.from({ length: 35 }, (_, index) => ({
    id: index + 1,
    state: 'COMMENTED',
    user: { login: `commenter-${index}`, type: 'User' }
  }))
  const reviews = [
    ...comments,
    review(100, 'trusted-reviewer', 'APPROVED', '2026-07-20T10:00:00Z'),
    review(101, 'trusted-reviewer', 'CHANGES_REQUESTED', '2026-07-20T11:00:00Z')
  ]
  assert.throws(() => select(reviews), /No independent effective approval/)

  reviews.push(review(102, 'trusted-reviewer', 'APPROVED', '2026-07-20T11:30:00Z'))
  assert.deepEqual(
    select(reviews).map(({ login }) => login),
    ['trusted-reviewer']
  )
})

test('dismissal, author review, and post-merge approval cannot satisfy the gate', () => {
  assert.throws(
    () =>
      select([
        review(1, 'reviewer', 'APPROVED', '2026-07-20T10:00:00Z'),
        review(2, 'reviewer', 'DISMISSED', '2026-07-20T11:00:00Z'),
        review(3, 'pull-author', 'APPROVED', '2026-07-20T11:30:00Z'),
        review(4, 'late-reviewer', 'APPROVED', '2026-07-20T12:00:01Z')
      ]),
    /No independent effective approval/
  )
})

test('requires exact head binding and collaborator association', () => {
  assert.throws(
    () =>
      select([
        review(1, 'reviewer', 'APPROVED', '2026-07-20T10:00:00Z', {
          commitId: 'f'.repeat(40)
        })
      ]),
    /exact PR head SHA/
  )
  assert.throws(
    () =>
      select([
        review(1, 'reviewer', 'APPROVED', '2026-07-20T10:00:00Z', {
          authorAssociation: 'NONE'
        })
      ]),
    /collaborator association/
  )
})

test('rejects duplicate identities and deterministically orders equal-time states by id', () => {
  assert.throws(
    () =>
      select([
        review(1, 'reviewer-a', 'APPROVED', '2026-07-20T10:00:00Z'),
        review(1, 'reviewer-b', 'APPROVED', '2026-07-20T10:30:00Z')
      ]),
    /unique positive/
  )
  assert.throws(
    () =>
      select([
        review(1, 'reviewer', 'APPROVED', '2026-07-20T10:00:00Z'),
        review(2, 'reviewer', 'CHANGES_REQUESTED', '2026-07-20T10:00:00Z')
      ]),
    /No independent effective approval/
  )
})
