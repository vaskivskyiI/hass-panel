const IDLE_RELOAD_DELAY_MS = 20000
const UPDATE_CHECK_INTERVAL_MS = 120000

export const startUpdateCoordinator = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  let reloadTimer: number | null = null
  let pendingReload = false

  const scheduleReload = () => {
    if (reloadTimer) {
      window.clearTimeout(reloadTimer)
    }

    reloadTimer = window.setTimeout(() => {
      if (document.hidden) {
        window.location.reload()
        return
      }

      pendingReload = true
    }, IDLE_RELOAD_DELAY_MS)
  }

  const flushReloadIfPending = () => {
    if (!pendingReload) return
    pendingReload = false
    window.location.reload()
  }

  const announceNewWorker = (registration: ServiceWorkerRegistration) => {
    const waiting = registration.waiting
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' })
      scheduleReload()
    }
  }

  const register = async () => {
    const registration = await navigator.serviceWorker.register('/sw.js')

    announceNewWorker(registration)

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return

      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announceNewWorker(registration)
        }
      })
    })

    window.setInterval(() => {
      void registration.update()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  document.addEventListener('visibilitychange', flushReloadIfPending)
  window.addEventListener('focus', flushReloadIfPending)
  window.addEventListener('pointerup', scheduleReload)
  window.addEventListener('keyup', scheduleReload)
  navigator.serviceWorker.addEventListener('controllerchange', scheduleReload)

  void register()
}
