import { expect, it } from 'vitest'

import { normalizePhone } from '../../features/chats/model'

it('normalizes formatting without rewriting the country code', () => {
  expect(normalizePhone(' +7 (999) 123-45-67 ')).toBe('79991234567')
  expect(normalizePhone('+1 202 555 0123')).toBe('12025550123')
})
it.each([
  '',
  '+',
  'abc79991234567',
  '0079991234567',
  '12345',
  '1234567890123456',
  '7+9991234567',
])('rejects invalid phone %s', (phone) => {
  expect(() => normalizePhone(phone)).toThrow()
})
