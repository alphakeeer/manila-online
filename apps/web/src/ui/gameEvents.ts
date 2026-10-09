import type { GameRoomSnapshot } from '@manila/protocol'
import { commodityPresentation, type Commodity } from './commodityPresentation'
import { boatLabel, laneLabels, locationLabel, playerName } from './labels'

export type FeedTone = 'info' | 'bid' | 'pass' | 'dice' | 'gain' | 'danger' | 'arrive' | 'voyage'

export interface FeedEvent {
  id: string
  tone: FeedTone
  icon: string
  text: string
  seat?: number | undefined
  commodity?: Commodity | undefined
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

/**
 * Derive a human-readable action log by diffing two receiver snapshots.
 * Presentation only: it never infers private data, and missing intermediate
 * revisions simply collapse into fewer, coarser entries.
 */
export function deriveEvents(previous: GameRoomSnapshot | null, next: GameRoomSnapshot): FeedEvent[] {
  if (!previous || next.room.revision <= previous.room.revision) return []
  const before = previous.public
  const after = next.public
  const events: FeedEvent[] = []
  const push = (event: Omit<FeedEvent, 'id'>) => events.push({ ...event, id: `${next.room.revision}-${events.length}` })
  const name = (seat: number | null | undefined) => playerName(after, seat)

  if (after.voyage > before.voyage) push({ tone: 'voyage', icon: '⛵', text: `第 ${after.voyage} 航程启航，新一轮竞拍开始` })

  // Auction: a raised bid names the bidder; a turn change without a raise is a pass.
  if (before.phase.kind === 'auction') {
    if (after.highestBid && !sameJson(after.highestBid, before.highestBid)) {
      push({ tone: 'bid', icon: '🪙', seat: after.highestBid.bidderSeat, text: `${name(after.highestBid.bidderSeat)} 出价 ${after.highestBid.amount} 比索` })
    } else if (after.phase.kind === 'auction' && after.phase.currentSeat !== before.phase.currentSeat && before.phase.currentSeat !== null && after.voyage === before.voyage) {
      push({ tone: 'pass', icon: '✋', seat: before.phase.currentSeat, text: `${name(before.phase.currentSeat)} 放弃竞拍` })
    } else if (after.phase.kind !== 'auction' && before.phase.currentSeat !== null && before.highestBid && before.phase.currentSeat !== before.highestBid.bidderSeat) {
      push({ tone: 'pass', icon: '✋', seat: before.phase.currentSeat, text: `${name(before.phase.currentSeat)} 放弃竞拍` })
    }
  }
  if (after.harborMasterSeat !== null && after.harborMasterSeat !== before.harborMasterSeat) {
    const price = after.highestBid?.amount ?? before.highestBid?.amount
    push({ tone: 'voyage', icon: '👑', seat: after.harborMasterSeat, text: `${name(after.harborMasterSeat)} 成为港务长${price !== undefined ? `（${price} 比索）` : ''}` })
  }

  for (const commodity of Object.keys(after.shareSupply) as Commodity[]) {
    const bought = (before.shareSupply[commodity] ?? 0) - (after.shareSupply[commodity] ?? 0)
    if (bought > 0) push({ tone: 'gain', icon: '📜', seat: after.harborMasterSeat ?? undefined, commodity, text: `${name(after.harborMasterSeat)} 购入 ${commodityPresentation(commodity).label} 股份` })
  }
  if (before.phase.kind === 'sharePurchase' && after.phase.kind !== 'sharePurchase' && Object.keys(after.shareSupply).every((commodity) => after.shareSupply[commodity as Commodity] === before.shareSupply[commodity as Commodity])) {
    push({ tone: 'pass', icon: '✋', seat: after.harborMasterSeat ?? undefined, text: `${name(after.harborMasterSeat)} 没有购买股份` })
  }

  const launched = after.boats.filter((boat) => boat.status === 'sailing' && boat.commodity && !before.boats.find((old) => old.id === boat.id && old.status === 'sailing'))
  if (launched.length > 0) {
    const parts = launched.map((boat) => `${commodityPresentation(boat.commodity!).label}（${laneLabels[boat.lane ?? 0]}，起点 ${boat.position ?? 0}）`)
    push({ tone: 'voyage', icon: '🚣', text: `舢板下水：${parts.join('、')}` })
  }

  if (after.phase.dice && !sameJson(after.phase.dice, before.phase.dice)) {
    const dice = Object.entries(after.phase.dice).filter(([, value]) => value > 0).map(([commodity, value]) => `${commodityPresentation(commodity as Commodity).label} ${value}`)
    push({ tone: 'dice', icon: '🎲', text: `掷骰：${dice.join(' · ')}` })
  }

  let placedThisTurn = false
  for (const token of after.accomplices) {
    const old = before.accomplices.find((candidate) => candidate.id === token.id)
    if (!token.location || sameJson(old?.location ?? null, token.location)) continue
    if (!old?.location) {
      placedThisTurn = true
      push({ tone: 'info', icon: '📍', seat: token.seat, text: `${name(token.seat)} 派同伙到 ${locationLabel(token.location, after.boats)}` })
    } else if (old.location.area.startsWith('pirate') && token.location.area === 'cargo') {
      push({ tone: 'danger', icon: '🏴‍☠️', seat: token.seat, text: `${name(token.seat)} 的海盗登上了 ${boatLabel(after.boats, token.location.boatId)}` })
    } else if (old.location.area === 'pirateCrew' && token.location.area === 'pirateCaptain') {
      push({ tone: 'info', icon: '🏴‍☠️', seat: token.seat, text: `${name(token.seat)} 升任海盗船长` })
    }
  }
  if (!placedThisTurn && before.phase.kind === 'placement' && before.phase.currentSeat !== null && before.phase.currentSeat !== after.phase.currentSeat && after.voyage === before.voyage) {
    push({ tone: 'pass', icon: '✋', seat: before.phase.currentSeat, text: `${name(before.phase.currentSeat)} 放弃放置` })
  }

  for (const boat of after.boats) {
    const old = before.boats.find((candidate) => candidate.id === boat.id)
    if (!old || !boat.commodity || after.voyage !== before.voyage) continue
    const label = `${commodityPresentation(boat.commodity).label}舢板`
    if (boat.plundered && !old.plundered) push({ tone: 'danger', icon: '☠️', commodity: boat.commodity, text: `${label}遭海盗劫掠！` })
    if (boat.status === 'port' && old.status !== 'port') push({ tone: 'arrive', icon: '⚓', commodity: boat.commodity, text: `${label}抵达马尼拉港口 ${boat.berth ?? ''}` })
    else if (boat.status === 'shipyard' && old.status !== 'shipyard') push({ tone: 'danger', icon: '🛠️', commodity: boat.commodity, text: `${label}进入修船厂 ${boat.berth ?? ''}` })
    else if (boat.status === 'sailing' && old.status === 'sailing' && boat.position !== null && old.position !== null && boat.position !== old.position) {
      const delta = boat.position - old.position
      push({ tone: 'info', icon: delta > 0 ? '🌊' : '↩️', commodity: boat.commodity, text: `${label}${delta > 0 ? '前进' : '后退'} ${Math.abs(delta)} 格 → ${boat.position}${boat.position === 13 ? '（海盗出没！）' : ''}` })
    }
  }

  for (const commodity of Object.keys(after.market) as Commodity[]) {
    const from = before.market[commodity]
    const to = after.market[commodity]
    if (from !== undefined && to !== undefined && from !== to) push({ tone: to > from ? 'gain' : 'info', icon: '📈', commodity, text: `${commodityPresentation(commodity).label} 行情 ${from} → ${to}` })
  }

  if (after.standings && !before.standings) {
    const winner = after.standings.find((standing) => standing.winner)
    push({ tone: 'voyage', icon: '🏆', seat: winner?.seat, text: winner ? `终局！${winner.nickname} 以 ${winner.wealth} 比索获胜` : '终局！' })
  }
  return events
}

/** Did the dice faces change between two snapshots (a fresh roll)? */
export function rolledDice(previous: GameRoomSnapshot | null, next: GameRoomSnapshot): boolean {
  return previous !== null && next.public.phase.dice !== null && !sameJson(previous.public.phase.dice, next.public.phase.dice)
}
