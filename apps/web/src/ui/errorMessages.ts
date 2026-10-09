import type { ApiErrorCode } from '@manila/protocol'

export type DisplayErrorCode = ApiErrorCode | 'UNKNOWN_ERROR'

const messages: Record<DisplayErrorCode, string> = {
  AUTH_REQUIRED: '会话已失效，请重新输入访问 Token。',
  TOKEN_REVOKED: '访问 Token 已被撤销，请联系管理员获取新的 Token。',
  INVALID_ACCESS_TOKEN: 'Token 不正确，请检查 8 位字符后重试。',
  ORIGIN_FORBIDDEN: '当前来源被服务器拒绝，请从正确地址打开页面。',
  RATE_LIMITED: '操作过于频繁，请稍等一分钟再试。',
  STORAGE_UNAVAILABLE: '服务器暂时无法读写存档，请稍后重试。',
  VALIDATION_ERROR: '提交内容不完整或格式错误，请检查后重试。',
  NOT_MEMBER: '你已不在该房间中，请返回大厅。',
  ROOM_NOT_FOUND: '房间不存在或已关闭，请返回大厅。',
  ROOM_FULL: '房间人数已满。',
  ROOM_CLOSED: '房间已关闭，只能查看记录。',
  ALREADY_IN_ROOM: '该会话已经在一个房间中。',
  NOT_HOST: '只有房主可以执行该操作。',
  REVISION_CONFLICT: '其他玩家已先提交操作，状态已刷新，请重新确认。',
  COMMAND_ID_REUSED: '该操作编号已用于不同内容，请重新操作。',
  RULE_REJECTED: '服务器判定当前操作不合法，请根据最新状态重新选择。',
  ACTION_NOT_AVAILABLE: '当前阶段不能执行该操作，请等待状态刷新。',
  START_NOT_READY: '需要 3–5 人且全员准备后才能开始。',
  GAME_NOT_FOUND: '对局存档不存在。',
  ROOM_ISOLATED: '房间存档校验失败，已隔离保护，无法继续操作。',
  PROTOCOL_VERSION_UNSUPPORTED: '客户端版本过旧，请刷新页面。',
  SEAT_NOT_CLAIMABLE: '这局已经开始。只有机器人托管中或已退出的座位，才能用原来的昵称接回。',
  UNKNOWN_ERROR: '发生未知网络错误，请刷新页面或稍后重试。',
}

export function errorMessage(code: DisplayErrorCode): string {
  return messages[code]
}
