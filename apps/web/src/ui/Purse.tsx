import { PROTOCOL_VERSION, type GameCommandRequest, type GameRoomSnapshot, type SettlementHistory, type SettlementIncomeView, type SettlementPaymentView } from '@manila/protocol'
import { commodityPresentation } from './commodityPresentation'
import { shareArt } from './GameBoard'
import { useAnimatedNumber } from './motion'

const incomeLabels: Record<string, string> = {
  cargo: '货物利润',
  plunder: '海盗劫掠',
  portBerth: '港口泊位',
  shipyardBerth: '修船厂泊位',
  forcedMortgage: '强制贷款',
}

export function incomeText(income: SettlementIncomeView) {
  const commodity = income.commodity ? `${commodityPresentation(income.commodity).label} ` : ''
  const place = income.berth ? ` ${income.berth} 位` : ''
  const source = income.paidBy === 'insurance' ? '（保险支付）' : income.paidBy === 'treasury' ? '（金库支付）' : ''
  return `${commodity}${incomeLabels[income.category] ?? income.category}${place}${source}`
}

export function paymentText(payment: SettlementPaymentView) {
  const treasury = payment.coveredByTreasury > 0 ? `（金库代付 ${payment.coveredByTreasury}）` : ''
  return `保险赔付 修船厂 ${payment.berth} 位${treasury}`
}

/** Private wallet and shares; mortgage/redeem stay available whenever the server allows them. */
export function Purse({ snapshot, pending, readOnly, onCommand }: { snapshot: GameRoomSnapshot; pending: boolean; readOnly: boolean; onCommand: (request: GameCommandRequest) => void }) {
  const submit = (action: GameCommandRequest['action']) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), expectedRevision: snapshot.room.revision, action })
  const { shown, delta } = useAnimatedNumber(snapshot.self.pesos)
  return <section className="side-card purse" aria-label="个人财务">
    <div className="purse__head">
      <h2 className="side-card__title">我的钱袋</h2>
      <p className="purse__pesos"><span className="coin" aria-hidden="true" /><strong>{shown}</strong> 比索
        {delta && <span key={delta.key} className={`float-delta${delta.amount > 0 ? ' is-up' : ' is-down'}`}>{delta.amount > 0 ? `+${delta.amount}` : delta.amount}</span>}
      </p>
    </div>
    {snapshot.self.shares.length === 0 ? <p className="side-card__empty">尚未持有股份。港务长每航程可买一张。</p>
      : <ul className="share-hand">{snapshot.self.shares.map((share) => {
        const presentation = commodityPresentation(share.commodity)
        return <li key={share.id} className={`share-card ${presentation.className}${share.mortgaged ? ' is-mortgaged' : ''}`}>
          <img src={shareArt[share.commodity]} alt="" />
          <div className="share-card__body">
            <strong>{presentation.label}</strong>
            <small>{share.mortgaged ? '已抵押' : `行情 ${snapshot.public.market[share.commodity]}`}</small>
            <button className="mini-action" type="button" disabled={pending || readOnly} onClick={() => submit(share.mortgaged ? { type: 'redeemShare', shareId: share.id } : { type: 'mortgageShare', shareId: share.id })}>{share.mortgaged ? '赎回（15）' : '贷款（12）'}</button>
          </div>
        </li>
      })}</ul>}
  </section>
}

export function SettlementLedger({ history }: { history: SettlementHistory }) {
  if (history.settlements.length === 0) return null
  return <section className="side-card ledger" aria-label="航程账本">
    <h2 className="side-card__title">航程账本</h2>
    {[...history.settlements].reverse().map((entry) => <details key={entry.voyage} className="settlement-entry" open={entry.voyage === history.settlements.length}>
      <summary><span>第 {entry.voyage} 航程</span><strong className={(entry.self?.pesosDelta ?? 0) >= 0 ? 'is-up' : 'is-down'}>{(entry.self?.pesosDelta ?? 0) >= 0 ? '+' : ''}{entry.self?.pesosDelta ?? 0}</strong></summary>
      {entry.self?.incomes.map((income, index) => <p key={`income-${index}`} className="settlement-income"><span>{incomeText(income)}</span><b>+{income.amount}</b></p>)}
      {entry.self?.payments.map((payment, index) => <p key={`payment-${index}`} className="settlement-payment"><span>{paymentText(payment)}</span><b>−{payment.amount}</b></p>)}
      {entry.public.market.filter((change) => change.from !== change.to).map((change) => <p key={change.commodity} className="settlement-market"><span>{commodityPresentation(change.commodity).label} 行情</span><b>{change.from} → {change.to}</b></p>)}
    </details>)}
  </section>
}
