import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'

import { GreenApiError } from '../../api/errors'
import { queryKeys } from '../../app/queryKeys'

import { createSessionRuntime } from '../../features/messages/sessionRuntime'

import type { Message } from '../../features/messages/model'

function setup() {
  const cache = new QueryClient()
  const controller = new AbortController()
  const runtime = createSessionRuntime(
    {
      apiUrl: 'https://example.com',
      idInstance: '1',
      apiTokenInstance: 'secret',
    },
    'session',
    controller.signal,
    cache,
  )
  runtime.registerChat('chat')
  const messages = () =>
    cache.getQueryData<readonly Message[]>(
      queryKeys.messages('session', 'chat'),
    ) ?? []
  const text = (
    idMessage = 'incoming',
    chatId = 'chat',
    timestamp = Math.floor(Date.now() / 1000),
  ) => ({
    typeWebhook: 'incomingMessageReceived',
    chatId,
    idMessage,
    timestamp,
    senderData: { chatId },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'Hello' },
    },
  })
  const status = (value: string, idMessage?: string) => ({
    typeWebhook: 'outgoingMessageStatus',
    chatId: 'chat',
    timestamp: Math.floor(Date.now() / 1000),
    status: value,
    ...(idMessage ? { idMessage } : {}),
  })
  return { cache, controller, runtime, messages, text, status }
}

it('deduplicates incoming messages and ignores backlog, unknown chats and unsupported types', () => {
  const { runtime, messages, text } = setup()
  runtime.process(text())
  runtime.process(text())
  runtime.process(text('old', 'chat', 1))
  runtime.process(text('unknown', 'other'))
  runtime.process({ typeWebhook: 'stateInstanceChanged' })
  expect(messages()).toHaveLength(1)
  expect(messages()[0]?.direction).toBe('incoming')
})

it('buffers early statuses and preserves read on later delivery and send response', () => {
  const { runtime, messages, status } = setup()
  runtime.optimistic('chat', 'temp', 'Hello')
  runtime.process(status('read', 'server'))
  for (let i = 0; i < 10; i++) runtime.process(status('delivered', 'server'))
  runtime.confirm('chat', 'temp', 'server')
  expect(messages()[0]).toMatchObject({
    idMessage: 'server',
    localId: 'temp',
    status: 'read',
  })
  runtime.process(status('delivered', 'server'))
  expect(messages()[0]?.status).toBe('read')
})

it('reports missing-ID failures at chat level and targets identified failures', () => {
  const { runtime, messages, status, cache } = setup()
  runtime.optimistic('chat', 'temp', 'Hello')
  runtime.confirm('chat', 'temp', 'server')
  runtime.process(status('failed'))
  expect(messages()[0]?.status).toBe('sent')
  expect(cache.getQueryData(queryKeys.chatError('session', 'chat'))).toContain(
    'без идентификатора',
  )
  runtime.process(status('noAccount', 'server'))
  expect(messages()[0]?.status).toBe('error')
})

it('keeps failed optimistic bubble, sanitizes unknown errors and resolves delivery', () => {
  const { runtime, messages, status } = setup()
  runtime.optimistic('chat', 'temp', 'Hello')
  runtime.fail('chat', 'temp', new Error('secret'))
  expect(messages()[0]).toMatchObject({ status: 'error', text: 'Hello' })
  expect(messages()[0]?.error).not.toContain('secret')
  runtime.confirm('chat', 'temp', 'server')
  runtime.process(status('delivered', 'server'))
  expect(messages()[0]?.status).toBe('delivered')
  expect(messages()[0]?.error).toBeUndefined()
})

it('locks per chat independently and never resurrects cache after disconnect', () => {
  const { runtime, messages, controller, cache, text } = setup()
  expect(runtime.lock('chat')).toBe(true)
  expect(runtime.lock('chat')).toBe(false)
  expect(runtime.lock('other')).toBe(true)
  runtime.unlock('chat')
  expect(runtime.lock('chat')).toBe(true)
  runtime.optimistic('chat', 'temp', 'Hello')
  controller.abort()
  cache.clear()
  runtime.process(text())
  runtime.confirm('chat', 'temp', 'server')
  runtime.fail('chat', 'temp', new Error())
  expect(messages()).toEqual([])
  expect(runtime.lock('chat')).toBe(false)
})

it('preserves statuses for active sends beyond TTL and refuses overflow without silent eviction', () => {
  const { runtime, messages, status } = setup()
  runtime.lock('chat')
  runtime.optimistic('chat', 'temp', 'Hello')
  runtime.process(status('read', 'server'))
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000)
  try {
    for (let i = 0; i < 199; i++)
      runtime.process(status('delivered', `other-${i}`))
    expect(() => runtime.process(status('delivered', 'overflow'))).toThrow(
      'Буфер',
    )
    runtime.confirm('chat', 'temp', 'server')
    expect(messages()[0]?.status).toBe('read')
  } finally {
    clock.mockRestore()
  }
})

it('reports unassociated failed/noAccount at session level for alternate recipient formats', () => {
  const { runtime, cache, status } = setup()
  for (const value of ['failed', 'noAccount']) {
    runtime.process({ ...status(value), chatId: '79991234567@c.us' })
    expect(
      cache.getQueryData(queryKeys.chatError('session', '__session__')),
    ).toContain('неизвестного адресата')
  }
})

it('keeps ambiguous Send unknown after a late read with an unrelated server ID', () => {
  const { runtime, messages, status } = setup()
  runtime.optimistic('chat', 'temp', 'Hello')
  runtime.fail('chat', 'temp', new GreenApiError('network', 'lost'))
  runtime.process(status('read', 'server'))
  expect(messages()[0]).toMatchObject({ idMessage: 'temp', status: 'unknown' })
})

it('factory is pure and committed subscription is removable', () => {
  const signal = new AbortController().signal
  const add = vi.spyOn(signal, 'addEventListener')
  const remove = vi.spyOn(signal, 'removeEventListener')
  const runtime = createSessionRuntime(
    {
      apiUrl: 'https://example.com',
      idInstance: '1',
      apiTokenInstance: 'fake',
    },
    's',
    signal,
    new QueryClient(),
  )
  expect(add).not.toHaveBeenCalled()
  const dispose = runtime.subscribe()
  expect(add).toHaveBeenCalledTimes(1)
  dispose()
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1])
})
