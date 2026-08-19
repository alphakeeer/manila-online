import type { COMMODITIES, MARKET_TRACK } from './constants'

export type Commodity = (typeof COMMODITIES)[number]
export type MarketValue = (typeof MARKET_TRACK)[number]
export type PirateVariant = 'standard' | 'strengthened'
export type Berth = 'A' | 'B' | 'C'
export type Lane = 0 | 1 | 2

export interface PlayerConfig {
  id: string
  name: string
}

export interface GameConfig {
  players: PlayerConfig[]
  startingPlayerId: string
  seed: number
  pirateVariant?: PirateVariant
}

export interface Share {
  id: string
  commodity: Commodity
  mortgaged: boolean
}

export interface Player {
  id: string
  name: string
  pesos: number
  shares: Share[]
  accompliceTotal: number
  passedPlacement: boolean
}

export type PlacementArea =
  | 'cargo'
  | 'port'
  | 'shipyard'
  | 'pirateCaptain'
  | 'pirateCrew'
  | 'smallPilot'
  | 'largePilot'
  | 'insurance'

export type AccompliceLocation =
  | { area: 'cargo'; boatId: string; slot: number }
  | { area: 'port' | 'shipyard'; berth: Berth }
  | { area: Exclude<PlacementArea, 'cargo' | 'port' | 'shipyard'> }

export interface Accomplice {
  id: string
  playerId: string
  location: AccompliceLocation | null
}

export interface Boat {
  id: string
  commodity: Commodity | null
  lane: Lane | null
  startPosition: number | null
  position: number | null
  status: 'unlaunched' | 'sailing' | 'port' | 'shipyard'
  berth: Berth | null
  plundered: boolean
}

export interface RngState {
  algorithm: 'mulberry32-v1'
  value: number
}

export interface AuctionBid {
  playerId: string
  amount: number
  mortgageShareIds: string[]
}

export interface AuctionPhase {
  kind: 'auction'
  currentPlayerId: string
  activePlayerIds: string[]
  highestBid: AuctionBid | null
}

export type GamePhase =
  | AuctionPhase
  | { kind: 'sharePurchase'; playerId: string }
  | { kind: 'cargoSelection'; playerId: string }
  | { kind: 'launch'; playerId: string }
  | { kind: 'placement'; playerId: string; placementRound: number; movementRound: number; actedPlayerIds: string[] }
  | { kind: 'movementOrder'; playerId: string; movementRound: number; dice: Record<Commodity, number>; remainingBoatIds: string[]; movedBoatIds: string[] }
  | { kind: 'smallPilot'; playerId: string }
  | { kind: 'largePilot'; playerId: string }
  | { kind: 'pirateBoarding'; accompliceId: string; eligibleBoatIds: string[]; remainingAccompliceIds?: string[]; protectedAccompliceId?: string }
  | { kind: 'plunderDestination'; playerId: string; boatIds: string[]; index: number; movementOrder: string[] }
  | { kind: 'gameOver' }

export interface GameState {
  version: 1
  config: Required<Pick<GameConfig, 'startingPlayerId' | 'pirateVariant'>> & { playerOrder: string[] }
  rng: RngState
  players: Player[]
  shareSupply: Share[]
  market: Record<Commodity, MarketValue>
  accomplices: Accomplice[]
  boats: Boat[]
  portBerths: Partial<Record<Berth, string>>
  shipyardBerths: Partial<Record<Berth, string>>
  voyage: number
  harborMasterId: string | null
  selectedCommodities: Commodity[]
  phase: GamePhase
  lastMovementOrder: string[]
}

export interface RuleError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface RuleViolation {
  code: string
  message: string
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export interface GameEvent {
  type: string
  [key: string]: unknown
}

export interface Standing {
  playerId: string
  name: string
  wealth: number
  winner: boolean
}

export interface AuctionDecision {
  kind: 'auction'
  playerId: string
  minimumBid: number
  maximumBid: number
  pesos: number
  availableCollateralShareIds: string[]
  canPass: true
}

export interface SharePurchaseDecision {
  kind: 'sharePurchase'
  playerId: string
  available: Array<{ shareId: string; commodity: Commodity; price: number }>
  pesos: number
  availableCollateralShareIds: string[]
}

export interface CargoSelectionDecision {
  kind: 'cargoSelection'
  playerId: string
  commodities: readonly Commodity[]
}

export interface LaunchDecision {
  kind: 'launch'
  playerId: string
  boatIds: string[]
  commodities: Commodity[]
}

export interface PlacementOption {
  location: AccompliceLocation
  cost: number
}

export interface PlacementDecision {
  kind: 'placement'
  playerId: string
  placementRound: number
  options: PlacementOption[]
  canStowaway: boolean
  canPass: true
  pesos: number
  availableCollateralShareIds: string[]
}

export interface MovementOrderDecision {
  kind: 'movementOrder'
  playerId: string
  movementRound: number
  dice: Record<Commodity, number>
  remainingBoatIds: string[]
}

export interface PilotMove {
  boatId: string
  delta: -2 | -1 | 1 | 2
}

interface PilotDecisionBase {
  playerId: string
  movableBoatIds: string[]
}

export type PilotDecision =
  | PilotDecisionBase & { kind: 'smallPilot' }
  | PilotDecisionBase & { kind: 'largePilot' }

export interface PirateBoardingDecision {
  kind: 'pirateBoarding'
  playerId: string
  accompliceId: string
  eligibleBoatIds: string[]
  displaceableByBoat: Record<string, string[]>
  canStay: true
}

export interface PlunderDestinationDecision {
  kind: 'plunderDestination'
  playerId: string
  boatId: string
  destinations: readonly ['port', 'shipyard']
}

export type Decision = AuctionDecision | SharePurchaseDecision | CargoSelectionDecision | LaunchDecision | PlacementDecision | MovementOrderDecision | PilotDecision | PirateBoardingDecision | PlunderDestinationDecision

export type GameAction =
  | { type: 'passAuction'; playerId: string }
  | { type: 'bid'; playerId: string; amount: number; mortgageShareIds: string[] }
  | { type: 'buyShare'; playerId: string; shareId: string | null; mortgageShareIds: string[] }
  | { type: 'selectCargo'; playerId: string; commodities: Commodity[] }
  | { type: 'launchBoats'; playerId: string; assignments: Array<{ boatId: string; commodity: Commodity; lane: Lane; startPosition: number }> }
  | { type: 'placeAccomplice'; playerId: string; location: AccompliceLocation; mortgageShareIds: string[]; stowaway?: boolean }
  | { type: 'passPlacement'; playerId: string }
  | { type: 'moveBoat'; playerId: string; boatId: string }
  | { type: 'pilotMove'; playerId: string; moves: PilotMove[] }
  | { type: 'boardPirate'; playerId: string; accompliceId: string; boatId: string | null; displacedAccompliceId?: string }
  | { type: 'choosePlunderDestination'; playerId: string; boatId: string; destination: 'port' | 'shipyard' }
  | { type: 'mortgageShare'; playerId: string; shareId: string }
  | { type: 'redeemShare'; playerId: string; shareId: string }
