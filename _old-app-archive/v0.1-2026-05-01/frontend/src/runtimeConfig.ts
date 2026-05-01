export type RuntimeConfig = {
  haUrl?: string
  haToken?: string
}

const envVars = (import.meta as { env: Record<string, string | undefined> }).env

export const isProxyEnabled =
  envVars.DEV === 'true' && envVars.VITE_HA_PROXY === 'true'

const readValue = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

export const loadRuntimeConfig = async (): Promise<RuntimeConfig> => {
  try {
    const response = await fetch('/runtime-config.json', {
      cache: 'no-store',
    })

    if (!response.ok) {
      return {}
    }

    const parsed = (await response.json()) as Record<string, unknown>

    return {
      haUrl: readValue(parsed.haUrl),
      haToken: readValue(parsed.haToken),
    }
  } catch {
    return {}
  }
}