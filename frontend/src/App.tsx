import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActionTile, HaEntity, ProfileConfig, RuntimeConfig, SceneButton, Settings } from './types'

const LIGHT_COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww'])
const LIGHT_COLOR_TEMP_MODES = new Set(['color_temp', 'rgbww'])
const ADMIN_CATEGORY_ID = '__admin__'
const ADMIN_DEFAULT_HASH = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'
const HEADER_KEYS = ['temperatureEntityId', 'humidityEntityId', 'doorContactEntityId', 'doorActionEntityId'] as const

const defaultSettings: Settings = {
  enabledEntities: [],
  entityOrder: [],
  nameOverrides: {},
  categoryMap: {},
  cardWidths: {},
  showIcons: {},
  titleModes: {},
  stateLabels: {},
  customCategories: [],
  categoryPinHashes: {},
  categoryIcons: {},
  categoryDisplayModes: {},
  categoryParents: {},
  categoryTopText: {},
  categoryBottomText: {},
  categoryTopEntities: {},
  categoryBottomEntities: {},
  sceneButtons: [],
  passwordHash: '',
  headerEntities: {
    temperatureEntityId: '',
    humidityEntityId: '',
    doorContactEntityId: '',
    doorActionEntityId: '',
  },
  globalSettings: {
    title: 'Studio Panel',
    subtitle: 'Control center',
    accentColor: '#3fa9f5',
    hiddenEntities: [],
    featuredEntities: [],
  },
  profiles: {},
  deviceProfiles: {},
  actionTiles: [],
}

const defaultRuntime: RuntimeConfig = {
  haUrl: '',
  haToken: '',
}

const tabs = ['entities', 'categories', 'scenes', 'actions', 'profiles', 'header', 'runtime'] as const

type ManageTab = (typeof tabs)[number]
type HeaderKey = (typeof HEADER_KEYS)[number]

type LightMemory = {
  brightness?: number
  color?: string
  kelvin?: number
}

const parseError = async (response: Response): Promise<string> => {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message || text
  } catch {
    return text || `Request failed (${response.status})`
  }
}

const normalizeSettings = (value: Partial<Settings>): Settings => ({
  ...defaultSettings,
  ...value,
  headerEntities: {
    ...defaultSettings.headerEntities,
    ...(value.headerEntities ?? {}),
  },
  globalSettings: {
    ...defaultSettings.globalSettings,
    ...(value.globalSettings ?? {}),
  },
  profiles: value.profiles ?? {},
  actionTiles: value.actionTiles ?? [],
  titleModes: value.titleModes ?? {},
  stateLabels: value.stateLabels ?? {},
  categoryIcons: value.categoryIcons ?? {},
  categoryDisplayModes: value.categoryDisplayModes ?? {},
  categoryParents: value.categoryParents ?? {},
})

const getDomain = (entityId: string) => entityId.split('.')[0] ?? ''

const getDefaultCategory = (entity: HaEntity) => {
  const domain = getDomain(entity.entity_id)
  if (['light', 'switch', 'fan', 'cover'].includes(domain)) return 'Controls'
  if (['climate', 'humidifier'].includes(domain)) return 'Climate'
  if (['lock', 'alarm_control_panel', 'binary_sensor', 'button'].includes(domain)) return 'Security'
  if (['scene', 'script', 'automation', 'media_player', 'vacuum'].includes(domain)) return 'Actions'
  return 'General'
}

const getFriendlyName = (entity: HaEntity) => {
  const friendly = entity.attributes.friendly_name
  if (typeof friendly === 'string' && friendly.trim()) return friendly
  return entity.entity_id
}

const toNum = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return [255, 255, 255]
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ]
}

const rgbToHex = (rgb?: unknown): string | undefined => {
  if (!Array.isArray(rgb) || rgb.length < 3) return undefined
  const channel = (value: unknown) =>
    Math.max(0, Math.min(255, toNum(value, 255))).toString(16).padStart(2, '0')
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`
}

const iconClassFromEntity = (entity: HaEntity): string => {
  const icon = entity.attributes.icon
  if (typeof icon === 'string' && icon.startsWith('mdi:')) {
    return `mdi mdi-${icon.slice(4)}`
  }
  const fallback: Record<string, string> = {
    light: 'mdi-lightbulb',
    switch: 'mdi-toggle-switch',
    fan: 'mdi-fan',
    climate: 'mdi-thermometer',
    cover: 'mdi-window-shutter',
    lock: 'mdi-lock',
    binary_sensor: 'mdi-radar',
    button: 'mdi-gesture-tap-button',
  }
  return `mdi ${fallback[getDomain(entity.entity_id)] ?? 'mdi-home-assistant'}`
}

const isOnState = (entity: HaEntity) => {
  const state = entity.state
  return ['on', 'open', 'unlocked', 'playing', 'heat', 'cool', 'auto'].includes(state)
}

const canCardToggle = (entity: HaEntity) => {
  const domain = getDomain(entity.entity_id)
  return ['light', 'switch', 'fan', 'lock', 'button'].includes(domain)
}

const applyOptimistic = (
  list: HaEntity[],
  entityId: string,
  service: string,
  payload: Record<string, unknown>,
): HaEntity[] =>
  list.map((entity) => {
    if (entity.entity_id !== entityId) return entity
    const attrs: Record<string, unknown> = { ...entity.attributes }
    let state = entity.state

    switch (service) {
      case 'turn_on':
        state = 'on'
        break
      case 'turn_off':
        state = 'off'
        break
      case 'open_cover':
        state = 'open'
        break
      case 'close_cover':
        state = 'closed'
        break
      case 'lock':
        state = 'locked'
        break
      case 'unlock':
        state = 'unlocked'
        break
      case 'set_hvac_mode':
        state = String(payload.hvac_mode ?? state)
        attrs.hvac_mode = payload.hvac_mode
        break
      default:
        break
    }

    if (payload.brightness !== undefined) attrs.brightness = payload.brightness
    if (payload.rgb_color !== undefined) attrs.rgb_color = payload.rgb_color
    if (payload.color_temp_kelvin !== undefined) attrs.color_temp_kelvin = payload.color_temp_kelvin
    if (payload.percentage !== undefined) attrs.percentage = payload.percentage
    if (payload.temperature !== undefined) attrs.temperature = payload.temperature

    return { ...entity, state, attributes: attrs }
  })

const sortEntities = (items: HaEntity[]) =>
  [...items].sort((a, b) => getFriendlyName(a).localeCompare(getFriendlyName(b)))

const sha256 = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function App() {
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [runtime, setRuntime] = useState<RuntimeConfig>(defaultRuntime)
  const [search, setSearch] = useState('')
  const [manageTab, setManageTab] = useState<ManageTab>('entities')
  const [statusText, setStatusText] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [dragEntityId, setDragEntityId] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newProfileKey, setNewProfileKey] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [subCategory, setSubCategory] = useState<string | null>(null)
  const [unlockedCategories, setUnlockedCategories] = useState<Set<string>>(new Set())
  const [pendingCategory, setPendingCategory] = useState<string | null>(null)
  const [categoryPinInput, setCategoryPinInput] = useState('')
  const [categoryPinSetting, setCategoryPinSetting] = useState<Record<string, string>>({})
  const [dragCategoryId, setDragCategoryId] = useState('')
  const pendingUnlockCallback = useRef<(() => void) | null>(null)
  const [headerSearch, setHeaderSearch] = useState<Record<HeaderKey, string>>({
    temperatureEntityId: '',
    humidityEntityId: '',
    doorContactEntityId: '',
    doorActionEntityId: '',
  })
  const [sceneSearch, setSceneSearch] = useState<Record<number, string>>({})
  const [lightMemory, setLightMemory] = useState<Record<string, LightMemory>>({})
  const refreshSeq = useRef(0)

  const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { 'X-Studio-Token': adminToken } : {}),
        ...(options?.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error(await parseError(response))
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  const loadAll = async () => {
    setStatusText('Loading...')
    try {
      const [nextSettings, nextEntities, nextRuntime] = await Promise.all([
        api<Settings>('/api/settings'),
        api<HaEntity[]>('/api/entities'),
        api<RuntimeConfig>('/api/runtime-config'),
      ])
      setSettings(normalizeSettings(nextSettings))
      setEntities(Array.isArray(nextEntities) ? nextEntities : [])
      setRuntime({ haUrl: nextRuntime.haUrl ?? '', haToken: nextRuntime.haToken ?? '' })
      setStatusText('Loaded')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Load failed')
    }
  }

  const refreshEntitiesOnly = async (seq: number) => {
    try {
      const nextEntities = await api<HaEntity[]>('/api/entities')
      if (seq === refreshSeq.current) {
        setEntities(Array.isArray(nextEntities) ? nextEntities : [])
      }
    } catch {
      // ignore transient fetch errors while background syncing
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  useEffect(() => {
    if (selectedCategory !== ADMIN_CATEGORY_ID) {
      setAdminUnlocked(false)
    }
  }, [selectedCategory])

  useEffect(() => {
    setLightMemory((prev) => {
      const next = { ...prev }
      for (const entity of entities) {
        if (getDomain(entity.entity_id) !== 'light') continue
        const current = next[entity.entity_id] ?? {}
        const brightness = entity.attributes.brightness
        const color = rgbToHex(entity.attributes.rgb_color)
        const kelvin = entity.attributes.color_temp_kelvin
        if (brightness !== undefined) current.brightness = toNum(brightness, current.brightness ?? 1)
        if (color) current.color = color
        if (kelvin !== undefined) current.kelvin = toNum(kelvin, current.kelvin ?? 2700)
        next[entity.entity_id] = current
      }
      return next
    })
  }, [entities])

  const callService = async (domain: string, service: string, payload: Record<string, unknown>) => {
    const entityId = String(payload.entity_id ?? '')
    const seq = ++refreshSeq.current
    setEntities((prev) => applyOptimistic(prev, entityId, service, payload))

    try {
      await api('/api/service/' + domain + '/' + service, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setTimeout(() => {
        void refreshEntitiesOnly(seq)
      }, 700)
      setTimeout(() => {
        void refreshEntitiesOnly(seq)
      }, 1800)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Service call failed')
      void loadAll()
    }
  }

  const onCardToggle = (entity: HaEntity) => {
    if (!canCardToggle(entity)) return
    const domain = getDomain(entity.entity_id)

    if (domain === 'button') {
      void callService('button', 'press', { entity_id: entity.entity_id })
      return
    }

    if (domain === 'lock') {
      const service = entity.state === 'locked' ? 'unlock' : 'lock'
      void callService('lock', service, { entity_id: entity.entity_id })
      return
    }

    const service = entity.state === 'on' ? 'turn_off' : 'turn_on'
    void callService(domain, service, { entity_id: entity.entity_id })
  }

  const previewAttr = (entityId: string, attrs: Record<string, unknown>) => {
    setEntities((prev) =>
      prev.map((entity) =>
        entity.entity_id === entityId
          ? { ...entity, attributes: { ...entity.attributes, ...attrs } }
          : entity,
      ),
    )
  }

  const sortedEntities = useMemo(() => sortEntities(entities), [entities])

  const allFiltered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const base = sortedEntities
    if (!query) return base
    return base.filter((entity) => {
      const display = String(settings.nameOverrides[entity.entity_id] ?? getFriendlyName(entity))
      return `${entity.entity_id} ${display}`.toLowerCase().includes(query)
    })
  }, [search, settings.nameOverrides, sortedEntities])

  const dashboardEntities = useMemo(() => {
    const ordered = [...entities].sort((a, b) => {
      const ai = settings.entityOrder.indexOf(a.entity_id)
      const bi = settings.entityOrder.indexOf(b.entity_id)
      if (ai === -1 && bi === -1) return getFriendlyName(a).localeCompare(getFriendlyName(b))
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return ordered.filter((entity) => settings.enabledEntities.includes(entity.entity_id))
  }, [entities, settings.enabledEntities, settings.entityOrder])

  const discoveredCategories = useMemo(() => {
    const set = new Set<string>()
    for (const entity of dashboardEntities) {
      set.add(settings.categoryMap[entity.entity_id] ?? getDefaultCategory(entity))
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [dashboardEntities, settings.categoryMap])

  const categories = useMemo(() => {
    // Preserve customCategories order; fall back to alphabetical discovered list
    return settings.customCategories.length > 0 ? settings.customCategories : discoveredCategories
  }, [settings.customCategories, discoveredCategories])

  const categoryOptions = useMemo(() => {
    const merged = new Set<string>([...categories, ...discoveredCategories, 'General'])
    return Array.from(merged).sort((a, b) => a.localeCompare(b))
  }, [categories, discoveredCategories])

  const entitiesByCategory = useMemo(() => {
    const map = new Map<string, HaEntity[]>()
    for (const category of categories) map.set(category, [])
    for (const entity of dashboardEntities) {
      const category = settings.categoryMap[entity.entity_id] ?? getDefaultCategory(entity)
      if (!map.has(category)) map.set(category, [])
      map.get(category)!.push(entity)
    }
    return map
  }, [categories, dashboardEntities, settings.categoryMap])

  const entityMap = useMemo(() => {
    const map = new Map<string, HaEntity>()
    for (const entity of entities) map.set(entity.entity_id, entity)
    return map
  }, [entities])

  const enabledOrder = useMemo(() => {
    const entitySet = new Set(entities.map((entity) => entity.entity_id))
    const fromOrder = settings.entityOrder.filter((entityId) => entitySet.has(entityId))
    const extras = settings.enabledEntities
      .filter((entityId) => entitySet.has(entityId) && !fromOrder.includes(entityId))
      .sort((a, b) => a.localeCompare(b))
    return [...fromOrder, ...extras]
  }, [entities, settings.entityOrder, settings.enabledEntities])

  const automationEntities = useMemo(
    () => sortedEntities.filter((entity) => getDomain(entity.entity_id) === 'automation'),
    [sortedEntities],
  )

  const topLevelCategories = useMemo(
    () => categories.filter((cat) => !settings.categoryParents[cat]),
    [categories, settings.categoryParents],
  )

  const childCategoriesOf = (parent: string) =>
    categories.filter((cat) => settings.categoryParents[cat] === parent)

  const entityChoices = (query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return sortedEntities
    return sortedEntities.filter((entity) => {
      const label = getFriendlyName(entity)
      return `${entity.entity_id} ${label}`.toLowerCase().includes(q)
    })
  }

  const getStateLabels = (entityId: string) => settings.stateLabels[entityId] ?? { on: 'On', off: 'Off' }

  const displayState = (entity: HaEntity) => {
    const labels = getStateLabels(entity.entity_id)
    if (entity.state === 'on') return labels.on
    if (entity.state === 'off') return labels.off
    return entity.state
  }

  const setNameOverride = (entityId: string, value: string) => {
    setSettings((prev) => ({ ...prev, nameOverrides: { ...prev.nameOverrides, [entityId]: value } }))
  }

  const setCategory = (entityId: string, value: string) => {
    setSettings((prev) => ({ ...prev, categoryMap: { ...prev.categoryMap, [entityId]: value } }))
  }

  const setCardWidth = (entityId: string, value: 'single' | 'double') => {
    setSettings((prev) => ({ ...prev, cardWidths: { ...prev.cardWidths, [entityId]: value } }))
  }

  const setTitleMode = (entityId: string, value: 'name' | 'name_icon' | 'icon') => {
    setSettings((prev) => ({ ...prev, titleModes: { ...prev.titleModes, [entityId]: value } }))
  }

  const setStateLabel = (entityId: string, key: 'on' | 'off', value: string) => {
    setSettings((prev) => ({
      ...prev,
      stateLabels: {
        ...prev.stateLabels,
        [entityId]: {
          ...(prev.stateLabels[entityId] ?? { on: 'On', off: 'Off' }),
          [key]: value,
        },
      },
    }))
  }

  const toggleEntity = (entityId: string, enabled: boolean) => {
    setSettings((prev) => {
      const enabledEntities = enabled
        ? [...new Set([...prev.enabledEntities, entityId])]
        : prev.enabledEntities.filter((item) => item !== entityId)
      const entityOrder = enabled
        ? prev.entityOrder.includes(entityId)
          ? prev.entityOrder
          : [...prev.entityOrder, entityId]
        : prev.entityOrder.filter((item) => item !== entityId)
      return { ...prev, enabledEntities, entityOrder }
    })
  }

  const reorderEnabledEntity = (fromId: string, targetId: string) => {
    if (!fromId || !targetId || fromId === targetId) return
    setSettings((prev) => {
      const order = [...prev.entityOrder]
      const from = order.indexOf(fromId)
      const to = order.indexOf(targetId)
      if (from < 0 || to < 0) return prev
      order.splice(from, 1)
      order.splice(to, 0, fromId)
      return { ...prev, entityOrder: order }
    })
  }

  const addCategory = () => {
    const category = newCategory.trim()
    if (!category) return
    setSettings((prev) => ({
      ...prev,
      customCategories: prev.customCategories.includes(category)
        ? prev.customCategories
        : [...prev.customCategories, category],
    }))
    setNewCategory('')
  }

  const removeCategory = (category: string) => {
    setSettings((prev) => ({
      ...prev,
      customCategories: prev.customCategories.filter((item) => item !== category),
    }))
  }

  const reorderCategory = (fromName: string, targetName: string) => {
    if (!fromName || !targetName || fromName === targetName) return
    setSettings((prev) => {
      const cats = [...prev.customCategories]
      const from = cats.indexOf(fromName)
      const to = cats.indexOf(targetName)
      if (from < 0 || to < 0) return prev
      cats.splice(from, 1)
      cats.splice(to, 0, fromName)
      return { ...prev, customCategories: cats }
    })
  }

  const setCategoryIcon = (category: string, icon: string) => {
    setSettings((prev) => ({ ...prev, categoryIcons: { ...prev.categoryIcons, [category]: icon } }))
  }

  const setCategoryDisplayMode = (category: string, mode: 'name' | 'icon' | 'name_icon') => {
    setSettings((prev) => ({ ...prev, categoryDisplayModes: { ...prev.categoryDisplayModes, [category]: mode } }))
  }

  const setCategoryParent = (category: string, parent: string) => {
    setSettings((prev) => {
      const next = { ...prev.categoryParents }
      if (parent) {
        next[category] = parent
      } else {
        delete next[category]
      }
      return { ...prev, categoryParents: next }
    })
  }

  const applyCategoryPin = async (category: string) => {
    const pin = (categoryPinSetting[category] ?? '').trim()
    if (!pin) return
    const hash = await sha256(pin)
    setSettings((prev) => ({ ...prev, categoryPinHashes: { ...prev.categoryPinHashes, [category]: hash } }))
    setCategoryPinSetting((prev) => ({ ...prev, [category]: '' }))
  }

  const clearCategoryPin = (category: string) => {
    setSettings((prev) => {
      const next = { ...prev.categoryPinHashes }
      delete next[category]
      return { ...prev, categoryPinHashes: next }
    })
  }

  const onCategoryClick = (category: string) => {
    const hash = settings.categoryPinHashes[category]
    if (hash && !unlockedCategories.has(category)) {
      pendingUnlockCallback.current = () => {
        setSelectedCategory(category)
        setSubCategory(null)
      }
      setPendingCategory(category)
      return
    }
    setSelectedCategory(category)
    setSubCategory(null)
  }

  const onSubCategoryClick = (sub: string) => {
    const hash = settings.categoryPinHashes[sub]
    if (hash && !unlockedCategories.has(sub)) {
      pendingUnlockCallback.current = () => setSubCategory(sub)
      setPendingCategory(sub)
      return
    }
    setSubCategory(sub)
  }

  const unlockCategory = async () => {
    if (!pendingCategory) return
    const hash = settings.categoryPinHashes[pendingCategory]
    const entered = categoryPinInput.trim()
    if (!entered || !hash) return
    const hashed = await sha256(entered)
    if (hashed === hash) {
      setUnlockedCategories((prev) => new Set([...prev, pendingCategory]))
      pendingUnlockCallback.current?.()
      pendingUnlockCallback.current = null
      setPendingCategory(null)
      setCategoryPinInput('')
    } else {
      setStatusText('Invalid PIN')
    }
  }

  const addScene = () => {
    setSettings((prev) => ({ ...prev, sceneButtons: [...prev.sceneButtons, { id: '', label: '' }] }))
  }

  const updateScene = (index: number, key: keyof SceneButton, value: string) => {
    setSettings((prev) => {
      const next = [...prev.sceneButtons]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, sceneButtons: next }
    })
  }

  const removeScene = (index: number) => {
    setSettings((prev) => ({ ...prev, sceneButtons: prev.sceneButtons.filter((_, i) => i !== index) }))
  }

  const addActionTile = () => {
    setSettings((prev) => ({
      ...prev,
      actionTiles: [...prev.actionTiles, { id: '', label: '', actionType: 'url', target: '' }],
    }))
  }

  const updateActionTile = (index: number, key: keyof ActionTile, value: string) => {
    setSettings((prev) => {
      const next = [...prev.actionTiles]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, actionTiles: next }
    })
  }

  const removeActionTile = (index: number) => {
    setSettings((prev) => ({ ...prev, actionTiles: prev.actionTiles.filter((_, i) => i !== index) }))
  }

  const addProfile = () => {
    const key = newProfileKey.trim()
    if (!key || settings.profiles[key]) return
    const profile: ProfileConfig = {
      label: key,
      hiddenEntities: [],
      categoryMap: {},
      nameOverrides: {},
      actionTileIds: [],
    }
    setSettings((prev) => ({ ...prev, profiles: { ...prev.profiles, [key]: profile } }))
    setNewProfileKey('')
  }

  const updateProfileLabel = (key: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      profiles: { ...prev.profiles, [key]: { ...prev.profiles[key], label: value } },
    }))
  }

  const updateProfileHiddenEntities = (key: string, value: string) => {
    const hidden = value.split(',').map((item) => item.trim()).filter(Boolean)
    setSettings((prev) => ({
      ...prev,
      profiles: { ...prev.profiles, [key]: { ...prev.profiles[key], hiddenEntities: hidden } },
    }))
  }

  const removeProfile = (key: string) => {
    setSettings((prev) => {
      const next = { ...prev.profiles }
      delete next[key]
      return { ...prev, profiles: next }
    })
  }

  const saveSettings = async () => {
    setStatusText('Saving settings...')
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setStatusText('Settings saved')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const saveRuntime = async () => {
    setStatusText('Saving runtime config...')
    try {
      await api('/api/runtime-config', { method: 'PUT', body: JSON.stringify(runtime) })
      setStatusText('Runtime config saved')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Runtime save failed')
    }
  }

  const unlockAdmin = async () => {
    const entered = adminPassword.trim()
    if (!entered) return
    const expectedHash = settings.passwordHash || ADMIN_DEFAULT_HASH
    const hashed = await sha256(entered)
    if (hashed === expectedHash) {
      setAdminUnlocked(true)
      setStatusText('Admin unlocked')
    } else {
      setStatusText('Invalid password')
      setAdminUnlocked(false)
    }
    setAdminPassword('')
  }

  const headerValue = (entityId: string) => {
    const entity = entityMap.get(entityId)
    if (!entity) return '--'
    const unit = entity.attributes.unit_of_measurement
    if (typeof unit === 'string' && unit) return `${entity.state}${unit}`
    return displayState(entity)
  }

  const renderHeader = () => {
    const tempId = settings.headerEntities.temperatureEntityId
    const humidityId = settings.headerEntities.humidityEntityId
    const doorId = settings.headerEntities.doorContactEntityId
    const actionId = settings.headerEntities.doorActionEntityId

    if (!tempId && !humidityId && !doorId && !actionId) return null

    return (
      <section className="header-strip panel">
        {tempId ? <div className="header-chip">Temp: {headerValue(tempId)}</div> : null}
        {humidityId ? <div className="header-chip">Humidity: {headerValue(humidityId)}</div> : null}
        {doorId ? <div className="header-chip">Door: {headerValue(doorId)}</div> : null}
        {actionId ? (
          <button
            className="header-chip header-chip--action"
            onClick={() => {
              const entity = entityMap.get(actionId)
              if (!entity) return
              onCardToggle(entity)
            }}
          >
            Door action
          </button>
        ) : null}
      </section>
    )
  }

  const renderEntityControls = (entity: HaEntity) => {
    const domain = getDomain(entity.entity_id)
    const isOff = entity.state === 'off' || entity.state === 'unavailable'

    if (domain === 'light') {
      const supportedModes = (entity.attributes.supported_color_modes as string[] | undefined) ?? []
      const onlyOnOff = supportedModes.length === 0 || (supportedModes.length === 1 && supportedModes[0] === 'onoff')
      const supportsBrightness = !onlyOnOff
      const supportsColor = supportedModes.some((m) => LIGHT_COLOR_MODES.has(m))
      const supportsColorTemp = supportedModes.some((m) => LIGHT_COLOR_TEMP_MODES.has(m))

      const memory = lightMemory[entity.entity_id] ?? {}
      const brightnessValue = entity.attributes.brightness !== undefined
        ? toNum(entity.attributes.brightness, 1)
        : memory.brightness
      const colorValue = rgbToHex(entity.attributes.rgb_color) ?? memory.color
      const kelvinValue = entity.attributes.color_temp_kelvin !== undefined
        ? toNum(entity.attributes.color_temp_kelvin, 2700)
        : memory.kelvin
      const minKelvin = toNum(entity.attributes.min_color_temp_kelvin, 2000)
      const maxKelvin = toNum(entity.attributes.max_color_temp_kelvin, 6500)

      return (
        <div className="controls-stack" onClick={(event) => event.stopPropagation()}>
          {supportsBrightness ? (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Brightness
              <input
                type="range"
                min="1"
                max="255"
                step="1"
                value={brightnessValue ?? 1}
                disabled={isOff}
                onChange={(event) => previewAttr(entity.entity_id, { brightness: Number(event.target.value) })}
                onPointerUp={(event) =>
                  void callService('light', 'turn_on', {
                    entity_id: entity.entity_id,
                    brightness: Number((event.target as HTMLInputElement).value),
                  })
                }
              />
            </label>
          ) : null}

          {supportsColor ? (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Color
              <input
                type="color"
                value={colorValue ?? '#000000'}
                disabled={isOff}
                onChange={(event) =>
                  void callService('light', 'turn_on', {
                    entity_id: entity.entity_id,
                    rgb_color: hexToRgb(event.target.value),
                  })
                }
              />
            </label>
          ) : null}

          {supportsColorTemp ? (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Color temp (K)
              <input
                type="range"
                min={minKelvin}
                max={maxKelvin}
                step="50"
                value={kelvinValue ?? minKelvin}
                disabled={isOff}
                onChange={(event) => previewAttr(entity.entity_id, { color_temp_kelvin: Number(event.target.value) })}
                onPointerUp={(event) =>
                  void callService('light', 'turn_on', {
                    entity_id: entity.entity_id,
                    color_temp_kelvin: Number((event.target as HTMLInputElement).value),
                  })
                }
              />
            </label>
          ) : null}
        </div>
      )
    }

    if (domain === 'climate') {
      const temperature = toNum(entity.attributes.temperature, 22)
      const min = toNum(entity.attributes.min_temp, 16)
      const max = toNum(entity.attributes.max_temp, 30)
      const modes = Array.isArray(entity.attributes.hvac_modes)
        ? (entity.attributes.hvac_modes as string[])
        : ['off', 'heat', 'cool', 'auto']
      const currentMode = String(entity.attributes.hvac_mode ?? entity.state)
      const climateOff = currentMode === 'off'
      const supportsTemp = entity.attributes.min_temp !== undefined

      return (
        <div className="controls-stack" onClick={(event) => event.stopPropagation()}>
          <label className="ctrl-label">
            Mode
            <select
              value={currentMode}
              onChange={(event) =>
                void callService('climate', 'set_hvac_mode', {
                  entity_id: entity.entity_id,
                  hvac_mode: event.target.value,
                })
              }
            >
              {modes.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          {supportsTemp ? (
            <label className={`ctrl-label${climateOff ? ' ctrl-label--off' : ''}`}>
              {temperature.toFixed(1)}
              <input
                type="range"
                min={min}
                max={max}
                step="0.5"
                value={temperature}
                disabled={climateOff}
                onChange={(event) => previewAttr(entity.entity_id, { temperature: Number(event.target.value) })}
                onPointerUp={(event) =>
                  void callService('climate', 'set_temperature', {
                    entity_id: entity.entity_id,
                    temperature: Number((event.target as HTMLInputElement).value),
                  })
                }
              />
            </label>
          ) : null}
        </div>
      )
    }

    if (domain === 'cover') {
      return (
        <div className="inline-controls" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void callService('cover', 'open_cover', { entity_id: entity.entity_id })}>Open</button>
          <button onClick={() => void callService('cover', 'stop_cover', { entity_id: entity.entity_id })}>Stop</button>
          <button onClick={() => void callService('cover', 'close_cover', { entity_id: entity.entity_id })}>Close</button>
        </div>
      )
    }

    if (domain === 'fan') {
      const percent = toNum(entity.attributes.percentage, 50)
      const supportsSpeed = entity.attributes.percentage !== undefined || entity.attributes.percentage_step !== undefined
      return supportsSpeed ? (
        <div className="controls-stack" onClick={(event) => event.stopPropagation()}>
          <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
            Speed {percent}%
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={percent}
              disabled={isOff}
              onChange={(event) => previewAttr(entity.entity_id, { percentage: Number(event.target.value) })}
              onPointerUp={(event) =>
                void callService('fan', 'set_percentage', {
                  entity_id: entity.entity_id,
                  percentage: Number((event.target as HTMLInputElement).value),
                })
              }
            />
          </label>
        </div>
      ) : null
    }

    return null // state shown in title chip
  }

  const renderTitle = (entity: HaEntity) => {
    const mode = settings.titleModes[entity.entity_id] ?? (settings.showIcons[entity.entity_id] ? 'name_icon' : 'name')
    const iconClass = iconClassFromEntity(entity)
    const name = String(settings.nameOverrides[entity.entity_id] ?? getFriendlyName(entity))
    const on = isOnState(entity)
    const chip = <span className={`state-chip${on ? ' state-chip--on' : ''}`}>{displayState(entity)}</span>

    if (mode === 'icon') {
      return (
        <div className="card-title-row">
          <i className={`${iconClass} card-icon`} title={name} />
          {chip}
        </div>
      )
    }
    if (mode === 'name_icon') {
      return (
        <div className="card-title-row">
          <div className="card-title-wrap">
            <i className={`${iconClass} card-icon`} />
            <h3>{name}</h3>
          </div>
          {chip}
        </div>
      )
    }
    return (
      <div className="card-title-row">
        <h3>{name}</h3>
        {chip}
      </div>
    )
  }

  const renderCategoryButton = (category: string, onClick: () => void, extraClass = '') => {
    const mode = settings.categoryDisplayModes[category] ?? 'name'
    const rawIcon = settings.categoryIcons[category]
    const isLocked = !!settings.categoryPinHashes[category] && !unlockedCategories.has(category)
    const iconClass = rawIcon
      ? `mdi ${rawIcon.startsWith('mdi:') ? `mdi-${rawIcon.slice(4)}` : rawIcon}`
      : null

    return (
      <button key={category} className={`category-btn${extraClass ? ` ${extraClass}` : ''}`} onClick={onClick}>
        {iconClass && (mode === 'icon' || mode === 'name_icon') ? (
          <i className={`${iconClass} category-btn__icon`} />
        ) : null}
        {mode !== 'icon' ? <span className="category-btn__name">{category}</span> : null}
        {isLocked ? <i className="mdi mdi-lock category-btn__lock" /> : null}
      </button>
    )
  }

  const adminRequested = selectedCategory === ADMIN_CATEGORY_ID

  const renderEntityGrid = (entityList: HaEntity[]) => (
    <div className="grid">
      {entityList.map((entity) => (
        <article
          key={entity.entity_id}
          className={`card${settings.cardWidths[entity.entity_id] === 'double' ? ' card--double' : ''}${isOnState(entity) ? ' card--active' : ''}${canCardToggle(entity) ? ' card--toggleable' : ''}`}
          onClick={() => onCardToggle(entity)}
        >
          {renderTitle(entity)}
          {renderEntityControls(entity)}
        </article>
      ))}
    </div>
  )

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>{settings.globalSettings.title || 'Studio Panel'}</h1>
          <p>{settings.globalSettings.subtitle || 'Control center'}</p>
          <small className="status">{statusText}</small>
        </div>
      </header>

      {renderHeader()}

      {!adminRequested ? (
        <main className="dashboard">
          {pendingCategory !== null ? (
            <section className="panel">
              <h3>
                <i className="mdi mdi-lock" /> {pendingCategory}
              </h3>
              <p>Enter PIN to unlock this category.</p>
              <div className="row-form row-form--stack">
                <input
                  type="password"
                  value={categoryPinInput}
                  onChange={(event) => setCategoryPinInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void unlockCategory() }}
                  placeholder="Category PIN"
                />
                <div className="inline-controls">
                  <button onClick={() => void unlockCategory()}>Unlock</button>
                  <button onClick={() => { setPendingCategory(null); setCategoryPinInput('') }}>Cancel</button>
                </div>
              </div>
            </section>
          ) : selectedCategory === null ? (
            <div className="category-grid">
              {topLevelCategories.map((category) =>
                renderCategoryButton(category, () => onCategoryClick(category))
              )}
              <button
                className="category-btn category-btn--admin"
                onClick={() => setSelectedCategory(ADMIN_CATEGORY_ID)}
              >
                <span className="category-btn__name">Admin</span>
              </button>
            </div>
          ) : subCategory !== null ? (
            <>
              <div className="cat-nav">
                <button className="back-btn" onClick={() => setSubCategory(null)}>Back</button>
                <h2 className="cat-heading">{selectedCategory} › {subCategory}</h2>
              </div>
              {renderEntityGrid(entitiesByCategory.get(subCategory) ?? [])}
            </>
          ) : (
            <>
              <div className="cat-nav">
                <button className="back-btn" onClick={() => setSelectedCategory(null)}>Back</button>
                <h2 className="cat-heading">{selectedCategory}</h2>
              </div>
              {childCategoriesOf(selectedCategory).length > 0 ? (
                <div className="category-grid" style={{ marginTop: 12 }}>
                  {childCategoriesOf(selectedCategory).map((sub) =>
                    renderCategoryButton(sub, () => onSubCategoryClick(sub))
                  )}
                </div>
              ) : null}
              {renderEntityGrid(entitiesByCategory.get(selectedCategory) ?? [])}
            </>
          )}
        </main>
      ) : (
        <main className="manage">
          {!adminUnlocked ? (
            <section className="panel">
              <h3>Admin unlock</h3>
              <p>Default password is admin if no custom password is set in Home Assistant options.</p>
              <div className="row-form row-form--stack">
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void unlockAdmin() }}
                  placeholder="Enter admin password"
                />
                <div className="inline-controls">
                  <button onClick={() => void unlockAdmin()}>Unlock</button>
                  <button onClick={() => setSelectedCategory(null)}>Back</button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="manage-toolbar">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entities" />
                <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Admin token (optional)" />
                <button onClick={() => void saveSettings()}>Save settings</button>
                <button onClick={() => void loadAll()}>Refresh</button>
                <button onClick={() => setSelectedCategory(null)}>Exit admin</button>
              </div>

              <nav className="tabbar">
                {tabs.map((tab) => (
                  <button key={tab} className={manageTab === tab ? 'tab tab--active' : 'tab'} onClick={() => setManageTab(tab)}>
                    {tab}
                  </button>
                ))}
              </nav>

              {manageTab === 'entities' ? (
                <section className="panel">
                  <div className="split-grid">
                    <div>
                      <h3>All entities</h3>
                      <div className="entity-list">
                        {allFiltered.map((entity) => (
                          <div key={entity.entity_id} className="entity-row entity-row--editor">
                            <label className="toggle-line">
                              <input
                                type="checkbox"
                                checked={settings.enabledEntities.includes(entity.entity_id)}
                                onChange={(event) => toggleEntity(entity.entity_id, event.target.checked)}
                              />
                              <span>{entity.entity_id}</span>
                            </label>
                            <input
                              value={settings.nameOverrides[entity.entity_id] ?? ''}
                              onChange={(event) => setNameOverride(entity.entity_id, event.target.value)}
                              placeholder={getFriendlyName(entity)}
                            />
                            <select
                              value={settings.categoryMap[entity.entity_id] ?? getDefaultCategory(entity)}
                              onChange={(event) => setCategory(entity.entity_id, event.target.value)}
                            >
                              {categoryOptions.map((category) => (
                                <option key={category} value={category}>{category}</option>
                              ))}
                            </select>
                            <div className="inline-controls">
                              <select
                                value={settings.cardWidths[entity.entity_id] ?? 'single'}
                                onChange={(event) => setCardWidth(entity.entity_id, event.target.value as 'single' | 'double')}
                              >
                                <option value="single">Single</option>
                                <option value="double">Double</option>
                              </select>
                              <select
                                value={settings.titleModes[entity.entity_id] ?? (settings.showIcons[entity.entity_id] ? 'name_icon' : 'name')}
                                onChange={(event) => setTitleMode(entity.entity_id, event.target.value as 'name' | 'name_icon' | 'icon')}
                              >
                                <option value="name">Name only</option>
                                <option value="name_icon">Icon and name</option>
                                <option value="icon">Icon only</option>
                              </select>
                            </div>
                            <div className="inline-controls">
                              <input
                                value={getStateLabels(entity.entity_id).on}
                                onChange={(event) => setStateLabel(entity.entity_id, 'on', event.target.value)}
                                placeholder="On label"
                              />
                              <input
                                value={getStateLabels(entity.entity_id).off}
                                onChange={(event) => setStateLabel(entity.entity_id, 'off', event.target.value)}
                                placeholder="Off label"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3>Enabled order (drag and drop)</h3>
                      <div className="entity-list">
                        {enabledOrder.map((entityId) => (
                          <div
                            key={entityId}
                            className="entity-row"
                            draggable
                            onDragStart={() => setDragEntityId(entityId)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => reorderEnabledEntity(dragEntityId, entityId)}
                          >
                            <strong>{settings.nameOverrides[entityId] ?? entityId}</strong>
                            <small>{entityId}</small>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {manageTab === 'categories' ? (
                <section className="panel">
                  <h3>Custom categories</h3>
                  <div className="manage-toolbar">
                    <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category name" />
                    <button onClick={addCategory}>Add</button>
                  </div>
                  <div className="entity-list" style={{ marginTop: 10 }}>
                    {settings.customCategories.map((category) => (
                      <div
                        key={category}
                        className="entity-row"
                        draggable
                        onDragStart={() => setDragCategoryId(category)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => reorderCategory(dragCategoryId, category)}
                      >
                        <div className="inline-controls">
                          <span style={{ cursor: 'grab', userSelect: 'none' }}>⠿</span>
                          <strong style={{ flex: 1 }}>{category}</strong>
                          <button onClick={() => removeCategory(category)}>✕ Remove</button>
                        </div>
                        <div className="inline-controls">
                          <input
                            value={settings.categoryIcons[category] ?? ''}
                            onChange={(event) => setCategoryIcon(category, event.target.value)}
                            placeholder="mdi:icon-name"
                            style={{ flex: 1 }}
                          />
                          <select
                            value={settings.categoryDisplayModes[category] ?? 'name'}
                            onChange={(event) => setCategoryDisplayMode(category, event.target.value as 'name' | 'icon' | 'name_icon')}
                          >
                            <option value="name">Name</option>
                            <option value="name_icon">Icon + Name</option>
                            <option value="icon">Icon only</option>
                          </select>
                          <select
                            value={settings.categoryParents[category] ?? ''}
                            onChange={(event) => setCategoryParent(category, event.target.value)}
                          >
                            <option value="">No parent</option>
                            {settings.customCategories
                              .filter((c) => c !== category)
                              .map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                          </select>
                        </div>
                        <div className="inline-controls">
                          <input
                            type="password"
                            value={categoryPinSetting[category] ?? ''}
                            onChange={(event) => setCategoryPinSetting((prev) => ({ ...prev, [category]: event.target.value }))}
                            placeholder="Set PIN"
                            style={{ flex: 1 }}
                          />
                          <button onClick={() => void applyCategoryPin(category)}>
                            {settings.categoryPinHashes[category] ? 'Update PIN' : 'Set PIN'}
                          </button>
                          {settings.categoryPinHashes[category] ? (
                            <button onClick={() => clearCategoryPin(category)}>Clear PIN</button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {manageTab === 'scenes' ? (
                <section className="panel">
                  <h3>Scene buttons</h3>
                  <button onClick={addScene}>Add scene</button>
                  {settings.sceneButtons.map((scene, index) => {
                    const searchText = sceneSearch[index] ?? ''
                    const query = searchText.trim().toLowerCase()
                    const filtered = automationEntities.filter((entity) => {
                      if (!query) return true
                      const label = getFriendlyName(entity)
                      return `${entity.entity_id} ${label}`.toLowerCase().includes(query)
                    })
                    return (
                      <div key={`${scene.id}-${index}`} className="row-form row-form--stack">
                        <input
                          value={searchText}
                          onChange={(event) => setSceneSearch((prev) => ({ ...prev, [index]: event.target.value }))}
                          placeholder="Search automation"
                        />
                        <select value={scene.id} onChange={(event) => updateScene(index, 'id', event.target.value)}>
                          <option value="">Select automation</option>
                          {filtered.map((entity) => (
                            <option key={entity.entity_id} value={entity.entity_id}>
                              {getFriendlyName(entity)} ({entity.entity_id})
                            </option>
                          ))}
                        </select>
                        <input value={scene.label} onChange={(event) => updateScene(index, 'label', event.target.value)} placeholder="Button label" />
                        <button onClick={() => removeScene(index)}>Remove</button>
                      </div>
                    )
                  })}
                </section>
              ) : null}

              {manageTab === 'actions' ? (
                <section className="panel">
                  <h3>Action tiles</h3>
                  <button onClick={addActionTile}>Add action</button>
                  {settings.actionTiles.map((tile, index) => (
                    <div key={`${tile.id}-${index}`} className="row-form">
                      <input value={tile.id} onChange={(event) => updateActionTile(index, 'id', event.target.value)} placeholder="tile id" />
                      <input value={tile.label} onChange={(event) => updateActionTile(index, 'label', event.target.value)} placeholder="label" />
                      <select value={tile.actionType} onChange={(event) => updateActionTile(index, 'actionType', event.target.value)}>
                        <option value="url">url</option>
                        <option value="app">app</option>
                        <option value="route">route</option>
                      </select>
                      <input value={tile.target} onChange={(event) => updateActionTile(index, 'target', event.target.value)} placeholder="target" />
                      <button onClick={() => removeActionTile(index)}>Remove</button>
                    </div>
                  ))}
                </section>
              ) : null}

              {manageTab === 'profiles' ? (
                <section className="panel">
                  <h3>Profiles</h3>
                  <div className="manage-toolbar">
                    <input value={newProfileKey} onChange={(event) => setNewProfileKey(event.target.value)} placeholder="new profile key" />
                    <button onClick={addProfile}>Add profile</button>
                  </div>
                  {Object.entries(settings.profiles).map(([key, profile]) => (
                    <div key={key} className="row-form row-form--stack">
                      <strong>{key}</strong>
                      <input value={profile.label} onChange={(event) => updateProfileLabel(key, event.target.value)} placeholder="Profile label" />
                      <textarea
                        value={profile.hiddenEntities.join(', ')}
                        onChange={(event) => updateProfileHiddenEntities(key, event.target.value)}
                        placeholder="hidden entities (comma separated)"
                      />
                      <button onClick={() => removeProfile(key)}>Remove profile</button>
                    </div>
                  ))}
                </section>
              ) : null}

              {manageTab === 'header' ? (
                <section className="panel">
                  <h3>Header entities</h3>
                  <div className="row-form row-form--stack">
                    {HEADER_KEYS.map((key) => {
                      const filtered = entityChoices(headerSearch[key])
                      return (
                        <div key={key} className="row-form row-form--stack">
                          <label>{key}</label>
                          <input
                            value={headerSearch[key]}
                            onChange={(event) => setHeaderSearch((prev) => ({ ...prev, [key]: event.target.value }))}
                            placeholder="Search entity"
                          />
                          <select
                            value={settings.headerEntities[key]}
                            onChange={(event) =>
                              setSettings((prev) => ({
                                ...prev,
                                headerEntities: { ...prev.headerEntities, [key]: event.target.value },
                              }))
                            }
                          >
                            <option value="">None</option>
                            {filtered.map((entity) => (
                              <option key={entity.entity_id} value={entity.entity_id}>{getFriendlyName(entity)} ({entity.entity_id})</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {manageTab === 'runtime' ? (
                <section className="panel">
                  <h3>Runtime configuration</h3>
                  <div className="row-form row-form--stack">
                    <input value={runtime.haUrl} onChange={(event) => setRuntime((prev) => ({ ...prev, haUrl: event.target.value }))} placeholder="http://homeassistant.local:8123" />
                    <textarea value={runtime.haToken} onChange={(event) => setRuntime((prev) => ({ ...prev, haToken: event.target.value }))} placeholder="Long-lived token" />
                    <button onClick={() => void saveRuntime()}>Save runtime config</button>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </main>
      )}
    </div>
  )
}
