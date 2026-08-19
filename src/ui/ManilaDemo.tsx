import { demoState } from './demoState'

export function ManilaDemo() {
  return (
    <section aria-label="马尼拉视觉演示">
      <p>第 {demoState.voyage} 航程</p>
      <h1>{demoState.players[0]?.name}</h1>
      <h2>放置同伙</h2>
      <button type="button">确认放置</button>
    </section>
  )
}
