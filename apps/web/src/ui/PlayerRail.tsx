import type { GameRoomSnapshot } from '@manila/protocol'
import { useAnimatedNumber } from './motion'

function SelfPesos({ pesos }: { pesos: number }) {
  const { shown, delta } = useAnimatedNumber(pesos)
  return <div className="player-card__wealth">
    <small>比索</small>
    <strong>{shown}</strong>
    {delta && <span key={delta.key} className={`float-delta${delta.amount > 0 ? ' is-up' : ' is-down'}`}>{delta.amount > 0 ? `+${delta.amount}` : delta.amount}</span>}
  </div>
}

/** Every seat at a glance: whose turn, the harbour master, the live high bid and crew left in hand. */
export function PlayerRail({ snapshot, presence }: { snapshot: GameRoomSnapshot; presence?: ReadonlySet<number> | undefined }) {
  const view = snapshot.public
  return <ul className="player-strip" aria-label="玩家">
    {view.players.map((player) => {
      const current = player.seat === view.phase.currentSeat && snapshot.room.status === 'playing'
      const self = player.seat === snapshot.self.seat
      const crew = view.accomplices.filter((token) => token.seat === player.seat)
      const bid = view.phase.kind === 'auction' && view.highestBid?.bidderSeat === player.seat ? view.highestBid.amount : null
      const classes = ['player-card', `seat-${player.seat}`, current ? 'is-current' : '', self ? 'is-self' : '', presence && !presence.has(player.seat) ? 'is-away' : ''].filter(Boolean).join(' ')
      return <li key={player.seat} className={classes}>
        <span className="player-card__token" aria-hidden="true">{Array.from(player.nickname.trim())[0]?.toUpperCase() ?? player.seat}</span>
        <div className="player-card__identity">
          <strong>{player.nickname}{self && <em>（你）</em>}</strong>
          <small>
            {player.seat === view.harborMasterSeat && <span className="role-badge">👑 港务长</span>}
            {current && <span className="role-badge role-badge--turn">行动中</span>}
            {bid !== null && <span className="role-badge role-badge--bid">出价 {bid}</span>}
            {player.autopilot && <span className="role-badge role-badge--bot" title={player.autopilot === 'away' ? '离线，机器人托管中' : '机器人托管中'}>🤖 {player.autopilot === 'away' ? '离线托管' : '托管'}</span>}
          </small>
          {crew.length > 0 && <span className="crew-pips" aria-label={`同伙：${crew.filter((token) => token.location === null).length} 名待命，共 ${crew.length} 名`}>
            {crew.map((token) => <i key={token.id} className={token.location === null ? 'is-free' : 'is-placed'} />)}
          </span>}
        </div>
        {self && <SelfPesos pesos={snapshot.self.pesos} />}
      </li>
    })}
  </ul>
}
