import { useState } from 'react'
import type { EntityCommand, HaEntity } from '../types/ha'
import { getDisplayState, getDomain, getMeasurementUnit, isEntityActive, toNumber } from '../lib/entityModel'

type Props = {
  entity: HaEntity
  displayName: string
  highlighted?: boolean
  onExecute: (command: EntityCommand) => void
}

const climateModes = ['auto', 'heat', 'cool', 'dry', 'fan_only', 'off']

const buildToggleCommand = (entity: HaEntity): EntityCommand => ({
  domain: getDomain(entity.entity_id),
  service: isEntityActive(entity) ? 'turn_off' : 'turn_on',
  data: { entity_id: entity.entity_id },
  refreshTargets: [entity.entity_id],
})

export function EntityCard({ entity, displayName, highlighted = false, onExecute }: Props) {
  const domain = getDomain(entity.entity_id)
  const unit = getMeasurementUnit(entity)

  const renderControls = () => {
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

  return (
    <article className={`entity-card${highlighted ? ' entity-card--highlighted' : ''}`}>
      <div className="entity-card__header">
        <div>
          <p className="entity-card__domain">{domain}</p>
          <h3>{displayName}</h3>
        </div>
        <span className={`entity-card__state${isEntityActive(entity) ? ' entity-card__state--active' : ''}`}>
          {getDisplayState(entity)}
        </span>
      </div>
      {renderControls()}
      <p className="entity-card__id">{entity.entity_id}</p>
    </article>
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
          min="16"
          max="30"
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
