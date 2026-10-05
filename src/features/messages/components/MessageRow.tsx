import { memo } from 'react'

import type { Message, MessageStatus } from '../model'

const messageStatusLabels: Record<MessageStatus, string> = {
  sending: 'Отправляется',
  sent: 'Отправлено',
  delivered: 'Доставлено',
  read: 'Прочитано',
  error: 'Ошибка отправки',
  unknown: 'Результат отправки не подтверждён',
}

const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
})
export const MessageRow = memo(function MessageRow({
  message,
}: {
  message: Message
}) {
  const date = new Date(message.timestamp * 1000)
  return (
    <article className={`message message--${message.direction}`}>
      <span className="sr-only">
        {message.direction === 'outgoing' ? 'Вы' : 'Собеседник'}
      </span>
      <p className="message-text">{message.text}</p>
      <div className="message-meta">
        <time dateTime={date.toISOString()}>{timeFormatter.format(date)}</time>
        {message.direction === 'outgoing' && (
          <span>{messageStatusLabels[message.status]}</span>
        )}
      </div>
      {message.error && (
        <p className="error">
          {message.error} Сообщение не будет повторно отправлено автоматически.
        </p>
      )}
    </article>
  )
})
