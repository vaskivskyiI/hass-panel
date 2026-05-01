import type { HaEntity } from '../types/ha'

export const getDomain = (entityId: string) => entityId.split('.')[0] ?? ''

export const formatLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

export const getFriendlyName = (entity: HaEntity) => {
  const raw = entity.attributes.friendly_name
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw
    : formatLabel(entity.entity_id.split('.')[1] ?? entity.entity_id)
}

export const getDisplayState = (entity: HaEntity) => {
  if (entity.state === 'unavailable') return 'Unavailable'
  if (entity.state === 'unknown') return 'Unknown'
  return formatLabel(entity.state)
}

export const isEntityActive = (entity: HaEntity) => {
  const domain = getDomain(entity.entity_id)
  if (domain === 'climate') {
    return entity.state !== 'off' && entity.state !== 'unavailable'
  }

  return ['on', 'open', 'opening', 'unlocked', 'playing', 'home', 'heat', 'cool'].includes(
    entity.state,
  )
}

export const getMeasurementUnit = (entity?: HaEntity) => {
  const unit = entity?.attributes.unit_of_measurement
  return typeof unit === 'string' ? unit : ''
}

export const getDefaultCategory = (entity: HaEntity) => {
  const domain = getDomain(entity.entity_id)
  if (['light', 'switch', 'fan', 'cover'].includes(domain)) return 'Controls'
  if (['climate', 'humidifier'].includes(domain)) return 'Climate'
  if (['lock', 'alarm_control_panel', 'binary_sensor', 'button'].includes(domain)) {
    return 'Security'
  }
  if (['scene', 'script', 'automation', 'media_player', 'vacuum'].includes(domain)) {
    return 'Actions'
  }
  return 'General'
}

export const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
