import { ApiErrorSchema, GameRoomSnapshotSchema, SettlementHistorySchema, PROTOCOL_VERSION, type ApiErrorCode, type GameCommandRequest, type GameRoomSnapshot, type SettlementHistory, type SettlementIncomeView, type SettlementPaymentView } from '@manila/protocol'
import { useEffect, useRef, useState } from 'react'
import { GameBoard } from './GameBoard'
import { commodityPresentation } from './commodityPresentation'
import { errorMessage } from './errorMessages'
import { samePlacement, type PlacementChoice } from './placement'

const incomeLabels: Record<string, string> = {
  cargo: '货物利润',
  plunder: '海盗劫掠',
  portBerth: '港口泊位',
  shipyardBerth: '修船厂泊位',
  forcedMortgage: '强制贷款',
}

function incomeText(income: SettlementIncomeView) {
  const place = income.berth ? ` ${income.berth} 位` : income.boatId ? `（${income.boatId}）` : ''
  const source = income.paidBy === 'insurance' ? '，保险支付' : income.paidBy === 'treasury' ? '，港口金库支付' : ''
  return `${incomeLabels[income.category] ?? income.category}${place}：+${income.amount}${source}`
}

function paymentText(payment: SettlementPaymentView) {
  const treasury = payment.coveredByTreasury > 0 ? `，港口金库代付 ${payment.coveredByTreasury}` : ''
  return `保险赔付 修船厂 ${payment.berth} 位：-${payment.amount}${treasury}`
}

function SettlementLedger({ history }: { history: SettlementHistory }) {
  if (history.settlements.length === 0) return null
  return <aside className="decision-panel" aria-label="航程账本"><p className="decision-panel__eyebrow">航程账本</p>
    {history.settlements.map((entry) => <div key={entry.voyage} className="settlement-entry">
      <h2>第 {entry.voyage} 航程</h2>
      <p>本人现金变化：{entry.self?.pesosDelta ?? 0}</p>
      {entry.self?.incomes.map((income, index) => <p key={`income-${index}`} className="settlement-income">{incomeText(income)}</p>)}
      {entry.self?.payments.map((payment, index) => <p key={`payment-${index}`} className="settlement-payment">{paymentText(payment)}</p>)}
      {entry.public.market.filter((change) => change.from !== change.to).map((change) => <p key={change.commodity} className="settlement-market">{commodityPresentation(change.commodity).label} 行情：{change.from} → {change.to}</p>)}
    </div>)}
  </aside>
}

type ErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'
type PendingCommand = { roomCode: string; request: GameCommandRequest }
const pendingKey = 'manila.pending-command.v1'
const commandId = () => crypto.randomUUID()
const apiError = (value: unknown): ErrorCode => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR' }
const readPending = (): PendingCommand | null => { try { const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); return typeof value === 'object' && value !== null && 'roomCode' in value && 'request' in value ? value as PendingCommand : null } catch { return null } }
const savePending = (value: PendingCommand) => sessionStorage.setItem(pendingKey, JSON.stringify(value))
const clearPending = () => sessionStorage.removeItem(pendingKey)

function DecisionPanel({ snapshot, pending, readOnly, onCommand, placementChoice, onSelectPlacement }: { snapshot: GameRoomSnapshot; pending: boolean; readOnly: boolean; onCommand: (request: GameCommandRequest) => void; placementChoice: PlacementChoice | null; onSelectPlacement: (location: PlacementChoice | null) => void }) {
  const decision = snapshot.decision
  const [amount, setAmount] = useState(decision?.kind === 'auction' ? decision.minimumBid : 1)
  const [collateral, setCollateral] = useState<string[]>([])
  const [cargo, setCargo] = useState<string[]>([])
  const [assignments, setAssignments] = useState<Array<{ boatId: string; commodity: string; lane: number; startPosition: number }>>([])
  const [displaced, setDisplaced] = useState<Record<string, string>>({})
  const [stowaway, setStowaway] = useState(false)
  useEffect(() => { setAmount(decision?.kind === 'auction' ? decision.minimumBid : 1); setCollateral([]); setCargo([]); setAssignments([]); setDisplaced({}); setStowaway(false) }, [decision?.kind, snapshot.room.revision])
  if (!decision) return <aside className="decision-panel"><p className="decision-panel__eyebrow">等待行动</p><h1>等待行动</h1><p>等待 {snapshot.public.phase.currentSeat} 号位提交操作。</p></aside>
  const disabled = pending || readOnly
  const submit = (action: GameCommandRequest['action']) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: commandId(), expectedRevision: snapshot.room.revision, action })
  const shares = snapshot.self.shares.filter((share) => 'availableCollateralShareIds' in decision && decision.availableCollateralShareIds.includes(share.id))
  const collateralPicker = shares.length > 0 && <fieldset className="collateral"><legend>声明抵押（如需）</legend>{shares.map((share) => <label key={share.id}><input type="checkbox" checked={collateral.includes(share.id)} disabled={disabled} onChange={() => setCollateral((current) => current.includes(share.id) ? current.filter((id) => id !== share.id) : [...current, share.id])} />{commodityPresentation(share.commodity).label}</label>)}</fieldset>
  if (decision.kind === 'sharePurchase') return <aside className="decision-panel" aria-label="购股操作"><p className="decision-panel__eyebrow">港务长操作</p><h1>购买<span>股份</span></h1><p>可用现金：{snapshot.self.pesos} 比索</p>{decision.available.map((option, index) => <button key={`${option.commodity}-${index}`} className="primary-action" type="button" disabled={disabled} onClick={() => submit({ type: 'buyShare', commodity: option.commodity, mortgageShareIds: collateral })}>购买{commodityPresentation(option.commodity).label}（{option.price}）</button>)}{collateralPicker}<button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'buyShare', commodity: null, mortgageShareIds: [] })}>跳过购股</button></aside>
  if (decision.kind === 'cargoSelection') return <aside className="decision-panel" aria-label="选货操作"><p className="decision-panel__eyebrow">港务长操作</p><h1>选择<span>货物</span></h1>{decision.commodities.map((commodity) => <label key={commodity}><input type="checkbox" checked={cargo.includes(commodity)} disabled={disabled} onChange={() => setCargo((current) => current.includes(commodity) ? current.filter((item) => item !== commodity) : current.length < 3 ? [...current, commodity] : current)} />{commodityPresentation(commodity).label}</label>)}<button className="primary-action" type="button" disabled={disabled || cargo.length !== 3} onClick={() => submit({ type: 'selectCargo', commodities: cargo as Array<'nutmeg' | 'silk' | 'jade' | 'ginseng'> })}>确认三种货物</button></aside>
  if (decision.kind === 'launch') {
    const rows = assignments.length === 3 ? assignments : decision.boatIds.map((boatId, index) => ({ boatId, commodity: decision.commodities[index] ?? decision.commodities[0]!, lane: decision.lanes[index] ?? 0, startPosition: decision.startPositionTriples[0]?.[index] ?? 3 }))
    const setRow = (index: number, patch: Partial<typeof rows[number]>) => setAssignments(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
    return <aside className="decision-panel" aria-label="下水操作"><p className="decision-panel__eyebrow">港务长操作</p><h1>安排<span>下水</span></h1>{rows.map((row, index) => <fieldset key={row.boatId}><legend>舢板 {index + 1}</legend><label>货物<select value={row.commodity} disabled={disabled} onChange={(event) => setRow(index, { commodity: event.target.value })}>{decision.commodities.map((commodity) => <option key={commodity} value={commodity}>{commodityPresentation(commodity).label}</option>)}</select></label><label>航线<select value={row.lane} disabled={disabled} onChange={(event) => setRow(index, { lane: Number(event.target.value) })}>{decision.lanes.map((lane) => <option key={lane} value={lane}>{['左', '中', '右'][lane]}</option>)}</select></label><label>起点<select value={row.startPosition} disabled={disabled} onChange={(event) => setRow(index, { startPosition: Number(event.target.value) })}>{[0, 1, 2, 3, 4, 5].map((position) => <option key={position} value={position}>{position}</option>)}</select></label></fieldset>)}<button className="primary-action" type="button" disabled={disabled || new Set(rows.map((row) => row.commodity)).size !== 3 || new Set(rows.map((row) => row.lane)).size !== 3 || rows.reduce((total, row) => total + row.startPosition, 0) !== 9} onClick={() => submit({ type: 'launchBoats', assignments: rows as Array<{ boatId: string; commodity: 'nutmeg' | 'silk' | 'jade' | 'ginseng'; lane: 0 | 1 | 2; startPosition: number }> })}>确认下水</button></aside>
  }
  if (decision.kind === 'placement') {
    const selected = placementChoice ? decision.options.find((option) => samePlacement(option.location, placementChoice)) : undefined
    const canStowaway = selected !== undefined && decision.canStowaway && selected.location.area !== 'insurance'
    return <aside className="decision-panel" aria-label="放置同伙">
      <p className="decision-panel__eyebrow">第 {decision.placementRound} 轮放置</p>
      <h1>放置<span>同伙</span></h1>
      {!selected && <div className="option-list">{decision.options.map((option, index) => <button key={index} className="quiet-action" type="button" disabled={disabled} onClick={() => onSelectPlacement(option.location)}>{option.location.area}{option.location.berth ? ` ${option.location.berth}` : ''}{option.location.slot !== undefined ? ` 位 ${option.location.slot + 1}` : ''}（{option.cost}）</button>)}</div>}
      {selected && <div className="placement-confirm">
        <p>已选位置：{selected.location.area}{selected.location.berth ? ` ${selected.location.berth}` : ''}{selected.location.slot !== undefined ? ` 位 ${selected.location.slot + 1}` : ''}，费用 {selected.cost}</p>
        {canStowaway && <label><input type="checkbox" checked={stowaway} disabled={disabled} onChange={() => { setStowaway((value) => !value); setCollateral([]) }} />作为偷渡客入场（现金清零，不付费，不可同时抵押）</label>}
        {!stowaway && collateralPicker}
        <button className="primary-action" type="button" disabled={disabled || (stowaway ? false : snapshot.self.pesos + collateral.length * 12 < selected.cost)} onClick={() => submit(stowaway ? { type: 'placeAccomplice', location: selected.location as PlacementChoice as Extract<GameCommandRequest['action'], { type: 'placeAccomplice' }>['location'], mortgageShareIds: [], stowaway: true } : { type: 'placeAccomplice', location: selected.location as PlacementChoice as Extract<GameCommandRequest['action'], { type: 'placeAccomplice' }>['location'], mortgageShareIds: collateral, stowaway: false })}>确认放置</button>
        <button className="quiet-action" type="button" disabled={disabled} onClick={() => onSelectPlacement(null)}>重新选择</button>
      </div>}
      <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'passPlacement' })}>放弃放置</button>
    </aside>
  }
  if (decision.kind === 'movementOrder') return <aside className="decision-panel" aria-label="移动舢板"><p className="decision-panel__eyebrow">第 {decision.movementRound} 轮移动</p><h1>选择<span>舢板</span></h1>{decision.remainingBoatIds.map((boatId) => <button key={boatId} className="primary-action" type="button" disabled={disabled} onClick={() => submit({ type: 'moveBoat', boatId })}>移动舢板</button>)}</aside>
  if (decision.kind === 'smallPilot' || decision.kind === 'largePilot') return <aside className="decision-panel" aria-label="领航操作"><p className="decision-panel__eyebrow">你的领航员</p><h1>{decision.kind === 'smallPilot' ? '小' : '大'}<span>领航员</span></h1>{decision.legalMoves.map((moves, index) => <button key={index} className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'pilotMove', moves })}>{moves.length === 0 ? '不移动' : `执行组合 ${index + 1}`}</button>)}</aside>
  if (decision.kind === 'pirateBoarding') return <aside className="decision-panel" aria-label="海盗登船"><p className="decision-panel__eyebrow">你的海盗</p><h1>选择<span>登船</span></h1>
    {decision.eligibleBoatIds.map((boatId) => {
      const displaceable = decision.displaceableByBoat[boatId] ?? []
      const chosen = displaced[boatId] ?? displaceable[0]
      return <div key={boatId} className="pirate-target">
        {displaceable.length > 0 && <label>挤下同伙<select value={chosen} disabled={disabled} onChange={(event) => setDisplaced((current) => ({ ...current, [boatId]: event.target.value }))}>{displaceable.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>}
        <button className="primary-action" type="button" disabled={disabled} onClick={() => chosen ? submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId, displacedAccompliceId: chosen }) : submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId })}>登上舢板</button>
      </div>
    })}
    <button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'boardPirate', accompliceId: decision.accompliceId, boatId: null })}>留在海盗船</button></aside>
  if (decision.kind === 'plunderDestination') return <aside className="decision-panel" aria-label="劫掠去向"><p className="decision-panel__eyebrow">海盗船长</p><h1>决定<span>去向</span></h1>{decision.destinations.map((destination) => <button key={destination} className="primary-action" type="button" disabled={disabled} onClick={() => submit({ type: 'choosePlunderDestination', boatId: decision.boatId, destination })}>{destination === 'port' ? '送往港口' : '送往修船厂'}</button>)}</aside>
  if (decision.kind !== 'auction') return <aside className="decision-panel"><p className="decision-panel__eyebrow">等待后续切片</p><h1>{decision.kind}</h1></aside>
  return <aside className="decision-panel" aria-label="竞拍操作"><p className="decision-panel__eyebrow">{readOnly ? '连接恢复中' : '你的回合'}</p><h1>竞拍<span>领航员</span></h1><p>最低出价：{decision.minimumBid} 比索。你持有 {snapshot.self.pesos} 比索。</p>
    <label>出价<input type="number" min={decision.minimumBid} max={decision.maximumBid} value={amount} disabled={disabled} onChange={(event) => setAmount(Number(event.target.value))} /></label>
    {collateralPicker}
    <button className="primary-action" type="button" disabled={disabled || !Number.isInteger(amount) || amount < decision.minimumBid || amount > decision.maximumBid} onClick={() => submit({ type: 'bid', amount, mortgageShareIds: collateral })}>确认出价</button><button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'passAuction' })}>放弃本轮竞拍</button>
  </aside>
}

function FinancePanel({ snapshot, pending, readOnly, onCommand }: { snapshot: GameRoomSnapshot; pending: boolean; readOnly: boolean; onCommand: (request: GameCommandRequest) => void }) {
  const submit = (action: GameCommandRequest['action']) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: commandId(), expectedRevision: snapshot.room.revision, action })
  return <aside className="decision-panel" aria-label="个人财务"><p className="decision-panel__eyebrow">个人财务</p><h1>股份<span>贷款</span></h1>{snapshot.self.shares.length === 0 ? <p>尚未持有股份。</p> : snapshot.self.shares.map((share) => <div key={share.id}><strong>{commodityPresentation(share.commodity).label}</strong><button className="quiet-action" type="button" disabled={pending || readOnly} onClick={() => submit(share.mortgaged ? { type: 'redeemShare', shareId: share.id } : { type: 'mortgageShare', shareId: share.id })}>{share.mortgaged ? '赎回（15）' : '贷款（12）'}</button></div>)}</aside>
}

export function GameRoom({ roomCode, initialSnapshot, onSessionExpired, onLogout }: { roomCode: string; initialSnapshot: GameRoomSnapshot | null; onSessionExpired: () => void; onLogout: () => void }) {
  const [snapshot, setSnapshot] = useState<GameRoomSnapshot | null>(initialSnapshot)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const [connected, setConnected] = useState(false)
  const [history, setHistory] = useState<SettlementHistory>({ settlements: [] })
  const [placementChoice, setPlacementChoice] = useState<PlacementChoice | null>(null)
  const revision = useRef(initialSnapshot?.room.revision ?? -1)
  const socket = useRef<WebSocket | null>(null)
  const retryTimer = useRef<number | null>(null)
  const attempt = useRef(0)
  const update = (next: GameRoomSnapshot) => { if (next.room.revision >= revision.current) { revision.current = next.room.revision; setSnapshot(next); setPlacementChoice(null) } }
  const expire = () => { clearPending(); setConnected(false); setSnapshot(null); onSessionExpired() }

  async function sendCommand(request: GameCommandRequest, isRetry = false) {
    if (!isRetry) savePending({ roomCode, request })
    setPending(true); setError(null)
    try {
      const response = await fetch(`/api/rooms/${roomCode}/commands`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
      const body: unknown = await response.json()
      const parsed = GameRoomSnapshotSchema.safeParse(body)
      if (response.ok && parsed.success) { clearPending(); update(parsed.data); return }
      clearPending()
      const code = apiError(body)
      if (code === 'AUTH_REQUIRED' || code === 'TOKEN_REVOKED') expire(); else setError(code)
    } catch { setError('UNKNOWN_ERROR'); setConnected(false); socket.current?.close() } finally { setPending(false) }
  }

  useEffect(() => {
    let live = true
    const stopTimer = () => { if (retryTimer.current !== null) { window.clearTimeout(retryTimer.current); retryTimer.current = null } }
    const schedule = () => {
      if (!live) return
      const base = Math.min(15_000, 500 * 2 ** attempt.current++)
      const delay = Math.round(base * (0.75 + Math.random() * 0.5))
      retryTimer.current = window.setTimeout(connect, delay)
    }
    const connect = async () => {
      stopTimer(); setConnected(false)
      try {
        const response = await fetch(`/api/rooms/${roomCode}/snapshot`, { credentials: 'same-origin' })
        const body: unknown = await response.json()
        const parsed = GameRoomSnapshotSchema.safeParse(body)
        if (!live) return
        if (!response.ok || !parsed.success) { const code = apiError(body); if (code === 'AUTH_REQUIRED' || code === 'TOKEN_REVOKED') expire(); else { setError(code); schedule() }; return }
        update(parsed.data)
        const nextSocket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${roomCode}/subscribe`)
        socket.current = nextSocket
        nextSocket.onopen = () => {
          if (!live) return
          attempt.current = 0; setConnected(true)
          const saved = readPending(); if (saved?.roomCode === roomCode) void sendCommand(saved.request, true)
        }
        nextSocket.onmessage = (event) => { try { const message = JSON.parse(String(event.data)) as { type?: string; snapshot?: unknown }; if (message.type === 'room.snapshot') { const view = GameRoomSnapshotSchema.safeParse(message.snapshot); if (view.success) update(view.data) }; if (message.type === 'session.expired') expire() } catch { setError('UNKNOWN_ERROR') } }
        nextSocket.onclose = () => { if (live) { setConnected(false); schedule() } }
        nextSocket.onerror = () => nextSocket.close()
      } catch { if (live) { setError('UNKNOWN_ERROR'); schedule() } }
    }
    void connect()
    const heartbeat = window.setInterval(() => { const active = socket.current; if (active?.readyState === WebSocket.OPEN) active.send(JSON.stringify({ type: 'heartbeat', revision: revision.current })) }, 20_000)
    return () => { live = false; stopTimer(); window.clearInterval(heartbeat); socket.current?.close(); socket.current = null }
  }, [roomCode])

  useEffect(() => {
    void fetch(`/api/rooms/${roomCode}/history`, { credentials: 'same-origin' }).then(async (response) => {
      const parsed = SettlementHistorySchema.safeParse(await response.json())
      if (response.ok && parsed.success) setHistory(parsed.data)
    }).catch(() => undefined)
  }, [roomCode, snapshot?.room.revision])

  if (!snapshot) return <main className="session-lobby"><p>正在同步房间…</p>{error && <p role="alert">{errorMessage(error)}</p>}</main>
  const readOnly = !connected || snapshot.room.readOnly
  return <main className="game-shell" data-room-revision={snapshot.room.revision}>
    <header className="game-header"><div className="game-brand"><span className="game-brand__seal">M</span><div><p>在线牌局</p><strong>MANILA</strong></div></div><div className="voyage-badge"><span>房间</span><strong>{snapshot.room.code}</strong></div><button className="quiet-action" type="button" onClick={onLogout}>退出</button></header>
    {snapshot.room.status === 'closed' && <p className="room-status-banner" role="status">房间已被管理员关闭，当前只能查看记录。</p>}
    {snapshot.room.status === 'finished' && <p className="room-status-banner" role="status">本局已结束，以下为最终结果。</p>}
    {!connected && <p className="room-status-banner" role="status">连接已断开，正在重连；重连前无法提交操作。</p>}
    <ul className="player-strip">{snapshot.public.players.map((player) => <li key={player.seat} className={`player-card${player.seat === snapshot.public.phase.currentSeat ? ' is-current' : ''}`}><span className="player-card__token">{player.seat}</span><div className="player-card__identity"><strong>{player.nickname}</strong><small>{player.seat === snapshot.public.harborMasterSeat ? '港务长' : '玩家'}</small></div>{player.seat === snapshot.self.seat && <div className="player-card__wealth"><small>比索</small><strong>{snapshot.self.pesos}</strong></div>}</li>)}</ul>
    <section className="game-workspace">
      <GameBoard snapshot={snapshot} placementChoice={placementChoice} onSelectPlacement={setPlacementChoice} />
      <DecisionPanel snapshot={snapshot} pending={pending} readOnly={readOnly} onCommand={(request) => void sendCommand(request)} placementChoice={placementChoice} onSelectPlacement={setPlacementChoice} />
      <FinancePanel snapshot={snapshot} pending={pending} readOnly={readOnly} onCommand={(request) => void sendCommand(request)} />
      <SettlementLedger history={history} />
    </section>
    {snapshot.public.standings && <section className="standings"><h2>最终排名</h2>{snapshot.public.standings.map((standing, index) => <p key={standing.seat}>#{index + 1} {standing.nickname}：{standing.wealth}{standing.winner ? '（胜者）' : ''}</p>)}</section>}
    {error && <p className="rule-error" role="alert">{errorMessage(error)}</p>}
  </main>
}
