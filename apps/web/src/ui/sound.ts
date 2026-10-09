/** Tiny synthesized cues; no audio assets, silent until the first user gesture unlocks audio. */
export type Cue = 'turn' | 'dice' | 'coin' | 'tick' | 'danger' | 'arrive' | 'fanfare'

const muteKey = 'manila.muted.v1'
let context: AudioContext | null = null
let muted = readMuted()

function readMuted() {
  try { return localStorage.getItem(muteKey) === '1' } catch { return false }
}

export function isMuted() { return muted }

export function setMuted(value: boolean) {
  muted = value
  try { localStorage.setItem(muteKey, value ? '1' : '0') } catch { /* storage may be unavailable */ }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume().catch(() => undefined)
  return context
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.12) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(frequency, ctx.currentTime + start)
  amp.gain.setValueAtTime(0.0001, ctx.currentTime + start)
  amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + duration + 0.02)
}

function rattle(ctx: AudioContext) {
  for (let index = 0; index < 7; index += 1) tone(ctx, 180 + Math.random() * 260, index * 0.075, 0.05, 'square', 0.035)
}

export function play(cue: Cue) {
  if (muted) return
  const ctx = audio()
  if (!ctx) return
  switch (cue) {
    case 'turn': tone(ctx, 660, 0, 0.18, 'triangle'); tone(ctx, 880, 0.14, 0.28, 'triangle'); break
    case 'dice': rattle(ctx); break
    case 'coin': tone(ctx, 1320, 0, 0.09, 'square', 0.04); tone(ctx, 1760, 0.07, 0.16, 'square', 0.04); break
    case 'tick': tone(ctx, 520, 0, 0.07, 'triangle', 0.06); break
    case 'danger': tone(ctx, 220, 0, 0.22, 'sawtooth', 0.05); tone(ctx, 165, 0.16, 0.3, 'sawtooth', 0.05); break
    case 'arrive': tone(ctx, 523, 0, 0.12, 'sine'); tone(ctx, 784, 0.1, 0.22, 'sine'); break
    case 'fanfare': [523, 659, 784, 1046].forEach((frequency, index) => tone(ctx, frequency, index * 0.13, 0.32, 'triangle', 0.09)); break
  }
}
