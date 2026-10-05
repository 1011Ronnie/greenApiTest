import { StrictMode } from 'react'

import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { App } from '../../App'
import { renderWithProviders } from '../support/renderWithProviders'

const fetcher = vi.fn<typeof fetch>()
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

function setup(strict = false) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url.includes('/receiveNotification/'))
      return new Promise<Response>((_, reject) => {
        if (init?.signal?.aborted)
          reject(new DOMException('Aborted', 'AbortError'))
        else
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
      })
    return fetcher(url, init)
  })
  return {
    user: userEvent.setup(),
    ...renderWithProviders(
      strict ? (
        <StrictMode>
          <App />
        </StrictMode>
      ) : (
        <App />
      ),
    ),
  }
}
function fillCredentials(token = 'test-secret') {
  fireEvent.change(screen.getByLabelText('Адрес API (HTTPS)'), {
    target: { value: 'https://example.com' },
  })
  fireEvent.change(screen.getByLabelText('idInstance'), {
    target: { value: '4100000000' },
  })
  fireEvent.change(screen.getByLabelText('Токен API'), {
    target: { value: token },
  })
}
function respond(data: unknown, status = 200) {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }))
}
async function connect() {
  fillCredentials()
  respond({ stateInstance: 'authorized' })
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await screen.findByRole('button', { name: 'Отключиться' })
}
function addChat(phone = '+7 (999) 123-45-67') {
  fireEvent.change(screen.getByLabelText('Номер телефона с кодом страны'), {
    target: { value: phone },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Создать чат' }))
}
function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  fetcher.mockReturnValueOnce(promise)
  return (data: unknown) => resolve(new Response(JSON.stringify(data)))
}

test('shows required connection fields and toggles token visibility', async () => {
  const { user } = setup()
  expect(screen.getByRole('heading', { name: 'Веб-чат' })).toBeInTheDocument()
  expect(screen.getByLabelText('idInstance')).toBeRequired()
  expect(screen.getByLabelText('Токен API')).toHaveAttribute('type', 'password')
  await user.click(screen.getByRole('button', { name: 'Показать токен' }))
  expect(screen.getByLabelText('Токен API')).toHaveAttribute('type', 'text')
  await user.click(screen.getByRole('button', { name: 'Скрыть токен' }))
  expect(screen.getByLabelText('Токен API')).toHaveAttribute('type', 'password')
  expect(fetcher).not.toHaveBeenCalled()
})

test('rejects invalid credentials before requesting API', async () => {
  setup()
  fillCredentials()
  fireEvent.change(screen.getByLabelText('Адрес API (HTTPS)'), {
    target: { value: 'http://example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS')
  expect(fetcher).not.toHaveBeenCalled()
})

test.each([
  'notAuthorized',
  'starting',
  'pendingPassword',
  'blocked',
  'suspended',
])('keeps form for instance state %s', async (stateInstance) => {
  setup()
  fillCredentials()
  respond({ stateInstance })
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('button', { name: 'Отключиться' }),
  ).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

test('allows retry after HTTP failure and never places token in query keys/data', async () => {
  const { queryClient } = setup()
  fillCredentials()
  respond({}, 401)
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401')
  respond({ stateInstance: 'authorized' })
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await screen.findByRole('button', { name: 'Отключиться' })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => ({ key: query.queryKey, data: query.state.data })),
    ),
  ).not.toContain('test-secret')
})

test('editing credentials aborts old request and ignores late authorization', async () => {
  setup()
  fillCredentials()
  const finish = deferredResponse()
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  const signal = fetcher.mock.calls[0]?.[1]?.signal
  fireEvent.change(screen.getByLabelText('Токен API'), {
    target: { value: 'new-secret' },
  })
  expect(signal?.aborted).toBe(true)
  await act(async () => {
    finish({ stateInstance: 'authorized' })
  })
  expect(
    screen.queryByRole('button', { name: 'Отключиться' }),
  ).not.toBeInTheDocument()
  respond({ stateInstance: 'authorized' })
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await screen.findByRole('button', { name: 'Отключиться' })
  expect(fetcher.mock.calls[1]?.[0]).toContain('/new-secret')
})

test('creates chat from returned chatId, normalizes phone and selects duplicate', async () => {
  setup(true)
  await connect()
  respond({ exist: true, chatId: 'api-chat' })
  addChat()
  const chat = await screen.findByRole('button', { name: /Chat ID: api-chat/ })
  expect(chat).toHaveAttribute('aria-pressed', 'true')
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe('{"phoneNumber":79991234567}')
  respond({ exist: true, chatId: 'second-chat' })
  addChat('+1 202 555 0123')
  await screen.findByRole('button', { name: /Chat ID: second-chat/ })
  respond({ exist: true, chatId: 'api-chat' })
  addChat()
  await waitFor(() => expect(chat).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.getAllByRole('button', { name: /Chat ID:/ })).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: /Chat ID: second-chat/ }))
  expect(
    screen.getByRole('heading', { name: '+12025550123' }),
  ).toBeInTheDocument()
})

test('rejects invalid phone locally and handles absence and API refusal without retries', async () => {
  setup()
  await connect()
  addChat('bad-phone')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'международном формате',
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
  respond({ exist: false })
  addChat()
  expect(await screen.findByRole('alert')).toHaveTextContent('номер скрыт')
  respond({ status: false })
  addChat()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'не выполнил операцию',
  )
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect(
    screen.queryByRole('button', { name: /Chat ID:/ }),
  ).not.toBeInTheDocument()
})

test('blocks double submit, aborts pending chat check, clears cache and forgets credentials on disconnect', async () => {
  const { queryClient } = setup()
  await connect()
  const finish = deferredResponse()
  addChat()
  fireEvent.submit(
    screen.getByLabelText('Номер телефона с кодом страны').closest('form')!,
  )
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const key = queryClient
    .getQueryCache()
    .getAll()
    .find((query) => query.state.data === 'authorized')!.queryKey
  queryClient.setQueryData(
    ['session', key[1], 'messages', 'old-chat'],
    [{ text: 'old' }],
  )
  fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
  expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true)
  expect(screen.getByLabelText('Токен API')).toHaveValue('')
  expect(
    queryClient.getQueriesData({ queryKey: ['session', key[1]] }),
  ).toHaveLength(0)
  await act(async () => {
    finish({ exist: true, chatId: 'late-chat' })
  })
  await connect()
  expect(
    screen.queryByRole('button', { name: /Chat ID:/ }),
  ).not.toBeInTheDocument()
})

test('unmount aborts pending connection and removes its cache', async () => {
  const { queryClient, unmount } = setup()
  fillCredentials()
  const finish = deferredResponse()
  fireEvent.click(screen.getByRole('button', { name: 'Подключиться' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  const signal = fetcher.mock.calls[0]?.[1]?.signal
  unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => {
    finish({ stateInstance: 'authorized' })
  })
  expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
})

test('moves focus to new-chat input on connect and restores connection input on disconnect', async () => {
  setup()
  expect(screen.getByLabelText('Адрес API (HTTPS)')).toHaveFocus()
  await connect()
  expect(screen.getByLabelText('Номер телефона с кодом страны')).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Отключиться' }))
  expect(screen.getByLabelText('Адрес API (HTTPS)')).toHaveFocus()
})
