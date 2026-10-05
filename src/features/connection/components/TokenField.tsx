interface TokenFieldProps {
  value: string
  isTokenVisible: boolean
  hasError: boolean
  onChange: (value: string) => void
  onToggleVisibility: () => void
}

export function TokenField({
  value,
  isTokenVisible,
  hasError,
  onChange,
  onToggleVisibility,
}: TokenFieldProps) {
  return (
    <>
      <label htmlFor="api-token">Токен API</label>
      <div className="token-field">
        <input
          id="api-token"
          aria-invalid={hasError}
          required
          type={isTokenVisible ? 'text' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby="token-hint connection-error"
        />
        <button
          type="button"
          className="secondary"
          aria-pressed={isTokenVisible}
          onClick={onToggleVisibility}
        >
          {isTokenVisible ? 'Скрыть токен' : 'Показать токен'}
        </button>
      </div>
      <p id="token-hint" className="hint">
        Токен хранится только в памяти текущей вкладки.
      </p>
    </>
  )
}
