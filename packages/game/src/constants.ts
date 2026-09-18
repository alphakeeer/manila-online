import type { Commodity, PlacementArea } from './types'

export const COMMODITIES = ['nutmeg', 'silk', 'jade', 'ginseng'] as const

export const MARKET_TRACK = [0, 5, 10, 20, 30] as const

export const COMMODITY_RULES: Record<Commodity, {
  profit: number
  placementCosts: readonly number[]
}> = {
  nutmeg: { profit: 24, placementCosts: [2, 3, 4] },
  silk: { profit: 30, placementCosts: [3, 4, 5] },
  jade: { profit: 36, placementCosts: [3, 4, 5, 5] },
  ginseng: { profit: 18, placementCosts: [1, 2, 3] },
}

export const BERTH_RULES = [
  { berth: 'A', cost: 4, payout: 6 },
  { berth: 'B', cost: 3, payout: 8 },
  { berth: 'C', cost: 2, payout: 15 },
] as const

export const SPECIAL_PLACEMENT_COSTS: Record<Exclude<PlacementArea, 'cargo' | 'port' | 'shipyard' | 'insurance'>, number> = {
  pirateCaptain: 5,
  pirateCrew: 5,
  smallPilot: 2,
  largePilot: 5,
}

export const INSURANCE_INCOME = 10
export const MORTGAGE_INCOME = 12
export const REDEEM_COST = 15

