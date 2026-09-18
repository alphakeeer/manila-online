import type { Commodity } from '@manila/game'

const presentation: Record<Commodity, { label: string; className: string }> = {
  nutmeg: { label: '肉豆蔻', className: 'commodity--nutmeg' },
  silk: { label: '丝绸', className: 'commodity--silk' },
  jade: { label: '玉石', className: 'commodity--jade' },
  ginseng: { label: '人参', className: 'commodity--ginseng' },
}

export function commodityPresentation(commodity: Commodity) {
  return presentation[commodity]
}
