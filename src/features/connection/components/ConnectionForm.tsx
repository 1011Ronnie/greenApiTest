import { useEffect, useRef, useState } from 'react'

import { normalizeCredentials } from '../../../api/greenApi'
import { errorMessage } from '../../../shared/errorMessage'

import { TokenField } from './TokenField'

import type { Credentials } from '../../../api/types'
import type { FormEvent } from 'react'

interface ConnectionFormProps {
  isPending: boolean
  error?: string
  onSubmit: (credentials: Credentials) => void
  onEdit: () => void
}

export function ConnectionForm({
  isPending,
  error,
  onSubmit,
  onEdit,
}: ConnectionFormProps) {
  const [credentialsInput, setCredentialsInput] = useState<Credentials>({
    apiUrl: '',
    idInstance: '',
    apiTokenInstance: '',
  })
  const apiInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiInputRef.current?.focus()
  }, [])

  const [isTokenVisible, setIsTokenVisible] = useState(false)
  const [validationError, setValidationError] = useState<string>()

  const visibleError = validationError ?? error

  function handleFieldChange(field: keyof Credentials, value: string) {
    onEdit()
    setValidationError(undefined)
    setCredentialsInput((previous) => ({ ...previous, [field]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    try {
      const credentials = normalizeCredentials(credentialsInput)
      setValidationError(undefined)
      onSubmit(credentials)
    } catch (cause) {
      setValidationError(errorMessage(cause))
    }
  }

  return (
    <section className="welcome" aria-labelledby="app-title">
      <span className="welcome__eyebrow">GREEN-API · Telegram</span>
      <h1 id="app-title">Веб-чат</h1>
      <p>Введите данные Telegram instance из личного кабинета GREEN-API.</p>
      <form onSubmit={handleSubmit} className="form" aria-busy={isPending}>
        <label htmlFor="api-url">Адрес API (HTTPS)</label>
        <input
          id="api-url"
          ref={apiInputRef}
          aria-invalid={!!visibleError}
          type="url"
          required
          value={credentialsInput.apiUrl}
          placeholder="https://4100.api.green-api.com"
          onChange={(event) => handleFieldChange('apiUrl', event.target.value)}
          aria-describedby={visibleError ? 'connection-error' : undefined}
        />
        <label htmlFor="instance-id">idInstance</label>
        <input
          id="instance-id"
          aria-invalid={!!visibleError}
          required
          inputMode="numeric"
          value={credentialsInput.idInstance}
          onChange={(event) =>
            handleFieldChange('idInstance', event.target.value)
          }
          aria-describedby={visibleError ? 'connection-error' : undefined}
        />
        <TokenField
          value={credentialsInput.apiTokenInstance}
          isTokenVisible={isTokenVisible}
          hasError={!!visibleError}
          onChange={(value) => handleFieldChange('apiTokenInstance', value)}
          onToggleVisibility={() => setIsTokenVisible((value) => !value)}
        />
        <div id="connection-error">
          {visibleError && (
            <p role="alert" className="error">
              {visibleError}
            </p>
          )}
        </div>
        <button type="submit" disabled={isPending}>
          {isPending ? 'Подключение…' : 'Подключиться'}
        </button>
      </form>
    </section>
  )
}
