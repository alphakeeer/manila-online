import { chooseAction } from '@manila/protocol'

export { chooseAction }

export interface AutopilotSettings { enabled: boolean; delay: number }

/** Dev-only switch: `?bot=1&botDelay=1200` on the Vite dev server. Never active in production builds. */
export function readAutopilotSettings(): AutopilotSettings {
  if (!import.meta.env.DEV || typeof window === 'undefined') return { enabled: false, delay: 0 }
  const params = new URLSearchParams(window.location.search)
  const delay = Number(params.get('botDelay'))
  return { enabled: params.get('bot') === '1', delay: Number.isFinite(delay) && delay >= 200 ? delay : 1200 }
}
