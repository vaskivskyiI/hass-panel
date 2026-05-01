import type { PanelActionTile } from '../types/settings'

type Props = {
  tile: PanelActionTile
  onOpen: (tile: PanelActionTile) => void
}

export function ActionTile({ tile, onOpen }: Props) {
  return (
    <button className="action-tile" onClick={() => onOpen(tile)}>
      <span className="action-tile__label">{tile.label}</span>
      <span className="action-tile__meta">{tile.actionType}</span>
    </button>
  )
}
