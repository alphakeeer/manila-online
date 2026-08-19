# Manila UI Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive, fixed-data Manila visual demo that shows the board, guided placement decision, hot-seat handoff, private shares, and voyage settlement on desktop and mobile.

**Architecture:** Keep the existing pure game engine untouched. Add a `src/ui/` presentation subsystem driven by one typed `demoState` constant and local React scene/selection state; desktop and mobile render the same semantic components with CSS media queries.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, Vitest 3, Testing Library, jsdom, CSS.

**Spec:** `docs/superpowers/specs/2026-08-19-manila-ui-demo-design.md`

## Global Constraints

- Use fixed local demo data; do not call `createGame`, `getDecision`, or `transition`.
- Do not add a backend, persistence, networking, external fonts, sound, or complex animation.
- Use existing files under `manila_assets/` through Vite-resolvable asset URLs.
- Use the glossary terms 舢板、比索、港务长、同伙、股份、黑市行情表、航程.
- Support desktop 1440×900, mobile 390×844, and a minimum page width of 320px.
- Preserve all existing game-engine behavior and tests.

---

### Task 1: UI test harness and fixed demo model

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/ui/demoState.ts`
- Create: `src/ui/types.ts`
- Create: `src/ui/__tests__/ManilaDemo.test.tsx`

**Interfaces:**
- Produces: `DemoState`, `DemoPlayer`, `DemoBoat`, `DemoScene`, and `demoState`.
- `DemoScene` is exactly `'table' | 'handoff' | 'shares' | 'settlement'`.
- `demoState` contains voyage 2, current player `p1`, three player summaries, three boats, two placement choices, three private shares, and fixed settlement rows.

- [ ] **Step 1: Install the UI test dependencies**

Run:

```bash
npm install --save-dev @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write the failing smoke test**

Create `src/ui/__tests__/ManilaDemo.test.tsx` with jsdom environment and a test that renders `ManilaDemo`, then asserts the visible text `第 2 航程`, `阿青`, `放置同伙`, and `确认放置`.

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { ManilaDemo } from '../ManilaDemo'

test('renders the fixed voyage table', () => {
  render(<ManilaDemo />)
  expect(screen.getByText('第 2 航程')).toBeInTheDocument()
  expect(screen.getByText('放置同伙')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '确认放置' })).toBeInTheDocument()
})
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm test -- src/ui/__tests__/ManilaDemo.test.tsx`

Expected: FAIL because `../ManilaDemo` does not exist.

- [ ] **Step 4: Add the typed fixed data**

Create focused interfaces in `src/ui/types.ts`. Create `demoState` in `src/ui/demoState.ts` with literal Chinese display content, normalized boat positions, existing share image URLs created with `new URL('../../manila_assets/<file>', import.meta.url).href`, and no game-engine imports.

- [ ] **Step 5: Commit the test harness and model**

```bash
git add package.json package-lock.json src/ui/types.ts src/ui/demoState.ts src/ui/__tests__/ManilaDemo.test.tsx
git commit -m "test: define Manila UI demo contract"
```

---

### Task 2: Responsive table and placement decision

**Files:**
- Create: `src/ui/ManilaDemo.tsx`
- Create: `src/ui/TableView.tsx`
- Create: `src/ui/BoardStage.tsx`
- Create: `src/ui/manila-demo.css`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `src/ui/__tests__/ManilaDemo.test.tsx`

**Interfaces:**
- `ManilaDemo(): JSX.Element` owns `scene` and `selectedPlacementId`.
- `TableView` receives `demoState`, selected placement ID, selection callback, and scene callbacks.
- `BoardStage` receives boats and selected placement ID and renders the board image plus normalized overlays.

- [ ] **Step 1: Extend the failing test for the table contract**

Add assertions for three player summaries, the image named `马尼拉游戏版图`, two radio-like placement buttons, and an initially disabled `确认放置` button. Use `userEvent` to select `人参舢板`, then assert `aria-pressed="true"` and that confirmation becomes enabled.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/ui/__tests__/ManilaDemo.test.tsx`

Expected: FAIL because the table and selection behavior are not implemented.

- [ ] **Step 3: Implement semantic table components**

Build the header, player strip, board stage, decision panel, and mobile bottom navigation. Use buttons for placement choices with `aria-pressed`; keep the confirmation button disabled until selection. Confirmation shows an inline `已选择：人参舢板` status and does not call the game engine.

- [ ] **Step 4: Implement the approved responsive visual system**

In `manila-demo.css`, define the heritage palette (`#153a33`, `#f2e2c2`, `#b84b35`, `#d5ad58`, `#493625`), serif heading stack, body sans stack, desktop grid at `min-width: 900px`, mobile bottom sheet below 900px, safe-area padding, 44px controls, and no page-level horizontal overflow. Import this stylesheet only from `ManilaDemo.tsx`; reduce `src/styles.css` to global reset/root sizing.

- [ ] **Step 5: Connect the app entry and verify GREEN**

Render `<ManilaDemo />` from `src/App.tsx` and run:

```bash
npm test -- src/ui/__tests__/ManilaDemo.test.tsx
npm run build
```

Expected: focused UI tests PASS and Vite build exits 0.

- [ ] **Step 6: Commit the responsive table**

```bash
git add src/App.tsx src/styles.css src/ui/ManilaDemo.tsx src/ui/TableView.tsx src/ui/BoardStage.tsx src/ui/manila-demo.css src/ui/__tests__/ManilaDemo.test.tsx
git commit -m "feat: add responsive Manila demo table"
```

---

### Task 3: Handoff, shares, and settlement scenes

**Files:**
- Create: `src/ui/DemoOverlays.tsx`
- Modify: `src/ui/ManilaDemo.tsx`
- Modify: `src/ui/TableView.tsx`
- Modify: `src/ui/manila-demo.css`
- Test: `src/ui/__tests__/ManilaDemo.test.tsx`

**Interfaces:**
- `DemoToolbar` calls `onSceneChange(scene)` for all four `DemoScene` values.
- `HandoffOverlay`, `SharesDrawer`, and `SettlementModal` each receive one close/confirm callback and fixed `demoState` content.
- All overlays use labelled dialog semantics; the handoff scene hides private table details until confirmation.

- [ ] **Step 1: Write failing interaction tests**

Add three tests using `userEvent`:

```tsx
test('reveals the table after handoff confirmation', async () => {
  const user = userEvent.setup()
  render(<ManilaDemo />)
  await user.click(screen.getByRole('button', { name: '演示交接' }))
  expect(screen.getByRole('dialog', { name: '玩家交接' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '确认接手' }))
  expect(screen.queryByRole('dialog', { name: '玩家交接' })).not.toBeInTheDocument()
})
```

Also assert that `我的股份` opens a labelled drawer with three share images and that `演示结算` opens a dialog showing `黑市行情表` and closes through `返回版图`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/ui/__tests__/ManilaDemo.test.tsx`

Expected: FAIL because toolbar and overlay scenes do not exist.

- [ ] **Step 3: Implement overlay components**

Create the toolbar and three overlays in `DemoOverlays.tsx`. Use fixed scene state in `ManilaDemo`; include visible close buttons, `role="dialog"`, `aria-modal="true"`, descriptive labels, share art,抵押 badge, settlement deltas, and voyage result copy.

- [ ] **Step 4: Add responsive overlay styling**

Desktop shares enter as a right drawer and settlement is a centered parchment card. Mobile shares and settlement occupy most of the viewport without horizontal scrolling. The handoff overlay is full-screen at every width and does not render private share content behind it.

- [ ] **Step 5: Verify GREEN and all regressions**

Run:

```bash
npm test -- src/ui/__tests__/ManilaDemo.test.tsx
npm test
npm run build
```

Expected: all UI and existing game-engine tests PASS; production build exits 0.

- [ ] **Step 6: Commit the scene interactions**

```bash
git add src/ui/DemoOverlays.tsx src/ui/ManilaDemo.tsx src/ui/TableView.tsx src/ui/manila-demo.css src/ui/__tests__/ManilaDemo.test.tsx
git commit -m "feat: add Manila demo scenes"
```

---

### Task 4: Browser visual verification and documentation

**Files:**
- Modify: `readme.md`
- Modify only if browser verification exposes a reproducible issue: `src/ui/manila-demo.css`, `src/ui/*.tsx`, `src/ui/__tests__/ManilaDemo.test.tsx`

**Interfaces:**
- Keeps all public game-engine exports unchanged.
- Documents `npm run dev` as the UI preview command and identifies the page as fixed-data visual demo.

- [ ] **Step 1: Start the local Vite server**

Run: `npm run dev -- --host 127.0.0.1`

- [ ] **Step 2: Inspect desktop rendering**

At 1440×900, verify the full player strip, complete board, fixed right decision panel, scene toolbar, and no unintended page-level scroll. Exercise placement selection, handoff, shares, and settlement.

- [ ] **Step 3: Inspect mobile rendering**

At 390×844, verify the compact header, upper-half board, bottom decision sheet, 44px controls, all overlay scenes, and no horizontal page scroll.

- [ ] **Step 4: Fix only visually confirmed defects through TDD**

For every defect, first add a focused test reproducing the missing semantic state or CSS class contract, run it RED, implement the smallest correction, and rerun GREEN. Do not add new scenes or real engine integration.

- [ ] **Step 5: Update README and run final verification**

Document the fixed-data demo and run:

```bash
npm test
npm run simulate
npm run build
```

Expected: all commands exit 0; the AI simulation still completes 10 games.

- [ ] **Step 6: Commit verified UI documentation**

```bash
git add readme.md src/ui src/App.tsx src/styles.css package.json package-lock.json
git commit -m "docs: document Manila UI demo"
```
