export type SceneButton = {
  id: string
  label: string
}

export type HeaderEntityConfig = {
  temperatureEntityId: string
  humidityEntityId: string
  doorContactEntityId: string
  doorActionEntityId: string
}

export type PanelActionTile = {
  id: string
  label: string
  icon?: string
  actionType: 'url' | 'app' | 'route'
  target: string
  confirmMessage?: string
  profiles?: string[]
}

export type ProfileConfig = {
  label?: string
  hiddenEntities?: string[]
  categoryMap?: Record<string, string>
  nameOverrides?: Record<string, string>
  actionTileIds?: string[]
}

export type GlobalSettings = {
  title?: string
  subtitle?: string
  accentColor?: string
  hiddenEntities?: string[]
  featuredEntities?: string[]
}

export type PanelSettings = {
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
  globalSettings?: GlobalSettings
  profiles?: Record<string, ProfileConfig>
  deviceProfiles?: Record<string, string>
  actionTiles?: PanelActionTile[]
}
