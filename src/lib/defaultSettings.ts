import type { HeaderEntityConfig, PanelSettings } from '../types/settings'

const defaultHeaderEntities = (): HeaderEntityConfig => ({
  temperatureEntityId: '',
  humidityEntityId: '',
  doorContactEntityId: '',
  doorActionEntityId: '',
})

export const createDefaultPanelSettings = (): PanelSettings => ({
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
  headerEntities: defaultHeaderEntities(),
  globalSettings: {
    title: 'Studio Panel',
    subtitle: 'Fast controls for Home Assistant spaces',
    accentColor: '#8fe3ff',
    hiddenEntities: [],
    featuredEntities: [],
  },
  profiles: {},
  deviceProfiles: {},
  actionTiles: [],
})
