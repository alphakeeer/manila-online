import type { GameRoomSnapshot, SettlementHistory } from '@manila/protocol'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Confetti } from './Celebrations'
import { commodityPresentation, type Commodity } from './commodityPresentation'
import { useAnimatedNumber } from './motion'

type Standing = NonNullable<GameRoomSnapshot['public']['standings']>[number]

/** Chart-only steps of the commodity hues, validated against the parchment surface (contrast ≥ 3:1). */
const chartCommodity: Record<Commodity, string> = { nutmeg: '#a35a26', silk: '#3a78d0', jade: '#2a8a5f', ginseng: '#a8821a' }
const commodityOrder: Commodity[] = ['nutmeg', 'silk', 'jade', 'ginseng']
/** Fixed categorical order, validated as a sequence (adjacent pairs pass the normal-vision floor). */
const incomeCategories = [
  { key: 'cargo', label: '货物利润', color: '#2b6cb0' },
  { key: 'portBerth', label: '港口泊位', color: '#b07a12' },
  { key: 'shipyardBerth', label: '修船厂泊位', color: '#2f8a5d' },
  { key: 'forcedMortgage', label: '强制贷款', color: '#7b5ea7' },
  { key: 'plunder', label: '海盗劫掠', color: '#c0503a' },
] as const
const gainColor = '#2b6cb0'
const lossColor = '#c0503a'

const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?'

function CountUp({ value, delay = 0 }: { value: number; delay?: number }) {
  const [target, setTarget] = useState(0)
  useEffect(() => { const timer = window.setTimeout(() => setTarget(value), delay); return () => window.clearTimeout(timer) }, [value, delay])
  return <>{useAnimatedNumber(target, 1200).shown}</>
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="go-card">
    <header className="go-card__head"><h3>{title}</h3>{note && <span>{note}</span>}</header>
    {children}
  </section>
}

interface Tip { x: number; y: number; lines: ReactNode; inside?: boolean }
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const view = tip && <div className={`go-tip${tip.inside ? ' is-inside' : ''}`} style={{ left: `${tip.x}%`, top: `${tip.y}%` }} role="status">{tip.lines}</div>
  return { tip, setTip, view }
}

function VoyageBars({ deltas }: { deltas: Array<{ voyage: number; delta: number }> }) {
  const { setTip, view } = useTip()
  if (deltas.length === 0) return <p className="go-empty">还没有完成的航程。</p>
  const width = 320
  const height = 150
  const pad = { top: 14, bottom: 22, side: 8 }
  const max = Math.max(1, ...deltas.map((entry) => Math.abs(entry.delta)))
  const hasLoss = deltas.some((entry) => entry.delta < 0)
  const plotHeight = height - pad.top - pad.bottom
  const zero = pad.top + (hasLoss ? plotHeight / 2 : plotHeight)
  const scale = (hasLoss ? plotHeight / 2 : plotHeight) / max
  const slot = (width - pad.side * 2) / deltas.length
  const barWidth = Math.min(34, slot - 6)
  const best = deltas.reduce((top, entry) => entry.delta > top.delta ? entry : top, deltas[0]!)
  return <div className="go-chart" onMouseLeave={() => setTip(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`每航程收益：${deltas.map((entry) => `第${entry.voyage}航程 ${entry.delta}`).join('，')}`}>
      <line x1={pad.side} x2={width - pad.side} y1={zero} y2={zero} className="go-axis" />
      {deltas.map((entry, index) => {
        const x = pad.side + slot * index + (slot - barWidth) / 2
        const size = Math.max(2, Math.abs(entry.delta) * scale)
        const y = entry.delta >= 0 ? zero - size : zero
        const r = Math.min(4, barWidth / 2, size)
        // Rounded end away from the baseline, square at the baseline.
        const path = entry.delta >= 0
          ? `M${x},${zero} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${zero} Z`
          : `M${x},${zero} V${y + size - r} Q${x},${y + size} ${x + r},${y + size} H${x + barWidth - r} Q${x + barWidth},${y + size} ${x + barWidth},${y + size - r} V${zero} Z`
        return <g key={entry.voyage}>
          <path className="go-bar" style={{ animationDelay: `${0.4 + index * 0.08}s`, transformOrigin: entry.delta >= 0 ? 'bottom' : 'top' }} d={path} fill={entry.delta >= 0 ? gainColor : lossColor} />
          <rect x={pad.side + slot * index} y={pad.top} width={slot} height={plotHeight} fill="transparent" onMouseEnter={() => setTip({ x: ((x + barWidth / 2) / width) * 100, y: (Math.min(y, zero) / height) * 100, lines: <><strong>第 {entry.voyage} 航程</strong><span>{entry.delta >= 0 ? '+' : ''}{entry.delta} 比索</span></> })} />
          <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" className="go-tick">{entry.voyage}</text>
          {entry === best && entry.delta > 0 && <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className="go-value">+{entry.delta}</text>}
        </g>
      })}
    </svg>
    {view}
  </div>
}

function IncomeMix({ totals }: { totals: Record<string, number> }) {
  const parts = incomeCategories.map((category) => ({ ...category, amount: totals[category.key] ?? 0 })).filter((part) => part.amount > 0)
  const sum = parts.reduce((total, part) => total + part.amount, 0)
  if (sum === 0) return <p className="go-empty">这一局没有进账——下次试试押注货物或占泊位。</p>
  return <div>
    <div className="go-stack" role="img" aria-label={parts.map((part) => `${part.label} ${part.amount}`).join('，')}>
      {parts.map((part, index) => <span key={part.key} title={`${part.label}：${part.amount} 比索`} style={{ flexGrow: part.amount, background: part.color, animationDelay: `${0.4 + index * 0.1}s` }} />)}
    </div>
    <ul className="go-legend">
      {parts.map((part) => <li key={part.key}><i style={{ background: part.color }} aria-hidden="true" /><span>{part.label}</span><strong>{part.amount}</strong><small>{Math.round((part.amount / sum) * 100)}%</small></li>)}
    </ul>
  </div>
}

function MarketLines({ series, voyages }: { series: Array<{ commodity: Commodity; values: number[] }>; voyages: number }) {
  const { setTip, view } = useTip()
  const width = 340
  const height = 170
  const pad = { top: 12, right: 64, bottom: 22, left: 26 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom
  const x = (index: number) => pad.left + (voyages === 0 ? 0 : (index / voyages) * plotWidth)
  const y = (value: number) => pad.top + plotHeight - (value / 30) * plotHeight
  // Direct labels at the line ends; nudge apart so equal finals don't collide.
  const ends = series.map((line) => ({ commodity: line.commodity, value: line.values.at(-1) ?? 0 })).sort((left, right) => right.value - left.value)
  const labelY: Record<string, number> = {}
  let last = -Infinity
  for (const end of ends) { const wanted = Math.max(y(end.value), last + 12); labelY[end.commodity] = wanted; last = wanted }
  return <div className="go-chart" onMouseLeave={() => setTip(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`行情走势：${series.map((line) => `${commodityPresentation(line.commodity).label} ${line.values.join('→')}`).join('；')}`}>
      {[0, 10, 20, 30].map((tick) => <g key={tick}><line x1={pad.left} x2={pad.left + plotWidth} y1={y(tick)} y2={y(tick)} className="go-grid" /><text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" className="go-tick">{tick}</text></g>)}
      {Array.from({ length: voyages + 1 }, (_, index) => <text key={index} x={x(index)} y={height - 6} textAnchor="middle" className="go-tick">{index === 0 ? '开局' : index}</text>)}
      {series.map((line, lineIndex) => <g key={line.commodity}>
        <polyline className="go-line" style={{ animationDelay: `${0.4 + lineIndex * 0.12}s` }} points={line.values.map((value, index) => `${x(index)},${y(value)}`).join(' ')} fill="none" stroke={chartCommodity[line.commodity]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(line.values.length - 1)} cy={y(line.values.at(-1) ?? 0)} r={4} fill={chartCommodity[line.commodity]} stroke="#fff8e9" strokeWidth={2} />
        <text x={pad.left + plotWidth + 8} y={(labelY[line.commodity] ?? 0) + 4} className="go-label" fill="#3f2d1f">{commodityPresentation(line.commodity).label} {line.values.at(-1)}</text>
      </g>)}
      {Array.from({ length: voyages + 1 }, (_, index) => <rect key={`hit-${index}`} x={x(index) - plotWidth / Math.max(1, voyages) / 2} y={pad.top} width={plotWidth / Math.max(1, voyages)} height={plotHeight} fill="transparent"
        onMouseEnter={() => setTip({ x: Math.min(78, Math.max(18, (x(index) / width) * 100)), y: 0, inside: true, lines: <><strong>{index === 0 ? '开局' : `第 ${index} 航程后`}</strong>{series.map((line) => <span key={line.commodity}><i style={{ background: chartCommodity[line.commodity] }} />{commodityPresentation(line.commodity).label} {line.values[index]}</span>)}</> })} />)}
    </svg>
    {view}
    <details className="go-table"><summary>数据表</summary>
      <table><thead><tr><th>航程</th>{series.map((line) => <th key={line.commodity}>{commodityPresentation(line.commodity).label}</th>)}</tr></thead>
        <tbody>{Array.from({ length: voyages + 1 }, (_, index) => <tr key={index}><td>{index === 0 ? '开局' : index}</td>{series.map((line) => <td key={line.commodity}>{line.values[index]}</td>)}</tr>)}</tbody></table>
    </details>
  </div>
}

function Podium({ standings, selfSeat }: { standings: Standing[]; selfSeat: number }) {
  const top = standings.slice(0, 3)
  const order = [top[1], top[0], top[2]].filter((standing): standing is Standing => standing !== undefined)
  const rest = standings.slice(3)
  return <>
    <ol className="podium-stage" aria-label="领奖台">
      {order.map((standing) => {
        const rank = standings.indexOf(standing) + 1
        return <li key={standing.seat} className={`podium-stage__spot seat-${standing.seat} rank-${rank}${standing.seat === selfSeat ? ' is-self' : ''}`} style={{ animationDelay: `${0.25 + (3 - rank) * 0.35}s` }}>
          <span className="podium-stage__avatar">{rank === 1 && <b className="podium-stage__crown" aria-hidden="true">👑</b>}{initial(standing.nickname)}</span>
          <strong className="podium-stage__name">{standing.nickname}{standing.seat === selfSeat ? '（你）' : ''}</strong>
          <span className="podium-stage__wealth"><CountUp value={standing.wealth} delay={500 + (3 - rank) * 350} /> 比索</span>
          <span className="podium-stage__pillar">{rank}</span>
        </li>
      })}
    </ol>
    {rest.length > 0 && <ol className="podium-rest" start={4}>{rest.map((standing, index) => <li key={standing.seat} className={`seat-${standing.seat}${standing.seat === selfSeat ? ' is-self' : ''}`}><span>#{index + 4}</span><strong>{standing.nickname}</strong><b>{standing.wealth}</b></li>)}</ol>}
  </>
}

export function GameOverScreen({ snapshot, history, onReturnToLobby }: { snapshot: GameRoomSnapshot; history: SettlementHistory; onReturnToLobby?: () => void }) {
  const standings = snapshot.public.standings ?? []
  const selfSeat = snapshot.self.seat
  const [expanded, setExpanded] = useState(true)
  const winner = standings.find((standing) => standing.winner) ?? standings[0]
  const selfRank = standings.findIndex((standing) => standing.seat === selfSeat) + 1
  const selfWealth = standings.find((standing) => standing.seat === selfSeat)?.wealth ?? snapshot.self.pesos

  const stats = useMemo(() => {
    const settlements = [...history.settlements].sort((left, right) => left.voyage - right.voyage)
    const deltas = settlements.map((entry) => ({ voyage: entry.voyage, delta: entry.self?.pesosDelta ?? 0 }))
    const totals: Record<string, number> = {}
    for (const entry of settlements) for (const income of entry.self?.incomes ?? []) totals[income.category] = (totals[income.category] ?? 0) + income.amount
    const tally = { port: 0, shipyard: 0, plundered: 0 }
    for (const entry of settlements) for (const boat of entry.public.boats) {
      if (!boat.commodity) continue
      if (boat.plundered) tally.plundered += 1
      if (boat.status === 'port') tally.port += 1
      else if (boat.status === 'shipyard') tally.shipyard += 1
    }
    const series = commodityOrder.map((commodity) => {
      const values = [settlements[0]?.public.market.find((change) => change.commodity === commodity)?.from ?? 0]
      for (const entry of settlements) values.push(entry.public.market.find((change) => change.commodity === commodity)?.to ?? values.at(-1) ?? 0)
      return { commodity, values }
    })
    const best = deltas.reduce<{ voyage: number; delta: number } | null>((top, entry) => !top || entry.delta > top.delta ? entry : top, null)
    return { deltas, totals, tally, series, best, voyages: settlements.length }
  }, [history])

  const closer = commodityOrder.filter((commodity) => snapshot.public.market[commodity] >= 30)

  if (!expanded) return <section className="standings" aria-label="最终排名">
    <h2>最终排名</h2>
    <p className="standings__mini">🏆 {winner?.nickname} · {winner?.wealth} 比索{selfRank > 0 ? ` · 你第 ${selfRank} 名` : ''}</p>
    <div className="standings__actions">
      <button type="button" className="quiet-action" onClick={() => setExpanded(true)}>展开结算</button>
      {onReturnToLobby && <button type="button" className="primary-action" onClick={onReturnToLobby}>返回大厅</button>}
    </div>
  </section>

  return <div className="gameover" role="dialog" aria-modal="false" aria-label="终局结算">
    <Confetti pieces={90} />
    <div className="gameover__inner">
      <header className="gameover__hero">
        <p className="gameover__kicker">马尼拉黑市收市 · 共 {stats.voyages || snapshot.public.voyage} 个航程</p>
        <h1><span>{winner?.nickname}</span> 满载而归</h1>
        <p className="gameover__sub">{closer.length > 0 ? `${closer.map((commodity) => commodityPresentation(commodity).label).join('、')}行情冲上 30，交易落幕。` : '交易落幕。'}{selfRank === 1 ? '恭喜你拿下这一局！' : selfRank > 0 ? `你位列第 ${selfRank} 名，下一局再战！` : ''}</p>
      </header>
      <section className="standings is-expanded" aria-label="最终排名">
        <h2>最终排名</h2>
        <Podium standings={standings} selfSeat={selfSeat} />
      </section>
      <ul className="go-tiles">
        <li><small>你的名次</small><strong>{selfRank > 0 ? `${selfRank} / ${standings.length}` : '—'}</strong></li>
        <li><small>最终财富</small><strong><CountUp value={selfWealth} delay={900} /></strong></li>
        <li><small>最佳航程</small><strong>{stats.best && stats.best.delta > 0 ? `+${stats.best.delta}` : '—'}</strong>{stats.best && stats.best.delta > 0 && <em>第 {stats.best.voyage} 航程</em>}</li>
        <li><small>舢板去向</small><strong className="go-tiles__boats"><span title="抵达港口">⚓{stats.tally.port}</span><span title="进入修船厂">🛠{stats.tally.shipyard}</span><span title="遭劫掠">☠{stats.tally.plundered}</span></strong></li>
      </ul>
      <div className="go-grid-cards">
        <ChartCard title="我的每航程收益" note="比索"><VoyageBars deltas={stats.deltas} /></ChartCard>
        <ChartCard title="我的收入来源" note="全局合计"><IncomeMix totals={stats.totals} /></ChartCard>
        <ChartCard title="货物行情走势" note="0–30"><MarketLines series={stats.series} voyages={stats.voyages} /></ChartCard>
      </div>
      <div className="gameover__actions">
        {onReturnToLobby && <button type="button" className="primary-action" onClick={onReturnToLobby}>返回大厅 · 再开一局</button>}
        <button type="button" className="primary-action primary-action--gold" onClick={() => setExpanded(false)}>查看棋盘</button>
      </div>
    </div>
  </div>
}
