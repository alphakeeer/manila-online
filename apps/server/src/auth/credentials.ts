import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { ACCESS_TOKEN_ALPHABET, ACCESS_TOKEN_LENGTH } from '@manila/protocol'

const TOKEN_DOMAIN = 'manila/access-token/v1\0'
const SESSION_DOMAIN = 'manila/session-credential/v1\0'

export function digestAccessToken(token: string, pepper: string) {
  return createHmac('sha256', pepper).update(TOKEN_DOMAIN).update(token).digest('hex')
}

export function digestSessionCredential(credential: string, pepper: string) {
  return createHmac('sha256', pepper).update(SESSION_DOMAIN).update(credential).digest('hex')
}

export function generateAccessToken() {
  let token = ''
  for (let index = 0; index < ACCESS_TOKEN_LENGTH; index += 1) {
    token += ACCESS_TOKEN_ALPHABET[randomInt(ACCESS_TOKEN_ALPHABET.length)]
  }
  return token
}

export function generateTokenId() {
  return randomBytes(16).toString('hex')
}

export function generateSessionCredential() {
  return randomBytes(32).toString('base64url')
}

export function generateSessionId() {
  return randomBytes(16).toString('hex')
}
