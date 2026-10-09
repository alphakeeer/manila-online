import {
  ApiErrorSchema,
  LobbySnapshotSchema,
  GameRoomSnapshotSchema,
  SessionResponseSchema,
  type ApiErrorCode,
  type LobbySnapshot,
  type GameRoomSnapshot,
  type PirateVariant,
  type SessionView,
} from '@manila/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Dialog } from './Dialog'
import { errorMessage } from './errorMessages'
import { GameRoom } from './GameRoom'
import { InviteCard, consumeInviteCode, rememberNickname, rememberedNickname } from './Invite'

type Status =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; session: SessionView }

type ErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'

function errorCode(response: unknown): ErrorCode {
  const parsed = ApiErrorSchema.safeParse(response)
  return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR'
}

function commandId() {
  return crypto.randomUUID()
}

export function SessionLobby() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null)
  const [gameSnapshot, setGameSnapshot] = useState<GameRoomSnapshot | null>(null)
  const [invite] = useState(consumeInviteCode)
  const [token, setToken] = useState('')
  const [nickname, setNickname] = useState(rememberedNickname)
  const [roomCode, setRoomCode] = useState(invite ?? '')
  const [pirateVariant, setPirateVariant] = useState<PirateVariant>('standard')
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const autoJoined = useRef(false)
  const pastedToken = useRef(false)

  async function refreshLobby() {
    const response = await fetch('/api/lobby', { credentials: 'same-origin' })
    const body: unknown = await response.json()
    const parsed = LobbySnapshotSchema.safeParse(body)
    if (!response.ok || !parsed.success) throw new Error(errorCode(body))
    setSnapshot(parsed.data)
  }

  useEffect(() => {
    let active = true
    void fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        const parsed = SessionResponseSchema.safeParse(await response.json())
        if (!active) return
        setStatus(parsed.success ? { kind: 'signedIn', session: parsed.data.session } : { kind: 'signedOut' })
      })
      .catch(() => active && setStatus({ kind: 'signedOut' }))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (status.kind !== 'signedIn') return
    let active = true
    const update = () => {
      void refreshLobby().catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message as ErrorCode : 'UNKNOWN_ERROR'))
    }
    update()
    const interval = window.setInterval(update, 2_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [status.kind])

  async function login(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/session', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
      })
      const body: unknown = await response.json()
      const parsed = SessionResponseSchema.safeParse(body)
      if (!response.ok || !parsed.success) {
        setError(errorCode(body))
        return
      }
      setToken('')
      setStatus({ kind: 'signedIn', session: parsed.data.session })
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: object) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(url, {
        method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const responseBody: unknown = await response.json()
      const parsed = LobbySnapshotSchema.safeParse(responseBody)
      if (!response.ok || !parsed.success) {
        setError(errorCode(responseBody))
        return
      }
      setSnapshot(parsed.data)
      if (url === '/api/rooms' || url === '/api/rooms/join') rememberNickname(nickname)
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  // Pasting a complete token (the usual way on phones) signs in without another tap.
  useEffect(() => {
    if (!pastedToken.current) return
    pastedToken.current = false
    if (status.kind === 'signedOut' && !pending && /^[23456789A-HJ-NP-Z]{8}$/.test(token.trim().toUpperCase())) void login()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Invite links (?join=CODE) join straight away when we already know the player's nickname.
  useEffect(() => {
    if (status.kind !== 'signedIn' || !snapshot || snapshot.room || !invite || !nickname.trim() || autoJoined.current) return
    autoJoined.current = true
    void send('/api/rooms/join', 'POST', { commandId: commandId(), roomCode: invite, nickname })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind, snapshot, invite])

  async function logout(confirmPlaying = false) {
    if (confirmPlaying) {
      setConfirmLogout(true)
      return
    }
    await performLogout()
  }

  async function performLogout() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' })
      if (!response.ok && response.status !== 401) {
        setError(errorCode(await response.json()))
        return
      }
      setSnapshot(null)
      setGameSnapshot(null)
      setStatus({ kind: 'signedOut' })
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  async function startGame() {
    if (!snapshot?.room) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/rooms/${snapshot.room.code}/start`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1, commandId: commandId(), expectedRevision: snapshot.room.revision }) })
      const body: unknown = await response.json()
      const parsed = GameRoomSnapshotSchema.safeParse(body)
      if (!response.ok || !parsed.success) { setError(errorCode(body)); return }
      setGameSnapshot(parsed.data)
      void refreshLobby()
    } catch { setError('UNKNOWN_ERROR') } finally { setPending(false) }
  }

  if (status.kind === 'loading') return <main className="session-lobby"><div className="lobby-card lobby-card--center"><span className="loader-wheel" aria-hidden="true" /><p>正在确认会话…</p></div></main>

  if (status.kind === 'signedOut') {
    return (
      <main className="session-lobby session-lobby--hero">
        <div className="sea-waves" aria-hidden="true"><i /><i /><i /></div>
        <div className="lobby-card lobby-card--hero">
          <span className="hero-seal" aria-hidden="true">M</span>
          <h1 className="hero-title">Manila<small>马尼拉</small></h1>
          <p className="hero-tagline">1821 年，走私舢板正驶向马尼拉黑市。<br />竞拍港务长、押注货物、收买海盗——和朋友一起出海。</p>
          {invite && <p className="invite-hint">🎟️ 朋友邀请你加入房间 <strong>{invite}</strong>，输入 Token 即可上船</p>}
          <form className="token-form" onSubmit={(event) => void login(event)}>
            <label htmlFor="access-token">访问 Token</label>
            <input id="access-token" name="token" className="token-input" value={token} onChange={(event) => setToken(event.target.value.toUpperCase())} onPaste={() => { pastedToken.current = true }} maxLength={12} placeholder="8 位字符" autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={pending} />
            <button type="submit" className="primary-action" disabled={pending}>{pending ? '正在进入…' : '进入大厅'}</button>
          </form>
          {error && <p role="alert" className="form-error">{errorMessage(error)}</p>}
        </div>
      </main>
    )
  }

  const logoutDialog = <Dialog title="确认退出游戏" onClose={() => setConfirmLogout(false)}>
    <p>退出后你的座位会立刻交给机器人稳健托管，牌局不会卡住。</p>
    <p>想回来时，重新输入 Token，在“加入朋友”里填原房间码和原昵称，就能接回座位。</p>
    <div className="dialog-actions">
      <button type="button" className="primary-action" disabled={pending} onClick={() => { setConfirmLogout(false); void performLogout() }}>确认退出</button>
      <button type="button" className="quiet-action" disabled={pending} onClick={() => setConfirmLogout(false)}>取消</button>
    </div>
  </Dialog>
  const room = snapshot?.room
  if (room?.status === 'playing' || room?.status === 'finished' || room?.status === 'closed') {
    return <>
      <GameRoom roomCode={room.code} initialSnapshot={gameSnapshot} onSessionExpired={() => { setGameSnapshot(null); setSnapshot(null); setStatus({ kind: 'signedOut' }) }} onLogout={() => void logout(true)}
        onReturnToLobby={(revision) => { setGameSnapshot(null); void send(`/api/rooms/${room.code}/members/me`, 'DELETE', { commandId: commandId(), expectedRevision: revision }) }} />
      {confirmLogout && logoutDialog}
    </>
  }
  const seats = [1, 2, 3, 4, 5]
  const readyCount = room?.members.filter((member) => member.ready).length ?? 0
  return (
    <main className="session-lobby">
      <div className="sea-waves" aria-hidden="true"><i /><i /><i /></div>
      <div className="lobby-card">
        <header className="lobby-header">
          <span className="hero-seal hero-seal--small" aria-hidden="true">M</span>
          <div><p className="lobby-header__title">Manila</p><p className="session-expiry">会话有效至 {new Date(status.session.expiresAt).toLocaleString()}</p></div>
        </header>
        {!snapshot ? <p className="lobby-loading"><span className="loader-wheel" aria-hidden="true" />正在读取大厅…</p> : room ? (
          <section className="room-view" aria-label="当前房间">
            <div className="room-view__code">
              <h2>房间 {room.code}</h2>

            </div>
            <InviteCard code={room.code} />
            <p className="room-view__meta">{room.pirateVariant === 'standard' ? '标准海盗' : '加强海盗'} · {room.members.length} / 5 人 · {readyCount} 人已准备 · 版本 {room.revision}</p>
            <ul className="seat-ring">
              {seats.map((seat) => {
                const member = room.members.find((candidate) => candidate.seat === seat)
                return <li key={seat} className={`seat-slot seat-${seat}${member ? ' is-filled' : ''}${member?.ready ? ' is-ready' : ''}`}>
                  <span className="seat-slot__avatar" aria-hidden="true">{member ? Array.from(member.nickname.trim())[0]?.toUpperCase() ?? seat : '+'}</span>
                  <span className="seat-slot__name">{member ? `${seat} 号位：${member.nickname}` : '空座位'}</span>
                  {member && <small>{member.isHost ? '房主 · ' : ''}{member.ready ? '已准备' : '未准备'}</small>}
                </li>
              })}
            </ul>
            {room.members.length < 3 && <p className="lobby-hint">至少 3 人才能开局，把房间码发给朋友吧。</p>}
            <div className="lobby-actions">
              <button type="button" className={snapshot.viewer.isReady ? 'quiet-action' : 'primary-action'} disabled={pending || !snapshot.viewer.canSetReady} onClick={() => void send(`/api/rooms/${room.code}/ready`, 'POST', { commandId: commandId(), expectedRevision: room.revision, ready: !snapshot.viewer.isReady })}>{snapshot.viewer.isReady ? '取消准备' : '准备'}</button>
              {snapshot.viewer.canEditPirateVariant && <label className="variant-select">海盗规则<select value={room.pirateVariant} disabled={pending} onChange={(event) => void send(`/api/rooms/${room.code}/config`, 'PATCH', { commandId: commandId(), expectedRevision: room.revision, pirateVariant: event.target.value })}><option value="standard">标准</option><option value="strengthened">加强</option></select></label>}
              {snapshot.viewer.canEditPirateVariant && <button type="button" className="primary-action primary-action--gold" disabled={pending || room.members.length < 3 || room.members.some((member) => !member.ready)} onClick={() => void startGame()}>开始竞拍</button>}
              <button type="button" className="quiet-action" disabled={pending} onClick={() => void send(`/api/rooms/${room.code}/members/me`, 'DELETE', { commandId: commandId(), expectedRevision: room.revision })}>离开房间</button>
            </div>
          </section>
        ) : (
          <section className="room-entry" aria-label="创建或加入房间">
            <h2>创建或加入房间</h2>
            <label className="field">昵称<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} placeholder="朋友们看到的名字" disabled={pending} /></label>
            <div className="room-entry__split">
              <form className="entry-panel" onSubmit={(event) => { event.preventDefault(); void send('/api/rooms', 'POST', { commandId: commandId(), nickname, pirateVariant }) }}>
                <h3>开新桌</h3>
                <div className="segmented" role="radiogroup" aria-label="海盗规则">
                  {(['standard', 'strengthened'] as const).map((variant) => <label key={variant} className={pirateVariant === variant ? 'is-on' : undefined}><input type="radio" name="pirate-variant" value={variant} checked={pirateVariant === variant} onChange={() => setPirateVariant(variant)} disabled={pending} />{variant === 'standard' ? '标准海盗' : '加强海盗'}</label>)}
                </div>
                <button type="submit" className="primary-action" disabled={pending}>创建房间</button>
              </form>
              <form className="entry-panel" onSubmit={(event) => { event.preventDefault(); void send('/api/rooms/join', 'POST', { commandId: commandId(), roomCode, nickname }) }}>
                <h3>加入朋友</h3>
                <small className="entry-panel__hint">牌局中途离开过？填原房间码和原昵称即可接回座位。</small>
                <label className="field">房间码<input className="code-input" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={12} placeholder="8 位房间码" autoCapitalize="characters" spellCheck={false} disabled={pending} /></label>
                <button type="submit" className="primary-action primary-action--sea" disabled={pending}>加入房间</button>
              </form>
            </div>
          </section>
        )}
        {error && <p role="alert" className="form-error">{errorMessage(error)}</p>}
        <button type="button" className="text-action" onClick={() => void logout()} disabled={pending}>退出</button>
      </div>
      {confirmLogout && logoutDialog}
    </main>
  )
}
