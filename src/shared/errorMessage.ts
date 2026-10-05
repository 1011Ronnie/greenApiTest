import { GreenApiError } from '../api/errors'

export function errorMessage(error: unknown): string {
  return error instanceof GreenApiError
    ? error.message
    : 'Не удалось выполнить операцию. Попробуйте ещё раз.'
}
