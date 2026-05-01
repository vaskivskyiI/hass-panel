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
  fetchPanelEntities,
  fetchPanelSettings,
  savePanelSettings,
} from './services/haApi'
import type { EntityCommand, HaEntity, RouteState } from './types/ha'
import type { PanelActionTile, PanelSettings } from './types/settings'
import type { RuntimeConfig } from './runtimeConfig'

const REFRESH_INTERVAL_MS = 3000

const parseRoute = (): RouteState => {
  if (typeof window === 'undefined') return { kind: 'dashboard' }

  const rawPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (rawPath === '/manage') return { kind: 'manage' }
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
        : route.kind === 'manage'
          ? '/manage'
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

const normalizeBooleanMap = (value: unknown): Record<string, boolean> =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
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

const normalizeStringArrayMap = (value: unknown): Record<string, string[]> =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          Array.isArray(entry)
            ? entry.filter((item): item is string => typeof item === 'string')
            : [],
        ]),
      )
    : {}

const hashPin = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value)
  const digest = await window.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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
    categoryTopText: normalizeStringMap(parsed.categoryTopText),
    categoryBottomText: normalizeStringMap(parsed.categoryBottomText),
    categoryTopEntities: normalizeStringArrayMap(parsed.categoryTopEntities),
    categoryBottomEntities: normalizeStringArrayMap(parsed.categoryBottomEntities),
    categoryPinHashes: normalizeStringMap(parsed.categoryPinHashes),
    showIcons: normalizeBooleanMap(parsed.showIcons),
    cardWidths: normalizeCardWidths(parsed.cardWidths),
    entityOrder: normalizeStringArray(parsed.entityOrder),
    customCategories: normalizeStringArray(parsed.customCategories),
    passwordHash: typeof parsed.passwordHash === 'string' ? parsed.passwordHash : '',
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
  const haUrl = runtimeConfig.haUrl ?? ''
  const token = runtimeConfig.haToken ?? ''
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [settings, setSettings] = useState<PanelSettings>(() => createDefaultPanelSettings())
  const [route, setRoute] = useState<RouteState>(() => parseRoute())
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [search, setSearch] = useState('')
  const [pendingCategoryPin, setPendingCategoryPin] = useState('')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [manageUnlocked, setManageUnlocked] = useState(false)
  const [managePinInput, setManagePinInput] = useState('')
  const [managePinError, setManagePinError] = useState('')
  const [draftEnabledEntities, setDraftEnabledEntities] = useState<string[]>([])
  const [draggedEntityId, setDraggedEntityId] = useState('')
  const [draftNameOverrides, setDraftNameOverrides] = useState<Record<string, string>>({})
  const [draftCategoryMap, setDraftCategoryMap] = useState<Record<string, string>>({})
  const [draftCardWidths, setDraftCardWidths] = useState<Record<string, 'single' | 'double'>>({})
  const [draftShowIcons, setDraftShowIcons] = useState<Record<string, boolean>>({})
  const [draftCustomCategories, setDraftCustomCategories] = useState<string[]>([])
  const [draftNewCategory, setDraftNewCategory] = useState('')
  const [manageSaving, setManageSaving] = useState(false)
  const [manageStatus, setManageStatus] = useState('')

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
      } catch (reason) {
        if (cancelled) return
        const message = reason instanceof Error ? reason.message : 'Unable to load panel settings.'
        setError(message)
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
      const data = await fetchPanelEntities(haUrl, token)
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

  useEffect(() => {
    setDraftEnabledEntities((previous) => {
      const known = new Set(orderedEntities.map((entity) => entity.entity_id))
      const retained = previous.filter((entityId) => known.has(entityId))
      if (previous.length > 0) {
        return retained
      }
      const source = settings.enabledEntities.filter((entityId) => known.has(entityId))
      return [...new Set(source)]
    })
  }, [orderedEntities, settings.enabledEntities])

  const visibleEntities = orderedEntities.filter((entity) => {
    if (!visibilitySet.has(entity.entity_id)) return false
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
          : target === '/manage'
            ? { kind: 'manage' }
            : { kind: 'dashboard' }
      pushRoute(nextRoute)
      setRoute(nextRoute)
      return
    }

    window.location.assign(tile.target)
  }

  const openCategory = (category: string) => {
    const hash = settings.categoryPinHashes?.[category] ?? ''
    if (hash) {
      setPendingCategoryPin(category)
      setPinInput('')
      setPinError('')
      return
    }
    const nextRoute: RouteState = { kind: 'category', category }
    pushRoute(nextRoute)
    setRoute(nextRoute)
  }

  const submitPin = async () => {
    if (!pendingCategoryPin) return
    const hash = await hashPin(pinInput)
    if (hash === (settings.categoryPinHashes?.[pendingCategoryPin] ?? '')) {
      const category = pendingCategoryPin
      setPendingCategoryPin('')
      setPinInput('')
      setPinError('')
      const nextRoute: RouteState = { kind: 'category', category }
      pushRoute(nextRoute)
      setRoute(nextRoute)
    } else {
      setPinError('Incorrect PIN.')
      setPinInput('')
    }
  }

  const handleDoorAction = async () => {
    const entityId = settings.headerEntities.doorActionEntityId || 'button.studio_intercom_open_door'
    if (!entityId) return

    const domain = entityId.split('.')[0]
    const service = domain === 'button' || domain === 'input_button' ? 'press' : 'turn_on'
    await handleExecute({ domain: domain === 'input_button' ? 'button' : domain, service, data: { entity_id: entityId }, refreshTargets: [entityId, settings.headerEntities.doorContactEntityId].filter(Boolean) })
  }

  const updateEnabledEntity = (entityId: string, enabled: boolean) => {
    setDraftEnabledEntities((previous) => {
      if (enabled) {
        if (previous.includes(entityId)) return previous
        return [...previous, entityId]
      }
      return previous.filter((candidate) => candidate !== entityId)
    })
  }

  const moveEnabledEntity = (entityId: string, targetEntityId: string) => {
    if (!entityId || !targetEntityId || entityId === targetEntityId) return
    setDraftEnabledEntities((previous) => {
      const sourceIndex = previous.indexOf(entityId)
      const targetIndex = previous.indexOf(targetEntityId)
      if (sourceIndex < 0 || targetIndex < 0) return previous
      const next = [...previous]
      next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, entityId)
      return next
    })
  }

  const syncManageDraftFromSettings = () => {
    setDraftEnabledEntities(settings.enabledEntities)
    setDraftNameOverrides(settings.nameOverrides)
    setDraftCategoryMap(settings.categoryMap)
    setDraftCardWidths(settings.cardWidths)
    setDraftShowIcons(settings.showIcons)
    setDraftCustomCategories(settings.customCategories)
    setDraftNewCategory('')
    setManageStatus('')
  }

  const openManage = () => {
    const nextRoute: RouteState = { kind: 'manage' }
    pushRoute(nextRoute)
    setRoute(nextRoute)
    if (!settings.passwordHash) {
      setManageUnlocked(true)
      syncManageDraftFromSettings()
      return
    }
    setManageUnlocked(false)
    setManagePinInput('')
    setManagePinError('')
  }

  const unlockManage = async () => {
    if (!settings.passwordHash) {
      setManageUnlocked(true)
      return
    }
    const candidate = await hashPin(managePinInput)
    if (candidate === settings.passwordHash) {
      setManageUnlocked(true)
      setManagePinError('')
      setManagePinInput('')
      syncManageDraftFromSettings()
      return
    }
    setManagePinError('Incorrect password.')
    setManagePinInput('')
  }

  const updateDraftNameOverride = (entityId: string, value: string) => {
    setDraftNameOverrides((previous) => ({ ...previous, [entityId]: value }))
  }

  const updateDraftCategory = (entityId: string, value: string) => {
    setDraftCategoryMap((previous) => ({ ...previous, [entityId]: value }))
    if (value.trim() && !draftCustomCategories.includes(value.trim())) {
      setDraftCustomCategories((previous) => [...previous, value.trim()])
    }
  }

  const updateDraftWidth = (entityId: string, value: 'single' | 'double') => {
    setDraftCardWidths((previous) => ({ ...previous, [entityId]: value }))
  }

  const updateDraftShowIcon = (entityId: string, value: boolean) => {
    setDraftShowIcons((previous) => ({ ...previous, [entityId]: value }))
  }

  const addCustomCategory = () => {
    const value = draftNewCategory.trim()
    if (!value) return
    if (draftCustomCategories.includes(value)) {
      setDraftNewCategory('')
      return
    }
    setDraftCustomCategories((previous) => [...previous, value])
    setDraftNewCategory('')
  }

  const removeCustomCategory = (category: string) => {
    setDraftCustomCategories((previous) => previous.filter((candidate) => candidate !== category))
  }

  const saveManageSettings = async () => {
    setManageSaving(true)
    setManageStatus('Saving settings...')
    try {
      const payload: PanelSettings = {
        ...settings,
        enabledEntities: [...draftEnabledEntities],
        entityOrder: [...draftEnabledEntities],
        nameOverrides: { ...draftNameOverrides },
        categoryMap: { ...draftCategoryMap },
        cardWidths: { ...draftCardWidths },
        showIcons: { ...draftShowIcons },
        customCategories: [...draftCustomCategories],
      }

      await savePanelSettings(haUrl, token, payload as unknown as Record<string, unknown>)
      const refreshed = await fetchPanelSettings<unknown>(haUrl, token)
      setSettings(normalizePanelSettings(refreshed))
      setManageStatus('Saved.')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Unable to save settings.'
      setManageStatus(message)
    } finally {
      setManageSaving(false)
    }
  }

  const configRequiredPanel = (
    <section className="panel panel--section">
      <div className="section-heading">
        <p className="eyebrow">Setup Required</p>
        <h2>Runtime connection is missing</h2>
      </div>
      <p className="muted">
        Runtime URL and token editing from this frontend is disabled. Configure runtime values directly in the deployed runtime config file and reload the page.
      </p>
    </section>
  )

  const managePanel = (
    <section className="panel panel--section manage-panel">
      <div className="section-heading">
        <p className="eyebrow">Protected Setup</p>
        <h2>Panel manager</h2>
        <p className="muted">Configure panel entities visually and save directly.</p>
      </div>

      {!manageUnlocked && settings.passwordHash ? (
        <div className="manage-lock">
          <input
            className="search-input"
            type="password"
            placeholder="Enter admin password"
            value={managePinInput}
            onChange={(event) => setManagePinInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void unlockManage()
            }}
          />
          <button className="primary-button" onClick={() => void unlockManage()}>
            Unlock
          </button>
          {managePinError ? <p className="status status--error">{managePinError}</p> : null}
        </div>
      ) : (
        <>
          <section className="manage-categories">
            <h3>Categories</h3>
            <div className="manage-categories__add">
              <input
                className="search-input"
                value={draftNewCategory}
                onChange={(event) => setDraftNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addCustomCategory()
                }}
                placeholder="Add category"
              />
              <button className="secondary-button" onClick={addCustomCategory}>
                Add
              </button>
            </div>
            <div className="manage-categories__chips">
              {draftCustomCategories.map((category) => (
                <button
                  key={category}
                  className="chip"
                  onClick={() => removeCustomCategory(category)}
                  title="Remove category"
                >
                  {category} ×
                </button>
              ))}
            </div>
          </section>

          <div className="manage-grid">
            <section className="manage-list">
              <h3>All entities</h3>
              {orderedEntities.length === 0 ? (
                <p className="empty-state">No entities synced yet. Press Refresh to pull latest from Home Assistant.</p>
              ) : null}
              {orderedEntities.map((entity) => {
                const checked = draftEnabledEntities.includes(entity.entity_id)
                const categoryValue = draftCategoryMap[entity.entity_id] || getDefaultCategory(entity)
                return (
                  <div key={entity.entity_id} className="manage-row manage-row--editor">
                    <label className="manage-row__toggle">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => updateEnabledEntity(entity.entity_id, event.target.checked)}
                      />
                      <span>{entity.entity_id}</span>
                    </label>
                    <label>
                      <span>Name</span>
                      <input
                        className="search-input"
                        value={draftNameOverrides[entity.entity_id] ?? ''}
                        onChange={(event) =>
                          updateDraftNameOverride(entity.entity_id, event.target.value)
                        }
                        placeholder={getFriendlyName(entity)}
                      />
                    </label>
                    <label>
                      <span>Category</span>
                      <input
                        className="search-input"
                        value={categoryValue}
                        onChange={(event) => updateDraftCategory(entity.entity_id, event.target.value)}
                        list="manage-categories-list"
                      />
                    </label>
                    <div className="manage-row__inline">
                      <label>
                        <span>Width</span>
                        <select
                          value={draftCardWidths[entity.entity_id] ?? 'single'}
                          onChange={(event) =>
                            updateDraftWidth(entity.entity_id, event.target.value as 'single' | 'double')
                          }
                        >
                          <option value="single">Single</option>
                          <option value="double">Double</option>
                        </select>
                      </label>
                      <label className="manage-row__icon-toggle">
                        <span>Icon</span>
                        <input
                          type="checkbox"
                          checked={draftShowIcons[entity.entity_id] !== false}
                          onChange={(event) =>
                            updateDraftShowIcon(entity.entity_id, event.target.checked)
                          }
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
              <datalist id="manage-categories-list">
                {draftCustomCategories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </section>

            <section className="manage-list">
              <h3>Visible order (drag and drop)</h3>
              {draftEnabledEntities.length === 0 ? (
                <p className="empty-state">No entities enabled yet.</p>
              ) : (
                draftEnabledEntities.map((entityId) => (
                  <div
                    key={entityId}
                    className="manage-row manage-row--draggable"
                    draggable
                    onDragStart={() => setDraggedEntityId(entityId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => moveEnabledEntity(draggedEntityId, entityId)}
                  >
                    <span>{nameOverrides[entityId] ?? entityId}</span>
                    <small>{entityId}</small>
                  </div>
                ))
              )}
            </section>
          </div>

          <div className="manage-actions">
            <button
              className="primary-button"
              onClick={() => void saveManageSettings()}
              disabled={manageSaving}
            >
              {manageSaving ? 'Saving...' : 'Save Settings'}
            </button>
            <button className="secondary-button" onClick={() => void refreshEntities(false)}>
              Refresh from HA
            </button>
            <button className="secondary-button" onClick={syncManageDraftFromSettings}>
              Reset Draft
            </button>
            {manageStatus ? <p className="muted">{manageStatus}</p> : null}
          </div>
        </>
      )}
    </section>
  )

  return (
    <div className="app-shell">
      <div className="ambient ambient--top" />
      <div className="ambient ambient--bottom" />

      <header className="hero panel">
        <div className="hero__main">
          <p className="eyebrow">
            {activeProfile?.label ?? (activeProfileKey ? formatLabel(activeProfileKey) : 'Default profile')}
          </p>
          <h1>{settings.globalSettings?.title ?? 'Studio Panel'}</h1>
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
          {settings.headerEntities.doorActionEntityId ? (
            <button className="secondary-button hero__action" onClick={() => void handleDoorAction()}>
              Open door
            </button>
          ) : null}
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
              onClick={() => openCategory(category)}
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
            className={route.kind === 'manage' ? 'chip chip--active' : 'chip'}
            onClick={openManage}
          >
            Manage
          </button>
        </div>
      </nav>

      {error ? <p className="status status--error">{error}</p> : null}

      {!connectionReady ? (
        <main className="content-grid content-grid--single">{configRequiredPanel}</main>
      ) : (
        <main className="content-grid content-grid--single">
          <section className="content-main">
            {route.kind === 'manage' ? (
              managePanel
            ) : (
              <>
                {route.kind === 'dashboard' && featuredEntities.length > 0 ? (
                  <section className="featured-grid">
                    {featuredEntities.map((entity) => (
                      <EntityCard
                        key={entity.entity_id}
                        entity={entity}
                        displayName={nameOverrides[entity.entity_id] ?? getFriendlyName(entity)}
                        highlighted
                        showIcon={settings.showIcons[entity.entity_id] !== false}
                        isWide={settings.cardWidths[entity.entity_id] === 'double'}
                        onExecute={handleExecute}
                      />
                    ))}
                  </section>
                ) : null}

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
                            showIcon={settings.showIcons[entity.entity_id] !== false}
                            isWide={settings.cardWidths[entity.entity_id] === 'double'}
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
            )}
          </section>
        </main>
      )}

      {pendingCategoryPin ? (
        <div className="pin-overlay">
          <div className="pin-dialog panel">
            <p className="eyebrow">PIN required</p>
            <h2>{pendingCategoryPin}</h2>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Enter PIN"
              autoFocus
              value={pinInput}
              className="search-input"
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitPin()
              }}
            />
            {pinError ? <p className="status status--error">{pinError}</p> : null}
            <div className="pin-dialog__actions">
              <button className="primary-button" onClick={() => void submitPin()}>
                Unlock
              </button>
              <button className="secondary-button" onClick={() => setPendingCategoryPin('')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
