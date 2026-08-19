import type { DemoSettlementRow, DemoShare } from './types'

export function HandoffOverlay({ playerName, onAccept }: { playerName: string; onAccept: () => void }) {
  return (
    <main className="handoff-stage">
      <section className="handoff-card" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
        <span className="handoff-card__seal" aria-hidden="true">馬</span>
        <p className="overlay-kicker">HOT-SEAT · 玩家交接</p>
        <h1 id="handoff-title">玩家交接</h1>
        <p>请把设备交给 <strong>{playerName}</strong></p>
        <small>接手前，资金与股份等私人信息将保持隐藏。</small>
        <button className="primary-action" type="button" onClick={onAccept}>确认接手</button>
      </section>
    </main>
  )
}

export function SharesDrawer({ shares, onClose }: { shares: DemoShare[]; onClose: () => void }) {
  return (
    <div className="overlay-scrim">
      <section className="shares-drawer" role="dialog" aria-modal="true" aria-labelledby="shares-title">
        <div className="overlay-heading">
          <div><p className="overlay-kicker">阿青的私有资产</p><h2 id="shares-title">我的股份</h2></div>
          <button type="button" aria-label="关闭股份" onClick={onClose}>×</button>
        </div>
        <div className="share-grid">
          {shares.map((share) => (
            <article key={share.id} className={`share-card${share.mortgaged ? ' is-mortgaged' : ''}`}>
              <div className="share-card__image-wrap">
                <img src={share.imageUrl} alt={`${share.cargo}股份`} />
                {share.mortgaged && <span>已抵押</span>}
              </div>
              <div><strong>{share.cargo}</strong><small>当前价值 {share.marketValue} 比索</small></div>
            </article>
          ))}
        </div>
        <div className="drawer-note">抵押可立即获得 12 比索 · 赎回需支付 15 比索</div>
      </section>
    </div>
  )
}

export function SettlementModal({ rows, onClose }: { rows: DemoSettlementRow[]; onClose: () => void }) {
  const income = rows.reduce((sum, row) => sum + row.delta, 0)
  return (
    <div className="overlay-scrim overlay-scrim--centered">
      <section className="settlement-modal" role="dialog" aria-modal="true" aria-labelledby="settlement-title">
        <p className="overlay-kicker">第 2 航程完成</p>
        <h2 id="settlement-title">航程结算</h2>
        <p className="settlement-modal__lead">舢板安全抵港，港口的钟声响起。</p>
        <div className="settlement-rows">
          {rows.map((row) => (
            <div key={row.label} className="settlement-row">
              <span><strong>{row.label}</strong><small>{row.detail}</small></span>
              <b className={row.delta > 0 ? 'is-positive' : ''}>{row.delta > 0 ? `+${row.delta}` : '—'}</b>
            </div>
          ))}
        </div>
        <div className="settlement-total"><span>本航程收入</span><strong>+{income} 比索</strong></div>
        <button className="primary-action" type="button" onClick={onClose}>返回版图</button>
      </section>
    </div>
  )
}
