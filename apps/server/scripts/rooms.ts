import { createPool } from '../src/persistence/database.js'
import { loadConfig } from '../src/config.js'

const [command, roomCode] = process.argv.slice(2)
if ((command !== 'list' && command !== 'close') || (command === 'close' && !roomCode)) {
  throw new Error('用法：npm run rooms -- list | close <room-code>')
}

const config = loadConfig()
if (!config.authPepper) throw new Error('AUTH_PEPPER 必须配置后才能管理房间')
const pool = createPool(config.databaseUrl)
try {
  if (command === 'list') {
    const result = await pool.query<{ code: string; status: string; revision: number; member_count: string; updated_at: Date }>(`SELECT rooms.code, rooms.status, rooms.revision, count(room_members.session_id) AS member_count, rooms.updated_at FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id GROUP BY rooms.id ORDER BY rooms.updated_at DESC`)
    for (const room of result.rows) console.log(`${room.code}\t${room.status}\trevision=${room.revision}\tmembers=${room.member_count}\t${room.updated_at.toISOString()}`)
  } else {
    const result = await pool.query('UPDATE rooms SET status = $1, closed_at = COALESCE(closed_at, now()), revision = revision + 1 WHERE code = $2 AND status <> $1 RETURNING code', ['closed', roomCode!.trim().toUpperCase()])
    if (result.rowCount === 0) throw new Error('未找到可关闭房间')
    console.log(`已关闭房间 ${roomCode!.trim().toUpperCase()}`)
  }
} finally {
  await pool.end()
}
