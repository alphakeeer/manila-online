import type { DemoState } from './types'

const asset = (file: string) => new URL(`../../manila_assets/${file}`, import.meta.url).href

export const demoState: DemoState = {
  voyage: 2,
  currentPlayerId: 'p1',
  players: [
    { id: 'p1', name: '阿青', pesos: 29, shareCount: 3, color: '#c95b45', isCurrent: true, isHarborMaster: true },
    { id: 'p2', name: '阿明', pesos: 34, shareCount: 2, color: '#dfb648', isCurrent: false, isHarborMaster: false },
    { id: 'p3', name: '阿兰', pesos: 18, shareCount: 2, color: '#538c72', isCurrent: false, isHarborMaster: false },
  ],
  boats: [
    { id: 'nutmeg-boat', cargo: '肉豆蔻', color: '#714531', x: 31, y: 58, routePosition: 8 },
    { id: 'silk-boat', cargo: '丝绸', color: '#5678b6', x: 49, y: 51, routePosition: 9 },
    { id: 'jade-boat', cargo: '玉石', color: '#4f8c6a', x: 67, y: 63, routePosition: 7 },
  ],
  placements: [
    { id: 'ginseng-boat', title: '人参舢板', cost: 1, detail: '抵达马尼拉后参与平分 18 比索', boardX: 35, boardY: 66 },
    { id: 'port-b', title: '港口泊位 B', cost: 3, detail: '第二艘舢板抵港时获得 8 比索', boardX: 81, boardY: 17 },
  ],
  shares: [
    { id: 'nutmeg-share', cargo: '肉豆蔻', marketValue: 10, imageUrl: asset('nutmeg_shares.png'), mortgaged: false },
    { id: 'silk-share', cargo: '丝绸', marketValue: 20, imageUrl: asset('silk_shares.png'), mortgaged: false },
    { id: 'ginseng-share', cargo: '人参', marketValue: 5, imageUrl: asset('ginseng_shares.png'), mortgaged: true },
  ],
  settlement: [
    { label: '人参舢板抵港', detail: '货物同伙分得利润', delta: 18 },
    { label: '港口泊位 B', detail: '第二艘舢板安全抵达', delta: 8 },
    { label: '黑市行情表', detail: '人参价值从 0 上升到 5', delta: 0 },
  ],
  boardImageUrl: asset('game_board.jpg'),
}
