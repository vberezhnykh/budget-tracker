import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installUnhandledRejectionReporter } from './utils/clientErrorReporter.js'

installUnhandledRejectionReporter()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Service worker - только в собранном приложении. В разработке он подменял
// бы модули, которые Vite отдаёт по своим правилам, и правка в коде
// доезжала бы до экрана через раз.
//
// Регистрация после load, а не сразу: установка воркера конкурирует за сеть
// с первой загрузкой данных, а нужен он только со второго запуска.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Не повод показывать что-то пользователю: без воркера приложение
      // работает ровно как раньше, просто без офлайна.
      console.error('Не удалось зарегистрировать service worker:', err)
    })
  })
}
