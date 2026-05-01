import { isProxyEnabled } from '../runtimeConfig'
import type { HaEntity } from '../types/ha'

const settingsApiPath = '/studio_panel/settings'
const runtimeConfigApiPath = '/internal/runtime-config'

const shouldUseLocalHaProxy = (haUrl: string) => {
  if (typeof window === 'undefined') return false
  return !isProxyEnabled && window.location.protocol === 'https:' && haUrl.startsWith('http://')
}

const buildApiBase = (haUrl: string) => {
  if (isProxyEnabled) return ''
  if (shouldUseLocalHaProxy(haUrl)) return '/ha'
  return haUrl.replace(/\/$/, '')
}

export const apiFetch = async <T>(
  haUrl: string,
  token: string,
  path: string,
  options?: RequestInit,
): Promise<T> => {
  if (!token || (!isProxyEnabled && !haUrl)) {
    throw new Error('Enter Home Assistant URL and token.')
  }

  const baseUrl = buildApiBase(haUrl)
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed (${response.status})`)
  }

  const text = await response.text()
  if (!text) {
    return undefined as T
  }

  return JSON.parse(text) as T
}

export const fetchStates = (haUrl: string, token: string) =>
  apiFetch<HaEntity[]>(haUrl, token, '/states')

export const fetchEntityState = (haUrl: string, token: string, entityId: string) =>
  apiFetch<HaEntity>(haUrl, token, `/states/${encodeURIComponent(entityId)}`)

export const callService = (
  haUrl: string,
  token: string,
  domain: string,
  service: string,
  data: Record<string, unknown>,
) =>
  apiFetch<unknown>(haUrl, token, `/services/${domain}/${service}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const fetchPanelSettings = <T>(haUrl: string, token: string) =>
  apiFetch<T>(haUrl, token, settingsApiPath)

export const saveRuntimeConfig = async (haUrl: string, haToken: string) => {
  const response = await fetch(runtimeConfigApiPath, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ haUrl: haUrl.trim(), haToken: haToken.trim() }),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed (${response.status})`)
  }
}
