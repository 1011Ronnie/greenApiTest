import { useEffect, useRef, useState } from 'react'

import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import { queryKeys } from '../../../app/queryKeys'
import { MAX_TEXT_MESSAGE_LENGTH } from '../../../shared/messageLimits'

import { MessageComposer } from './MessageComposer'
import { MessageList } from './MessageList'

import type { Chat } from '../../chats/model'
import type { FormEvent, KeyboardEvent } from 'react'

interface ConversationProps {
  chat: Chat
  sessionId: string
  isSending: boolean
  isBlocked?: boolean
  onSendMessage: (chatId: string, text: string) => boolean
}

export function Conversation({
  chat,
  sessionId,
  isSending,
  isBlocked = false,
  onSendMessage,
}: ConversationProps) {
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string>()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    composerRef.current?.focus()
  }, [])
  const queryClient = useQueryClient()
  const { data: chatError } = useQuery<string>({
    queryKey: queryKeys.chatError(sessionId, chat.chatId),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (isSending || isBlocked) return
    if (!draft.trim() || draft.length > MAX_TEXT_MESSAGE_LENGTH) {
      setValidationError('Введите текст от 1 до 4096 символов.')
      return
    }
    if (onSendMessage(chat.chatId, draft)) {
      setDraft('')
      setValidationError(undefined)
      composerRef.current?.focus()
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      handleSubmit()
    }
  }

  return (
    <section className="conversation" aria-label="Выбранный чат">
      <h2>+{chat.phoneNumber}</h2>
      {chatError && (
        <p role="alert" className="error">
          {chatError}{' '}
          <button
            type="button"
            onClick={() =>
              queryClient.setQueryData(
                queryKeys.chatError(sessionId, chat.chatId),
                '',
              )
            }
          >
            Закрыть уведомление
          </button>
        </p>
      )}
      <MessageList chatId={chat.chatId} sessionId={sessionId} />
      <MessageComposer
        draft={draft}
        validationError={validationError}
        composerRef={composerRef}
        isSending={isSending}
        isBlocked={isBlocked}
        onDraftChange={(value) => {
          setDraft(value)
          setValidationError(undefined)
        }}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
      />
    </section>
  )
}
