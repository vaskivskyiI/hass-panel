import { useRef, useState } from 'react'
import type { EntityCommand, HaEntity } from '../types/ha'
import { getDisplayState, getDomain, getMeasurementUnit, isEntityActive, toNumber } from '../lib/entityModel'

type Props = {
  entity: HaEntity
  displayName: string
  highlighted?: boolean
  showIcon?: boolean
  isWide?: boolean
  onExecute: (command: EntityCommand) => void
}

// ── Light helpers ─────────────────────────────────────────────────────────────

const rgbToHex = (rgb?: unknown): string => {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#f6dba0'
  const toHex = (v: unknown) =>
    Math.max(0, Math.min(255, toNumber(v, 255))).toString(16).padStart(2, '0')
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = hex.replace('#', '')
  if (n.length !== 6) return [255, 255, 255]
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

const getEntityKelvinBounds = (entity: HaEntity) => {
  const minK = toNumber(entity.attributes.min_color_temp_kelvin, 0)
  const maxK = toNumber(entity.attributes.max_color_temp_kelvin, 0)
  if (minK > 0 && maxK > minK) return { minKelvin: minK, maxKelvin: maxK }
  const minM = toNumber(entity.attributes.min_mireds, 153)
  const maxM = toNumber(entity.attributes.max_mireds, 500)
  return { minKelvin: Math.round(1_000_000 / maxM), maxKelvin: Math.round(1_000_000 / minM) }
}

const getEntityKelvin = (entity: HaEntity): number => {
  if (typeof entity.attributes.color_temp_kelvin === 'number') return entity.attributes.color_temp_kelvin
  if (typeof entity.attributes.color_temp === 'number')
    return Math.round(1_000_000 / entity.attributes.color_temp)
  const { minKelvin, maxKelvin } = getEntityKelvinBounds(entity)
  return Math.round((minKelvin + maxKelvin) / 2)
}

const getLightCapabilities = (entity: HaEntity) => {
  const supported = Array.isArray(entity.attributes.supported_color_modes)
    ? (entity.attributes.supported_color_modes as string[])
    : []
  const colorMode =
    typeof entity.attributes.color_mode === 'string' ? entity.attributes.color_mode : ''
  const supportsRgb =
    supported.some((m) => ['rgb', 'hs', 'rgbw', 'rgbww', 'xy'].includes(m)) ||
    ['rgb', 'hs', 'xy'].includes(colorMode)
  const supportsKelvin =
    supported.some((m) => ['color_temp', 'kelvin'].includes(m)) ||
    ['color_temp', 'kelvin'].includes(colorMode)
  const supportsBrightness =
    supported.length === 0 ||
    supported.some((m) => m !== 'onoff') ||
    (colorMode.length > 0 && colorMode !== 'onoff')
  return { supportsRgb, supportsKelvin, supportsBrightness }
}

// ── Icon mapping ──────────────────────────────────────────────────────────────

const getDomainIcon = (entity: HaEntity): string => {
  const raw = entity.attributes.icon
  if (typeof raw === 'string' && raw.trim()) {
    if (raw.startsWith('mdi:')) return `mdi-${raw.slice(4)}`
    if (raw.startsWith('mdi-')) return raw
  }
  const domain = getDomain(entity.entity_id)
  const dc = String(entity.attributes.device_class ?? '')
  if (domain === 'light') return isEntityActive(entity) ? 'mdi-lightbulb' : 'mdi-lightbulb-outline'
  if (domain === 'climate') return 'mdi-thermostat'
  if (domain === 'switch') return 'mdi-toggle-switch-variant'
  if (domain === 'cover') return 'mdi-window-shutter'
  if (domain === 'lock') return entity.state === 'locked' ? 'mdi-lock' : 'mdi-lock-open-variant'
  if (domain === 'scene') return 'mdi-palette'
  if (domain === 'script' || domain === 'automation') return 'mdi-play-circle-outline'
  if (domain === 'media_player') return 'mdi-speaker'
  if (domain === 'fan') return 'mdi-fan'
  if (domain === 'vacuum') return 'mdi-robot-vacuum'
  if (domain === 'button' || domain === 'input_button') return 'mdi-gesture-tap-button'
  if (domain === 'binary_sensor') {
    if (['door', 'opening', 'garage_door'].includes(dc))
      return entity.state === 'on' ? 'mdi-door-open' : 'mdi-door-closed'
    if (dc === 'motion') return 'mdi-motion-sensor'
    if (dc === 'window') return 'mdi-window-closed-variant'
    if (dc === 'smoke') return 'mdi-smoke-detector'
    if (dc === 'moisture') return 'mdi-water-alert'
    return 'mdi-radar'
  }
  if (domain === 'sensor') {
    if (dc === 'temperature') return 'mdi-thermometer'
    if (dc === 'humidity') return 'mdi-water-percent'
    if (dc === 'power' || dc === 'energy') return 'mdi-lightning-bolt'
    return 'mdi-gauge'
  }
  return 'mdi-help-circle-outline'
}

// ── Shared ────────────────────────────────────────────────────────────────────

const climateModes = ['auto', 'heat', 'cool', 'dry', 'fan_only', 'off']

const buildToggleCommand = (entity: HaEntity): EntityCommand => ({
  domain: getDomain(entity.entity_id),
  service: isEntityActive(entity) ? 'turn_off' : 'turn_on',
  data: { entity_id: entity.entity_id },
  refreshTargets: [entity.entity_id],
})

export function EntityCard({ entity, displayName, highlighted = false, showIcon = true, isWide = false, onExecute }: Props) {
  const domain = getDomain(entity.entity_id)
  const unit = getMeasurementUnit(entity)
  const active = isEntityActive(entity)

  const renderControls = () => {
    if (domain === 'light') {
      return (
        <LightControls
          key={`${entity.entity_id}:${entity.state}:${String(entity.attributes.brightness ?? '')}:${String(entity.attributes.color_temp_kelvin ?? '')}`}
          entity={entity}
          onExecute={onExecute}
        />
      )
    }

    if (domain === 'button' || domain === 'input_button') {
      return (
        <button className="entity-card__primary" onClick={() => onExecute({ domain: 'button', service: 'press', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>
          Trigger
        </button>
      )
    }

    if (domain === 'scene') {
      return (
        <button className="entity-card__primary" onClick={() => onExecute({ domain: 'scene', service: 'turn_on', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>
          Activate
        </button>
      )
    }

    if (domain === 'script' || domain === 'automation') {
      return (
        <button className="entity-card__primary" onClick={() => onExecute({ domain, service: 'turn_on', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>
          Run
        </button>
      )
    }

    if (domain === 'cover') {
      return (
        <div className="entity-card__controls entity-card__controls--triple">
          <button onClick={() => onExecute({ domain: 'cover', service: 'open_cover', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Open</button>
          <button onClick={() => onExecute({ domain: 'cover', service: 'stop_cover', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Stop</button>
          <button onClick={() => onExecute({ domain: 'cover', service: 'close_cover', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Close</button>
        </div>
      )
    }

    if (domain === 'lock') {
      return (
        <div className="entity-card__controls entity-card__controls--dual">
          <button onClick={() => onExecute({ domain: 'lock', service: 'unlock', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Unlock</button>
          <button onClick={() => onExecute({ domain: 'lock', service: 'lock', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Lock</button>
        </div>
      )
    }

    if (domain === 'climate') {
      return (
        <ClimateControls
          key={`${entity.entity_id}:${entity.state}:${String(entity.attributes.temperature ?? '')}`}
          entity={entity}
          unit={unit}
          onExecute={onExecute}
        />
      )
    }

    if (domain === 'media_player') {
      return (
        <MediaControls
          key={`${entity.entity_id}:${entity.state}:${String(entity.attributes.volume_level ?? '')}`}
          entity={entity}
          onExecute={onExecute}
        />
      )
    }

    if (domain === 'fan') {
      return (
        <FanControls
          key={`${entity.entity_id}:${entity.state}:${String(entity.attributes.percentage ?? '')}`}
          entity={entity}
          onExecute={onExecute}
        />
      )
    }

    if (domain === 'vacuum') {
      return (
        <div className="entity-card__controls entity-card__controls--triple">
          <button onClick={() => onExecute({ domain: 'vacuum', service: 'start', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Start</button>
          <button onClick={() => onExecute({ domain: 'vacuum', service: 'pause', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Pause</button>
          <button onClick={() => onExecute({ domain: 'vacuum', service: 'return_to_base', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Dock</button>
        </div>
      )
    }

    if (domain === 'sensor' || domain === 'binary_sensor') {
      return <div className="entity-card__metric">{entity.state}{unit ? ` ${unit}` : ''}</div>
    }

    return (
      <div className="entity-card__controls entity-card__controls--dual">
        <button onClick={() => onExecute(buildToggleCommand(entity))}>{isEntityActive(entity) ? 'Turn off' : 'Turn on'}</button>
        <button onClick={() => onExecute({ domain: 'homeassistant', service: 'toggle', data: { entity_id: entity.entity_id }, refreshTargets: [entity.entity_id] })}>Toggle</button>
      </div>
    )
  }

  const classNames = [
    'entity-card',
    highlighted ? 'entity-card--highlighted' : '',
    active ? 'entity-card--active' : '',
    isWide ? 'entity-card--wide' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classNames}>
      <div className="entity-card__header">
        <div className="entity-card__title-row">
          {showIcon ? (
            <span className={`entity-card__icon mdi ${getDomainIcon(entity)}`} aria-hidden="true" />
          ) : null}
          <h3>{displayName}</h3>
        </div>
        <span className={`entity-card__state${active ? ' entity-card__state--active' : ''}`}>
          {getDisplayState(entity)}
        </span>
      </div>
      {renderControls()}
    </article>
  )
}

// ── Sub-controls ──────────────────────────────────────────────────────────────

function LightControls({
  entity,
  onExecute,
}: {
  entity: HaEntity
  onExecute: (command: EntityCommand) => void
}) {
  const { supportsRgb, supportsKelvin, supportsBrightness } = getLightCapabilities(entity)
  const bounds = getEntityKelvinBounds(entity)
  const debounceRef = useRef<number | null>(null)

  const [brightness, setBrightness] = useState(toNumber(entity.attributes.brightness, 180))
  const [color, setColor] = useState(rgbToHex(entity.attributes.rgb_color))
  const [kelvin, setKelvin] = useState(getEntityKelvin(entity))

  const scheduleApply = (nb: number, nc: string, nk: number) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      const payload: Record<string, unknown> = { entity_id: entity.entity_id }
      if (supportsBrightness) payload.brightness = Math.round(nb)
      if (supportsRgb) {
        payload.rgb_color = hexToRgb(nc)
      } else if (supportsKelvin) {
        payload.color_temp_kelvin = Math.round(nk)
      }
      onExecute({
        domain: 'light',
        service: 'turn_on',
        data: payload,
        refreshTargets: [entity.entity_id],
      })
    }, 200)
  }

  return (
    <div className="entity-card__stack">
      <button
        className={`entity-card__toggle-btn${isEntityActive(entity) ? ' entity-card__toggle-btn--on' : ''}`}
        onClick={() => onExecute(buildToggleCommand(entity))}
      >
        {isEntityActive(entity) ? 'Turn off' : 'Turn on'}
      </button>

      {supportsBrightness ? (
        <label className="entity-card__range">
          <span>Brightness</span>
          <input
            type="range"
            min="1"
            max="255"
            step="1"
            value={brightness}
            style={{ '--slider-color': color } as React.CSSProperties}
            onChange={(e) => {
              const v = Number(e.target.value)
              setBrightness(v)
              scheduleApply(v, color, kelvin)
            }}
          />
          <strong>{Math.round((brightness / 255) * 100)}%</strong>
        </label>
      ) : null}

      {supportsRgb ? (
        <div className="entity-card__range entity-card__range--inline">
          <span>Color</span>
          <input
            type="color"
            className="entity-card__color-input"
            value={color}
            onChange={(e) => {
              setColor(e.target.value)
              scheduleApply(brightness, e.target.value, kelvin)
            }}
          />
        </div>
      ) : null}

      {supportsKelvin ? (
        <label className="entity-card__range">
          <span>Temperature</span>
          <input
            type="range"
            min={bounds.minKelvin}
            max={bounds.maxKelvin}
            step="50"
            value={kelvin}
            onChange={(e) => {
              const v = Number(e.target.value)
              setKelvin(v)
              scheduleApply(brightness, color, v)
            }}
          />
          <strong>{Math.round(kelvin)}K</strong>
        </label>
      ) : null}
    </div>
  )
}

function ClimateControls({
  entity,
  unit,
  onExecute,
}: {
  entity: HaEntity
  unit: string
  onExecute: (command: EntityCommand) => void
}) {
  const [climateTemp, setClimateTemp] = useState(toNumber(entity.attributes.temperature, 22))
  const [climateMode, setClimateMode] = useState(
    typeof entity.attributes.hvac_mode === 'string' ? entity.attributes.hvac_mode : entity.state,
  )

  return (
    <div className="entity-card__stack">
      <label className="entity-card__range">
        <span>Temperature</span>
        <input
          type="range"
          min={toNumber(entity.attributes.min_temp, 16)}
          max={toNumber(entity.attributes.max_temp, 30)}
          step="0.5"
          value={climateTemp}
          onChange={(event) => setClimateTemp(Number(event.target.value))}
          onPointerUp={() =>
            onExecute({
              domain: 'climate',
              service: 'set_temperature',
              data: { entity_id: entity.entity_id, temperature: climateTemp },
              refreshTargets: [entity.entity_id],
            })
          }
        />
        <strong>
          {climateTemp.toFixed(1)}
          {unit || '°C'}
        </strong>
      </label>
      <label className="entity-card__select">
        <span>Mode</span>
        <select
          value={climateMode}
          onChange={(event) => {
            const next = event.target.value
            setClimateMode(next)
            onExecute({
              domain: 'climate',
              service: 'set_hvac_mode',
              data: { entity_id: entity.entity_id, hvac_mode: next },
              refreshTargets: [entity.entity_id],
            })
          }}
        >
          {(Array.isArray(entity.attributes.hvac_modes) ? entity.attributes.hvac_modes : climateModes).map((mode) => (
            <option key={String(mode)} value={String(mode)}>
              {String(mode)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function MediaControls({
  entity,
  onExecute,
}: {
  entity: HaEntity
  onExecute: (command: EntityCommand) => void
}) {
  const [mediaVolume, setMediaVolume] = useState(toNumber(entity.attributes.volume_level, 0.4))

  return (
    <div className="entity-card__stack">
      <div className="entity-card__controls entity-card__controls--dual">
        <button onClick={() => onExecute(buildToggleCommand(entity))}>
          {isEntityActive(entity) ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() =>
            onExecute({
              domain: 'media_player',
              service: 'media_stop',
              data: { entity_id: entity.entity_id },
              refreshTargets: [entity.entity_id],
            })
          }
        >
          Stop
        </button>
      </div>
      <label className="entity-card__range">
        <span>Volume</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={mediaVolume}
          onChange={(event) => setMediaVolume(Number(event.target.value))}
          onPointerUp={() =>
            onExecute({
              domain: 'media_player',
              service: 'volume_set',
              data: { entity_id: entity.entity_id, volume_level: mediaVolume },
              refreshTargets: [entity.entity_id],
            })
          }
        />
      </label>
    </div>
  )
}

function FanControls({
  entity,
  onExecute,
}: {
  entity: HaEntity
  onExecute: (command: EntityCommand) => void
}) {
  const [fanPercent, setFanPercent] = useState(toNumber(entity.attributes.percentage, 50))

  return (
    <div className="entity-card__stack">
      <div className="entity-card__controls entity-card__controls--dual">
        <button onClick={() => onExecute(buildToggleCommand(entity))}>
          {isEntityActive(entity) ? 'Turn off' : 'Turn on'}
        </button>
        <button
          onClick={() =>
            onExecute({
              domain: 'fan',
              service: 'oscillate',
              data: { entity_id: entity.entity_id, oscillating: true },
              refreshTargets: [entity.entity_id],
            })
          }
        >
          Oscillate
        </button>
      </div>
      <label className="entity-card__range">
        <span>Speed</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={fanPercent}
          onChange={(event) => setFanPercent(Number(event.target.value))}
          onPointerUp={() =>
            onExecute({
              domain: 'fan',
              service: 'set_percentage',
              data: { entity_id: entity.entity_id, percentage: fanPercent },
              refreshTargets: [entity.entity_id],
            })
          }
        />
      </label>
    </div>
  )
}
