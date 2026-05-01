import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@mdi/font/css/materialdesignicons.min.css'
import './index.css'
import App from './App.tsx'
import { loadRuntimeConfig } from './runtimeConfig'
import { startUpdateCoordinator } from './services/updateCoordinator'

startUpdateCoordinator()

void loadRuntimeConfig().then((runtimeConfig) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App runtimeConfig={runtimeConfig} />
    </StrictMode>,
  )
})
