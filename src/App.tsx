import { startTransition, useCallback, useEffect, useState } from 'react'
import { ActionTile } from './components/ActionTile'
import { EntityCard } from './components/EntityCard'
import { createDefaultPanelSettings } from './lib/defaultSettings'
import { getOrCreateDeviceId, resolveProfileKey } from './lib/deviceProfile'
import {
  formatLabel,
  getDefaultCategory,
  getFriendlyName,
  getMeasurementUnit,
} from './lib/entityModel'
import {
  callService,
  fetchEntityState,
  fetchPanelSettings,
  fetchStates,
  saveRuntimeConfig,
} from './services/haApi'
import type { EntityCommand, HaEntity, RouteState } from './types/ha'
import type { PanelActionTile, PanelSettings } from './types/settings'
import type { RuntimeConfig } from './runtimeConfig'

const REFRESH_INTERVAL_MS = 3000

const parseRoute = (): RouteState => {
  if (typeof window === 'undefined') return { kind: 'dashboard' }

  const rawPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (rawPath === '/connection') return { kind: 'connection' }
  if (rawPath === '/links') return { kind: 'links' }
  if (rawPath.startsWith('/category/')) {
    return { kind: 'category', category: decodeURIComponent(rawPath.replace('/category/', '')) }
  }

  return { kind: 'dashboard' }
}

const pushRoute = (route: RouteState) => {
  if (typeof window === 'undefined') return

  const nextPath =
    route.kind === 'dashboard'
      ? '/'
      : route.kind === 'links'
        ? '/links'
        : route.kind === 'connection'
          ? '/connection'
          : `/category/${encodeURIComponent(route.category)}`

  if (window.location.pathname === nextPath) return
  window.history.pushState({ panelRoute: nextPath }, '', nextPath)
}

const waitForRefresh = (delayMs: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  })

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const normalizeStringMap = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : {}

const normalizePanelSettings = (value: unknown): PanelSettings => {
  const defaults = createDefaultPanelSettings()

  if (typeof value !== 'object' || value === null) {
    return defaults
  }

  const parsed = value as Record<string, unknown>
  const rawHeaderEntities =
    typeof parsed.headerEntities === 'object' && parsed.headerEntities !== null
      ? (parsed.headerEntities as Record<string, unknown>)
      : {}
  const rawGlobalSettings =
    typeof parsed.globalSettings === 'object' && parsed.globalSettings !== null
      ? (parsed.globalSettings as Record<string, unknown>)
      : {}
  const normalizeActionType = (value: unknown): 'url' | 'app' | 'route' => {
    if (value === 'app' || value === 'route') return value
    return 'url'
  }

  return {
    ...defaults,
    enabledEntities: normalizeStringArray(parsed.enabledEntities),
    nameOverrides: normalizeStringMap(parsed.nameOverrides),
    categoryMap: normalizeStringMap(parsed.categoryMap),
    entityOrder: normalizeStringArray(parsed.entityOrder),
    customCategories: normalizeStringArray(parsed.customCategories),
    headerEntities: {
      temperatureEntityId:
        typeof rawHeaderEntities.temperatureEntityId === 'string'
          ? rawHeaderEntities.temperatureEntityId
          : '',
      humidityEntityId:
        typeof rawHeaderEntities.humidityEntityId === 'string'
          ? rawHeaderEntities.humidityEntityId
          : '',
      doorContactEntityId:
        typeof rawHeaderEntities.doorContactEntityId === 'string'
          ? rawHeaderEntities.doorContactEntityId
          : '',
      doorActionEntityId:
        typeof rawHeaderEntities.doorActionEntityId === 'string'
          ? rawHeaderEntities.doorActionEntityId
          : '',
    },
    globalSettings: {
      title:
        typeof rawGlobalSettings.title === 'string'
          ? rawGlobalSettings.title
          : defaults.globalSettings?.title,
      subtitle:
        typeof rawGlobalSettings.subtitle === 'string'
          ? rawGlobalSettings.subtitle
          : defaults.globalSettings?.subtitle,
      accentColor:
        typeof rawGlobalSettings.accentColor === 'string'
          ? rawGlobalSettings.accentColor
          : defaults.globalSettings?.accentColor,
      hiddenEntities: normalizeStringArray(rawGlobalSettings.hiddenEntities),
      featuredEntities: normalizeStringArray(rawGlobalSettings.featuredEntities),
    },
    profiles:
      typeof parsed.profiles === 'object' && parsed.profiles !== null
        ? Object.fromEntries(
            Object.entries(parsed.profiles).map(([key, entry]) => {
              const rawProfile =
                typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
              return [
                key,
                {
                  label: typeof rawProfile.label === 'string' ? rawProfile.label : key,
                  hiddenEntities: normalizeStringArray(rawProfile.hiddenEntities),
                  categoryMap: normalizeStringMap(rawProfile.categoryMap),
                  nameOverrides: normalizeStringMap(rawProfile.nameOverrides),
                  actionTileIds: normalizeStringArray(rawProfile.actionTileIds),
                },
              ]
            }),
          )
        : defaults.profiles,
    deviceProfiles:
      typeof parsed.deviceProfiles === 'object' && parsed.deviceProfiles !== null
        ? normalizeStringMap(parsed.deviceProfiles)
        : defaults.deviceProfiles,
    actionTiles: Array.isArray(parsed.actionTiles)
      ? parsed.actionTiles
          .filter(
            (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
          )
          .map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id : '',
            label: typeof entry.label === 'string' ? entry.label : '',
            icon: typeof entry.icon === 'string' ? entry.icon : '',
            actionType: normalizeActionType(entry.actionType),
            target: typeof entry.target === 'string' ? entry.target : '',
            confirmMessage:
              typeof entry.confirmMessage === 'string' ? entry.confirmMessage : undefined,
            profiles: normalizeStringArray(entry.profiles),
          }))
          .filter((tile) => tile.id && tile.label && tile.target)
      : defaults.actionTiles,
  }
}

const getHeaderEntity = (
  entities: HaEntity[],
  explicitId: string,
  fallbackDeviceClass: string,
  fallbackEntityId = '',
) =>
  entities.find((entity) => entity.entity_id === explicitId) ??
  (fallbackEntityId ? entities.find((entity) => entity.entity_id === fallbackEntityId) : undefined) ??
  entities.find((entity) => String(entity.attributes.device_class) === fallbackDeviceClass)

function App({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  const [haUrl, setHaUrl] = useState(runtimeConfig.haUrl ?? '')
  const [token, setToken] = useState(runtimeConfig.haToken ?? '')
  const [draftHaUrl, setDraftHaUrl] = useState(runtimeConfig.haUrl ?? '')
  const [draftToken, setDraftToken] = useState(runtimeConfig.haToken ?? '')
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [settings, setSettings] = useState<PanelSettings>(() => createDefaultPanelSettings())
  const [route, setRoute] = useState<RouteState>(() => parseRoute())
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingConnection, setSavingConnection] = useState(false)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [search, setSearch] = useState('')

  const connectionReady = Boolean(token && haUrl)

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId())
  }, [])

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!connectionReady) return

    let cancelled = false

    const loadPanelSettings = async () => {
      try {
        const next = await fetchPanelSettings<unknown>(haUrl, token)
        if (cancelled) return
        setSettings(normalizePanelSettings(next))
        setStorageError('')
      } catch (reason) {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : 'Unable to load panel settings.'
        setStorageError(message)
      }
    }

    void loadPanelSettings()

    return () => {
      cancelled = true
    }
  }, [connectionReady, haUrl, token])

  const refreshEntities = useCallback(async (silent = false) => {
    if (!connectionReady) return

    if (!silent) {
      setLoading(true)
      setError('')
    }

    try {
      const data = await fetchStates(haUrl, token)
      startTransition(() => {
        setEntities(data)
        setLastUpdated(new Date().toLocaleTimeString())
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to fetch entities.'
      setError(message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [connectionReady, haUrl, token])

  useEffect(() => {
    if (!connectionReady) return
    void refreshEntities(false)
  }, [connectionReady, refreshEntities])

  useEffect(() => {
    if (!connectionReady) return
    const intervalId = window.setInterval(() => {
      void refreshEntities(true)
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [connectionReady, refreshEntities])

  const forceRefreshEntities = async (entityIds: string[]) => {
    const uniqueEntityIds = [...new Set(entityIds.filter((entityId) => entityId.trim().length > 0))]

    if (uniqueEntityIds.length === 0) {
      await refreshEntities(true)
      return
    }

    const previousStateMap = new Map(
      uniqueEntityIds.map((entityId) => [entityId, entities.find((entity) => entity.entity_id === entityId)?.state]),
    )

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshots = await Promise.all(
        uniqueEntityIds.map(async (entityId) => {
          try {
            return await fetchEntityState(haUrl, token, entityId)
          } catch {
            return null
          }
        }),
      )

      const realized = snapshots.filter((snapshot): snapshot is HaEntity => snapshot !== null)
      if (realized.length > 0) {
        setEntities((previous) => {
          const next = [...previous]
          realized.forEach((snapshot) => {
            const index = next.findIndex((candidate) => candidate.entity_id === snapshot.entity_id)
            if (index >= 0) next[index] = snapshot
            else next.push(snapshot)
          })
          return next
        })
      }

      const stateChanged = realized.some(
        (snapshot) => previousStateMap.get(snapshot.entity_id) !== snapshot.state,
      )

      if (stateChanged) return
      if (attempt < 3) await waitForRefresh(250)
    }

    await refreshEntities(true)
  }

  const handleExecute = async (command: EntityCommand) => {
    try {
      setError('')
      await callService(haUrl, token, command.domain, command.service, command.data ?? {})
      await forceRefreshEntities(command.refreshTargets ?? [])
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to complete action.'
      setError(message)
    }
  }

  const handleConnectionSave = async () => {
    setSavingConnection(true)
    try {
      await saveRuntimeConfig(draftHaUrl, draftToken)
      setHaUrl(draftHaUrl.trim())
      setToken(draftToken.trim())
      setError('')
      const nextRoute: RouteState = { kind: 'dashboard' }
      pushRoute(nextRoute)
      setRoute(nextRoute)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to save connection settings.'
      setError(message)
    } finally {
      setSavingConnection(false)
    }
  }

  const activeProfileKey = resolveProfileKey(deviceId, settings.deviceProfiles)
  const activeProfile = activeProfileKey ? settings.profiles?.[activeProfileKey] : undefined
  const accentColor = settings.globalSettings?.accentColor ?? '#8fe3ff'

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--accent-color', accentColor)
    }
  }, [accentColor])

  const visibilitySet = new Set(settings.enabledEntities)
  const hiddenSet = new Set([
    ...(settings.globalSettings?.hiddenEntities ?? []),
    ...(activeProfile?.hiddenEntities ?? []),
  ])
  const nameOverrides = {
    ...settings.nameOverrides,
    ...(activeProfile?.nameOverrides ?? {}),
  }
  const categoryMap = {
    ...settings.categoryMap,
    ...(activeProfile?.categoryMap ?? {}),
  }

  const orderedEntities = [...entities].sort((left, right) => {
    const leftIndex = settings.entityOrder.indexOf(left.entity_id)
    const rightIndex = settings.entityOrder.indexOf(right.entity_id)

    if (leftIndex === -1 && rightIndex === -1) return left.entity_id.localeCompare(right.entity_id)
    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1
    return leftIndex - rightIndex
  })

  const visibleEntities = orderedEntities.filter((entity) => {
    if (visibilitySet.size > 0 && !visibilitySet.has(entity.entity_id)) return false
    if (hiddenSet.has(entity.entity_id)) return false
    if (categoryMap[entity.entity_id] === 'hidden') return false
    return true
  })

  const filteredEntities = visibleEntities.filter((entity) => {
    if (!search.trim()) return true
    const haystack = `${nameOverrides[entity.entity_id] ?? getFriendlyName(entity)} ${entity.entity_id}`.toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })

  const categories = settings.customCategories.length > 0
    ? [...settings.customCategories]
    : Array.from(new Set(visibleEntities.map((entity) => categoryMap[entity.entity_id] || getDefaultCategory(entity))))

  const featuredEntities = (settings.globalSettings?.featuredEntities?.length ?? 0) > 0
    ? visibleEntities.filter((entity) => settings.globalSettings?.featuredEntities?.includes(entity.entity_id))
    : visibleEntities.slice(0, 4)

  const routeEntities =
    route.kind === 'category'
      ? filteredEntities.filter(
          (entity) => (categoryMap[entity.entity_id] || getDefaultCategory(entity)) === route.category,
        )
      : filteredEntities

  const actionTiles = (settings.actionTiles ?? []).filter((tile) => {
    if (tile.profiles && tile.profiles.length > 0) {
      return tile.profiles.includes(activeProfileKey)
    }

    if (activeProfile?.actionTileIds && activeProfile.actionTileIds.length > 0) {
      return activeProfile.actionTileIds.includes(tile.id)
    }

    return true
  })

  const temperatureSensor = getHeaderEntity(
    entities,
    settings.headerEntities.temperatureEntityId,
    'temperature',
    'sensor.ir_remote_temperature',
  )
  const humiditySensor = getHeaderEntity(
    entities,
    settings.headerEntities.humidityEntityId,
    'humidity',
    'sensor.ir_remote_humidity',
  )
  const doorSensor = getHeaderEntity(
    entities,
    settings.headerEntities.doorContactEntityId,
    'door',
    'binary_sensor.studio_intercom_door_contact',
  )

  const handleActionTile = (tile: PanelActionTile) => {
    if (tile.confirmMessage && !window.confirm(tile.confirmMessage)) {
      return
    }

    if (tile.actionType === 'route') {
      const target = tile.target.startsWith('/') ? tile.target : `/${tile.target}`
      if (target.startsWith('/category/')) {
        const nextRoute: RouteState = {
          kind: 'category',
          category: decodeURIComponent(target.replace('/category/', '')),
        }
        pushRoute(nextRoute)
        setRoute(nextRoute)
        return
      }

      const nextRoute: RouteState =
        target === '/links'
          ? { kind: 'links' }
          : target === '/connection'
            ? { kind: 'connection' }
            : { kind: 'dashboard' }
      pushRoute(nextRoute)
      setRoute(nextRoute)
      return
    }

    window.location.assign(tile.target)
  }

  const handleDoorAction = async () => {
    const entityId = settings.headerEntities.doorActionEntityId || 'button.studio_intercom_open_door'
    if (!entityId) return

    const domain = entityId.split('.')[0]
    const service = domain === 'button' || domain === 'input_button' ? 'press' : 'turn_on'
    await handleExecute({ domain: domain === 'input_button' ? 'button' : domain, service, data: { entity_id: entityId }, refreshTargets: [entityId, settings.headerEntities.doorContactEntityId].filter(Boolean) })
  }

  const connectionPanel = (
    <section className="panel panel--form">
      <div className="section-heading">
        <p className="eyebrow">Connection</p>
        <h2>Runtime endpoint</h2>
      </div>
      <label className="field">
        <span>Home Assistant URL</span>
        <input
          value={draftHaUrl}
          onChange={(event) => setDraftHaUrl(event.target.value)}
          placeholder="https://homeassistant.local:8123"
        />
      </label>
      <label className="field">
        <span>Long-lived access token</span>
        <textarea
          value={draftToken}
          onChange={(event) => setDraftToken(event.target.value)}
          rows={5}
          placeholder="Paste token"
        />
      </label>
      <button className="primary-button" onClick={handleConnectionSave} disabled={savingConnection}>
        {savingConnection ? 'Saving…' : 'Save connection'}
      </button>
      <p className="muted">
        This is the only writable panel surface. Profiles, hidden devices, labels, and launchers stay managed from Home Assistant.
      </p>
    </section>
  )

  return (
    <div className="app-shell">
      <div className="ambient ambient--top" />
      <div className="ambient ambient--bottom" />

      <header className="hero panel">
        <div>
          <p className="eyebrow">
            {activeProfile?.label ?? (activeProfileKey ? formatLabel(activeProfileKey) : 'Default profile')}
          </p>
          <h1>{settings.globalSettings?.title ?? 'Studio Panel'}</h1>
          <p className="hero__subtitle">
            {settings.globalSettings?.subtitle ?? 'Fast, lightweight control surface for studio and home spaces.'}
          </p>
        </div>
        <div className="hero__meta">
          <div>
            <span>Temp</span>
            <strong>
              {temperatureSensor
                ? `${temperatureSensor.state}${getMeasurementUnit(temperatureSensor) || '°'}`
                : '--'}
            </strong>
          </div>
          <div>
            <span>Humidity</span>
            <strong>
              {humiditySensor
                ? `${humiditySensor.state}${getMeasurementUnit(humiditySensor) || '%'}`
                : '--'}
            </strong>
          </div>
          <div>
            <span>Entry</span>
            <strong>{doorSensor ? formatLabel(doorSensor.state) : '--'}</strong>
          </div>
        </div>
      </header>

      <nav className="topbar">
        <div className="topbar__left">
          <button
            className={route.kind === 'dashboard' ? 'chip chip--active' : 'chip'}
            onClick={() => {
              const nextRoute: RouteState = { kind: 'dashboard' }
              pushRoute(nextRoute)
              setRoute(nextRoute)
            }}
          >
            Dashboard
          </button>
          {categories.map((category) => (
            <button
              key={category}
              className={route.kind === 'category' && route.category === category ? 'chip chip--active' : 'chip'}
              onClick={() => {
                const nextRoute: RouteState = { kind: 'category', category }
                pushRoute(nextRoute)
                setRoute(nextRoute)
              }}
            >
              {category}
            </button>
          ))}
          {actionTiles.length > 0 ? (
            <button
              className={route.kind === 'links' ? 'chip chip--active' : 'chip'}
              onClick={() => {
                const nextRoute: RouteState = { kind: 'links' }
                pushRoute(nextRoute)
                setRoute(nextRoute)
              }}
            >
              Links
            </button>
          ) : null}
        </div>
        <div className="topbar__right">
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search entities"
          />
          <button
            className={route.kind === 'connection' ? 'chip chip--active' : 'chip'}
            onClick={() => {
              const nextRoute: RouteState = { kind: 'connection' }
              pushRoute(nextRoute)
              setRoute(nextRoute)
            }}
          >
            Connection
          </button>
        </div>
      </nav>

      {error ? <p className="status status--error">{error}</p> : null}
      {storageError ? <p className="status status--warning">{storageError}</p> : null}

      {!connectionReady ? (
        <main className="content-grid content-grid--single">{connectionPanel}</main>
      ) : (
        <main className="content-grid">
          <section className="content-main">
            {route.kind === 'connection' ? connectionPanel : null}

            {route.kind !== 'connection' ? (
              <>
                <section className="featured-grid">
                  {featuredEntities.map((entity) => (
                    <EntityCard
                      key={entity.entity_id}
                      entity={entity}
                      displayName={nameOverrides[entity.entity_id] ?? getFriendlyName(entity)}
                      highlighted
                      onExecute={handleExecute}
                    />
                  ))}
                </section>

                <section className="panel panel--section">
                  <div className="section-heading">
                    <p className="eyebrow">
                      {route.kind === 'category'
                        ? route.category
                        : route.kind === 'links'
                          ? 'Launchers'
                          : 'Live controls'}
                    </p>
                    <h2>
                      {route.kind === 'category'
                        ? `${route.category} devices`
                        : route.kind === 'links'
                          ? 'Custom actions'
                          : 'All visible devices'}
                    </h2>
                    <p className="muted">
                      Updated {lastUpdated || 'not yet synced'}
                      {loading ? ' · syncing' : ''}
                    </p>
                  </div>

                  {route.kind === 'links' ? (
                    <div className="action-grid">
                      {actionTiles.length > 0 ? (
                        actionTiles.map((tile) => (
                          <ActionTile key={tile.id} tile={tile} onOpen={handleActionTile} />
                        ))
                      ) : (
                        <p className="empty-state">No launcher tiles are configured for this profile.</p>
                      )}
                    </div>
                  ) : (
                    <div className="entity-grid">
                      {routeEntities.length > 0 ? (
                        routeEntities.map((entity) => (
                          <EntityCard
                            key={entity.entity_id}
                            entity={entity}
                            displayName={nameOverrides[entity.entity_id] ?? getFriendlyName(entity)}
                            onExecute={handleExecute}
                          />
                        ))
                      ) : (
                        <p className="empty-state">No entities match the current profile and filter.</p>
                      )}
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </section>

          <aside className="content-side">
            <section className="panel panel--section">
              <div className="section-heading">
                <p className="eyebrow">Profile</p>
                <h2>Runtime context</h2>
              </div>
              <dl className="facts">
                <div>
                  <dt>Device id</dt>
                  <dd>{deviceId || 'loading'}</dd>
                </div>
                <div>
                  <dt>Profile key</dt>
                  <dd>{activeProfileKey || 'default'}</dd>
                </div>
                <div>
                  <dt>Visible devices</dt>
                  <dd>{visibleEntities.length}</dd>
                </div>
                <div>
                  <dt>Launchers</dt>
                  <dd>{actionTiles.length}</dd>
                </div>
              </dl>
            </section>

            <section className="panel panel--section">
              <div className="section-heading">
                <p className="eyebrow">Categories</p>
                <h2>Fast jump</h2>
              </div>
              <div className="category-list">
                {categories.map((category) => (
                  <button
                    key={category}
                    className="list-button"
                    onClick={() => {
                      const nextRoute: RouteState = { kind: 'category', category }
                      pushRoute(nextRoute)
                      setRoute(nextRoute)
                    }}
                  >
                    <span>{category}</span>
                    <strong>
                      {
                        visibleEntities.filter(
                          (entity) => (categoryMap[entity.entity_id] || getDefaultCategory(entity)) === category,
                        ).length
                      }
                    </strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel panel--section">
              <div className="section-heading">
                <p className="eyebrow">Operations</p>
                <h2>Management boundary</h2>
              </div>
              <p className="muted">
                Device visibility, launcher tiles, labels, and per-device rules are read from Home Assistant server-side settings. Use Home Assistant services or integration tools for administration.
              </p>
              <button className="secondary-button" onClick={() => void handleDoorAction()}>
                Trigger door action
              </button>
            </section>
          </aside>
        </main>
      )}
    </div>
  )
}

export default App
