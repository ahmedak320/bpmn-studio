import type {
  ListWorkspaceOptions,
  ReadFileOptions,
  WorkspaceErrorCode,
  WorkspaceFailure,
  WorkspaceOperation
} from './types'

export interface WorkspaceOperationErrorOptions {
  code: WorkspaceErrorCode
  operation: WorkspaceOperation
  message: string
  path?: string
  cause?: unknown
}

export class WorkspaceOperationError extends Error {
  readonly code: WorkspaceErrorCode
  readonly operation: WorkspaceOperation
  readonly path?: string

  constructor(options: WorkspaceOperationErrorOptions) {
    super(options.message, { cause: options.cause })
    this.name = 'WorkspaceOperationError'
    this.code = options.code
    this.operation = options.operation
    this.path = options.path
  }

  toFailure(): WorkspaceFailure {
    return {
      code: this.code,
      message: this.message,
      operation: this.operation,
      path: this.path,
      name: this.name
    }
  }
}

export class WorkspaceReadLimitError extends WorkspaceOperationError {
  readonly maxBytes: number
  readonly actualBytes: number

  constructor(path: string, maxBytes: number, actualBytes: number) {
    super({
      code: 'storage-failure',
      operation: 'read',
      path,
      message: `Workspace file "${path}" is ${actualBytes} bytes; the read limit is ${maxBytes} bytes.`
    })
    this.name = 'WorkspaceReadLimitError'
    this.maxBytes = maxBytes
    this.actualBytes = actualBytes
  }
}

export class WorkspaceListLimitError extends WorkspaceOperationError {
  readonly dimension: 'entries' | 'depth'
  readonly limit: number
  readonly actual: number

  constructor(
    path: string | undefined,
    dimension: 'entries' | 'depth',
    limit: number,
    actual: number
  ) {
    super({
      code: 'storage-failure',
      operation: 'list',
      path,
      message:
        dimension === 'entries'
          ? `Workspace listing exceeds the ${limit}-entry scan limit.`
          : `Workspace entry "${path ?? ''}" has depth ${actual}; the scan depth limit is ${limit}.`
    })
    this.name = 'WorkspaceListLimitError'
    this.dimension = dimension
    this.limit = limit
    this.actual = actual
  }
}

export const DEFAULT_WORKSPACE_LIST_LIMITS = Object.freeze({
  maxEntries: 25_000,
  maxDepth: 128
})

function boundedListLimit(value: number | undefined, label: string, hardLimit: number): number {
  if (value === undefined) return hardLimit
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'list',
      message: `${label} must be a positive safe integer.`
    })
  }
  if (value > hardLimit) {
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'list',
      message: `${label} cannot exceed the hard limit of ${hardLimit}.`
    })
  }
  return value
}

export function validatedListLimits(options: ListWorkspaceOptions): {
  readonly maxEntries: number
  readonly maxDepth: number
} {
  options.signal?.throwIfAborted()
  return {
    maxEntries: boundedListLimit(
      options.maxEntries,
      'Workspace list maxEntries',
      DEFAULT_WORKSPACE_LIST_LIMITS.maxEntries
    ),
    maxDepth: boundedListLimit(
      options.maxDepth,
      'Workspace list maxDepth',
      DEFAULT_WORKSPACE_LIST_LIMITS.maxDepth
    )
  }
}

export function validatedReadLimit(path: string, options: ReadFileOptions): number | undefined {
  options.signal?.throwIfAborted()
  const limit = options.maxBytes
  if (
    limit !== undefined &&
    (!Number.isFinite(limit) || !Number.isSafeInteger(limit) || limit < 0)
  ) {
    throw new WorkspaceOperationError({
      code: 'storage-failure',
      operation: 'read',
      path,
      message: 'Workspace read maxBytes must be a non-negative safe integer.'
    })
  }
  return limit
}

export function workspaceFailure(
  error: unknown,
  operation: WorkspaceOperation,
  path?: string
): WorkspaceFailure {
  if (error instanceof WorkspaceOperationError) return error.toFailure()

  const name = errorName(error)
  const code = classifyErrorName(name)
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string' && error
        ? error
        : `The workspace ${operation} operation failed.`

  return {
    code,
    message,
    operation,
    path,
    name
  }
}

export function asWorkspaceOperationError(
  error: unknown,
  operation: WorkspaceOperation,
  path?: string
): WorkspaceOperationError {
  if (error instanceof WorkspaceOperationError) return error
  const failure = workspaceFailure(error, operation, path)
  return new WorkspaceOperationError({
    code: failure.code,
    operation,
    path,
    message: failure.message,
    cause: error
  })
}

export function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' ? name : undefined
  }
  return undefined
}

function classifyErrorName(name: string | undefined): WorkspaceErrorCode {
  switch (name) {
    case 'AbortError':
      return 'cancelled'
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-loss'
    case 'NotFoundError':
      return 'not-found'
    case 'QuotaExceededError':
      return 'quota-exceeded'
    default:
      return 'storage-failure'
  }
}

export function notFound(operation: WorkspaceOperation, path: string): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'not-found',
    operation,
    path,
    message: `Workspace entry "${path}" was not found.`
  })
}

export function alreadyExists(
  operation: WorkspaceOperation,
  path: string
): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'already-exists',
    operation,
    path,
    message: `Workspace entry "${path}" already exists.`
  })
}

export function unsupported(
  operation: WorkspaceOperation,
  path: string | undefined,
  message: string
): WorkspaceOperationError {
  return new WorkspaceOperationError({
    code: 'unsupported',
    operation,
    path,
    message
  })
}
