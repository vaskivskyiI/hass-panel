import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import { isProxyEnabled, type RuntimeConfig } from './runtimeConfig'

type HaEntity = {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

type LightControlState = {
  brightness: number
  color: string
  kelvin: number
}

type ClimateControlState = {
  temperature: number
  hvacMode: string
}

type SceneButton = {
  id: string
  label: string
}

type RuntimeConnectionSettings = {
  haUrl: string
  haToken: string
}

type HeaderEntityConfig = {
  temperatureEntityId: string
  humidityEntityId: string
  doorContactEntityId: string
  doorActionEntityId: string
}

type TabKey = 'main' | 'settings'
type MainSection = 'home' | 'scenes' | `category:${string}`

type PanelSettings = {
  enabledEntities: string[]
  nameOverrides: Record<string, string>
  categoryMap: Record<string, string>
  cardWidths: Record<string, 'single' | 'double'>
  entityOrder: string[]
  customCategories: string[]
  categoryPinHashes: Record<string, string>
  categoryTopText: Record<string, string>
  categoryBottomText: Record<string, string>
  categoryTopEntities: Record<string, string[]>
  categoryBottomEntities: Record<string, string[]>
  sceneButtons: SceneButton[]
  showIcons: Record<string, boolean>
  passwordHash: string
  headerEntities: HeaderEntityConfig
}

const settingsApiPath = '/studio_panel/settings'
const runtimeConfigApiPath = '/internal/runtime-config'
const climateModeFallback = ['auto', 'heat', 'cool', 'fan_only', 'off']
const baseCategoryOptions = ['hidden'] as const

const waitForRefresh = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  })

const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const rgbToHex = (rgb?: unknown) => {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#f6dba0'
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

const getEntityKelvinBounds = (entity: HaEntity) => {
  const minKelvinFromAttr = toNumber(entity.attributes.min_color_temp_kelvin, 2000)
  const maxKelvinFromAttr = toNumber(entity.attributes.max_color_temp_kelvin, 6500)

  if (
    Number.isFinite(minKelvinFromAttr) &&
    Number.isFinite(maxKelvinFromAttr) &&
    minKelvinFromAttr > 0 &&
    maxKelvinFromAttr > minKelvinFromAttr
  ) {
    return { minKelvin: minKelvinFromAttr, maxKelvin: maxKelvinFromAttr }
  }

  const minMireds = toNumber(entity.attributes.min_mireds, 153)
  const maxMireds = toNumber(entity.attributes.max_mireds, 500)

  const minKelvin = Math.round(1000000 / maxMireds)
  const maxKelvin = Math.round(1000000 / minMireds)

  return { minKelvin, maxKelvin }
}

const getEntityKelvin = (entity: HaEntity) => {
  if (typeof entity.attributes.color_temp_kelvin === 'number') {
    return entity.attributes.color_temp_kelvin
  }

  if (typeof entity.attributes.color_temp === 'number') {
    return Math.round(1000000 / entity.attributes.color_temp)
  }

  const { minKelvin, maxKelvin } = getEntityKelvinBounds(entity)
  return Math.round((minKelvin + maxKelvin) / 2)
}

const createLightControlFromEntity = (entity: HaEntity): LightControlState => ({
  brightness: toNumber(entity.attributes.brightness, 180),
  color: rgbToHex(entity.attributes.rgb_color),
  kelvin: getEntityKelvin(entity),
})

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []

const normalizeStringMap = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {}

const normalizeBooleanMap = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
        ),
      )
    : {}

const normalizeStringArrayMap = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value)
          .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
          .map(([key, list]) => [
            key,
            (list as unknown[]).filter((item): item is string => typeof item === 'string'),
          ]),
      )
    : {}

const normalizeCardWidths = (value: unknown): Record<string, 'single' | 'double'> =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, 'single' | 'double'] =>
            entry[1] === 'single' || entry[1] === 'double',
        ),
      )
    : {}

const normalizeSceneButtons = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === 'object' && entry !== null,
        )
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : '',
          label: typeof entry.label === 'string' ? entry.label : '',
        }))
    : []

const normalizeHeaderEntityConfig = (value: unknown): HeaderEntityConfig => {
  if (typeof value !== 'object' || value === null) {
    return {
      temperatureEntityId: '',
      humidityEntityId: '',
      doorContactEntityId: '',
      doorActionEntityId: '',
    }
  }

  const parsed = value as Record<string, unknown>
  return {
    temperatureEntityId:
      typeof parsed.temperatureEntityId === 'string'
        ? parsed.temperatureEntityId
        : '',
    humidityEntityId:
      typeof parsed.humidityEntityId === 'string' ? parsed.humidityEntityId : '',
    doorContactEntityId:
      typeof parsed.doorContactEntityId === 'string'
        ? parsed.doorContactEntityId
        : '',
    doorActionEntityId:
      typeof parsed.doorActionEntityId === 'string' ? parsed.doorActionEntityId : '',
  }
}

const getLightCapabilities = (entity: HaEntity) => {
  const supported = Array.isArray(entity.attributes.supported_color_modes)
    ? (entity.attributes.supported_color_modes as string[])
    : []
  const colorMode =
    typeof entity.attributes.color_mode === 'string'
      ? entity.attributes.color_mode
      : ''

  const supportsRgb =
    supported.includes('rgb') ||
    supported.includes('hs') ||
    supported.includes('rgbw') ||
    supported.includes('rgbww') ||
    supported.includes('xy') ||
    colorMode === 'rgb' ||
    colorMode === 'hs' ||
    colorMode === 'xy'

  const supportsKelvin =
    supported.includes('color_temp') ||
    supported.includes('kelvin') ||
    colorMode === 'color_temp' ||
    colorMode === 'kelvin'

  const supportsBrightness =
    supported.length === 0 ||
    supported.some((mode) => mode !== 'onoff') ||
    (colorMode.length > 0 && colorMode !== 'onoff')

  return { supportsRgb, supportsKelvin, supportsBrightness }
}

const getEntitySectionFromDomain = (entity: HaEntity): string => {
  const domain = entity.entity_id.split('.')[0]
  if (domain === 'light') return 'Lighting'
  if (domain === 'climate') return 'Climate'
  if (
    ['lock', 'alarm_control_panel', 'binary_sensor', 'switch', 'cover'].includes(
      domain,
    )
  ) {
    return 'Security'
  }
  return 'General'
}

const isEntityActive = (entity: HaEntity) => {
  const domain = entity.entity_id.split('.')[0]
  if (domain === 'climate') {
    return entity.state !== 'off' && entity.state !== 'unavailable'
  }
  return ['on', 'open', 'unlocked', 'playing', 'home'].includes(entity.state)
}

const formatLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

const getDisplayState = (entity: HaEntity) => {
  if (entity.state === 'unavailable') return 'Unavailable'
  if (entity.state === 'unknown') return 'Unknown'
  return formatLabel(entity.state)
}

const getMeasurementUnit = (entity?: HaEntity) =>
  entity && typeof entity.attributes.unit_of_measurement === 'string'
    ? entity.attributes.unit_of_measurement
    : ''

const createInitialConnectionSettings = (
  runtimeConfig: RuntimeConfig,
): RuntimeConnectionSettings => ({
  haUrl: runtimeConfig.haUrl ?? '',
  haToken: runtimeConfig.haToken ?? '',
})

const createInitialSettings = (): PanelSettings => {
  return {
    enabledEntities: [],
    nameOverrides: {},
    categoryMap: {},
    cardWidths: {},
    entityOrder: [],
    customCategories: [],
    categoryPinHashes: {},
    categoryTopText: {},
    categoryBottomText: {},
    categoryTopEntities: {},
    categoryBottomEntities: {},
    sceneButtons: [],
    showIcons: {},
    passwordHash: '',
    headerEntities: {
      temperatureEntityId: '',
      humidityEntityId: '',
      doorContactEntityId: '',
      doorActionEntityId: '',
    },
  }
}

function App({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  const initialConnection = useMemo(
    () => createInitialConnectionSettings(runtimeConfig),
    [runtimeConfig],
  )
  const initialSettings = useMemo(
    () => createInitialSettings(),
    [],
  )

  const [haUrl, setHaUrl] = useState(initialConnection.haUrl)
  const [token, setToken] = useState(initialConnection.haToken)
  const [connectionHaUrl, setConnectionHaUrl] = useState(initialConnection.haUrl)
  const [connectionToken, setConnectionToken] = useState(initialConnection.haToken)
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [activeTab, setActiveTab] = useState<TabKey>('main')
  const [mainSection, setMainSection] = useState<MainSection>('home')
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [modalEntity, setModalEntity] = useState<HaEntity | null>(null)
  const [enabledEntities, setEnabledEntities] = useState(
    initialSettings.enabledEntities,
  )
  const [legacyHidden, setLegacyHidden] = useState<string[]>([])
  const [nameOverrides, setNameOverrides] = useState(initialSettings.nameOverrides)
  const [categoryMap, setCategoryMap] = useState(initialSettings.categoryMap)
  const [entityOrder, setEntityOrder] = useState(initialSettings.entityOrder)
  const [customCategories, setCustomCategories] = useState(initialSettings.customCategories)
  const [categoryPinHashes, setCategoryPinHashes] = useState(
    initialSettings.categoryPinHashes,
  )
  const [categoryTopText, setCategoryTopText] = useState(initialSettings.categoryTopText)
  const [categoryBottomText, setCategoryBottomText] = useState(
    initialSettings.categoryBottomText,
  )
  const [categoryTopEntities, setCategoryTopEntities] = useState(
    initialSettings.categoryTopEntities,
  )
  const [categoryBottomEntities, setCategoryBottomEntities] = useState(
    initialSettings.categoryBottomEntities,
  )
  const [pendingCategoryPin, setPendingCategoryPin] = useState('')
  const [categoryPinInput, setCategoryPinInput] = useState('')
  const [categoryPinError, setCategoryPinError] = useState('')
  const categoryPinInputRef = useRef<HTMLInputElement | null>(null)
  const [editingCategoryPin, setEditingCategoryPin] = useState('')
  const [categoryPinNew, setCategoryPinNew] = useState('')
  const [categoryPinConfirm, setCategoryPinConfirm] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [sceneButtons, setSceneButtons] = useState(initialSettings.sceneButtons)
  const [showIcons, setShowIcons] = useState(initialSettings.showIcons)
  const [cardWidths, setCardWidths] = useState(initialSettings.cardWidths)
  const [headerEntities, setHeaderEntities] = useState(initialSettings.headerEntities)
  const [lightControls, setLightControls] = useState<
    Record<string, LightControlState>
  >({})
  const [climateControls, setClimateControls] = useState<
    Record<string, ClimateControlState>
  >({})
  const [passwordHash, setPasswordHash] = useState(initialSettings.passwordHash)
  const [settingsUnlocked, setSettingsUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connectionSaving, setConnectionSaving] = useState(false)
  const [entityFilter, setEntityFilter] = useState('')
  const [entityCategoryFilter, setEntityCategoryFilter] = useState('all')
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [serverSettingsAvailable, setServerSettingsAvailable] = useState(true)
  const [stateApiAvailable, setStateApiAvailable] = useState(true)
  const [hasStoredEnabledEntities, setHasStoredEnabledEntities] = useState(false)

  const lightDebounceRef = useRef<Record<string, number>>({})
  const climateDebounceRef = useRef<Record<string, number>>({})
  const saveDebounceRef = useRef<number | null>(null)
  const hasInitializedEntityVisibilityRef = useRef(false)

  const connectionReady = Boolean(token && (isProxyEnabled || haUrl))
  const deferredEntityFilter = useDeferredValue(entityFilter)

  useEffect(() => {
    setConnectionHaUrl(haUrl)
    setConnectionToken(token)
  }, [haUrl, token])

  const resolvePanelViewFromPath = useCallback((): {
    tab: TabKey
    section: MainSection
  } => {
    if (typeof window === 'undefined') {
      return { tab: 'main', section: 'home' }
    }

    const rawPath = window.location.pathname.replace(/\/+$/, '')
    const path = rawPath.length > 0 ? rawPath : '/'

    if (path === '/settings') {
      return { tab: 'settings', section: 'home' }
    }

    if (path === '/scenes') return { tab: 'main', section: 'scenes' }
    if (path.startsWith('/category/')) {
      const categoryName = decodeURIComponent(path.replace('/category/', ''))
      return { tab: 'main', section: `category:${categoryName}` }
    }

    return { tab: 'main', section: 'home' }
  }, [])

  const updateBrowserPath = useCallback(
    (tab: TabKey, section: MainSection, mode: 'push' | 'replace' = 'push') => {
      if (typeof window === 'undefined') return

      const nextPath =
        tab === 'settings'
          ? '/settings'
          : section === 'home'
            ? '/'
            : section === 'scenes'
              ? '/scenes'
              : `/category/${encodeURIComponent(section.replace('category:', ''))}`
      const currentRawPath = window.location.pathname.replace(/\/+$/, '')
      const currentPath = currentRawPath.length > 0 ? currentRawPath : '/'

      if (currentPath === nextPath && mode === 'push') return

      if (mode === 'replace') {
        window.history.replaceState({ panelView: nextPath }, '', nextPath)
        return
      }

      window.history.pushState({ panelView: nextPath }, '', nextPath)
    },
    [],
  )

  const shouldUseLocalHaProxy = useMemo(() => {
    if (typeof window === 'undefined') return false
    return (
      !isProxyEnabled &&
      window.location.protocol === 'https:' &&
      haUrl.startsWith('http://')
    )
  }, [haUrl])

  const hashValue = async (value: string) => {
    const encoder = new TextEncoder()
    const data = encoder.encode(value)
    const subtle = globalThis.crypto?.subtle

    if (subtle) {
      const digest = await subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }

    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(index)
      hash |= 0
    }

    return `fallback-${Math.abs(hash)}`
  }

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      if (!token || (!isProxyEnabled && !haUrl)) {
        throw new Error('Enter Home Assistant URL and token.')
      }

      const baseUrl = isProxyEnabled
        ? ''
        : shouldUseLocalHaProxy
          ? '/ha'
          : haUrl.replace(/\/$/, '')

      const url = `${baseUrl}/api${path}`

      const response = await fetch(url, {
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

      const contentType = response.headers.get('content-type') ?? ''
      const rawText = await response.text()

      if (!contentType.includes('application/json')) {
        throw new Error(
          `Expected JSON from ${baseUrl}/api${path}, received ${
            contentType || 'unknown content type'
          }`,
        )
      }

      try {
        return JSON.parse(rawText) as unknown
      } catch {
        throw new Error(`Invalid JSON from ${baseUrl}/api${path}`)
      }
    },
    [haUrl, shouldUseLocalHaProxy, token],
  )

  const persistPanelSettings = useCallback(
    async (next?: Partial<PanelSettings>) => {
      if (!connectionReady || !settingsLoaded || !serverSettingsAvailable) return

      const payload = {
        enabledEntities,
        nameOverrides,
        categoryMap,
        cardWidths,
        entityOrder,
        customCategories,
        categoryPinHashes,
        categoryTopText,
        categoryBottomText,
        categoryTopEntities,
        categoryBottomEntities,
        sceneButtons,
        showIcons,
        passwordHash,
        headerEntities,
        ...next,
      }

      await apiFetch(settingsApiPath, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    },
    [
      apiFetch,
      cardWidths,
      categoryBottomEntities,
      categoryBottomText,
      categoryMap,
      categoryPinHashes,
      categoryTopEntities,
      categoryTopText,
      connectionReady,
      customCategories,
      enabledEntities,
      entityOrder,
      headerEntities,
      hasStoredEnabledEntities,
      nameOverrides,
      passwordHash,
      sceneButtons,
      serverSettingsAvailable,
      settingsLoaded,
      showIcons,
    ],
  )

  useEffect(() => {
    if (!connectionReady || !settingsLoaded) return

    if (saveDebounceRef.current) {
      window.clearTimeout(saveDebounceRef.current)
    }

    saveDebounceRef.current = window.setTimeout(() => {
      void persistPanelSettings().catch((reason) => {
        const fallback = 'Unable to save server-side settings.'
        const message = reason instanceof Error ? reason.message : fallback
        setStorageError(message)
      })
    }, 500)
  }, [
    cardWidths,
    categoryBottomEntities,
    categoryBottomText,
    categoryMap,
    categoryPinHashes,
    categoryTopEntities,
    categoryTopText,
    connectionReady,
    customCategories,
    enabledEntities,
    entityOrder,
    headerEntities,
    hasStoredEnabledEntities,
    nameOverrides,
    passwordHash,
    persistPanelSettings,
    sceneButtons,
    settingsLoaded,
    showIcons,
  ])

  const saveRuntimeConfig = useCallback(async () => {
    const nextHaUrl = connectionHaUrl.trim()
    const nextToken = connectionToken.trim()

    if (!nextToken || (!isProxyEnabled && !nextHaUrl)) {
      throw new Error('Enter Home Assistant URL and token.')
    }

    const response = await fetch(runtimeConfigApiPath, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        haUrl: nextHaUrl,
        haToken: nextToken,
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Request failed (${response.status})`)
    }

    setHaUrl(nextHaUrl)
    setToken(nextToken)
    setSettingsLoaded(false)
    setServerSettingsAvailable(true)
    setStateApiAvailable(true)
    setConnectionError('')
    setStorageError('')
  }, [connectionHaUrl, connectionToken])

  const handleSaveConnection = useCallback(async () => {
    setConnectionSaving(true)

    try {
      await saveRuntimeConfig()
    } catch (reason) {
      const fallback = 'Unable to save connection settings.'
      const message = reason instanceof Error ? reason.message : fallback
      setConnectionError(message)
    } finally {
      setConnectionSaving(false)
    }
  }, [saveRuntimeConfig])

  const loadPanelSettings = useCallback(async () => {
    if (!connectionReady) return

    try {
      const parsed = (await apiFetch(settingsApiPath)) as Record<string, unknown>
      const hasStoredVisibility = Array.isArray(parsed.enabledEntities)

      hasInitializedEntityVisibilityRef.current = false
      setHasStoredEnabledEntities(hasStoredVisibility)

      if (Array.isArray(parsed.enabledEntities)) {
        setEnabledEntities(parsed.enabledEntities as string[])
      } else if (Array.isArray(parsed.hiddenEntities)) {
        setLegacyHidden(parsed.hiddenEntities as string[])
        setEnabledEntities([])
      } else {
        setEnabledEntities([])
        setLegacyHidden([])
      }

      setNameOverrides(normalizeStringMap(parsed.nameOverrides))
      setCategoryMap(normalizeStringMap(parsed.categoryMap))
      setEntityOrder(normalizeStringArray(parsed.entityOrder))
      setCustomCategories(normalizeStringArray(parsed.customCategories))
      setCategoryPinHashes(normalizeStringMap(parsed.categoryPinHashes))
      setCategoryTopText(normalizeStringMap(parsed.categoryTopText))
      setCategoryBottomText(normalizeStringMap(parsed.categoryBottomText))
      setCategoryTopEntities(normalizeStringArrayMap(parsed.categoryTopEntities))
      setCategoryBottomEntities(normalizeStringArrayMap(parsed.categoryBottomEntities))
      setSceneButtons(normalizeSceneButtons(parsed.sceneButtons))
      setShowIcons(normalizeBooleanMap(parsed.showIcons))
      setCardWidths(normalizeCardWidths(parsed.cardWidths))
      setPasswordHash(
        typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '',
      )
      setHeaderEntities(normalizeHeaderEntityConfig(parsed.headerEntities))
      setSettingsLoaded(true)
      setServerSettingsAvailable(true)
      setStorageError('')
    } catch (reason) {
      setSettingsLoaded(true)
      setServerSettingsAvailable(false)
      const fallback = 'Unable to load settings storage endpoint.'
      const message = reason instanceof Error ? reason.message : fallback
      if (message.includes('Request failed (404)')) {
        setStorageError(
          'Server settings storage unavailable. Global settings cannot be loaded.',
        )
      } else {
        setStorageError(message)
      }
    }
  }, [apiFetch, connectionReady])

  useEffect(() => {
    if (!pendingCategoryPin) return
    categoryPinInputRef.current?.focus()
  }, [pendingCategoryPin])

  const refreshEntities = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true)
        setError('')
      }

      try {
        const data = (await apiFetch('/states')) as HaEntity[]
        startTransition(() => {
          setEntities(data)
          setLastUpdated(new Date().toLocaleTimeString())
        })
        if (!stateApiAvailable) setStateApiAvailable(true)
      } catch (reason) {
        const message =
          reason instanceof Error ? reason.message : 'Unable to fetch entities'
        if (message.includes('Request failed (404)') || message.includes('400')) {
          setStateApiAvailable(false)
          setError(
            'Unable to reach Home Assistant API. Check URL, token, and reverse proxy.',
          )
        } else {
          setError(message)
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [apiFetch, stateApiAvailable],
  )

  const fetchEntityState = useCallback(
    async (entityId: string) => {
      try {
        return (await apiFetch(`/states/${encodeURIComponent(entityId)}`)) as HaEntity
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to fetch entity state'
        if (message.includes('Request failed (404)')) {
          return null
        }

        throw reason
      }
    },
    [apiFetch],
  )

  const mergeEntityRefresh = useCallback((snapshots: Array<HaEntity | null>) => {
    const realizedSnapshots = snapshots.filter((snapshot): snapshot is HaEntity => snapshot !== null)

    if (realizedSnapshots.length === 0) return

    startTransition(() => {
      setEntities((previous) => {
        const snapshotMap = new Map(realizedSnapshots.map((snapshot) => [snapshot.entity_id, snapshot]))
        const next = previous.map((entity) => snapshotMap.get(entity.entity_id) ?? entity)

        realizedSnapshots.forEach((snapshot) => {
          if (!previous.some((entity) => entity.entity_id === snapshot.entity_id)) {
            next.push(snapshot)
          }
        })

        return next
      })
      setLastUpdated(new Date().toLocaleTimeString())
    })
  }, [])

  const forceRefreshEntities = useCallback(
    async (entityIds: string[]) => {
      const uniqueEntityIds = [...new Set(entityIds.filter((entityId) => entityId.trim().length > 0))]

      if (uniqueEntityIds.length === 0) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await refreshEntities(true)
          if (attempt < 2) await waitForRefresh(250)
        }
        return
      }

      const previousStates = new Map(
        uniqueEntityIds.map((entityId) => [
          entityId,
          entities.find((entity) => entity.entity_id === entityId)?.state,
        ]),
      )

      for (let attempt = 0; attempt < 4; attempt += 1) {
        const snapshots = await Promise.all(uniqueEntityIds.map((entityId) => fetchEntityState(entityId)))
        mergeEntityRefresh(snapshots)

        const stateChanged = snapshots.some(
          (snapshot) =>
            snapshot !== null && previousStates.get(snapshot.entity_id) !== snapshot.state,
        )

        if (stateChanged) {
          return
        }

        if (attempt < 3) {
          await waitForRefresh(250)
        }
      }

      await refreshEntities(true)
    },
    [entities, fetchEntityState, mergeEntityRefresh, refreshEntities],
  )

  useEffect(() => {
    if (haUrl && token) {
      setStateApiAvailable(true)
      void refreshEntities(false)
    }
  }, [haUrl, refreshEntities, token])

  useEffect(() => {
    if (connectionReady && !settingsLoaded) {
      void loadPanelSettings()
    }
  }, [connectionReady, loadPanelSettings, settingsLoaded])

  useEffect(() => {
    if (!connectionReady || !stateApiAvailable) return undefined

    const intervalId = window.setInterval(() => {
      void refreshEntities(true)
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [connectionReady, refreshEntities, stateApiAvailable])

  useEffect(() => {
    setLightControls((previous) => {
      const next = { ...previous }
      entities
        .filter((entity) => entity.entity_id.startsWith('light.'))
        .forEach((entity) => {
          if (!next[entity.entity_id]) {
            next[entity.entity_id] = createLightControlFromEntity(entity)
          }
        })
      return next
    })

    setClimateControls((previous) => {
      const next = { ...previous }
      entities
        .filter((entity) => entity.entity_id.startsWith('climate.'))
        .forEach((entity) => {
          if (!next[entity.entity_id]) {
            next[entity.entity_id] = {
              temperature: toNumber(
                entity.attributes.temperature,
                toNumber(entity.attributes.current_temperature, 22),
              ),
              hvacMode:
                typeof entity.attributes.hvac_mode === 'string'
                  ? entity.attributes.hvac_mode
                  : 'auto',
            }
          }
        })
      return next
    })
  }, [entities])

  useEffect(() => {
    if (!modalEntity || !modalEntity.entity_id.startsWith('light.')) return
    const entity =
      entities.find((candidate) => candidate.entity_id === modalEntity.entity_id) ??
      modalEntity

    setLightControls((previous) => ({
      ...previous,
      [entity.entity_id]: createLightControlFromEntity(entity),
    }))
  }, [entities, modalEntity])

  useEffect(() => {
    if (legacyHidden.length === 0) return
    if (hasStoredEnabledEntities) return
    if (entities.length === 0) return

    setEnabledEntities(
      entities
        .map((entity) => entity.entity_id)
        .filter((entityId) => !legacyHidden.includes(entityId)),
    )
    hasInitializedEntityVisibilityRef.current = true
    setHasStoredEnabledEntities(true)
    setLegacyHidden([])
  }, [entities, hasStoredEnabledEntities, legacyHidden])

  useEffect(() => {
    if (entities.length === 0) return
    if (hasInitializedEntityVisibilityRef.current) return
    if (hasStoredEnabledEntities) return
    if (legacyHidden.length > 0) return
    hasInitializedEntityVisibilityRef.current = true
    setHasStoredEnabledEntities(true)
    setEnabledEntities(entities.map((entity) => entity.entity_id))
  }, [entities, hasStoredEnabledEntities, legacyHidden.length])

  useEffect(() => {
    if (entities.length === 0) return

    setEntityOrder((previous) => {
      const knownIds = new Set(previous)
      const next = [...previous]
      entities.forEach((entity) => {
        if (!knownIds.has(entity.entity_id)) {
          next.push(entity.entity_id)
        }
      })
      return next
    })
  }, [entities])

  const runAction = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      try {
        setError('')
        await action()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : fallback)
      }
    },
    [],
  )

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
    const isOn = isEntityActive(entity)
    const service = isOn ? 'turn_off' : 'turn_on'
    await callService(domain, service, { entity_id: entity.entity_id })
    await forceRefreshEntities([entity.entity_id])
  }

  const applyLight = async (entity: HaEntity, controlOverride?: LightControlState) => {
    const control = controlOverride ?? lightControls[entity.entity_id]
    if (!control) return

    const { supportsRgb, supportsKelvin, supportsBrightness } =
      getLightCapabilities(entity)
    const currentColorMode =
      typeof entity.attributes.color_mode === 'string'
        ? entity.attributes.color_mode
        : ''

    const payload: Record<string, unknown> = {
      entity_id: entity.entity_id,
    }

    if (supportsBrightness) payload.brightness = Math.round(control.brightness)

    if (supportsKelvin && !supportsRgb) {
      payload.color_temp_kelvin = Math.round(control.kelvin)
    } else if (currentColorMode === 'color_temp' || currentColorMode === 'kelvin') {
      if (supportsKelvin) payload.color_temp_kelvin = Math.round(control.kelvin)
    } else if (supportsRgb) {
      payload.rgb_color = hexToRgb(control.color)
    } else if (supportsKelvin) {
      payload.color_temp_kelvin = Math.round(control.kelvin)
    }

    await callService('light', 'turn_on', payload)
    await forceRefreshEntities([entity.entity_id])
  }

  const scheduleLightApply = (entity: HaEntity, control: LightControlState) => {
    if (lightDebounceRef.current[entity.entity_id]) {
      window.clearTimeout(lightDebounceRef.current[entity.entity_id])
    }
    lightDebounceRef.current[entity.entity_id] = window.setTimeout(() => {
      void runAction(() => applyLight(entity, control), 'Unable to apply light settings.')
    }, 180)
  }

  const setClimateTemperature = async (entity: HaEntity) => {
    const control = climateControls[entity.entity_id]
    if (!control) return
    await callService('climate', 'set_temperature', {
      entity_id: entity.entity_id,
      temperature: control.temperature,
    })
    await forceRefreshEntities([entity.entity_id])
  }

  const setClimateMode = async (entity: HaEntity) => {
    const control = climateControls[entity.entity_id]
    if (!control) return

    await callService('climate', 'set_hvac_mode', {
      entity_id: entity.entity_id,
      hvac_mode: control.hvacMode,
    })
    await forceRefreshEntities([entity.entity_id])
  }

  const getDisplayName = useCallback(
    (entity: HaEntity) =>
      nameOverrides[entity.entity_id] ??
      ((entity.attributes.friendly_name as string) ?? formatLabel(entity.entity_id)),
    [nameOverrides],
  )

  const resolveEntitySection = useCallback(
    (entity: HaEntity): string | 'hidden' => {
      if (!enabledEntities.includes(entity.entity_id)) return 'hidden'

      const mapped = categoryMap[entity.entity_id]
      if (mapped === 'hidden' || mapped === 'admin') return 'hidden'
      if (mapped && mapped.trim()) return mapped

      return getEntitySectionFromDomain(entity)
    },
    [categoryMap, enabledEntities],
  )

  const orderedEntities = useMemo(() => {
    const orderIndex = new Map(entityOrder.map((entityId, index) => [entityId, index]))

    return [...entities].sort((left, right) => {
      const leftIndex = orderIndex.get(left.entity_id)
      const rightIndex = orderIndex.get(right.entity_id)
      if (leftIndex === undefined && rightIndex === undefined) {
        return left.entity_id.localeCompare(right.entity_id)
      }
      if (leftIndex === undefined) return 1
      if (rightIndex === undefined) return -1
      return leftIndex - rightIndex
    })
  }, [entities, entityOrder])

  const orderedVisibleEntities = useMemo(
    () => orderedEntities.filter((entity) => resolveEntitySection(entity) !== 'hidden'),
    [orderedEntities, resolveEntitySection],
  )

  const filteredEntities = useMemo(() => {
    if (!deferredEntityFilter.trim()) return orderedEntities
    const query = deferredEntityFilter.toLowerCase()
    return orderedEntities.filter((entity) => {
      const name = getDisplayName(entity).toLowerCase()
      return name.includes(query) || entity.entity_id.toLowerCase().includes(query)
    })
  }, [deferredEntityFilter, getDisplayName, orderedEntities])

  const derivedCategoryNames = useMemo(() => {
    const names = new Set<string>()
    orderedEntities.forEach((entity) => {
      const category = resolveEntitySection(entity)
      if (category !== 'hidden') {
        names.add(category)
      }
    })
    return Array.from(names)
  }, [orderedEntities, resolveEntitySection])

  const categoryNames = useMemo(() => {
    const merged = [...customCategories]
    derivedCategoryNames.forEach((name) => {
      if (!merged.includes(name)) merged.push(name)
    })
    return merged
  }, [customCategories, derivedCategoryNames])

  const entityCategoryOptions = useMemo(
    () => ['all', ...categoryNames, ...baseCategoryOptions],
    [categoryNames],
  )

  const settingsFilteredEntities = useMemo(() => {
    if (entityCategoryFilter === 'all') return filteredEntities

    return filteredEntities.filter((entity) => {
      const mappedCategory = resolveEntitySection(entity)
      return mappedCategory === entityCategoryFilter
    })
  }, [entityCategoryFilter, filteredEntities, resolveEntitySection])

  const moveEntityInOrder = useCallback(
    (entityId: string, direction: 'up' | 'down') => {
      setEntityOrder((previous) => {
        const fallbackOrder = entities.map((item) => item.entity_id)
        const knownIds = new Set(previous)
        const normalized = [...previous]

        fallbackOrder.forEach((id) => {
          if (!knownIds.has(id)) {
            normalized.push(id)
          }
        })

        const visibleIds = settingsFilteredEntities.map((item) => item.entity_id)
        const visibleIndex = visibleIds.indexOf(entityId)
        if (visibleIndex < 0) return previous

        const targetVisibleIndex =
          direction === 'up' ? visibleIndex - 1 : visibleIndex + 1
        if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleIds.length) {
          return previous
        }

        const targetId = visibleIds[targetVisibleIndex]
        const sourceIndex = normalized.indexOf(entityId)
        const targetIndex = normalized.indexOf(targetId)
        if (sourceIndex < 0 || targetIndex < 0) return previous

        const next = [...normalized]
        ;[next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]]
        return next
      })
    },
    [entities, settingsFilteredEntities],
  )

  const temperatureSensor = useMemo(
    () =>
      entities.find((entity) => entity.entity_id === headerEntities.temperatureEntityId) ??
      entities.find((entity) => entity.entity_id === 'sensor.ir_remote_temperature') ??
      entities.find((entity) => entity.attributes.device_class === 'temperature'),
    [entities, headerEntities.temperatureEntityId],
  )

  const humiditySensor = useMemo(
    () =>
      entities.find((entity) => entity.entity_id === headerEntities.humidityEntityId) ??
      entities.find((entity) => entity.entity_id === 'sensor.ir_remote_humidity') ??
      entities.find((entity) => entity.attributes.device_class === 'humidity'),
    [entities, headerEntities.humidityEntityId],
  )

  const doorContactSensor = useMemo(
    () =>
      entities.find((entity) => entity.entity_id === headerEntities.doorContactEntityId) ??
      entities.find(
        (entity) => entity.entity_id === 'binary_sensor.studio_intercom_door_contact',
      ) ??
      entities.find(
        (entity) =>
          entity.entity_id.startsWith('binary_sensor.') &&
          ['door', 'opening', 'garage_door'].includes(
            String(entity.attributes.device_class ?? ''),
          ),
      ),
    [entities, headerEntities.doorContactEntityId],
  )

  const doorIsOpen = useMemo(() => {
    if (!doorContactSensor) return false
    return ['on', 'open', 'unlocked'].includes(doorContactSensor.state)
  }, [doorContactSensor])

  const activeCategoryName = useMemo(
    () =>
      mainSection.startsWith('category:')
        ? mainSection.replace('category:', '')
        : '',
    [mainSection],
  )

  const sectionEntities = useMemo(() => {
    if (!activeCategoryName) return []
    return orderedVisibleEntities.filter(
      (entity) => resolveEntitySection(entity) === activeCategoryName,
    )
  }, [activeCategoryName, orderedVisibleEntities, resolveEntitySection])

  useEffect(() => {
    if (customCategories.length > 0) return
    if (derivedCategoryNames.length === 0) return
    setCustomCategories(derivedCategoryNames)
  }, [customCategories.length, derivedCategoryNames])

  const sceneEntries = useMemo(
    () => sceneButtons.filter((scene) => scene.id.trim() && scene.label.trim()),
    [sceneButtons],
  )

  const temperatureHeaderValue =
    temperatureSensor?.state && temperatureSensor.state !== 'unknown'
      ? `${temperatureSensor.state}${
          getMeasurementUnit(temperatureSensor) ||
          (String(temperatureSensor.attributes.device_class) === 'temperature' ? '°' : '')
        }`
      : '--'

  const humidityHeaderValue =
    humiditySensor?.state && humiditySensor.state !== 'unknown'
      ? `${humiditySensor.state}${getMeasurementUnit(humiditySensor) || '%'}`
      : '--'

  const temperatureEntityOptions = useMemo(
    () =>
      orderedEntities.filter(
        (entity) =>
          entity.entity_id.startsWith('sensor.') ||
          String(entity.attributes.device_class) === 'temperature',
      ),
    [orderedEntities],
  )

  const humidityEntityOptions = useMemo(
    () =>
      orderedEntities.filter(
        (entity) =>
          entity.entity_id.startsWith('sensor.') ||
          String(entity.attributes.device_class) === 'humidity',
      ),
    [orderedEntities],
  )

  const doorContactEntityOptions = useMemo(
    () =>
      orderedEntities.filter(
        (entity) =>
          entity.entity_id.startsWith('binary_sensor.') ||
          String(entity.attributes.device_class).includes('door') ||
          String(entity.attributes.device_class) === 'opening',
      ),
    [orderedEntities],
  )

  const doorActionEntityOptions = useMemo(
    () =>
      orderedEntities.filter((entity) => {
        const domain = entity.entity_id.split('.')[0]
        return ['button', 'switch', 'script', 'lock', 'input_button'].includes(domain)
      }),
    [orderedEntities],
  )

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
    hasInitializedEntityVisibilityRef.current = true
    setHasStoredEnabledEntities(true)
    setEnabledEntities((previous) =>
      previous.includes(entityId)
        ? previous.filter((current) => current !== entityId)
        : [...previous, entityId],
    )
  }

  const triggerDoorAction = async () => {
    const selected = headerEntities.doorActionEntityId || 'button.studio_intercom_open_door'
    const domain = selected.split('.')[0]
    const refreshTargets = [selected, headerEntities.doorContactEntityId].filter(
      (entityId): entityId is string => Boolean(entityId),
    )

    if (domain === 'button') {
      await callService('button', 'press', { entity_id: selected })
      await forceRefreshEntities(refreshTargets)
      return
    }

    if (['switch', 'input_boolean', 'light'].includes(domain)) {
      await callService(domain, 'turn_on', { entity_id: selected })
      await forceRefreshEntities(refreshTargets)
      return
    }

    await callService('homeassistant', 'turn_on', { entity_id: selected })
    await forceRefreshEntities(refreshTargets)
  }

  const toMdiClass = (iconValue: unknown) => {
    if (typeof iconValue !== 'string' || iconValue.trim().length === 0) {
      return ''
    }

    if (iconValue.startsWith('mdi:')) {
      return `mdi-${iconValue.slice(4)}`
    }

    if (iconValue.startsWith('mdi-')) {
      return iconValue
    }

    return ''
  }

  const getEntityIcon = (entity: HaEntity) => {
    const configured = toMdiClass(entity.attributes.icon)
    if (configured) return configured

    const domain = entity.entity_id.split('.')[0]
    const deviceClass = String(entity.attributes.device_class ?? '')

    if (domain === 'light') return 'mdi-lightbulb'
    if (domain === 'climate') return 'mdi-thermostat'
    if (domain === 'switch') return 'mdi-toggle-switch-variant'
    if (domain === 'scene' || domain === 'script') return 'mdi-play-circle-outline'
    if (domain === 'cover') return 'mdi-window-shutter'
    if (domain === 'alarm_control_panel') return 'mdi-shield-home'
    if (domain === 'lock') return entity.state === 'locked' ? 'mdi-lock' : 'mdi-lock-open-variant'
    if (domain === 'binary_sensor') {
      if (['door', 'opening', 'garage_door'].includes(deviceClass)) {
        return entity.state === 'on' ? 'mdi-door-open' : 'mdi-door-closed'
      }
      if (deviceClass === 'motion') return 'mdi-motion-sensor'
      if (deviceClass === 'window') return 'mdi-window-closed-variant'
      return 'mdi-radar'
    }

    return 'mdi-help-circle-outline'
  }

  const renderInlineItems = (categoryName: string, position: 'top' | 'bottom') => {
    const entityIds =
      position === 'top'
        ? categoryTopEntities[categoryName] ?? []
        : categoryBottomEntities[categoryName] ?? []
    const textValue =
      position === 'top'
        ? categoryTopText[categoryName] ?? ''
        : categoryBottomText[categoryName] ?? ''

    return (
      <div className="category-inline-bar">
        {textValue.trim() ? <span className="header-inline-metric">{textValue}</span> : null}
        {entityIds.map((entityId) => {
          const entity = entities.find((item) => item.entity_id === entityId)
          if (!entity) return null
          return (
            <span key={`${position}-${entityId}`} className="header-inline-metric">
              {getDisplayName(entity)}: {entity.state}
              {getMeasurementUnit(entity)}
            </span>
          )
        })}
      </div>
    )
  }

  const openCategorySection = useCallback(
    async (categoryName: string) => {
      const pinHash = categoryPinHashes[categoryName] ?? ''
      if (!pinHash) {
        setActiveTab('main')
        setMainSection(`category:${categoryName}`)
        updateBrowserPath('main', `category:${categoryName}`)
        return
      }

      setPendingCategoryPin(categoryName)
      setCategoryPinInput('')
      setCategoryPinError('')
    },
    [categoryPinHashes, updateBrowserPath],
  )

  const submitCategoryPin = useCallback(async () => {
    if (!pendingCategoryPin) return
    if (categoryPinInput.length < 4) {
      setCategoryPinError('Enter at least 4 digits.')
      return
    }

    const hash = await hashValue(categoryPinInput)
    if (hash !== (categoryPinHashes[pendingCategoryPin] ?? '')) {
      setCategoryPinError('Incorrect PIN.')
      setCategoryPinInput('')
      return
    }

    const categoryName = pendingCategoryPin
    setPendingCategoryPin('')
    setCategoryPinInput('')
    setCategoryPinError('')
    setActiveTab('main')
    setMainSection(`category:${categoryName}`)
    updateBrowserPath('main', `category:${categoryName}`)
  }, [categoryPinHashes, categoryPinInput, hashValue, pendingCategoryPin, updateBrowserPath])

  const openSection = useCallback(
    (section: MainSection) => {
      setActiveTab('main')
      setMainSection(section)
      updateBrowserPath('main', section)
    },
    [updateBrowserPath],
  )

  const openSettings = useCallback(() => {
    setActiveTab('settings')
    setMainSection('home')
    updateBrowserPath('settings', 'home')
  }, [updateBrowserPath])

  useEffect(() => {
    const initialView = resolvePanelViewFromPath()
    setActiveTab(initialView.tab)
    setMainSection(initialView.section)
    updateBrowserPath(initialView.tab, initialView.section, 'replace')
  }, [resolvePanelViewFromPath, updateBrowserPath])

  useEffect(() => {
    const onPopState = () => {
      setSidePanelOpen(false)
      setModalEntity(null)

      const view = resolvePanelViewFromPath()
      setActiveTab(view.tab)
      setMainSection(view.section)
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [resolvePanelViewFromPath])

  const renderEntityButton = (entity: HaEntity) => {
    const domain = entity.entity_id.split('.')[0]
    const isActive = isEntityActive(entity)
    const supportsAdvanced = domain === 'light' || domain === 'climate'
    const needsWallSwitchWarning =
      (entity.entity_id === 'light.desk_light' ||
        entity.entity_id === 'light.couch_light') &&
      entity.state === 'unavailable'
    const showEntityIcon = showIcons[entity.entity_id] !== false
    const targetTemperature = entity.attributes.temperature
    const hasTargetTemperature =
      typeof targetTemperature === 'number' ||
      (typeof targetTemperature === 'string' && targetTemperature.trim().length > 0)
    const cardSubtitle =
      domain === 'climate' && isActive && hasTargetTemperature
        ? `Set ${targetTemperature}${
            typeof entity.attributes.temperature_unit === 'string'
              ? entity.attributes.temperature_unit
              : '°'
          }`
        : getDisplayState(entity)
    const isDouble = (cardWidths[entity.entity_id] ?? 'single') === 'double'

    return (
      <article
        key={entity.entity_id}
        className={`device-card ${isActive ? 'on' : ''}${isDouble ? ' card-double' : ''}${needsWallSwitchWarning ? ' unavailable-warning' : ''}`}
      >
        <button
          className="device-surface"
          disabled={needsWallSwitchWarning}
          onClick={() => {
            if (needsWallSwitchWarning) return
            void runAction(() => toggleEntity(entity), 'Unable to toggle entity.')
          }}
        >
          <div className="card-main">
            {showEntityIcon ? (
              <div className="entity-icon" aria-hidden="true">
                <span className={`mdi ${getEntityIcon(entity)}`} />
              </div>
            ) : null}
            <div className="card-title">{getDisplayName(entity)}</div>
            <div className="card-sub">{cardSubtitle}</div>
          </div>
        </button>
        {supportsAdvanced ? (
          <div className="device-actions">
            <button
              className="ghost"
              disabled={needsWallSwitchWarning}
              onClick={() => setModalEntity(entity)}
            >
              Adjust
            </button>
          </div>
        ) : null}
        {needsWallSwitchWarning ? (
          <div className="unavailable-overlay">Check that wall switch is on!</div>
        ) : null}
      </article>
    )
  }

  const renderModalContent = (entity: HaEntity) => {
    const domain = entity.entity_id.split('.')[0]

    if (domain === 'light') {
      const control = lightControls[entity.entity_id]
      const { supportsRgb, supportsKelvin, supportsBrightness } =
        getLightCapabilities(entity)
      const { minKelvin, maxKelvin } = getEntityKelvinBounds(entity)
      const brightnessPercent = control
        ? Math.round((control.brightness / 255) * 100)
        : 0

      return (
        <div className="modal-body">
          <div className="modal-actions">
            <button
              className="toggle"
              onClick={() => {
                void runAction(() => toggleEntity(entity), 'Unable to toggle light.')
              }}
            >
              {isEntityActive(entity) ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          {supportsBrightness ? (
            <div className="control-row">
              <label>Brightness</label>
              <input
                type="range"
                className="slider-input"
                min={1}
                max={255}
                value={control?.brightness ?? 180}
                style={{ ['--slider-color' as string]: control?.color ?? '#f0d9a4' }}
                onChange={(event) => {
                  const nextControl: LightControlState = {
                    brightness: Number(event.target.value),
                    color: control?.color ?? '#ffffff',
                    kelvin: control?.kelvin ?? getEntityKelvin(entity),
                  }

                  setLightControls((previous) => ({
                    ...previous,
                    [entity.entity_id]: nextControl,
                  }))
                  scheduleLightApply(entity, nextControl)
                }}
              />
              <span className="value">{brightnessPercent}%</span>
            </div>
          ) : null}

          {supportsRgb ? (
            <div className="control-row control-row-inline">
              <label>Color</label>
              <input
                className="color-input"
                type="color"
                value={control?.color ?? '#ffffff'}
                onChange={(event) => {
                  const nextControl: LightControlState = {
                    brightness: control?.brightness ?? 180,
                    color: event.target.value,
                    kelvin: control?.kelvin ?? getEntityKelvin(entity),
                  }

                  setLightControls((previous) => ({
                    ...previous,
                    [entity.entity_id]: nextControl,
                  }))
                  scheduleLightApply(entity, nextControl)
                }}
              />
            </div>
          ) : null}

          {supportsKelvin ? (
            <div className="control-row">
              <label>Temperature</label>
              <input
                type="range"
                className="slider-input"
                min={minKelvin}
                max={maxKelvin}
                step={50}
                value={control?.kelvin ?? getEntityKelvin(entity)}
                onChange={(event) => {
                  const nextControl: LightControlState = {
                    brightness: control?.brightness ?? 180,
                    color: control?.color ?? '#ffffff',
                    kelvin: Number(event.target.value),
                  }

                  setLightControls((previous) => ({
                    ...previous,
                    [entity.entity_id]: nextControl,
                  }))
                  scheduleLightApply(entity, nextControl)
                }}
              />
              <span className="value">{Math.round(control?.kelvin ?? getEntityKelvin(entity))}K</span>
            </div>
          ) : null}
        </div>
      )
    }

    if (domain === 'climate') {
      const control = climateControls[entity.entity_id]
      const minTemp = toNumber(entity.attributes.min_temp, 16)
      const maxTemp = toNumber(entity.attributes.max_temp, 30)
      const currentTemp = toNumber(
        entity.attributes.current_temperature,
        control?.temperature ?? 22,
      )
      const hvacModes = Array.isArray(entity.attributes.hvac_modes)
        ? (entity.attributes.hvac_modes as string[])
        : climateModeFallback

      return (
        <div className="modal-body">
          <div className="modal-actions">
            <button
              className="toggle"
              onClick={() => {
                void runAction(() => toggleEntity(entity), 'Unable to toggle climate.')
              }}
            >
              {entity.state === 'off' ? 'Turn on' : 'Turn off'}
            </button>
            <button
              className="primary"
              onClick={() => {
                void runAction(
                  () => setClimateTemperature(entity),
                  'Unable to set temperature.',
                )
              }}
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
                setClimateControls((previous) => ({
                  ...previous,
                  [entity.entity_id]: {
                    temperature: Number(event.target.value),
                    hvacMode: previous[entity.entity_id]?.hvacMode ?? 'auto',
                  },
                }))
              }
              onPointerUp={() => {
                if (climateDebounceRef.current[entity.entity_id]) {
                  window.clearTimeout(climateDebounceRef.current[entity.entity_id])
                }
                climateDebounceRef.current[entity.entity_id] = window.setTimeout(() => {
                  void runAction(
                    () => setClimateTemperature(entity),
                    'Unable to set temperature.',
                  )
                }, 350)
              }}
            />
            <span className="value">{control?.temperature ?? currentTemp}°</span>
          </div>

          <div className="control-row">
            <label>Mode</label>
            <select
              value={control?.hvacMode ?? 'auto'}
              onChange={(event) =>
                setClimateControls((previous) => ({
                  ...previous,
                  [entity.entity_id]: {
                    temperature: previous[entity.entity_id]?.temperature ?? currentTemp,
                    hvacMode: event.target.value,
                  },
                }))
              }
            >
              {hvacModes.map((mode) => (
                <option key={mode} value={mode}>
                  {formatLabel(mode)}
                </option>
              ))}
            </select>
            <button
              className="ghost"
              onClick={() => {
                void runAction(() => setClimateMode(entity), 'Unable to set mode.')
              }}
            >
              Set mode
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="modal-body">
        <button
          className="toggle"
          onClick={() => {
            void runAction(() => toggleEntity(entity), 'Unable to toggle entity.')
          }}
        >
          {isEntityActive(entity) ? 'Turn off' : 'Turn on'}
        </button>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className={`side-panel ${sidePanelOpen ? 'open' : ''}`}>
        <div className="brand">Studio Panel</div>
        <button
          className={`side-nav ${activeTab === 'main' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('main')
            openSection('home')
            setSidePanelOpen(false)
          }}
        >
          Main
        </button>
        <button
          className={`side-nav ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => {
            openSettings()
            setSidePanelOpen(false)
          }}
        >
          Settings
        </button>
      </aside>
      {sidePanelOpen ? (
        <button
          className="side-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidePanelOpen(false)}
        />
      ) : null}

      <main className="main-content">
        <header className="top-header">
          <button
            className="ghost menu-btn"
            aria-label="Toggle navigation"
            onClick={() => setSidePanelOpen((previous) => !previous)}
          >
            ☰
          </button>
          <button
            className="primary door-btn highlighted"
            onClick={() => {
              void runAction(() => triggerDoorAction(), 'Unable to trigger door button.')
            }}
            disabled={!connectionReady}
          >
            <span className="door-key">🔑</span>
            Open
          </button>
          <div className="header-metrics-stack">
            <span className="header-inline-metric">
              <span className="mdi mdi-thermometer" aria-hidden="true" />
              {temperatureHeaderValue}
            </span>
            <span className="header-inline-metric">
              <span className="mdi mdi-water-percent" aria-hidden="true" />
              {humidityHeaderValue}
            </span>
          </div>
          <span
            className={`door-inline-icon ${doorIsOpen ? 'open' : 'closed'}`}
            title={doorContactSensor ? getDisplayState(doorContactSensor) : 'Door status unavailable'}
          >
            <span className={`mdi ${doorIsOpen ? 'mdi-door-open' : 'mdi-door-closed'}`} aria-hidden="true" />
          </span>
        </header>

        {error ? <div className="error">{error}</div> : null}

        {activeTab === 'main' ? (
          <section className={`panel-body ${mainSection === 'home' ? 'home-mode' : ''}`}>
            {mainSection === 'home' ? (
              <div className="section-grid">
                {categoryNames.map((categoryName) => (
                  <button
                    key={categoryName}
                    className="hub-button"
                    onClick={() => {
                      void openCategorySection(categoryName)
                    }}
                  >
                    {categoryName}
                  </button>
                ))}
                {sceneEntries.length > 0 ? (
                  <button className="hub-button" onClick={() => openSection('scenes')}>
                    Scenes
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="section-head">
                  <h2>
                    {mainSection === 'scenes'
                      ? 'Scenes'
                      : mainSection.startsWith('category:')
                        ? activeCategoryName
                        : formatLabel(mainSection)}
                  </h2>
                  <button
                    className="ghost section-back-top"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.history.back()
                      }
                    }}
                  >
                    Back
                  </button>
                </div>

                {mainSection === 'scenes' ? (
                  <div className="cards">
                    {sceneEntries.map((scene) => (
                      <button
                        key={scene.id}
                        className="scene-button"
                        onClick={() => {
                          void runAction(
                            async () => {
                              await callService('automation', 'trigger', {
                                entity_id: scene.id,
                              })
                              await forceRefreshEntities([])
                            },
                            'Unable to trigger scene.',
                          )
                        }}
                      >
                        {scene.label}
                      </button>
                    ))}
                    {sceneEntries.length === 0 ? (
                      <div className="empty">No configured scenes yet.</div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {activeCategoryName ? renderInlineItems(activeCategoryName, 'top') : null}
                    <div className="cards">
                      {sectionEntities.map(renderEntityButton)}
                      {sectionEntities.length === 0 ? (
                        <div className="empty">No entities in this section.</div>
                      ) : null}
                    </div>
                    {activeCategoryName ? renderInlineItems(activeCategoryName, 'bottom') : null}
                  </>
                )}

                <button
                  className="primary back-button-bottom"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.history.back()
                    }
                  }}
                >
                  Back
                </button>
              </>
            )}
          </section>
        ) : null}

        {pendingCategoryPin ? (
          <section className="admin-keypad-screen">
            <div className="keypad-title">{pendingCategoryPin} PIN</div>
            <input
              ref={categoryPinInputRef}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={categoryPinInput}
              onChange={(event) => setCategoryPinInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void submitCategoryPin()
              }}
              placeholder="Enter category PIN"
            />
            {categoryPinError ? <div className="keypad-error">{categoryPinError}</div> : null}
            <button className="primary" onClick={() => void submitCategoryPin()}>
              Open category
            </button>
            <button
              className="ghost"
              onClick={() => {
                setPendingCategoryPin('')
                setCategoryPinInput('')
                setCategoryPinError('')
              }}
            >
              Cancel
            </button>
          </section>
        ) : null}

        {activeTab === 'settings' ? (
          <section className="settings-panel">
            {!settingsUnlocked ? (
              <div className="settings-lock">
                <label>{passwordHash ? 'Enter password' : 'Create password'}</label>
                <input
                  type="password"
                  name="settings_unlock_password"
                  autoComplete="current-password"
                  value={passwordHash ? passwordInput : newPassword}
                  onChange={(event) =>
                    passwordHash
                      ? setPasswordInput(event.target.value)
                      : setNewPassword(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void handleUnlock()
                  }}
                />
                <button className="primary" onClick={() => void handleUnlock()}>
                  {passwordHash ? 'Unlock' : 'Save password'}
                </button>
                {settingsError ? <div className="error-inline">{settingsError}</div> : null}
              </div>
            ) : (
              <div className="settings-body">
                <div className="settings-section">
                  <h2>Connection</h2>
                  <input
                    type="url"
                    name="ha_url"
                    autoComplete="url"
                    placeholder="https://homeassistant.local:8123"
                    value={connectionHaUrl}
                    onChange={(event) => setConnectionHaUrl(event.target.value)}
                  />
                  <input
                    type="password"
                    name="ha_token"
                    autoComplete="off"
                    placeholder="Long-lived token"
                    value={connectionToken}
                    onChange={(event) => setConnectionToken(event.target.value)}
                  />
                  <button
                    className="primary"
                    onClick={() => {
                      void handleSaveConnection()
                    }}
                    disabled={connectionSaving}
                  >
                    {connectionSaving ? 'Saving…' : 'Save & connect'}
                  </button>
                  {connectionError ? <div className="error-inline">{connectionError}</div> : null}
                  {storageError ? <div className="error-inline">{storageError}</div> : null}
                  <div className="hint">
                    Connection settings are stored in the container runtime config. Panel layout and password are stored in Home Assistant.
                  </div>
                  <div className="hint">Last sync: {lastUpdated || 'not synced yet'}</div>
                </div>

                <div className="settings-section">
                  <h2>Header entities</h2>
                  <div className="compact-grid">
                    <label className="compact-label">
                      Temperature
                      <select
                        value={headerEntities.temperatureEntityId}
                        onChange={(event) =>
                          setHeaderEntities((previous) => ({
                            ...previous,
                            temperatureEntityId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Auto detect</option>
                        {temperatureEntityOptions.map((entity) => (
                          <option key={entity.entity_id} value={entity.entity_id}>
                            {getDisplayName(entity)} ({entity.entity_id})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="compact-label">
                      Humidity
                      <select
                        value={headerEntities.humidityEntityId}
                        onChange={(event) =>
                          setHeaderEntities((previous) => ({
                            ...previous,
                            humidityEntityId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Auto detect</option>
                        {humidityEntityOptions.map((entity) => (
                          <option key={entity.entity_id} value={entity.entity_id}>
                            {getDisplayName(entity)} ({entity.entity_id})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="compact-label">
                      Door contact
                      <select
                        value={headerEntities.doorContactEntityId}
                        onChange={(event) =>
                          setHeaderEntities((previous) => ({
                            ...previous,
                            doorContactEntityId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Auto detect</option>
                        {doorContactEntityOptions.map((entity) => (
                          <option key={entity.entity_id} value={entity.entity_id}>
                            {getDisplayName(entity)} ({entity.entity_id})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="compact-label">
                      Open door action
                      <select
                        value={headerEntities.doorActionEntityId}
                        onChange={(event) =>
                          setHeaderEntities((previous) => ({
                            ...previous,
                            doorActionEntityId: event.target.value,
                          }))
                        }
                      >
                        <option value="">button.studio_intercom_open_door</option>
                        {doorActionEntityOptions.map((entity) => (
                          <option key={entity.entity_id} value={entity.entity_id}>
                            {getDisplayName(entity)} ({entity.entity_id})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="settings-section">
                  <h2>Categories</h2>
                  <div className="compact-grid">
                    <input
                      type="text"
                      value={newCategoryName}
                      placeholder="New category name"
                      onChange={(event) => setNewCategoryName(event.target.value)}
                    />
                    <button
                      className="ghost"
                      onClick={() => {
                        const next = newCategoryName.trim()
                        if (!next || customCategories.includes(next)) return
                        setCustomCategories((previous) => [...previous, next])
                        setNewCategoryName('')
                      }}
                    >
                      Add category
                    </button>
                  </div>

                  <div className="entity-list compact-list">
                    {categoryNames.map((categoryName, index) => (
                      <div key={categoryName} className="entity-row compact">
                        <div className="entity-mini-name">{categoryName}</div>
                        <div className="entity-controls compact-controls">
                          <button
                            className="ghost"
                            onClick={() =>
                              setCustomCategories((previous) => {
                                if (index <= 0) return previous
                                const next = [...previous]
                                ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                                return next
                              })
                            }
                          >
                            ▲
                          </button>
                          <button
                            className="ghost"
                            onClick={() =>
                              setCustomCategories((previous) => {
                                if (index >= previous.length - 1) return previous
                                const next = [...previous]
                                ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                                return next
                              })
                            }
                          >
                            ▼
                          </button>
                          {editingCategoryPin === categoryName ? (
                            <>
                              <input
                                type="password"
                                placeholder="New PIN (≥4 chars)"
                                value={categoryPinNew}
                                autoFocus
                                onChange={(e) => setCategoryPinNew(e.target.value)}
                              />
                              <input
                                type="password"
                                placeholder="Confirm PIN"
                                value={categoryPinConfirm}
                                onChange={(e) => setCategoryPinConfirm(e.target.value)}
                              />
                              <button
                                className="ghost"
                                disabled={
                                  categoryPinNew.length < 4 ||
                                  categoryPinNew !== categoryPinConfirm
                                }
                                onClick={() => {
                                  if (
                                    categoryPinNew.length < 4 ||
                                    categoryPinNew !== categoryPinConfirm
                                  )
                                    return
                                  void hashValue(categoryPinNew).then((hash) => {
                                    setCategoryPinHashes((previous) => ({
                                      ...previous,
                                      [categoryName]: hash,
                                    }))
                                    setEditingCategoryPin('')
                                    setCategoryPinNew('')
                                    setCategoryPinConfirm('')
                                  })
                                }}
                              >
                                Save PIN
                              </button>
                              <button
                                className="ghost"
                                onClick={() => {
                                  setEditingCategoryPin('')
                                  setCategoryPinNew('')
                                  setCategoryPinConfirm('')
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className={`ghost ${categoryPinHashes[categoryName] ? 'on' : ''}`}
                                onClick={() => setEditingCategoryPin(categoryName)}
                              >
                                {categoryPinHashes[categoryName] ? 'PIN set' : 'Set PIN'}
                              </button>
                              {categoryPinHashes[categoryName] && (
                                <button
                                  className="ghost"
                                  onClick={() =>
                                    setCategoryPinHashes((previous) => ({
                                      ...previous,
                                      [categoryName]: '',
                                    }))
                                  }
                                >
                                  Clear PIN
                                </button>
                              )}
                            </>
                          )}
                          <button
                            className="ghost"
                            onClick={() => {
                              setCustomCategories((previous) =>
                                previous.filter((item) => item !== categoryName),
                              )
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        <div className="compact-grid">
                          <input
                            type="text"
                            placeholder="Top text"
                            value={categoryTopText[categoryName] ?? ''}
                            onChange={(event) =>
                              setCategoryTopText((previous) => ({
                                ...previous,
                                [categoryName]: event.target.value,
                              }))
                            }
                          />
                          <input
                            type="text"
                            placeholder="Bottom text"
                            value={categoryBottomText[categoryName] ?? ''}
                            onChange={(event) =>
                              setCategoryBottomText((previous) => ({
                                ...previous,
                                [categoryName]: event.target.value,
                              }))
                            }
                          />
                          <select
                            value=""
                            onChange={(event) => {
                              const entityId = event.target.value
                              if (!entityId) return
                              setCategoryTopEntities((previous) => ({
                                ...previous,
                                [categoryName]: [
                                  ...(previous[categoryName] ?? []),
                                  entityId,
                                ].filter((id, i, arr) => arr.indexOf(id) === i),
                              }))
                            }}
                          >
                            <option value="">Add top inline entity</option>
                            {orderedEntities.map((entity) => (
                              <option key={entity.entity_id} value={entity.entity_id}>
                                {getDisplayName(entity)}
                              </option>
                            ))}
                          </select>
                          <select
                            value=""
                            onChange={(event) => {
                              const entityId = event.target.value
                              if (!entityId) return
                              setCategoryBottomEntities((previous) => ({
                                ...previous,
                                [categoryName]: [
                                  ...(previous[categoryName] ?? []),
                                  entityId,
                                ].filter((id, i, arr) => arr.indexOf(id) === i),
                              }))
                            }}
                          >
                            <option value="">Add bottom inline entity</option>
                            {orderedEntities.map((entity) => (
                              <option key={entity.entity_id} value={entity.entity_id}>
                                {getDisplayName(entity)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="entity-controls compact-controls">
                          {(categoryTopEntities[categoryName] ?? []).map((entityId) => (
                            <button
                              key={`top-${categoryName}-${entityId}`}
                              className="ghost"
                              onClick={() =>
                                setCategoryTopEntities((previous) => ({
                                  ...previous,
                                  [categoryName]: (previous[categoryName] ?? []).filter(
                                    (item) => item !== entityId,
                                  ),
                                }))
                              }
                            >
                              Top: {entityId} ✕
                            </button>
                          ))}
                          {(categoryBottomEntities[categoryName] ?? []).map((entityId) => (
                            <button
                              key={`bottom-${categoryName}-${entityId}`}
                              className="ghost"
                              onClick={() =>
                                setCategoryBottomEntities((previous) => ({
                                  ...previous,
                                  [categoryName]: (previous[categoryName] ?? []).filter(
                                    (item) => item !== entityId,
                                  ),
                                }))
                              }
                            >
                              Bottom: {entityId} ✕
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="settings-section">
                  <h2>Entities</h2>
                  <div className="compact-grid">
                    <input
                      type="text"
                      name="entity_filter"
                      autoComplete="off"
                      placeholder="Filter entities"
                      value={entityFilter}
                      onChange={(event) => setEntityFilter(event.target.value)}
                    />
                    <select
                      value={entityCategoryFilter}
                      onChange={(event) => setEntityCategoryFilter(event.target.value)}
                    >
                      {entityCategoryOptions.map((categoryOption) => (
                        <option key={categoryOption} value={categoryOption}>
                          {categoryOption === 'all'
                            ? 'All categories'
                            : formatLabel(categoryOption)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bulk-actions">
                    <button
                      className="ghost"
                      onClick={() => {
                        hasInitializedEntityVisibilityRef.current = true
                        setHasStoredEnabledEntities(true)
                        setEnabledEntities(entities.map((item) => item.entity_id))
                      }}
                    >
                      Enable all
                    </button>
                    <button
                      className="ghost"
                      onClick={() => {
                        hasInitializedEntityVisibilityRef.current = true
                        setHasStoredEnabledEntities(true)
                        setEnabledEntities([])
                      }}
                    >
                      Disable all
                    </button>
                  </div>
                  <div className="entity-list compact-list">
                    {settingsFilteredEntities.map((entity) => {
                      const hiddenByVisibility = !enabledEntities.includes(entity.entity_id)
                      const category =
                        categoryMap[entity.entity_id] ?? getEntitySectionFromDomain(entity)
                      const hiddenByCategory = category === 'hidden'
                      const isHidden = hiddenByVisibility || hiddenByCategory
                      return (
                        <div key={entity.entity_id} className="entity-row compact">
                          <div className="entity-mini-name">{getDisplayName(entity)}</div>
                          <div className="entity-mini-id">{entity.entity_id}</div>
                          <div className="entity-controls compact-controls">
                            <input
                              type="text"
                              name={`custom_name_${entity.entity_id}`}
                              autoComplete="off"
                              placeholder="Name"
                              value={nameOverrides[entity.entity_id] ?? ''}
                              onChange={(event) =>
                                setNameOverrides((previous) => ({
                                  ...previous,
                                  [entity.entity_id]: event.target.value,
                                }))
                              }
                            />
                            <select
                              value={category}
                              onChange={(event) => {
                                const nextCategory = event.target.value
                                setCategoryMap((previous) => ({
                                  ...previous,
                                  [entity.entity_id]: nextCategory,
                                }))
                                if (nextCategory === 'hidden') {
                                  hasInitializedEntityVisibilityRef.current = true
                                  setEnabledEntities((previous) =>
                                    previous.filter((current) => current !== entity.entity_id),
                                  )
                                }
                              }}
                            >
                              {[...categoryNames, ...baseCategoryOptions].map((categoryOption) => (
                                <option key={categoryOption} value={categoryOption}>
                                  {formatLabel(categoryOption)}
                                </option>
                              ))}
                            </select>
                            <button
                              className={`ghost icon-toggle ${showIcons[entity.entity_id] !== false ? 'on' : ''}`}
                              onClick={() =>
                                setShowIcons((previous) => ({
                                  ...previous,
                                  [entity.entity_id]: !(previous[entity.entity_id] !== false),
                                }))
                              }
                            >
                              Icon
                            </button>
                            <button
                              className={`toggle ${isHidden ? '' : 'on'}`}
                              onClick={() => {
                                const defaultCategory =
                                  categoryNames[0] ?? getEntitySectionFromDomain(entity)

                                if (isHidden) {
                                  hasInitializedEntityVisibilityRef.current = true
                                  setEnabledEntities((previous) =>
                                    previous.includes(entity.entity_id)
                                      ? previous
                                      : [...previous, entity.entity_id],
                                  )

                                  if (category === 'hidden') {
                                    setCategoryMap((previous) => ({
                                      ...previous,
                                      [entity.entity_id]: defaultCategory,
                                    }))
                                  }
                                  return
                                }

                                toggleVisibility(entity.entity_id)
                              }}
                            >
                              {isHidden ? 'Hidden' : 'Shown'}
                            </button>
                            <button
                              className={`ghost ${(cardWidths[entity.entity_id] ?? 'single') === 'double' ? 'on' : ''}`}
                              title="Card width"
                              onClick={() =>
                                setCardWidths((previous) => ({
                                  ...previous,
                                  [entity.entity_id]:
                                    (previous[entity.entity_id] ?? 'single') === 'double'
                                      ? 'single'
                                      : 'double',
                                }))
                              }
                            >
                              {(cardWidths[entity.entity_id] ?? 'single') === 'double'
                                ? 'Wide'
                                : 'Normal'}
                            </button>
                            <button
                              className="ghost"
                              title="Move up"
                              onClick={() => moveEntityInOrder(entity.entity_id, 'up')}
                            >
                              ▲
                            </button>
                            <button
                              className="ghost"
                              title="Move down"
                              onClick={() => moveEntityInOrder(entity.entity_id, 'down')}
                            >
                              ▼
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="settings-section">
                  <h2>Scenes</h2>
                  {sceneButtons.map((scene, index) => (
                    <div key={`${scene.id}-${index}`} className="scene-row">
                      <input
                        type="text"
                        name={`scene_label_${index}`}
                        autoComplete="off"
                        value={scene.label}
                        placeholder="Scene name"
                        onChange={(event) => {
                          const value = event.target.value
                          setSceneButtons((previous) => {
                            const next = [...previous]
                            next[index] = { ...next[index], label: value }
                            return next
                          })
                        }}
                      />
                      <input
                        type="text"
                        name={`scene_entity_id_${index}`}
                        autoComplete="off"
                        value={scene.id}
                        placeholder="automation.entity_id"
                        onChange={(event) => {
                          const value = event.target.value
                          setSceneButtons((previous) => {
                            const next = [...previous]
                            next[index] = { ...next[index], id: value }
                            return next
                          })
                        }}
                      />
                      <button
                        className="ghost"
                        onClick={() =>
                          setSceneButtons((previous) =>
                            previous.filter((_, sceneIndex) => sceneIndex !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    className="ghost"
                    onClick={() =>
                      setSceneButtons((previous) => [...previous, { id: '', label: '' }])
                    }
                  >
                    Add scene
                  </button>
                </div>

                <div className="settings-section">
                  <h2>Password</h2>
                  <input
                    type="password"
                    name="new_settings_password"
                    autoComplete="new-password"
                    value={newPassword}
                    placeholder="New password"
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <button className="ghost" onClick={() => void updatePassword()}>
                    Update password
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {modalEntity ? (
          <div className="modal-overlay" onClick={() => setModalEntity(null)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div className="card-title">{getDisplayName(modalEntity)}</div>
                <button className="ghost" onClick={() => setModalEntity(null)}>
                  Close
                </button>
              </div>
              {renderModalContent(modalEntity)}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default App
