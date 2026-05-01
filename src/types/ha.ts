export type HaAttributes = Record<string, unknown>

export type HaEntity = {
  entity_id: string
  state: string
  attributes: HaAttributes
}

export type EntityCommand = {
  domain: string
  service: string
  data?: Record<string, unknown>
  refreshTargets?: string[]
}

export type RouteState =
  | { kind: 'dashboard' }
  | { kind: 'category'; category: string }
  | { kind: 'links' }
  | { kind: 'connection' }
