import { getDecision, getStandings, transition } from './engine'
import { validateState } from './invariants'
import { createRng, randomInt, shuffle } from './rng'
import { createGame } from './setup'
import type {
  Decision,
  GameAction,
  GameState,
  PirateVariant,
  RngState,
  Standing,
} from './types'

export interface SimulationResult {
  seed: number
  pirateVariant: PirateVariant
  voyages: number
  transitions: number
  standings: Standing[]
}

function pick<T>(values: readonly T[], rng: RngState): [T, RngState] {
  if (values.length === 0) throw new Error('随机策略没有可选项')
  const [index, next] = randomInt(rng, values.length)
  const value = values[index]
  if (value === undefined) throw new Error('随机策略索引越界')
  return [value, next]
}

function randomAction(decision: Decision, rng: RngState): [GameAction, RngState] {
  if (decision.kind === 'auction') {
    const [choice, next] = randomInt(rng, 100)
    if (decision.pesos < decision.minimumBid || choice < 35) {
      return [{ type: 'passAuction', playerId: decision.playerId }, next]
    }
    const maximum = Math.min(decision.pesos, decision.maximumBid)
    const [offset, following] = randomInt(next, maximum - decision.minimumBid + 1)
    return [{ type: 'bid', playerId: decision.playerId, amount: decision.minimumBid + offset, mortgageShareIds: [] }, following]
  }
  if (decision.kind === 'sharePurchase') {
    const affordable = decision.available.filter((option) => option.price <= decision.pesos)
    const [choice, next] = randomInt(rng, 100)
    if (affordable.length === 0 || choice < 35) {
      return [{ type: 'buyShare', playerId: decision.playerId, shareId: null, mortgageShareIds: [] }, next]
    }
    const [share, following] = pick(affordable, next)
    return [{ type: 'buyShare', playerId: decision.playerId, shareId: share.shareId, mortgageShareIds: [] }, following]
  }
  if (decision.kind === 'cargoSelection') {
    const [commodities, next] = shuffle(decision.commodities, rng)
    return [{ type: 'selectCargo', playerId: decision.playerId, commodities: commodities.slice(0, 3) }, next]
  }
  if (decision.kind === 'launch') {
    const validStarts = [
      [0, 4, 5], [1, 3, 5], [1, 4, 4], [2, 2, 5], [2, 3, 4], [3, 3, 3],
    ] as const
    const [starts, next] = pick(validStarts, rng)
    const [positions, following] = shuffle(starts, next)
    const [commodities, finalRng] = shuffle(decision.commodities, following)
    return [{
      type: 'launchBoats',
      playerId: decision.playerId,
      assignments: decision.boatIds.map((boatId, index) => ({
        boatId,
        commodity: commodities[index]!,
        lane: index as 0 | 1 | 2,
        startPosition: positions[index]!,
      })),
    }, finalRng]
  }
  if (decision.kind === 'placement') {
    const [choice, next] = randomInt(rng, 100)
    if (choice < 15) return [{ type: 'passPlacement', playerId: decision.playerId }, next]
    const affordable = decision.options.filter((option) => option.cost <= decision.pesos)
    if (affordable.length > 0) {
      const [option, following] = pick(affordable, next)
      return [{ type: 'placeAccomplice', playerId: decision.playerId, location: option.location, mortgageShareIds: [] }, following]
    }
    const stowawayOptions = decision.options.filter((option) => option.location.area !== 'insurance')
    if (decision.canStowaway && stowawayOptions.length > 0) {
      const [option, following] = pick(stowawayOptions, next)
      return [{ type: 'placeAccomplice', playerId: decision.playerId, location: option.location, mortgageShareIds: [], stowaway: true }, following]
    }
    return [{ type: 'passPlacement', playerId: decision.playerId }, next]
  }
  if (decision.kind === 'movementOrder') {
    const [boatId, next] = pick(decision.remainingBoatIds, rng)
    return [{ type: 'moveBoat', playerId: decision.playerId, boatId }, next]
  }
  if (decision.kind === 'smallPilot') {
    const [choice, next] = randomInt(rng, 100)
    if (choice < 35 || decision.movableBoatIds.length === 0) return [{ type: 'pilotMove', playerId: decision.playerId, moves: [] }, next]
    const [boatId, following] = pick(decision.movableBoatIds, next)
    return [{ type: 'pilotMove', playerId: decision.playerId, moves: [{ boatId, delta: 1 }] }, following]
  }
  if (decision.kind === 'largePilot') {
    const [choice, next] = randomInt(rng, 100)
    if (choice < 30 || decision.movableBoatIds.length === 0) return [{ type: 'pilotMove', playerId: decision.playerId, moves: [] }, next]
    const [boats, following] = shuffle(decision.movableBoatIds, next)
    if (choice >= 65 && boats.length >= 2) {
      return [{ type: 'pilotMove', playerId: decision.playerId, moves: [{ boatId: boats[0]!, delta: 1 }, { boatId: boats[1]!, delta: 1 }] }, following]
    }
    return [{ type: 'pilotMove', playerId: decision.playerId, moves: [{ boatId: boats[0]!, delta: choice < 50 ? 1 : 2 }] }, following]
  }
  if (decision.kind === 'pirateBoarding') {
    const [choice, next] = randomInt(rng, 100)
    if (choice < 35 || decision.eligibleBoatIds.length === 0) {
      return [{ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId: null }, next]
    }
    const [boatId, following] = pick(decision.eligibleBoatIds, next)
    const displaced = decision.displaceableByBoat[boatId] ?? []
    if (displaced.length > 0) {
      const [displacedAccompliceId, finalRng] = pick(displaced, following)
      return [{ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId, displacedAccompliceId }, finalRng]
    }
    return [{ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId }, following]
  }
  const [destinationIndex, next] = randomInt(rng, 2)
  return [{
    type: 'choosePlunderDestination',
    playerId: decision.playerId,
    boatId: decision.boatId,
    destination: destinationIndex === 0 ? 'port' : 'shipyard',
  }, next]
}

export function simulateGame(options: {
  seed: number
  aiSeed: number
  playerCount: number
  pirateVariant: PirateVariant
  maximumVoyages?: number
}): SimulationResult {
  const players = Array.from({ length: options.playerCount }, (_, index) => ({ id: `ai-${index + 1}`, name: `随机商人 ${index + 1}` }))
  const created = createGame({ players, startingPlayerId: players[0]?.id ?? '', seed: options.seed, pirateVariant: options.pirateVariant })
  if (!created.ok) throw new Error(`${created.error.code}: ${created.error.message}`)
  let state: GameState = created.value
  let aiRng = createRng(options.aiSeed)
  let transitions = 0
  const maximumVoyages = options.maximumVoyages ?? 500

  while (state.phase.kind !== 'gameOver') {
    if (state.voyage > maximumVoyages) throw new Error(`seed=${options.seed} 超过 ${maximumVoyages} 个航程，phase=${state.phase.kind}`)
    if (transitions > 200_000) throw new Error(`seed=${options.seed} 状态迁移超过保护阈值，phase=${state.phase.kind}`)
    const decision = getDecision(state)
    if (!decision) throw new Error(`seed=${options.seed} 在 ${state.phase.kind} 阶段没有可用决策`)
    const [action, nextAiRng] = randomAction(decision, aiRng)
    aiRng = nextAiRng
    const result = transition(state, action)
    if (!result.ok) throw new Error(`seed=${options.seed} AI 产生非法动作 ${action.type}: ${result.error.code} ${result.error.message}`)
    state = result.value.state
    transitions += 1
    const violations = validateState(state)
    if (violations.length > 0) throw new Error(`seed=${options.seed} voyage=${state.voyage} phase=${state.phase.kind}: ${JSON.stringify(violations)}`)
  }
  return {
    seed: options.seed,
    pirateVariant: options.pirateVariant,
    voyages: state.voyage,
    transitions,
    standings: getStandings(state),
  }
}

export function runAcceptanceSimulation(options: { games?: number; playerCount?: number; rootSeed?: number } = {}): SimulationResult[] {
  const games = options.games ?? 10
  const playerCount = options.playerCount ?? 3
  const rootSeed = options.rootSeed ?? 0x4d41_4e49
  return Array.from({ length: games }, (_, index) => simulateGame({
    seed: (rootSeed + index) >>> 0,
    aiSeed: (rootSeed ^ 0xa5a5_a5a5 ^ index) >>> 0,
    playerCount,
    pirateVariant: index % 2 === 0 ? 'standard' : 'strengthened',
  }))
}

