import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { QueryProvider } from './app/providers/QueryProvider'

import { App } from './App'

import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Не найден корневой элемент приложения')
}

createRoot(root).render(
  <StrictMode>
    <QueryProvider>
      <App />
    </QueryProvider>
  </StrictMode>,
)
