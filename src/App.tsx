import { useEffect, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { createGreenApiClient } from './api/greenApi'
import { queryKeys } from './app/queryKeys'
import { errorMessage } from './shared/errorMessage'

import { ChatSession } from './features/chats/components/ChatSession'
import { ConnectionForm } from './features/connection/components/ConnectionForm'

import type { Credentials, InstanceState } from './api/types'

interface ConnectionAttempt {
  id: string
  credentials: Credentials
  controller: AbortController
}

const stateMessages: Record<InstanceState, string> = {
  authorized: '',
  notAuthorized:
    'Instance не авторизован. Завершите авторизацию в личном кабинете GREEN-API.',
  starting: 'Instance запускается. Подождите и повторите подключение.',
  pendingPassword:
    'Для авторизации instance требуется пароль двухфакторной аутентификации.',
  blocked: 'Аккаунт instance заблокирован.',
  suspended: 'На аккаунте instance действуют временные ограничения.',
}

export function App() {
  const queryClient = useQueryClient()
  const [attempt, setAttempt] = useState<ConnectionAttempt>()
  const activeAttemptRef = useRef<ConnectionAttempt | undefined>(undefined)

  useEffect(
    () => () => {
      const current = activeAttemptRef.current
      current?.controller.abort()
      if (current) {
        void queryClient.cancelQueries({
          queryKey: queryKeys.session(current.id),
        })
        queryClient.removeQueries({ queryKey: queryKeys.session(current.id) })
      }
    },
    [queryClient],
  )

  // У каждой попытки уникальный ID; данные подключения нельзя включать в ключи кеша.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const connection = useQuery({
    queryKey: queryKeys.connection(attempt?.id ?? 'idle'),
    enabled: !!attempt,
    queryFn: ({ signal }) => {
      if (!attempt) throw new Error('Нет активного подключения')
      return createGreenApiClient(attempt.credentials).getStateInstance(
        AbortSignal.any([signal, attempt.controller.signal]),
      )
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const error = connection.isError
    ? errorMessage(connection.error)
    : connection.data
      ? stateMessages[connection.data]
      : undefined

  function clearAttempt() {
    const previous = activeAttemptRef.current
    activeAttemptRef.current = undefined
    previous?.controller.abort()
    if (previous) {
      void queryClient.cancelQueries({
        queryKey: queryKeys.session(previous.id),
      })
      queryClient.removeQueries({ queryKey: queryKeys.session(previous.id) })
    }
  }

  function handleDisconnect() {
    clearAttempt()
    setAttempt(undefined)
  }

  function handleConnect(credentials: Credentials) {
    clearAttempt()
    const nextAttempt = {
      id: crypto.randomUUID(),
      credentials,
      controller: new AbortController(),
    }
    activeAttemptRef.current = nextAttempt
    setAttempt(nextAttempt)
  }

  return (
    <main className="app-shell">
      {attempt && connection.data === 'authorized' ? (
        <ChatSession
          key={attempt.id}
          sessionId={attempt.id}
          credentials={attempt.credentials}
          signal={attempt.controller.signal}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <ConnectionForm
          isPending={connection.isFetching}
          error={error || undefined}
          onSubmit={handleConnect}
          onEdit={handleDisconnect}
        />
      )}
    </main>
  )
}
