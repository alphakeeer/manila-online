import type { GameCommandRequest, GameRoomSnapshot } from '@manila/protocol'

/**
 * Local demo autopilot: picks a random action from the server's own decision
 * options. It never invents moves the decision did not offer; the server still
 * judges every command. `cautious` falls back to the safest choice after a rejection.
 */
export type Action = GameCommandRequest['action']
type Decision = NonNullable<GameRoomSnapshot['decision']>
type Random = () => number
const MORTGAGE_VALUE = 12

const pick = <T>(items: readonly T[], random: Random): T | undefined => items[Math.floor(random() * items.length)]
function shuffle<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap]!, copy[index]!]
  }
  return copy
}

function collateralFor(shortfall: number, available: readonly string[], random: Random): string[] | null {
  if (shortfall <= 0) return []
  const needed = Math.ceil(shortfall / MORTGAGE_VALUE)
  return needed <= available.length ? shuffle(available, random).slice(0, needed) : null
}

export function chooseAction(snapshot: GameRoomSnapshot, random: Random = Math.random, cautious = false): Action | null {
  const decision: Decision | null = snapshot.decision
  if (!decision) return null
  const pesos = snapshot.self.pesos
  switch (decision.kind) {
    case 'auction': {
      const passChance = snapshot.public.highestBid ? 0.45 : 0.3
      if (cautious || decision.minimumBid > decision.maximumBid || random() < passChance) return { type: 'passAuction' }
      const span = Math.min(6, decision.maximumBid - decision.minimumBid)
      const amount = decision.minimumBid + Math.floor(random() ** 2 * (span + 1))
      const collateral = collateralFor(amount - pesos, decision.availableCollateralShareIds, random)
      return collateral ? { type: 'bid', amount, mortgageShareIds: collateral } : { type: 'passAuction' }
    }
    case 'sharePurchase': {
      const affordable = decision.available.filter((option) => option.price <= pesos)
      const choice = pick(affordable, random)
      if (cautious || !choice || random() < 0.35) return { type: 'buyShare', commodity: null, mortgageShareIds: [] }
      return { type: 'buyShare', commodity: choice.commodity, mortgageShareIds: [] }
    }
    case 'cargoSelection':
      return { type: 'selectCargo', commodities: shuffle(decision.commodities, random).slice(0, 3) }
    case 'launch': {
      const commodities = shuffle(decision.commodities, random)
      const starts = (cautious ? decision.startPositionTriples[0] : pick(decision.startPositionTriples, random)) ?? [3, 3, 3]
      return { type: 'launchBoats', assignments: decision.boatIds.map((boatId, index) => ({ boatId, commodity: commodities[index]!, lane: (decision.lanes[index] ?? index) as 0 | 1 | 2, startPosition: starts[index] ?? 3 })) }
    }
    case 'placement': {
      if (cautious && decision.canPass) return { type: 'passPlacement' }
      if (decision.canPass && random() < 0.12) return { type: 'passPlacement' }
      const location = (option: Extract<Decision, { kind: 'placement' }>['options'][number]) => option.location as Extract<Action, { type: 'placeAccomplice' }>['location']
      const affordable = decision.options.filter((option) => option.cost <= pesos)
      const choice = pick(affordable, random)
      if (choice) return { type: 'placeAccomplice', location: location(choice), mortgageShareIds: [], stowaway: false }
      const stowable = decision.options.filter((option) => option.location.area !== 'insurance')
      const stow = pick(stowable, random)
      if (decision.canStowaway && stow) return { type: 'placeAccomplice', location: location(stow), mortgageShareIds: [], stowaway: true }
      return decision.canPass ? { type: 'passPlacement' } : null
    }
    case 'movementOrder': {
      const boatId = pick(decision.remainingBoatIds, random)
      return boatId ? { type: 'moveBoat', boatId } : null
    }
    case 'smallPilot':
    case 'largePilot': {
      const stay = decision.legalMoves.find((moves) => moves.length === 0)
      const moves = cautious && stay ? stay : pick(decision.legalMoves, random) ?? []
      return { type: 'pilotMove', moves }
    }
    case 'pirateBoarding': {
      const targets: Array<string | null> = [...decision.eligibleBoatIds, ...(decision.canStay ? [null] : [])]
      const boatId = cautious && decision.canStay ? null : pick(targets, random) ?? null
      if (boatId === null) return { type: 'boardPirate', accompliceId: decision.accompliceId, boatId: null }
      const displaced = pick(decision.displaceableByBoat[boatId] ?? [], random)
      return displaced
        ? { type: 'boardPirate', accompliceId: decision.accompliceId, boatId, displacedAccompliceId: displaced }
        : { type: 'boardPirate', accompliceId: decision.accompliceId, boatId }
    }
    case 'plunderDestination': {
      const destination = pick(decision.destinations, random) ?? 'port'
      return { type: 'choosePlunderDestination', boatId: decision.boatId, destination }
    }
  }
}

export interface AutopilotSettings { enabled: boolean; delay: number }

/** Dev-only switch: `?bot=1&botDelay=1200` on the Vite dev server. Never active in production builds. */
export function readAutopilotSettings(): AutopilotSettings {
  if (!import.meta.env.DEV || typeof window === 'undefined') return { enabled: false, delay: 0 }
  const params = new URLSearchParams(window.location.search)
  const delay = Number(params.get('botDelay'))
  return { enabled: params.get('bot') === '1', delay: Number.isFinite(delay) && delay >= 200 ? delay : 1200 }
}
