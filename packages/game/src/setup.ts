import { COMMODITIES } from './constants'
import { createRng, shuffle } from './rng'
import type { Accomplice, Boat, GameConfig, GameState, Result, RuleError, Share } from './types'

const invalid = (code: string, message: string): Result<never, RuleError> => ({
  ok: false,
  error: { code, message },
})

export function createGame(config: GameConfig): Result<GameState, RuleError> {
  if (config.players.length < 3 || config.players.length > 5) {
    return invalid('INVALID_PLAYER_COUNT', '玩家人数必须为 3–5 人')
  }
  const playerIds = config.players.map((player) => player.id)
  if (new Set(playerIds).size !== playerIds.length || playerIds.some((id) => id.length === 0)) {
    return invalid('INVALID_PLAYER_ID', '玩家 ID 必须非空且唯一')
  }
  if (!playerIds.includes(config.startingPlayerId)) {
    return invalid('INVALID_STARTING_PLAYER', '起始出价者必须是参赛玩家')
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffff_ffff) {
    return invalid('INVALID_SEED', 'seed 必须是 uint32 整数')
  }

  const allShares: Share[] = COMMODITIES.flatMap((commodity) =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${commodity}-${index + 1}`,
      commodity,
      mortgaged: false,
    })),
  )
  const dealPool = allShares.filter((share) => Number(share.id.split('-').at(-1)) <= 3)
  const [shuffled, rng] = shuffle(dealPool, createRng(config.seed))
  const dealtIds = new Set<string>()
  const accompliceTotal = config.players.length === 3 ? 4 : 3
  const players = config.players.map((playerConfig, playerIndex) => {
    const shares = shuffled.slice(playerIndex * 2, playerIndex * 2 + 2)
    shares.forEach((share) => dealtIds.add(share.id))
    return {
      id: playerConfig.id,
      name: playerConfig.name,
      pesos: 30,
      shares,
      accompliceTotal,
      passedPlacement: false,
    }
  })
  const accomplices: Accomplice[] = players.flatMap((player) =>
    Array.from({ length: accompliceTotal }, (_, index) => ({
      id: `${player.id}-accomplice-${index + 1}`,
      playerId: player.id,
      location: null,
    })),
  )
  const boats: Boat[] = Array.from({ length: 3 }, (_, index) => ({
    id: `boat-${index + 1}`,
    commodity: null,
    lane: null,
    startPosition: null,
    position: null,
    status: 'unlaunched',
    berth: null,
    plundered: false,
  }))

  return {
    ok: true,
    value: {
      version: 1,
      config: {
        playerOrder: playerIds,
        startingPlayerId: config.startingPlayerId,
        pirateVariant: config.pirateVariant ?? 'standard',
      },
      rng,
      players,
      shareSupply: allShares.filter((share) => !dealtIds.has(share.id)),
      market: { nutmeg: 0, silk: 0, jade: 0, ginseng: 0 },
      accomplices,
      boats,
      portBerths: {},
      shipyardBerths: {},
      voyage: 1,
      harborMasterId: null,
      selectedCommodities: [],
      phase: {
        kind: 'auction',
        currentPlayerId: config.startingPlayerId,
        activePlayerIds: playerIds,
        highestBid: null,
      },
      lastMovementOrder: [],
    },
  }
}
