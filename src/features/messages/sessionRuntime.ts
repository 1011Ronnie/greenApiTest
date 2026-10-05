import { GreenApiError } from '../../api/errors'
import { createGreenApiClient } from '../../api/greenApi'
import { queryKeys } from '../../app/queryKeys'
import { errorMessage } from '../../shared/errorMessage'
import { isRecord } from '../../shared/validation'

import { createQueueConsumer } from '../notifications/consumer'
import { parseNotification } from '../notifications/parser'

import {
  addMessage,
  confirmMessage,
  transitionStatus,
  updateMessageStatus,
} from './model'

import type { Credentials } from '../../api/types'
import type { Message, OutgoingStatus } from './model'
import type { QueryClient } from '@tanstack/react-query'

const EARLY_STATUS_TTL_MS = 60_000
const MAX_EARLY_STATUS_IDS = 200

export function createSessionRuntime(
  credentials: Credentials,
  sessionId: string,
  signal: AbortSignal,
  queryClient: QueryClient,
) {
  const client = createGreenApiClient(credentials)
  const startedAt = Math.floor(Date.now() / 1000)
  const knownChats = new Set<string>()
  const pendingChats = new Set<string>()
  const earlyStatuses = new Map<
    string,
    {
      chatId: string
      idMessage: string
      status: OutgoingStatus
      expiresAt: number
    }[]
  >()
  const getMessagesKey = (chatId: string) =>
    queryKeys.messages(sessionId, chatId)
  const readMessages = (chatId: string) =>
    queryClient.getQueryData<readonly Message[]>(getMessagesKey(chatId)) ?? []
  const updateMessages = (
    chatId: string,
    apply: (messages: readonly Message[]) => readonly Message[],
  ) => {
    if (!signal.aborted && knownChats.has(chatId))
      queryClient.setQueryData<readonly Message[]>(
        getMessagesKey(chatId),
        (previous) => apply(previous ?? []),
      )
  }

  function pruneStatuses() {
    for (const [key, entries] of earlyStatuses) {
      const recent = entries.filter(
        (entry) =>
          pendingChats.has(entry.chatId) || entry.expiresAt > Date.now(),
      )
      if (recent.length) earlyStatuses.set(key, recent)
      else earlyStatuses.delete(key)
    }
  }

  function processNotification(body: unknown) {
    if (signal.aborted) return
    if (
      isRecord(body) &&
      typeof body.timestamp === 'number' &&
      Number.isSafeInteger(body.timestamp) &&
      body.timestamp >= 0 &&
      body.timestamp < startedAt
    )
      return
    if (
      isRecord(body) &&
      body.typeWebhook === 'incomingMessageReceived' &&
      isRecord(body.senderData) &&
      typeof body.senderData.chatId === 'string' &&
      !knownChats.has(body.senderData.chatId)
    )
      return
    const notification = parseNotification(body)
    if (
      notification.kind === 'unsupported' ||
      notification.timestamp < startedAt
    )
      return
    if (!knownChats.has(notification.chatId)) {
      if (
        notification.kind === 'status' &&
        (notification.status === 'failed' ||
          notification.status === 'noAccount')
      ) {
        queryClient.setQueryData(
          queryKeys.chatError(sessionId, '__session__'),
          'GREEN-API сообщил об отказе отправки для неизвестного адресата. Связать отказ с конкретным сообщением невозможно.',
        )
      }
      return
    }
    if (notification.kind === 'text') {
      updateMessages(notification.chatId, (messages) =>
        addMessage(messages, {
          chatId: notification.chatId,
          idMessage: notification.idMessage,
          text: notification.text,
          timestamp: notification.timestamp,
          direction: 'incoming',
          status: 'delivered',
        }),
      )
      return
    }
    if (!notification.idMessage) {
      queryClient.setQueryData(
        queryKeys.chatError(sessionId, notification.chatId),
        'GREEN-API сообщил об ошибке отправки без идентификатора сообщения. Проверьте получателя и состояние instance.',
      )
      return
    }
    const idMessage = notification.idMessage
    const hasMatchingMessage = readMessages(notification.chatId).some(
      (message) =>
        message.direction === 'outgoing' && message.idMessage === idMessage,
    )
    if (hasMatchingMessage) {
      updateMessages(notification.chatId, (messages) =>
        updateMessageStatus(
          messages,
          notification.chatId,
          idMessage,
          notification.status,
        ),
      )
    } else {
      pruneStatuses()
      const key = JSON.stringify([notification.chatId, idMessage])
      const entries = earlyStatuses.get(key) ?? []
      const previous = entries[0]?.status
      const nextStatus = notification.status
      const getMessageStatus = (status: OutgoingStatus) =>
        status === 'failed' || status === 'noAccount'
          ? ('error' as const)
          : status
      const mergedStatus =
        previous &&
        transitionStatus(
          getMessageStatus(previous),
          getMessageStatus(nextStatus),
        ) === getMessageStatus(previous)
          ? previous
          : nextStatus
      earlyStatuses.set(key, [
        {
          chatId: notification.chatId,
          idMessage,
          status: mergedStatus,
          expiresAt: Date.now() + EARLY_STATUS_TTL_MS,
        },
      ])
      if (earlyStatuses.size > MAX_EARLY_STATUS_IDS) {
        // При переполнении нельзя подтверждать уведомление: его статус ещё не сохранён.
        earlyStatuses.delete(key)
        throw new GreenApiError('capacity', 'Буфер ранних статусов заполнен')
      }
    }
  }

  const consumer = createQueueConsumer(
    client,
    processNotification,
    undefined,
    JSON.stringify([credentials.apiUrl, credentials.idInstance]),
  )

  return {
    client,
    consumer,
    process: processNotification,
    subscribe() {
      const clear = () => {
        knownChats.clear()
        pendingChats.clear()
        earlyStatuses.clear()
      }
      if (signal.aborted) clear()
      else signal.addEventListener('abort', clear, { once: true })
      return () => signal.removeEventListener('abort', clear)
    },
    registerChat(chatId: string) {
      if (!signal.aborted) knownChats.add(chatId)
    },
    lock(chatId: string) {
      if (signal.aborted || pendingChats.has(chatId)) return false
      pendingChats.add(chatId)
      return true
    },
    unlock(chatId: string) {
      pendingChats.delete(chatId)
    },
    optimistic(chatId: string, temporaryId: string, text: string) {
      updateMessages(chatId, (messages) =>
        addMessage(messages, {
          chatId,
          idMessage: temporaryId,
          localId: temporaryId,
          text,
          direction: 'outgoing',
          timestamp: Math.floor(Date.now() / 1000),
          status: 'sending',
        }),
      )
    },
    confirm(chatId: string, temporaryId: string, idMessage: string) {
      updateMessages(chatId, (messages) =>
        confirmMessage(messages, chatId, temporaryId, idMessage),
      )
      pruneStatuses()
      const key = JSON.stringify([chatId, idMessage])
      for (const entry of earlyStatuses.get(key) ?? []) {
        updateMessages(chatId, (messages) =>
          updateMessageStatus(messages, chatId, idMessage, entry.status),
        )
      }
      earlyStatuses.delete(key)
    },
    fail(chatId: string, temporaryId: string, error: unknown) {
      const isAmbiguousFailure =
        error instanceof GreenApiError &&
        ['network', 'timeout', 'payload'].includes(error.kind)
      updateMessages(chatId, (messages) =>
        messages.map((message) =>
          message.idMessage === temporaryId && message.direction === 'outgoing'
            ? {
                ...message,
                status: isAmbiguousFailure ? 'unknown' : 'error',
                error: isAmbiguousFailure
                  ? 'Сервер мог принять сообщение. Проверьте Telegram перед повторной отправкой.'
                  : errorMessage(error),
              }
            : message,
        ),
      )
    },
  }
}
export type SessionRuntime = ReturnType<typeof createSessionRuntime>
