import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { queryKeys } from '../../app/queryKeys'

import { Conversation } from '../../features/messages/components/Conversation'

import { renderWithProviders } from '../support/renderWithProviders'

import type { Message } from '../../features/messages/model'

const message = (idMessage: string, text = 'Сообщение'): Message => ({
  chatId: 'chat',
  idMessage,
  text,
  timestamp: 1,
  direction: 'incoming',
  status: 'delivered',
})
function setup() {
  const send = vi.fn(() => true)
  const view = renderWithProviders(
    <Conversation
      chat={{ chatId: 'chat', phoneNumber: '79991234567' }}
      sessionId="session"
      isSending={false}
      onSendMessage={send}
    />,
  )
  return { ...view, send }
}

it('focuses composer on chat entry and returns focus after submitting by button', async () => {
  const { send } = setup()
  const user = userEvent.setup()
  const composer = screen.getByLabelText('Сообщение')
  expect(composer).toHaveFocus()
  await user.type(composer, 'Привет 👋')
  await user.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(send).toHaveBeenCalledWith('chat', 'Привет 👋')
  expect(composer).toHaveFocus()
  expect(composer).toHaveValue('')
})

it('makes the scrollable log reachable by keyboard and exposes validation errors', () => {
  setup()
  expect(screen.getByRole('log')).toHaveAttribute('tabindex', '0')
  const input = screen.getByLabelText('Сообщение')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('alert')).toHaveTextContent('4096')
})

it('renders markup literally, preserving newlines and emoji', async () => {
  const { queryClient } = setup()
  const text = '<img src=x onerror=alert(1)>\nПривет 👋'
  await act(async () => {
    queryClient.setQueryData(queryKeys.messages('session', 'chat'), [
      message('1', text),
    ])
  })
  const log = screen.getByRole('log')
  await waitFor(() => expect(log.textContent).toContain(text))
  expect(log.querySelector('img')).toBeNull()
  expect(log.querySelector('.message-text')).toHaveTextContent('Привет 👋')
})

it('scrolls only on new messages near bottom and preserves a reader scroll position and status-only updates', async () => {
  const { queryClient } = setup()
  const log = screen.getByRole('log')
  Object.defineProperties(log, {
    scrollHeight: { value: 1000, configurable: true },
    clientHeight: { value: 200, configurable: true },
  })
  const key = queryKeys.messages('session', 'chat')
  await act(async () => {
    queryClient.setQueryData(key, [message('1')])
  })
  await waitFor(() => expect(log.scrollTop).toBe(1000))
  log.scrollTop = 200
  fireEvent.scroll(log)
  await act(async () => {
    queryClient.setQueryData(key, [message('1'), message('2')])
  })
  await waitFor(() => expect(log.querySelectorAll('article')).toHaveLength(2))
  expect(log.scrollTop).toBe(200)
  log.scrollTop = 800
  fireEvent.scroll(log)
  await act(async () => {
    queryClient.setQueryData(key, [message('1'), message('2'), message('3')])
  })
  await waitFor(() => expect(log.scrollTop).toBe(1000))
  log.scrollTop = 800
  await act(async () => {
    queryClient.setQueryData(key, [
      message('1'),
      message('2'),
      { ...message('3'), status: 'read' },
    ])
  })
  expect(log.scrollTop).toBe(800)
})

it('does not format existing rows again when typing draft or rerendering parent', async () => {
  const { queryClient, rerender } = setup()
  await act(async () => {
    queryClient.setQueryData(
      queryKeys.messages('session', 'chat'),
      Array.from({ length: 500 }, (_, i) => message(String(i))),
    )
  })
  await waitFor(() =>
    expect(screen.getByRole('log').querySelectorAll('article')).toHaveLength(
      500,
    ),
  )
  const format = vi.spyOn(Date.prototype, 'toISOString')
  fireEvent.change(screen.getByLabelText('Сообщение'), {
    target: { value: 'a' },
  })
  rerender(
    <QueryClientProvider client={queryClient}>
      <Conversation
        chat={{ chatId: 'chat', phoneNumber: '79991234567' }}
        sessionId="session"
        isSending={false}
        onSendMessage={() => true}
      />
    </QueryClientProvider>,
  )
  expect(format).not.toHaveBeenCalled()
  format.mockRestore()
})

it('lets user dismiss a chat incident and still displays a subsequent incident', async () => {
  const { queryClient } = setup()
  const key = queryKeys.chatError('session', 'chat')
  await act(async () => {
    queryClient.setQueryData(key, 'Старый отказ')
  })
  await screen.findByText('Старый отказ')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  )
  await act(async () => {
    queryClient.setQueryData(key, 'Новый отказ')
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('Новый отказ')
})

it('exposes the author of both incoming and outgoing messages in text', async () => {
  const { queryClient } = setup()
  await act(async () => {
    queryClient.setQueryData(queryKeys.messages('session', 'chat'), [
      message('in'),
      { ...message('out'), direction: 'outgoing', status: 'sent' },
    ])
  })
  await waitFor(() =>
    expect(screen.getByRole('log').querySelectorAll('article')).toHaveLength(2),
  )
  const rows = screen.getByRole('log').querySelectorAll('article')
  expect(rows[0]).toHaveTextContent('Собеседник')
  expect(rows[1]).toHaveTextContent('Вы')
})
