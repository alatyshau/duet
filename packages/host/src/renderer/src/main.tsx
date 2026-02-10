/*
 * ЧТО: Точка входа React-приложения (renderer process).
 * ЗАЧЕМ: Монтирует корневой компонент App в DOM.
 * КТО ИСПОЛЬЗУЕТ: Vite/electron-vite при загрузке renderer.
 */
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
