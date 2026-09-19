import rawAnnotations from '../../../../annotator/board-and-shares-annotations.json'
import type { CSSProperties } from 'react'

export interface AnnotationItem {
  id: string
  name: string
  type: string
  x: number
  y: number
  rotation: number
  scale: number
}

export interface AnnotationCanvas {
  id?: string
  width: number
  height: number
  items: AnnotationItem[]
}

export interface AnnotationDocument {
  board: AnnotationCanvas
  shares: AnnotationCanvas[]
}

function itemFromUnknown(value: unknown): AnnotationItem {
  if (typeof value !== 'object' || value === null) throw new Error('标注项目格式错误')
  const item = value as Record<string, unknown>
  const numeric = (key: 'x' | 'y' | 'rotation' | 'scale') => {
    if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) throw new Error(`标注项目缺少 ${key}`)
    return item[key]
  }
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.type !== 'string') {
    throw new Error('标注项目缺少语义名称或素材类型')
  }
  return { id: item.id, name: item.name, type: item.type, x: numeric('x'), y: numeric('y'), rotation: numeric('rotation'), scale: numeric('scale') }
}

function canvasFromUnknown(value: unknown, id?: string): AnnotationCanvas {
  if (typeof value !== 'object' || value === null) throw new Error('标注画布格式错误')
  const canvas = value as Record<string, unknown>
  if (typeof canvas.width !== 'number' || typeof canvas.height !== 'number' || canvas.width <= 0 || canvas.height <= 0 || !Array.isArray(canvas.items)) {
    throw new Error('标注画布尺寸或项目格式错误')
  }
  return { ...(id === undefined ? {} : { id }), width: canvas.width, height: canvas.height, items: canvas.items.map(itemFromUnknown) }
}

export function parseAnnotations(value: unknown): AnnotationDocument {
  if (typeof value !== 'object' || value === null) throw new Error('标注文件格式错误')
  const document = value as Record<string, unknown>
  if (!Array.isArray(document.shares)) throw new Error('标注文件缺少股份画布')
  return {
    board: canvasFromUnknown(document.board),
    shares: document.shares.map((share, index) => canvasFromUnknown(share, `share-${index + 1}`)),
  }
}

export const annotationDocument = parseAnnotations(rawAnnotations)

function findPosition(canvas: AnnotationCanvas, name: string, label: string): AnnotationItem {
  const matches = canvas.items.filter((item) => item.name === name)
  if (matches.length === 0) throw new Error(`缺少${label}标注：${name}`)
  if (matches.length > 1) throw new Error(`重复${label}标注：${name}`)
  return matches[0]!
}

export function findBoardPosition(document: AnnotationDocument, name: string): AnnotationItem {
  return findPosition(document.board, name, '版图')
}

export function findSharePosition(document: AnnotationDocument, commodity: string, name: string): AnnotationItem {
  const canvas = document.shares.find((share) => share.id === commodity)
  if (!canvas) throw new Error(`缺少股份画布：${commodity}`)
  return findPosition(canvas, name, '股份')
}

const shareCanvasByCommodity = { jade: 'share-1', nutmeg: 'share-2', silk: 'share-3', ginseng: 'share-4' } as const

export function findCargoSlot(document: AnnotationDocument, commodity: keyof typeof shareCanvasByCommodity, slot: number): { canvas: AnnotationCanvas; item: AnnotationItem } {
  const canvas = document.shares.find((share) => share.id === shareCanvasByCommodity[commodity])
  if (!canvas) throw new Error(`缺少股份画布：${commodity}`)
  const positions = canvas.items.filter((item) => item.name.startsWith(`${commodity}-cargo-slot-`)).sort((left, right) => left.name.localeCompare(right.name))
  const item = positions[slot]
  if (!item) throw new Error(`缺少货物同伙标注：${commodity} ${slot}`)
  return { canvas, item }
}

export function findCargoSlotPosition(document: AnnotationDocument, commodity: keyof typeof shareCanvasByCommodity, slot: number): AnnotationItem {
  return findCargoSlot(document, commodity, slot).item
}

export function hotspotStyle(canvas: AnnotationCanvas, item: AnnotationItem): CSSProperties {
  return {
    left: `${(item.x / canvas.width) * 100}%`,
    top: `${(item.y / canvas.height) * 100}%`,
    transform: 'translate(-50%, -50%)',
  }
}

export function positionStyle(canvas: AnnotationCanvas, item: AnnotationItem): CSSProperties {
  return {
    left: `${(item.x / canvas.width) * 100}%`,
    top: `${(item.y / canvas.height) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`,
  }
}

export function playerPositionStyle(canvas: AnnotationCanvas, item: AnnotationItem): CSSProperties {
  return {
    left: `${(item.x / canvas.width) * 100}%`,
    top: `${(item.y / canvas.height) * 100}%`,
    width: `${(1254 / canvas.width) * item.scale * 100}%`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
  }
}
