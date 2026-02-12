<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNodeCanvasPersistence } from '@/composables/useNodeCanvasPersistence'
import {
  fromPersistedState,
  toPersistedState,
  type NodeKind,
  type NodeGraphCable as CableConnection,
  type NodeGraphNode as GraphNode,
  type NodeGraphPort as NodePort,
} from '@/features/nodeCanvas/model'
import { store } from '@/store'

interface DragState {
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

interface PanState {
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

interface NodeTemplate {
  templateId: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  details: string[];
  ports: NodePort[];
}

interface CableDraft {
  fromNodeId: string;
  fromPortId: string;
  cursorX: number;
  cursorY: number;
}

const GRID_SIZE = 24
const NODE_WIDTH = 188
const NODE_HEIGHT = 88
const BOARD_PADDING = 24
const WORLD_WIDTH = 2200
const WORLD_HEIGHT = 1400
const MIN_SCALE = 0.4
const MAX_SCALE = 2
const HOVER_TOOLTIP_DELAY_MS = 280
const DEFAULT_PAN = { x: 40, y: 40 }
const DEFAULT_SCALE = 1

const INITIAL_NODES: GraphNode[] = []
const INITIAL_CABLES: CableConnection[] = []

const boardRef = ref<HTMLElement | null>(null)
const persistence = useNodeCanvasPersistence({ debounceMs: 600 })
const hasMovedNodeDuringDrag = ref(false)
const hasPannedDuringGesture = ref(false)
const nodes = ref<GraphNode[]>(
  INITIAL_NODES.map((node) => ({
    ...node,
    details: [...node.details],
    ports: node.ports.map((port) => ({ ...port })),
  })),
)
const cables = ref<CableConnection[]>(INITIAL_CABLES.map((cable) => ({ ...cable })))
const dragging = ref<DragState | null>(null)
const panning = ref<PanState | null>(null)
const selectedNodeId = ref<string | null>(null)
const scale = ref(DEFAULT_SCALE)
const pan = ref({ ...DEFAULT_PAN })

const showAddModal = ref(false)
const catalogTab = ref<'devices' | 'patchbay'>('devices')
const addSearchQuery = ref('')

const showConnectModal = ref(false)
const connectTargetNodeId = ref<string | null>(null)

const cableDraft = ref<CableDraft | null>(null)

const hoveredNodeId = ref<string | null>(null)
const hoverPreviewNodeId = ref<string | null>(null)
const pinnedTooltipNodeId = ref<string | null>(null)
const hoverProgress = ref(0)
const hoverDelayTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const hoverProgressTimer = ref<ReturnType<typeof setInterval> | null>(null)
const hideHoverTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isHoveringTooltip = ref(false)

const hoveredCableId = ref<string | null>(null)
const isHoveringCableTooltip = ref(false)
const cableHideTimer = ref<ReturnType<typeof setTimeout> | null>(null)

const nodeMap = computed(() => {
  return new Map(nodes.value.map((node) => [node.id, node]))
})

const cableByPortKey = computed(() => {
  const map = new Map<string, CableConnection[]>()
  for (const cable of cables.value) {
    const fromKey = `${cable.fromNodeId}:${cable.fromPortId}`
    const toKey = `${cable.toNodeId}:${cable.toPortId}`
    map.set(fromKey, [...(map.get(fromKey) ?? []), cable])
    map.set(toKey, [...(map.get(toKey) ?? []), cable])
  }
  return map
})

const cableGeometry = computed(() => {
  return cables.value
    .map((cable) => {
      const fromNode = nodeMap.value.get(cable.fromNodeId)
      const toNode = nodeMap.value.get(cable.toNodeId)
      if (!fromNode || !toNode) return null

      const fromX = fromNode.x + NODE_WIDTH
      const fromY = fromNode.y + NODE_HEIGHT * 0.5
      const toX = toNode.x
      const toY = toNode.y + NODE_HEIGHT * 0.5
      const midX = fromX + (toX - fromX) * 0.5
      const midY = (fromY + toY) * 0.5
      const path = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`

      return {
        id: cable.id,
        path,
        midX,
        midY,
        cable,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
})

const draftCablePath = computed(() => {
  if (!cableDraft.value) return null
  const fromNode = nodeMap.value.get(cableDraft.value.fromNodeId)
  if (!fromNode) return null

  const fromX = fromNode.x + NODE_WIDTH
  const fromY = fromNode.y + NODE_HEIGHT * 0.5
  const toX = cableDraft.value.cursorX
  const toY = cableDraft.value.cursorY
  const midX = fromX + (toX - fromX) * 0.5

  return `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
})

const worldStyle = computed(() => {
  return {
    transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${scale.value})`,
  }
})

const zoomPercent = computed(() => `${Math.round(scale.value * 100)}%`)

const hasSelectedNode = computed(() => {
  return !!nodes.value.find((node) => node.id === selectedNodeId.value)
})

const activeTooltipNode = computed(() => {
  const activeId = pinnedTooltipNodeId.value ?? hoverPreviewNodeId.value
  if (!activeId) return null
  return nodeMap.value.get(activeId) ?? null
})

const isTooltipPinned = computed(() => {
  return !!pinnedTooltipNodeId.value
})

const activeConnectTargetNode = computed(() => {
  if (!connectTargetNodeId.value) return null
  return nodeMap.value.get(connectTargetNodeId.value) ?? null
})

const hoveredCableGeometry = computed(() => {
  if (!hoveredCableId.value) return null
  return cableGeometry.value.find((item) => item.id === hoveredCableId.value) ?? null
})

const hoveredCableLabel = computed(() => {
  if (!hoveredCableGeometry.value) return null
  const cable = hoveredCableGeometry.value.cable

  const fromNode = nodeMap.value.get(cable.fromNodeId)
  const toNode = nodeMap.value.get(cable.toNodeId)
  const fromPort = fromNode?.ports.find((port) => port.id === cable.fromPortId)
  const toPort = toNode?.ports.find((port) => port.id === cable.toPortId)

  if (!fromNode || !toNode || !fromPort || !toPort) return null
  return `${fromNode.title} (${fromPort.name}) -> ${toNode.title} (${toPort.name})`
})

const tooltipProgressStyle = computed(() => {
  return {
    width: `${Math.max(0, Math.min(100, hoverProgress.value))}%`,
  }
})

const tooltipStyle = computed(() => {
  if (!activeTooltipNode.value) return { display: 'none' }

  const x = activeTooltipNode.value.x + NODE_WIDTH + 12
  const y = activeTooltipNode.value.y
  return {
    left: `${x}px`,
    top: `${y}px`,
  }
})

const cableHoverTooltipStyle = computed(() => {
  if (!hoveredCableGeometry.value) return { display: 'none' }
  return {
    left: `${hoveredCableGeometry.value.midX + 10}px`,
    top: `${hoveredCableGeometry.value.midY - 12}px`,
  }
})

const deviceCatalog = computed<NodeTemplate[]>(() => {
  return store.devices.map((device) => ({
    templateId: `device-${device.id}`,
    title: device.name,
    subtitle: 'Device',
    kind: 'device',
    details: [`Type: ${device.type}`, `Ports: ${device.ports.length}`],
    ports: device.ports.length
      ? device.ports.map((port) => ({
          id: port.id,
          name: port.label,
          direction: mapStorePortDirection(port.type),
        }))
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' as const }],
  }))
})

const patchbayCatalog = computed<NodeTemplate[]>(() => {
  return store.patchbayNodes.map((point) => ({
    templateId: `patchbay-${point.id}`,
    title: point.name,
    subtitle: 'Patchbay Port',
    kind: 'patchbay',
    details: [point.description, `Type: ${point.type}`].filter((detail): detail is string => Boolean(detail)),
    ports: [{ id: `pb-${point.id}`, name: 'Signal', direction: 'io' }],
  }))
})

const activeCatalog = computed<NodeTemplate[]>(() => {
  return catalogTab.value === 'devices' ? deviceCatalog.value : patchbayCatalog.value
})

const filteredCatalog = computed(() => {
  const query = addSearchQuery.value.trim().toLowerCase()
  if (!query) return activeCatalog.value

  return activeCatalog.value.filter((item) => {
    const haystack = `${item.title} ${item.subtitle} ${item.details.join(' ')} ${item.ports.map((port) => port.name).join(' ')}`.toLowerCase()
    return haystack.includes(query)
  })
})

const draftSourceLabel = computed(() => {
  if (!cableDraft.value) return null

  const fromNode = nodeMap.value.get(cableDraft.value.fromNodeId)
  const fromPort = fromNode?.ports.find((port) => port.id === cableDraft.value?.fromPortId)
  if (!fromNode || !fromPort) return null

  return `${fromNode.title} (${fromPort.name})`
})

const persistenceStatusLabel = computed(() => {
  if (persistence.isLoading.value) return 'Loading canvas...'
  if (persistence.readOnly.value) return 'Read-only (admin required)'
  if (persistence.isSaving.value) return 'Saving...'
  if (persistence.error.value) return 'Unsaved changes'
  if (persistence.dirty.value) return 'Unsaved changes'
  if (persistence.lastSavedAt.value) return 'Saved'
  return 'Not saved'
})

const getNodeClass = (kind: NodeKind) => {
  return {
    device: kind === 'device',
    port: kind === 'device-port',
    patchbay: kind === 'patchbay',
  }
}

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max))
}

const snapToGrid = (value: number) => {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

const mapStorePortDirection = (type: string): NodePort['direction'] => {
  if (type === 'Input') return 'in'
  if (type === 'Output') return 'out'
  return 'io'
}

const buildDefaultNodesFromDevices = (): GraphNode[] => {
  if (store.devices.length === 0) {
    return INITIAL_NODES.map((node) => ({
      ...node,
      details: [...node.details],
      ports: node.ports.map((port) => ({ ...port })),
    }))
  }

  const columns = 4
  const horizontalGap = 280
  const verticalGap = 170
  const startX = 96
  const startY = 112

  return store.devices.map((device, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = startX + column * horizontalGap
    const y = startY + row * verticalGap
    const ports = device.ports.length
      ? device.ports.map((port) => ({
          id: port.id,
          name: port.label,
          direction: mapStorePortDirection(port.type),
        }))
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' as const }]

    return {
      id: `device-${device.id}`,
      deviceId: String(device.id),
      title: device.name,
      subtitle: 'Device',
      kind: 'device',
      details: [`Type: ${device.type}`, `Ports: ${device.ports.length}`],
      ports,
      x,
      y,
    }
  })
}

const buildSnapshotState = () => {
  return toPersistedState({
    nodes: nodes.value,
    cables: cables.value,
    pan: pan.value,
    scale: scale.value,
  })
}

const scheduleStateSave = () => {
  persistence.scheduleSave(buildSnapshotState())
}

const saveStateNow = async () => {
  await persistence.saveNow(buildSnapshotState())
}

const boardToWorld = (clientX: number, clientY: number) => {
  if (!boardRef.value) return { x: 0, y: 0 }

  const boardRect = boardRef.value.getBoundingClientRect()
  return {
    x: (clientX - boardRect.left - pan.value.x) / scale.value,
    y: (clientY - boardRect.top - pan.value.y) / scale.value,
  }
}

const getPortConnections = (nodeId: string, portId: string) => {
  return cableByPortKey.value.get(`${nodeId}:${portId}`) ?? []
}

const getPortConnectionLabel = (nodeId: string, portId: string) => {
  const cablesForPort = getPortConnections(nodeId, portId)
  const cable = cablesForPort[0]
  if (!cable) return 'Open'
  if (cablesForPort.length > 1) return `Connected (${cablesForPort.length})`

  const isFrom = cable.fromNodeId === nodeId && cable.fromPortId === portId
  const otherNodeId = isFrom ? cable.toNodeId : cable.fromNodeId
  const otherPortId = isFrom ? cable.toPortId : cable.fromPortId

  const otherNode = nodeMap.value.get(otherNodeId)
  const otherPort = otherNode?.ports.find((port) => port.id === otherPortId)
  if (!otherNode || !otherPort) return 'Connected'

  return `Connected to ${otherNode.title} (${otherPort.name})`
}

const clearHideHoverTimer = () => {
  if (hideHoverTimer.value) {
    clearTimeout(hideHoverTimer.value)
    hideHoverTimer.value = null
  }
}

const clearCableHideTimer = () => {
  if (cableHideTimer.value) {
    clearTimeout(cableHideTimer.value)
    cableHideTimer.value = null
  }
}

const clearHoverTimers = () => {
  if (hoverDelayTimer.value) {
    clearTimeout(hoverDelayTimer.value)
    hoverDelayTimer.value = null
  }

  if (hoverProgressTimer.value) {
    clearInterval(hoverProgressTimer.value)
    hoverProgressTimer.value = null
  }
}

const startHoverTracking = (nodeId: string) => {
  if (pinnedTooltipNodeId.value && pinnedTooltipNodeId.value !== nodeId) return

  clearHideHoverTimer()
  clearHoverTimers()
  hoveredNodeId.value = nodeId
  hoverProgress.value = 0

  hoverDelayTimer.value = setTimeout(() => {
    if (hoveredNodeId.value !== nodeId) return
    hoverPreviewNodeId.value = nodeId
    pinnedTooltipNodeId.value = nodeId
    clearHoverTimers()
  }, HOVER_TOOLTIP_DELAY_MS)
}

const stopHoverTracking = (nodeId: string) => {
  if (hoveredNodeId.value !== nodeId) return

  hoveredNodeId.value = null
  clearHoverTimers()

  clearHideHoverTimer()
  hideHoverTimer.value = setTimeout(() => {
    if (isHoveringTooltip.value) return
    closePinnedTooltip()
  }, 160)
}

const onTooltipPointerEnter = () => {
  isHoveringTooltip.value = true
  clearHideHoverTimer()
}

const onTooltipPointerLeave = () => {
  isHoveringTooltip.value = false
  closePinnedTooltip()
}

const onNodePointerDown = (event: PointerEvent, node: GraphNode) => {
  event.preventDefault()
  selectedNodeId.value = node.id

  if (cableDraft.value) {
    if (cableDraft.value.fromNodeId === node.id) return
    connectTargetNodeId.value = node.id
    showConnectModal.value = true
    return
  }

  const pointerWorld = boardToWorld(event.clientX, event.clientY)
  dragging.value = {
    nodeId: node.id,
    offsetX: pointerWorld.x - node.x,
    offsetY: pointerWorld.y - node.y,
  }
  hasMovedNodeDuringDrag.value = false
}

const onBoardPointerDown = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.closest('.node-card') || target.closest('.node-tooltip') || target.closest('.cable-tooltip')) return
  if (event.button !== 0 && event.button !== 1) return

  event.preventDefault()
  selectedNodeId.value = null

  if (cableDraft.value) {
    cancelCableDraft()
    return
  }

  panning.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: pan.value.x,
    startPanY: pan.value.y,
  }
  hasPannedDuringGesture.value = false
}

const onPointerMove = (event: PointerEvent) => {
  if (cableDraft.value) {
    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    cableDraft.value.cursorX = pointerWorld.x
    cableDraft.value.cursorY = pointerWorld.y
  }

  if (dragging.value) {
    const dragNode = nodes.value.find((node) => node.id === dragging.value?.nodeId)
    if (!dragNode) return

    const pointerWorld = boardToWorld(event.clientX, event.clientY)
    const rawX = pointerWorld.x - dragging.value.offsetX
    const rawY = pointerWorld.y - dragging.value.offsetY
    const maxX = WORLD_WIDTH - NODE_WIDTH - BOARD_PADDING
    const maxY = WORLD_HEIGHT - NODE_HEIGHT - BOARD_PADDING

    const nextX = snapToGrid(clamp(rawX, BOARD_PADDING, maxX))
    const nextY = snapToGrid(clamp(rawY, BOARD_PADDING, maxY))
    if (dragNode.x !== nextX || dragNode.y !== nextY) {
      hasMovedNodeDuringDrag.value = true
      dragNode.x = nextX
      dragNode.y = nextY
    }
    return
  }

  if (panning.value) {
    const deltaX = event.clientX - panning.value.startClientX
    const deltaY = event.clientY - panning.value.startClientY
    const nextX = panning.value.startPanX + deltaX
    const nextY = panning.value.startPanY + deltaY
    if (pan.value.x !== nextX || pan.value.y !== nextY) {
      hasPannedDuringGesture.value = true
      pan.value.x = nextX
      pan.value.y = nextY
    }
  }
}

const onPointerUp = () => {
  const movedNode = hasMovedNodeDuringDrag.value
  const movedPan = hasPannedDuringGesture.value
  dragging.value = null
  panning.value = null
  hasMovedNodeDuringDrag.value = false
  hasPannedDuringGesture.value = false
  if (movedNode || movedPan) {
    scheduleStateSave()
  }
}

const onBoardWheel = (event: WheelEvent) => {
  if (!boardRef.value) return

  event.preventDefault()

  const boardRect = boardRef.value.getBoundingClientRect()
  const cursorBoardX = event.clientX - boardRect.left
  const cursorBoardY = event.clientY - boardRect.top
  const worldX = (cursorBoardX - pan.value.x) / scale.value
  const worldY = (cursorBoardY - pan.value.y) / scale.value

  const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08
  const nextScale = clamp(scale.value * zoomFactor, MIN_SCALE, MAX_SCALE)

  pan.value.x = cursorBoardX - worldX * nextScale
  pan.value.y = cursorBoardY - worldY * nextScale
  scale.value = nextScale
  scheduleStateSave()
}

const zoomIn = () => {
  scale.value = clamp(scale.value * 1.12, MIN_SCALE, MAX_SCALE)
  scheduleStateSave()
}

const zoomOut = () => {
  scale.value = clamp(scale.value * 0.88, MIN_SCALE, MAX_SCALE)
  scheduleStateSave()
}

const resetView = () => {
  scale.value = DEFAULT_SCALE
  pan.value = { ...DEFAULT_PAN }
  void saveStateNow()
}

const cancelCableDraft = () => {
  cableDraft.value = null
  showConnectModal.value = false
  connectTargetNodeId.value = null
}

const beginCableFromPort = (nodeId: string, portId: string) => {
  const node = nodeMap.value.get(nodeId)
  if (!node) return

  const startX = node.x + NODE_WIDTH
  const startY = node.y + NODE_HEIGHT * 0.5

  cableDraft.value = {
    fromNodeId: nodeId,
    fromPortId: portId,
    cursorX: startX + 60,
    cursorY: startY,
  }

  showConnectModal.value = false
  connectTargetNodeId.value = null
}

const closeConnectModal = () => {
  showConnectModal.value = false
  connectTargetNodeId.value = null
}

const addCable = (fromNodeId: string, fromPortId: string, toNodeId: string, toPortId: string) => {
  cables.value.push({
    id: `cable-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    fromNodeId,
    fromPortId,
    toNodeId,
    toPortId,
  })
}

const connectDraftToTargetPort = (targetPortId: string) => {
  if (!cableDraft.value || !activeConnectTargetNode.value) return

  const sourceNodeId = cableDraft.value.fromNodeId
  const sourcePortId = cableDraft.value.fromPortId
  const targetNodeId = activeConnectTargetNode.value.id

  if (sourceNodeId === targetNodeId && sourcePortId === targetPortId) return

  const alreadyExists = cables.value.some(
    (cable) =>
      cable.fromNodeId === sourceNodeId &&
      cable.fromPortId === sourcePortId &&
      cable.toNodeId === targetNodeId &&
      cable.toPortId === targetPortId,
  )
  if (alreadyExists) {
    cancelCableDraft()
    return
  }

  addCable(sourceNodeId, sourcePortId, targetNodeId, targetPortId)

  cancelCableDraft()
  scheduleStateSave()
}

const resetCanvas = () => {
  nodes.value = buildDefaultNodesFromDevices()
  cables.value = []

  selectedNodeId.value = null
  pinnedTooltipNodeId.value = null
  hoverPreviewNodeId.value = null
  hoveredNodeId.value = null
  hoverProgress.value = 0
  hoveredCableId.value = null
  isHoveringCableTooltip.value = false
  clearCableHideTimer()
  isHoveringTooltip.value = false
  clearHoverTimers()
  clearHideHoverTimer()
  cancelCableDraft()
  void saveStateNow()
}

const deleteSelectedNode = () => {
  if (!selectedNodeId.value) return
  const nodeId = selectedNodeId.value

  nodes.value = nodes.value.filter((node) => node.id !== nodeId)
  cables.value = cables.value.filter((cable) => cable.fromNodeId !== nodeId && cable.toNodeId !== nodeId)
  dragging.value = null

  if (hoveredNodeId.value === nodeId || hoverPreviewNodeId.value === nodeId || pinnedTooltipNodeId.value === nodeId) {
    hoveredNodeId.value = null
    hoverPreviewNodeId.value = null
    pinnedTooltipNodeId.value = null
    hoverProgress.value = 0
    clearHoverTimers()
  }

  if (cableDraft.value?.fromNodeId === nodeId || connectTargetNodeId.value === nodeId) {
    cancelCableDraft()
  }

  selectedNodeId.value = null
  scheduleStateSave()
}

const closePinnedTooltip = () => {
  pinnedTooltipNodeId.value = null
  hoverPreviewNodeId.value = null
  hoveredNodeId.value = null
  hoverProgress.value = 0
  isHoveringTooltip.value = false
  clearHoverTimers()
  clearHideHoverTimer()
}

const openAddModal = () => {
  showAddModal.value = true
  catalogTab.value = 'devices'
  addSearchQuery.value = ''
}

const closeAddModal = () => {
  showAddModal.value = false
}

const getViewportCenterWorld = () => {
  if (!boardRef.value) {
    return { x: 220, y: 180 }
  }

  const boardRect = boardRef.value.getBoundingClientRect()
  return {
    x: (boardRect.width * 0.5 - pan.value.x) / scale.value,
    y: (boardRect.height * 0.5 - pan.value.y) / scale.value,
  }
}

const addNodeFromTemplate = (item: NodeTemplate) => {
  const center = getViewportCenterWorld()
  const maxX = WORLD_WIDTH - NODE_WIDTH - BOARD_PADDING
  const maxY = WORLD_HEIGHT - NODE_HEIGHT - BOARD_PADDING

  const x = snapToGrid(clamp(center.x - NODE_WIDTH * 0.5, BOARD_PADDING, maxX))
  const y = snapToGrid(clamp(center.y - NODE_HEIGHT * 0.5, BOARD_PADDING, maxY))
  const id = `${item.kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`

  nodes.value.push({
    id,
    title: item.title,
    subtitle: item.subtitle,
    kind: item.kind,
    details: [...item.details],
    ports: item.ports.map((port) => ({ ...port })),
    x,
    y,
  })

  selectedNodeId.value = id
  closeAddModal()
  scheduleStateSave()
}

const hydrateCanvas = async () => {
  persistence.setHydrating(true)
  try {
    const persisted = await persistence.load()

    if (persisted) {
      const hydrated = fromPersistedState(persisted)
      nodes.value = hydrated.nodes
      cables.value = hydrated.cables
      pan.value = { ...hydrated.pan }
      scale.value = hydrated.scale
    } else {
      nodes.value = buildDefaultNodesFromDevices()
      cables.value = []
      pan.value = { ...DEFAULT_PAN }
      scale.value = DEFAULT_SCALE
      if (persistence.canPersistToBackend.value) {
        await saveStateNow()
      }
    }
  } finally {
    persistence.setHydrating(false)
  }
}

const onCablePointerEnter = (cableId: string) => {
  clearCableHideTimer()
  hoveredCableId.value = cableId
}

const onCablePointerLeave = () => {
  clearCableHideTimer()
  cableHideTimer.value = setTimeout(() => {
    if (isHoveringCableTooltip.value) return
    hoveredCableId.value = null
  }, 120)
}

const onCableTooltipPointerEnter = () => {
  isHoveringCableTooltip.value = true
  clearCableHideTimer()
}

const onCableTooltipPointerLeave = () => {
  isHoveringCableTooltip.value = false
  hoveredCableId.value = null
}

const cutHoveredCable = () => {
  if (!hoveredCableId.value) return
  const cableId = hoveredCableId.value
  cables.value = cables.value.filter((cable) => cable.id !== cableId)
  hoveredCableId.value = null
  isHoveringCableTooltip.value = false
  clearCableHideTimer()
  scheduleStateSave()
}

const onWindowKeyDown = (event: KeyboardEvent) => {
  const activeTag = (document.activeElement as HTMLElement | null)?.tagName
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!hasSelectedNode.value) return
    event.preventDefault()
    deleteSelectedNode()
    return
  }

  if (event.key === 'Escape') {
    selectedNodeId.value = null
    if (showAddModal.value) {
      closeAddModal()
      return
    }
    if (showConnectModal.value || cableDraft.value) {
      cancelCableDraft()
      return
    }
    if (isTooltipPinned.value) {
      closePinnedTooltip()
    }
  }
}

window.addEventListener('pointermove', onPointerMove)
window.addEventListener('pointerup', onPointerUp)
window.addEventListener('keydown', onWindowKeyDown)

onMounted(() => {
  void hydrateCanvas()
})

onBeforeUnmount(() => {
  persistence.dispose()
  clearHoverTimers()
  clearHideHoverTimer()
  clearCableHideTimer()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('keydown', onWindowKeyDown)
})
</script>

<template>
  <section class="node-view">
    <header class="node-toolbar">
      <div class="node-toolbar-copy">
        <h2>Routing Canvas</h2>
        <p>Click a port in node popup to start cable routing, then click another node.</p>
      </div>
      <div class="persistence-status" :class="{ error: !!persistence.error.value, readonly: persistence.readOnly.value }">
        <span>{{ persistenceStatusLabel }}</span>
        <button v-if="persistence.error.value" class="ghost-btn" @click="persistence.retry">Retry</button>
        <button v-if="!persistence.readOnly.value" class="ghost-btn" @click="saveStateNow">Save now</button>
      </div>
      <div class="toolbar-actions">
        <div class="zoom-controls">
          <button class="ghost-btn" @click="zoomOut">-</button>
          <span class="zoom-label">{{ zoomPercent }}</span>
          <button class="ghost-btn" @click="zoomIn">+</button>
          <button class="ghost-btn" @click="resetView">Reset view</button>
        </div>
        <button class="ghost-btn add-btn" @click="openAddModal">+ Add node</button>
        <button class="ghost-btn danger-btn" :disabled="!hasSelectedNode" @click="deleteSelectedNode">
          Delete selected
        </button>
        <button class="ghost-btn" @click="resetCanvas">Reset canvas</button>
      </div>
    </header>

    <div v-if="cableDraft && draftSourceLabel" class="connect-banner">
      <span>Connecting from {{ draftSourceLabel }}. Click a destination node.</span>
      <button class="ghost-btn" @click="cancelCableDraft">Cancel</button>
    </div>

    <div
      ref="boardRef"
      class="board"
      :class="{ panning: !!panning, wiring: !!cableDraft }"
      @pointerdown="onBoardPointerDown"
      @wheel="onBoardWheel"
    >
      <div class="world" :style="worldStyle">
        <svg class="wires" :viewBox="`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`" aria-hidden="true">
          <g v-for="item in cableGeometry" :key="item.id">
            <path
              class="cable-path"
              :class="{ hovered: hoveredCableId === item.id }"
              :d="item.path"
              @pointerenter="onCablePointerEnter(item.id)"
              @pointerleave="onCablePointerLeave"
            />
          </g>

          <path v-if="draftCablePath" class="cable-path draft" :d="draftCablePath" />
        </svg>

        <article
          v-for="node in nodes"
          :key="node.id"
          class="node-card"
          :class="[
            getNodeClass(node.kind),
            { dragging: dragging?.nodeId === node.id, selected: selectedNodeId === node.id },
          ]"
          :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          @pointerenter="startHoverTracking(node.id)"
          @pointerleave="stopHoverTracking(node.id)"
          @pointerdown="onNodePointerDown($event, node)"
        >
          <header class="node-card-header">
            <span class="node-kind">{{ node.subtitle }}</span>
            <span class="node-id">{{ node.id }}</span>
          </header>
          <h3>{{ node.title }}</h3>
        </article>

        <aside
          v-if="activeTooltipNode"
          class="node-tooltip"
          :class="{ pinned: isTooltipPinned }"
          :style="tooltipStyle"
          @pointerenter="onTooltipPointerEnter"
          @pointerleave="onTooltipPointerLeave"
        >
          <header class="node-tooltip-header">
            <strong>{{ activeTooltipNode.title }}</strong>
            <button
              v-if="isTooltipPinned"
              class="tooltip-close"
              @click.stop="closePinnedTooltip"
            >
              x
            </button>
          </header>
          <p class="node-tooltip-subtitle">{{ activeTooltipNode.subtitle }}</p>

          <ul class="node-tooltip-list">
            <li v-for="detail in activeTooltipNode.details" :key="detail">{{ detail }}</li>
          </ul>

          <div class="ports-box">
            <p class="ports-title">Ports</p>
            <button
              v-for="port in activeTooltipNode.ports"
              :key="port.id"
              class="port-row"
              :class="{ connected: getPortConnections(activeTooltipNode.id, port.id).length > 0 }"
              @click.stop="beginCableFromPort(activeTooltipNode.id, port.id)"
            >
              <span class="port-name">{{ port.name }}</span>
              <span class="port-state">{{ getPortConnectionLabel(activeTooltipNode.id, port.id) }}</span>
            </button>
          </div>

          <div v-if="!isTooltipPinned" class="pin-progress" aria-hidden="true">
            <div class="pin-progress-fill" :style="tooltipProgressStyle"></div>
          </div>
          <p v-if="!isTooltipPinned" class="pin-hint">Hold hover to pin</p>
          <p v-else class="pin-hint">Pinned (moves out when cursor leaves popup)</p>
        </aside>

        <div
          v-if="hoveredCableLabel"
          class="cable-tooltip"
          :style="cableHoverTooltipStyle"
          @pointerenter="onCableTooltipPointerEnter"
          @pointerleave="onCableTooltipPointerLeave"
        >
          <span>{{ hoveredCableLabel }}</span>
          <button class="cut-cable-btn" @click.stop="cutHoveredCable">Cut cable</button>
        </div>
      </div>
    </div>

    <div v-if="showAddModal" class="modal-overlay" @click="closeAddModal">
      <div class="add-modal" @click.stop>
        <header class="add-modal-header">
          <h3>Add Node</h3>
          <button class="tooltip-close" @click="closeAddModal">x</button>
        </header>
        <div class="catalog-tabs">
          <button class="ghost-btn" :class="{ active: catalogTab === 'devices' }" @click="catalogTab = 'devices'">
            Devices
          </button>
          <button class="ghost-btn" :class="{ active: catalogTab === 'patchbay' }" @click="catalogTab = 'patchbay'">
            Patchbay Ports
          </button>
        </div>
        <input
          v-model="addSearchQuery"
          class="add-search"
          placeholder="Search nodes..."
        />
        <div class="catalog-list">
          <button
            v-for="item in filteredCatalog"
            :key="item.templateId"
            class="catalog-item"
            @click="addNodeFromTemplate(item)"
          >
            <span class="catalog-item-title">{{ item.title }}</span>
            <span class="catalog-item-subtitle">{{ item.subtitle }}</span>
          </button>
          <p v-if="filteredCatalog.length === 0" class="catalog-empty">No items found.</p>
        </div>
      </div>
    </div>

    <div v-if="showConnectModal && activeConnectTargetNode" class="modal-overlay" @click="closeConnectModal">
      <div class="connect-modal" @click.stop>
        <header class="add-modal-header">
          <h3>Connect to {{ activeConnectTargetNode.title }}</h3>
          <button class="tooltip-close" @click="closeConnectModal">x</button>
        </header>

        <p class="connect-help">Select destination port. Existing connections are preserved.</p>
        <div class="catalog-list">
          <button
            v-for="port in activeConnectTargetNode.ports"
            :key="port.id"
            class="catalog-item"
            @click="connectDraftToTargetPort(port.id)"
          >
            <span class="catalog-item-title">{{ port.name }}</span>
            <span class="catalog-item-subtitle">{{ getPortConnectionLabel(activeConnectTargetNode.id, port.id) }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.node-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--space-3);
}

.node-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  background: rgba(31, 28, 24, 0.9);
}

.node-toolbar-copy h2 {
  margin: 0;
  font-size: 1.2rem;
}

.node-toolbar-copy p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.persistence-status {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  border: 1px solid rgba(191, 170, 131, 0.4);
  border-radius: 10px;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.persistence-status.error {
  border-color: rgba(176, 75, 61, 0.6);
  color: #e9b2a8;
}

.persistence-status.readonly {
  border-color: rgba(115, 168, 212, 0.6);
  color: #c8def3;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.node-toolbar .ghost-btn {
  border: 1px solid rgba(191, 170, 131, 0.5);
  background: linear-gradient(180deg, rgba(52, 45, 35, 0.92), rgba(33, 29, 22, 0.92));
  color: #f0e5d2;
  border-radius: 10px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.18s ease, background 0.18s ease;
}

.node-toolbar .ghost-btn:hover {
  border-color: rgba(212, 154, 79, 0.8);
  background: linear-gradient(180deg, rgba(67, 56, 42, 0.94), rgba(40, 35, 26, 0.94));
  transform: translateY(-1px);
}

.node-toolbar .ghost-btn:active {
  transform: translateY(0);
}

.zoom-controls {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.zoom-label {
  min-width: 52px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.88rem;
  font-weight: 600;
}

.add-btn {
  border-color: rgba(106, 163, 111, 0.7);
  color: #bfe0be;
}

.danger-btn {
  border-color: rgba(176, 75, 61, 0.7);
  color: #e9b2a8;
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connect-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid rgba(212, 154, 79, 0.5);
  border-radius: var(--radius-2);
  background: rgba(212, 154, 79, 0.14);
}

.board {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  overflow: hidden;
  background: radial-gradient(circle at 0% 0%, rgba(106, 163, 111, 0.12), rgba(18, 16, 12, 0.96) 52%);
  cursor: default;
  touch-action: none;
}

.board.panning {
  cursor: grabbing;
}

.board.wiring {
  cursor: crosshair;
}

.world {
  position: absolute;
  inset: 0;
  width: 2200px;
  height: 1400px;
  transform-origin: 0 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 24px 24px, 24px 24px;
}

.wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.cable-path {
  stroke: rgba(212, 154, 79, 0.8);
  stroke-width: 2.4;
  fill: none;
  pointer-events: stroke;
  cursor: pointer;
}

.cable-path.hovered {
  stroke: #f3c17a;
  stroke-width: 3;
}

.cable-path.draft {
  stroke-dasharray: 7 5;
  opacity: 0.95;
}

.node-card {
  position: absolute;
  width: 188px;
  min-height: 88px;
  padding: 10px 12px;
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  background: rgba(31, 28, 24, 0.95);
  box-shadow: var(--shadow-1);
  cursor: move;
  user-select: none;
  touch-action: none;
  transition: border-color 0.18s ease, transform 0.18s ease;
}

.node-card.dragging {
  cursor: move;
  transform: scale(1.02);
  border-color: var(--accent);
}

.node-card.selected {
  border-color: #d49a4f;
  box-shadow: 0 0 0 2px rgba(212, 154, 79, 0.5), var(--shadow-1);
}

.node-card.device {
  border-left: 4px solid #6aa36f;
}

.node-card.port {
  border-left: 4px solid #d49a4f;
}

.node-card.patchbay {
  border-left: 4px solid #73a8d4;
}

.node-card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 4px;
}

.node-kind {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.node-id {
  font-size: 0.66rem;
  color: var(--text-muted);
}

.node-card h3 {
  margin: 0;
  font-size: 1rem;
  line-height: 1.2;
}

.node-tooltip {
  position: absolute;
  width: 280px;
  border: 1px solid rgba(212, 154, 79, 0.5);
  border-radius: var(--radius-3);
  background: rgba(16, 14, 11, 0.97);
  box-shadow: var(--shadow-2);
  padding: 10px;
  z-index: 10;
  cursor: default;
}

.node-tooltip.pinned {
  border-color: rgba(106, 163, 111, 0.7);
}

.node-tooltip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 4px;
}

.node-tooltip-subtitle {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.node-tooltip-list {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text-primary);
}

.ports-box {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: grid;
  gap: 6px;
}

.ports-title {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.port-row {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 9px;
  text-align: left;
  cursor: pointer;
}

.port-row:hover {
  border-color: rgba(212, 154, 79, 0.8);
}

.port-row.connected {
  border-color: rgba(106, 163, 111, 0.8);
}

.port-name {
  font-size: 0.85rem;
  font-weight: 600;
}

.port-state {
  font-size: 0.74rem;
  color: var(--text-secondary);
}

.pin-progress {
  margin-top: 8px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.pin-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #d49a4f, #6aa36f);
}

.pin-hint {
  margin: 6px 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.cable-tooltip {
  position: absolute;
  max-width: 320px;
  padding: 6px 8px;
  border: 1px solid rgba(212, 154, 79, 0.65);
  border-radius: var(--radius-2);
  background: rgba(16, 14, 11, 0.96);
  color: var(--text-primary);
  font-size: 0.78rem;
  z-index: 11;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cut-cable-btn {
  border: 1px solid rgba(176, 75, 61, 0.7);
  border-radius: var(--radius-2);
  background: rgba(176, 75, 61, 0.16);
  color: #f1c2bb;
  padding: 3px 8px;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
}

.tooltip-close {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  line-height: 1;
  cursor: pointer;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 7, 6, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.add-modal,
.connect-modal {
  width: min(560px, calc(100vw - 32px));
  max-height: min(560px, calc(100vh - 32px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  background: rgba(31, 28, 24, 0.98);
  box-shadow: var(--shadow-2);
  padding: var(--space-4);
}

.add-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.add-modal-header h3 {
  margin: 0;
}

.catalog-tabs {
  display: flex;
  gap: var(--space-2);
}

.catalog-tabs .ghost-btn.active {
  border-color: rgba(212, 154, 79, 0.8);
  color: #f3c17a;
}

.add-search {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: rgba(0, 0, 0, 0.2);
  color: var(--text-primary);
  padding: 10px 12px;
}

.catalog-list {
  overflow: auto;
  display: grid;
  gap: var(--space-2);
}

.catalog-item {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  text-align: left;
  cursor: pointer;
  display: grid;
  gap: 2px;
}

.catalog-item:hover {
  border-color: rgba(106, 163, 111, 0.8);
}

.catalog-item-title {
  font-weight: 600;
}

.catalog-item-subtitle {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.catalog-empty,
.connect-help {
  margin: 0;
  color: var(--text-muted);
}

@media (max-width: 960px) {
  .node-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-actions {
    justify-content: flex-start;
  }

  .zoom-controls {
    width: 100%;
    justify-content: space-between;
  }

  .node-tooltip {
    width: 250px;
  }
}
</style>
