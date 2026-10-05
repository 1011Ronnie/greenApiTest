export type ApiErrorKind =
  | 'validation'
  | 'network'
  | 'http'
  | 'payload'
  | 'api'
  | 'acknowledgement'
  | 'timeout'
  | 'queueBlocked'
  | 'capacity'

export class GreenApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'GreenApiError'
    this.kind = kind
    this.status = status
  }
}
