export type HaEntity = {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

export type SceneButton = {
  id: string
  label: string
}

export type ActionTile = {
  id: string
  label: string
  icon?: string
  actionType: 'url' | 'app' | 'route'
  target: string
  confirmMessage?: string | null
  profiles?: string[]
}

export type ProfileConfig = {
  label: string
  hiddenEntities: string[]
  categoryMap: Record<string, string>
  nameOverrides: Record<string, string>
  actionTileIds: string[]
}

export type RuntimeConfig = {
  haUrl: string
  haToken: string
  requestId?: string
}

export type Settings = {
  enabledEntities: string[]
  entityOrder: string[]
  nameOverrides: Record<string, string>
  categoryMap: Record<string, string>
  cardWidths: Record<string, 'single' | 'double'>
  showIcons: Record<string, boolean>
  titleModes: Record<string, 'name' | 'name_icon' | 'icon'>
  stateLabels: Record<string, { on: string; off: string }>
  customCategories: string[]
  categoryPinHashes: Record<string, string>
  categoryIcons: Record<string, string>
  categoryDisplayModes: Record<string, 'name' | 'icon' | 'name_icon'>
  categoryParents: Record<string, string>
  categoryTopText: Record<string, string>
  categoryBottomText: Record<string, string>
  categoryTopEntities: Record<string, string[]>
  categoryBottomEntities: Record<string, string[]>
  sceneButtons: SceneButton[]
  passwordHash: string
  headerEntities: {
    temperatureEntityId: string
    humidityEntityId: string
    doorContactEntityId: string
    doorActionEntityId: string
  }
  globalSettings: {
    title: string
    subtitle: string
    accentColor: string
    hiddenEntities: string[]
    featuredEntities: string[]
  }
  profiles: Record<string, ProfileConfig>
  deviceProfiles: Record<string, string>
  actionTiles: ActionTile[]
  requestId?: string
}
