import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGreenApiClient, normalizeCredentials } from '../../api/greenApi'

const credentials = {
  apiUrl: 'https://example.com/',
  idInstance: '4100000000',
  apiTokenInstance: 'test-secret',
}
const fetcher = vi.fn<typeof fetch>()
const client = createGreenApiClient(credentials, fetcher)
const respond = (data: unknown, status = 200) =>
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }))
afterEach(() => vi.resetAllMocks())

describe('GREEN-API client', () => {
  it('normalizes credentials and rejects unsafe base URLs', () => {
    expect(normalizeCredentials(credentials).apiUrl).toBe('https://example.com')
    for (const apiUrl of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/path',
      'https://example.com?token=x',
      'invalid',
    ]) {
      expect(() => normalizeCredentials({ ...credentials, apiUrl })).toThrow()
    }
    expect(() =>
      normalizeCredentials({ ...credentials, idInstance: 'abc' }),
    ).toThrow()
    expect(() =>
      normalizeCredentials({ ...credentials, apiTokenInstance: ' ' }),
    ).toThrow()
  })

  it('builds all five requests with correct methods, bodies, signal and path', async () => {
    const signal = new AbortController().signal
    respond({ stateInstance: 'authorized' })
    expect(await client.getStateInstance(signal)).toBe('authorized')
    respond({ exist: true, chatId: '123' })
    expect(await client.checkAccount('+7 (999) 123-45-67', signal)).toEqual({
      exist: true,
      chatId: '123',
    })
    respond({ idMessage: 'message-1' })
    expect(await client.sendMessage('123', 'hello', signal)).toEqual({
      idMessage: 'message-1',
    })
    respond({ receiptId: 17, body: { typeWebhook: 'other' } })
    expect(await client.receiveNotification(signal, 60)).toEqual({
      receiptId: 17,
      body: { typeWebhook: 'other' },
    })
    respond({ result: true })
    await client.deleteNotification(17, signal)
    const prefix = 'https://example.com/waInstance4100000000/'
    expect(
      fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body]),
    ).toEqual([
      [prefix + 'getStateInstance/test-secret', 'GET', undefined],
      [
        prefix + 'checkAccount/test-secret',
        'POST',
        '{"phoneNumber":79991234567}',
      ],
      [
        prefix + 'sendMessage/test-secret',
        'POST',
        '{"chatId":"123","message":"hello"}',
      ],
      [
        prefix + 'receiveNotification/test-secret?receiveTimeout=60',
        'GET',
        undefined,
      ],
      [prefix + 'deleteNotification/test-secret/17', 'DELETE', undefined],
    ])
    expect(
      fetcher.mock.calls.every(
        ([, init]) => init?.signal instanceof AbortSignal,
      ),
    ).toBe(true)
  })

  it('distinguishes absent account and non-authorized instance from transport errors', async () => {
    respond({ exist: false, chatId: '' })
    expect(await client.checkAccount('79991234567')).toEqual({ exist: false })
    respond({ stateInstance: 'notAuthorized' })
    expect(await client.getStateInstance()).toBe('notAuthorized')
    respond({ status: false, reason: credentials.apiTokenInstance })
    await expect(client.checkAccount('79991234567')).rejects.toMatchObject({
      kind: 'api',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('handles null and empty queue responses', async () => {
    respond(null)
    expect(await client.receiveNotification()).toBeNull()
    fetcher.mockResolvedValueOnce(new Response('  '))
    expect(await client.receiveNotification()).toBeNull()
  })

  it.each([0, -1, 1.5, '17', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid received receiptId %s',
    async (receiptId) => {
      respond({ receiptId, body: {} })
      await expect(client.receiveNotification()).rejects.toMatchObject({
        kind: 'payload',
      })
    },
  )

  it('rejects malformed critical response fields and unconfirmed deletion', async () => {
    respond({ exist: true })
    await expect(client.checkAccount('79991234567')).rejects.toMatchObject({
      kind: 'payload',
    })
    respond({ idMessage: '' })
    await expect(client.sendMessage('123', 'hello')).rejects.toMatchObject({
      kind: 'payload',
    })
    respond({ stateInstance: 'unknown' })
    await expect(client.getStateInstance()).rejects.toMatchObject({
      kind: 'payload',
    })
    respond({ receiptId: 17, body: null })
    await expect(client.receiveNotification()).rejects.toMatchObject({
      kind: 'payload',
    })
    respond({ result: false, reason: 'test-secret' })
    await expect(client.deleteNotification(17)).rejects.toMatchObject({
      kind: 'acknowledgement',
    })
  })

  it('validates arguments before issuing any request', async () => {
    await expect(client.deleteNotification(-1)).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(
      client.receiveNotification(undefined, 61),
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(client.checkAccount('wrong')).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(client.sendMessage('123', ' ')).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(
      client.sendMessage('123', 'a'.repeat(4097)),
    ).rejects.toMatchObject({ kind: 'validation' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sanitizes network, HTTP and malformed JSON errors without retrying', async () => {
    fetcher.mockRejectedValueOnce(new Error('https://example.com/test-secret'))
    const networkError: unknown = await client
      .getStateInstance()
      .catch((error: unknown) => error)
    expect(networkError).toMatchObject({
      kind: 'network',
      message: 'Не удалось связаться с GREEN-API',
    })
    expect(networkError).not.toHaveProperty('cause')
    expect(String(networkError)).not.toContain(credentials.apiTokenInstance)
    fetcher.mockResolvedValueOnce(new Response('test-secret', { status: 429 }))
    await expect(client.getStateInstance()).rejects.toMatchObject({
      kind: 'http',
      status: 429,
      message: 'Ошибка GREEN-API (HTTP 429)',
    })
    fetcher.mockResolvedValueOnce(new Response('test-secret'))
    await expect(client.getStateInstance()).rejects.toMatchObject({
      kind: 'payload',
      message: 'GREEN-API вернул некорректный ответ',
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('preserves cancellation without exposing signal reasons', async () => {
    const controller = new AbortController()
    controller.abort('test-secret')
    fetcher.mockRejectedValueOnce('test-secret')
    await expect(
      client.getStateInstance(controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError', message: 'Запрос отменён' })
  })
})

it.each(['fetch', 'body'])(
  'bounds hung %s with a deadline and does not retry Send',
  async (stage) => {
    vi.useFakeTimers()
    let settle!: (value: Response) => void
    let finishBody!: (value: string) => void
    const response = new Response('')
    if (stage === 'body')
      vi.spyOn(response, 'text').mockImplementation(
        () =>
          new Promise((resolve) => {
            finishBody = resolve
          }),
      )
    const transport = vi.fn<typeof fetch>(() =>
      stage === 'fetch'
        ? new Promise((resolve) => {
            settle = resolve
          })
        : Promise.resolve(response),
    )
    const request = createGreenApiClient(credentials, transport).sendMessage(
      'a',
      'Hello',
    )
    const assertion = expect(request).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    if (stage === 'fetch') settle(new Response('{}'))
    else finishBody('{}')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  },
)

it('does not start a new queue transport while aborted old transport ignores its signal', async () => {
  let settle!: (value: Response) => void
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    .mockResolvedValueOnce(new Response('null'))
  const first = new AbortController()
  const oldClient = createGreenApiClient(
    { ...credentials, idInstance: '55' },
    transport,
  )
  const newClient = createGreenApiClient(
    { ...credentials, idInstance: '55' },
    transport,
  )
  const old = oldClient.receiveNotification(first.signal)
  const assertion = expect(old).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1))
  first.abort()
  await assertion
  const next = newClient.receiveNotification()
  await Promise.resolve()
  expect(transport).toHaveBeenCalledTimes(1)
  settle(new Response('null'))
  expect(await next).toBeNull()
  expect(transport).toHaveBeenCalledTimes(2)
})

it('does not call fetch for an already aborted request', async () => {
  const controller = new AbortController()
  controller.abort()
  const transport = vi.fn<typeof fetch>()
  await expect(
    createGreenApiClient(credentials, transport).checkAccount(
      '79991234567',
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(transport).not.toHaveBeenCalled()
})

it('keeps a queue lease after deadline and reports blocked transport instead of overlapping Receive', async () => {
  vi.useFakeTimers()
  let settle!: (value: Response) => void
  const transport = vi.fn<typeof fetch>(
    () =>
      new Promise((resolve) => {
        settle = resolve
      }),
  )
  const api = createGreenApiClient(
    { ...credentials, idInstance: '56' },
    transport,
  )
  const first = api.receiveNotification()
  const firstAssertion = expect(first).rejects.toMatchObject({
    kind: 'timeout',
  })
  await vi.advanceTimersByTimeAsync(15000)
  await firstAssertion
  const second = api.receiveNotification()
  const secondAssertion = expect(second).rejects.toMatchObject({
    kind: 'queueBlocked',
  })
  await vi.advanceTimersByTimeAsync(15000)
  await secondAssertion
  expect(transport).toHaveBeenCalledTimes(1)
  settle(new Response('null'))
  await Promise.resolve()
  vi.useRealTimers()
})
