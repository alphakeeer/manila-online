import { ApiErrorSchema, GameRoomSnapshotSchema, PROTOCOL_VERSION, type ApiErrorCode, type GameCommandRequest, type GameRoomSnapshot } from '@manila/protocol'
import { useEffect, useRef, useState } from 'react'
import { GameBoard } from './GameBoard'
import { commodityPresentation } from './commodityPresentation'

type ErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'
type PendingCommand = { roomCode: string; request: GameCommandRequest }
const pendingKey = 'manila.pending-command.v1'
const commandId = () => crypto.randomUUID()
const apiError = (value: unknown): ErrorCode => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR' }
const readPending = (): PendingCommand | null => { try { const value: unknown = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'); return typeof value === 'object' && value !== null && 'roomCode' in value && 'request' in value ? value as PendingCommand : null } catch { return null } }
const savePending = (value: PendingCommand) => sessionStorage.setItem(pendingKey, JSON.stringify(value))
const clearPending = () => sessionStorage.removeItem(pendingKey)

function AuctionPanel({ snapshot, pending, readOnly, onCommand }: { snapshot: GameRoomSnapshot; pending: boolean; readOnly: boolean; onCommand: (request: GameCommandRequest) => void }) {
  const decision = snapshot.decision
  const [amount, setAmount] = useState(decision?.kind === 'auction' ? decision.minimumBid : 1)
  const [collateral, setCollateral] = useState<string[]>([])
  useEffect(() => { setAmount(decision?.kind === 'auction' ? decision.minimumBid : 1); setCollateral([]) }, [decision?.kind, decision?.kind === 'auction' ? decision.minimumBid : 0, snapshot.room.revision])
  if (!decision) return <aside className="decision-panel"><p className="decision-panel__eyebrow">等待行动</p><h1>竞拍进行中</h1><p>等待 {snapshot.public.phase.currentSeat} 号位提交操作。</p></aside>
  const disabled = pending || readOnly
  const submit = (action: GameCommandRequest['action']) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: commandId(), expectedRevision: snapshot.room.revision, action })
  return <aside className="decision-panel" aria-label="竞拍操作"><p className="decision-panel__eyebrow">{readOnly ? '连接恢复中' : '你的回合'}</p><h1>竞拍<span>领航员</span></h1><p>最低出价：{decision.minimumBid} 比索。你持有 {snapshot.self.pesos} 比索。</p>
    <label>出价<input type="number" min={decision.minimumBid} max={decision.maximumBid} value={amount} disabled={disabled} onChange={(event) => setAmount(Number(event.target.value))} /></label>
    {decision.availableCollateralShareIds.length > 0 && <fieldset className="collateral"><legend>声明抵押（如需）</legend>{snapshot.self.shares.filter((share) => decision.availableCollateralShareIds.includes(share.id)).map((share) => <label key={share.id}><input type="checkbox" checked={collateral.includes(share.id)} disabled={disabled} onChange={() => setCollateral((current) => current.includes(share.id) ? current.filter((id) => id !== share.id) : [...current, share.id])} />{commodityPresentation(share.commodity).label}</label>)}</fieldset>}
    <button className="primary-action" type="button" disabled={disabled || !Number.isInteger(amount) || amount < decision.minimumBid || amount > decision.maximumBid} onClick={() => submit({ type: 'bid', amount, mortgageShareIds: collateral })}>确认出价</button><button className="quiet-action" type="button" disabled={disabled} onClick={() => submit({ type: 'passAuction' })}>放弃本轮竞拍</button>
  </aside>
}

export function GameRoom({ roomCode, initialSnapshot, onSessionExpired, onLogout }: { roomCode: string; initialSnapshot: GameRoomSnapshot | null; onSessionExpired: () => void; onLogout: () => void }) {
  const [snapshot, setSnapshot] = useState<GameRoomSnapshot | null>(initialSnapshot)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const [connected, setConnected] = useState(false)
  const revision = useRef(initialSnapshot?.room.revision ?? -1)
  const socket = useRef<WebSocket | null>(null)
  const retryTimer = useRef<number | null>(null)
  const attempt = useRef(0)
  const update = (next: GameRoomSnapshot) => { if (next.room.revision >= revision.current) { revision.current = next.room.revision; setSnapshot(next) } }
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

  if (!snapshot) return <main className="session-lobby"><p>正在同步房间…</p>{error && <p role="alert">{error}</p>}</main>
  return <main className="game-shell"><header className="game-header"><div className="game-brand"><span className="game-brand__seal">M</span><div><p>在线牌局</p><strong>MANILA</strong></div></div><div className="voyage-badge"><span>房间</span><strong>{snapshot.room.code}</strong></div><button className="quiet-action" type="button" onClick={onLogout}>退出</button></header><ul className="player-strip">{snapshot.public.players.map((player) => <li key={player.seat} className={`player-card${player.seat === snapshot.public.phase.currentSeat ? ' is-current' : ''}`}><span className="player-card__token">{player.seat}</span><div className="player-card__identity"><strong>{player.nickname}</strong><small>{player.seat === snapshot.public.harborMasterSeat ? '港务长' : '玩家'}</small></div>{player.seat === snapshot.self.seat && <div className="player-card__wealth"><small>比索</small><strong>{snapshot.self.pesos}</strong></div>}</li>)}</ul><section className="game-workspace"><GameBoard snapshot={snapshot} /><AuctionPanel snapshot={snapshot} pending={pending} readOnly={!connected} onCommand={(request) => void sendCommand(request)} /></section>{error && <p className="rule-error" role="alert">{error}</p>}</main>
}
