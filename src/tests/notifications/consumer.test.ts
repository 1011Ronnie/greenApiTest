import { afterEach, expect, it, vi } from 'vitest'

import { GreenApiError } from '../../api/errors'

import {
  abortableDelay,
  createQueueConsumer,
} from '../../features/notifications/consumer'

import type { NotificationReceipt } from '../../api/types'
import type {
  ConsumerState,
  QueueClient,
} from '../../features/notifications/consumer'

const receipt: NotificationReceipt = {
  receiptId: 1,
  body: { typeWebhook: 'example' },
}
afterEach(() => vi.useRealTimers())
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

it('processes before Delete and waits for acknowledgement before another Receive', async () => {
  const controller = new AbortController()
  const events: string[] = []
  const deletion = deferred<void>()
  const receive = vi.fn(async () => {
    events.push('receive')
    return receipt
  })
  const remove = vi.fn(() => {
    events.push('delete')
    return deletion.promise
  })
  const consumer = createQueueConsumer(
    { receiveNotification: receive, deleteNotification: remove },
    () => events.push('process'),
  )
  const work = consumer.run(controller.signal, () => {})
  await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
  expect(events).toEqual(['receive', 'process', 'delete'])
  expect(receive).toHaveBeenCalledTimes(1)
  controller.abort()
  deletion.resolve()
  await work
  expect(receive).toHaveBeenCalledTimes(1)
})

it('retries only Delete after false result and transient failure, without reprocessing', async () => {
  const controller = new AbortController()
  const receive = vi.fn(async () => receipt)
  const process = vi.fn()
  const remove = vi
    .fn<QueueClient['deleteNotification']>()
    .mockRejectedValueOnce(new GreenApiError('acknowledgement', 'not deleted'))
    .mockRejectedValueOnce(new GreenApiError('http', 'unavailable', 503))
    .mockImplementationOnce(async () => {
      controller.abort()
    })
  const delay = vi.fn<typeof abortableDelay>(async () => {})
  await createQueueConsumer(
    { receiveNotification: receive, deleteNotification: remove },
    process,
    delay,
  ).run(controller.signal, () => {})
  expect(receive).toHaveBeenCalledTimes(1)
  expect(process).toHaveBeenCalledTimes(1)
  expect(remove.mock.calls.map((call) => call[0])).toEqual([1, 1, 1])
  expect(delay.mock.calls.map((call) => call[0])).toEqual([1000, 2000])
})

it('backs off on network/429/5xx and recovers, with capped delays', async () => {
  const controller = new AbortController()
  let attempts = 0
  const states: ConsumerState[] = []
  const delay = vi.fn<typeof abortableDelay>(async () => {})
  const receive = vi.fn(async () => {
    if (++attempts <= 8)
      throw new GreenApiError(
        attempts === 1 ? 'network' : 'http',
        'temporary',
        attempts === 2 ? 429 : 503,
      )
    return receipt
  })
  await createQueueConsumer(
    {
      receiveNotification: receive,
      deleteNotification: async () => {
        controller.abort()
      },
    },
    () => {},
    delay,
  ).run(controller.signal, (state) => states.push(state))
  expect(delay.mock.calls.map((call) => call[0])).toEqual([
    1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
  ])
  expect(states.at(-1)?.phase).toBe('receiving')
})

it.each([400, 401, 403])(
  'stops on permanent HTTP %s errors',
  async (status) => {
    const state = vi.fn<(state: ConsumerState) => void>()
    const remove = vi.fn()
    const receive = vi.fn(async () => {
      throw new GreenApiError('http', 'bad request', status)
    })
    await createQueueConsumer(
      { receiveNotification: receive, deleteNotification: remove },
      () => {},
    ).run(new AbortController().signal, state)
    expect(state).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'stopped' }),
    )
    expect(receive).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    if (status === 400)
      expect(state.mock.lastCall?.[0]?.message).toContain('webhookUrl')
  },
)

it('does not acknowledge a failed processor or malformed payload', async () => {
  const remove = vi.fn()
  const state = vi.fn()
  await createQueueConsumer(
    { receiveNotification: async () => receipt, deleteNotification: remove },
    () => {
      throw new Error('bad body')
    },
  ).run(new AbortController().signal, state)
  expect(remove).not.toHaveBeenCalled()
  expect(state).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'stopped' }),
  )
})

it('serializes cleanup/restart even when old Receive ignores abort', async () => {
  const first = new AbortController()
  const second = new AbortController()
  const waiting = deferred<NotificationReceipt | null>()
  const receive = vi
    .fn()
    .mockReturnValueOnce(waiting.promise)
    .mockImplementationOnce(async () => {
      second.abort()
      return null
    })
  const process = vi.fn()
  const remove = vi.fn()
  const consumer = createQueueConsumer(
    { receiveNotification: receive, deleteNotification: remove },
    process,
  )
  const old = consumer.run(first.signal, () => {})
  await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1))
  first.abort()
  const next = consumer.run(second.signal, () => {})
  await Promise.resolve()
  expect(receive).toHaveBeenCalledTimes(1)
  waiting.resolve(receipt)
  await Promise.all([old, next])
  expect(receive).toHaveBeenCalledTimes(2)
  expect(process).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})

it('cancels backoff timers immediately', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const wait = abortableDelay(30000, controller.signal)
  const assertion = expect(wait).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

it('paces an empty queue and exits on cancellation', async () => {
  const controller = new AbortController()
  const remove = vi.fn()
  const delay = vi.fn<typeof abortableDelay>(async () => {
    controller.abort()
  })
  await createQueueConsumer(
    { receiveNotification: async () => null, deleteNotification: remove },
    () => {},
    delay,
  ).run(controller.signal, () => {})
  expect(delay).toHaveBeenCalledWith(250, controller.signal)
  expect(remove).not.toHaveBeenCalled()
})

it('reconciles lost successful Delete response and processes the new head once', async () => {
  const controller = new AbortController()
  const next = { receiptId: 2, body: { typeWebhook: 'next' } }
  const receive = vi
    .fn()
    .mockResolvedValueOnce(receipt)
    .mockResolvedValueOnce(next)
  const remove = vi
    .fn<QueueClient['deleteNotification']>()
    .mockRejectedValueOnce(new GreenApiError('network', 'lost response'))
    .mockRejectedValueOnce(
      new GreenApiError('acknowledgement', 'already removed'),
    )
    .mockRejectedValueOnce(
      new GreenApiError('acknowledgement', 'already removed'),
    )
    .mockImplementationOnce(async () => {
      controller.abort()
    })
  const process = vi.fn()
  await createQueueConsumer(
    { receiveNotification: receive, deleteNotification: remove },
    process,
    async () => {},
  ).run(controller.signal, () => {})
  expect(process.mock.calls).toEqual([[receipt.body], [next.body]])
  expect(remove.mock.calls.map((call) => call[0])).toEqual([1, 1, 1, 2])
})

it('stops bounded acknowledgement retries when reconciliation returns the same receipt', async () => {
  const remove = vi.fn(async () => {
    throw new GreenApiError('acknowledgement', 'no')
  })
  const process = vi.fn()
  const state = vi.fn()
  await createQueueConsumer(
    { receiveNotification: async () => receipt, deleteNotification: remove },
    process,
    async () => {},
  ).run(new AbortController().signal, state)
  expect(remove).toHaveBeenCalledTimes(3)
  expect(process).toHaveBeenCalledTimes(1)
  expect(state).toHaveBeenLastCalledWith(
    expect.objectContaining({
      phase: 'stopped',
      receiptId: 1,
      stage: 'delete',
    }),
  )
})

it('retries poison receipt without deleting it, then skips only the explicit receipt', async () => {
  const controller = new AbortController()
  const remove = vi.fn(async () => {
    controller.abort()
  })
  const process = vi.fn(() => {
    throw new Error('broken')
  })
  const consumer = createQueueConsumer(
    { receiveNotification: async () => receipt, deleteNotification: remove },
    process,
  )
  await consumer.run(controller.signal, () => {})
  await consumer.run(controller.signal, () => {})
  expect(process).toHaveBeenCalledTimes(2)
  expect(remove).not.toHaveBeenCalled()
  consumer.skipReceipt(999)
  consumer.skipReceipt(1)
  await consumer.run(controller.signal, () => {})
  expect(remove).toHaveBeenCalledWith(1, controller.signal)
  expect(process).toHaveBeenCalledTimes(2)
})

it('serializes distinct runtimes for the same instance until old Receive settles', async () => {
  const first = new AbortController()
  const second = new AbortController()
  const waiting = deferred<NotificationReceipt | null>()
  const oldReceive = vi.fn(() => waiting.promise)
  const newReceive = vi.fn(async () => {
    second.abort()
    return null
  })
  const process = vi.fn()
  const remove = vi.fn()
  const old = createQueueConsumer(
    { receiveNotification: oldReceive, deleteNotification: remove },
    process,
    undefined,
    'instance',
  ).run(first.signal, () => {})
  await vi.waitFor(() => expect(oldReceive).toHaveBeenCalledTimes(1))
  first.abort()
  const next = createQueueConsumer(
    { receiveNotification: newReceive, deleteNotification: remove },
    process,
    undefined,
    'instance',
  ).run(second.signal, () => {})
  await Promise.resolve()
  expect(newReceive).not.toHaveBeenCalled()
  waiting.resolve(receipt)
  await Promise.all([old, next])
  expect(newReceive).toHaveBeenCalledTimes(1)
  expect(process).not.toHaveBeenCalled()
  expect(remove).not.toHaveBeenCalled()
})
