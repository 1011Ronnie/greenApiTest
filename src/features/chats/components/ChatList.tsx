import type { Chat } from '../model'

interface ChatListProps {
  chats: readonly Chat[]
  selectedChatId?: string
  onSelectChat: (chatId: string) => void
}

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
}: ChatListProps) {
  return (
    <>
      <h2>Чаты этой сессии</h2>
      {chats.length === 0 ? (
        <p>Добавьте собеседника по номеру телефона.</p>
      ) : (
        <ul className="chat-list">
          {chats.map((chat) => (
            <li key={chat.chatId}>
              <button
                className="chat-button"
                type="button"
                aria-pressed={selectedChatId === chat.chatId}
                onClick={() => onSelectChat(chat.chatId)}
              >
                +{chat.phoneNumber}
                <span>Chat ID: {chat.chatId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
