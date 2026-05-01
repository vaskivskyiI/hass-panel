import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@mdi/font/css/materialdesignicons.min.css'
import './index.css'
import App from './App.tsx'
import { loadRuntimeConfig } from './runtimeConfig'

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister()
    }
  })

  if ('caches' in window) {
    void caches.keys().then((cacheKeys) => {
      for (const key of cacheKeys) {
        void caches.delete(key)
      }
    })
  }
}

void loadRuntimeConfig().then((runtimeConfig) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App runtimeConfig={runtimeConfig} />
    </StrictMode>,
  )
})
