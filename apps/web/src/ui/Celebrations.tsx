import type { SettlementEntry } from '@manila/protocol'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { commodityPresentation } from './commodityPresentation'
import { useAnimatedNumber } from './motion'
import { incomeText, paymentText } from './Purse'

export function Confetti({ pieces = 60 }: { pieces?: number }) {
  const bits = useMemo(() => Array.from({ length: pieces }, (_, index) => ({
    '--x': `${Math.random() * 100}%`,
    '--delay': `${Math.random() * 0.9}s`,
    '--spin': `${(Math.random() * 2 - 1) * 720}deg`,
    '--drift': `${(Math.random() * 2 - 1) * 90}px`,
    '--hue': `${[8, 45, 150, 210, 280][index % 5]}`,
  }) as CSSProperties), [pieces])
  return <div className="confetti" aria-hidden="true">{bits.map((style, index) => <i key={index} style={style} />)}</div>
}

/** A short, non-blocking "your move" flourish; pointer events pass through. */
export function TurnBanner({ turnKey, label }: { turnKey: number; label: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (turnKey === 0) return
    setShown(true)
    const timer = window.setTimeout(() => setShown(false), 1900)
    return () => window.clearTimeout(timer)
  }, [turnKey])
  if (!shown) return null
  return <div key={turnKey} className="turn-banner" role="status"><strong>轮到你了</strong><span>{label}</span></div>
}

/** Voyage result card. Deliberately non-modal so the next decision stays clickable underneath. */
export function SettlementReveal({ entry, onClose }: { entry: SettlementEntry; onClose: () => void }) {
  const delta = entry.self?.pesosDelta ?? 0
  const [target, setTarget] = useState(0)
  const { shown } = useAnimatedNumber(target, 1100)
  useEffect(() => { setTarget(delta) }, [delta])
  useEffect(() => {
    const timer = window.setTimeout(onClose, 16_000)
    return () => window.clearTimeout(timer)
  }, [onClose])
  return <section className="settlement-reveal" aria-label={`第 ${entry.voyage} 航程结算`}>
    {delta > 0 && <Confetti pieces={36} />}
    <header>
      <p className="decision-panel__eyebrow">第 {entry.voyage} 航程结算</p>
      <p className={`settlement-reveal__total${delta >= 0 ? ' is-up' : ' is-down'}`}>{delta >= 0 ? '+' : ''}{shown}<small> 比索</small></p>
    </header>
    <ul className="settlement-reveal__boats">
      {entry.public.boats.map((boat) => boat.commodity && <li key={boat.id} className={`${commodityPresentation(boat.commodity).className} is-${boat.plundered ? 'plundered' : boat.status}`}>
        <strong>{commodityPresentation(boat.commodity).label}</strong>
        <span>{boat.plundered ? '☠ 遭劫' : ''}{boat.status === 'port' ? ` ⚓ 港口 ${boat.berth ?? ''}` : boat.status === 'shipyard' ? ` 🛠 修船厂 ${boat.berth ?? ''}` : ''}</span>
      </li>)}
    </ul>
    <div className="settlement-reveal__lines">
      {entry.self?.incomes.map((income, index) => <p key={`i-${index}`} className="settlement-income" style={{ animationDelay: `${0.25 + index * 0.18}s` }}><span>{incomeText(income)}</span><b>+{income.amount}</b></p>)}
      {entry.self?.payments.map((payment, index) => <p key={`p-${index}`} className="settlement-payment" style={{ animationDelay: `${0.25 + ((entry.self?.incomes.length ?? 0) + index) * 0.18}s` }}><span>{paymentText(payment)}</span><b>−{payment.amount}</b></p>)}
      {(entry.self?.incomes.length ?? 0) + (entry.self?.payments.length ?? 0) === 0 && <p className="side-card__empty">这一航程你没有进账，下一程加油！</p>}
      {entry.public.market.filter((change) => change.from !== change.to).map((change) => <p key={change.commodity} className="settlement-market"><span>{commodityPresentation(change.commodity).label} 行情</span><b>{change.from} → {change.to}</b></p>)}
    </div>
    <button type="button" className="primary-action" onClick={onClose}>继续航行</button>
  </section>
}
