import type { CSSProperties } from 'react'
import type { Commodity, GameState } from '../game'
import { commodityPresentation } from './commodityPresentation'

const sourceSize = { width: 1112, height: 2183 }
const calibration = {
  corners: [{ x: 800, y: 1770 }, { x: 1100, y: 1770}, { x: 1100, y: 2080 }, { x: 800, y: 2080 }],
  cellSize: { width: 60, height: 60 }, rows: 5, columns: 4,
} as const
const marketColumns = ['nutmeg', 'silk', 'ginseng', 'jade'] as const satisfies readonly Commodity[]
const marketValues = [30, 20, 10, 5, 0] as const

function pointAt(row: number, column: number) {
  const u = (column + .5) / calibration.columns
  const v = (row + .5) / calibration.rows
  const top = { x: calibration.corners[0].x + (calibration.corners[1].x - calibration.corners[0].x) * u, y: calibration.corners[0].y + (calibration.corners[1].y - calibration.corners[0].y) * u }
  const bottom = { x: calibration.corners[3].x + (calibration.corners[2].x - calibration.corners[3].x) * u, y: calibration.corners[3].y + (calibration.corners[2].y - calibration.corners[3].y) * u }
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v }
}

function positionStyle(point: { x: number; y: number }): CSSProperties {
  return { left: `${(point.x / sourceSize.width) * 100}%`, top: `${(point.y / sourceSize.height) * 100}%` }
}

export function MarketPriceTrack({ state, changedCommodities }: { state: GameState; changedCommodities: readonly Commodity[] }) {
  return <div className="market-price-track" aria-label="商品市价轨道">
    {marketValues.flatMap((value, row) => marketColumns.map((commodity, column) => <span key={`${commodity}-${value}`} className={`market-cell${state.market[commodity] === value ? ' highlighted' : ''}`} aria-label={`行情格：${commodityPresentation(commodity).label}，${value}`} style={{ ...positionStyle(pointAt(row, column)), width: `${(calibration.cellSize.width / sourceSize.width) * 100}%`, height: `${(calibration.cellSize.height / sourceSize.height) * 100}%` }} />))}
    {marketColumns.map((commodity) => {
      const value = state.market[commodity]
      const row = marketValues.indexOf(value)
      return <span key={commodity} className={`market-marker market-marker--${commodity}${changedCommodities.includes(commodity) ? ' is-moving' : ''}`} aria-label={`${commodityPresentation(commodity).label}行情标记：${value}`} style={positionStyle(pointAt(row, marketColumns.indexOf(commodity)))} />
    })}
  </div>
}
