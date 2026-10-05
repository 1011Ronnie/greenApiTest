import { GreenApiError } from '../../api/errors'

import type { NotificationReceipt } from '../../api/types'

export type ConsumerState = {
  phase: 'receiving' | 'retrying' | 'stopped'
  message?: string
  receiptId?: number
  stage?: 'process' | 'delete'
}
export interface QueueClient {
  receiveNotification: (
    signal: AbortSignal,
  ) => Promise<NotificationReceipt | null>
  deleteNotification: (receiptId: number, signal: AbortSignal) => Promise<void>
}

export function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Запрос отменён', 'AbortError'))
      return
    }
    const abort = () => {
      clearTimeout(timer)
      reject(new DOMException('Запрос отменён', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

const instanceRuns = new Map<string, Promise<void>>()

// Последовательные запуски исключают параллельное чтение очереди при перезапуске в StrictMode, даже если fetch игнорирует отмену.
export function createQueueConsumer(
  client: QueueClient,
  processNotification: (body: unknown) => void,
  delay: typeof abortableDelay = abortableDelay,
  instanceKey?: string,
) {
  let tail: Promise<void> = Promise.resolve()
  let incident: { receipt: NotificationReceipt; processed: boolean } | undefined
  return {
    skipReceipt(receiptId: number) {
      if (incident?.receipt.receiptId === receiptId) incident.processed = true
    },
    run(
      signal: AbortSignal,
      onState: (state: ConsumerState) => void,
    ): Promise<void> {
      const work = (
        instanceKey ? (instanceRuns.get(instanceKey) ?? tail) : tail
      ).then(async () => {
        let receipt: NotificationReceipt | null = incident?.processed
          ? incident.receipt
          : null
        let failures = 0
        while (!signal.aborted) {
          let isProcessingReceipt = false
          try {
            onState({ phase: 'receiving' })
            if (!receipt) {
              receipt = await client.receiveNotification(signal)
              if (signal.aborted) return
              if (!receipt) {
                failures = 0
                await delay(250, signal)
                continue
              }
              isProcessingReceipt = true
              processNotification(receipt.body)
              isProcessingReceipt = false
            }
            if (signal.aborted) return
            await client.deleteNotification(receipt.receiptId, signal)
            if (signal.aborted) return
            receipt = null
            incident = undefined
            failures = 0
          } catch (error) {
            if (signal.aborted) return
            if (
              receipt &&
              failures >= 2 &&
              error instanceof GreenApiError &&
              error.kind === 'acknowledgement'
            ) {
              const processed = receipt
              try {
                const head = await client.receiveNotification(signal)
                if (signal.aborted) return
                if (head?.receiptId === processed.receiptId) {
                  incident = { receipt: processed, processed: true }
                  onState({
                    phase: 'stopped',
                    message:
                      'Удаление не подтверждено: тот же receipt остаётся в очереди. Приём и отправка приостановлены.',
                    receiptId: processed.receiptId,
                    stage: 'delete',
                  })
                  return
                }
                receipt = head
                incident = undefined
                failures = 0
                if (head) {
                  isProcessingReceipt = true
                  processNotification(head.body)
                  isProcessingReceipt = false
                }
                continue
              } catch (reconciliationError) {
                incident = {
                  receipt: receipt ?? processed,
                  processed: !isProcessingReceipt,
                }
                onState({
                  phase: 'stopped',
                  message: getStoppedMessage(reconciliationError),
                  receiptId: incident.receipt.receiptId,
                  stage: isProcessingReceipt ? 'process' : 'delete',
                })
                return
              }
            }
            if (
              isProcessingReceipt ||
              !isRetryableError(error) ||
              (receipt && failures >= 2)
            ) {
              if (receipt)
                incident = { receipt, processed: !isProcessingReceipt }
              onState({
                phase: 'stopped',
                message: getStoppedMessage(error),
                ...(receipt
                  ? {
                      receiptId: receipt.receiptId,
                      stage: isProcessingReceipt ? 'process' : 'delete',
                    }
                  : {}),
              })
              return
            }
            onState({
              phase: 'retrying',
              message: receipt
                ? 'Подтверждение уведомления не удалось. Повторяем удаление…'
                : 'Связь с GREEN-API потеряна. Повторяем получение…',
            })
            failures += 1
            try {
              await delay(
                Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000),
                signal,
              )
            } catch {
              return
            }
          }
        }
      })
      tail = work.catch(() => {})
      if (instanceKey) {
        instanceRuns.set(instanceKey, tail)
        const current = tail
        void current.then(() => {
          if (instanceRuns.get(instanceKey) === current)
            instanceRuns.delete(instanceKey)
        })
      }
      return tail
    },
  }
}

function isRetryableError(error: unknown): boolean {
  return (
    error instanceof GreenApiError &&
    (error.kind === 'network' ||
      error.kind === 'timeout' ||
      error.kind === 'acknowledgement' ||
      (error.kind === 'http' &&
        (error.status === 429 || (error.status ?? 0) >= 500)))
  )
}

function getStoppedMessage(error: unknown): string {
  if (error instanceof GreenApiError && error.kind === 'capacity')
    return 'Получение остановлено: буфер ранних статусов заполнен. Запись не подтверждена. Дождитесь завершения отправки или освобождения буфера через 60 секунд и повторите обработку.'
  if (error instanceof GreenApiError && error.kind === 'queueBlocked')
    return 'Получение остановлено: предыдущий запрос ещё выполняется. Приём и отправка приостановлены; повторите после завершения транспорта.'
  if (
    error instanceof GreenApiError &&
    error.kind === 'http' &&
    error.status === 400
  ) {
    return 'Получение остановлено: проверьте параметры instance и очистите webhookUrl в личном кабинете GREEN-API.'
  }
  if (
    error instanceof GreenApiError &&
    error.kind === 'http' &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'Получение остановлено: проверьте idInstance и токен API.'
  }
  return 'Получение остановлено: уведомление или ответ API не удалось обработать. Уведомление не подтверждено. Приём и статусы недоступны. Повторите обработку или осознанно пропустите указанное уведомление.'
}
