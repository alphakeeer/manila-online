import { createPool } from '../src/persistence/database.js'
import { loadConfig } from '../src/config.js'
import { createAccessToken, listAccessTokens, revokeAccessToken } from '../src/auth/repository.js'
import { digestAccessToken, generateAccessToken, generateTokenId } from '../src/auth/credentials.js'

function usage(): never {
  throw new Error('用法：npm run tokens -- create [label] | list | revoke <token-id>')
}

const [command, ...arguments_] = process.argv.slice(2)
const config = loadConfig()
if (!config.authPepper) throw new Error('AUTH_PEPPER 必须配置后才能管理 Token')
const pool = createPool(config.databaseUrl)

try {
  if (command === 'create') {
    const token = generateAccessToken()
    const tokenId = generateTokenId()
    const label = arguments_.join(' ').trim() || null
    await createAccessToken(pool, {
      id: tokenId,
      digest: digestAccessToken(token, config.authPepper),
      label,
    })
    console.log(`Token: ${token}`)
    console.log(`Token ID: ${tokenId}`)
    console.log('请立即安全保存 Token；它不会再次显示。')
} else if (command === 'revoke' && arguments_.length === 1) {
    const tokenId = arguments_[0]
    if (!tokenId) usage()
    const revoked = await revokeAccessToken(pool, tokenId)
    if (!revoked) throw new Error('未找到 Token ID')
    console.log(`已撤销 Token ID: ${tokenId}`)
  } else if (command === 'list' && arguments_.length === 0) {
    for (const token of await listAccessTokens(pool)) {
      console.log(`${token.id}\t${token.revoked_at ? 'revoked' : 'active'}\t${token.label ?? '-'}\t${token.created_at.toISOString()}`)
    }
  } else {
    usage()
  }
} finally {
  await pool.end()
}
