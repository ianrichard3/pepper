import { reactive } from 'vue'
import { api, type ApiPort, type ApiDevice, type ApiPatchbayPoint } from '@/lib/api'
import { deviceImageCache } from '@/lib/deviceImageCache'
import { strings } from '@/ui/strings'
import type { GraphEdge } from '@/types/graph'

// Types
export interface PatchBayNode {
  id: number;
  name: string;
  description: string;
  type: string;
}

export interface DevicePort {
  id: string;
  label: string;
  type: 'Input' | 'Output' | 'Other';
  patchbayId: number | null;
}

export interface Device {
  id: number;
  name: string;
  type: string;
  category: string;
  ports: DevicePort[];
  imageUrl?: string | null;
  imageUpdatedAt?: string | null;
}

export interface DeviceCatalogSource {
  provider: string
  externalId: string
  sourceUrl?: string | null
  importedSnapshot?: Record<string, unknown>
}

interface PendingLink {
  portId: string;
  deviceId: number;
  deviceName: string;
  portLabel: string;
}

interface LinkFlow {
  returnTab: 'devices' | 'connections' | 'patchbay';
  returnPayload?: Record<string, unknown>;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface DevicePatchbayLink {
  connectionId: string
  portId: string
  patchbayId: number
}

type FloatingWindowKey = 'devices' | `device:${number}`

function toDevicePatchbayLink(edge: GraphEdge): DevicePatchbayLink | null {
  const a = edge.a
  const b = edge.b

  if (a.type === 'device_port' && b.type === 'patchbay_point') {
    const patchbayId = Number(b.id)
    if (!Number.isFinite(patchbayId)) return null
    return { connectionId: String(edge.id), portId: String(a.id), patchbayId }
  }
  if (a.type === 'patchbay_point' && b.type === 'device_port') {
    const patchbayId = Number(a.id)
    if (!Number.isFinite(patchbayId)) return null
    return { connectionId: String(edge.id), portId: String(b.id), patchbayId }
  }
  return null
}

// Convert API types (snake_case) to frontend types (camelCase)
function apiPortToDevicePort(apiPort: ApiPort): DevicePort {
  return {
    id: apiPort.id,
    label: apiPort.label,
    type: apiPort.type,
    patchbayId: apiPort.patchbay_id ?? null,
  }
}

function apiDeviceToDevice(apiDevice: ApiDevice): Device {
  return {
    id: apiDevice.id,
    name: apiDevice.name,
    type: apiDevice.type,
    category: apiDevice.category || inferCategoryFromType(apiDevice.type),
    ports: apiDevice.ports.map(apiPortToDevicePort),
    imageUrl: apiDevice.image_url,
    imageUpdatedAt: apiDevice.image_updated_at,
  }
}

function inferCategoryFromType(type: string | null | undefined): string {
  const token = String(type || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  const map: Record<string, string> = {
    mic: 'MIC',
    preamp: 'PREAMP',
    interface: 'INTERFACE',
    compressor: 'COMPRESSOR',
    patchpanel: 'PATCHPANEL',
    patch_panel: 'PATCHPANEL',
    patchbay: 'PATCHPANEL',
    panel: 'PATCHPANEL',
    instrument: 'INSTRUMENT',
    synth: 'INSTRUMENT',
    drum_machine: 'INSTRUMENT',
    monitor: 'MONITOR',
    headphone_amp: 'HEADPHONE_AMP',
    eq: 'EQ',
    mixer: 'MIXER',
    controller: 'CONTROLLER',
    effects: 'EFFECTS',
    amp: 'AMP',
    reamp: 'REAMP',
  }
  return map[token] || 'OTHER'
}

function apiPatchbayToNode(apiPoint: ApiPatchbayPoint): PatchBayNode {
  return {
    id: apiPoint.id,
    name: apiPoint.name,
    description: apiPoint.description,
    type: apiPoint.type,
  }
}

export const store = reactive({
  patchbayNodes: [] as PatchBayNode[],
  devices: [] as Device[],
  selectedDevice: null as Device | null,
  loading: false,
  error: null as string | null,
  hasLoadedInitialData: false, // Flag to prevent multiple loads
  authError: false, // Flag to prevent retry loops on auth errors
  orgRequired: false,
  backendAuthDegraded: false,
  loadPromise: null as Promise<void> | null,
  activeTab: 'devices', // 'patchbay' | 'devices' | 'connections'
  focusDeviceId: null as number | null,
  selectionMode: false,
  pendingLink: null as PendingLink | null, // The port waiting to be linked (from Device -> Patchbay flow)
  linkFlow: null as LinkFlow | null,
  lastLinkReturnPayload: null as LinkFlow['returnPayload'] | null,
  connections: [] as GraphEdge[],
  highlightedPatchIds: [] as number[], // For connection finder highlighting
  patchbayFocusId: null as number | null,
  connectionFinderState: {
    a: null as null | { deviceId: number; portId: string },
    b: null as null | { deviceId: number; portId: string },
  },
  toasts: [] as Toast[],
  windowMode: 'legacy' as 'legacy' | 'floating',
  floatingWindows: {
    devices: false,
    deviceDetails: [] as number[],
    zOrder: [] as FloatingWindowKey[],
  },
  maxDeviceDetailWindows: 3,
  
  // Load data from API
  async loadData() {
    // Prevenir múltiples cargas simultáneas o reintentos después de errores de auth
    if (this.loadPromise) {
      console.log('[Store] Load already in-flight, reusing promise')
      return this.loadPromise
    }
    
    if (this.authError) {
      console.log('[Store] Auth error detected, skipping loadData - user needs to re-authenticate')
      return
    }

    this.loading = true
    this.error = null
    this.orgRequired = false
    
    const loadPromise = (async () => {
      try {
        const state = await api.getState()
        this.patchbayNodes = state.patchbay_points.map(apiPatchbayToNode)
        this.devices = state.devices.map(apiDeviceToDevice)
        await this.refreshConnections()
        this.projectPatchbayLinksFromConnections()
        this.hasLoadedInitialData = true
        this.authError = false // Clear auth error on success
        this.backendAuthDegraded = false
        console.log('[Store] Data loaded successfully:', {
          patchbayNodes: this.patchbayNodes.length,
          devices: this.devices.length
        })
      } catch (err: any) {
        // Handle auth-specific errors
        if (err.message === 'AUTH_EXPIRED') {
          this.error = strings.toast.sessionExpired || 'Sesión expirada. Por favor, volvé a iniciar sesión.'
          this.authError = true // Prevent retry loop
          this.pushToast({ type: 'error', message: this.error })
          console.error('[Store] Auth expired - user will be signed out')
        } else if (err.message === 'ORG_REQUIRED') {
          this.error = 'Active organization required'
          this.orgRequired = true
          console.warn('[Store] Organization required - user needs to select/create org')
          // NO mostrar toast aquí - la UI ya mostrará la pantalla de org
        } else if (err.message === 'AUTH_FORBIDDEN') {
          this.error = strings.toast.noPermission
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'ENTITLEMENT_REQUIRED') {
          this.error = strings.toast.entitlementRequired
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'AUTH_SERVICE_UNAVAILABLE') {
          this.error = strings.toast.authServiceUnavailable
          this.backendAuthDegraded = true
          console.warn('[Store] Auth service unavailable - keeping session active')
        } else if (err.message === 'QUOTA_EXCEEDED') {
          this.error = strings.toast.quotaExceeded
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'LIMIT_REACHED') {
          this.error = strings.toast.limitReached
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'PAYMENT_REQUIRED') {
          this.error = strings.toast.paymentRequired
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'NETWORK_TIMEOUT') {
          this.error = strings.toast.networkTimeout
          this.pushToast({ type: 'error', message: this.error })
        } else if (err.message === 'UPSTREAM_UNAVAILABLE') {
          this.error = strings.toast.loadFailed
          this.pushToast({ type: 'error', message: this.error })
        } else {
          this.error = err.message || strings.toast.loadFailed
          this.pushToast({ type: 'error', message: this.error || strings.toast.loadFailed })
        }
        console.error('[Store] Error loading data:', err)
      } finally {
        this.loading = false
        this.loadPromise = null
      }
    })()

    this.loadPromise = loadPromise
    return loadPromise
  },

  retryInitialLoad() {
    this.backendAuthDegraded = false
    this.error = null
    return this.loadData()
  },

  handleApiError(err: any, fallbackMessage: string) {
    if (err?.message === 'AUTH_SERVICE_UNAVAILABLE') {
      this.backendAuthDegraded = true
      this.pushToast({ type: 'error', message: strings.toast.authServiceUnavailable })
      return true
    }
    if (err?.message === 'ENTITLEMENT_REQUIRED') {
      this.pushToast({ type: 'error', message: strings.toast.entitlementRequired })
      return true
    }
    if (err?.message === 'QUOTA_EXCEEDED') {
      this.pushToast({ type: 'error', message: strings.toast.quotaExceeded })
      return true
    }
    if (err?.message === 'LIMIT_REACHED') {
      this.pushToast({ type: 'error', message: strings.toast.limitReached })
      return true
    }
    if (err?.message === 'PAYMENT_REQUIRED') {
      this.pushToast({ type: 'error', message: strings.toast.paymentRequired })
      return true
    }
    if (err?.message === 'NETWORK_TIMEOUT') {
      this.pushToast({ type: 'error', message: strings.toast.networkTimeout })
      return true
    }
    if (err?.message === 'UPSTREAM_UNAVAILABLE') {
      this.pushToast({ type: 'error', message: fallbackMessage })
      return true
    }
    return false
  },

  async refreshConnections() {
    this.connections = await api.listConnections()
  },

  async syncConnectionsProjectionSafe() {
    try {
      await this.refreshConnections()
      this.projectPatchbayLinksFromConnections()
    } catch (err) {
      console.warn('[Store] Failed to sync connection projection', err)
    }
  },

  projectPatchbayLinksFromConnections() {
    for (const device of this.devices) {
      for (const port of device.ports) {
        port.patchbayId = null
      }
    }

    for (const edge of this.connections) {
      const link = toDevicePatchbayLink(edge)
      if (!link) continue
      for (const device of this.devices) {
        const port = device.ports.find((item) => item.id === link.portId)
        if (!port) continue
        port.patchbayId = link.patchbayId
        break
      }
    }
  },

  findPatchbayLinkByPortId(portId: string): DevicePatchbayLink | null {
    for (const edge of this.connections) {
      const link = toDevicePatchbayLink(edge)
      if (link?.portId === portId) return link
    }
    return null
  },

  findPatchbayLinkByPatchbayId(patchbayId: number): DevicePatchbayLink | null {
    for (const edge of this.connections) {
      const link = toDevicePatchbayLink(edge)
      if (link?.patchbayId === patchbayId) return link
    }
    return null
  },

  async replacePatchbayLink(portId: string, patchbayId: number): Promise<void> {
    const existingForPort = this.findPatchbayLinkByPortId(portId)
    const existingForPatchbay = this.findPatchbayLinkByPatchbayId(patchbayId)

    if (
      existingForPort &&
      existingForPatchbay &&
      existingForPort.connectionId === existingForPatchbay.connectionId &&
      existingForPort.portId === portId &&
      existingForPort.patchbayId === patchbayId
    ) {
      return
    }

    const idsToDelete = new Set<string>()
    if (existingForPort) idsToDelete.add(existingForPort.connectionId)
    if (existingForPatchbay) idsToDelete.add(existingForPatchbay.connectionId)

    for (const connectionId of idsToDelete) {
      await api.deleteConnection(connectionId)
    }

    await api.createConnection({
      a_type: 'device_port',
      a_id: portId,
      b_type: 'patchbay_point',
      b_id: String(patchbayId),
    })
  },
  
  // Reset state (llamar cuando el usuario se desloguea o cambia de org)
  resetState() {
    this.patchbayNodes = []
    this.devices = []
    this.selectedDevice = null
    this.loading = false
    this.error = null
    this.hasLoadedInitialData = false
    this.authError = false
    this.orgRequired = false
    this.backendAuthDegraded = false
    this.loadPromise = null
    this.activeTab = 'devices'
    this.focusDeviceId = null
    this.selectionMode = false
    this.pendingLink = null
    this.linkFlow = null
    this.lastLinkReturnPayload = null
    this.connections = []
    this.highlightedPatchIds = []
    this.patchbayFocusId = null
    this.connectionFinderState = {
      a: null,
      b: null,
    }
    this.windowMode = 'legacy'
    this.floatingWindows.devices = false
    this.floatingWindows.deviceDetails = []
    this.floatingWindows.zOrder = []
    deviceImageCache.clearAll()
    console.log('[Store] State reset')
  },
  
  // Actions
  setTab(tab: string) {
    this.activeTab = tab
  },

  setWindowMode(mode: 'legacy' | 'floating') {
    this.windowMode = mode
  },

  focusWindow(windowKey: FloatingWindowKey) {
    const index = this.floatingWindows.zOrder.indexOf(windowKey)
    if (index !== -1) {
      this.floatingWindows.zOrder.splice(index, 1)
    }
    this.floatingWindows.zOrder.push(windowKey)
  },

  openDevicesWindow() {
    this.windowMode = 'floating'
    this.floatingWindows.devices = true
    this.focusWindow('devices')
  },

  closeDevicesWindow() {
    this.floatingWindows.devices = false
    this.floatingWindows.deviceDetails = []
    this.floatingWindows.zOrder = this.floatingWindows.zOrder.filter((key) => key !== 'devices' && !key.startsWith('device:'))
  },

  isDeviceDetailWindowOpen(deviceId: number) {
    return this.floatingWindows.deviceDetails.includes(deviceId)
  },

  openDeviceDetailWindow(deviceId: number) {
    if (!this.floatingWindows.devices) {
      this.openDevicesWindow()
    }

    const windowKey: FloatingWindowKey = `device:${deviceId}`
    if (this.isDeviceDetailWindowOpen(deviceId)) {
      this.focusWindow(windowKey)
      return
    }

    if (this.floatingWindows.deviceDetails.length >= this.maxDeviceDetailWindows) {
      const oldestDetailWindow = this.floatingWindows.zOrder.find((key) => key.startsWith('device:'))
      if (oldestDetailWindow) {
        const oldestId = Number(oldestDetailWindow.split(':')[1])
        if (Number.isFinite(oldestId)) {
          this.closeDeviceDetailWindow(oldestId)
        }
      } else {
        this.floatingWindows.deviceDetails.shift()
      }
    }

    this.floatingWindows.deviceDetails.push(deviceId)
    this.focusWindow(windowKey)
  },

  closeDeviceDetailWindow(deviceId: number) {
    this.floatingWindows.deviceDetails = this.floatingWindows.deviceDetails.filter(id => id !== deviceId)
    const windowKey: FloatingWindowKey = `device:${deviceId}`
    this.floatingWindows.zOrder = this.floatingWindows.zOrder.filter(key => key !== windowKey)
  },

  requestDeviceFocus(deviceId: number) {
    this.focusDeviceId = deviceId
  },

  clearDeviceFocus() {
    this.focusDeviceId = null
  },
  
  // Flow: Device -> Patchbay (Select a slot for a specific port)
  startLinkingPort(payload: PendingLink, options?: Partial<LinkFlow>) {
    this.pendingLink = payload
    this.selectionMode = true
    this.activeTab = 'patchbay'
    this.linkFlow = {
      returnTab: options?.returnTab ?? 'devices',
      returnPayload: options?.returnPayload,
    }
  },
  
  async completeLink(patchbayId: number) {
    if (!this.pendingLink) return

    try {
      await this.refreshConnections()
      await this.replacePatchbayLink(this.pendingLink.portId, patchbayId)
      await this.syncConnectionsProjectionSafe()
      this.pushToast({
        type: 'success',
        message: strings.toast.linkedSuccess(
          this.pendingLink.deviceName,
          this.pendingLink.portLabel,
          patchbayId
        ),
      })
    } catch (err: any) {
      if (this.handleApiError(err, strings.toast.linkFailed)) {
        console.error('Error linking port:', err)
        return
      }
      console.error('Error linking port:', err)
      this.pushToast({ type: 'error', message: err.message || strings.toast.linkFailed })
      return
    }
    
    this.requestDeviceFocus(this.pendingLink.deviceId)
    this.activeTab = this.linkFlow?.returnTab ?? 'devices'
    this.lastLinkReturnPayload = this.linkFlow?.returnPayload ?? null
    this.cancelLinking()
  },
  
  cancelLinking() {
    this.pendingLink = null
    this.selectionMode = false
    this.linkFlow = null
  },
  
  // Flow: Patchbay -> Device (Unlink or Link via Search)
  async unlinkPort(deviceId: number, portId: string) {
    void deviceId
    try {
      await this.refreshConnections()
      const existing = this.findPatchbayLinkByPortId(portId)
      if (existing) {
        await api.deleteConnection(existing.connectionId)
      }
      await this.refreshConnections()
      this.projectPatchbayLinksFromConnections()
    } catch (err: any) {
      if (this.handleApiError(err, strings.toast.unlinkFailed)) {
        console.error('Error unlinking port:', err)
        return
      }
      console.error('Error unlinking port:', err)
      this.pushToast({ type: 'error', message: err.message || strings.toast.unlinkFailed })
    }
  },

  // Link a specific port to a patchbay ID (used from the Patchbay search modal)
  async linkPatchbayToDevice(patchbayId: number, deviceId: number, portId: string) {
    void deviceId
    try {
      await this.refreshConnections()
      await this.replacePatchbayLink(portId, patchbayId)
      await this.refreshConnections()
      this.projectPatchbayLinksFromConnections()
      return true
    } catch (err: any) {
      if (this.handleApiError(err, strings.toast.linkFailed)) {
        console.error('Error linking patchbay to device:', err)
        return false
      }
      console.error('Error linking patchbay to device:', err)
      this.pushToast({ type: 'error', message: err.message || strings.toast.linkFailed })
      return false
    }
  },
  
  async addDevice(device: {
    name: string
    type: string
    category: string
    ports: DevicePort[]
    catalogSource?: DeviceCatalogSource | null
  }): Promise<Device> {
    try {
      const payload: Parameters<typeof api.createDevice>[0] = {
        name: device.name,
        type: device.type,
        category: device.category,
        ports: device.ports.map(p => ({
          label: p.label,
          type: p.type,
          patchbay_id: p.patchbayId,
        })),
      }
      if (device.catalogSource) {
        payload.catalog_source = {
          provider: device.catalogSource.provider,
          external_id: device.catalogSource.externalId,
          source_url: device.catalogSource.sourceUrl ?? null,
          imported_snapshot: device.catalogSource.importedSnapshot || {},
        }
      }

      const apiDevice = await api.createDevice(payload)
      
      const newDevice = apiDeviceToDevice(apiDevice)
      this.devices.push(newDevice)
      await this.syncConnectionsProjectionSafe()
      return newDevice
    } catch (err: any) {
      this.handleApiError(err, strings.toast.deviceSaveFailed)
      console.error('Error adding device:', err)
      throw err
    }
  },

  async updateDevice(id: number, payload: { name: string; type: string; category: string; ports: DevicePort[] }): Promise<Device> {
    try {
      const apiDevice = await api.updateDevice(id, {
        name: payload.name,
        type: payload.type,
        category: payload.category,
        ports: payload.ports.map(p => ({
          id: p.id || undefined,
          label: p.label,
          type: p.type,
          patchbay_id: p.patchbayId ?? null,
        })),
      })

      const updatedDevice = apiDeviceToDevice(apiDevice)
      const index = this.devices.findIndex(d => d.id === id)
      if (index !== -1) {
        this.devices[index] = updatedDevice
      }
      await this.syncConnectionsProjectionSafe()
      return updatedDevice
    } catch (err: any) {
      this.handleApiError(err, strings.toast.deviceSaveFailed)
      console.error('Error updating device:', err)
      throw err
    }
  },
  
  async deleteDevice(id: number) {
    try {
      await api.deleteDevice(id)
      
      const index = this.devices.findIndex(d => d.id === id)
      if (index !== -1) this.devices.splice(index, 1)
      
      // Clear selection if deleted device was selected
      if (this.selectedDevice?.id === id) {
        this.selectedDevice = null
      }
      deviceImageCache.invalidateDevice(id)
      await this.syncConnectionsProjectionSafe()
    } catch (err: any) {
      this.handleApiError(err, strings.toast.deviceDeleteFailed)
      console.error('Error deleting device:', err)
      throw err
    }
  },

  async uploadDeviceImage(deviceId: number, image: File): Promise<Device> {
    try {
      const apiDevice = await api.uploadDeviceImage(deviceId, image)
      const updatedDevice = apiDeviceToDevice(apiDevice)
      
      // Replace device in store
      const index = this.devices.findIndex(d => d.id === deviceId)
      if (index !== -1) {
        this.devices[index] = updatedDevice
      }
      
      // Update selectedDevice reference if it's the same device
      if (this.selectedDevice?.id === deviceId) {
        this.selectedDevice = updatedDevice
      }

      deviceImageCache.invalidateDevice(deviceId)
      await this.syncConnectionsProjectionSafe()
      
      return updatedDevice
    } catch (err: any) {
      this.handleApiError(err, strings.toast.deviceSaveFailed)
      console.error('Error uploading device image:', err)
      throw err
    }
  },

  setConnectionFinderSelection(side: 'a' | 'b', deviceId: number, portId: string) {
    this.connectionFinderState[side] = { deviceId, portId }
  },

  clearConnectionFinderSelection(side: 'a' | 'b') {
    this.connectionFinderState[side] = null
  },

  swapConnectionFinderSelections() {
    const temp = this.connectionFinderState.a
    this.connectionFinderState.a = this.connectionFinderState.b
    this.connectionFinderState.b = temp
  },

  clearLinkReturnPayload() {
    this.lastLinkReturnPayload = null
  },

  pushToast(payload: Omit<Toast, 'id'>) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const toast: Toast = { id, ...payload }
    this.toasts.push(toast)
    window.setTimeout(() => this.dismissToast(id), 4200)
  },

  dismissToast(id: string) {
    const index = this.toasts.findIndex(toast => toast.id === id)
    if (index !== -1) this.toasts.splice(index, 1)
  },
  
  // Helpers
  getDeviceByPatchbayId(patchbayId: number) {
    for (const device of this.devices) {
      const port = device.ports.find(p => p.patchbayId === patchbayId)
      if (port) return { device, port }
    }
    return null
  }
})
