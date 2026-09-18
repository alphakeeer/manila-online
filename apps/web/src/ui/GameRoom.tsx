import { ApiErrorSchema, GameRoomSnapshotSchema, PROTOCOL_VERSION, type ApiErrorCode, type GameCommandRequest, type GameRoomSnapshot } from '@manila/protocol'
import { useEffect, useRef, useState } from 'react'
import { GameBoard } from './GameBoard'
import { commodityPresentation } from './commodityPresentation'

type ErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'
const commandId = () => crypto.randomUUID()
const apiError = (value: unknown): ErrorCode => { const parsed = ApiErrorSchema.safeParse(value); return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR' }

function AuctionPanel({ snapshot, pending, onCommand }: { snapshot: GameRoomSnapshot; pending: boolean; onCommand: (request: GameCommandRequest) => void }) {
  const decision = snapshot.decision
  const [amount, setAmount] = useState(decision?.kind === 'auction' ? decision.minimumBid : 1)
  const [collateral, setCollateral] = useState<string[]>([])
  useEffect(() => { setAmount(decision?.kind === 'auction' ? decision.minimumBid : 1); setCollateral([]) }, [decision?.kind, decision?.kind === 'auction' ? decision.minimumBid : 0, snapshot.room.revision])
  if (!decision) return <aside className="decision-panel"><p className="decision-panel__eyebrow">等待行动</p><h1>竞拍进行中</h1><p>等待 {snapshot.public.phase.currentSeat} 号位提交操作。</p></aside>
  const submit = (action: GameCommandRequest['action']) => onCommand({ protocolVersion: PROTOCOL_VERSION, commandId: commandId(), expectedRevision: snapshot.room.revision, action })
  return <aside className="decision-panel" aria-label="竞拍操作">
    <p className="decision-panel__eyebrow">你的回合</p><h1>竞拍<span>领航员</span></h1><p>最低出价：{decision.minimumBid} 比索。你持有 {snapshot.self.pesos} 比索。</p>
    <label>出价<input type="number" min={decision.minimumBid} max={decision.maximumBid} value={amount} disabled={pending} onChange={(event) => setAmount(Number(event.target.value))} /></label>
    {decision.availableCollateralShareIds.length > 0 && <fieldset className="collateral"><legend>声明抵押（如需）</legend>{snapshot.self.shares.filter((share) => decision.availableCollateralShareIds.includes(share.id)).map((share) => <label key={share.id}><input type="checkbox" checked={collateral.includes(share.id)} disabled={pending} onChange={() => setCollateral((current) => current.includes(share.id) ? current.filter((id) => id !== share.id) : [...current, share.id])} />{commodityPresentation(share.commodity).label}</label>)}</fieldset>}
    <button className="primary-action" type="button" disabled={pending || !Number.isInteger(amount) || amount < decision.minimumBid || amount > decision.maximumBid} onClick={() => submit({ type: 'bid', amount, mortgageShareIds: collateral })}>确认出价</button>
    <button className="quiet-action" type="button" disabled={pending} onClick={() => submit({ type: 'passAuction' })}>放弃本轮竞拍</button>
  </aside>
}

export function GameRoom({ roomCode, initialSnapshot, onSessionExpired, onLogout }: { roomCode: string; initialSnapshot: GameRoomSnapshot | null; onSessionExpired: () => void; onLogout: () => void }) {
  const [snapshot, setSnapshot] = useState<GameRoomSnapshot | null>(initialSnapshot)
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const revision = useRef(initialSnapshot?.room.revision ?? -1)
  const update = (next: GameRoomSnapshot) => { if (next.room.revision >= revision.current) { revision.current = next.room.revision; setSnapshot(next) } }
  useEffect(() => {
    let live = true
    void fetch(`/api/rooms/${roomCode}/snapshot`, { credentials: 'same-origin' }).then(async (response) => { const body: unknown = await response.json(); const parsed = GameRoomSnapshotSchema.safeParse(body); if (!live) return; if (parsed.success && response.ok) update(parsed.data); else if (apiError(body) === 'AUTH_REQUIRED' || apiError(body) === 'TOKEN_REVOKED') onSessionExpired(); else setError(apiError(body)) }).catch(() => live && setError('UNKNOWN_ERROR'))
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rooms/${roomCode}/subscribe`)
    socket.onmessage = (event) => { try { const message = JSON.parse(String(event.data)) as { type?: string; snapshot?: unknown }; if (message.type === 'room.snapshot') { const parsed = GameRoomSnapshotSchema.safeParse(message.snapshot); if (parsed.success) update(parsed.data) }; if (message.type === 'session.expired') onSessionExpired() } catch { setError('UNKNOWN_ERROR') } }
    return () => { live = false; socket.close() }
  }, [roomCode])
  async function submit(request: GameCommandRequest) {
    setPending(true); setError(null)
    try { const response = await fetch(`/api/rooms/${roomCode}/commands`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }); const body: unknown = await response.json(); const parsed = GameRoomSnapshotSchema.safeParse(body); if (response.ok && parsed.success) update(parsed.data); else setError(apiError(body)) } catch { setError('UNKNOWN_ERROR') } finally { setPending(false) }
  }
  if (!snapshot) return <main className="session-lobby"><p>正在同步房间…</p>{error && <p role="alert">{error}</p>}</main>
  return <main className="game-shell"><header className="game-header"><div className="game-brand"><span className="game-brand__seal">M</span><div><p>在线牌局</p><strong>MANILA</strong></div></div><div className="voyage-badge"><span>房间</span><strong>{snapshot.room.code}</strong></div><button className="quiet-action" type="button" onClick={onLogout}>退出</button></header><ul className="player-strip">{snapshot.public.players.map((player) => <li key={player.seat} className={`player-card${player.seat === snapshot.public.phase.currentSeat ? ' is-current' : ''}`}><span className="player-card__token">{player.seat}</span><div className="player-card__identity"><strong>{player.nickname}</strong><small>{player.seat === snapshot.public.harborMasterSeat ? '港务长' : '玩家'}</small></div>{player.seat === snapshot.self.seat && <div className="player-card__wealth"><small>比索</small><strong>{snapshot.self.pesos}</strong></div>}</li>)}</ul><section className="game-workspace"><GameBoard snapshot={snapshot} /><AuctionPanel snapshot={snapshot} pending={pending} onCommand={submit} /></section>{error && <p className="rule-error" role="alert">{error}</p>}</main>
}
