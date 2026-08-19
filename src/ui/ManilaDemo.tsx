import { useEffect, useRef, useState } from 'react'
import { createGame, getDecision, getStandings, transition, validateState, type GameAction, type GameConfig, type GameState, type PirateVariant } from '../game'
import { DecisionPanel } from './DecisionPanel'
import { GameBoard } from './GameBoard'
import './manila-demo.css'

const playerColors = ['#c95b45', '#dfb648', '#538c72', '#7260a8', '#4c8bb5']

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnRef = useRef<HTMLElement | null>(null)
  useEffect(() => { returnRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeRef.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }; document.addEventListener('keydown', onKey); return () => { document.removeEventListener('keydown', onKey); returnRef.current?.focus() } }, [onClose])
  return <div className="overlay-scrim"><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="overlay-heading"><h2 id="dialog-title">{title}</h2><button ref={closeRef} type="button" aria-label={`关闭${title}`} onClick={onClose}>×</button></div>{children}</section></div>
}

function NewGame({ onStart }: { onStart: (config: GameConfig) => void }) {
  const [count, setCount] = useState(3)
  const [names, setNames] = useState(['阿青', '阿明', '阿兰', '阿紫', '阿蓝'])
  const [starting, setStarting] = useState('p1')
  const [variant, setVariant] = useState<PirateVariant>('standard')
  const seed = 20260819
  const players = names.slice(0, count).map((name, index) => ({ id: `p${index + 1}`, name: name.trim() || `玩家 ${index + 1}` }))
  return <main className="new-game"><section className="new-game__card"><p className="overlay-kicker">LOCAL HOT-SEAT</p><h1>开始新游戏</h1><label>玩家人数<select aria-label="玩家人数" value={count} onChange={(event) => { const next = Number(event.target.value); setCount(next); if (Number(starting.slice(1)) > next) setStarting('p1') }}>{[3, 4, 5].map((value) => <option key={value} value={value}>{value} 人</option>)}</select></label>{players.map((player, index) => <label key={player.id}>玩家 {index + 1}<input value={names[index]} onChange={(event) => setNames(names.map((name, nameIndex) => nameIndex === index ? event.target.value : name))} /></label>)}<label>首位出价者<select value={starting} onChange={(event) => setStarting(event.target.value)}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label><label>海盗规则<select aria-label="海盗规则" value={variant} onChange={(event) => setVariant(event.target.value as PirateVariant)}><option value="standard">标准海盗</option><option value="strengthened">加强海盗</option></select></label><p>随机 seed：{seed}</p><button className="primary-action" type="button" onClick={() => onStart({ players, startingPlayerId: starting, seed, pirateVariant: variant })}>开始航程</button></section></main>
}

export function ManilaDemo() {
  const [state, setState] = useState<GameState | null>(null)
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null)
  const [showPlayers, setShowPlayers] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<'rules' | 'shares' | null>(null)
  const start = (config: GameConfig) => { const result = createGame(config); if (!result.ok) { setError(result.error.message); return } setState(result.value); setRevealedPlayerId(null); setError(null) }
  if (!state) return <><NewGame onStart={start} />{error && <p role="alert">{error}</p>}</>
  const decision = getDecision(state)
  const activePlayer = decision ? state.players.find((player) => player.id === decision.playerId) : null
  const act = (action: GameAction) => { const result = transition(state, action); if (!result.ok) { setError(result.error.message); return } const violations = validateState(result.value.state); if (violations.length > 0) { setError(`状态校验失败：${violations.map((item) => item.message).join('；')}`); return } const next = result.value.state; const nextDecision = getDecision(next); setState(next); setError(null); if (nextDecision && nextDecision.playerId !== action.playerId) setRevealedPlayerId(null) }
  const visible = revealedPlayerId !== null && (decision?.playerId === revealedPlayerId || decision === null)
  return <main className="demo-shell"><header className="demo-header"><div className="demo-brand"><span className="demo-brand__seal">馬</span><strong>马尼拉</strong></div><div className="voyage-badge"><span>当前航程</span><strong>第 {state.voyage} 航程</strong></div><button className="quiet-action" type="button" onClick={() => setShowPlayers((shown) => !shown)}>{showPlayers ? '隐藏同伙' : '显示同伙'}</button><button className="quiet-action" type="button" onClick={() => setOverlay('rules')}>规则摘要</button></header><ol className="player-strip" aria-label="玩家状态">{state.players.map((player, index) => <li className={player.id === decision?.playerId ? 'player-card is-current' : 'player-card'} key={player.id}><span className="player-card__token" style={{ backgroundColor: playerColors[index] }}>{player.name.slice(-1)}</span><span className="player-card__identity"><strong>{player.name}</strong><small>{player.id === state.harborMasterId ? '港务长' : '商人'}</small></span>{visible && player.id === revealedPlayerId ? <span className="player-card__wealth"><strong>{player.pesos}</strong><small>比索</small></span> : <span className="player-card__wealth"><strong>—</strong><small>私密</small></span>}</li>)}</ol><section className="demo-workspace" aria-label="游戏桌面"><GameBoard state={state} decision={decision} showPlayers={showPlayers} onAction={act} />{visible ? <DecisionPanel state={state} decision={decision} onAction={act} error={error} /> : <aside className="decision-panel" aria-label="等待玩家接手"><h1>请交接设备</h1><p>公开版图保持可见，私人资金、股份与决策将于接手后显示。</p></aside>}</section>{visible && activePlayer && <button className="shares-button" type="button" onClick={() => setOverlay('shares')}>我的股份</button>}{decision === null && <section className="standings"><h2>最终排名</h2>{getStandings(state).map((standing) => <p key={standing.playerId}>{standing.winner ? '★ ' : ''}{standing.name}：{standing.wealth} 比索</p>)}</section>}{!visible && activePlayer && <div className="handoff-stage"><section className="handoff-card" role="dialog" aria-modal="true" aria-labelledby="handoff-title"><h1 id="handoff-title">玩家交接</h1><p>请把设备交给 <strong>{activePlayer.name}</strong></p><button className="primary-action" type="button" onClick={() => setRevealedPlayerId(activePlayer.id)}>确认接手</button></section></div>}{overlay === 'rules' && <Dialog title="规则摘要" onClose={() => setOverlay(null)}><p>每个航程依次进行：竞拍港务长、港务长购股与下水、放置同伙与移动、结算和行情变动。所有可操作项由当前规则状态决定。</p></Dialog>}{overlay === 'shares' && visible && activePlayer && <Dialog title="我的股份" onClose={() => setOverlay(null)}><div className="share-grid">{activePlayer.shares.map((share) => <p key={share.id}>{share.commodity} {share.mortgaged ? '（已抵押）' : `· 当前价值 ${state.market[share.commodity]}`}</p>)}</div></Dialog>}</main>
}
