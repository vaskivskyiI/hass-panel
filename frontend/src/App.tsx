import { useEffect, useMemo, useState } from 'react'
import type { ActionTile, HaEntity, ProfileConfig, RuntimeConfig, SceneButton, Settings } from './types'

// ── Light feature detection ──────────────────────────────────────────────────
const LIGHT_COLOR_MODES = new Set(['hs', 'xy', 'rgb', 'rgbw', 'rgbww'])
const LIGHT_COLOR_TEMP_MODES = new Set(['color_temp', 'rgbww'])

// ── Defaults ─────────────────────────────────────────────────────────────────
const defaultSettings: Settings = {
  enabledEntities: [],
  entityOrder: [],
  nameOverrides: {},
  categoryMap: {},
  cardWidths: {},
  showIcons: {},
  customCategories: [],
  categoryPinHashes: {},
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

const defaultRuntime: RuntimeConfig = { haUrl: '', haToken: '' }

const tabs = ['entities', 'categories', 'scenes', 'actions', 'profiles', 'header', 'runtime'] as const
type ManageTab = (typeof tabs)[number]

// ── Pure helpers ──────────────────────────────────────────────────────────────
const parseError = async (response: Response): Promise<string> => {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message ?? text
  } catch {
    return text || `Request failed (${response.status})`
  }
}

const normalizeSettings = (value: Partial<Settings>): Settings => ({
  ...defaultSettings,
  ...value,
  headerEntities: { ...defaultSettings.headerEntities, ...(value.headerEntities ?? {}) },
  globalSettings: { ...defaultSettings.globalSettings, ...(value.globalSettings ?? {}) },
  profiles: value.profiles ?? {},
  actionTiles: value.actionTiles ?? [],
})

const getDomain = (entityId: string) => entityId.split('.')[0] ?? ''

const getDefaultCategory = (entity: HaEntity) => {
  const domain = getDomain(entity.entity_id)
  if (['light', 'switch', 'fan', 'cover'].includes(domain)) return 'Controls'
  if (['climate', 'humidifier'].includes(domain)) return 'Climate'
  if (['lock', 'alarm_control_panel', 'binary_sensor'].includes(domain)) return 'Security'
  if (['scene', 'script', 'automation', 'media_player', 'vacuum'].includes(domain)) return 'Actions'
  return 'General'
}

const getFriendlyName = (entity: HaEntity) => {
  const n = entity.attributes.friendly_name
  return typeof n === 'string' && n.trim() ? n : entity.entity_id
}

const toNum = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  if (h.length !== 6) return [255, 255, 255]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const rgbToHex = (rgb?: unknown): string => {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#f5dc9a'
  const ch = (v: unknown) => Math.max(0, Math.min(255, toNum(v, 255))).toString(16).padStart(2, '0')
  return `#${ch(rgb[0])}${ch(rgb[1])}${ch(rgb[2])}`
}

// Apply optimistic entity state/attribute change (no API call)
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
      case 'turn_on':       state = 'on';      break
      case 'turn_off':      state = 'off';     break
      case 'open_cover':    state = 'open';    break
      case 'close_cover':   state = 'closed';  break
      case 'lock':          state = 'locked';  break
      case 'unlock':        state = 'unlocked'; break
      case 'set_hvac_mode':
        state = String(payload.hvac_mode ?? state)
        attrs.hvac_mode = payload.hvac_mode
        break
    }

    if (payload.brightness        !== undefined) attrs.brightness        = payload.brightness
    if (payload.rgb_color         !== undefined) attrs.rgb_color         = payload.rgb_color
    if (payload.color_temp_kelvin !== undefined) attrs.color_temp_kelvin = payload.color_temp_kelvin
    if (payload.percentage        !== undefined) attrs.percentage        = payload.percentage
    if (payload.temperature       !== undefined) attrs.temperature       = payload.temperature

    return { ...entity, state, attributes: attrs }
  })

// ── Component ─────────────────────────────────────────────────────────────────
export function App() {
  const [entities,         setEntities        ] = useState<HaEntity[]>([])
  const [settings,         setSettings        ] = useState<Settings>(defaultSettings)
  const [runtime,          setRuntime         ] = useState<RuntimeConfig>(defaultRuntime)
  const [search,           setSearch          ] = useState('')
  const [manageMode,       setManageMode      ] = useState(false)
  const [manageTab,        setManageTab       ] = useState<ManageTab>('entities')
  const [statusText,       setStatusText      ] = useState('')
  const [adminToken,       setAdminToken      ] = useState('')
  const [dragEntityId,     setDragEntityId    ] = useState('')
  const [newCategory,      setNewCategory     ] = useState('')
  const [newProfileKey,    setNewProfileKey   ] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // ── API helper ──────────────────────────────────────────────────────────
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

  // ── Load from backend ───────────────────────────────────────────────────
  const loadAll = async () => {
    try {
      const [nextSettings, nextEntities, nextRuntime] = await Promise.all([
        api<Settings>('/api/settings'),
        api<HaEntity[]>('/api/entities'),
        api<RuntimeConfig>('/api/runtime-config'),
      ])
      setSettings(normalizeSettings(nextSettings))
      setEntities(Array.isArray(nextEntities) ? nextEntities : [])
      setRuntime({ haUrl: nextRuntime.haUrl ?? '', haToken: nextRuntime.haToken ?? '' })
      setStatusText(`${nextEntities.length} entities`)
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Load failed')
    }
  }

  useEffect(() => { void loadAll() }, [])

  // ── Optimistic local attribute preview (slider drag, no API call) ────────
  const previewAttr = (entityId: string, attrs: Record<string, unknown>) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.entity_id === entityId ? { ...e, attributes: { ...e.attributes, ...attrs } } : e,
      ),
    )
  }

  // ── Service call with immediate optimistic state update ──────────────────
  const callService = async (
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ) => {
    const entityId = String(payload.entity_id ?? '')
    setEntities((prev) => applyOptimistic(prev, entityId, service, payload))
    try {
      await api('/api/service/' + domain + '/' + service, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      void loadAll() // sync actual HA state in background
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Service call failed')
      void loadAll()
    }
  }

  // ── Derived lists ─────────────────────────────────────────────────────────
  // All entities filtered by search — used in Manage tab
  const allFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entities
    return entities.filter((e) => {
      const display = String(settings.nameOverrides[e.entity_id] ?? getFriendlyName(e))
      return `${e.entity_id} ${display}`.toLowerCase().includes(q)
    })
  }, [entities, search, settings.nameOverrides])

  // Enabled entities in user-defined order — used in Dashboard
  const dashboardEntities = useMemo(() => {
    const ordered = [...entities].sort((a, b) => {
      const ai = settings.entityOrder.indexOf(a.entity_id)
      const bi = settings.entityOrder.indexOf(b.entity_id)
      if (ai === -1 && bi === -1) return a.entity_id.localeCompare(b.entity_id)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return ordered.filter((e) => settings.enabledEntities.includes(e.entity_id))
  }, [entities, settings.enabledEntities, settings.entityOrder])

  const categories = useMemo(() => {
    if (settings.customCategories.length > 0) return settings.customCategories
    return Array.from(
      new Set(dashboardEntities.map((e) => settings.categoryMap[e.entity_id] ?? getDefaultCategory(e))),
    )
  }, [dashboardEntities, settings.customCategories, settings.categoryMap])

  const entitiesByCategory = useMemo(() => {
    const map = new Map<string, HaEntity[]>()
    for (const cat of categories) map.set(cat, [])
    for (const entity of dashboardEntities) {
      const cat = settings.categoryMap[entity.entity_id] ?? getDefaultCategory(entity)
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(entity)
    }
    return map
  }, [categories, dashboardEntities, settings.categoryMap])

  const enabledOrder = useMemo(() => {
    const ids = new Set(entities.map((e) => e.entity_id))
    const fromOrder = settings.entityOrder.filter((id) => ids.has(id))
    const extras = settings.enabledEntities.filter((id) => ids.has(id) && !fromOrder.includes(id))
    return [...fromOrder, ...extras]
  }, [entities, settings.entityOrder, settings.enabledEntities])

  // ── Manage helpers ─────────────────────────────────────────────────────────
  const toggleEntity = (entityId: string, enabled: boolean) => {
    setSettings((prev) => {
      const enabledEntities = enabled
        ? [...new Set([...prev.enabledEntities, entityId])]
        : prev.enabledEntities.filter((id) => id !== entityId)
      const entityOrder = enabled
        ? prev.entityOrder.includes(entityId) ? prev.entityOrder : [...prev.entityOrder, entityId]
        : prev.entityOrder.filter((id) => id !== entityId)
      return { ...prev, enabledEntities, entityOrder }
    })
  }

  const reorderEntity = (fromId: string, targetId: string) => {
    if (!fromId || !targetId || fromId === targetId) return
    setSettings((prev) => {
      const order = [...prev.entityOrder]
      const from = order.indexOf(fromId)
      const to   = order.indexOf(targetId)
      if (from < 0 || to < 0) return prev
      order.splice(from, 1)
      order.splice(to, 0, fromId)
      return { ...prev, entityOrder: order }
    })
  }

  const setNameOverride = (id: string, v: string) =>
    setSettings((p) => ({ ...p, nameOverrides: { ...p.nameOverrides, [id]: v } }))
  const setCategory = (id: string, v: string) =>
    setSettings((p) => ({ ...p, categoryMap: { ...p.categoryMap, [id]: v } }))
  const setCardWidth = (id: string, v: 'single' | 'double') =>
    setSettings((p) => ({ ...p, cardWidths: { ...p.cardWidths, [id]: v } }))
  const setShowIcon = (id: string, v: boolean) =>
    setSettings((p) => ({ ...p, showIcons: { ...p.showIcons, [id]: v } }))

  const addCategory = () => {
    const cat = newCategory.trim()
    if (!cat) return
    setSettings((p) => ({
      ...p,
      customCategories: p.customCategories.includes(cat) ? p.customCategories : [...p.customCategories, cat],
    }))
    setNewCategory('')
  }

  const removeCategory = (cat: string) =>
    setSettings((p) => ({ ...p, customCategories: p.customCategories.filter((c) => c !== cat) }))

  const addScene = () =>
    setSettings((p) => ({ ...p, sceneButtons: [...p.sceneButtons, { id: '', label: '' }] }))

  const updateScene = (i: number, key: keyof SceneButton, v: string) =>
    setSettings((p) => {
      const next = [...p.sceneButtons]; next[i] = { ...next[i], [key]: v }
      return { ...p, sceneButtons: next }
    })

  const removeScene = (i: number) =>
    setSettings((p) => ({ ...p, sceneButtons: p.sceneButtons.filter((_, j) => j !== i) }))

  const addActionTile = () =>
    setSettings((p) => ({
      ...p, actionTiles: [...p.actionTiles, { id: '', label: '', actionType: 'url', target: '' }],
    }))

  const updateActionTile = (i: number, key: keyof ActionTile, v: string) =>
    setSettings((p) => {
      const next = [...p.actionTiles]; next[i] = { ...next[i], [key]: v }
      return { ...p, actionTiles: next }
    })

  const removeActionTile = (i: number) =>
    setSettings((p) => ({ ...p, actionTiles: p.actionTiles.filter((_, j) => j !== i) }))

  const addProfile = () => {
    const key = newProfileKey.trim()
    if (!key || settings.profiles[key]) return
    const profile: ProfileConfig = { label: key, hiddenEntities: [], categoryMap: {}, nameOverrides: {}, actionTileIds: [] }
    setSettings((p) => ({ ...p, profiles: { ...p.profiles, [key]: profile } }))
    setNewProfileKey('')
  }

  const updateProfileLabel = (key: string, v: string) =>
    setSettings((p) => ({ ...p, profiles: { ...p.profiles, [key]: { ...p.profiles[key], label: v } } }))

  const updateProfileHidden = (key: string, v: string) => {
    const hidden = v.split(',').map((s) => s.trim()).filter(Boolean)
    setSettings((p) => ({ ...p, profiles: { ...p.profiles, [key]: { ...p.profiles[key], hiddenEntities: hidden } } }))
  }

  const removeProfile = (key: string) =>
    setSettings((p) => { const next = { ...p.profiles }; delete next[key]; return { ...p, profiles: next } })

  const saveSettings = async () => {
    setStatusText('Saving…')
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setStatusText('Saved')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const saveRuntime = async () => {
    setStatusText('Saving runtime…')
    try {
      await api('/api/runtime-config', { method: 'PUT', body: JSON.stringify(runtime) })
      setStatusText('Runtime saved')
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Runtime save failed')
    }
  }

  // ── Entity controls ───────────────────────────────────────────────────────
  const renderEntityControls = (entity: HaEntity) => {
    const domain   = getDomain(entity.entity_id)
    const isOff    = entity.state === 'off' || entity.state === 'unavailable'
    const entityId = entity.entity_id

    if (domain === 'light') {
      const supportedModes  = (entity.attributes.supported_color_modes as string[] | undefined) ?? []
      const onlyOnOff       = supportedModes.length === 0 || (supportedModes.length === 1 && supportedModes[0] === 'onoff')
      const supportsBright  = !onlyOnOff
      const supportsColor   = supportedModes.some((m) => LIGHT_COLOR_MODES.has(m))
      const supportsCT      = supportedModes.some((m) => LIGHT_COLOR_TEMP_MODES.has(m))

      const brightness = toNum(entity.attributes.brightness, 180)
      const color      = rgbToHex(entity.attributes.rgb_color)
      const kelvin     = toNum(entity.attributes.color_temp_kelvin, 3500)
      const minKelvin  = toNum(entity.attributes.min_color_temp_kelvin, 2000)
      const maxKelvin  = toNum(entity.attributes.max_color_temp_kelvin, 6500)

      return (
        <div className="controls-stack">
          <button
            className={`toggle-btn${isOff ? '' : ' toggle-btn--on'}`}
            onClick={() => void callService('light', isOff ? 'turn_on' : 'turn_off', { entity_id: entityId })}
          >
            {isOff ? 'Turn on' : 'Turn off'}
          </button>

          {supportsBright && (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Brightness
              <input
                type="range" min="1" max="255" step="1" value={brightness}
                disabled={isOff}
                onChange={(e)  => previewAttr(entityId, { brightness: Number(e.target.value) })}
                onPointerUp={(e) => void callService('light', 'turn_on', {
                  entity_id: entityId, brightness: Number((e.target as HTMLInputElement).value),
                })}
              />
            </label>
          )}

          {supportsColor && (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Color
              <input
                type="color" value={color}
                disabled={isOff}
                onChange={(e) => void callService('light', 'turn_on', {
                  entity_id: entityId, rgb_color: hexToRgb(e.target.value),
                })}
              />
            </label>
          )}

          {supportsCT && (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Color temp (K)
              <input
                type="range" min={minKelvin} max={maxKelvin} step="50" value={kelvin}
                disabled={isOff}
                onChange={(e)  => previewAttr(entityId, { color_temp_kelvin: Number(e.target.value) })}
                onPointerUp={(e) => void callService('light', 'turn_on', {
                  entity_id: entityId, color_temp_kelvin: Number((e.target as HTMLInputElement).value),
                })}
              />
            </label>
          )}
        </div>
      )
    }

    if (domain === 'switch') {
      return (
        <button
          className={`toggle-btn${isOff ? '' : ' toggle-btn--on'}`}
          onClick={() => void callService('switch', isOff ? 'turn_on' : 'turn_off', { entity_id: entityId })}
        >
          {isOff ? 'Turn on' : 'Turn off'}
        </button>
      )
    }

    if (domain === 'climate') {
      const modes       = Array.isArray(entity.attributes.hvac_modes) ? (entity.attributes.hvac_modes as string[]) : ['off', 'heat', 'cool', 'auto']
      const currentMode = String(entity.attributes.hvac_mode ?? entity.state)
      const climateOff  = currentMode === 'off'
      const supportsTemp = entity.attributes.min_temp !== undefined
      const temperature  = toNum(entity.attributes.temperature, 22)
      const minTemp      = toNum(entity.attributes.min_temp, 16)
      const maxTemp      = toNum(entity.attributes.max_temp, 30)

      return (
        <div className="controls-stack">
          <label className="ctrl-label">
            Mode
            <select
              value={currentMode}
              onChange={(e) => void callService('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: e.target.value })}
            >
              {modes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {supportsTemp && (
            <label className={`ctrl-label${climateOff ? ' ctrl-label--off' : ''}`}>
              {temperature.toFixed(1)}°
              <input
                type="range" min={minTemp} max={maxTemp} step="0.5" value={temperature}
                disabled={climateOff}
                onChange={(e)  => previewAttr(entityId, { temperature: Number(e.target.value) })}
                onPointerUp={(e) => void callService('climate', 'set_temperature', {
                  entity_id: entityId, temperature: Number((e.target as HTMLInputElement).value),
                })}
              />
            </label>
          )}
        </div>
      )
    }

    if (domain === 'cover') {
      return (
        <div className="inline-controls">
          <button onClick={() => void callService('cover', 'open_cover',  { entity_id: entityId })}>Open</button>
          <button onClick={() => void callService('cover', 'stop_cover',  { entity_id: entityId })}>Stop</button>
          <button onClick={() => void callService('cover', 'close_cover', { entity_id: entityId })}>Close</button>
        </div>
      )
    }

    if (domain === 'lock') {
      const isLocked = entity.state === 'locked'
      return (
        <button
          className={`toggle-btn${isLocked ? ' toggle-btn--on' : ''}`}
          onClick={() => void callService('lock', isLocked ? 'unlock' : 'lock', { entity_id: entityId })}
        >
          {isLocked ? 'Unlock' : 'Lock'}
        </button>
      )
    }

    if (domain === 'fan') {
      const percent      = toNum(entity.attributes.percentage, 50)
      const supportsSpeed = entity.attributes.percentage !== undefined || entity.attributes.percentage_step !== undefined
      return (
        <div className="controls-stack">
          <button
            className={`toggle-btn${isOff ? '' : ' toggle-btn--on'}`}
            onClick={() => void callService('fan', isOff ? 'turn_on' : 'turn_off', { entity_id: entityId })}
          >
            {isOff ? 'Turn on' : 'Turn off'}
          </button>
          {supportsSpeed && (
            <label className={`ctrl-label${isOff ? ' ctrl-label--off' : ''}`}>
              Speed {percent}%
              <input
                type="range" min="0" max="100" step="5" value={percent}
                disabled={isOff}
                onChange={(e)  => previewAttr(entityId, { percentage: Number(e.target.value) })}
                onPointerUp={(e) => void callService('fan', 'set_percentage', {
                  entity_id: entityId, percentage: Number((e.target as HTMLInputElement).value),
                })}
              />
            </label>
          )}
        </div>
      )
    }

    // Generic — just show state
    return <p className="entity-state">{entity.state}</p>
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>{settings.globalSettings.title || 'Studio Panel'}</h1>
          <p>{settings.globalSettings.subtitle || 'Control center'}</p>
          <small className="status">{statusText}</small>
        </div>
        <div className="hero-actions">
          <button onClick={() => { setManageMode((v) => !v); setSelectedCategory(null) }}>
            {manageMode ? 'Dashboard' : 'Manage'}
          </button>
          <button onClick={() => void loadAll()}>Refresh</button>
          <button onClick={() => void saveSettings()}>Save</button>
        </div>
      </header>

      {manageMode ? (
        /* ══════════════════════════════════════════════════════════ MANAGE */
        <main className="manage">
          <div className="manage-toolbar">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entities" />
            <input value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="Admin token" />
            <span>{entities.length} total</span>
          </div>

          <nav className="tabbar">
            {tabs.map((tab) => (
              <button key={tab} className={manageTab === tab ? 'tab tab--active' : 'tab'} onClick={() => setManageTab(tab)}>
                {tab}
              </button>
            ))}
          </nav>

          {manageTab === 'entities' && (
            <section className="panel">
              <div className="split-grid">
                <div>
                  <h3>All entities ({allFiltered.length})</h3>
                  <div className="entity-list">
                    {allFiltered.map((entity) => (
                      <div key={entity.entity_id} className="entity-row entity-row--editor">
                        <label className="toggle-line">
                          <input
                            type="checkbox"
                            checked={settings.enabledEntities.includes(entity.entity_id)}
                            onChange={(e) => toggleEntity(entity.entity_id, e.target.checked)}
                          />
                          <span>{entity.entity_id}</span>
                        </label>
                        <input
                          value={settings.nameOverrides[entity.entity_id] ?? ''}
                          onChange={(e) => setNameOverride(entity.entity_id, e.target.value)}
                          placeholder={getFriendlyName(entity)}
                        />
                        <input
                          value={settings.categoryMap[entity.entity_id] ?? ''}
                          onChange={(e) => setCategory(entity.entity_id, e.target.value)}
                          placeholder="Category"
                          list="categories"
                        />
                        <div className="inline-controls">
                          <select
                            value={settings.cardWidths[entity.entity_id] ?? 'single'}
                            onChange={(e) => setCardWidth(entity.entity_id, e.target.value as 'single' | 'double')}
                          >
                            <option value="single">Single</option>
                            <option value="double">Double</option>
                          </select>
                          <label>
                            <input
                              type="checkbox"
                              checked={settings.showIcons[entity.entity_id] !== false}
                              onChange={(e) => setShowIcon(entity.entity_id, e.target.checked)}
                            />
                            Icon
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                  <datalist id="categories">
                    {settings.customCategories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>

                <div>
                  <h3>Enabled order (drag)</h3>
                  <div className="entity-list">
                    {enabledOrder.map((id) => (
                      <div
                        key={id}
                        className="entity-row"
                        draggable
                        onDragStart={() => setDragEntityId(id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => reorderEntity(dragEntityId, id)}
                      >
                        <strong>{settings.nameOverrides[id] ?? id}</strong>
                        <small>{id}</small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {manageTab === 'categories' && (
            <section className="panel">
              <h3>Custom categories</h3>
              <div className="manage-toolbar">
                <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category" />
                <button onClick={addCategory}>Add</button>
              </div>
              <div className="chip-wrap">
                {settings.customCategories.map((cat) => (
                  <button key={cat} className="chip" onClick={() => removeCategory(cat)}>{cat} ×</button>
                ))}
              </div>
            </section>
          )}

          {manageTab === 'scenes' && (
            <section className="panel">
              <h3>Scene buttons</h3>
              <button onClick={addScene}>Add scene</button>
              {settings.sceneButtons.map((scene, i) => (
                <div key={`${scene.id}-${i}`} className="row-form">
                  <input value={scene.id}    onChange={(e) => updateScene(i, 'id',    e.target.value)} placeholder="automation.id" />
                  <input value={scene.label} onChange={(e) => updateScene(i, 'label', e.target.value)} placeholder="Label" />
                  <button onClick={() => removeScene(i)}>Remove</button>
                </div>
              ))}
            </section>
          )}

          {manageTab === 'actions' && (
            <section className="panel">
              <h3>Action tiles</h3>
              <button onClick={addActionTile}>Add action</button>
              {settings.actionTiles.map((tile, i) => (
                <div key={`${tile.id}-${i}`} className="row-form">
                  <input value={tile.id}     onChange={(e) => updateActionTile(i, 'id',     e.target.value)} placeholder="id" />
                  <input value={tile.label}  onChange={(e) => updateActionTile(i, 'label',  e.target.value)} placeholder="Label" />
                  <select value={tile.actionType} onChange={(e) => updateActionTile(i, 'actionType', e.target.value)}>
                    <option value="url">url</option>
                    <option value="app">app</option>
                    <option value="route">route</option>
                  </select>
                  <input value={tile.target} onChange={(e) => updateActionTile(i, 'target', e.target.value)} placeholder="Target" />
                  <button onClick={() => removeActionTile(i)}>Remove</button>
                </div>
              ))}
            </section>
          )}

          {manageTab === 'profiles' && (
            <section className="panel">
              <h3>Profiles</h3>
              <div className="manage-toolbar">
                <input value={newProfileKey} onChange={(e) => setNewProfileKey(e.target.value)} placeholder="Profile key" />
                <button onClick={addProfile}>Add</button>
              </div>
              {Object.entries(settings.profiles).map(([key, profile]) => (
                <div key={key} className="row-form row-form--stack">
                  <strong>{key}</strong>
                  <input value={profile.label} onChange={(e) => updateProfileLabel(key, e.target.value)} placeholder="Label" />
                  <textarea
                    value={profile.hiddenEntities.join(', ')}
                    onChange={(e) => updateProfileHidden(key, e.target.value)}
                    placeholder="Hidden entities (comma-separated)"
                  />
                  <button onClick={() => removeProfile(key)}>Remove</button>
                </div>
              ))}
            </section>
          )}

          {manageTab === 'header' && (
            <section className="panel">
              <h3>Header entities</h3>
              <div className="row-form row-form--stack">
                {(['temperatureEntityId', 'humidityEntityId', 'doorContactEntityId', 'doorActionEntityId'] as const).map((key) => (
                  <label key={key}>
                    {key}
                    <select
                      value={settings.headerEntities[key]}
                      onChange={(e) =>
                        setSettings((p) => ({ ...p, headerEntities: { ...p.headerEntities, [key]: e.target.value } }))
                      }
                    >
                      <option value="">None</option>
                      {entities.map((e) => <option key={e.entity_id} value={e.entity_id}>{e.entity_id}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}

          {manageTab === 'runtime' && (
            <section className="panel">
              <h3>Runtime configuration</h3>
              <div className="row-form row-form--stack">
                <input
                  value={runtime.haUrl}
                  onChange={(e) => setRuntime((p) => ({ ...p, haUrl: e.target.value }))}
                  placeholder="http://homeassistant.local:8123"
                />
                <textarea
                  value={runtime.haToken}
                  onChange={(e) => setRuntime((p) => ({ ...p, haToken: e.target.value }))}
                  placeholder="Long-lived access token"
                />
                <button onClick={() => void saveRuntime()}>Save runtime config</button>
              </div>
            </section>
          )}
        </main>
      ) : (
        /* ══════════════════════════════════════════════════════════ DASHBOARD */
        <main className="dashboard">
          {selectedCategory === null ? (
            /* Category grid */
            <div className="category-grid">
              {categories.map((cat) => {
                const count = entitiesByCategory.get(cat)?.length ?? 0
                return (
                  <button key={cat} className="category-btn" onClick={() => setSelectedCategory(cat)}>
                    <span className="category-btn__name">{cat}</span>
                    <span className="category-btn__count">{count}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            /* Entity list for selected category */
            <>
              <div className="cat-nav">
                <button className="back-btn" onClick={() => setSelectedCategory(null)}>← Back</button>
                <h2 className="cat-heading">{selectedCategory}</h2>
              </div>
              <div className="grid">
                {(entitiesByCategory.get(selectedCategory) ?? []).map((entity) => (
                  <article
                    key={entity.entity_id}
                    className={`card${settings.cardWidths[entity.entity_id] === 'double' ? ' card--double' : ''}`}
                  >
                    <h3>{String(settings.nameOverrides[entity.entity_id] ?? getFriendlyName(entity))}</h3>
                    <small className="entity-id">{entity.entity_id}</small>
                    {renderEntityControls(entity)}
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      )}
    </div>
  )
}
