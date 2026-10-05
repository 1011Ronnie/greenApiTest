import { useEffect, useRef, useState } from 'react'

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import { queryKeys } from '../../../app/queryKeys'
import { errorMessage } from '../../../shared/errorMessage'
import { MAX_TEXT_MESSAGE_LENGTH } from '../../../shared/messageLimits'

import { Conversation } from '../../messages/components/Conversation'
import { createSessionRuntime } from '../../messages/sessionRuntime'
import { normalizePhone } from '../model'
import { ChatList } from './ChatList'
import { ChatSessionHeader } from './ChatSessionHeader'
import { ConsumerNotice } from './ConsumerNotice'
import { NewChatForm } from './NewChatForm'

import type { Credentials } from '../../../api/types'
import type { ConsumerState } from '../../notifications/consumer'
import type { Chat } from '../model'
import type { FormEvent } from 'react'

interface ChatSessionProps {
  credentials: Credentials
  sessionId: string
  signal: AbortSignal
  onDisconnect: () => void
}

export function ChatSession({
  credentials,
  sessionId,
  signal,
  onDisconnect,
}: ChatSessionProps) {
  const queryClient = useQueryClient()
  const [runtime] = useState(() =>
    createSessionRuntime(credentials, sessionId, signal, queryClient),
  )
  const [consumerState, setConsumerState] = useState<ConsumerState>({
    phase: 'receiving',
  })
  const [pendingChats, setPendingChats] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const runControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const unsubscribe = runtime.subscribe()
    const controller = new AbortController()
    runControllerRef.current = controller
    const consumerSignal = AbortSignal.any([signal, controller.signal])
    void runtime.consumer.run(consumerSignal, (state) => {
      if (!consumerSignal.aborted) setConsumerState(state)
    })
    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [runtime, signal])

  const sendMessage = useMutation({
    networkMode: 'always',
    mutationKey: ['session', sessionId],
    retry: false,
    gcTime: 0,
    mutationFn: ({
      chatId,
      text,
      requestSignal,
    }: {
      chatId: string
      text: string
      temporaryId: string
      requestSignal: AbortSignal
    }) => runtime.client.sendMessage(chatId, text, requestSignal),
    onMutate: ({ chatId, temporaryId, text, requestSignal }) => {
      if (!requestSignal.aborted) runtime.optimistic(chatId, temporaryId, text)
    },
    onSuccess: (messageResponse, { chatId, temporaryId, requestSignal }) => {
      if (!requestSignal.aborted)
        runtime.confirm(chatId, temporaryId, messageResponse.idMessage)
    },
    onError: (error, { chatId, temporaryId, requestSignal }) => {
      if (!requestSignal.aborted) runtime.fail(chatId, temporaryId, error)
    },
    onSettled: (_, __, { chatId, requestSignal }) => {
      runtime.unlock(chatId)
      if (!requestSignal.aborted)
        setPendingChats((previous) => {
          const next = new Set(previous)
          next.delete(chatId)
          return next
        })
    },
  })

  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string>()
  const [phone, setPhone] = useState('')
  const [formError, setFormError] = useState<string>()
  const requestRef = useRef<AbortController | null>(null)
  const isAccountCheckLockedRef = useRef(false)
  const phoneInputRef = useRef<HTMLInputElement>(null)
  const client = runtime.client

  useEffect(() => {
    phoneInputRef.current?.focus()
    return () => requestRef.current?.abort()
  }, [])

  const checkAccount = useMutation({
    networkMode: 'always',
    mutationKey: ['session', sessionId],
    retry: false,
    gcTime: 0,
    mutationFn: ({
      phoneNumber,
      controller,
    }: {
      phoneNumber: string
      controller: AbortController
    }) =>
      client.checkAccount(
        phoneNumber,
        AbortSignal.any([signal, controller.signal]),
      ),
    onSuccess: (account, { phoneNumber, controller }) => {
      if (signal.aborted || controller.signal.aborted) return
      if (!account.exist) {
        setFormError(
          'Аккаунт не найден или номер скрыт настройками приватности Telegram.',
        )
        return
      }
      runtime.registerChat(account.chatId)
      setChats((previous) =>
        previous.some((chat) => chat.chatId === account.chatId)
          ? previous
          : [...previous, { chatId: account.chatId, phoneNumber }],
      )
      setSelectedChatId(account.chatId)
      setPhone('')
    },
    onError: (error, { controller }) => {
      if (!signal.aborted && !controller.signal.aborted)
        setFormError(errorMessage(error))
    },
    onSettled: () => {
      isAccountCheckLockedRef.current = false
    },
  })

  const { data: sessionError } = useQuery<string>({
    queryKey: queryKeys.chatError(sessionId, '__session__'),
    queryFn: skipToken,
  })
  const selectedChat = chats.find((chat) => chat.chatId === selectedChatId)

  function handleSendMessage(chatId: string, text: string) {
    const controller = runControllerRef.current
    if (
      consumerState.phase === 'stopped' ||
      !controller ||
      controller.signal.aborted ||
      !text.trim() ||
      text.length > MAX_TEXT_MESSAGE_LENGTH ||
      !runtime.lock(chatId)
    )
      return false
    setPendingChats((previous) => new Set([...previous, chatId]))
    sendMessage.mutate({
      chatId,
      text,
      temporaryId: `local:${crypto.randomUUID()}`,
      requestSignal: AbortSignal.any([signal, controller.signal]),
    })
    return true
  }

  function handleCreateChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isAccountCheckLockedRef.current || signal.aborted) return
    setFormError(undefined)
    try {
      const phoneNumber = normalizePhone(phone)
      requestRef.current = new AbortController()
      isAccountCheckLockedRef.current = true
      checkAccount.mutate({ phoneNumber, controller: requestRef.current })
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  function handleRecoverConsumer(shouldSkipReceipt: boolean) {
    const controller = runControllerRef.current
    if (!controller || controller.signal.aborted) return
    if (shouldSkipReceipt && consumerState.receiptId)
      runtime.consumer.skipReceipt(consumerState.receiptId)
    setConsumerState({ phase: 'receiving' })
    const consumerSignal = AbortSignal.any([signal, controller.signal])
    void runtime.consumer.run(consumerSignal, (state) => {
      if (!consumerSignal.aborted) setConsumerState(state)
    })
  }

  return (
    <section className="chat-session" aria-label="Чаты Telegram">
      <ChatSessionHeader
        idInstance={credentials.idInstance}
        onDisconnect={onDisconnect}
      />
      <ConsumerNotice
        consumerState={consumerState}
        onRecover={handleRecoverConsumer}
      >
        {sessionError && (
          <p role="alert">
            {sessionError}{' '}
            <button
              onClick={() =>
                queryClient.setQueryData(
                  queryKeys.chatError(sessionId, '__session__'),
                  '',
                )
              }
            >
              Закрыть уведомление
            </button>
          </p>
        )}
      </ConsumerNotice>
      <div className="chat-layout">
        <aside className="chat-sidebar" aria-label="Список чатов">
          <NewChatForm
            phone={phone}
            formError={formError}
            isPending={checkAccount.isPending}
            phoneInputRef={phoneInputRef}
            onPhoneChange={(value) => {
              setPhone(value)
              setFormError(undefined)
            }}
            onSubmit={handleCreateChat}
          />
          <ChatList
            chats={chats}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
          />
        </aside>
        {selectedChat ? (
          <Conversation
            key={selectedChat.chatId}
            chat={selectedChat}
            sessionId={sessionId}
            isBlocked={consumerState.phase === 'stopped'}
            isSending={pendingChats.has(selectedChat.chatId)}
            onSendMessage={handleSendMessage}
          />
        ) : (
          <section className="chat-placeholder" aria-label="Выбранный чат">
            <h2>Выберите собеседника</h2>
            <p>Созданные чаты доступны до отключения или закрытия вкладки.</p>
          </section>
        )}
      </div>
    </section>
  )
}
