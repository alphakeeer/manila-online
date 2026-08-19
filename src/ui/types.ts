export type DemoScene = 'table' | 'handoff' | 'shares' | 'settlement'

export interface DemoPlayer {
  id: string
  name: string
  pesos: number
  shareCount: number
  color: string
  isCurrent: boolean
  isHarborMaster: boolean
}

export interface DemoBoat {
  id: string
  cargo: '肉豆蔻' | '丝绸' | '玉石' | '人参'
  color: string
  x: number
  y: number
  routePosition: number
}

export interface DemoPlacement {
  id: string
  title: string
  cost: number
  detail: string
  boardX: number
  boardY: number
}

export interface DemoShare {
  id: string
  cargo: DemoBoat['cargo']
  marketValue: number
  imageUrl: string
  mortgaged: boolean
}

export interface DemoSettlementRow {
  label: string
  detail: string
  delta: number
}

export interface DemoState {
  voyage: number
  currentPlayerId: string
  players: DemoPlayer[]
  boats: DemoBoat[]
  placements: DemoPlacement[]
  shares: DemoShare[]
  settlement: DemoSettlementRow[]
  boardImageUrl: string
}
