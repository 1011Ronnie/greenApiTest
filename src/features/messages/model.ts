export type MessageStatus =
  'sending' | 'sent' | 'delivered' | 'read' | 'error' | 'unknown'
export type OutgoingStatus = 'delivered' | 'read' | 'failed' | 'noAccount'

export interface Message {
  chatId: string
  localId?: string
  error?: string
  idMessage: string
  direction: 'incoming' | 'outgoing'
  text: string
  timestamp: number // UNIX-время в секундах, как в уведомлениях API.
  status: MessageStatus
}

const statusRank: Record<MessageStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  error: -1,
  unknown: -1,
}

export function transitionStatus(
  current: MessageStatus,
  next: MessageStatus,
): MessageStatus {
  if (current === 'read') return current
  if (next === 'error') return current === 'delivered' ? current : next
  if (current === 'error')
    return next === 'delivered' || next === 'read' ? next : current
  return statusRank[next] > statusRank[current] ? next : current
}

export function addMessage(
  messages: readonly Message[],
  message: Message,
): readonly Message[] {
  if (
    messages.some(
      (existingMessage) =>
        existingMessage.chatId === message.chatId &&
        existingMessage.idMessage === message.idMessage,
    )
  )
    return messages
  return [...messages, message]
}

export function updateMessageStatus(
  messages: readonly Message[],
  chatId: string,
  idMessage: string | undefined,
  status: OutgoingStatus,
): readonly Message[] {
  // Без ID ошибка относится к чату: нельзя угадывать, какое сообщение не отправилось.
  if (!idMessage) return messages
  const next = status === 'failed' || status === 'noAccount' ? 'error' : status
  return messages.map((message) => {
    if (
      message.direction !== 'outgoing' ||
      message.chatId !== chatId ||
      message.idMessage !== idMessage
    )
      return message
    const resolvedStatus = transitionStatus(message.status, next)
    return resolvedStatus === message.status
      ? message
      : {
          ...message,
          status: resolvedStatus,
          error: resolvedStatus === 'error' ? message.error : undefined,
        }
  })
}

export function confirmMessage(
  messages: readonly Message[],
  chatId: string,
  temporaryId: string,
  idMessage: string,
): readonly Message[] {
  return messages.map((message) =>
    message.direction === 'outgoing' &&
    message.chatId === chatId &&
    message.idMessage === temporaryId
      ? {
          ...message,
          idMessage,
          status: transitionStatus(message.status, 'sent'),
        }
      : message,
  )
}
