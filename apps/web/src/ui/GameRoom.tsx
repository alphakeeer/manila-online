import { ApiErrorSchema, GameRoomSnapshotSchema, PROTOCOL_VERSION, SettlementHistorySchema, type ApiErrorCode, type GameCommandRequest, type GameRoomSnapshot, type SettlementEntry, type SettlementHistory } from '@manila/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DecisionPanel } from './ActionDock'
import { chooseAction, readAutopilotSettings } from './autopilot'
import { SettlementReveal, TurnBanner } from './Celebrations'
import { GameOverScreen } from './GameOver'
import { DiceTray } from './DiceTray'
import { errorMessage } from './errorMessages'
import { EventFeed, EventToasts } from './EventFeed'
import { GameBoard, type BoardPreview } from './GameBoard'
export { preloadGameAssets } from './GameBoard'
import { deriveEvents, rolledDice, type FeedEvent } from './gameEvents'
import { phaseActivity, phaseGroup, phaseSteps, yourTurnPrompt } from './labels'
import type { PlacementChoice } from './placement'
import { PlayerRail } from './PlayerRail'
import { Purse, SettlementLedger } from './Purse'
import { isMuted, play, setMuted, type Cue } from './sound'

type ErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'
type PendingCommand = { roomCode: string; request: GameCommandRequest }
const pendingKey = 'manila.pending-command.v1'
const apiError = (value: unknown): ErrorCode => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR' }
const readPending = (): PendingCommand | null => { try { const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); return typeof value === 'object' && value !== null && 'roomCode' in value && 'request' in value ? value as PendingCommand : null } catch { return null } }
const savePending = (value: PendingCommand) => { try { sessionStorage.setItem(pendingKey, JSON.stringify(value)) } catch { /* retry is best effort */ } }
const clearPending = () => { try { sessionStorage.removeItem(pendingKey) } catch { /* retry is best effort */ } }

const cueFor: Partial<Record<FeedEvent['tone'], Cue>> = { dice: 'dice', danger: 'danger', arrive: 'arrive', bid: 'tick', gain: 'coin', voyage: 'arrive' }
const cuePriority: Cue[] = ['fanfare', 'danger', 'dice', 'arrive', 'coin', 'tick']

function PhaseTrack({ snapshot }: { snapshot: GameRoomSnapshot }) {
  const active = phaseGroup(snapshot.public.phase.kind)
  return <div className="phase-track" aria-label={`第 ${snapshot.public.voyage} 航程：${phaseActivity(snapshot.public.phase.kind)}`}>
    <span className="phase-track__voyage">第 {snapshot.public.voyage} 航程</span>
    <ol>{phaseSteps.map((step) => <li key={step.group} className={step.group === active ? 'is-active' : undefined}>{step.label}</li>)}</ol>
  </div>
}

export function GameRoom({ roomCode, initialSnapshot, onSessionExpired, onLogout, onReturnToLobby }: { roomCode: string; initialSnapshot: GameRoomSnapshot | null; onSessionExpired: () => void; onLogout: () => void; onReturnToLobby: (revision: number) => void }) {
  const [snapshot, setSnapshot] = useState<GameRoomSnapshot | null>(initialSnapshot)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const [connected, setConnected] = useState(false)
  const [history, setHistory] = useState<SettlementHistory>({ settlements: [] })
  const [placementChoice, setPlacementChoice] = useState<PlacementChoice | null>(null)
  const [preview, setPreview] = useState<BoardPreview | null>(null)
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [presence, setPresence] = useState<ReadonlySet<number> | undefined>(undefined)
  const [rollKey, setRollKey] = useState(0)
  const [turnKey, setTurnKey] = useState(0)
  const [reveal, setReveal] = useState<SettlementEntry | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [muted, setMutedState] = useState(isMuted)
  const [autopilot] = useState(readAutopilotSettings)
  const [botOn, setBotOn] = useState(autopilot.enabled)
  const revision = useRef(initialSnapshot?.room.revision ?? -1)
  const previous = useRef<GameRoomSnapshot | null>(initialSnapshot)
  const seenSettlements = useRef<number | null>(null)
  const socket = useRef<WebSocket | null>(null)
  const retryTimer = useRef<number | null>(null)
  const attempt = useRef(0)

  const update = (next: GameRoomSnapshot) => {
    if (next.room.revision < revision.current) return
    const last = previous.current
    previous.current = next
    revision.current = next.room.revision
    setSnapshot(next)
    if (last && last.room.revision === next.room.revision) return
    setPlacementChoice(null)
    const fresh = deriveEvents(last, next)
    if (fresh.length > 0) setEvents((current) => [...fresh.reverse(), ...current].slice(0, 80))
    if (rolledDice(last, next)) setRollKey((key) => key + 1)
    const cues = new Set(fresh.map((event) => cueFor[event.tone]).filter((cue): cue is Cue => cue !== undefined))
    if (next.public.standings && !last?.public.standings) cues.add('fanfare')
    const cue = cuePriority.find((candidate) => cues.has(candidate))
    if (last && next.decision && !last.decision) {
      setTurnKey((key) => key + 1)
      setDockOpen(true)
      play('turn')
      try { navigator.vibrate?.([60, 40, 60]) } catch { /* unsupported */ }
    } else if (cue) play(cue)
  }
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
        nextSocket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as { type?: string; snapshot?: unknown; seats?: unknown }
            if (message.type === 'room.snapshot') { const view = GameRoomSnapshotSchema.safeParse(message.snapshot); if (view.success) update(view.data) }
            if (message.type === 'room.presence' && Array.isArray(message.seats)) setPresence(new Set(message.seats.filter((seat): seat is number => typeof seat === 'number')))
            if (message.type === 'session.expired') expire()
          } catch { setError('UNKNOWN_ERROR') }
        }
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
      if (!response.ok || !parsed.success) return
      setHistory(parsed.data)
      const count = parsed.data.settlements.length
      if (seenSettlements.current !== null && count > seenSettlements.current) {
        setReveal(parsed.data.settlements[count - 1] ?? null)
        if ((parsed.data.settlements[count - 1]?.self?.pesosDelta ?? 0) > 0) play('coin')
      }
      seenSettlements.current = count
    }).catch(() => undefined)
    // Settlements are only written when a voyage ends (voyage +1) or the game ends; no need to poll every move.
  }, [roomCode, snapshot?.public.voyage, Boolean(snapshot?.public.standings)])

  const yourTurn = Boolean(snapshot?.decision)
  useEffect(() => {
    const base = 'Manila'
    document.title = yourTurn ? `⚓ 轮到你了 · ${base}` : base
    return () => { document.title = base }
  }, [yourTurn])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 7000)
    return () => window.clearTimeout(timer)
  }, [error])

  // Dev-only random autopilot: think for a moment, show the placement, then submit through the normal command path.
  const decisionKey = snapshot?.decision ? JSON.stringify(snapshot.decision) : ''
  useEffect(() => {
    if (!botOn || !snapshot?.decision || pending || !connected || snapshot.room.readOnly) return
    const rateLimited = error === 'RATE_LIMITED'
    const cautious = error !== null && !rateLimited
    const timers: number[] = []
    timers.push(window.setTimeout(() => {
      const current = previous.current
      if (!current?.decision) return
      const action = chooseAction(current, Math.random, cautious)
      if (!action) return
      const send = () => void sendCommand({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), expectedRevision: current.room.revision, action })
      if (action.type === 'placeAccomplice') {
        setPlacementChoice(action.location)
        setDockOpen(true)
        timers.push(window.setTimeout(send, 750))
      } else send()
    }, rateLimited ? 8000 : autopilot.delay * (0.6 + Math.random() * 0.8)))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
    // sendCommand reads refs; re-plan only when the decision, connection or last outcome changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botOn, snapshot?.room.revision, decisionKey, pending, connected, error])

  const closeReveal = useCallback(() => setReveal(null), [])
  /** Server-side seat takeover: hand the seat to the steady bot or take it back. */
  async function setSeatAutopilot(enabled: boolean) {
    setPending(true); setError(null)
    try {
      const response = await fetch(`/api/rooms/${roomCode}/autopilot`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) })
      const body: unknown = await response.json()
      const parsed = GameRoomSnapshotSchema.safeParse(body)
      if (response.ok && parsed.success) update(parsed.data)
      else setError(apiError(body))
    } catch { setError('UNKNOWN_ERROR') } finally { setPending(false) }
  }
  const onCommand = (request: GameCommandRequest) => void sendCommand(request)

  if (!snapshot) return <main className="session-lobby"><div className="lobby-card lobby-card--center"><span className="loader-wheel" aria-hidden="true" /><p>正在同步房间…</p>{error && <p role="alert" className="form-error">{errorMessage(error)}</p>}</div></main>
  const readOnly = !connected || snapshot.room.readOnly
  const decision = snapshot.decision
  const selfAutopilot = snapshot.public.players.find((player) => player.seat === snapshot.self.seat)?.autopilot ?? null
  const movable = decision?.kind === 'movementOrder' && !pending && !readOnly ? decision.remainingBoatIds : []
  const submitMove = (boatId: string) => {
    if (!snapshot.decision || snapshot.decision.kind !== 'movementOrder') return
    onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: crypto.randomUUID(), expectedRevision: snapshot.room.revision, action: { type: 'moveBoat', boatId } })
  }

  return <main className={`game-shell${yourTurn ? ' is-your-turn' : ''}${dockOpen ? '' : ' is-dock-closed'}`} data-room-revision={snapshot.room.revision}>
    <header className="game-header">
      <div className="game-brand"><span className="game-brand__seal">M</span><div><p>马尼拉 · 在线</p><strong>MANILA</strong></div></div>
      <PhaseTrack snapshot={snapshot} />
      <div className="game-header__tools">
        <span className={`room-chip${connected ? ' is-online' : ''}`} title={connected ? '已连接' : '重连中'}><i aria-hidden="true" />{snapshot.room.code}</span>
        {autopilot.enabled && <button className={`bot-toggle${botOn ? ' is-on' : ''}`} type="button" aria-pressed={botOn} onClick={() => setBotOn((on) => !on)}>{botOn ? '🎲 随机托管中' : '🎲 随机已停'}</button>}
        {snapshot.room.status === 'playing' && !selfAutopilot && <button className="bot-toggle" type="button" disabled={pending || readOnly} title="离开一会儿？让机器人稳健地替你行动，随时可以接回" onClick={() => void setSeatAutopilot(true)}>🤖 托管</button>}
        <button className="icon-button" type="button" aria-label={muted ? '开启音效' : '关闭音效'} aria-pressed={!muted} onClick={() => { setMuted(!muted); setMutedState(!muted); if (muted) play('tick') }}>{muted ? '🔇' : '🔊'}</button>
        <button className="quiet-action quiet-action--header" type="button" onClick={onLogout}>退出</button>
      </div>
    </header>
    {snapshot.room.status === 'closed' && <p className="room-status-banner" role="status">房间已被管理员关闭，当前只能查看记录。</p>}
    {!connected && <p className="room-status-banner is-warn" role="status">连接已断开，正在重连；重连前无法提交操作。</p>}
    {selfAutopilot && snapshot.room.status === 'playing' && <div className="autopilot-banner" role="status">
      <span className="autopilot-banner__bot" aria-hidden="true">🤖</span>
      <p><strong>机器人正在替你稳健行动</strong><small>{selfAutopilot === 'away' ? '你离线期间自动托管；' : ''}它会放弃竞拍、不买股份、只做低风险放置。你也可以直接操作来接回。</small></p>
      <button type="button" className="primary-action primary-action--gold" disabled={pending || readOnly} onClick={() => void setSeatAutopilot(false)}>我回来了</button>
    </div>}
    <PlayerRail snapshot={snapshot} presence={presence} />
    <EventToasts events={events} />
    <section className="game-workspace">
      <div className="game-sidebar">
        <EventFeed events={events} />
        <SettlementLedger history={history} />
      </div>
      <div className="board-column">
        <div className="board-topbar">
          <span className="board-topbar__title">驶向马尼拉</span>
          <DiceTray dice={snapshot.public.phase.dice} rollKey={rollKey} />
        </div>
        <GameBoard snapshot={snapshot} placementChoice={placementChoice} onSelectPlacement={(location) => { setPlacementChoice(location); setDockOpen(true) }} preview={preview ?? undefined} actionableBoatIds={movable} onBoatAction={submitMove}
          overlay={<DiceTray key={rollKey} dice={rollKey > 0 ? snapshot.public.phase.dice : null} rollKey={rollKey} variant="stage" />} />
      </div>
      <div className="action-column">
        <div className={`action-dock${dockOpen ? ' is-open' : ''}${yourTurn ? ' is-your-turn' : ''}`}>
          <button type="button" className="action-dock__handle" aria-expanded={dockOpen} aria-label={dockOpen ? '收起操作面板' : '展开操作面板'} onClick={() => setDockOpen((open) => !open)}><i aria-hidden="true" /></button>
          <DecisionPanel snapshot={snapshot} pending={pending} readOnly={readOnly} onCommand={onCommand} placementChoice={placementChoice} onSelectPlacement={setPlacementChoice} onPreview={setPreview} />
        </div>
        <Purse snapshot={snapshot} pending={pending} readOnly={readOnly} onCommand={onCommand} />
      </div>
    </section>
    {reveal && !snapshot.public.standings && <SettlementReveal key={reveal.voyage} entry={reveal} onClose={closeReveal} />}
    {snapshot.public.standings && <GameOverScreen snapshot={snapshot} history={history} onReturnToLobby={() => onReturnToLobby(snapshot.room.revision)} />}
    <TurnBanner turnKey={turnKey} label={yourTurnPrompt(decision?.kind ?? snapshot.public.phase.kind)} />
    {error && <p className="rule-error" role="alert"><span>{errorMessage(error)}</span><button type="button" aria-label="关闭提示" onClick={() => setError(null)}>×</button></p>}
  </main>
}
