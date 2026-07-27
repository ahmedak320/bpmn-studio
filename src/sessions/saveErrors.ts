export type SaveFailureCode =
  | 'permission-denied'
  | 'not-found'
  | 'quota-exceeded'
  | 'conflict'
  | 'aborted'
  | 'invalid-state'
  | 'stale-workspace'
  | 'io'
  | 'unknown'

export interface ClassifiedSaveFailure {
  code: SaveFailureCode
  message: string
  retriable: boolean
  cause: unknown
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return String((error as { name: unknown }).name)
  }
  return ''
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function classifySaveFailure(error: unknown): ClassifiedSaveFailure {
  const name = errorName(error)
  const code = errorCode(error)
  const message = errorMessage(error)
  if (code === 'permission-loss') {
    return { code: 'permission-denied', message, retriable: false, cause: error }
  }
  if (code === 'stale-workspace') {
    return { code: 'stale-workspace', message, retriable: false, cause: error }
  }
  if (code === 'cancelled') {
    return { code: 'aborted', message, retriable: true, cause: error }
  }
  if (code === 'quota-exceeded') {
    return { code: 'quota-exceeded', message, retriable: true, cause: error }
  }
  if (code === 'not-found') {
    return { code: 'not-found', message, retriable: false, cause: error }
  }
  if (code === 'unsupported' || code === 'invalid-path') {
    return { code: 'invalid-state', message, retriable: false, cause: error }
  }
  if (code === 'storage-failure' || code === 'integrity-failure') {
    return { code: 'io', message, retriable: true, cause: error }
  }
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { code: 'permission-denied', message, retriable: false, cause: error }
    case 'NotFoundError':
      return { code: 'not-found', message, retriable: false, cause: error }
    case 'QuotaExceededError':
      return { code: 'quota-exceeded', message, retriable: true, cause: error }
    case 'AbortError':
      return { code: 'aborted', message, retriable: true, cause: error }
    case 'InvalidStateError':
      return { code: 'invalid-state', message, retriable: true, cause: error }
    case 'NoModificationAllowedError':
      return { code: 'permission-denied', message, retriable: false, cause: error }
    case 'TypeMismatchError':
      return { code: 'io', message, retriable: false, cause: error }
    default:
      return { code: 'unknown', message, retriable: true, cause: error }
  }
}
