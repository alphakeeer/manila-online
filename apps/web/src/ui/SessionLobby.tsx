import {
  ApiErrorSchema,
  LobbySnapshotSchema,
  SessionResponseSchema,
  type ApiErrorCode,
  type LobbySnapshot,
  type PirateVariant,
  type SessionView,
} from '@manila/protocol'
import { type FormEvent, useEffect, useState } from 'react'

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
  const [token, setToken] = useState('')
  const [nickname, setNickname] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [pirateVariant, setPirateVariant] = useState<PirateVariant>('standard')
  const [error, setError] = useState<ErrorCode | null>(null)
  const [pending, setPending] = useState(false)

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
    const interval = window.setInterval(update, 3_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [status.kind])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' })
      if (!response.ok && response.status !== 401) {
        setError(errorCode(await response.json()))
        return
      }
      setSnapshot(null)
      setStatus({ kind: 'signedOut' })
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  if (status.kind === 'loading') return <main className="session-lobby"><p>正在确认会话…</p></main>

  if (status.kind === 'signedOut') {
    return (
      <main className="session-lobby">
        <h1>Manila</h1><p>请输入朋友提供的 8 位访问 Token。</p>
        <form onSubmit={(event) => void login(event)}>
          <label htmlFor="access-token">访问 Token</label>
          <input id="access-token" name="token" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={pending} />
          <button type="submit" disabled={pending}>{pending ? '正在进入…' : '进入大厅'}</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    )
  }

  const room = snapshot?.room
  return (
    <main className="session-lobby">
      <h1>Manila</h1>
      <p className="session-expiry">会话有效至 {new Date(status.session.expiresAt).toLocaleString()}</p>
      {!snapshot ? <p>正在读取大厅…</p> : room ? (
        <section aria-label="当前房间">
          <h2>房间 {room.code}</h2><p>版本 {room.revision} · {room.pirateVariant === 'standard' ? '标准海盗' : '加强海盗'}</p>
          <ul>{room.members.map((member) => <li key={member.seat}>{member.seat} 号位：{member.nickname} {member.isHost ? '（房主）' : ''} · {member.ready ? '已准备' : '未准备'}</li>)}</ul>
          <button type="button" disabled={pending || !snapshot.viewer.canSetReady} onClick={() => void send(`/api/rooms/${room.code}/ready`, 'POST', { commandId: commandId(), expectedRevision: room.revision, ready: !snapshot.viewer.isReady })}>{snapshot.viewer.isReady ? '取消准备' : '准备'}</button>
          {snapshot.viewer.canEditPirateVariant && <label>海盗规则<select value={room.pirateVariant} disabled={pending} onChange={(event) => void send(`/api/rooms/${room.code}/config`, 'PATCH', { commandId: commandId(), expectedRevision: room.revision, pirateVariant: event.target.value })}><option value="standard">标准</option><option value="strengthened">加强</option></select></label>}
          <button type="button" disabled={pending} onClick={() => void send(`/api/rooms/${room.code}/members/me`, 'DELETE', { commandId: commandId(), expectedRevision: room.revision })}>离开房间</button>
        </section>
      ) : (
        <section aria-label="创建或加入房间">
          <h2>创建或加入房间</h2>
          <form onSubmit={(event) => { event.preventDefault(); void send('/api/rooms', 'POST', { commandId: commandId(), nickname, pirateVariant }) }}>
            <label>昵称<input value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={pending} /></label>
            <label>海盗规则<select value={pirateVariant} onChange={(event) => setPirateVariant(event.target.value as PirateVariant)} disabled={pending}><option value="standard">标准</option><option value="strengthened">加强</option></select></label>
            <button type="submit" disabled={pending}>创建房间</button>
          </form>
          <form onSubmit={(event) => { event.preventDefault(); void send('/api/rooms/join', 'POST', { commandId: commandId(), roomCode, nickname }) }}>
            <label>房间码<input value={roomCode} onChange={(event) => setRoomCode(event.target.value)} autoCapitalize="characters" disabled={pending} /></label>
            <button type="submit" disabled={pending}>加入房间</button>
          </form>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => void logout()} disabled={pending}>退出</button>
    </main>
  )
}
