const DEVICE_ID_KEY = 'studio-panel-device-id'

const generateDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `panel-${Math.random().toString(36).slice(2, 10)}`
}

export const getOrCreateDeviceId = () => {
  if (typeof window === 'undefined') return 'server-render'

  const stored = window.localStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored

  const created = generateDeviceId()
  window.localStorage.setItem(DEVICE_ID_KEY, created)
  return created
}

export const getProfileKeyFromLocation = () => {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('profile')?.trim() ?? ''
}

export const resolveProfileKey = (
  deviceId: string,
  deviceProfiles: Record<string, string> | undefined,
) => {
  const fromLocation = getProfileKeyFromLocation()
  if (fromLocation) return fromLocation
  return deviceProfiles?.[deviceId] ?? ''
}
