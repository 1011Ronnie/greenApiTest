import { MAX_TEXT_MESSAGE_LENGTH } from '../shared/messageLimits'
import {
  invalidPayload,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from '../shared/validation'

import { normalizePhone } from '../features/chats/model'

import { GreenApiError } from './errors'

import type {
  AccountCheck,
  Credentials,
  InstanceState,
  NotificationReceipt,
} from './types'

interface RequestOptions {
  signal?: AbortSignal
  body?: object
  suffix?: string
  timeout?: number
  allowEmpty?: boolean
}

// Блокировка очереди снимается только после завершения fetch и чтения тела, даже если транспорт игнорирует отмену.
const queueTransports = new Map<string, Promise<void>>()
export const REQUEST_DEADLINE_MS = 15000

const supportedInstanceStates: readonly string[] = [
  'authorized',
  'notAuthorized',
  'starting',
  'pendingPassword',
  'blocked',
  'suspended',
]

export function normalizeCredentials(input: Credentials): Credentials {
  let url: URL
  try {
    url = new URL(input.apiUrl.trim())
  } catch {
    throw new GreenApiError('validation', 'Введите корректный HTTPS адрес API')
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/*$/.test(url.pathname)
  ) {
    throw new GreenApiError(
      'validation',
      'Адрес API должен быть базовым HTTPS адресом без пути и параметров',
    )
  }
  const idInstance = input.idInstance.trim()
  const apiTokenInstance = input.apiTokenInstance.trim()
  if (!/^\d+$/.test(idInstance) || !apiTokenInstance) {
    throw new GreenApiError(
      'validation',
      'Укажите числовой idInstance и токен API',
    )
  }
  return { apiUrl: url.origin, idInstance, apiTokenInstance }
}

export function createGreenApiClient(
  input: Credentials,
  fetcher: typeof fetch = fetch,
) {
  const credentials = normalizeCredentials(input)

  return {
    async getStateInstance(signal?: AbortSignal): Promise<InstanceState> {
      const apiResponse = await request('GET', 'getStateInstance', { signal })
      if (
        !isRecord(apiResponse) ||
        typeof apiResponse.stateInstance !== 'string' ||
        !supportedInstanceStates.includes(apiResponse.stateInstance)
      )
        return invalidPayload()
      return apiResponse.stateInstance as InstanceState
    },
    async checkAccount(
      phone: string,
      signal?: AbortSignal,
    ): Promise<AccountCheck> {
      const phoneNumber = Number(normalizePhone(phone))
      const apiResponse = await request('POST', 'checkAccount', {
        signal,
        body: { phoneNumber },
      })
      if (!isRecord(apiResponse) || typeof apiResponse.exist !== 'boolean')
        return invalidPayload()
      if (!apiResponse.exist) return { exist: false }
      if (!isNonEmptyString(apiResponse.chatId)) return invalidPayload()
      return { exist: true, chatId: apiResponse.chatId }
    },
    async sendMessage(
      chatId: string,
      message: string,
      signal?: AbortSignal,
    ): Promise<{ idMessage: string }> {
      if (
        !isNonEmptyString(chatId) ||
        !message.trim() ||
        message.length > MAX_TEXT_MESSAGE_LENGTH
      ) {
        throw new GreenApiError(
          'validation',
          'Укажите чат и текст сообщения от 1 до 4096 символов',
        )
      }
      const apiResponse = await request('POST', 'sendMessage', {
        signal,
        body: { chatId, message },
      })
      if (!isRecord(apiResponse) || !isNonEmptyString(apiResponse.idMessage))
        return invalidPayload()
      return { idMessage: apiResponse.idMessage }
    },
    async receiveNotification(
      signal?: AbortSignal,
      receiveTimeout = 5,
    ): Promise<NotificationReceipt | null> {
      if (
        !Number.isInteger(receiveTimeout) ||
        receiveTimeout < 5 ||
        receiveTimeout > 60
      ) {
        throw new GreenApiError(
          'validation',
          'Время ожидания должно быть от 5 до 60 секунд',
        )
      }
      const apiResponse = await request('GET', 'receiveNotification', {
        signal,
        timeout: receiveTimeout,
        allowEmpty: true,
      })
      if (apiResponse === null) return null
      if (
        !isRecord(apiResponse) ||
        !isPositiveInteger(apiResponse.receiptId) ||
        !isRecord(apiResponse.body)
      )
        return invalidPayload()
      return { receiptId: apiResponse.receiptId, body: apiResponse.body }
    },
    async deleteNotification(
      receiptId: number,
      signal?: AbortSignal,
    ): Promise<void> {
      if (!isPositiveInteger(receiptId))
        throw new GreenApiError('validation', 'Некорректный receiptId')
      const apiResponse = await request('DELETE', 'deleteNotification', {
        signal,
        suffix: `/${receiptId}`,
      })
      if (!isRecord(apiResponse) || typeof apiResponse.result !== 'boolean')
        return invalidPayload()
      if (!apiResponse.result)
        throw new GreenApiError(
          'acknowledgement',
          'Удаление уведомления не подтверждено',
        )
    },
  }

  async function request(
    method: string,
    operation: string,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(
      `${credentials.apiUrl}/waInstance${credentials.idInstance}/${operation}/${encodeURIComponent(credentials.apiTokenInstance)}${options.suffix ?? ''}`,
    )
    if (options.timeout !== undefined)
      url.searchParams.set('receiveTimeout', String(options.timeout))
    const controller = new AbortController()
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal
    const timer = setTimeout(
      () => controller.abort(),
      options.timeout === undefined
        ? REQUEST_DEADLINE_MS
        : (options.timeout + 10) * 1000,
    )
    let detachAbort = () => {}
    const cancelled = new Promise<never>((_, reject) => {
      const abort = () =>
        reject(
          options.signal?.aborted
            ? new DOMException('Запрос отменён', 'AbortError')
            : new GreenApiError('timeout', 'Время ожидания GREEN-API истекло'),
        )
      detachAbort = () => signal.removeEventListener('abort', abort)
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
    void cancelled.catch(() => {})
    const queueKey = JSON.stringify([
      credentials.apiUrl,
      credentials.idInstance,
    ])
    const isQueueOperation =
      operation === 'receiveNotification' || operation === 'deleteNotification'
    let payload: string
    try {
      if (isQueueOperation) {
        try {
          await Promise.race([
            queueTransports.get(queueKey) ?? Promise.resolve(),
            cancelled,
          ])
        } catch (error) {
          if (error instanceof GreenApiError && error.kind === 'timeout') {
            throw new GreenApiError(
              'queueBlocked',
              'Предыдущий запрос очереди ещё не завершён. Ожидайте завершения транспорта перед повтором.',
            )
          }
          throw error
        }
      }
      signal.throwIfAborted()
      const transport = (async () => {
        const response = await fetcher(url.toString(), {
          method,
          signal,
          redirect: 'error',
          ...(options.body
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options.body),
              }
            : {}),
        })
        if (!response.ok) {
          throw new GreenApiError(
            'http',
            `Ошибка GREEN-API (HTTP ${response.status})`,
            response.status,
          )
        }
        return await response.text()
      })()
      if (isQueueOperation) {
        const lease = transport.then(
          () => {},
          () => {},
        )
        queueTransports.set(queueKey, lease)
        void lease.then(() => {
          if (queueTransports.get(queueKey) === lease)
            queueTransports.delete(queueKey)
        })
      }
      payload = await Promise.race([transport, cancelled])
    } catch (error) {
      // URL, текст ответа и исходная ошибка могут содержать токен; их нельзя передавать дальше.
      if (
        options.signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new DOMException('Запрос отменён', 'AbortError')
      }
      if (
        error instanceof GreenApiError &&
        (error.kind === 'http' ||
          error.kind === 'timeout' ||
          error.kind === 'queueBlocked')
      )
        throw error
      throw new GreenApiError('network', 'Не удалось связаться с GREEN-API')
    } finally {
      clearTimeout(timer)
      detachAbort()
    }
    if (!payload.trim()) {
      if (options.allowEmpty) return null
      return invalidPayload()
    }
    let apiResponse: unknown
    try {
      apiResponse = JSON.parse(payload)
    } catch {
      return invalidPayload()
    }
    if (
      isRecord(apiResponse) &&
      (apiResponse.status === false || apiResponse.error !== undefined)
    ) {
      throw new GreenApiError(
        'api',
        'GREEN-API не выполнил операцию. Проверьте состояние instance и ограничения API',
      )
    }
    return apiResponse
  }
}
