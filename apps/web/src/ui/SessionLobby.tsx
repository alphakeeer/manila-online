import { ApiErrorSchema, SessionResponseSchema, type ApiErrorCode, type SessionView } from '@manila/protocol'
import { type FormEvent, useEffect, useState } from 'react'

type Status =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; session: SessionView }

function errorCode(response: unknown): ApiErrorCode | 'UNKNOWN_ERROR' {
  const parsed = ApiErrorSchema.safeParse(response)
  return parsed.success ? parsed.data.code : 'UNKNOWN_ERROR'
}

async function apiError(response: Response) {
  try {
    return errorCode(await response.json())
  } catch {
    return 'UNKNOWN_ERROR' as const
  }
}

export function SessionLobby() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [token, setToken] = useState('')
  const [error, setError] = useState<ApiErrorCode | 'UNKNOWN_ERROR' | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    void fetch('/api/session', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!active) return
        const parsed = SessionResponseSchema.safeParse(await response.json())
        setStatus(parsed.success ? { kind: 'signedIn', session: parsed.data.session } : { kind: 'signedOut' })
      })
      .catch(() => active && setStatus({ kind: 'signedOut' }))
    return () => {
      active = false
    }
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
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

  async function logout() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!response.ok && response.status !== 401) {
        setError(await apiError(response))
        return
      }
      setStatus({ kind: 'signedOut' })
    } catch {
      setError('UNKNOWN_ERROR')
    } finally {
      setPending(false)
    }
  }

  if (status.kind === 'loading') {
    return <main className="session-lobby"><p>正在确认会话…</p></main>
  }

  if (status.kind === 'signedIn') {
    return (
      <main className="session-lobby">
        <h1>Manila</h1>
        <p>已进入私人大厅。</p>
        <p>大厅将在下一切片开放。</p>
        <p className="session-expiry">会话有效至 {new Date(status.session.expiresAt).toLocaleString()}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={() => void logout()} disabled={pending}>退出</button>
      </main>
    )
  }

  return (
    <main className="session-lobby">
      <h1>Manila</h1>
      <p>请输入朋友提供的 8 位访问 Token。</p>
      <form onSubmit={(event) => void login(event)}>
        <label htmlFor="access-token">访问 Token</label>
        <input
          id="access-token"
          name="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={pending}
        />
        <button type="submit" disabled={pending}>{pending ? '正在进入…' : '进入大厅'}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
