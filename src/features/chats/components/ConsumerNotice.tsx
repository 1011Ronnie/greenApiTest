import type { ConsumerState } from '../../notifications/consumer'
import type { ReactNode } from 'react'

interface ConsumerNoticeProps {
  consumerState: ConsumerState
  onRecover: (shouldSkipReceipt: boolean) => void
  children?: ReactNode
}

export function ConsumerNotice({
  consumerState,
  onRecover,
  children,
}: ConsumerNoticeProps) {
  return (
    <>
      {consumerState.message && (
        <p
          className="queue-notice error"
          role={consumerState.phase === 'stopped' ? 'alert' : 'status'}
        >
          {consumerState.message}
        </p>
      )}
      {children}
      {consumerState.phase === 'stopped' && (
        <div>
          <button onClick={() => onRecover(false)}>Повторить обработку</button>
          {consumerState.receiptId && (
            <p>
              Receipt {consumerState.receiptId}, этап: {consumerState.stage}.
              Отправка приостановлена.
              {consumerState.stage === 'process' && (
                <button onClick={() => onRecover(true)}>
                  Пропустить это уведомление с потерей его данных
                </button>
              )}
            </p>
          )}
        </div>
      )}
    </>
  )
}
