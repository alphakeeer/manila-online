import { createPool } from '../src/persistence/database.js'
import { loadConfig } from '../src/config.js'
import { closeRoomByCode } from '../src/lobby/service.js'

const [command, roomCode] = process.argv.slice(2)
if ((command !== 'list' && command !== 'close') || (command === 'close' && !roomCode)) {
  throw new Error('用法：npm run rooms -- list | close <room-code>')
}

const config = loadConfig()
if (!config.authPepper) throw new Error('AUTH_PEPPER 必须配置后才能管理房间')
const pool = createPool(config.databaseUrl)
try {
  if (command === 'list') {
    const result = await pool.query<{ code: string; status: string; revision: number; member_count: string; created_at: Date }>(`SELECT rooms.code, rooms.status, rooms.revision, count(room_members.session_id) AS member_count, rooms.created_at FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id GROUP BY rooms.id ORDER BY rooms.created_at DESC`)
    for (const room of result.rows) console.log(`${room.code}\t${room.status}\trevision=${room.revision}\tmembers=${room.member_count}\t${room.created_at.toISOString()}`)
  } else {
    const code = roomCode!.trim().toUpperCase()
    const closed = await closeRoomByCode(pool, code)
    if (!closed) throw new Error('未找到可关闭房间')
    console.log(`已关闭房间 ${code}`)
  }
} finally {
  await pool.end()
}
