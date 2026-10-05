import {
  invalidPayload,
  isNonEmptyString,
  isRecord,
} from '../../shared/validation'

import type { OutgoingStatus } from '../messages/model'

export type Notification =
  | {
      kind: 'text'
      chatId: string
      idMessage: string
      text: string
      timestamp: number
    }
  | {
      kind: 'status'
      chatId: string
      idMessage?: string
      status: OutgoingStatus
      timestamp: number
    }
  | { kind: 'unsupported'; typeWebhook: string }

const MAX_DATE_TIMESTAMP_SECONDS = 8_640_000_000_000

export function parseNotification(body: unknown): Notification {
  if (!isRecord(body) || !isNonEmptyString(body.typeWebhook))
    return invalidPayload()
  if (body.typeWebhook === 'incomingMessageReceived') {
    if (
      !isRecord(body.messageData) ||
      !isNonEmptyString(body.messageData.typeMessage)
    )
      return invalidPayload()
    const messageType = body.messageData.typeMessage
    if (messageType !== 'textMessage' && messageType !== 'extendedTextMessage')
      return { kind: 'unsupported', typeWebhook: body.typeWebhook }
    const messageContent =
      messageType === 'textMessage'
        ? body.messageData.textMessageData
        : body.messageData.extendedTextMessageData
    if (!isRecord(messageContent)) return invalidPayload()
    const text =
      messageType === 'textMessage'
        ? messageContent.textMessage
        : messageContent.text
    if (
      !isRecord(body.senderData) ||
      !isNonEmptyString(body.senderData.chatId) ||
      !isNonEmptyString(body.idMessage) ||
      typeof text !== 'string'
    )
      return invalidPayload()
    return {
      kind: 'text',
      chatId: body.senderData.chatId,
      idMessage: body.idMessage,
      text,
      timestamp: parseTimestamp(body.timestamp),
    }
  }
  if (body.typeWebhook === 'outgoingMessageStatus') {
    if (!isNonEmptyString(body.status)) return invalidPayload()
    if (
      body.status !== 'delivered' &&
      body.status !== 'read' &&
      body.status !== 'failed' &&
      body.status !== 'noAccount'
    ) {
      return { kind: 'unsupported', typeWebhook: body.typeWebhook }
    }
    if (
      !isNonEmptyString(body.chatId) ||
      (body.idMessage !== undefined && !isNonEmptyString(body.idMessage)) ||
      ((body.status === 'delivered' || body.status === 'read') &&
        !isNonEmptyString(body.idMessage))
    )
      return invalidPayload()
    return {
      kind: 'status',
      chatId: body.chatId,
      ...(isNonEmptyString(body.idMessage)
        ? { idMessage: body.idMessage }
        : {}),
      status: body.status,
      timestamp: parseTimestamp(body.timestamp),
    }
  }
  return { kind: 'unsupported', typeWebhook: body.typeWebhook }
}

function parseTimestamp(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_DATE_TIMESTAMP_SECONDS
  )
    return invalidPayload()
  return value
}
