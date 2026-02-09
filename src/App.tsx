import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type HaEntity = {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

type LightControlState = {
  brightness: number
  color: string
  colorTemp: number
}

type ClimateControlState = {
  temperature: number
  hvacMode: string
}

type TabKey = 'main' | 'settings'

const envVars = (import.meta as { env: Record<string, string | undefined> }).env
const envUrl = envVars.VITE_HA_URL
const envToken = envVars.VITE_HA_TOKEN
const envProxy = envVars.VITE_HA_PROXY === 'true'
const settingsApiPath = '/studio_panel/settings'

const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const rgbToHex = (rgb?: unknown) => {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#ffffff'
  const [r, g, b] = rgb
  const toHex = (value: unknown) => {
    const num = Math.max(0, Math.min(255, toNumber(value, 255)))
    return num.toString(16).padStart(2, '0')
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return [255, 255, 255]
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return [r, g, b]
}

const getLightCapabilities = (entity: HaEntity) => {
  const supported = Array.isArray(entity.attributes?.supported_color_modes)
    ? (entity.attributes?.supported_color_modes as string[])
    : []
  const colorMode =
    typeof entity.attributes?.color_mode === 'string'
      ? entity.attributes?.color_mode
      : ''
  const supportsColor =
    supported.includes('rgb') ||
    supported.includes('hs') ||
    supported.includes('rgbw') ||
    supported.includes('rgbww') ||
    supported.includes('xy') ||
    colorMode === 'rgb' ||
    colorMode === 'hs' ||
    colorMode === 'xy'
  const supportsColorTemp =
    supported.includes('color_temp') ||
    supported.includes('kelvin') ||
    colorMode === 'color_temp' ||
    colorMode === 'kelvin'
  return { supportsColor, supportsColorTemp }
}

const defaultCategories = ['Lights', 'Climate', 'Switches', 'Other'] as const

const getDefaultCategory = (entity: HaEntity) => {
  if (entity.entity_id.startsWith('light.')) return 'Lights'
  if (entity.entity_id.startsWith('climate.')) return 'Climate'
  if (entity.entity_id.startsWith('switch.')) return 'Switches'
  return 'Other'
}

function App() {
  const [haUrl, setHaUrl] = useState(
    () => envUrl ?? '',
  )
  const [token, setToken] = useState(
    () => envToken ?? '',
  )
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('main')
  const [modalEntity, setModalEntity] = useState<HaEntity | null>(null)
  const [hiddenEntities, setHiddenEntities] = useState<string[]>([])
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    () => ({}),
  )
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [entityOrder, setEntityOrder] = useState<string[]>([])
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [lightControls, setLightControls] = useState<
    Record<string, LightControlState>
  >({})
  const [climateControls, setClimateControls] = useState<
    Record<string, ClimateControlState>
  >({})
  const [passwordHash, setPasswordHash] = useState('')
  const [settingsUnlocked, setSettingsUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const lightDebounceRef = useRef<Record<string, number>>({})
  const climateDebounceRef = useRef<Record<string, number>>({})
  const saveDebounceRef = useRef<number | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const hashValue = async (value: string) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(value)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  const loadPanelSettings = useCallback(async () => {
    if (!connectionReady) return
    try {
      const parsed = (await apiFetch(settingsApiPath)) as Record<string, unknown>

      const storedUrl = typeof parsed.haUrl === 'string' ? parsed.haUrl : ''
      const storedToken = typeof parsed.haToken === 'string' ? parsed.haToken : ''
      if (storedUrl && !haUrl) setHaUrl(storedUrl)
      if (storedToken && !token) setToken(storedToken)

      setHiddenEntities(
        Array.isArray(parsed.hiddenEntities)
          ? (parsed.hiddenEntities as string[])
          : [],
      )
      setNameOverrides(
        typeof parsed.nameOverrides === 'object' && parsed.nameOverrides
          ? (parsed.nameOverrides as Record<string, string>)
          : {},
      )
      setCategoryMap(
        typeof parsed.categoryMap === 'object' && parsed.categoryMap
          ? (parsed.categoryMap as Record<string, string>)
          : {},
      )
      setEntityOrder(
        Array.isArray(parsed.entityOrder)
          ? (parsed.entityOrder as string[])
          : [],
      )
      setCustomCategories(
        Array.isArray(parsed.customCategories)
          ? (parsed.customCategories as string[])
          : [],
      )
      setPasswordHash(
        typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '',
      )
      setSettingsLoaded(true)
      setStorageError('')
    } catch (err) {
      setStorageError(
        err instanceof Error ? err.message : 'Unable to load settings',
      )
    }
  }, [apiFetch, connectionReady, haUrl, token])

  const persistPanelSettings = useCallback(
    async (next?: {
      haUrl?: string
      haToken?: string
      hiddenEntities?: string[]
      nameOverrides?: Record<string, string>
      categoryMap?: Record<string, string>
      entityOrder?: string[]
      customCategories?: string[]
      passwordHash?: string
    }) => {
      if (!connectionReady || !settingsLoaded) return
      const payload = {
        haUrl,
        haToken: token,
        hiddenEntities,
        nameOverrides,
        categoryMap,
        entityOrder,
        customCategories,
        passwordHash,
        ...next,
      }
      await apiFetch(settingsApiPath, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    },
    [
      categoryMap,
      connectionReady,
      customCategories,
      entityOrder,
      hiddenEntities,
      nameOverrides,
      passwordHash,
      settingsLoaded,
      token,
      haUrl,
    ],
  )

  useEffect(() => {
    if (!connectionReady || !settingsLoaded) return
    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current)
    }
    saveDebounceRef.current = window.setTimeout(() => {
      void persistPanelSettings()
    }, 500)
  }, [
    categoryMap,
    connectionReady,
    customCategories,
    entityOrder,
    hiddenEntities,
    nameOverrides,
    passwordHash,
    settingsLoaded,
    token,
    haUrl,
    persistPanelSettings,
  ])

  const apiFetch = useCallback(async (path: string, options?: RequestInit) => {
    if (!token || (!envProxy && !haUrl)) {
      throw new Error('Enter Home Assistant URL and token.')
    }
    const baseUrl = envProxy ? '' : haUrl.replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/api${path}`, {
      ...options,
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
    return response.json()
  }, [haUrl, token])

  const refreshEntities = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const data = (await apiFetch('/states')) as HaEntity[]
      setEntities(data)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch entities')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [apiFetch])

  const connectionReady = Boolean(token && (envProxy || haUrl))

  useEffect(() => {
    if (haUrl && token) {
      refreshEntities(false)
    }
  }, [haUrl, token, refreshEntities])

  useEffect(() => {
    if (connectionReady && !settingsLoaded) {
      void loadPanelSettings()
    }
  }, [connectionReady, loadPanelSettings, settingsLoaded])

  useEffect(() => {
    if (!connectionReady) return
    const intervalId = window.setInterval(() => {
      refreshEntities(true)
    }, 3000)
    return () => window.clearInterval(intervalId)
  }, [connectionReady, refreshEntities])

  useEffect(() => {
    setLightControls((prev) => {
      const next = { ...prev }
      entities
        .filter((entity) => entity.entity_id.startsWith('light.'))
        .forEach((entity) => {
          if (!next[entity.entity_id]) {
            const brightness = toNumber(entity.attributes?.brightness, 180)
            const color = rgbToHex(entity.attributes?.rgb_color)
            const colorTemp = toNumber(
              entity.attributes?.color_temp,
              300,
            )
            next[entity.entity_id] = { brightness, color, colorTemp }
          }
        })
      return next
    })

    setClimateControls((prev) => {
      const next = { ...prev }
      entities
        .filter((entity) => entity.entity_id.startsWith('climate.'))
        .forEach((entity) => {
          if (!next[entity.entity_id]) {
            const temperature = toNumber(
              entity.attributes?.temperature,
              toNumber(entity.attributes?.current_temperature, 22),
            )
            const hvacMode =
              typeof entity.attributes?.hvac_mode === 'string'
                ? entity.attributes?.hvac_mode
                : 'auto'
            next[entity.entity_id] = { temperature, hvacMode }
          }
        })
      return next
    })
  }, [entities])

  useEffect(() => {
    if (entities.length === 0) return
    setEntityOrder((prev) => {
      const known = new Set(prev)
      const next = [...prev]
      entities.forEach((entity) => {
        if (!known.has(entity.entity_id)) {
          next.push(entity.entity_id)
        }
      })
      return next
    })
  }, [entities])

  const callService = async (
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ) => {
    await apiFetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  const toggleEntity = async (entity: HaEntity) => {
    const domain = entity.entity_id.split('.')[0]
    const isOn = entity.state === 'on'
    const service = isOn ? 'turn_off' : 'turn_on'
    await callService(domain, service, { entity_id: entity.entity_id })
    await refreshEntities(true)
  }

  const applyLight = async (entity: HaEntity) => {
    const control = lightControls[entity.entity_id]
    if (!control) return
      const { supportsColor, supportsColorTemp } = getLightCapabilities(entity)
      const payload: Record<string, unknown> = {
        entity_id: entity.entity_id,
        brightness: Math.round(control.brightness),
      }
      if (supportsColor) {
        const [r, g, b] = hexToRgb(control.color)
        payload.rgb_color = [r, g, b]
      }
      if (supportsColorTemp) {
        payload.color_temp = Math.round(control.colorTemp)
      }
      await callService('light', 'turn_on', payload)
    await refreshEntities(true)
  }

  const setClimateTemperature = async (entity: HaEntity) => {
    const control = climateControls[entity.entity_id]
    if (!control) return
    await callService('climate', 'set_temperature', {
      entity_id: entity.entity_id,
      temperature: control.temperature,
    })
    await refreshEntities(true)
  }

  const setClimateMode = async (entity: HaEntity) => {
    const control = climateControls[entity.entity_id]
    if (!control) return
    await callService('climate', 'set_hvac_mode', {
      entity_id: entity.entity_id,
      hvac_mode: control.hvacMode,
    })
    await refreshEntities(true)
  }


  const getDisplayName = (entity: HaEntity) =>
    nameOverrides[entity.entity_id] ??
    ((entity.attributes?.friendly_name as string) ?? entity.entity_id)

  const getCategory = (entity: HaEntity) =>
    categoryMap[entity.entity_id] ?? getDefaultCategory(entity)

  const visibleEntities = useMemo(
    () => entities.filter((entity) => !hiddenEntities.includes(entity.entity_id)),
    [entities, hiddenEntities],
  )

  const orderedVisibleEntities = useMemo(() => {
    const orderIndex = new Map(
      entityOrder.map((id, index) => [id, index]),
    )
    return [...visibleEntities].sort((a, b) => {
      const aIndex = orderIndex.get(a.entity_id)
      const bIndex = orderIndex.get(b.entity_id)
      if (aIndex === undefined && bIndex === undefined) {
        return a.entity_id.localeCompare(b.entity_id)
      }
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      return aIndex - bIndex
    })
  }, [entityOrder, visibleEntities])

  const orderedEntities = useMemo(() => {
    const orderIndex = new Map(
      entityOrder.map((id, index) => [id, index]),
    )
    return [...entities].sort((a, b) => {
      const aIndex = orderIndex.get(a.entity_id)
      const bIndex = orderIndex.get(b.entity_id)
      if (aIndex === undefined && bIndex === undefined) {
        return a.entity_id.localeCompare(b.entity_id)
      }
      if (aIndex === undefined) return 1
      if (bIndex === undefined) return -1
      return aIndex - bIndex
    })
  }, [entities, entityOrder])

  const categoryList = useMemo(() => {
    const fromMap = Object.values(categoryMap)
    const custom = Array.from(
      new Set(
        [...customCategories, ...fromMap].filter(
          (name) => !defaultCategories.includes(name as never),
        ),
      ),
    )
    return [...defaultCategories, ...custom]
  }, [categoryMap, customCategories])

  const climateSensor = entities.find(
    (entity) => entity.entity_id === 'sensor.ir_remote_temperature',
  )
  const humiditySensor = entities.find(
    (entity) => entity.entity_id === 'sensor.ir_remote_humidity',
  )

  const filteredEntities = useMemo(() => {
    const source = orderedEntities
    if (!entityFilter.trim()) return source
    const query = entityFilter.toLowerCase()
    return source.filter((entity) =>
      getDisplayName(entity).toLowerCase().includes(query) ||
      entity.entity_id.toLowerCase().includes(query),
    )
  }, [orderedEntities, entityFilter, nameOverrides])

  const handleUnlock = async () => {
    if (!passwordHash) {
      if (!newPassword.trim()) {
        setSettingsError('Set a password to protect settings.')
        return
      }
      const hashed = await hashValue(newPassword.trim())
      setPasswordHash(hashed)
      setSettingsUnlocked(true)
      setSettingsError('')
      setPasswordInput('')
      setNewPassword('')
      return
    }
    const hashedInput = await hashValue(passwordInput)
    if (hashedInput === passwordHash) {
      setSettingsUnlocked(true)
      setSettingsError('')
    } else {
      setSettingsError('Incorrect password.')
    }
  }

  const handleLock = () => {
    setSettingsUnlocked(false)
    setPasswordInput('')
    setSettingsError('')
  }

  const updatePassword = async () => {
    if (!newPassword.trim()) {
      setSettingsError('Enter a new password.')
      return
    }
    const hashed = await hashValue(newPassword.trim())
    setPasswordHash(hashed)
    setSettingsUnlocked(true)
    setSettingsError('')
    setPasswordInput('')
    setNewPassword('')
  }

  const toggleVisibility = (entityId: string) => {
    setHiddenEntities((prev) =>
      prev.includes(entityId)
        ? prev.filter((id) => id !== entityId)
        : [...prev, entityId],
    )
  }

  const setBulkVisibility = (visible: boolean) => {
    if (visible) {
      setHiddenEntities([])
    } else {
      setHiddenEntities(entities.map((entity) => entity.entity_id))
    }
  }

  const updateNameOverride = (entityId: string, value: string) => {
    setNameOverrides((prev) => ({
      ...prev,
      [entityId]: value,
    }))
  }

  const clearNameOverride = (entityId: string) => {
    setNameOverrides((prev) => {
      const next = { ...prev }
      delete next[entityId]
      return next
    })
  }

  const scheduleLightApply = (entity: HaEntity) => {
    const id = entity.entity_id
    if (lightDebounceRef.current[id]) {
      window.clearTimeout(lightDebounceRef.current[id])
    }
    lightDebounceRef.current[id] = window.setTimeout(() => {
      void applyLight(entity)
    }, 500)
  }

  const scheduleClimateTemperature = (entity: HaEntity) => {
    const id = entity.entity_id
    if (climateDebounceRef.current[id]) {
      window.clearTimeout(climateDebounceRef.current[id])
    }
    climateDebounceRef.current[id] = window.setTimeout(() => {
      void setClimateTemperature(entity)
    }, 500)
  }

  const renderDeviceCard = (entity: HaEntity) => {
    const name = getDisplayName(entity)
    const domain = entity.entity_id.split('.')[0]
    const state = entity.state
    const isOn = state === 'on'
    const color =
      domain === 'light'
        ? lightControls[entity.entity_id]?.color
        : undefined
    const setTemp =
      domain === 'climate'
        ? toNumber(entity.attributes?.temperature, 0)
        : 0

    return (
      <button
        key={entity.entity_id}
        className={`device-card ${isOn ? 'on' : ''}`}
        onClick={() => setModalEntity(entity)}
      >
        <div>
          <div className="card-title">{name}</div>
          {domain === 'climate' && entity.state !== 'off' && setTemp > 0 && (
            <div className="card-sub">Set {setTemp}°</div>
          )}
        </div>
        <div className="device-meta">
          {color && (
            <span className="color-dot" style={{ background: color }} />
          )}
          <span className={`state ${isOn ? 'on' : ''}`}>{state}</span>
        </div>
      </button>
    )
  }

  const renderModalContent = (entity: HaEntity) => {
    const domain = entity.entity_id.split('.')[0]
    if (domain === 'light') {
      const control = lightControls[entity.entity_id]
      const brightnessPercent = control
        ? Math.round((control.brightness / 255) * 100)
        : 0
      return (
        <div className="modal-body">
          <div className="modal-actions">
            <button className="toggle" onClick={() => toggleEntity(entity)}>
              {entity.state === 'on' ? 'Turn off' : 'Turn on'}
            </button>
            <button className="primary" onClick={() => applyLight(entity)}>
              Apply light
            </button>
          </div>
          <div className="control-row">
            <label>Brightness</label>
            <input
              type="range"
              min={1}
              max={255}
              value={control?.brightness ?? 180}
              style={{
                ['--slider-color' as string]:
                  control?.color ?? '#d8b67a',
              }}
              onChange={(event) =>
                setLightControls((prev) => ({
                  ...prev,
                  [entity.entity_id]: {
                    brightness: Number(event.target.value),
                    color: prev[entity.entity_id]?.color ?? '#ffffff',
                    colorTemp: prev[entity.entity_id]?.colorTemp ?? 300,
                  },
                }))
              }
              onPointerUp={() => scheduleLightApply(entity)}
              onTouchEnd={() => scheduleLightApply(entity)}
            />
            <span className="value">{brightnessPercent}%</span>
          </div>
          {getLightCapabilities(entity).supportsColor && (
            <div className="control-row">
              <label>Color</label>
              <input
                className="color-input"
                type="color"
                value={control?.color ?? '#ffffff'}
                onChange={(event) => {
                  setLightControls((prev) => ({
                    ...prev,
                    [entity.entity_id]: {
                      brightness: prev[entity.entity_id]?.brightness ?? 180,
                      color: event.target.value,
                      colorTemp: prev[entity.entity_id]?.colorTemp ?? 300,
                    },
                  }))
                  scheduleLightApply(entity)
                }}
              />
            </div>
          )}
          {getLightCapabilities(entity).supportsColorTemp && (
            <div className="control-row">
              <label>Temperature</label>
              <input
                type="range"
                min={toNumber(entity.attributes?.min_mireds, 153)}
                max={toNumber(entity.attributes?.max_mireds, 500)}
                value={control?.colorTemp ?? 300}
                onChange={(event) =>
                  setLightControls((prev) => ({
                    ...prev,
                    [entity.entity_id]: {
                      brightness: prev[entity.entity_id]?.brightness ?? 180,
                      color: prev[entity.entity_id]?.color ?? '#ffffff',
                      colorTemp: Number(event.target.value),
                    },
                  }))
                }
                onPointerUp={() => scheduleLightApply(entity)}
                onTouchEnd={() => scheduleLightApply(entity)}
              />
              <span className="value">
                {Math.round(1000000 / (control?.colorTemp ?? 300))}K
              </span>
            </div>
          )}
        </div>
      )
    }

    if (domain === 'climate') {
      const control = climateControls[entity.entity_id]
      const minTemp = toNumber(entity.attributes?.min_temp, 16)
      const maxTemp = toNumber(entity.attributes?.max_temp, 30)
      const currentTemp = toNumber(
        entity.attributes?.current_temperature,
        control?.temperature ?? 22,
      )
      const hvacModes = Array.isArray(entity.attributes?.hvac_modes)
        ? (entity.attributes?.hvac_modes as string[])
        : ['auto', 'heat', 'cool', 'off']

      return (
        <div className="modal-body">
          <div className="modal-actions">
            <button className="toggle" onClick={() => toggleEntity(entity)}>
              {entity.state === 'off' ? 'Turn on' : 'Turn off'}
            </button>
            <button
              className="primary"
              onClick={() => setClimateTemperature(entity)}
            >
              Set temperature
            </button>
          </div>
          <div className="control-row">
            <label>Target</label>
            <input
              type="range"
              min={minTemp}
              max={maxTemp}
              step={0.5}
              value={control?.temperature ?? currentTemp}
              onChange={(event) =>
                setClimateControls((prev) => ({
                  ...prev,
                  [entity.entity_id]: {
                    temperature: Number(event.target.value),
                    hvacMode: prev[entity.entity_id]?.hvacMode ?? 'auto',
                  },
                }))
              }
              onPointerUp={() => scheduleClimateTemperature(entity)}
              onTouchEnd={() => scheduleClimateTemperature(entity)}
            />
            <span className="value">
              {control?.temperature ?? currentTemp}°
            </span>
          </div>
          <div className="control-row">
            <label>Mode</label>
            <select
              value={control?.hvacMode ?? 'auto'}
              onChange={(event) =>
                setClimateControls((prev) => ({
                  ...prev,
                  [entity.entity_id]: {
                    temperature: prev[entity.entity_id]?.temperature ??
                      currentTemp,
                    hvacMode: event.target.value,
                  },
                }))
              }
            >
              {hvacModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => setClimateMode(entity)}>
              Set mode
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="modal-body">
        <div className="modal-actions">
          <button className="toggle" onClick={() => toggleEntity(entity)}>
            {entity.state === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        <div className="modal-meta">No advanced controls available.</div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <div className="brand-title">NM Studio Panel</div>
            <div className="brand-sub">Smart device control</div>
          </div>
        </div>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'main' ? 'active' : ''}`}
            onClick={() => setActiveTab('main')}
          >
            Main panel
          </button>
          <button
            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>
        <div className="status">
          <span className={`pill ${connectionReady ? 'ok' : 'warn'}`}>
            {connectionReady ? 'Connected' : 'Offline'}
          </span>
          <button
            className="ghost"
            onClick={() => refreshEntities(false)}
            disabled={loading || !connectionReady}
          >
            Refresh
          </button>
        </div>
      </header>

      {activeTab === 'main' && (
        <>
          {categoryList.map((category) => {
            const categoryEntities = orderedVisibleEntities.filter(
              (entity) => getCategory(entity) === category,
            )
            if (categoryEntities.length === 0) return null
            return (
              <section className="section" key={category}>
                <div className="section-header">
                  <div>
                    <h2>{category}</h2>
                    {category === 'Climate' && (
                      <div className="climate-meta">
                        {climateSensor && (
                          <span>
                            {climateSensor.state}
                            {climateSensor.attributes?.unit_of_measurement ?? ''}
                          </span>
                        )}
                        {humiditySensor && (
                          <span>
                            {humiditySensor.state}
                            {humiditySensor.attributes?.unit_of_measurement ?? ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="count">{categoryEntities.length}</span>
                </div>
                <div className="cards touch-grid">
                  {categoryEntities.map(renderDeviceCard)}
                </div>
              </section>
            )
          })}
        </>
      )}

      {activeTab === 'settings' && (
        <section className="settings">
          <div className="settings-card">
            <div className="settings-head">
              <div>
                <div className="card-title">Settings</div>
                <div className="card-sub">Protected configuration</div>
              </div>
              {passwordHash && settingsUnlocked && (
                <button className="ghost" onClick={handleLock}>
                  Lock
                </button>
              )}
            </div>

            {!settingsUnlocked && (
              <div className="settings-lock">
                <label>
                  {passwordHash ? 'Enter password' : 'Create password'}
                </label>
                <input
                  type="password"
                  value={passwordHash ? passwordInput : newPassword}
                  onChange={(event) =>
                    passwordHash
                      ? setPasswordInput(event.target.value)
                      : setNewPassword(event.target.value)
                  }
                  placeholder={passwordHash ? 'Password' : 'New password'}
                />
                <button className="primary" onClick={handleUnlock}>
                  {passwordHash ? 'Unlock' : 'Save password'}
                </button>
                {settingsError && (
                  <div className="error-inline">{settingsError}</div>
                )}
              </div>
            )}

            {settingsUnlocked && (
              <div className="settings-body">
                <div className="settings-section">
                  <div className="section-header">
                    <h2>Connection</h2>
                  </div>
                  <div className="config-grid">
                    <div className="field">
                      <label>Home Assistant URL</label>
                      <input
                        type="url"
                        placeholder="https://homeassistant.local:8123"
                        value={haUrl}
                        onChange={(event) => setHaUrl(event.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>Long-Lived Access Token</label>
                      <input
                        type="password"
                        placeholder="Paste token"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="config-actions">
                    <button
                      className="primary"
                      onClick={() => refreshEntities(false)}
                      disabled={loading || !connectionReady}
                    >
                      {loading ? 'Connecting…' : 'Connect & Load'}
                    </button>
                    <div className="meta">
                      <span>
                        {lastUpdated ? `Last sync ${lastUpdated}` : 'Not synced yet'}
                      </span>
                      <span className="hint">
                        Token and URL are stored locally on this tablet.
                      </span>
                    </div>
                  </div>
                  {error && (
                    <div className="error">
                      <div>{error}</div>
                      {error.includes('Failed to fetch') && (
                        <div className="hint">
                          Check CORS in Home Assistant or enable dev proxy via
                          VITE_HA_PROXY=true in .env.local.
                        </div>
                      )}
                    </div>
                  )}
                  {storageError && (
                    <div className="error">
                      <div>{storageError}</div>
                      <div className="hint">
                        Install and enable the Studio Panel custom integration
                        in Home Assistant.
                      </div>
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <div className="section-header">
                    <h2>Entity visibility</h2>
                  </div>
                  <div className="filter-row">
                    <input
                      type="text"
                      placeholder="Filter entities"
                      value={entityFilter}
                      onChange={(event) => setEntityFilter(event.target.value)}
                    />
                    <span className="count">{filteredEntities.length}</span>
                  </div>
                  <div className="filter-row">
                    <input
                      type="text"
                      placeholder="Add category"
                      value={newCategory}
                      onChange={(event) => setNewCategory(event.target.value)}
                    />
                    <button
                      className="ghost"
                      onClick={() => {
                        if (!newCategory.trim()) return
                        const trimmed = newCategory.trim()
                        setCustomCategories((prev) =>
                          prev.includes(trimmed) ? prev : [...prev, trimmed],
                        )
                        setNewCategory('')
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="bulk-actions">
                    <button
                      className="ghost"
                      onClick={() => setBulkVisibility(true)}
                    >
                      Show all
                    </button>
                    <button
                      className="ghost"
                      onClick={() => setBulkVisibility(false)}
                    >
                      Hide all
                    </button>
                  </div>
                  <div className="entity-list">
                    {filteredEntities.map((entity) => {
                      const hidden = hiddenEntities.includes(entity.entity_id)
                      const currentCategory = getCategory(entity)
                      return (
                        <div key={entity.entity_id} className="entity-row">
                          <div className="entity-meta">
                            <div className="card-title">{getDisplayName(entity)}</div>
                            <input
                              type="text"
                              placeholder="Custom name"
                              value={nameOverrides[entity.entity_id] ?? ''}
                              onChange={(event) =>
                                updateNameOverride(
                                  entity.entity_id,
                                  event.target.value,
                                )
                              }
                            />
                            <select
                              value={currentCategory}
                              onChange={(event) =>
                                setCategoryMap((prev) => ({
                                  ...prev,
                                  [entity.entity_id]: event.target.value,
                                }))
                              }
                            >
                              {categoryList.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="entity-actions">
                            <button
                              className="ghost"
                              onClick={() =>
                                setEntityOrder((prev) => {
                                  const idx = prev.indexOf(entity.entity_id)
                                  if (idx <= 0) return prev
                                  const next = [...prev]
                                  const temp = next[idx - 1]
                                  next[idx - 1] = next[idx]
                                  next[idx] = temp
                                  return next
                                })
                              }
                            >
                              Up
                            </button>
                            <button
                              className="ghost"
                              onClick={() =>
                                setEntityOrder((prev) => {
                                  const idx = prev.indexOf(entity.entity_id)
                                  if (idx === -1 || idx >= prev.length - 1)
                                    return prev
                                  const next = [...prev]
                                  const temp = next[idx + 1]
                                  next[idx + 1] = next[idx]
                                  next[idx] = temp
                                  return next
                                })
                              }
                            >
                              Down
                            </button>
                            <button
                              className="ghost"
                              onClick={() => clearNameOverride(entity.entity_id)}
                              disabled={!nameOverrides[entity.entity_id]}
                            >
                              Reset
                            </button>
                            <button
                              className={`toggle ${hidden ? '' : 'on'}`}
                              onClick={() => toggleVisibility(entity.entity_id)}
                            >
                              {hidden ? 'Hidden' : 'Visible'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {filteredEntities.length === 0 && (
                      <div className="empty">No entities match the filter.</div>
                    )}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="section-header">
                    <h2>Password</h2>
                  </div>
                  <div className="settings-lock">
                    <label>Set / change password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="New password"
                    />
                    <button className="ghost" onClick={updatePassword}>
                      Update password
                    </button>
                    {settingsError && (
                      <div className="error-inline">{settingsError}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </section>
      )}

      {modalEntity && (
        <div className="modal-overlay" onClick={() => setModalEntity(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="card-title">{getDisplayName(modalEntity)}</div>
              </div>
              <button className="ghost" onClick={() => setModalEntity(null)}>
                Close
              </button>
            </div>
            <div className="modal-state">State: {modalEntity.state}</div>
            {renderModalContent(modalEntity)}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
