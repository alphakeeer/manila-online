import { PROTOCOL_VERSION, type GameCommandRequest, type GameRoomSnapshot } from '@manila/protocol'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { commodityPresentation, type Commodity } from './commodityPresentation'
import { DieFace } from './DiceTray'
import { shareArt, type BoardPreview, type LaunchPreviewRow } from './GameBoard'
import { areaHints, boatCommodity, boatLabel, deltaText, laneLabels, locationLabel, phaseActivity, playerName } from './labels'
import { samePlacement, type PlacementChoice } from './placement'

type Action = GameCommandRequest['action']
type Decision = NonNullable<GameRoomSnapshot['decision']>
type DecisionOf<K extends Decision['kind']> = Extract<Decision, { kind: K }>
type PlacementLocation = Extract<Action, { type: 'placeAccomplice' }>['location']
const MORTGAGE_VALUE = 12

interface DecisionProps<K extends Decision['kind']> {
  decision: DecisionOf<K>
  snapshot: GameRoomSnapshot
  disabled: boolean
  submit: (action: Action) => void
}

function Panel({ label, eyebrow, title, accent, children }: { label: string; eyebrow: string; title: string; accent: string; children: ReactNode }) {
  return <aside className="decision-panel is-active" aria-label={label}>
    <p className="decision-panel__eyebrow">{eyebrow}</p>
    <h1>{title}<span>{accent}</span></h1>
    {children}
  </aside>
}

function useToggleList<T>(initial: T[] = []) {
  const [items, setItems] = useState<T[]>(initial)
  const toggle = (item: T, limit = Number.POSITIVE_INFINITY) => setItems((current) => current.includes(item) ? current.filter((value) => value !== item) : current.length < limit ? [...current, item] : current)
  return [items, toggle, setItems] as const
}

function CollateralPicker({ snapshot, available, selected, onToggle, disabled, shortfall }: { snapshot: GameRoomSnapshot; available: readonly string[]; selected: readonly string[]; onToggle: (id: string) => void; disabled: boolean; shortfall: number }) {
  const shares = snapshot.self.shares.filter((share) => available.includes(share.id))
  if (shares.length === 0) return null
  const needed = Math.max(0, Math.ceil(shortfall / MORTGAGE_VALUE))
  return <fieldset className="collateral">
    <legend>声明抵押（每张 +{MORTGAGE_VALUE}）</legend>
    {needed > 0 && <p className={`collateral__hint${selected.length >= needed ? ' is-met' : ''}`}>现金差 {shortfall}，需抵押 {needed} 张</p>}
    <div className="chip-row">
      {shares.map((share) => <label key={share.id} className={`chip chip--share ${commodityPresentation(share.commodity).className}${selected.includes(share.id) ? ' is-on' : ''}`}>
        <input type="checkbox" checked={selected.includes(share.id)} disabled={disabled} onChange={() => onToggle(share.id)} />
        {commodityPresentation(share.commodity).label}
      </label>)}
    </div>
  </fieldset>
}

function AuctionDecision({ decision, snapshot, disabled, submit, readOnly }: DecisionProps<'auction'> & { readOnly: boolean }) {
  const [amount, setAmount] = useState(decision.minimumBid)
  const [collateral, toggleCollateral] = useToggleList<string>()
  const high = snapshot.public.highestBid
  const clamp = (value: number) => Math.max(decision.minimumBid, Math.min(decision.maximumBid, value))
  const quick = [...new Set([decision.minimumBid, decision.minimumBid + 2, decision.minimumBid + 5, decision.maximumBid])].filter((value) => value >= decision.minimumBid && value <= decision.maximumBid)
  const valid = Number.isInteger(amount) && amount >= decision.minimumBid && amount <= decision.maximumBid
  return <Panel label="竞拍操作" eyebrow={readOnly ? '连接恢复中' : '你的回合'} title="竞拍" accent="港务长">
    <p className="decision-lede">{high ? <>当前最高 <strong className={`seat-text seat-${high.bidderSeat}`}>{playerName(snapshot.public, high.bidderSeat)}</strong> · <strong>{high.amount}</strong> 比索</> : '尚无人出价，抢先叫价！'}</p>
    <div className="bid-stepper">
      <button type="button" className="round-button" aria-label="减少出价" disabled={disabled || amount <= decision.minimumBid} onClick={() => setAmount((value) => clamp(value - 1))}>−</button>
      <label className="bid-stepper__value"><span>出价</span><input type="number" inputMode="numeric" min={decision.minimumBid} max={decision.maximumBid} value={amount} disabled={disabled} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      <button type="button" className="round-button" aria-label="增加出价" disabled={disabled || amount >= decision.maximumBid} onClick={() => setAmount((value) => clamp(value + 1))}>+</button>
    </div>
    <div className="chip-row chip-row--center">{quick.map((value) => <button key={value} type="button" className={`chip${value === amount ? ' is-on' : ''}`} disabled={disabled} onClick={() => setAmount(value)}>{value === decision.maximumBid ? `全押 ${value}` : value}</button>)}</div>
    <p className="decision-note">现金 {snapshot.self.pesos} · 最高可出 {decision.maximumBid}</p>
    <CollateralPicker snapshot={snapshot} available={decision.availableCollateralShareIds} selected={collateral} onToggle={toggleCollateral} disabled={disabled} shortfall={amount - snapshot.self.pesos} />
    <button className="primary-action" type="button" disabled={disabled || !valid} onClick={() => submit({ type: 'bid', amount, mortgageShareIds: collateral })}>确认出价 {valid ? amount : ''}</button>
    <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'passAuction' })}>放弃本轮竞拍</button>
  </Panel>
}

function SharePurchaseDecision({ decision, snapshot, disabled, submit }: DecisionProps<'sharePurchase'>) {
  const [collateral, toggleCollateral] = useToggleList<string>()
  // The server picks the concrete share from supply, so identical offers collapse into one card per commodity.
  const offers = decision.available.filter((option, index) => decision.available.findIndex((other) => other.commodity === option.commodity && other.price === option.price) === index)
  const budget = snapshot.self.pesos + collateral.length * MORTGAGE_VALUE
  const cheapest = offers.reduce((minimum, option) => Math.min(minimum, option.price), Number.POSITIVE_INFINITY)
  return <Panel label="购股操作" eyebrow="港务长特权" title="购买" accent="股份">
    <p className="decision-lede">可用现金 <strong>{snapshot.self.pesos}</strong> 比索，可买一张股份或跳过。现金不足时可先在下方声明抵押。</p>
    <div className="card-grid">
      {offers.map((option) => {
        const presentation = commodityPresentation(option.commodity)
        return <button key={option.commodity} className={`commodity-card ${presentation.className}`} type="button" disabled={disabled || option.price > budget} onClick={() => submit({ type: 'buyShare', commodity: option.commodity, mortgageShareIds: collateral })}>
          <img src={shareArt[option.commodity]} alt="" />
          <span className="commodity-card__name">购买{presentation.label}（{option.price}）</span>
          <small>行情 {snapshot.public.market[option.commodity]} · 剩余 {snapshot.public.shareSupply[option.commodity]} 张</small>
        </button>
      })}
    </div>
    <CollateralPicker snapshot={snapshot} available={decision.availableCollateralShareIds} selected={collateral} onToggle={toggleCollateral} disabled={disabled} shortfall={Number.isFinite(cheapest) ? cheapest - snapshot.self.pesos : 0} />
    <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'buyShare', commodity: null, mortgageShareIds: [] })}>跳过购股</button>
  </Panel>
}

function CargoSelectionDecision({ decision, snapshot, disabled, submit }: DecisionProps<'cargoSelection'>) {
  const [cargo, toggleCargo] = useToggleList<Commodity>()
  return <Panel label="选货操作" eyebrow="港务长操作" title="选择" accent="货物">
    <p className="decision-lede">挑三种货物装船，剩下一种本航程不出海。</p>
    <div className="card-grid card-grid--four">
      {decision.commodities.map((commodity) => {
        const presentation = commodityPresentation(commodity)
        const on = cargo.includes(commodity)
        return <label key={commodity} className={`commodity-card ${presentation.className}${on ? ' is-on' : ''}${!on && cargo.length >= 3 ? ' is-dim' : ''}`}>
          <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggleCargo(commodity, 3)} />
          <img src={shareArt[commodity]} alt="" />
          <span className="commodity-card__name">{presentation.label}</span>
          <small>行情 {snapshot.public.market[commodity]}</small>
        </label>
      })}
    </div>
    <p className="decision-note">已选 {cargo.length} / 3</p>
    <button className="primary-action" type="button" disabled={disabled || cargo.length !== 3} onClick={() => submit({ type: 'selectCargo', commodities: cargo })}>确认三种货物</button>
  </Panel>
}

const startPresets: ReadonlyArray<{ label: string; triple: [number, number, number] }> = [
  { label: '均衡', triple: [3, 3, 3] },
  { label: '冲刺', triple: [5, 4, 0] },
  { label: '双快', triple: [5, 2, 2] },
  { label: '稳健', triple: [4, 4, 1] },
]

function LaunchDecision({ decision, disabled, submit, onPreview }: DecisionProps<'launch'> & { onPreview: (preview: BoardPreview | null) => void }) {
  const [rows, setRows] = useState<LaunchPreviewRow[]>(() => decision.boatIds.map((boatId, index) => ({ boatId, commodity: decision.commodities[index] ?? decision.commodities[0]!, lane: decision.lanes[index] ?? 0, startPosition: decision.startPositionTriples[0]?.[index] ?? 3 })))
  useEffect(() => { onPreview({ launch: rows }) }, [rows, onPreview])
  useEffect(() => () => onPreview(null), [onPreview])
  const legal = (triple: readonly number[]) => decision.startPositionTriples.some((candidate) => candidate.every((value, index) => value === triple[index]))
  const starts = rows.map((row) => row.startPosition)
  const total = starts.reduce((sum, value) => sum + value, 0)
  const valid = new Set(rows.map((row) => row.commodity)).size === 3 && new Set(rows.map((row) => row.lane)).size === 3 && legal(starts)
  const setCommodity = (index: number, commodity: Commodity) => setRows((current) => {
    const other = current.findIndex((row, rowIndex) => rowIndex !== index && row.commodity === commodity)
    return current.map((row, rowIndex) => rowIndex === index ? { ...row, commodity } : rowIndex === other ? { ...row, commodity: current[index]!.commodity } : row)
  })
  const setStart = (index: number, startPosition: number) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, startPosition: Math.max(0, Math.min(5, startPosition)) } : row))
  return <Panel label="下水操作" eyebrow="港务长操作" title="安排" accent="下水">
    <p className="decision-lede">为每条航道选货物与起点，三船起点合计必须为 9（单船 0–5）。版图上会实时预览。</p>
    <div className="chip-row">{startPresets.filter((preset) => legal(preset.triple)).map((preset) => <button key={preset.label} type="button" className={`chip${preset.triple.every((value, index) => value === starts[index]) ? ' is-on' : ''}`} disabled={disabled} onClick={() => setRows((current) => current.map((row, index) => ({ ...row, startPosition: preset.triple[index]! })))}>{preset.label} {preset.triple.join('·')}</button>)}</div>
    <div className="launch-rows">
      {rows.map((row, index) => <fieldset key={row.boatId} className="launch-row">
        <legend>{laneLabels[row.lane] ?? `舢板 ${index + 1}`}</legend>
        <div className="chip-row">{decision.commodities.map((commodity) => <button key={commodity} type="button" className={`chip ${commodityPresentation(commodity).className}${row.commodity === commodity ? ' is-on' : ''}`} disabled={disabled} aria-pressed={row.commodity === commodity} onClick={() => setCommodity(index, commodity)}>{commodityPresentation(commodity).label}</button>)}</div>
        <div className="mini-stepper" aria-label={`${laneLabels[row.lane]}起点`}>
          <button type="button" className="round-button round-button--small" aria-label="起点后退" disabled={disabled || row.startPosition <= 0} onClick={() => setStart(index, row.startPosition - 1)}>−</button>
          <span>起点 <strong>{row.startPosition}</strong></span>
          <button type="button" className="round-button round-button--small" aria-label="起点前进" disabled={disabled || row.startPosition >= 5} onClick={() => setStart(index, row.startPosition + 1)}>+</button>
        </div>
      </fieldset>)}
    </div>
    <p className={`decision-note${total === 9 ? ' is-ok' : ' is-warn'}`}>起点合计 {total} / 9</p>
    <button className="primary-action" type="button" disabled={disabled || !valid} onClick={() => submit({ type: 'launchBoats', assignments: rows as Extract<Action, { type: 'launchBoats' }>['assignments'] })}>确认下水</button>
  </Panel>
}

const placementGroups: ReadonlyArray<{ title: string; areas: readonly string[] }> = [
  { title: '舢板货位', areas: ['cargo'] },
  { title: '港口', areas: ['port'] },
  { title: '修船厂', areas: ['shipyard'] },
  { title: '海盗船', areas: ['pirateCaptain', 'pirateCrew'] },
  { title: '领航员', areas: ['smallPilot', 'largePilot'] },
  { title: '保险事务所', areas: ['insurance'] },
]

function PlacementDecision({ decision, snapshot, disabled, submit, placementChoice, onSelectPlacement }: DecisionProps<'placement'> & { placementChoice: PlacementChoice | null; onSelectPlacement: (location: PlacementChoice | null) => void }) {
  const [collateral, toggleCollateral, setCollateral] = useToggleList<string>()
  const [stowaway, setStowaway] = useState(false)
  const boats = snapshot.public.boats
  const selected = placementChoice ? decision.options.find((option) => samePlacement(option.location, placementChoice)) : undefined
  const canStowaway = selected !== undefined && decision.canStowaway && selected.location.area !== 'insurance'
  const affordable = (cost: number) => snapshot.self.pesos + decision.availableCollateralShareIds.length * MORTGAGE_VALUE >= cost || decision.canStowaway
  return <Panel label="放置同伙" eyebrow={`第 ${decision.placementRound} 轮放置`} title="放置" accent="同伙">
    {!selected && <>
      <p className="decision-lede">点版图上的红色圆点或下方列表选择位置。现金 <strong>{snapshot.self.pesos}</strong>。</p>
      <div className="placement-groups">
        {placementGroups.map((group) => {
          const options = decision.options.filter((option) => group.areas.includes(option.location.area))
          if (options.length === 0) return null
          return <section key={group.title} className="placement-group">
            <h2>{group.title}</h2>
            <div className="option-list">
              {options.map((option, index) => {
                const commodity = option.location.area === 'cargo' ? boatCommodity(boats, option.location.boatId) : null
                return <button key={index} type="button" className={`option-button${commodity ? ` ${commodityPresentation(commodity).className}` : ''}${affordable(option.cost) ? '' : ' is-dim'}`} disabled={disabled} onClick={() => onSelectPlacement(option.location)}>
                  <span className="option-button__main">{locationLabel(option.location, boats)}</span>
                  <span className="option-button__cost">{option.cost === 0 ? '免费' : `${option.cost} 比索`}</span>
                  <small className="option-button__hint">{areaHints[option.location.area] ?? ''}</small>
                </button>
              })}
            </div>
          </section>
        })}
      </div>
    </>}
    {selected && <div className="placement-confirm">
      <p className="placement-confirm__title">{locationLabel(selected.location, boats)}<span>{selected.cost === 0 ? '免费' : `费用 ${selected.cost}`}</span></p>
      <p className="decision-note">{areaHints[selected.location.area]}</p>
      {canStowaway && <label className="toggle-line"><input type="checkbox" checked={stowaway} disabled={disabled} onChange={() => { setStowaway((value) => !value); setCollateral([]) }} />作为偷渡客入场（现金清零，不付费，不可同时抵押）</label>}
      {!stowaway && <CollateralPicker snapshot={snapshot} available={decision.availableCollateralShareIds} selected={collateral} onToggle={toggleCollateral} disabled={disabled} shortfall={selected.cost - snapshot.self.pesos} />}
      <button className="primary-action" type="button" disabled={disabled || (stowaway ? false : snapshot.self.pesos + collateral.length * MORTGAGE_VALUE < selected.cost)} onClick={() => submit({ type: 'placeAccomplice', location: selected.location as PlacementLocation, mortgageShareIds: stowaway ? [] : collateral, stowaway })}>确认放置</button>
      <button className="quiet-action" type="button" disabled={disabled} onClick={() => onSelectPlacement(null)}>重新选择</button>
    </div>}
    <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'passPlacement' })}>放弃放置</button>
  </Panel>
}

function MovementDecision({ decision, snapshot, disabled, submit }: DecisionProps<'movementOrder'>) {
  const boats = snapshot.public.boats
  return <Panel label="移动舢板" eyebrow={`第 ${decision.movementRound} 轮移动`} title="推进" accent="舢板">
    <p className="decision-lede">按任意顺序推进舢板，也可以直接点版图上发光的船。</p>
    <div className="option-list">
      {decision.remainingBoatIds.map((boatId) => {
        const boat = boats.find((candidate) => candidate.id === boatId)
        const commodity = boat?.commodity ?? null
        const die = commodity ? decision.dice[commodity] ?? 0 : 0
        const target = (boat?.position ?? 0) + die
        return <button key={boatId} className={`option-button option-button--move${commodity ? ` ${commodityPresentation(commodity).className}` : ''}`} type="button" disabled={disabled} onClick={() => submit({ type: 'moveBoat', boatId })}>
          {commodity && <DieFace value={die} commodity={commodity} />}
          <span className="option-button__main">推进{boatLabel(boats, boatId)} +{die}</span>
          <span className="option-button__cost">{boat?.position ?? 0} → {target > 13 ? '入港' : target}{target === 13 ? ' ☠' : ''}</span>
        </button>
      })}
    </div>
  </Panel>
}

function PilotDecision({ decision, snapshot, disabled, submit, onPreview }: DecisionProps<'smallPilot' | 'largePilot'> & { onPreview: (preview: BoardPreview | null) => void }) {
  const boats = snapshot.public.boats
  useEffect(() => () => onPreview(null), [onPreview])
  const describe = (moves: DecisionOf<'smallPilot' | 'largePilot'>['legalMoves'][number]) => moves.map((move) => {
    const boat = boats.find((candidate) => candidate.id === move.boatId)
    const commodity = boat?.commodity
    const from = boat?.position ?? 0
    const to = from + move.delta
    return `${commodity ? commodityPresentation(commodity).label : '舢板'} ${deltaText(move.delta)}（${from}→${to > 13 ? '入港' : to}）`
  }).join(' · ')
  const stay = decision.legalMoves.findIndex((moves) => moves.length === 0)
  const ordered = stay >= 0 ? [decision.legalMoves[stay]!, ...decision.legalMoves.filter((_, index) => index !== stay)] : decision.legalMoves
  return <Panel label="领航操作" eyebrow="你的领航员" title={decision.kind === 'smallPilot' ? '小' : '大'} accent="领航员">
    <p className="decision-lede">{decision.kind === 'smallPilot' ? '把一艘舢板进或退 1 格。' : '一艘舢板至多 2 格，或两艘各 1 格。'}悬停可在版图预览。</p>
    <div className="option-list option-list--scroll">
      {ordered.map((moves, index) => <button key={index} className={`option-button${moves.length === 0 ? ' option-button--stay' : ''}`} type="button" disabled={disabled} onMouseEnter={() => onPreview({ pilotMoves: moves })} onFocus={() => onPreview({ pilotMoves: moves })} onMouseLeave={() => onPreview(null)} onBlur={() => onPreview(null)} onClick={() => submit({ type: 'pilotMove', moves })}>
        <span className="option-button__main">{moves.length === 0 ? '不移动' : describe(moves)}</span>
      </button>)}
    </div>
  </Panel>
}

function PirateDecision({ decision, snapshot, disabled, submit }: DecisionProps<'pirateBoarding'>) {
  const [displaced, setDisplaced] = useState<Record<string, string>>({})
  const view = snapshot.public
  const ownerName = (accompliceId: string) => playerName(view, view.accomplices.find((token) => token.id === accompliceId)?.seat)
  return <Panel label="海盗登船" eyebrow="你的海盗" title="选择" accent="登船">
    <p className="decision-lede">停在 13 格的舢板就在眼前。登船分一杯羹，或留在海盗船等待劫掠。</p>
    {decision.eligibleBoatIds.map((boatId) => {
      const displaceable = decision.displaceableByBoat[boatId] ?? []
      const chosen = displaced[boatId] ?? displaceable[0]
      const commodity = boatCommodity(view.boats, boatId)
      return <div key={boatId} className={`pirate-target${commodity ? ` ${commodityPresentation(commodity).className}` : ''}`}>
        {displaceable.length > 0 && <label>挤下同伙<select value={chosen} disabled={disabled} onChange={(event) => setDisplaced((current) => ({ ...current, [boatId]: event.target.value }))}>{displaceable.map((id) => <option key={id} value={id}>{ownerName(id)} 的同伙</option>)}</select></label>}
        <button className="primary-action" type="button" disabled={disabled} onClick={() => chosen ? submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId, displacedAccompliceId: chosen }) : submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId })}>🏴‍☠️ 登上{boatLabel(view.boats, boatId)}</button>
      </div>
    })}
    <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId: null })}>留在海盗船</button>
  </Panel>
}

function PlunderDecision({ decision, snapshot, disabled, submit }: DecisionProps<'plunderDestination'>) {
  return <Panel label="劫掠去向" eyebrow="海盗船长" title="决定" accent="去向">
    <p className="decision-lede">{boatLabel(snapshot.public.boats, decision.boatId)}已被劫掠。送往港口会让这种货物升值。</p>
    {decision.destinations.map((destination) => <button key={destination} className={destination === 'port' ? 'primary-action' : 'quiet-action'} type="button" disabled={disabled} onClick={() => submit({ type: 'choosePlunderDestination', boatId: decision.boatId, destination })}>{destination === 'port' ? '⚓ 送往港口' : '🛠️ 送往修船厂'}</button>)}
  </Panel>
}

function WaitingPanel({ snapshot }: { snapshot: GameRoomSnapshot }) {
  const view = snapshot.public
  const seat = view.phase.currentSeat
  const finished = snapshot.room.status !== 'playing'
  return <aside className="decision-panel is-waiting" aria-label="等待行动">
    <p className="decision-panel__eyebrow">等待行动</p>
    <div className="waiting-line">
      {seat !== null && !finished && <span className={`seat-dot seat-${seat}`} aria-hidden="true" />}
      <h1>{finished ? '本局已结束' : <>{seat !== null ? <span className={`seat-text seat-${seat}`}>{playerName(view, seat)}</span> : '系统'} {phaseActivity(view.phase.kind)}</>}</h1>
      {!finished && <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>}
    </div>
    {view.phase.kind === 'auction' && <p className="decision-note">{view.highestBid ? `当前最高：${playerName(view, view.highestBid.bidderSeat)} ${view.highestBid.amount} 比索` : '尚无人出价'}</p>}
  </aside>
}

export interface ActionDockProps {
  snapshot: GameRoomSnapshot
  pending: boolean
  readOnly: boolean
  onCommand: (request: GameCommandRequest) => void
  placementChoice: PlacementChoice | null
  onSelectPlacement: (location: PlacementChoice | null) => void
  onPreview: (preview: BoardPreview | null) => void
}

export function DecisionPanel({ snapshot, pending, readOnly, onCommand, placementChoice, onSelectPlacement, onPreview }: ActionDockProps) {
  const decision = snapshot.decision
  const decisionKey = useMemo(() => decision ? `${decision.kind}:${JSON.stringify(decision)}` : 'none', [decision])
  if (!decision) return <WaitingPanel snapshot={snapshot} />
  const disabled = pending || readOnly
  const submit = (action: Action) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), expectedRevision: snapshot.room.revision, action })
  const common = { snapshot, disabled, submit }
  switch (decision.kind) {
    case 'auction': return <AuctionDecision key={decisionKey} decision={decision} readOnly={readOnly} {...common} />
    case 'sharePurchase': return <SharePurchaseDecision key={decisionKey} decision={decision} {...common} />
    case 'cargoSelection': return <CargoSelectionDecision key={decisionKey} decision={decision} {...common} />
    case 'launch': return <LaunchDecision key={decisionKey} decision={decision} onPreview={onPreview} {...common} />
    case 'placement': return <PlacementDecision key={decisionKey} decision={decision} placementChoice={placementChoice} onSelectPlacement={onSelectPlacement} {...common} />
    case 'movementOrder': return <MovementDecision key={decisionKey} decision={decision} {...common} />
    case 'smallPilot':
    case 'largePilot': return <PilotDecision key={decisionKey} decision={decision} onPreview={onPreview} {...common} />
    case 'pirateBoarding': return <PirateDecision key={decisionKey} decision={decision} {...common} />
    case 'plunderDestination': return <PlunderDecision key={decisionKey} decision={decision} {...common} />
  }
}
