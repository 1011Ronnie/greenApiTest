import type { FormEventHandler, Ref } from 'react'

interface NewChatFormProps {
  phone: string
  formError?: string
  isPending: boolean
  phoneInputRef: Ref<HTMLInputElement>
  onPhoneChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}

export function NewChatForm({
  phone,
  formError,
  isPending,
  phoneInputRef,
  onPhoneChange,
  onSubmit,
}: NewChatFormProps) {
  return (
    <>
      <h2>Новый чат</h2>
      <form className="form" onSubmit={onSubmit} aria-busy={isPending}>
        <label htmlFor="phone">Номер телефона с кодом страны</label>
        <input
          id="phone"
          ref={phoneInputRef}
          type="tel"
          required
          placeholder="+7 999 123-45-67"
          value={phone}
          disabled={isPending}
          aria-invalid={!!formError}
          aria-describedby="phone-hint chat-error"
          onChange={(event) => onPhoneChange(event.target.value)}
        />
        <p id="phone-hint" className="hint">
          Международный формат. Код страны не подставляется автоматически.
        </p>
        <div id="chat-error">
          {formError && (
            <p role="alert" className="error">
              {formError}
            </p>
          )}
        </div>
        <button disabled={isPending} type="submit">
          {isPending ? 'Проверка номера…' : 'Создать чат'}
        </button>
      </form>
    </>
  )
}
