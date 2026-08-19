import { useState } from 'react'
import { demoState } from './demoState'
import { TableView } from './TableView'
import './manila-demo.css'

export function ManilaDemo() {
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null)
  const [confirmedPlacementId, setConfirmedPlacementId] = useState<string | null>(null)

  return (
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
    />
  )
}
