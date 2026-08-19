import { useState } from 'react'
import type { Commodity, Decision, GameAction, GameState, PilotMove } from '../game'
import { commodityPresentation } from './commodityPresentation'

const commodityName = { nutmeg: '肉豆蔻', silk: '丝绸', jade: '玉石', ginseng: '人参' } as const

function CommodityLabel({ commodity }: { commodity: Commodity }) {
  const presentation = commodityPresentation(commodity)
  return <span className={`commodity-label ${presentation.className}`}>{presentation.label}</span>
}

function Collateral({ ids, selected, onChange }: { ids: string[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (ids.length === 0) return null
  return <fieldset className="collateral"><legend>需要时抵押我的股份</legend>{ids.map((id) => <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={() => onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id])} />{id}</label>)}</fieldset>
}

export function DecisionPanel({ state, decision, onAction, error }: { state: GameState; decision: Decision | null; onAction: (action: GameAction) => void; error: string | null }) {
  const [bid, setBid] = useState(1)
  const [collateral, setCollateral] = useState<string[]>([])
  const [cargo, setCargo] = useState<string[]>([])
  const [triple, setTriple] = useState(0)
  const [placementStowaway, setPlacementStowaway] = useState(false)
  if (!decision) return <aside className="decision-panel" aria-label="游戏结果"><h1>游戏结束</h1><p>黑市行情已达到终局条件。</p></aside>
  const player = state.players.find((candidate) => candidate.id === decision.playerId)
  const heading: Record<Decision['kind'], string> = { auction: '竞拍港务长', sharePurchase: '购买股份', cargoSelection: '选择货物', launch: '舢板下水', placement: '放置同伙', movementOrder: '决定移动顺序', smallPilot: '小领航员行动', largePilot: '大领航员行动', pirateBoarding: '海盗登船', plunderDestination: '决定掠夺去向' }
  const toggleCargo = (value: string) => setCargo(cargo.includes(value) ? cargo.filter((item) => item !== value) : [...cargo, value])
  const boatLabel = (boatId: string) => state.boats.find((boat) => boat.id === boatId)?.commodity ? `${commodityName[state.boats.find((boat) => boat.id === boatId)!.commodity!]}舢板` : boatId
  const BoatLabel = ({ boatId }: { boatId: string }) => {
    const commodity = state.boats.find((boat) => boat.id === boatId)?.commodity
    return commodity ? <><CommodityLabel commodity={commodity} />舢板</> : <span>{boatId}</span>
  }

  return <aside className="decision-panel" aria-label="当前决策">
    <div className="decision-panel__eyebrow">轮到你行动</div>
    <h1><span>{player?.name}</span>，{heading[decision.kind]}</h1>
    {decision.kind === 'auction' && <>
      <p>最低出价 {decision.minimumBid} 比索；当前可支付上限 {decision.maximumBid} 比索。</p>
      <label>出价<input aria-label="出价" type="number" min={decision.minimumBid} max={decision.maximumBid} value={bid} onChange={(event) => setBid(Number(event.target.value))} /></label>
      <Collateral ids={decision.availableCollateralShareIds} selected={collateral} onChange={setCollateral} />
      <button className="primary-action" type="button" onClick={() => onAction({ type: 'bid', playerId: decision.playerId, amount: bid, mortgageShareIds: collateral })}>确认出价</button>
      <button className="quiet-action" type="button" onClick={() => onAction({ type: 'passAuction', playerId: decision.playerId })}>放弃竞拍</button>
    </>}
    {decision.kind === 'sharePurchase' && <><p>港务长可购买一张股份，或跳过。</p><div className="option-list">{decision.available.map((share) => <button key={share.shareId} type="button" onClick={() => onAction({ type: 'buyShare', playerId: decision.playerId, shareId: share.shareId, mortgageShareIds: collateral })}><CommodityLabel commodity={share.commodity} />股份 · {share.price} 比索</button>)}</div><Collateral ids={decision.availableCollateralShareIds} selected={collateral} onChange={setCollateral} /><button className="quiet-action" type="button" onClick={() => onAction({ type: 'buyShare', playerId: decision.playerId, shareId: null, mortgageShareIds: [] })}>跳过购股</button></>}
    {decision.kind === 'cargoSelection' && <><p>点击三种要装载的货物，再确认。</p><div className="option-list">{decision.commodities.map((item) => <button className={cargo.includes(item) ? 'is-selected' : ''} aria-pressed={cargo.includes(item)} key={item} type="button" onClick={() => toggleCargo(item)}><CommodityLabel commodity={item} /></button>)}</div><button className="primary-action" type="button" onClick={() => onAction({ type: 'selectCargo', playerId: decision.playerId, commodities: cargo as typeof decision.commodities[number][] })}>确认装载</button></>}
    {decision.kind === 'launch' && <><p>为三艘舢板选择货物、航线和引擎给出的起始格组合。</p><label>起始格组合<select aria-label="起始格组合" value={triple} onChange={(event) => setTriple(Number(event.target.value))}>{decision.startPositionTriples.map((values, index) => <option key={values.join('-')} value={index}>{values.join(' / ')}</option>)}</select></label><button className="primary-action" type="button" onClick={() => { const starts = decision.startPositionTriples[triple] ?? decision.startPositionTriples[0]!; onAction({ type: 'launchBoats', playerId: decision.playerId, assignments: decision.boatIds.map((boatId, index) => ({ boatId, commodity: decision.commodities[index]!, lane: decision.lanes[index]!, startPosition: starts[index] ?? 0 })) }) }}>舢板下水</button></>}
    {decision.kind === 'placement' && <><p>选择引擎列出的空位；费用由规则引擎结算。</p><Collateral ids={decision.availableCollateralShareIds} selected={collateral} onChange={setCollateral} />{decision.canStowaway && <label><input type="checkbox" checked={placementStowaway} onChange={(event) => setPlacementStowaway(event.target.checked)} />作为偷渡客</label>}<div className="placement-groups">{[
      { title: '货物位', options: decision.options.filter((option) => option.location.area === 'cargo') },
      { title: '港口与修船厂', options: decision.options.filter((option) => option.location.area === 'port' || option.location.area === 'shipyard').sort((left, right) => `${left.location.area}-${left.location.area === 'port' || left.location.area === 'shipyard' ? left.location.berth : ''}`.localeCompare(`${right.location.area}-${right.location.area === 'port' || right.location.area === 'shipyard' ? right.location.berth : ''}`)) },
      { title: '领航员与海盗', options: decision.options.filter((option) => ['smallPilot', 'largePilot', 'pirateCaptain', 'pirateCrew'].includes(option.location.area)).sort((left, right) => ['smallPilot', 'largePilot', 'pirateCaptain', 'pirateCrew'].indexOf(left.location.area) - ['smallPilot', 'largePilot', 'pirateCaptain', 'pirateCrew'].indexOf(right.location.area)) },
      { title: '其他岗位', options: decision.options.filter((option) => option.location.area === 'insurance') },
    ].filter((group) => group.options.length > 0).map((group) => <section className="placement-group" key={group.title} aria-label={group.title}><h2>{group.title}</h2><div className="option-list">{group.options.map((option) => <button key={JSON.stringify(option.location)} type="button" onClick={() => onAction({ type: 'placeAccomplice', playerId: decision.playerId, location: option.location, mortgageShareIds: collateral, ...(placementStowaway ? { stowaway: true } : {}) })}>{option.location.area === 'cargo' ? <><BoatLabel boatId={option.location.boatId} /> · 货物位 {option.location.slot + 1}</> : option.location.area === 'port' || option.location.area === 'shipyard' ? <><span className={`placement-option__area placement-option__area--${option.location.area}`}>{option.location.area === 'port' ? '港口' : '修船厂'}</span> {option.location.berth}</> : <span className="placement-option__area">{({ smallPilot: '小领航员', largePilot: '大领航员', pirateCaptain: '海盗船长', pirateCrew: '海盗船员', insurance: '保险事务所' } as const)[option.location.area]}</span>} <span className="placement-option__cost">· {option.cost} 比索</span></button>)}</div></section>)}</div><button className="quiet-action" type="button" onClick={() => onAction({ type: 'passPlacement', playerId: decision.playerId })}>放弃本航程放置</button></>}
    {decision.kind === 'movementOrder' && <><p>骰子：{Object.entries(decision.dice).filter(([, value]) => value > 0).map(([name, value]) => `${commodityName[name as keyof typeof commodityName]} ${value}`).join('，')}</p><div className="option-list">{decision.remainingBoatIds.map((boatId) => <button key={boatId} type="button" onClick={() => onAction({ type: 'moveBoat', playerId: decision.playerId, boatId })}>移动 {boatLabel(boatId)}</button>)}</div></>}
    {(decision.kind === 'smallPilot' || decision.kind === 'largePilot') && <><p>仅显示规则引擎允许的移动组合。</p><div className="option-list">{decision.legalMoves.map((moves, index) => <button key={`${index}-${JSON.stringify(moves)}`} type="button" onClick={() => onAction({ type: 'pilotMove', playerId: decision.playerId, moves: moves as PilotMove[] })}>{moves.length === 0 ? '不移动舢板' : moves.map((move) => `${boatLabel(move.boatId)} ${move.delta > 0 ? '+' : ''}${move.delta}`).join('，')}</button>)}</div></>}
    {decision.kind === 'pirateBoarding' && <><p>选择要登上的舢板，或留在海盗船。</p><div className="option-list">{decision.eligibleBoatIds.flatMap((boatId) => { const displaced = decision.displaceableByBoat[boatId] ?? []; return displaced.length === 0 ? [<button key={boatId} type="button" onClick={() => onAction({ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId })}>登上 {boatLabel(boatId)}</button>] : displaced.map((accompliceId) => <button key={`${boatId}-${accompliceId}`} type="button" onClick={() => onAction({ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId, displacedAccompliceId: accompliceId })}>登上 {boatLabel(boatId)}，挤掉 {accompliceId}</button>) })}</div><button className="quiet-action" type="button" onClick={() => onAction({ type: 'boardPirate', playerId: decision.playerId, accompliceId: decision.accompliceId, boatId: null })}>留在海盗船</button></>}
    {decision.kind === 'plunderDestination' && <><p>为被劫掠的 {boatLabel(decision.boatId)} 选择去向。</p><div className="option-list">{decision.destinations.map((destination) => <button key={destination} type="button" onClick={() => onAction({ type: 'choosePlunderDestination', playerId: decision.playerId, boatId: decision.boatId, destination })}>{destination === 'port' ? '送往港口' : '送往修船厂'}</button>)}</div></>}
    {error && <p className="rule-error" role="alert">{error}</p>}
  </aside>
}
