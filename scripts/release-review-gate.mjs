import { closeSync, fstatSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_REVIEWS_BYTES = 8 * 1024 * 1024
const EFFECTIVE_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

function fail(message) {
  throw new Error(message)
}

function parseTimestamp(value, label) {
  const parsed = Date.parse(value)
  if (typeof value !== 'string' || !Number.isFinite(parsed)) {
    fail(`${label} must be a timestamp.`)
  }
  return parsed
}

function validLogin(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(value) &&
    !value.endsWith('-')
  )
}

export function selectEffectiveApprovals(reviews, { author, headSha, mergedAt }) {
  if (!Array.isArray(reviews)) fail('The reviews input must be a JSON array.')
  if (!validLogin(author)) fail('--author must be a valid GitHub login.')
  if (!/^[a-f0-9]{40}$/u.test(headSha)) {
    fail('--head-sha must be an exact lowercase 40-character Git SHA.')
  }
  const mergedTime = parseTimestamp(mergedAt, '--merged-at')
  const seenIds = new Set()
  const effectiveByLogin = new Map()

  for (const [index, review] of reviews.entries()) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) {
      fail(`reviews[${index}] must be a JSON object.`)
    }
    if (!EFFECTIVE_STATES.has(review.state)) continue
    if (!Number.isSafeInteger(review.id) || review.id < 1 || seenIds.has(review.id)) {
      fail(`reviews[${index}].id must be a unique positive safe integer.`)
    }
    seenIds.add(review.id)
    if (review.user?.type !== 'User' || !validLogin(review.user.login)) continue
    const login = review.user.login.toLowerCase()
    if (login === author.toLowerCase()) continue
    const submittedTime = parseTimestamp(review.submitted_at, `reviews[${index}].submitted_at`)
    if (submittedTime > mergedTime) continue
    const existing = effectiveByLogin.get(login)
    if (
      !existing ||
      submittedTime > existing.submittedTime ||
      (submittedTime === existing.submittedTime && review.id > existing.id)
    ) {
      effectiveByLogin.set(login, {
        id: review.id,
        login,
        state: review.state,
        submittedAt: review.submitted_at,
        submittedTime,
        commitId: review.commit_id,
        authorAssociation: review.author_association
      })
    }
  }

  const approvals = [...effectiveByLogin.values()]
    .filter(({ state }) => state === 'APPROVED')
    .map((review) => {
      if (review.commitId !== headSha) {
        fail(`${review.login}'s effective approval is not bound to the exact PR head SHA.`)
      }
      if (!TRUSTED_ASSOCIATIONS.has(review.authorAssociation)) {
        fail(`${review.login}'s effective approval lacks a collaborator association.`)
      }
      return {
        login: review.login,
        reviewId: review.id,
        submittedAt: review.submittedAt,
        commitId: review.commitId,
        authorAssociation: review.authorAssociation
      }
    })
    .sort((left, right) => left.login.localeCompare(right.login))

  if (approvals.length === 0) {
    fail('No independent effective approval remains at the PR merge time.')
  }
  return approvals
}

function parseCli(arguments_) {
  const required = new Set(['reviews', 'author', 'head-sha', 'merged-at', 'output'])
  const allowed = new Set(required)
  const options = new Map()
  for (const argument of arguments_) {
    const separator = argument.indexOf('=')
    if (!argument.startsWith('--') || separator < 3) {
      fail('Every CLI option must use --name=value syntax.')
    }
    const name = argument.slice(2, separator)
    const value = argument.slice(separator + 1)
    if (!allowed.has(name) || !value || options.has(name)) {
      fail('CLI options must be supported, nonempty, and unique.')
    }
    options.set(name, value)
  }
  for (const name of required) {
    if (!options.has(name)) fail(`--${name} is required.`)
  }
  return options
}

function readReviews(path) {
  const descriptor = openSync(resolve(path), 'r')
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_REVIEWS_BYTES) {
      fail(`The reviews file must contain 2 through ${MAX_REVIEWS_BYTES} bytes.`)
    }
    return JSON.parse(readFileSync(descriptor, 'utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function main() {
  const options = parseCli(process.argv.slice(2))
  const approvals = selectEffectiveApprovals(readReviews(options.get('reviews')), {
    author: options.get('author'),
    headSha: options.get('head-sha'),
    mergedAt: options.get('merged-at')
  })
  writeFileSync(
    resolve(options.get('output')),
    `${JSON.stringify({ schemaVersion: 1, approvals }, null, 2)}\n`,
    { flag: 'wx' }
  )
  console.log(`Verified ${approvals.length} effective independent PR approval(s).`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).toString() === import.meta.url) {
  main()
}
