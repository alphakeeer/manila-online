import { BoardStage } from './BoardStage'
import type { DemoState } from './types'

interface TableViewProps {
  state: DemoState
  selectedPlacementId: string | null
  confirmedPlacementId: string | null
  onSelectPlacement: (placementId: string) => void
  onConfirmPlacement: () => void
  onOpenHandoff: () => void
  onOpenShares: () => void
  onOpenSettlement: () => void
}

export function TableView({ state, selectedPlacementId, confirmedPlacementId, onSelectPlacement, onConfirmPlacement, onOpenHandoff, onOpenShares, onOpenSettlement }: TableViewProps) {
  const currentPlayer = state.players.find((player) => player.id === state.currentPlayerId) ?? state.players[0]
  const confirmedPlacement = state.placements.find((placement) => placement.id === confirmedPlacementId)

  return (
    <main className="demo-shell">
      <header className="demo-header">
        <div className="demo-brand">
          <span className="demo-brand__seal" aria-hidden="true">馬</span>
          <div><p>南洋商会 · MANILA</p><strong>马尼拉</strong></div>
        </div>
        <div className="voyage-badge"><span>当前航程</span><strong>第 {state.voyage} 航程</strong></div>
        <button className="quiet-action demo-header__rules" type="button">规则摘要</button>
      </header>

      <ol className="player-strip" aria-label="玩家状态">
        {state.players.map((player) => (
          <li key={player.id} className={`player-card${player.isCurrent ? ' is-current' : ''}`} aria-label={`${player.name}，${player.pesos} 比索，${player.shareCount} 股份`}>
            <span className="player-card__token" style={{ backgroundColor: player.color }}>{player.name.at(-1)}</span>
            <span className="player-card__identity"><strong>{player.name}</strong><small>{player.isHarborMaster ? '港务长' : '商人'}</small></span>
            <span className="player-card__wealth"><strong>{player.pesos}</strong><small>比索</small></span>
            <span className="player-card__shares"><strong>{player.shareCount}</strong><small>股份</small></span>
          </li>
        ))}
      </ol>

      <nav className="demo-toolbar" aria-label="视觉演示场景">
        <span>视觉演示</span>
        <button type="button" onClick={onOpenHandoff}>演示交接</button>
        <button type="button" onClick={onOpenShares}>我的股份</button>
        <button type="button" onClick={onOpenSettlement}>演示结算</button>
      </nav>

      <section className="demo-workspace" aria-label="游戏桌面">
        <section className="board-panel" aria-label="游戏版图">
          <div className="panel-heading"><div><span>航线实况</span><h2>驶向马尼拉</h2></div><p>移动轮次 2 / 3</p></div>
          <BoardStage boardImageUrl={state.boardImageUrl} boats={state.boats} placements={state.placements} selectedPlacementId={selectedPlacementId} />
        </section>

        <aside className="decision-panel" aria-label="当前决策">
          <div className="decision-panel__eyebrow">轮到你行动</div>
          <h1><span>{currentPlayer?.name}</span>，放置同伙</h1>
          <p className="decision-panel__lead">选择一个仍有空位的位置。费用会在确认后支付。</p>
          <div className="placement-list">
            {state.placements.map((placement) => {
              const selected = placement.id === selectedPlacementId
              return (
                <button key={placement.id} className={`placement-card${selected ? ' is-selected' : ''}`} type="button" aria-pressed={selected} onClick={() => onSelectPlacement(placement.id)}>
                  <span className="placement-card__mark" aria-hidden="true">{selected ? '✓' : '○'}</span>
                  <span className="placement-card__copy"><strong>{placement.title}</strong><small>{placement.detail}</small></span>
                  <span className="placement-card__cost"><strong>{placement.cost}</strong> 比索</span>
                </button>
              )
            })}
          </div>
          <div className="decision-panel__summary"><span>可用资金</span><strong>{currentPlayer?.pesos} 比索</strong></div>
          <button className="primary-action" type="button" disabled={!selectedPlacementId} onClick={onConfirmPlacement}>确认放置</button>
          <p className="decision-status" role="status">{confirmedPlacement ? `已选择：${confirmedPlacement.title}` : '请选择一个同伙位'}</p>
        </aside>
      </section>

      <nav className="mobile-nav" aria-label="游戏导航">
        <button type="button" className="is-active"><span aria-hidden="true">◈</span>版图</button>
        <button type="button" aria-label="在游戏导航中打开我的股份" onClick={onOpenShares}><span aria-hidden="true">▤</span>我的股份</button>
        <button type="button"><span aria-hidden="true">◎</span>玩家</button>
      </nav>
    </main>
  )
}
