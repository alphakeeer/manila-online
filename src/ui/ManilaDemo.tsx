import { useState } from 'react'
import { demoState } from './demoState'
import { HandoffOverlay, SettlementModal, SharesDrawer } from './DemoOverlays'
import { TableView } from './TableView'
import type { DemoScene } from './types'
import './manila-demo.css'

export function ManilaDemo() {
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [confirmedPlacementId, setConfirmedPlacementId] = useState<string | null>(null)
  const [scene, setScene] = useState<DemoScene>('table')

  if (scene === 'handoff') {
    return <HandoffOverlay playerName="阿青" onAccept={() => setScene('table')} />
  }

  return (
    <>
      <TableView
        state={demoState}
        selectedPlacementId={selectedPlacementId}
        confirmedPlacementId={confirmedPlacementId}
        onSelectPlacement={(placementId) => {
          setSelectedPlacementId(placementId)
          setConfirmedPlacementId(null)
        }}
        onConfirmPlacement={() => {
          if (selectedPlacementId) setConfirmedPlacementId(selectedPlacementId)
        }}
        onOpenHandoff={() => setScene('handoff')}
        onOpenShares={() => setScene('shares')}
        onOpenSettlement={() => setScene('settlement')}
      />
      {scene === 'shares' && <SharesDrawer shares={demoState.shares} onClose={() => setScene('table')} />}
      {scene === 'settlement' && <SettlementModal rows={demoState.settlement} onClose={() => setScene('table')} />}
    </>
  )
}
