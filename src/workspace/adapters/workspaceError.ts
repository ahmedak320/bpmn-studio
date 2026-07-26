import type {
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
