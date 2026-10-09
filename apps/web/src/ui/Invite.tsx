import { useEffect, useState } from 'react'

export const inviteParam = 'join'
const codePattern = /^[23456789A-HJ-NP-Z]{8}$/

export function inviteLink(code: string) {
  return `${window.location.origin}/?${inviteParam}=${code}`
}

/** Reads `?join=CODE` once and strips it from the address bar so a refresh does not re-trigger it. */
export function consumeInviteCode(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const raw = url.searchParams.get(inviteParam)
  if (raw === null) return null
  url.searchParams.delete(inviteParam)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  const code = raw.trim().toUpperCase()
  return codePattern.test(code) ? code : null
}

const nicknameKey = 'manila.nickname.v1'
export function rememberedNickname() {
  try { return localStorage.getItem(nicknameKey) ?? '' } catch { return '' }
}
export function rememberNickname(value: string) {
  try { if (value.trim()) localStorage.setItem(nicknameKey, value.trim()) } catch { /* convenience only */ }
}

/** Invite friends: copy or share a link that pre-fills the room, or scan a QR code from a phone. */
export function InviteCard({ code }: { code: string }) {
  const link = inviteLink(code)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (!showQr || qr) return
    let live = true
    // Loaded on demand so the QR encoder never weighs on the first paint.
    void import('uqr').then(({ renderSVG }) => { if (live) setQr(renderSVG(link, { border: 2, whiteColor: '#fffaf0', blackColor: '#2b1d10' })) })
    return () => { live = false }
  }, [showQr, qr, link])

  const copy = (text: string, what: 'link' | 'code') => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(what); window.setTimeout(() => setCopied(null), 1600) }, () => undefined)
  }

  return <section className="invite-card" aria-label="邀请朋友">
    <div className="invite-card__actions">
      <button type="button" className="mini-action" onClick={() => copy(link, 'link')}>{copied === 'link' ? '链接已复制 ✓' : '复制邀请链接'}</button>
      <button type="button" className="mini-action" onClick={() => copy(code, 'code')}>{copied === 'code' ? '已复制 ✓' : '复制房间码'}</button>
      {canShare && <button type="button" className="mini-action" onClick={() => void navigator.share({ title: 'Manila 马尼拉', text: `来马尼拉开船！房间 ${code}`, url: link }).catch(() => undefined)}>分享…</button>}
      <button type="button" className="mini-action" aria-expanded={showQr} onClick={() => setShowQr((value) => !value)}>{showQr ? '收起二维码' : '二维码'}</button>
    </div>
    {showQr && <div className="invite-card__qr">
      {qr ? <span role="img" aria-label={`邀请二维码：${link}`} dangerouslySetInnerHTML={{ __html: qr }} /> : <span className="loader-wheel" aria-hidden="true" />}
      <small>手机扫码打开，输入 Token 后会自动带上房间码</small>
    </div>}
  </section>
}
