import { GreenApiError } from '../../api/errors'

export interface Chat {
  chatId: string
  phoneNumber: string
}

export function normalizePhone(input: string): string {
  const trimmed = input.trim()
  if (!/^\+?[\d\s()-]+$/.test(trimmed)) {
    throw new GreenApiError(
      'validation',
      'Введите номер в международном формате',
    )
  }
  const phone = trimmed.replace(/[\s()+-]/g, '')
  if (!/^[1-9]\d{6,14}$/.test(phone)) {
    throw new GreenApiError(
      'validation',
      'Номер должен содержать от 7 до 15 цифр и код страны',
    )
  }
  return phone
}
