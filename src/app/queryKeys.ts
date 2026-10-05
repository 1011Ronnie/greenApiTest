export const queryKeys = {
  session: (sessionId: string) => ['session', sessionId] as const,
  connection: (sessionId: string) =>
    ['session', sessionId, 'connection'] as const,
  chatError: (sessionId: string, chatId: string) =>
    ['session', sessionId, 'chatError', chatId] as const,
  messages: (sessionId: string, chatId: string) =>
    ['session', sessionId, 'messages', chatId] as const,
}
