import { MAX_TEXT_MESSAGE_LENGTH } from '../../../shared/messageLimits'

import type { FormEventHandler, KeyboardEventHandler, Ref } from 'react'

interface MessageComposerProps {
  draft: string
  validationError?: string
  composerRef: Ref<HTMLTextAreaElement>
  isSending: boolean
  isBlocked: boolean
  onDraftChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>
}

export function MessageComposer({
  draft,
  validationError,
  composerRef,
  isSending,
  isBlocked,
  onDraftChange,
  onSubmit,
  onKeyDown,
}: MessageComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit} aria-busy={isSending}>
      <label htmlFor="message-text">Сообщение</label>
      <textarea
        id="message-text"
        ref={composerRef}
        aria-invalid={!!validationError}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby="message-hint message-error"
        rows={3}
      />
      <div className="composer-actions">
        <p id="message-hint" className="hint">
          Enter — отправить · Shift+Enter — новая строка · {draft.length}/
          {MAX_TEXT_MESSAGE_LENGTH}
        </p>
        <button
          type="submit"
          disabled={isBlocked || isSending || !draft.trim()}
        >
          {isBlocked
            ? 'Приём остановлен'
            : isSending
              ? 'Отправка…'
              : 'Отправить'}
        </button>
      </div>
      <div id="message-error">
        {validationError && (
          <p role="alert" className="error">
            {validationError}
          </p>
        )}
      </div>
    </form>
  )
}
