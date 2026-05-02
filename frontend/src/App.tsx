import { useEffect, useMemo, useState } from 'react'
import type { ActionTile, HaEntity, ProfileConfig, RuntimeConfig, SceneButton, Settings } from './types'

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

const defaultRuntime: RuntimeConfig = {
  haUrl: '',
  haToken: '',
}

const tabs = ['entities', 'categories', 'scenes', 'actions', 'profiles', 'header', 'runtime'] as const

type ManageTab = (typeof tabs)[number]

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
})

export function App() {
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [runtime, setRuntime] = useState<RuntimeConfig>(defaultRuntime)
  const [search, setSearch] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [manageTab, setManageTab] = useState<ManageTab>('entities')
  const [statusText, setStatusText] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [dragEntityId, setDragEntityId] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newProfileKey, setNewProfileKey] = useState('')

  const api = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { 'X-Studio-Token': adminToken } : {}),
        ...(options?.headers ?? {}),
      },
    })
    if (!response.ok) {
      throw new Error(await parseError(response))
    }
    if (response.status === 204) {
      return undefined as T
    }
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
      setStatusText(`Loaded ${nextEntities.length} entities`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Load failed'
      setStatusText(message)
    }
  }

  useEffect(() => {
    void loadAll()
  }, [])

  const filteredEntities = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return entities
    return entities.filter((entity) => {
      const display = String(settings.nameOverrides[entity.entity_id] ?? entity.attributes.friendly_name ?? '')
      return `${entity.entity_id} ${display}`.toLowerCase().includes(query)
    })
  }, [entities, search, settings.nameOverrides])

  const enabledOrder = useMemo(() => {
    const entitySet = new Set(entities.map((entity) => entity.entity_id))
    const fromOrder = settings.entityOrder.filter((entityId) => entitySet.has(entityId))
    const extras = settings.enabledEntities
      .filter((entityId) => entitySet.has(entityId) && !fromOrder.includes(entityId))
      .sort((a, b) => a.localeCompare(b))
    return [...fromOrder, ...extras]
  }, [entities, settings.entityOrder, settings.enabledEntities])

  const visibleEntities = useMemo(
    () => enabledOrder.map((entityId) => entities.find((entity) => entity.entity_id === entityId)).filter(Boolean) as HaEntity[],
    [enabledOrder, entities],
  )

  const setNameOverride = (entityId: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      nameOverrides: { ...prev.nameOverrides, [entityId]: value },
    }))
  }

  const setCategory = (entityId: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      categoryMap: { ...prev.categoryMap, [entityId]: value },
    }))
  }

  const setCardWidth = (entityId: string, value: 'single' | 'double') => {
    setSettings((prev) => ({
      ...prev,
      cardWidths: { ...prev.cardWidths, [entityId]: value },
    }))
  }

  const setShowIcon = (entityId: string, value: boolean) => {
    setSettings((prev) => ({
      ...prev,
      showIcons: { ...prev.showIcons, [entityId]: value },
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
      return {
        ...prev,
        enabledEntities,
        entityOrder,
      }
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

  const addScene = () => {
    const scene: SceneButton = { id: '', label: '' }
    setSettings((prev) => ({ ...prev, sceneButtons: [...prev.sceneButtons, scene] }))
  }

  const updateScene = (index: number, key: keyof SceneButton, value: string) => {
    setSettings((prev) => {
      const next = [...prev.sceneButtons]
      next[index] = { ...next[index], [key]: value }
      return { ...prev, sceneButtons: next }
    })
  }

  const removeScene = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      sceneButtons: prev.sceneButtons.filter((_, sceneIndex) => sceneIndex !== index),
    }))
  }

  const addActionTile = () => {
    const tile: ActionTile = { id: '', label: '', actionType: 'url', target: '' }
    setSettings((prev) => ({ ...prev, actionTiles: [...prev.actionTiles, tile] }))
  }

  const updateActionTile = (index: number, key: keyof ActionTile, value: string) => {
    setSettings((prev) => {
      const next = [...prev.actionTiles]
      const current = next[index]
      next[index] = { ...current, [key]: value }
      return { ...prev, actionTiles: next }
    })
  }

  const removeActionTile = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      actionTiles: prev.actionTiles.filter((_, tileIndex) => tileIndex !== index),
    }))
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
    setSettings((prev) => ({
      ...prev,
      profiles: { ...prev.profiles, [key]: profile },
    }))
    setNewProfileKey('')
  }

  const updateProfileLabel = (key: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      profiles: {
        ...prev.profiles,
        [key]: { ...prev.profiles[key], label: value },
      },
    }))
  }

  const updateProfileHiddenEntities = (key: string, value: string) => {
    const hidden = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    setSettings((prev) => ({
      ...prev,
      profiles: {
        ...prev.profiles,
        [key]: { ...prev.profiles[key], hiddenEntities: hidden },
      },
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
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      })
      setStatusText('Settings saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed'
      setStatusText(message)
    }
  }

  const saveRuntime = async () => {
    setStatusText('Saving runtime config...')
    try {
      await api('/api/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(runtime),
      })
      setStatusText('Runtime config saved')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Runtime save failed'
      setStatusText(message)
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <h1>{settings.globalSettings.title || 'Studio Panel'}</h1>
          <p>{settings.globalSettings.subtitle || 'Control center'}</p>
          <small className="status">{statusText}</small>
        </div>
        <div className="hero-actions">
          <button onClick={() => setManageMode((value) => !value)}>{manageMode ? 'Dashboard' : 'Manage'}</button>
          <button onClick={() => void loadAll()}>Refresh from HA</button>
          <button onClick={() => void saveSettings()}>Save</button>
        </div>
      </header>

      {manageMode ? (
        <main className="manage">
          <div className="manage-toolbar">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entities" />
            <input
              value={adminToken}
              onChange={(event) => setAdminToken(event.target.value)}
              placeholder="Admin token (if enabled)"
            />
            <span>{entities.length} entities</span>
          </div>

          <nav className="tabbar">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={manageTab === tab ? 'tab tab--active' : 'tab'}
                onClick={() => setManageTab(tab)}
              >
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
                    {filteredEntities.map((entity) => (
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
                          placeholder={String(entity.attributes.friendly_name ?? entity.entity_id)}
                        />
                        <input
                          value={settings.categoryMap[entity.entity_id] ?? ''}
                          onChange={(event) => setCategory(entity.entity_id, event.target.value)}
                          placeholder="Category"
                          list="categories"
                        />
                        <div className="inline-controls">
                          <select
                            value={settings.cardWidths[entity.entity_id] ?? 'single'}
                            onChange={(event) => setCardWidth(entity.entity_id, event.target.value as 'single' | 'double')}
                          >
                            <option value="single">Single</option>
                            <option value="double">Double</option>
                          </select>
                          <label>
                            <input
                              type="checkbox"
                              checked={settings.showIcons[entity.entity_id] !== false}
                              onChange={(event) => setShowIcon(entity.entity_id, event.target.checked)}
                            />
                            Icon
                          </label>
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
                <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category" />
                <button onClick={addCategory}>Add category</button>
              </div>
              <div className="chip-wrap">
                {settings.customCategories.map((category) => (
                  <button key={category} className="chip" onClick={() => removeCategory(category)}>
                    {category} x
                  </button>
                ))}
              </div>
              <datalist id="categories">
                {settings.customCategories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </section>
          ) : null}

          {manageTab === 'scenes' ? (
            <section className="panel">
              <h3>Scene buttons</h3>
              <button onClick={addScene}>Add scene</button>
              {settings.sceneButtons.map((scene, index) => (
                <div key={`${scene.id}-${index}`} className="row-form">
                  <input value={scene.id} onChange={(event) => updateScene(index, 'id', event.target.value)} placeholder="automation.some_scene" />
                  <input value={scene.label} onChange={(event) => updateScene(index, 'label', event.target.value)} placeholder="Button label" />
                  <button onClick={() => removeScene(index)}>Remove</button>
                </div>
              ))}
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
                <label>
                  Temperature entity
                  <select
                    value={settings.headerEntities.temperatureEntityId}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        headerEntities: { ...prev.headerEntities, temperatureEntityId: event.target.value },
                      }))
                    }
                  >
                    <option value="">None</option>
                    {entities.map((entity) => (
                      <option key={entity.entity_id} value={entity.entity_id}>
                        {entity.entity_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Humidity entity
                  <select
                    value={settings.headerEntities.humidityEntityId}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        headerEntities: { ...prev.headerEntities, humidityEntityId: event.target.value },
                      }))
                    }
                  >
                    <option value="">None</option>
                    {entities.map((entity) => (
                      <option key={entity.entity_id} value={entity.entity_id}>
                        {entity.entity_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Door contact entity
                  <select
                    value={settings.headerEntities.doorContactEntityId}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        headerEntities: { ...prev.headerEntities, doorContactEntityId: event.target.value },
                      }))
                    }
                  >
                    <option value="">None</option>
                    {entities.map((entity) => (
                      <option key={entity.entity_id} value={entity.entity_id}>
                        {entity.entity_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Door action entity
                  <select
                    value={settings.headerEntities.doorActionEntityId}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        headerEntities: { ...prev.headerEntities, doorActionEntityId: event.target.value },
                      }))
                    }
                  >
                    <option value="">None</option>
                    {entities.map((entity) => (
                      <option key={entity.entity_id} value={entity.entity_id}>
                        {entity.entity_id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {manageTab === 'runtime' ? (
            <section className="panel">
              <h3>Runtime configuration</h3>
              <div className="row-form row-form--stack">
                <input
                  value={runtime.haUrl}
                  onChange={(event) => setRuntime((prev) => ({ ...prev, haUrl: event.target.value }))}
                  placeholder="http://homeassistant.local:8123"
                />
                <textarea
                  value={runtime.haToken}
                  onChange={(event) => setRuntime((prev) => ({ ...prev, haToken: event.target.value }))}
                  placeholder="Long-lived token"
                />
                <button onClick={() => void saveRuntime()}>Save runtime config</button>
              </div>
            </section>
          ) : null}
        </main>
      ) : (
        <main className="grid">
          {visibleEntities.map((entity) => (
            <article key={entity.entity_id} className="card">
              <h3>{String(settings.nameOverrides[entity.entity_id] ?? entity.attributes.friendly_name ?? entity.entity_id)}</h3>
              <p>{entity.state}</p>
              <small>{settings.categoryMap[entity.entity_id] ?? 'General'}</small>
            </article>
          ))}
        </main>
      )}
    </div>
  )
}
