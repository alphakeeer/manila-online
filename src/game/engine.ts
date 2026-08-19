import {
  BERTH_RULES,
  COMMODITIES,
  COMMODITY_RULES,
  INSURANCE_INCOME,
  MORTGAGE_INCOME,
  REDEEM_COST,
  SPECIAL_PLACEMENT_COSTS,
  MARKET_TRACK,
} from './constants'
import { randomInt } from './rng'
import type {
  AccompliceLocation,
  AuctionBid,
  Commodity,
  Decision,
  GameAction,
  GameEvent,
  GameState,
  PlacementOption,
  Player,
  Result,
  RuleError,
} from './types'

type TransitionValue = { state: GameState; events: GameEvent[] }

const failure = (code: string, message: string, details?: Record<string, unknown>): Result<never, RuleError> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
})

const success = (state: GameState, events: GameEvent[] = []): Result<TransitionValue, RuleError> => ({
  ok: true,
  value: { state, events },
})

function playerById(state: GameState, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId)
}

function purchasingPower(player: Player): number {
  return player.pesos + player.shares.filter((share) => !share.mortgaged).length * MORTGAGE_INCOME
}

function nextClockwise(order: string[], current: string, candidates: string[]): string | null {
  const start = order.indexOf(current)
  for (let offset = 1; offset <= order.length; offset += 1) {
    const candidate = order[(start + offset) % order.length]
    if (candidate !== undefined && candidates.includes(candidate)) return candidate
  }
  return null
}

function validateMortgageIds(player: Player, shareIds: string[]): RuleError | null {
  if (new Set(shareIds).size !== shareIds.length) {
    return { code: 'DUPLICATE_COLLATERAL', message: '抵押股份不能重复' }
  }
  if (shareIds.some((id) => !player.shares.some((share) => share.id === id && !share.mortgaged))) {
    return { code: 'INVALID_COLLATERAL', message: '只能抵押自己未抵押的股份' }
  }
  return null
}

function applyMortgages(player: Player, shareIds: string[]): void {
  for (const shareId of shareIds) {
    const share = player.shares.find((candidate) => candidate.id === shareId)
    if (share) share.mortgaged = true
  }
  player.pesos += shareIds.length * MORTGAGE_INCOME
}

function finishAuction(state: GameState, winningBid: AuctionBid | null, events: GameEvent[]): void {
  let harborMasterId: string
  if (winningBid) {
    harborMasterId = winningBid.playerId
    const winner = playerById(state, harborMasterId)
    if (!winner) throw new Error('拍卖赢家不存在')
    applyMortgages(winner, winningBid.mortgageShareIds)
    winner.pesos -= winningBid.amount
    events.push({ type: 'auctionWon', playerId: harborMasterId, amount: winningBid.amount })
  } else if (state.harborMasterId !== null) {
    harborMasterId = state.harborMasterId
    events.push({ type: 'auctionNoBid', playerId: harborMasterId })
  } else {
    const [index, rng] = randomInt(state.rng, state.config.playerOrder.length)
    state.rng = rng
    harborMasterId = state.config.playerOrder[index] ?? state.config.playerOrder[0] ?? ''
    events.push({ type: 'initialHarborMasterRandomlySelected', playerId: harborMasterId })
  }
  state.harborMasterId = harborMasterId
  state.phase = { kind: 'sharePurchase', playerId: harborMasterId }
}

function transitionAuction(state: GameState, action: GameAction, events: GameEvent[]): Result<TransitionValue, RuleError> {
  if (state.phase.kind !== 'auction') return failure('WRONG_PHASE', '当前不是拍卖阶段')
  const phase = state.phase
  if (action.type !== 'passAuction' && action.type !== 'bid') return failure('WRONG_ACTION', '拍卖阶段动作非法')
  if (action.playerId !== phase.currentPlayerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')

  if (action.type === 'bid') {
    const player = playerById(state, action.playerId)
    if (!player) return failure('UNKNOWN_PLAYER', '玩家不存在')
    const minimum = (phase.highestBid?.amount ?? 0) + 1
    if (!Number.isInteger(action.amount) || action.amount < minimum) {
      return failure('BID_TOO_LOW', `出价必须至少为 ${minimum}`)
    }
    const collateralError = validateMortgageIds(player, action.mortgageShareIds)
    if (collateralError) return { ok: false, error: collateralError }
    if (player.pesos + action.mortgageShareIds.length * MORTGAGE_INCOME < action.amount) {
      return failure('INSUFFICIENT_BID_FUNDS', '现金与声明的抵押股份不足以支付出价')
    }
    phase.highestBid = {
      playerId: action.playerId,
      amount: action.amount,
      mortgageShareIds: [...action.mortgageShareIds],
    }
    events.push({ type: 'bidPlaced', playerId: action.playerId, amount: action.amount })
  } else {
    phase.activePlayerIds = phase.activePlayerIds.filter((id) => id !== action.playerId)
    events.push({ type: 'auctionPassed', playerId: action.playerId })
  }

  if (phase.highestBid && phase.activePlayerIds.length === 1 && phase.activePlayerIds[0] === phase.highestBid.playerId) {
    finishAuction(state, phase.highestBid, events)
    return success(state, events)
  }
  if (!phase.highestBid && phase.activePlayerIds.length === 0) {
    finishAuction(state, null, events)
    return success(state, events)
  }
  const next = nextClockwise(state.config.playerOrder, action.playerId, phase.activePlayerIds)
  if (!next) return failure('AUCTION_STALLED', '拍卖无法找到下一位玩家')
  phase.currentPlayerId = next
  return success(state, events)
}

function sameLocation(left: AccompliceLocation, right: AccompliceLocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isOccupied(state: GameState, location: AccompliceLocation): boolean {
  return state.accomplices.some((token) => token.location !== null && sameLocation(token.location, location))
}

export function placementOptions(state: GameState): PlacementOption[] {
  const options: PlacementOption[] = []
  for (const boat of state.boats) {
    if (boat.commodity === null) continue
    const costs = COMMODITY_RULES[boat.commodity].placementCosts
    const firstEmpty = costs.findIndex((_, slot) => !isOccupied(state, { area: 'cargo', boatId: boat.id, slot }))
    if (firstEmpty >= 0) {
      options.push({ location: { area: 'cargo', boatId: boat.id, slot: firstEmpty }, cost: costs[firstEmpty] ?? 0 })
    }
  }
  for (const rule of BERTH_RULES) {
    for (const area of ['port', 'shipyard'] as const) {
      const location: AccompliceLocation = { area, berth: rule.berth }
      if (!isOccupied(state, location)) options.push({ location, cost: rule.cost })
    }
  }
  const pirateCaptain: AccompliceLocation = { area: 'pirateCaptain' }
  const pirateCrew: AccompliceLocation = { area: 'pirateCrew' }
  if (!isOccupied(state, pirateCaptain)) options.push({ location: pirateCaptain, cost: SPECIAL_PLACEMENT_COSTS.pirateCaptain })
  else if (!isOccupied(state, pirateCrew)) options.push({ location: pirateCrew, cost: SPECIAL_PLACEMENT_COSTS.pirateCrew })
  for (const area of ['smallPilot', 'largePilot'] as const) {
    const location: AccompliceLocation = { area }
    if (!isOccupied(state, location)) options.push({ location, cost: SPECIAL_PLACEMENT_COSTS[area] })
  }
  const insurance: AccompliceLocation = { area: 'insurance' }
  if (!isOccupied(state, insurance)) options.push({ location: insurance, cost: 0 })
  return options
}

function canPlayerActInPlacement(state: GameState, playerId: string): boolean {
  const player = playerById(state, playerId)
  if (!player || player.passedPlacement) return false
  return state.accomplices.some((token) => token.playerId === playerId && token.location === null)
}

function orderedFromHarborMaster(state: GameState): string[] {
  const start = state.config.playerOrder.indexOf(state.harborMasterId ?? state.config.playerOrder[0] ?? '')
  return state.config.playerOrder.map((_, offset) => state.config.playerOrder[(start + offset) % state.config.playerOrder.length] ?? '')
}

function beginPlacementRound(state: GameState, placementRound: number, movementRound: number): void {
  const order = orderedFromHarborMaster(state)
  const first = order.find((id) => canPlayerActInPlacement(state, id))
  if (first) {
    state.phase = { kind: 'placement', playerId: first, placementRound, movementRound, actedPlayerIds: [] }
  } else {
    completePlacementRound(state, placementRound, movementRound)
  }
}

function rollDice(state: GameState, movementRound: number): void {
  const dice: Record<Commodity, number> = { nutmeg: 0, silk: 0, jade: 0, ginseng: 0 }
  for (const commodity of state.selectedCommodities) {
    const [roll, rng] = randomInt(state.rng, 6)
    state.rng = rng
    dice[commodity] = roll + 1
  }
  const remainingBoatIds = state.boats.filter((boat) => boat.status === 'sailing').map((boat) => boat.id)
  state.phase = {
    kind: 'movementOrder',
    playerId: state.harborMasterId ?? '',
    movementRound,
    dice,
    remainingBoatIds,
    movedBoatIds: [],
  }
}

function nextBerth(berths: GameState['portBerths'] | GameState['shipyardBerths']): 'A' | 'B' | 'C' | null {
  return BERTH_RULES.find((rule) => berths[rule.berth] === undefined)?.berth ?? null
}

function sendToPort(state: GameState, boatId: string): void {
  const boat = state.boats.find((candidate) => candidate.id === boatId)
  const berth = nextBerth(state.portBerths)
  if (!boat || !berth) throw new Error('没有可用港口泊位')
  boat.status = 'port'
  boat.berth = berth
  boat.position = null
  state.portBerths[berth] = boat.id
}

function sendToShipyard(state: GameState, boatId: string): void {
  const boat = state.boats.find((candidate) => candidate.id === boatId)
  const berth = nextBerth(state.shipyardBerths)
  if (!boat || !berth) throw new Error('没有可用修船厂泊位')
  boat.status = 'shipyard'
  boat.berth = berth
  boat.position = null
  state.shipyardBerths[berth] = boat.id
}

function emptyCargoSlots(state: GameState, boatId: string): number[] {
  const boat = state.boats.find((candidate) => candidate.id === boatId)
  if (!boat?.commodity) return []
  return COMMODITY_RULES[boat.commodity].placementCosts
    .map((_, slot) => slot)
    .filter((slot) => !isOccupied(state, { area: 'cargo', boatId, slot }))
}

function pirateEligibleBoats(state: GameState, boatIds: string[]): string[] {
  const withSpace = boatIds.filter((boatId) => emptyCargoSlots(state, boatId).length > 0)
  if (state.config.pirateVariant === 'standard') return withSpace
  return withSpace.length > 0 ? withSpace : boatIds
}

function beginAfterSecondMovement(state: GameState): void {
  const targets = state.lastMovementOrder.filter((boatId) => {
    const boat = state.boats.find((candidate) => candidate.id === boatId)
    return boat?.status === 'sailing' && boat.position === 13
  })
  const captain = state.accomplices.find((token) => token.location?.area === 'pirateCaptain')
  const crew = state.accomplices.find((token) => token.location?.area === 'pirateCrew')
  const pirates = [captain, crew].filter((token): token is NonNullable<typeof token> => token !== undefined)
  if (targets.length > 0 && pirates.length > 0) {
    const first = pirates[0]
    if (!first) throw new Error('海盗队列为空')
    state.phase = {
      kind: 'pirateBoarding',
      accompliceId: first.id,
      eligibleBoatIds: pirateEligibleBoats(state, targets),
      remainingAccompliceIds: pirates.slice(1).map((token) => token.id),
    }
    return
  }
  beginPlacementRound(state, state.players.length === 3 ? 4 : 3, 2)
}

function payEvenly(state: GameState, playerIds: string[], total: number): void {
  if (playerIds.length === 0) return
  const amount = total / playerIds.length
  for (const playerId of playerIds) {
    const player = playerById(state, playerId)
    if (player) player.pesos += amount
  }
}

function settleVoyage(state: GameState): void {
  const pirateTokens = state.accomplices.filter((token) => token.location?.area === 'pirateCaptain' || token.location?.area === 'pirateCrew')
  for (const boat of state.boats.filter((candidate) => candidate.plundered && candidate.commodity !== null)) {
    payEvenly(state, pirateTokens.map((token) => token.playerId), COMMODITY_RULES[boat.commodity!].profit)
  }
  for (const boat of state.boats.filter((candidate) => candidate.status === 'port' && !candidate.plundered && candidate.commodity !== null)) {
    const occupants = state.accomplices.filter((token) => token.location?.area === 'cargo' && token.location.boatId === boat.id)
    payEvenly(state, occupants.map((token) => token.playerId), COMMODITY_RULES[boat.commodity!].profit)
  }
  for (const rule of BERTH_RULES) {
    if (state.portBerths[rule.berth]) {
      const token = state.accomplices.find((candidate) => candidate.location?.area === 'port' && candidate.location.berth === rule.berth)
      const player = token ? playerById(state, token.playerId) : undefined
      if (player) player.pesos += rule.payout
    }
  }

  const insuranceToken = state.accomplices.find((token) => token.location?.area === 'insurance')
  const insurancePlayer = insuranceToken ? playerById(state, insuranceToken.playerId) : undefined
  if (!insurancePlayer) {
    for (const rule of BERTH_RULES) {
      if (!state.shipyardBerths[rule.berth]) continue
      const token = state.accomplices.find((candidate) => candidate.location?.area === 'shipyard' && candidate.location.berth === rule.berth)
      const player = token ? playerById(state, token.playerId) : undefined
      if (player) player.pesos += rule.payout
    }
  } else {
    const liabilities = BERTH_RULES.filter((rule) => state.shipyardBerths[rule.berth] !== undefined).map((rule) => {
      const token = state.accomplices.find((candidate) => candidate.location?.area === 'shipyard' && candidate.location.berth === rule.berth)
      return { amount: rule.payout, receiverId: token?.playerId ?? null }
    }).filter((liability) => liability.receiverId !== insurancePlayer.id)
    const total = liabilities.reduce((sum, liability) => sum + liability.amount, 0)
    const collateral = [...insurancePlayer.shares]
      .filter((share) => !share.mortgaged)
      .sort((left, right) => left.id.localeCompare(right.id))
    while (insurancePlayer.pesos < total && collateral.length > 0) {
      const share = collateral.shift()
      if (!share) break
      share.mortgaged = true
      insurancePlayer.pesos += MORTGAGE_INCOME
    }
    for (const liability of liabilities) {
      const paid = Math.min(insurancePlayer.pesos, liability.amount)
      insurancePlayer.pesos -= paid
      const receiver = liability.receiverId ? playerById(state, liability.receiverId) : undefined
      if (receiver) receiver.pesos += liability.amount
    }
  }

  for (const boat of state.boats.filter((candidate) => candidate.status === 'port' && candidate.commodity !== null)) {
    const commodity = boat.commodity!
    const index = MARKET_TRACK.indexOf(state.market[commodity])
    state.market[commodity] = MARKET_TRACK[Math.min(index + 1, MARKET_TRACK.length - 1)] ?? 30
  }
  if (COMMODITIES.some((commodity) => state.market[commodity] === 30)) {
    state.phase = { kind: 'gameOver' }
    return
  }

  state.voyage += 1
  state.selectedCommodities = []
  state.portBerths = {}
  state.shipyardBerths = {}
  state.lastMovementOrder = []
  for (const player of state.players) player.passedPlacement = false
  for (const token of state.accomplices) token.location = null
  for (const boat of state.boats) {
    boat.commodity = null
    boat.lane = null
    boat.startPosition = null
    boat.position = null
    boat.status = 'unlaunched'
    boat.berth = null
    boat.plundered = false
  }
  const current = state.harborMasterId ?? state.config.startingPlayerId
  state.phase = { kind: 'auction', currentPlayerId: current, activePlayerIds: [...state.config.playerOrder], highestBid: null }
}

function advanceFinalResolution(state: GameState, order: string[], startIndex: number): void {
  const pirateTokens = state.accomplices.filter((token) => token.location?.area === 'pirateCaptain' || token.location?.area === 'pirateCrew')
  for (let index = startIndex; index < order.length; index += 1) {
    const boatId = order[index]
    const boat = state.boats.find((candidate) => candidate.id === boatId)
    if (!boat || boat.status !== 'sailing') continue
    if (boat.position === 13 && pirateTokens.length > 0) {
      if (!boat.plundered) {
        boat.plundered = true
        for (const token of state.accomplices) {
          if (token.location?.area === 'cargo' && token.location.boatId === boat.id) token.location = null
        }
      }
      const captain = pirateTokens.find((token) => token.location?.area === 'pirateCaptain') ?? pirateTokens[0]
      if (!captain) throw new Error('缺少海盗船长')
      state.phase = { kind: 'plunderDestination', playerId: captain.playerId, boatIds: order, index, movementOrder: order }
      return
    }
    if (boat.position === 13) sendToPort(state, boat.id)
    else sendToShipyard(state, boat.id)
  }
  settleVoyage(state)
}

function finishMovementRound(state: GameState, movementRound: number, movedBoatIds: string[]): void {
  state.lastMovementOrder = [...movedBoatIds]
  if (movementRound === 1) {
    beginPlacementRound(state, state.players.length === 3 ? 3 : 2, 1)
  } else if (movementRound === 2) {
    beginAfterSecondMovement(state)
  } else {
    const unresolved = movedBoatIds.filter((boatId) => state.boats.some((boat) => boat.id === boatId && boat.status === 'sailing'))
    advanceFinalResolution(state, unresolved, 0)
  }
}

function applyPilotMoves(state: GameState, moves: Array<{ boatId: string; delta: number }>): RuleError | null {
  for (const move of moves) {
    const boat = state.boats.find((candidate) => candidate.id === move.boatId && candidate.status === 'sailing')
    if (!boat || boat.position === null) return { code: 'PILOT_INVALID_BOAT', message: '领航员只能移动尚未入港的舢板' }
    if (boat.position + move.delta < 0) return { code: 'PILOT_OUT_OF_BOUNDS', message: '舢板不能后退至 0 以下' }
  }
  for (const move of moves) {
    const boat = state.boats.find((candidate) => candidate.id === move.boatId)
    if (!boat || boat.position === null) continue
    boat.position += move.delta
    if (boat.position > 13) sendToPort(state, boat.id)
  }
  return null
}

function completePlacementRound(state: GameState, placementRound: number, movementRound: number): void {
  if (state.players.length === 3 && placementRound === 1) {
    beginPlacementRound(state, 2, 0)
    return
  }
  const nextMovement = movementRound + 1
  if (nextMovement === 3) {
    const smallPilot = state.accomplices.find((token) => token.location?.area === 'smallPilot')
    const largePilot = state.accomplices.find((token) => token.location?.area === 'largePilot')
    if (smallPilot) {
      state.phase = { kind: 'smallPilot', playerId: smallPilot.playerId }
    } else if (largePilot) {
      state.phase = { kind: 'largePilot', playerId: largePilot.playerId }
    } else {
      rollDice(state, 3)
    }
  } else {
    rollDice(state, nextMovement)
  }
}

function advancePlacementTurn(state: GameState, actorId: string): void {
  if (state.phase.kind !== 'placement') return
  const { placementRound, movementRound } = state.phase
  const acted = [...state.phase.actedPlayerIds, actorId]
  const order = orderedFromHarborMaster(state)
  const remaining = order.filter((id) => !acted.includes(id) && canPlayerActInPlacement(state, id))
  const next = nextClockwise(state.config.playerOrder, actorId, remaining)
  if (next) {
    state.phase = { kind: 'placement', playerId: next, placementRound, movementRound, actedPlayerIds: acted }
  } else {
    completePlacementRound(state, placementRound, movementRound)
  }
}

export function getDecision(state: GameState): Decision | null {
  const { phase } = state
  if (phase.kind === 'gameOver') return null
  if (phase.kind === 'auction') {
    const player = playerById(state, phase.currentPlayerId)
    return {
      kind: 'auction',
      playerId: phase.currentPlayerId,
      minimumBid: (phase.highestBid?.amount ?? 0) + 1,
      maximumBid: player ? purchasingPower(player) : 0,
      pesos: player?.pesos ?? 0,
      availableCollateralShareIds: player?.shares.filter((share) => !share.mortgaged).map((share) => share.id) ?? [],
      canPass: true,
    }
  }
  if (phase.kind === 'sharePurchase') {
    const player = playerById(state, phase.playerId)
    return {
      kind: 'sharePurchase',
      playerId: phase.playerId,
      available: state.shareSupply
        .map((share) => ({ shareId: share.id, commodity: share.commodity, price: Math.max(5, state.market[share.commodity]) }))
        .filter((option) => player !== undefined && option.price <= purchasingPower(player)),
      pesos: player?.pesos ?? 0,
      availableCollateralShareIds: player?.shares.filter((share) => !share.mortgaged).map((share) => share.id) ?? [],
    }
  }
  if (phase.kind === 'cargoSelection') return { kind: 'cargoSelection', playerId: phase.playerId, commodities: COMMODITIES }
  if (phase.kind === 'launch') return { kind: 'launch', playerId: phase.playerId, boatIds: state.boats.map((boat) => boat.id), commodities: [...state.selectedCommodities] }
  if (phase.kind === 'placement') {
    const player = playerById(state, phase.playerId)
    const options = placementOptions(state)
    const cheapest = options.filter((option) => option.location.area !== 'insurance').reduce((minimum, option) => Math.min(minimum, option.cost), Number.POSITIVE_INFINITY)
    return {
      kind: 'placement',
      playerId: phase.playerId,
      placementRound: phase.placementRound,
      options,
      canStowaway: player !== undefined && Number.isFinite(cheapest) && purchasingPower(player) < cheapest,
      canPass: true,
      pesos: player?.pesos ?? 0,
      availableCollateralShareIds: player?.shares.filter((share) => !share.mortgaged).map((share) => share.id) ?? [],
    }
  }
  if (phase.kind === 'movementOrder') {
    return { kind: 'movementOrder', playerId: phase.playerId, movementRound: phase.movementRound, dice: phase.dice, remainingBoatIds: phase.remainingBoatIds }
  }
  if (phase.kind === 'smallPilot' || phase.kind === 'largePilot') {
    return { kind: phase.kind, playerId: phase.playerId, movableBoatIds: state.boats.filter((boat) => boat.status === 'sailing').map((boat) => boat.id) }
  }
  if (phase.kind === 'pirateBoarding') {
    const token = state.accomplices.find((candidate) => candidate.id === phase.accompliceId)
    return token ? {
      kind: 'pirateBoarding',
      playerId: token.playerId,
      accompliceId: token.id,
      eligibleBoatIds: phase.eligibleBoatIds,
      displaceableByBoat: Object.fromEntries(phase.eligibleBoatIds.map((boatId) => [
        boatId,
        emptyCargoSlots(state, boatId).length > 0
          ? []
          : state.accomplices
            .filter((candidate) => candidate.location?.area === 'cargo' && candidate.location.boatId === boatId && candidate.id !== phase.protectedAccompliceId)
            .map((candidate) => candidate.id),
      ])),
      canStay: true,
    } : null
  }
  if (phase.kind === 'plunderDestination') {
    const boatId = phase.boatIds[phase.index]
    return boatId ? { kind: 'plunderDestination', playerId: phase.playerId, boatId, destinations: ['port', 'shipyard'] } : null
  }
  return null
}

function handleFinance(state: GameState, action: Extract<GameAction, { type: 'mortgageShare' | 'redeemShare' }>): Result<TransitionValue, RuleError> {
  if (state.phase.kind === 'gameOver') return failure('GAME_OVER', '游戏结束后不能再贷款或还贷')
  const player = playerById(state, action.playerId)
  if (!player) return failure('UNKNOWN_PLAYER', '玩家不存在')
  const share = player.shares.find((candidate) => candidate.id === action.shareId)
  if (!share) return failure('SHARE_NOT_OWNED', '玩家不持有该股份')
  if (action.type === 'mortgageShare') {
    if (share.mortgaged) return failure('ALREADY_MORTGAGED', '该股份已经抵押')
    share.mortgaged = true
    player.pesos += MORTGAGE_INCOME
    return success(state, [{ type: 'shareMortgaged', playerId: player.id, shareId: share.id }])
  }
  if (!share.mortgaged) return failure('NOT_MORTGAGED', '该股份未抵押')
  if (player.pesos < REDEEM_COST) return failure('INSUFFICIENT_FUNDS', '资金不足以赎回股份')
  player.pesos -= REDEEM_COST
  share.mortgaged = false
  return success(state, [{ type: 'shareRedeemed', playerId: player.id, shareId: share.id }])
}

export function transition(source: GameState, action: GameAction): Result<TransitionValue, RuleError> {
  const state = structuredClone(source)
  if (action.type === 'mortgageShare' || action.type === 'redeemShare') return handleFinance(state, action)
  const events: GameEvent[] = []

  if (state.phase.kind === 'auction') return transitionAuction(state, action, events)
  if (state.phase.kind === 'sharePurchase') {
    if (action.type !== 'buyShare') return failure('WRONG_ACTION', '当前需要决定是否购买股份')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    const player = playerById(state, action.playerId)
    if (!player) return failure('UNKNOWN_PLAYER', '玩家不存在')
    if (action.shareId !== null) {
      const shareIndex = state.shareSupply.findIndex((share) => share.id === action.shareId)
      const share = state.shareSupply[shareIndex]
      if (!share) return failure('SHARE_UNAVAILABLE', '该股份不可购买')
      const collateralError = validateMortgageIds(player, action.mortgageShareIds)
      if (collateralError) return { ok: false, error: collateralError }
      applyMortgages(player, action.mortgageShareIds)
      const price = Math.max(5, state.market[share.commodity])
      if (player.pesos < price) return failure('INSUFFICIENT_FUNDS', '资金不足以购买股份')
      player.pesos -= price
      player.shares.push(share)
      state.shareSupply.splice(shareIndex, 1)
      events.push({ type: 'sharePurchased', playerId: player.id, shareId: share.id, price })
    } else if (action.mortgageShareIds.length > 0) {
      return failure('UNUSED_COLLATERAL', '跳过购股时不能声明抵押股份')
    }
    state.phase = { kind: 'cargoSelection', playerId: action.playerId }
    return success(state, events)
  }
  if (state.phase.kind === 'cargoSelection') {
    if (action.type !== 'selectCargo') return failure('WRONG_ACTION', '当前需要选择货物')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    if (action.commodities.length !== 3 || new Set(action.commodities).size !== 3 || action.commodities.some((commodity) => !COMMODITIES.includes(commodity))) {
      return failure('INVALID_CARGO_SELECTION', '必须选择三种不同货物')
    }
    state.selectedCommodities = [...action.commodities]
    state.phase = { kind: 'launch', playerId: action.playerId }
    return success(state, [{ type: 'cargoSelected', commodities: action.commodities }])
  }
  if (state.phase.kind === 'launch') {
    if (action.type !== 'launchBoats') return failure('WRONG_ACTION', '当前需要安排舢板下水')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    if (action.assignments.length !== 3 || new Set(action.assignments.map((item) => item.boatId)).size !== 3 || new Set(action.assignments.map((item) => item.lane)).size !== 3) {
      return failure('INVALID_LAUNCH_ASSIGNMENTS', '三艘舢板必须使用不同航线')
    }
    const commodities = action.assignments.map((item) => item.commodity)
    if (new Set(commodities).size !== 3 || !state.selectedCommodities.every((commodity) => commodities.includes(commodity))) {
      return failure('INVALID_LAUNCH_CARGO', '下水货物必须与已选货物一致')
    }
    if (action.assignments.some((item) => !Number.isInteger(item.startPosition) || item.startPosition < 0 || item.startPosition > 5)) {
      return failure('INVALID_START_POSITION', '舢板起始格必须为 0–5')
    }
    if (action.assignments.reduce((total, item) => total + item.startPosition, 0) !== 9) {
      return failure('INVALID_START_SUM', '三艘舢板起始格之和必须为 9')
    }
    for (const assignment of action.assignments) {
      const boat = state.boats.find((candidate) => candidate.id === assignment.boatId)
      if (!boat) return failure('UNKNOWN_BOAT', '舢板不存在')
      boat.commodity = assignment.commodity
      boat.lane = assignment.lane
      boat.startPosition = assignment.startPosition
      boat.position = assignment.startPosition
      boat.status = 'sailing'
    }
    beginPlacementRound(state, 1, 0)
    return success(state, [{ type: 'boatsLaunched' }])
  }
  if (state.phase.kind === 'placement') {
    if (action.type !== 'placeAccomplice' && action.type !== 'passPlacement') return failure('WRONG_ACTION', '当前需要放置同伙或放弃')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    const player = playerById(state, action.playerId)
    if (!player) return failure('UNKNOWN_PLAYER', '玩家不存在')
    if (action.type === 'passPlacement') {
      player.passedPlacement = true
      events.push({ type: 'placementPassed', playerId: player.id })
      advancePlacementTurn(state, player.id)
      return success(state, events)
    }
    const option = placementOptions(state).find((candidate) => sameLocation(candidate.location, action.location))
    if (!option) return failure('POSITION_UNAVAILABLE', '同伙位不可用')
    const token = state.accomplices.find((candidate) => candidate.playerId === player.id && candidate.location === null)
    if (!token) return failure('NO_ACCOMPLICE', '没有可用同伙')
    if (action.stowaway) {
      const decision = getDecision(state)
      if (decision?.kind !== 'placement' || !decision.canStowaway || action.location.area === 'insurance') {
        return failure('STOWAWAY_NOT_ALLOWED', '当前不符合偷渡客条件')
      }
      if (action.mortgageShareIds.length > 0) return failure('STOWAWAY_COLLATERAL', '偷渡客不能同时抵押股份')
      player.pesos = 0
    } else {
      const collateralError = validateMortgageIds(player, action.mortgageShareIds)
      if (collateralError) return { ok: false, error: collateralError }
      applyMortgages(player, action.mortgageShareIds)
      if (player.pesos < option.cost) return failure('INSUFFICIENT_FUNDS', '资金不足以放置同伙')
      player.pesos -= option.cost
      if (action.location.area === 'insurance') player.pesos += INSURANCE_INCOME
    }
    token.location = action.location
    events.push({ type: 'accomplicePlaced', playerId: player.id, accompliceId: token.id, location: action.location })
    advancePlacementTurn(state, player.id)
    return success(state, events)
  }
  if (state.phase.kind === 'movementOrder') {
    if (action.type !== 'moveBoat') return failure('WRONG_ACTION', '当前需要选择舢板移动顺序')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    if (!state.phase.remainingBoatIds.includes(action.boatId)) return failure('BOAT_ALREADY_MOVED', '该舢板本轮不可移动')
    const boat = state.boats.find((candidate) => candidate.id === action.boatId)
    if (!boat?.commodity || boat.status !== 'sailing' || boat.position === null) return failure('INVALID_BOAT', '舢板状态非法')
    const phase = state.phase
    boat.position += phase.dice[boat.commodity]
    if (boat.position > 13) sendToPort(state, boat.id)
    phase.remainingBoatIds = phase.remainingBoatIds.filter((id) => id !== boat.id)
    phase.movedBoatIds.push(boat.id)
    events.push({ type: 'boatMoved', boatId: boat.id, roll: phase.dice[boat.commodity] })
    if (phase.remainingBoatIds.length === 0) finishMovementRound(state, phase.movementRound, phase.movedBoatIds)
    return success(state, events)
  }
  if (state.phase.kind === 'smallPilot' || state.phase.kind === 'largePilot') {
    if (action.type !== 'pilotMove') return failure('WRONG_ACTION', '当前需要领航员行动')
    if (action.playerId !== state.phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    const isSmall = state.phase.kind === 'smallPilot'
    const ids = action.moves.map((move) => move.boatId)
    const validShape = isSmall
      ? action.moves.length <= 1 && action.moves.every((move) => Math.abs(move.delta) === 1)
      : action.moves.length <= 2
        && new Set(ids).size === ids.length
        && (action.moves.length !== 2 || action.moves.every((move) => Math.abs(move.delta) === 1))
        && action.moves.every((move) => Math.abs(move.delta) <= 2)
    if (!validShape) return failure('INVALID_PILOT_MOVE', '领航员移动组合非法')
    const pilotError = applyPilotMoves(state, action.moves)
    if (pilotError) return { ok: false, error: pilotError }
    events.push({ type: 'pilotMoved', playerId: action.playerId, moves: action.moves })
    if (isSmall) {
      const large = state.accomplices.find((token) => token.location?.area === 'largePilot')
      if (large) state.phase = { kind: 'largePilot', playerId: large.playerId }
      else rollDice(state, 3)
    } else {
      rollDice(state, 3)
    }
    return success(state, events)
  }
  if (state.phase.kind === 'pirateBoarding') {
    if (action.type !== 'boardPirate') return failure('WRONG_ACTION', '当前需要海盗决定是否登船')
    const phase = state.phase
    const pirate = state.accomplices.find((token) => token.id === phase.accompliceId)
    if (!pirate || action.playerId !== pirate.playerId || action.accompliceId !== pirate.id) return failure('NOT_YOUR_TURN', '尚未轮到该海盗')
    let boardedId: string | undefined
    if (action.boatId !== null) {
      if (!phase.eligibleBoatIds.includes(action.boatId)) return failure('PIRATE_TARGET_INELIGIBLE', '该舢板不能被当前海盗登船')
      const emptySlots = emptyCargoSlots(state, action.boatId)
      let slot: number
      if (emptySlots.length > 0) {
        if (action.displacedAccompliceId !== undefined) return failure('UNNEEDED_DISPLACEMENT', '舢板有空位时不能挤掉同伙')
        slot = emptySlots[0] ?? 0
      } else {
        if (state.config.pirateVariant !== 'strengthened') return failure('PIRATE_TARGET_INELIGIBLE', '标准海盗不能登上满员舢板')
        if (!action.displacedAccompliceId || action.displacedAccompliceId === phase.protectedAccompliceId) {
          return failure('INVALID_DISPLACEMENT', '必须选择可被挤掉的原同伙')
        }
        const displaced = state.accomplices.find((token) => token.id === action.displacedAccompliceId && token.location?.area === 'cargo' && token.location.boatId === action.boatId)
        if (!displaced || displaced.location?.area !== 'cargo') return failure('INVALID_DISPLACEMENT', '被挤掉的同伙不在目标舢板上')
        slot = displaced.location.slot
        displaced.location = null
      }
      const wasCaptain = pirate.location?.area === 'pirateCaptain'
      pirate.location = { area: 'cargo', boatId: action.boatId, slot }
      boardedId = pirate.id
      if (wasCaptain) {
        const crew = state.accomplices.find((token) => token.location?.area === 'pirateCrew')
        if (crew) crew.location = { area: 'pirateCaptain' }
      }
      events.push({ type: 'pirateBoarded', accompliceId: pirate.id, boatId: action.boatId })
    } else {
      events.push({ type: 'pirateStayed', accompliceId: pirate.id })
    }
    const remaining = (phase.remainingAccompliceIds ?? []).filter((id) => state.accomplices.some((token) => token.id === id && (token.location?.area === 'pirateCaptain' || token.location?.area === 'pirateCrew')))
    const nextPirateId = remaining[0]
    if (nextPirateId) {
      const targets = state.lastMovementOrder.filter((boatId) => state.boats.some((boat) => boat.id === boatId && boat.status === 'sailing' && boat.position === 13))
      const nextPhase: Extract<GameState['phase'], { kind: 'pirateBoarding' }> = {
        kind: 'pirateBoarding',
        accompliceId: nextPirateId,
        eligibleBoatIds: pirateEligibleBoats(state, targets),
        remainingAccompliceIds: remaining.slice(1),
      }
      if (boardedId !== undefined) nextPhase.protectedAccompliceId = boardedId
      state.phase = nextPhase
    } else {
      beginPlacementRound(state, state.players.length === 3 ? 4 : 3, 2)
    }
    return success(state, events)
  }
  if (state.phase.kind === 'plunderDestination') {
    if (action.type !== 'choosePlunderDestination') return failure('WRONG_ACTION', '当前需要海盗船长选择舢板去向')
    const phase = state.phase
    const expectedBoatId = phase.boatIds[phase.index]
    if (action.playerId !== phase.playerId) return failure('NOT_YOUR_TURN', '尚未轮到该玩家')
    if (action.boatId !== expectedBoatId) return failure('WRONG_BOAT', '必须处理当前被劫掠的舢板')
    if (action.destination === 'port') sendToPort(state, action.boatId)
    else sendToShipyard(state, action.boatId)
    events.push({ type: 'plunderDestinationChosen', boatId: action.boatId, destination: action.destination })
    advanceFinalResolution(state, phase.movementOrder, phase.index + 1)
    return success(state, events)
  }
  return failure('WRONG_ACTION', '动作与当前阶段不匹配')
}

export function getStandings(state: GameState) {
  const standings = state.players.map((player, order) => ({
    playerId: player.id,
    name: player.name,
    wealth: player.pesos
      + player.shares.reduce((total, share) => total + state.market[share.commodity] - (share.mortgaged ? REDEEM_COST : 0), 0),
    order,
  }))
  const highest = Math.max(...standings.map((standing) => standing.wealth))
  return standings
    .sort((left, right) => right.wealth - left.wealth || left.order - right.order)
    .map(({ order: _order, ...standing }) => ({ ...standing, winner: standing.wealth === highest }))
}
