import { describe, expect, it } from 'vitest'

import {
  addMessage,
  confirmMessage,
  transitionStatus,
  updateMessageStatus,
} from '../../features/messages/model'

import type { Message } from '../../features/messages/model'

const message: Message = {
  chatId: '123',
  idMessage: 'one',
  text: 'hello',
  direction: 'outgoing',
  timestamp: 1,
  status: 'sent',
}

describe('message model', () => {
  it('deduplicates by chat and message ID while preserving other chats', () => {
    const messages = [message]
    expect(addMessage(messages, { ...message })).toBe(messages)
    expect(addMessage(messages, { ...message, chatId: '456' })).toHaveLength(2)
    expect(messages).toEqual([message])
  })
  it('keeps delivery progress monotonic and resolves network errors only on delivery', () => {
    expect(transitionStatus('read', 'delivered')).toBe('read')
    expect(transitionStatus('delivered', 'sent')).toBe('delivered')
    expect(transitionStatus('sent', 'error')).toBe('error')
    expect(transitionStatus('read', 'error')).toBe('read')
    expect(transitionStatus('error', 'sent')).toBe('error')
    expect(transitionStatus('error', 'delivered')).toBe('delivered')
  })
  it('targets only the matching outgoing bubble and handles missing IDs safely', () => {
    const messages = [
      message,
      { ...message, chatId: '456' },
      { ...message, direction: 'incoming' as const },
    ]
    expect(updateMessageStatus(messages, '123', undefined, 'failed')).toBe(
      messages,
    )
    const updated = updateMessageStatus(messages, '123', 'one', 'read')
    expect(updated.map((item) => item.status)).toEqual(['read', 'sent', 'sent'])
    expect(messages[0]?.status).toBe('sent')
    expect(
      updateMessageStatus(messages, '123', 'one', 'noAccount')[0]?.status,
    ).toBe('error')
  })
  it('confirms an optimistic message without lowering an already received read status', () => {
    expect(
      confirmMessage(
        [{ ...message, idMessage: 'temp', status: 'sending' }],
        '123',
        'temp',
        'server',
      )[0],
    ).toMatchObject({ idMessage: 'server', status: 'sent' })
    expect(
      confirmMessage(
        [{ ...message, status: 'read' }],
        '123',
        'one',
        'server',
      )[0]?.status,
    ).toBe('read')
  })
})
