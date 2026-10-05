interface ChatSessionHeaderProps {
  idInstance: string
  onDisconnect: () => void
}

export function ChatSessionHeader({
  idInstance,
  onDisconnect,
}: ChatSessionHeaderProps) {
  return (
    <header className="session-header">
      <div>
        <span className="welcome__eyebrow">GREEN-API · Telegram</span>
        <h1>Веб-чат</h1>
        <p>Instance {idInstance} подключён</p>
      </div>
      <button type="button" className="secondary" onClick={onDisconnect}>
        Отключиться
      </button>
    </header>
  )
}
