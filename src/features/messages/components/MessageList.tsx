import { memo, useEffect, useRef } from 'react'

import { skipToken, useQuery } from '@tanstack/react-query'

import { queryKeys } from '../../../app/queryKeys'

import { MessageRow } from './MessageRow'

import type { Message } from '../model'

const emptyMessages: readonly Message[] = []

export const MessageList = memo(function MessageList({
  chatId,
  sessionId,
}: {
  chatId: string
  sessionId: string
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const previousCountRef = useRef(0)
  const { data: messages = emptyMessages } = useQuery<readonly Message[]>({
    queryKey: queryKeys.messages(sessionId, chatId),
    queryFn: skipToken,
    initialData: emptyMessages,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  useEffect(() => {
    const list = listRef.current
    if (
      list &&
      messages.length > previousCountRef.current &&
      isNearBottomRef.current
    )
      list.scrollTop = list.scrollHeight
    previousCountRef.current = messages.length
  }, [messages.length])

  return (
    <div
      className="message-list"
      ref={listRef}
      role="log"
      tabIndex={0}
      aria-label="Сообщения"
      aria-live="polite"
      onScroll={() => {
        const list = listRef.current
        if (list)
          isNearBottomRef.current =
            list.scrollHeight - list.scrollTop - list.clientHeight < 80
      }}
    >
      {!messages.length && <p>Сообщений пока нет. Напишите собеседнику.</p>}
      {messages.map((message) => (
        <MessageRow
          key={message.localId ?? message.idMessage}
          message={message}
        />
      ))}
    </div>
  )
})
