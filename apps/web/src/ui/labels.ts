import type { GameRoomSnapshot } from '@manila/protocol'
import { commodityPresentation, type Commodity } from './commodityPresentation'

type PublicView = GameRoomSnapshot['public']
type Boat = PublicView['boats'][number]
export interface LocationView { area: string; boatId?: string | undefined; slot?: number | undefined; berth?: 'A' | 'B' | 'C' | undefined }

export const laneLabels = ['左航道', '中航道', '右航道'] as const

export function playerName(view: PublicView, seat: number | null | undefined): string {
  if (seat === null || seat === undefined) return '—'
  return view.players.find((player) => player.seat === seat)?.nickname ?? `${seat} 号位`
}

export function boatLabel(boats: readonly Boat[], boatId: string | undefined): string {
  const commodity = boats.find((boat) => boat.id === boatId)?.commodity
  return commodity ? `${commodityPresentation(commodity).label}舢板` : '舢板'
}

export function boatCommodity(boats: readonly Boat[], boatId: string | undefined): Commodity | null {
  return boats.find((boat) => boat.id === boatId)?.commodity ?? null
}

const areaLabels: Record<string, string> = {
  port: '港口',
  shipyard: '修船厂',
  pirateCaptain: '海盗船长',
  pirateCrew: '海盗船员',
  smallPilot: '小领航员',
  largePilot: '大领航员',
  insurance: '保险事务所',
}

export function locationLabel(location: LocationView, boats: readonly Boat[]): string {
  if (location.area === 'cargo') return `${boatLabel(boats, location.boatId)} · 第 ${(location.slot ?? 0) + 1} 位`
  const area = areaLabels[location.area] ?? location.area
  return location.berth ? `${area} ${location.berth}` : area
}

/** Short role hints quoted from the rulebook (马尼拉_中文规则_翻译.md); presentation only. */
export const areaHints: Record<string, string> = {
  cargo: '舢板抵港后分享货物利润',
  port: '有舢板停入该泊位即获报酬',
  shipyard: '有舢板进入该泊位即获报酬',
  pirateCaptain: '第二轮末登船、第三轮末劫掠 13 格舢板，船长先行',
  pirateCrew: '船长之后行动，同样可登船或劫掠',
  smallPilot: '第三轮前把一艘舢板进退 1 格',
  largePilot: '第三轮前一艘至多 2 格，或两艘各 1 格',
  insurance: '立即获得 10 比索，但需承担修船厂赔付',
}

export type PhaseGroup = 'auction' | 'harbor' | 'placement' | 'sailing' | 'over'

export function phaseGroup(kind: string): PhaseGroup {
  if (kind === 'auction') return 'auction'
  if (kind === 'sharePurchase' || kind === 'cargoSelection' || kind === 'launch') return 'harbor'
  if (kind === 'placement') return 'placement'
  if (kind === 'gameOver') return 'over'
  return 'sailing'
}

export const phaseSteps: ReadonlyArray<{ group: PhaseGroup; label: string }> = [
  { group: 'auction', label: '竞拍' },
  { group: 'harbor', label: '港务长' },
  { group: 'placement', label: '放置' },
  { group: 'sailing', label: '航行' },
]

/** What a waiting player sees while someone else decides. */
export function phaseActivity(kind: string): string {
  switch (kind) {
    case 'auction': return '正在竞拍港务长'
    case 'sharePurchase': return '正在考虑购买股份'
    case 'cargoSelection': return '正在挑选货物'
    case 'launch': return '正在安排舢板下水'
    case 'placement': return '正在放置同伙'
    case 'movementOrder': return '正在掷骰推进舢板'
    case 'smallPilot': return '正在操控小领航员'
    case 'largePilot': return '正在操控大领航员'
    case 'pirateBoarding': return '正在决定海盗是否登船'
    case 'plunderDestination': return '正在决定被劫舢板的去向'
    case 'gameOver': return '本局已结束'
    default: return '正在行动'
  }
}

/** What the acting player is asked to do, phrased to them. */
export function yourTurnPrompt(kind: string): string {
  switch (kind) {
    case 'auction': return '竞拍港务长'
    case 'sharePurchase': return '购买股份'
    case 'cargoSelection': return '挑选货物'
    case 'launch': return '安排舢板下水'
    case 'placement': return '放置同伙'
    case 'movementOrder': return '推进舢板'
    case 'smallPilot':
    case 'largePilot': return '操控领航员'
    case 'pirateBoarding': return '海盗登船'
    case 'plunderDestination': return '决定赃船去向'
    default: return '请行动'
  }
}

export function deltaText(delta: number): string {
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`
}
