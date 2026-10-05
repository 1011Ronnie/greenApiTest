import { StrictMode } from 'react'

import { onlineManager } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { queryKeys } from '../../app/queryKeys'

import { App } from '../../App'
import { renderWithProviders } from '../support/renderWithProviders'

import type { Message } from '../../features/messages/model'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const json = (body: unknown) => new Response(JSON.stringify(body))
const incoming = (
  idMessage: string,
  text: string,
  chatId = 'a',
  timestamp = Math.floor(Date.now() / 1000),
) => ({
  typeWebhook: 'incomingMessageReceived',
  idMessage,
  timestamp,
  senderData: { chatId },
  messageData: {
    typeMessage: 'textMessage',
    textMessageData: { textMessage: text },
  },
})
const status = (value: string, idMessage?: string, chatId = 'a') => ({
  typeWebhook: 'outgoingMessageStatus',
  status: value,
  chatId,
  timestamp: Math.floor(Date.now() / 1000),
  ...(idMessage ? { idMessage } : {}),
})

const pendingTransports: (() => void)[] = []
function setup() {
  const receives: {
    signal?: AbortSignal | null
    resolve: (response: Response) => void
  }[] = []
  const sends: {
    reject: (reason: unknown) => void
    body: { chatId: string; message: string }
    signal?: AbortSignal | null
    resolve: (response: Response) => void
  }[] = []
  const deletions: number[] = []
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = getRequestUrl(input)
    if (url.includes('/getStateInstance/'))
      return json({ stateInstance: 'authorized' })
    if (url.includes('/checkAccount/')) {
      const { phoneNumber } = JSON.parse(getRequestBody(init)) as {
        phoneNumber: number
      }
      return json({
        exist: true,
        chatId: phoneNumber === 79991234567 ? 'a' : 'b',
      })
    }
    if (url.includes('/receiveNotification/')) {
      const request = deferred<Response>()
      pendingTransports.push(() => request.resolve(json(null)))
      receives.push({ ...request, signal: init?.signal })
      return request.promise
    }
    if (url.includes('/deleteNotification/')) {
      deletions.push(Number(url.split('/').at(-1)))
      return json({ result: true })
    }
    if (url.includes('/sendMessage/')) {
      const request = deferred<Response>()
      pendingTransports.push(() => request.resolve(json(null)))
      sends.push({
        ...request,
        body: JSON.parse(getRequestBody(init)) as {
          chatId: string
          message: string
        },
        signal: init?.signal,
      })
      return request.promise
    }
    throw new Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetcher)
  const view = renderWithProviders(
    <StrictMode>
      <App />
    </StrictMode>,
  )
  const user = userEvent.setup()
  async function connect() {
    fireEvent.change(screen.getByLabelText('Адрес API (HTTPS)'), {
      target: { value: 'https://example.com' },
    })
    fireEvent.change(screen.getByLabelText('idInstance'), {
      target: { value: '1' },
    })
    fireEvent.change(screen.getByLabelText('Токен API'), {
      target: { value: 'fake-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
    await screen.findByRole('button', { name: 'Отключиться' })
  }
  async function add(phone = '+7 999 123-45-67') {
    fireEvent.change(screen.getByLabelText('Номер телефона с кодом страны'), {
      target: { value: phone },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }))
    await screen.findByRole('heading', { name: '+' + phone.replace(/\D/g, '') })
  }
  function send(text = 'Hello') {
    fireEvent.change(screen.getByLabelText('Сообщение'), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  }
  let receiptId = 0
  async function notify(body: unknown) {
    await waitFor(() =>
      expect(receives.some((request) => !request.signal?.aborted)).toBe(true),
    )
    const request = receives.splice(
      receives.findIndex((item) => !item.signal?.aborted),
      1,
    )[0]!
    const id = ++receiptId
    await act(async () => {
      request.resolve(json({ receiptId: id, body }))
    })
    await waitFor(() => expect(deletions).toContain(id))
  }
  function sessionId() {
    return String(
      view.queryClient
        .getQueryCache()
        .getAll()
        .find((query) => query.state.data === 'authorized')!.queryKey[1],
    )
  }
  function messages(chatId = 'a') {
    return (
      view.queryClient.getQueryData<readonly Message[]>(
        queryKeys.messages(sessionId(), chatId),
      ) ?? []
    )
  }
  return {
    ...view,
    user,
    receives,
    sends,
    deletions,
    fetcher,
    connect,
    add,
    send,
    notify,
    messages,
    sessionId,
  }
}
afterEach(async () => {
  pendingTransports.splice(0).forEach((settle) => settle())
  await Promise.resolve()
  vi.unstubAllGlobals()
})

it('adds an optimistic bubble, binds server ID and applies early read without lowering it', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send('Hello 👋')
  await screen.findByText('Отправляется')
  await waitFor(() => expect(app.sends).toHaveLength(1))
  expect(app.messages()[0]).toMatchObject({
    text: 'Hello 👋',
    status: 'sending',
  })
  await app.notify(status('read', 'server'))
  await act(async () => {
    app.sends[0]!.resolve(json({ idMessage: 'server' }))
  })
  await screen.findByText('Прочитано')
  await app.notify(status('delivered', 'server'))
  expect(app.messages()[0]).toMatchObject({
    idMessage: 'server',
    status: 'read',
  })
  expect(screen.getAllByText('Hello 👋')).toHaveLength(1)
})

it('deduplicates text, acknowledges unsupported/unknown/old notifications and ignores their UI', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  await app.notify(incoming('in-1', 'Ответ'))
  await app.notify(incoming('in-1', 'Ответ'))
  await app.notify(incoming('other', 'Чужой чат', 'unknown'))
  await app.notify(incoming('old', 'Старое сообщение', 'a', 1))
  await app.notify({ typeWebhook: 'stateInstanceChanged' })
  expect(screen.getAllByText('Ответ')).toHaveLength(1)
  expect(screen.queryByText('Чужой чат')).not.toBeInTheDocument()
  expect(screen.queryByText('Старое сообщение')).not.toBeInTheDocument()
  expect(app.deletions).toHaveLength(5)
})

it('retains a failed bubble without retrying a possibly accepted send', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send('Не потерять текст')
  await waitFor(() => expect(app.sends).toHaveLength(1))
  await act(async () => {
    app.sends[0]!.resolve(new Response('error', { status: 503 }))
  })
  await screen.findByText('Ошибка отправки')
  expect(screen.getByText('Не потерять текст')).toBeInTheDocument()
  expect(app.sends).toHaveLength(1)
})

it('Enter sends once, Shift+Enter adds a line and IME composition does not submit', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  const input = screen.getByLabelText('Сообщение')
  await app.user.type(input, 'Line 1{Shift>}{Enter}{/Shift}Line 2')
  expect(input).toHaveValue('Line 1\nLine 2')
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(app.sends).toHaveLength(0)
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(app.sends).toHaveLength(1))
  expect(app.sends[0]?.body.message).toBe('Line 1\nLine 2')
  await act(async () => {
    app.sends[0]!.resolve(json({ idMessage: 'one' }))
  })
})

it('rejects whitespace and oversize texts locally', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  const input = screen.getByLabelText('Сообщение')
  fireEvent.change(input, { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByRole('alert')).toHaveTextContent('4096')
  fireEvent.change(input, { target: { value: 'x'.repeat(4097) } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(app.sends).toHaveLength(0)
})

it('supports overlapping sends in different chats and binds responses to their original chats', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send('For A')
  await waitFor(() => expect(app.sends).toHaveLength(1))
  await app.add('+1 202 555 0123')
  app.send('For B')
  await waitFor(() => expect(app.sends).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: /Chat ID: a/ }))
  expect(screen.getByRole('button', { name: 'Отправка…' })).toBeDisabled()
  await act(async () => {
    app.sends[1]!.resolve(json({ idMessage: 'b-server' }))
    app.sends[0]!.resolve(json({ idMessage: 'a-server' }))
  })
  await screen.findByText('Отправлено')
  expect(app.messages('a')[0]).toMatchObject({
    text: 'For A',
    idMessage: 'a-server',
  })
  expect(app.messages('b')[0]).toMatchObject({
    text: 'For B',
    idMessage: 'b-server',
  })
  expect(screen.queryByText('For B')).not.toBeInTheDocument()
})

it('stops on corrupt payload without acknowledging it', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  await waitFor(() => expect(app.receives.length).toBe(1))
  await act(async () => {
    app.receives[0]!.resolve(
      json({ receiptId: 1, body: incoming('', 'broken') }),
    )
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Получение остановлено',
  )
  expect(app.deletions).toHaveLength(0)
})

it('shows missing-ID failure at chat level without changing an arbitrary message', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send()
  await waitFor(() => expect(app.sends).toHaveLength(1))
  await act(async () => {
    app.sends[0]!.resolve(json({ idMessage: 'server' }))
  })
  await screen.findByText('Отправлено')
  await app.notify(status('failed'))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'без идентификатора',
  )
  expect(app.messages()[0]?.status).toBe('sent')
})

it('aborts Receive and Send, clears session and ignores their late responses after reconnect', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send()
  await waitFor(() => expect(app.sends).toHaveLength(1))
  await waitFor(() => expect(app.receives.length).toBe(1))
  const oldReceive = app.receives[0]!
  const oldSession = app.sessionId()
  fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
  expect(oldReceive.signal?.aborted).toBe(true)
  expect(app.sends[0]?.signal?.aborted).toBe(true)
  await act(async () => {
    oldReceive.resolve(
      json({ receiptId: 1, body: incoming('late', 'Old session') }),
    )
    app.sends[0]!.resolve(json({ idMessage: 'old-server' }))
  })
  expect(
    app.queryClient.getQueriesData({ queryKey: queryKeys.session(oldSession) }),
  ).toHaveLength(0)
  await app.connect()
  await app.add()
  expect(
    within(screen.getByRole('log')).queryByText('Hello'),
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Old session')).not.toBeInTheDocument()
})

it('starts CheckAccount and Send offline and leaves no paused mutations after disconnect', async () => {
  const app = setup()
  await app.connect()
  onlineManager.setOnline(false)
  try {
    await app.add()
    app.send()
    await waitFor(() => expect(app.sends).toHaveLength(1))
    expect(
      app.queryClient
        .getMutationCache()
        .getAll()
        .some((mutation) => mutation.state.isPaused),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
    await waitFor(() =>
      expect(app.queryClient.getMutationCache().getAll()).toHaveLength(0),
    )
    const count = app.fetcher.mock.calls.length
    onlineManager.setOnline(true)
    await act(async () => {
      await Promise.resolve()
    })
    expect(app.fetcher.mock.calls.length).toBe(count)
  } finally {
    onlineManager.setOnline(true)
  }
})

it('keeps a rejected Send unknown when a late read arrives', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  app.send()
  await waitFor(() => expect(app.sends).toHaveLength(1))
  await act(async () => {
    app.sends[0]!.reject(new Error('lost response'))
  })
  await screen.findByText('Результат отправки не подтверждён')
  await app.notify(status('read', 'server'))
  expect(app.messages()[0]?.status).toBe('unknown')
  expect(app.sends).toHaveLength(1)
})

it('blocks sending for poison receipt and resumes after explicitly skipping that receipt', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  await waitFor(() => expect(app.receives.length).toBe(1))
  await act(async () => {
    app.receives
      .shift()!
      .resolve(json({ receiptId: 77, body: incoming('', 'broken') }))
  })
  await screen.findByRole('alert')
  fireEvent.change(screen.getByLabelText('Сообщение'), {
    target: { value: 'Hello' },
  })
  expect(
    screen.getByRole('button', { name: 'Приём остановлен' }),
  ).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Пропустить это уведомление с потерей его данных',
    }),
  )
  await waitFor(() => expect(app.deletions).toEqual([77]))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled(),
  )
  await app.notify(incoming('valid', 'После восстановления'))
  expect(await screen.findByText('После восстановления')).toBeInTheDocument()
})

it('reconnect waits for the old abort-ignoring Receive before opening a new one', async () => {
  const app = setup()
  await app.connect()
  await app.add()
  await waitFor(() => expect(app.receives).toHaveLength(1))
  const old = app.receives[0]!
  fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
  await app.connect()
  await app.add()
  expect(app.receives).toHaveLength(1)
  await act(async () => {
    old.resolve(json({ receiptId: 22, body: incoming('late', 'Old') }))
  })
  await waitFor(() => expect(app.receives).toHaveLength(2))
  expect(app.deletions).toHaveLength(0)
  expect(screen.queryByText('Old')).not.toBeInTheDocument()
})

it('settles an offline CheckAccount on disconnect before its transport returns', async () => {
  const app = setup()
  await app.connect()
  const original = app.fetcher.getMockImplementation()!
  app.fetcher.mockImplementation((input, init) =>
    getRequestUrl(input).includes('/checkAccount/')
      ? new Promise<Response>(() => {})
      : original(input, init),
  )
  onlineManager.setOnline(false)
  try {
    fireEvent.change(screen.getByLabelText('Номер телефона с кодом страны'), {
      target: { value: '+79991234567' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }))
    await waitFor(() =>
      expect(
        app.queryClient
          .getMutationCache()
          .getAll()
          .some((mutation) => mutation.state.status === 'pending'),
      ).toBe(true),
    )
    expect(
      app.queryClient
        .getMutationCache()
        .getAll()
        .some((mutation) => mutation.state.isPaused),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
    await waitFor(() =>
      expect(app.queryClient.getMutationCache().getAll()).toHaveLength(0),
    )
  } finally {
    onlineManager.setOnline(true)
  }
})

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : input.toString()
}

function getRequestBody(init?: RequestInit): string {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected a JSON string request body')
  }

  return init.body
}
