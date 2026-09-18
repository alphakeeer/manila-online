import { BERTH_RULES, COMMODITIES, COMMODITY_RULES, MARKET_TRACK } from './constants'
import type { GameState, RuleViolation } from './types'

export function validateState(state: GameState): RuleViolation[] {
  const violations: RuleViolation[] = []
  const add = (code: string, message: string) => violations.push({ code, message })

  if (state.players.length < 3 || state.players.length > 5) {
    add('INVALID_PLAYER_COUNT', '玩家人数不在 3–5 人范围内')
  }
  for (const player of state.players) {
    if (!Number.isInteger(player.pesos) || player.pesos < 0) {
      add('NEGATIVE_PESOS', `${player.id} 的资金非法`)
    }
    const tokens = state.accomplices.filter((token) => token.playerId === player.id)
    if (tokens.length !== player.accompliceTotal) {
      add('ACCOMPLICE_COUNT', `${player.id} 的同伙数量非法`)
    }
  }
  const shareIds = [...state.players.flatMap((player) => player.shares), ...state.shareSupply].map((share) => share.id)
  if (new Set(shareIds).size !== shareIds.length) {
    add('DUPLICATE_SHARE', '股份出现重复')
  }
  for (const commodity of COMMODITIES) {
    const count = [...state.players.flatMap((player) => player.shares), ...state.shareSupply]
      .filter((share) => share.commodity === commodity).length
    if (count !== 5) add('SHARE_CONSERVATION', `${commodity} 股份总数不是 5`)
    if (!MARKET_TRACK.includes(state.market[commodity])) add('INVALID_MARKET', `${commodity} 行情非法`)
  }
  const occupied = state.accomplices.filter((token) => token.location !== null)
  const locationKeys = occupied.map((token) => JSON.stringify(token.location))
  if (new Set(locationKeys).size !== locationKeys.length) {
    add('DUPLICATE_PLACEMENT', '同伙位被重复占用')
  }
  for (const token of occupied) {
    const location = token.location
    if (location?.area !== 'cargo') continue
    const cargoBoat = state.boats.find((candidate) => candidate.id === location.boatId)
    if (!cargoBoat?.commodity || location.slot < 0 || location.slot >= COMMODITY_RULES[cargoBoat.commodity].placementCosts.length) {
      add('INVALID_CARGO_SLOT', `${token.id} 所在的货物同伙位非法`)
    }
  }
  const berthedBoatIds = [
    ...Object.values(state.portBerths),
    ...Object.values(state.shipyardBerths),
  ].filter((id): id is string => id !== undefined)
  if (new Set(berthedBoatIds).size !== berthedBoatIds.length) {
    add('DUPLICATE_BERTHED_BOAT', '同一艘舢板占用了多个泊位')
  }
  for (const boat of state.boats) {
    if (boat.status === 'sailing' && (!Number.isInteger(boat.position) || boat.position === null || boat.position < 0 || boat.position > 13 || boat.berth !== null)) {
      add('INVALID_SAILING_BOAT', `${boat.id} 的航行状态非法`)
    }
    if (boat.status === 'port' && (!boat.berth || state.portBerths[boat.berth] !== boat.id)) {
      add('BERTH_MISMATCH', `${boat.id} 与港口泊位记录不一致`)
    }
    if (boat.status === 'shipyard' && (!boat.berth || state.shipyardBerths[boat.berth] !== boat.id)) {
      add('BERTH_MISMATCH', `${boat.id} 与修船厂泊位记录不一致`)
    }
  }
  for (const rule of BERTH_RULES) {
    const portBoat = state.portBerths[rule.berth]
    if (portBoat && !state.boats.some((boat) => boat.id === portBoat && boat.status === 'port' && boat.berth === rule.berth)) {
      add('BERTH_MISMATCH', `港口 ${rule.berth} 的舢板记录不一致`)
    }
    const shipyardBoat = state.shipyardBerths[rule.berth]
    if (shipyardBoat && !state.boats.some((boat) => boat.id === shipyardBoat && boat.status === 'shipyard' && boat.berth === rule.berth)) {
      add('BERTH_MISMATCH', `修船厂 ${rule.berth} 的舢板记录不一致`)
    }
  }
  const launched = state.boats.filter((boat) => boat.startPosition !== null)
  if (launched.length === 3) {
    const sum = launched.reduce((total, boat) => total + (boat.startPosition ?? 0), 0)
    if (sum !== 9) add('INVALID_START_SUM', '三艘舢板起始格之和不是 9')
    const lanes = launched.map((boat) => boat.lane)
    if (new Set(lanes).size !== 3) add('DUPLICATE_LANE', '舢板航线不唯一')
    const commodities = launched.map((boat) => boat.commodity)
    if (new Set(commodities).size !== 3 || commodities.some((commodity) => commodity === null)) {
      add('DUPLICATE_CARGO', '三艘舢板装载的货物不唯一')
    }
  }
  return violations
}
