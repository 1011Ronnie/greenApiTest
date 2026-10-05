import { describe, expect, it } from 'vitest'

import { parseNotification } from '../../features/notifications/parser'

const text = {
  typeWebhook: 'incomingMessageReceived',
  timestamp: 1763115112,
  idMessage: 'message-1',
  senderData: { chatId: '123' },
  messageData: {
    typeMessage: 'textMessage',
    textMessageData: { textMessage: 'Привет 👋' },
  },
}
const status = {
  typeWebhook: 'outgoingMessageStatus',
  chatId: '123',
  timestamp: 1763115112,
}

describe('notification parser', () => {
  it('parses text and delivery/read statuses', () => {
    expect(parseNotification(text)).toEqual({
      kind: 'text',
      chatId: '123',
      idMessage: 'message-1',
      timestamp: 1763115112,
      text: 'Привет 👋',
    })
    for (const value of ['delivered', 'read']) {
      expect(
        parseNotification({ ...status, status: value, idMessage: 'message-1' }),
      ).toMatchObject({ kind: 'status', status: value, idMessage: 'message-1' })
    }
  })
  it('accepts failed/noAccount without a message ID', () => {
    for (const value of ['failed', 'noAccount']) {
      expect(parseNotification({ ...status, status: value })).toEqual({
        kind: 'status',
        chatId: '123',
        timestamp: 1763115112,
        status: value,
      })
    }
  })
  it('returns unsupported types for deliberate acknowledgement by the later consumer', () => {
    expect(
      parseNotification({ typeWebhook: 'stateInstanceChanged' }).kind,
    ).toBe('unsupported')
    expect(
      parseNotification({
        ...text,
        messageData: { typeMessage: 'imageMessage' },
      }).kind,
    ).toBe('unsupported')
    expect(parseNotification({ ...status, status: 'futureStatus' }).kind).toBe(
      'unsupported',
    )
  })
  it.each([
    null,
    [],
    {},
    { ...text, idMessage: 12 },
    { ...text, timestamp: -1 },
    { ...text, timestamp: 1.2 },
    { ...text, timestamp: Number.MAX_SAFE_INTEGER },
    { ...text, senderData: {} },
    { ...text, messageData: { typeMessage: 'textMessage' } },
    { ...status, status: 'read' },
    { ...status, status: 'failed', idMessage: '' },
  ])('rejects corrupt supported payloads: %j', (body) => {
    expect(() => parseNotification(body)).toThrow(
      expect.objectContaining({ kind: 'payload' }),
    )
  })
})

it('parses extended text with URL as text and rejects its malformed body', () => {
  const body = {
    ...text,
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: { text: 'Привет https://example.com' },
    },
  }
  expect(parseNotification(body)).toMatchObject({
    kind: 'text',
    text: 'Привет https://example.com',
  })
  expect(() =>
    parseNotification({
      ...body,
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: {},
      },
    }),
  ).toThrow()
})
