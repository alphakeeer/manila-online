import { runAcceptanceSimulation } from '@manila/game/simulation'

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} 必须是正整数`)
  return value
}

const games = argument('games', 10)
const playerCount = argument('players', 3)
const rootSeed = argument('seed', 0x4d41_4e49)
const results = runAcceptanceSimulation({ games, playerCount, rootSeed })

for (const result of results) {
  const winners = result.standings.filter((standing) => standing.winner).map((standing) => `${standing.name}(${standing.wealth})`).join('、')
  console.log(`seed=${result.seed} ${result.pirateVariant} 航程=${result.voyages} 迁移=${result.transitions} 赢家=${winners}`)
}
console.log(`完成 ${results.length} 局，全部状态合法。`)
