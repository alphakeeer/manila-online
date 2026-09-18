import type { WebSocket } from 'ws'
import type { GameService } from '../game/service.js'

type Subscriber = { socket: WebSocket; sessionId: string; seat: number }

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload))
}

/** Keeps a room's initial snapshot, commits, and presence notices in one order. */
export class RoomHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>()
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly game: GameService) {}

  private enqueue(roomCode: string, operation: () => Promise<void>) {
    const previous = this.queues.get(roomCode) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(roomCode, next)
    void next.finally(() => {
      if (this.queues.get(roomCode) === next) this.queues.delete(roomCode)
    })
    return next
  }

  async subscribe(roomCode: string, sessionId: string, socket: WebSocket) {
    await this.enqueue(roomCode, async () => {
      const result = await this.game.latest(sessionId, roomCode)
      if (result.kind === 'rejected') {
        send(socket, { type: 'session.expired', code: result.code })
        socket.close(1008)
        return
      }
      const subscriber: Subscriber = { socket, sessionId, seat: result.snapshot.self.seat }
      const room = this.subscribers.get(roomCode) ?? new Set<Subscriber>()
      room.add(subscriber)
      this.subscribers.set(roomCode, room)
      send(socket, { type: 'room.snapshot', snapshot: result.snapshot })
      this.broadcastPresence(roomCode)
      socket.once('close', () => {
        void this.enqueue(roomCode, async () => {
          room.delete(subscriber)
          if (room.size === 0) this.subscribers.delete(roomCode)
          this.broadcastPresence(roomCode)
        })
      })
    })
  }

  async publish(roomCode: string) {
    await this.enqueue(roomCode, async () => {
      const room = this.subscribers.get(roomCode)
      if (!room) return
      for (const subscriber of [...room]) {
        const result = await this.game.latest(subscriber.sessionId, roomCode)
        if (result.kind === 'accepted') {
          send(subscriber.socket, { type: 'room.snapshot', snapshot: result.snapshot })
        } else {
          send(subscriber.socket, { type: 'session.expired', code: result.code })
          subscriber.socket.close(1008)
        }
      }
    })
  }

  async heartbeat(roomCode: string, sessionId: string, revision: number, socket: WebSocket) {
    await this.enqueue(roomCode, async () => {
      const result = await this.game.latest(sessionId, roomCode)
      if (result.kind !== 'accepted') {
        send(socket, { type: 'session.expired', code: result.code })
        socket.close(1008)
        return
      }
      if (result.snapshot.room.revision !== revision) send(socket, { type: 'room.snapshot', snapshot: result.snapshot })
    })
  }

  private broadcastPresence(roomCode: string) {
    const room = this.subscribers.get(roomCode)
    if (!room) return
    const seats = [...new Set([...room].map((subscriber) => subscriber.seat))].sort((left, right) => left - right)
    for (const subscriber of room) send(subscriber.socket, { type: 'room.presence', seats })
  }
}
