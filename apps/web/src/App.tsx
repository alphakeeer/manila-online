import { ManilaApp } from './ui/ManilaApp'
import { SessionLobby } from './ui/SessionLobby'

export function App() {
  if (import.meta.env.DEV && import.meta.env.VITE_MANILA_HOTSEAT === 'true') {
    return <ManilaApp />
  }
  return <SessionLobby />
}
