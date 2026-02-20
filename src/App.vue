<script setup lang="ts">
import { computed, watchEffect, watch, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SignedIn, SignedOut, UserButton, OrganizationSwitcher, useAuth, useClerk } from '@clerk/vue'
import { registerTokenGetter } from './lib/authToken'
import { useAuthz } from './lib/authz'
import { useEntitlements } from './lib/useEntitlements'
import { quotaStore } from './stores/quota'
import { windowManager, type ManagedWindow, type ToolWindowKind } from './stores/windowManager'
import PatchBayGrid from './components/PatchBayGrid.vue'
import DevicesManager from './components/DevicesManager.vue'
import RoutingCanvas from './components/RoutingCanvas.vue'
import AuthScreen from './components/AuthScreen.vue'
import AuthDiagnosticsPanel from './components/AuthDiagnosticsPanel.vue'
import AccessDisabledScreen from './components/AccessDisabledScreen.vue'
import AdminAccessPanel from './components/admin/AdminAccessPanel.vue'
import DataPortability from './components/settings/DataPortability.vue'
import DeviceDetailWindow from './components/DeviceDetailWindow.vue'
import DevicesAddEditWindow from './components/DevicesAddEditWindow.vue'
import DevicesDeleteConfirmWindow from './components/DevicesDeleteConfirmWindow.vue'
import GraphAddNodeWindow from './components/GraphAddNodeWindow.vue'
import GraphConnectWindow from './components/GraphConnectWindow.vue'
import GraphIntentMatchesWindow from './components/GraphIntentMatchesWindow.vue'
import PatchbayPointDetailWindow from './components/PatchbayPointDetailWindow.vue'
import PatchbayLinkSearchWindow from './components/PatchbayLinkSearchWindow.vue'
import PatchbayOverwriteConfirmWindow from './components/PatchbayOverwriteConfirmWindow.vue'
import PortabilityReplaceConfirmWindow from './components/PortabilityReplaceConfirmWindow.vue'
import ToastHost from './ui/ToastHost.vue'
import FloatingWindow from './ui/FloatingWindow.vue'
import { strings } from './ui/strings'
import { store } from './store'
import logoUrl from './assets/el-riche-mark.svg'
import { isAdminRole } from './lib/adminAuth'
import type { ApiDeviceMatchItem, ApiIntent } from './lib/api'

const t = strings
const SIDEBAR_STORAGE_PREFIX = 'pepper.sidebar.v1'
const route = useRoute()
const router = useRouter()
const { isLoaded, isSignedIn, getToken, orgId } = useAuth()
const clerk = useClerk()
const {
  authContext,
  authContextLoaded,
  authContextLoading,
  authContextError,
  role,
  loadAuthContext,
  resetAuthContext,
} = useAuthz()
const { hasAppAccess, canExport } = useEntitlements()
const isDev = import.meta.env.DEV
const showAuthDiagnostics = isDev && new URLSearchParams(window.location.search).has('authdiag')
const isDesktop = ref(window.innerWidth >= 1024)
const isRailCollapsed = ref(false)
const canvasStageRef = ref<HTMLElement | null>(null)
let stageObserver: ResizeObserver | null = null
let observedStageElement: HTMLElement | null = null

const orgLoaded = computed(() => !isSignedIn.value || isLoaded.value)
const needsOrganization = computed(() => isSignedIn.value && (!orgId.value || store.orgRequired))
const isAdminRoute = computed(() => route.path === '/admin/access')
const isPortabilityRoute = computed(() => route.path === '/settings/portability')
const canAccessAdmin = computed(() => isAdminRole(role.value))
const desktopCanvasEnabled = computed(() => isDesktop.value)

const statusLabel = computed(() => {
  if (store.loading) return t.app.syncing
  if (store.error) return t.app.syncIssue
  return t.app.synced
})

const showAuthContextBanner = computed(() => {
  return authContextError.value && authContextError.value !== 'AUTH_CONTEXT_UNSUPPORTED'
})

const toolDefinitions = computed(() => {
  const base: Array<{ id: ToolWindowKind; label: string; icon: string; route: string | null; hidden?: boolean }> = [
    { id: 'patchbay', label: t.nav.patchbay, icon: 'PB', route: null },
    { id: 'devices', label: t.nav.devices, icon: 'DV', route: null },
    { id: 'graph', label: t.nav.nodeView, icon: 'RT', route: null },
    { id: 'portability', label: t.nav.portability, icon: 'EX', route: '/settings/portability' },
    { id: 'admin', label: 'Admin', icon: 'AD', route: '/admin/access', hidden: !canAccessAdmin.value },
  ]
  return base.filter((tool) => !tool.hidden)
})

const desktopWindows = computed(() => {
  return [...windowManager.windows].sort((a, b) => a.zIndex - b.zIndex)
})

const dockWindows = computed(() => {
  return [...windowManager.windows].sort((a, b) => b.updatedAt - a.updatedAt)
})

const activeToolKinds = computed(() => {
  const set = new Set<ToolWindowKind>()
  for (const window of windowManager.windows) {
    if (window.kind === 'patchbay' || window.kind === 'devices' || window.kind === 'graph' || window.kind === 'portability' || window.kind === 'admin') {
      set.add(window.kind)
    }
  }
  return set
})

const sidebarStorageKey = computed(() => `${SIDEBAR_STORAGE_PREFIX}:${orgId.value || 'no-org'}:desktop`)

const updateViewport = () => {
  isDesktop.value = window.innerWidth >= 1024
  updateCanvasViewport()
}

const updateCanvasViewport = () => {
  if (!desktopCanvasEnabled.value) return
  const stage = canvasStageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  windowManager.setViewport(Math.round(rect.width), Math.round(rect.height))
}

const syncStageObserver = () => {
  if (typeof ResizeObserver === 'undefined') return
  if (!stageObserver) {
    stageObserver = new ResizeObserver(() => updateCanvasViewport())
  }
  if (observedStageElement && observedStageElement !== canvasStageRef.value) {
    stageObserver.unobserve(observedStageElement)
    observedStageElement = null
  }
  if (canvasStageRef.value && observedStageElement !== canvasStageRef.value) {
    stageObserver.observe(canvasStageRef.value)
    observedStageElement = canvasStageRef.value
  }
}

const syncScope = () => {
  if (!desktopCanvasEnabled.value) return
  const scope = `${orgId.value || 'no-org'}:desktop`
  windowManager.setScope(scope)
  updateCanvasViewport()
}

const loadSidebarPreference = () => {
  if (!desktopCanvasEnabled.value) {
    isRailCollapsed.value = false
    return
  }
  try {
    isRailCollapsed.value = localStorage.getItem(sidebarStorageKey.value) === '1'
  } catch {
    isRailCollapsed.value = false
  }
}

const persistSidebarPreference = () => {
  if (!desktopCanvasEnabled.value) return
  try {
    localStorage.setItem(sidebarStorageKey.value, isRailCollapsed.value ? '1' : '0')
  } catch {
    // ignore storage errors
  }
}

const toggleRailCollapsed = () => {
  isRailCollapsed.value = !isRailCollapsed.value
  persistSidebarPreference()
}

watchEffect(() => {
  if (isLoaded.value && isSignedIn.value && getToken) {
    const tokenFn = getToken.value
    if (tokenFn) registerTokenGetter(tokenFn)
  }
})

watch([isSignedIn, orgId], ([newSignedIn, newOrgId], [oldSignedIn, oldOrgId]) => {
  if (oldSignedIn && !newSignedIn) {
    store.resetState()
    resetAuthContext()
    quotaStore.reset()
    windowManager.clearAll()
  }

  if (newSignedIn && oldOrgId && newOrgId && oldOrgId !== newOrgId) {
    store.resetState()
    resetAuthContext()
    quotaStore.reset()
    windowManager.clearAll()
  }

  if (newSignedIn && newOrgId && (!oldSignedIn || oldOrgId !== newOrgId)) {
    void loadAuthContext({ force: true }).catch(() => {})
  }
})

watchEffect(() => {
  if (!isLoaded.value || !orgLoaded.value) return
  const userSignedIn = isSignedIn.value
  const hasOrg = !!orgId.value

  if (userSignedIn && hasOrg) {
    const authReady =
      authContextLoaded.value ||
      authContextError.value === 'AUTH_CONTEXT_UNSUPPORTED' ||
      Boolean(authContextError.value)
    if (authReady && hasAppAccess.value && !store.hasLoadedInitialData && !store.loading && !store.authError) {
      store.loadData()
    }
    void loadAuthContext().catch(() => {})
  }
})

watch(() => authContext.value, (context) => {
  quotaStore.updateFromAuthContext(context)
}, { immediate: true })

watchEffect(() => {
  if (store.authError && store.error?.includes('expirada')) {
    setTimeout(() => {
      clerk.value?.signOut()
    }, 2000)
  }
})

watch([orgId, isDesktop], () => {
  syncScope()
  loadSidebarPreference()
}, { immediate: true })

watch([desktopCanvasEnabled, () => canvasStageRef.value], async ([desktopEnabled]) => {
  if (!desktopEnabled) {
    if (stageObserver && observedStageElement) {
      stageObserver.unobserve(observedStageElement)
      observedStageElement = null
    }
    return
  }
  await nextTick()
  syncStageObserver()
  updateCanvasViewport()
}, { immediate: true })

watch(canAccessAdmin, (allowed) => {
  if (allowed) return
  windowManager.closeTool('admin')
  if (route.path === '/admin/access') {
    void router.push('/')
  }
})

watch(() => route.path, (path) => {
  if (!desktopCanvasEnabled.value) return
  if (path === '/settings/portability') {
    windowManager.openTool('portability', t.nav.portability)
    return
  }
  if (path === '/admin/access' && canAccessAdmin.value) {
    windowManager.openTool('admin', 'Admin')
    return
  }
}, { immediate: true })

watch(() => store.focusDeviceId, (deviceId) => {
  if (!deviceId || !desktopCanvasEnabled.value) return
  const device = store.devices.find((item) => item.id === deviceId)
  const parent = windowManager.getToolWindow('devices')
  windowManager.openDeviceDetail(deviceId, device?.name || `Device #${deviceId}`, parent?.id || null)
  store.clearDeviceFocus()
})

watch(() => store.activeTab, (tab) => {
  if (!desktopCanvasEnabled.value) return
  if (tab === 'patchbay') windowManager.openTool('patchbay', t.nav.patchbay)
  if (tab === 'devices') windowManager.openTool('devices', t.nav.devices)
  if (tab === 'nodeView') windowManager.openTool('graph', t.nav.nodeView)
})

const openTool = (kind: ToolWindowKind) => {
  if (!desktopCanvasEnabled.value) {
    if (kind === 'portability') {
      void router.push('/settings/portability')
      return
    }
    if (kind === 'admin') {
      if (!canAccessAdmin.value) return
      void router.push('/admin/access')
      return
    }
    if (kind === 'patchbay') store.setTab('patchbay')
    if (kind === 'devices') store.setTab('devices')
    if (kind === 'graph') store.setTab('nodeView')
    if (route.path !== '/') void router.push('/')
    return
  }

  const def = toolDefinitions.value.find((item) => item.id === kind)
  if (!def) return
  windowManager.openTool(kind, def.label)

  if (def.route) {
    if (route.path !== def.route) void router.push(def.route)
  } else if (route.path !== '/') {
    void router.push('/')
  }
}

const openDeviceDetailWindow = (deviceId: number) => {
  const device = store.devices.find((item) => item.id === deviceId)
  const parent = windowManager.getToolWindow('devices')
  windowManager.openDeviceDetail(deviceId, device?.name || `Device #${deviceId}`, parent?.id || null)
}

const closeWindow = (window: ManagedWindow) => {
  windowManager.closeWindow(window.id)
  if (window.kind === 'portability' && route.path === '/settings/portability') {
    void router.push('/')
  }
  if (window.kind === 'admin' && route.path === '/admin/access') {
    void router.push('/')
  }
}

const handleDockClick = (window: ManagedWindow) => {
  if (window.state === 'minimized') {
    windowManager.restoreWindow(window.id)
  }
  windowManager.focusWindow(window.id)
}

const toggleMinimize = (window: ManagedWindow) => {
  if (window.state === 'minimized') {
    windowManager.restoreWindow(window.id)
    windowManager.focusWindow(window.id)
    return
  }
  windowManager.minimizeWindow(window.id)
}

const toggleMaximize = (window: ManagedWindow) => {
  windowManager.maximizeWindow(window.id)
}

const windowComponentKey = (window: ManagedWindow) => {
  if (window.kind === 'patchbay') return 'patchbay'
  if (window.kind === 'devices') return 'devices'
  if (window.kind === 'graph') return 'graph'
  if (window.kind === 'portability') return 'portability'
  if (window.kind === 'admin') return 'admin'
  if (window.kind === 'device-detail') return 'device-detail'
  if (window.kind === 'patchbay-point-detail') return 'patchbay-point-detail'
  if (window.kind === 'patchbay-link-search') return 'patchbay-link-search'
  if (window.kind === 'patchbay-overwrite-confirm') return 'patchbay-overwrite-confirm'
  if (window.kind === 'devices-add-edit') return 'devices-add-edit'
  if (window.kind === 'devices-delete-confirm') return 'devices-delete-confirm'
  if (window.kind === 'canvas-add-item') return 'canvas-add-item'
  if (window.kind === 'canvas-select-port') return 'canvas-select-port'
  if (window.kind === 'canvas-intent-matches') return 'canvas-intent-matches'
  if (window.kind === 'portability-replace-confirm') return 'portability-replace-confirm'
  return 'unknown'
}

const windowVariant = (window: ManagedWindow): 'tool' | 'utility' | 'confirm' => {
  if (
    window.kind === 'patchbay' ||
    window.kind === 'devices' ||
    window.kind === 'graph' ||
    window.kind === 'portability' ||
    window.kind === 'admin'
  ) {
    return 'tool'
  }
  if (
    window.kind === 'devices-delete-confirm' ||
    window.kind === 'patchbay-overwrite-confirm' ||
    window.kind === 'portability-replace-confirm'
  ) {
    return 'confirm'
  }
  return 'utility'
}

const payloadFunction = <T extends (...args: any[]) => unknown>(window: ManagedWindow, key: string): T | undefined => {
  const candidate = window.payload[key]
  if (typeof candidate !== 'function') return undefined
  return candidate as T
}

const graphConnectPorts = (window: ManagedWindow) => {
  const source = window.payload.ports
  if (!Array.isArray(source)) return [] as Array<{ id: string; name: string; statusLabel: string; occupied: boolean }>
  return source
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
      return {
        id: row.id,
        name: row.name,
        statusLabel: typeof row.statusLabel === 'string' ? row.statusLabel : '',
        occupied: Boolean(row.occupied),
      }
    })
    .filter((item): item is { id: string; name: string; statusLabel: string; occupied: boolean } => item !== null)
}

const graphSelectTemplateHandler = (window: ManagedWindow) => {
  return payloadFunction<(template: unknown) => void>(window, 'onSelectTemplate')
}

const graphSelectPortHandler = (window: ManagedWindow) => {
  return payloadFunction<(portId: string) => void>(window, 'onSelectPort')
}

const graphAddMatchedDevicesHandler = (window: ManagedWindow) => {
  return payloadFunction<(deviceIds: number[]) => void>(window, 'onAddSelected')
}

const graphIntentPayload = (window: ManagedWindow): {
  intent: ApiIntent
  queryText: string
  matches: ApiDeviceMatchItem[]
  topCandidates: {
    source_device_ids: number[]
    destination_device_ids: number[]
    processor_device_ids_by_tag: Record<string, number[]>
  }
} | null => {
  const intent = window.payload.intent
  if (!intent || typeof intent !== 'object') return null
  const queryText = typeof window.payload.queryText === 'string' ? window.payload.queryText : ''
  const matches = Array.isArray(window.payload.matches) ? window.payload.matches : []
  const topCandidates = window.payload.topCandidates
  if (!topCandidates || typeof topCandidates !== 'object') return null
  return {
    intent: intent as ApiIntent,
    queryText,
    matches: matches as ApiDeviceMatchItem[],
    topCandidates: topCandidates as {
      source_device_ids: number[]
      destination_device_ids: number[]
      processor_device_ids_by_tag: Record<string, number[]>
    },
  }
}

const graphIntentWindowIntent = (window: ManagedWindow): ApiIntent | null => graphIntentPayload(window)?.intent || null
const graphIntentWindowQueryText = (window: ManagedWindow) => graphIntentPayload(window)?.queryText || ''
const graphIntentWindowMatches = (window: ManagedWindow): ApiDeviceMatchItem[] => graphIntentPayload(window)?.matches || []
const graphIntentWindowTopCandidates = (window: ManagedWindow) => {
  const payload = graphIntentPayload(window)
  if (!payload) {
    return { source_device_ids: [], destination_device_ids: [], processor_device_ids_by_tag: {} }
  }
  return payload.topCandidates
}

const portabilityConfirmHandler = (window: ManagedWindow) => {
  return payloadFunction<(input: string) => void>(window, 'onConfirm')
}

const notifyComingSoon = () => {
  store.pushToast({ type: 'info', message: t.app.comingSoon })
}

onMounted(() => {
  window.addEventListener('resize', updateViewport)
  syncStageObserver()
  syncScope()
  void nextTick(() => {
    syncStageObserver()
    updateCanvasViewport()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  if (stageObserver) stageObserver.disconnect()
  observedStageElement = null
})
</script>

<template>
  <div v-if="!isLoaded || !orgLoaded" class="auth-loading">
    <div class="loading-card">Cargando...</div>
  </div>

  <SignedOut>
    <AuthScreen />
  </SignedOut>

  <SignedIn>
    <div v-if="needsOrganization" class="org-required-screen">
      <div class="org-required-container">
        <div class="org-required-header">
          <img class="org-logo" :src="logoUrl" alt="" />
          <h1 class="org-title">Workspace Requerido</h1>
          <p class="org-subtitle">
            Para continuar, necesitás seleccionar o crear un workspace (organización)
          </p>
        </div>

        <div class="org-switcher-wrapper">
          <OrganizationSwitcher
            :appearance="{
              elements: {
                rootBox: 'org-switcher-root',
                organizationSwitcherTrigger: 'org-switcher-trigger'
              }
            }"
          />
        </div>
      </div>
    </div>

    <div v-else class="app-container">
      <div v-if="showAuthContextBanner" class="auth-context-banner">
        <strong>{{ t.app.syncIssue }}</strong>
        <span>{{ authContextError }}</span>
      </div>
      <div v-if="store.backendAuthDegraded" class="auth-degraded-banner">
        <div class="auth-degraded-text">
          <strong>{{ t.app.authDegradedTitle }}</strong>
          <span>{{ t.app.authDegradedMessage }}</span>
        </div>
        <button class="ghost-btn" @click="store.retryInitialLoad()">{{ t.app.retry }}</button>
      </div>
      <div v-if="authContextLoading" class="loading-overlay">
        <div class="loading-card">Loading access...</div>
      </div>
      <AccessDisabledScreen v-else-if="!hasAppAccess && !isAdminRoute && !isPortabilityRoute" />
      <div v-else class="app-shell">
        <div v-if="store.loading" class="loading-overlay">
          <div class="loading-card">{{ t.app.loadingData }}</div>
        </div>

        <div v-if="desktopCanvasEnabled" class="workspace-shell" :class="{ collapsed: isRailCollapsed }">
          <aside class="tool-rail" :class="{ collapsed: isRailCollapsed }">
            <div class="rail-brand">
              <img class="rail-logo" :src="logoUrl" alt="" />
              <span v-if="!isRailCollapsed">Pepper</span>
              <button
                class="rail-toggle"
                type="button"
                :title="isRailCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
                @click="toggleRailCollapsed"
              >
                {{ isRailCollapsed ? '>' : '<' }}
              </button>
            </div>

            <nav class="tool-list">
              <button
                v-for="tool in toolDefinitions"
                :key="tool.id"
                class="tool-btn"
                :class="{ active: activeToolKinds.has(tool.id) }"
                :title="tool.label"
                @click="openTool(tool.id)"
              >
                <span class="tool-icon">{{ tool.icon }}</span>
                <span v-if="!isRailCollapsed" class="tool-label">{{ tool.label }}</span>
              </button>
            </nav>

            <div class="rail-footer">
              <div class="status-chip" :class="{ loading: store.loading, error: store.error }">
                <span class="status-dot"></span>
                <span v-if="!isRailCollapsed">{{ statusLabel }}</span>
              </div>
              <button class="ghost-btn" :title="t.app.export" :disabled="!canExport" @click="openTool('portability')">
                <span>{{ isRailCollapsed ? 'EX' : t.app.export }}</span>
              </button>
              <button class="ghost-btn" :title="t.app.help" @click="notifyComingSoon">
                <span>{{ isRailCollapsed ? '?' : t.app.help }}</span>
              </button>
              <div class="rail-user"><UserButton /></div>
            </div>
          </aside>

          <section class="canvas-shell">
            <div ref="canvasStageRef" class="canvas-stage no-select-canvas">
              <FloatingWindow
                v-for="window in desktopWindows"
                :key="window.id"
                :title="window.title"
                :show-title="false"
                :rect="window.rect"
                :state="window.state"
                :z-index="window.zIndex"
                :variant="windowVariant(window)"
                @focus="windowManager.focusWindow(window.id)"
                @close="closeWindow(window)"
                @move="({ x, y }) => windowManager.moveWindow(window.id, x, y)"
                @resize="(rect) => windowManager.resizeWindow(window.id, rect)"
                @toggle-minimize="toggleMinimize(window)"
                @toggle-maximize="toggleMaximize(window)"
              >
                <PatchBayGrid v-if="windowComponentKey(window) === 'patchbay'" floating-mode />
                <DevicesManager
                  v-else-if="windowComponentKey(window) === 'devices'"
                  floating-mode
                  :modal-parent-window-id="window.id"
                  :on-open-detail-window="openDeviceDetailWindow"
                />
                <RoutingCanvas
                  v-else-if="windowComponentKey(window) === 'graph'"
                  floating-mode
                  :parent-window-id="window.id"
                />
                <DataPortability
                  v-else-if="windowComponentKey(window) === 'portability'"
                  floating-mode
                  :parent-window-id="window.id"
                />
                <AdminAccessPanel v-else-if="windowComponentKey(window) === 'admin'" floating-mode />
                <DeviceDetailWindow
                  v-else-if="windowComponentKey(window) === 'device-detail'"
                  :device-id="Number(window.payload.deviceId || 0)"
                  @close="closeWindow(window)"
                />
                <PatchbayPointDetailWindow
                  v-else-if="windowComponentKey(window) === 'patchbay-point-detail'"
                  :patchbay-id="Number(window.payload.patchbayId || 0)"
                  :parent-window-id="String(window.payload.parentWindowId || 'tool:patchbay')"
                  @close="closeWindow(window)"
                />
                <PatchbayLinkSearchWindow
                  v-else-if="windowComponentKey(window) === 'patchbay-link-search'"
                  :patchbay-id="Number(window.payload.patchbayId || 0)"
                  @close="closeWindow(window)"
                />
                <PatchbayOverwriteConfirmWindow
                  v-else-if="windowComponentKey(window) === 'patchbay-overwrite-confirm'"
                  :patchbay-id="Number(window.payload.patchbayId || 0)"
                  :device-name="String(window.payload.deviceName || '')"
                  :port-label="String(window.payload.portLabel || '')"
                  @close="closeWindow(window)"
                />
                <DevicesAddEditWindow
                  v-else-if="windowComponentKey(window) === 'devices-add-edit'"
                  :mode="String(window.payload.mode || 'add') === 'edit' ? 'edit' : 'add'"
                  :device-id="Number(window.payload.deviceId || 0)"
                  :parent-window-id="String(window.payload.parentWindowId || window.parentId || 'tool:devices')"
                  @close="closeWindow(window)"
                />
                <DevicesDeleteConfirmWindow
                  v-else-if="windowComponentKey(window) === 'devices-delete-confirm'"
                  :device-id="Number(window.payload.deviceId || 0)"
                  :device-name="String(window.payload.deviceName || '')"
                  :source-window-id="String(window.payload.sourceWindowId || '') || undefined"
                  @close="closeWindow(window)"
                />
                <GraphAddNodeWindow
                  v-else-if="windowComponentKey(window) === 'canvas-add-item'"
                  :initial-tab="String(window.payload.initialTab || 'devices') === 'patchbay' ? 'patchbay' : 'devices'"
                  :on-select-template="graphSelectTemplateHandler(window)"
                  @close="closeWindow(window)"
                />
                <GraphConnectWindow
                  v-else-if="windowComponentKey(window) === 'canvas-select-port'"
                  :node-title="String(window.payload.nodeTitle || '')"
                  :ports="graphConnectPorts(window)"
                  :on-select-port="graphSelectPortHandler(window)"
                  @close="closeWindow(window)"
                />
                <GraphIntentMatchesWindow
                  v-else-if="windowComponentKey(window) === 'canvas-intent-matches' && graphIntentPayload(window)"
                  :intent="graphIntentWindowIntent(window)"
                  :query-text="graphIntentWindowQueryText(window)"
                  :matches="graphIntentWindowMatches(window)"
                  :top-candidates="graphIntentWindowTopCandidates(window)"
                  :on-add-selected="graphAddMatchedDevicesHandler(window)"
                  @close="closeWindow(window)"
                />
                <PortabilityReplaceConfirmWindow
                  v-else-if="windowComponentKey(window) === 'portability-replace-confirm'"
                  :required-text="String(window.payload.requiredText || 'REPLACE')"
                  :on-confirm="portabilityConfirmHandler(window)"
                  @close="closeWindow(window)"
                />
              </FloatingWindow>
            </div>

            <footer class="window-dock">
              <button
                v-for="window in dockWindows"
                :key="`dock-${window.id}`"
                class="dock-item"
                :class="{ minimized: window.state === 'minimized' }"
                @click="handleDockClick(window)"
              >
                <span class="dock-title">{{ window.title }}</span>
                <span class="dock-state">{{ window.state }}</span>
                <span
                  class="dock-close"
                  role="button"
                  tabindex="0"
                  @click.stop="closeWindow(window)"
                  @keydown.enter.stop.prevent="closeWindow(window)"
                >
                  x
                </span>
              </button>
            </footer>
          </section>
        </div>

        <div v-else class="mobile-shell">
          <header class="mobile-topbar">
            <div class="mobile-brand">
              <img class="brand-mark" :src="logoUrl" alt="" />
              <span>{{ t.app.name }}</span>
            </div>
            <UserButton />
          </header>

          <nav class="mobile-nav">
            <button :class="{ active: store.activeTab === 'patchbay' }" @click="store.setTab('patchbay')">{{ t.nav.patchbay }}</button>
            <button :class="{ active: store.activeTab === 'devices' }" @click="store.setTab('devices')">{{ t.nav.devices }}</button>
            <button :class="{ active: store.activeTab === 'nodeView' }" @click="store.setTab('nodeView')">{{ t.nav.nodeView }}</button>
            <button :class="{ active: isPortabilityRoute }" @click="openTool('portability')">{{ t.nav.portability }}</button>
            <button v-if="canAccessAdmin" :class="{ active: isAdminRoute }" @click="openTool('admin')">Admin</button>
          </nav>

          <main class="mobile-content">
            <template v-if="isAdminRoute">
              <AdminAccessPanel v-if="canAccessAdmin" />
            </template>
            <template v-else-if="isPortabilityRoute">
              <DataPortability />
            </template>
            <template v-else>
              <PatchBayGrid v-if="store.activeTab === 'patchbay'" />
              <DevicesManager v-if="store.activeTab === 'devices'" />
              <RoutingCanvas v-if="store.activeTab === 'nodeView'" />
            </template>
          </main>
        </div>

        <AuthDiagnosticsPanel v-if="showAuthDiagnostics" />
        <ToastHost />
      </div>
    </div>
  </SignedIn>
</template>

<style scoped>
.auth-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
}

.org-required-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
  padding: var(--space-4);
}

.org-required-container {
  width: 100%;
  max-width: 520px;
  text-align: center;
}

.org-required-header {
  margin-bottom: var(--space-6);
}

.org-logo {
  width: 80px;
  height: 80px;
  margin-bottom: var(--space-4);
}

.org-title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent, #d49a4f);
  margin: 0 0 var(--space-3) 0;
}

.org-subtitle {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
  line-height: 1.6;
}

.org-switcher-wrapper {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: var(--space-6);
  backdrop-filter: blur(10px);
  margin-bottom: var(--space-5);
  display: flex;
  justify-content: center;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

.auth-context-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(212, 154, 79, 0.12);
  border-bottom: 1px solid rgba(212, 154, 79, 0.35);
}

.auth-degraded-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: rgba(176, 75, 61, 0.15);
  border-bottom: 1px solid rgba(176, 75, 61, 0.4);
}

.auth-degraded-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.95rem;
}

.workspace-shell {
  display: grid;
  grid-template-columns: 220px 1fr;
  width: 100%;
  min-height: 0;
  transition: grid-template-columns 0.2s ease;
}

.workspace-shell.collapsed {
  grid-template-columns: 72px 1fr;
}

.tool-rail {
  border-right: 1px solid var(--border-default);
  background: rgba(20, 18, 14, 0.95);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  transition: padding 0.2s ease;
}

.tool-rail.collapsed {
  padding: var(--space-3) 8px;
}

.rail-brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
  min-height: 32px;
}

.tool-rail.collapsed .rail-brand {
  justify-content: center;
}

.rail-logo {
  width: 32px;
  height: 32px;
}

.tool-rail.collapsed .rail-logo {
  display: none;
}

.rail-toggle {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  cursor: pointer;
}

.tool-rail.collapsed .rail-toggle {
  margin-left: 0;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tool-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: var(--radius-2);
  padding: 10px;
  cursor: pointer;
  justify-content: flex-start;
}

.tool-rail.collapsed .tool-btn {
  justify-content: center;
  padding: 10px 6px;
}

.tool-btn.active {
  border-color: rgba(212, 154, 79, 0.8);
  color: var(--text-primary);
  background: rgba(212, 154, 79, 0.15);
}

.tool-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  background: rgba(212, 154, 79, 0.18);
  border: 1px solid rgba(212, 154, 79, 0.35);
}

.tool-label {
  font-weight: 600;
}

.rail-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.rail-user {
  margin-top: var(--space-2);
}

.tool-rail.collapsed .rail-footer {
  align-items: center;
}

.tool-rail.collapsed .ghost-btn {
  width: 100%;
  padding: 6px 0;
}

.tool-rail.collapsed .status-chip {
  width: 100%;
  justify-content: center;
}

.canvas-shell {
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr auto;
}

.canvas-stage {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 15% 12%, rgba(212, 154, 79, 0.08), transparent 42%),
    radial-gradient(circle at 85% 76%, rgba(61, 122, 88, 0.12), transparent 44%),
    linear-gradient(140deg, #181510, #12100d 58%, #0f0d0a);
}

.no-select-canvas,
.no-select-canvas * {
  user-select: none;
}

.no-select-canvas input,
.no-select-canvas textarea,
.no-select-canvas [contenteditable='true'] {
  user-select: text;
}

.no-select-canvas .selectable-detail-text,
.no-select-canvas .selectable-detail-text * {
  user-select: text;
}

.window-dock {
  display: flex;
  gap: var(--space-2);
  overflow-x: auto;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-default);
  background: rgba(19, 16, 12, 0.96);
}

.dock-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: var(--radius-2);
  padding: 8px 10px;
  cursor: pointer;
}

.dock-item.minimized {
  opacity: 0.75;
}

.dock-title {
  color: var(--text-primary);
  font-weight: 600;
}

.dock-state {
  text-transform: uppercase;
  font-size: 0.68rem;
  letter-spacing: 0.06em;
}

.dock-close {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-default);
}

.mobile-shell {
  display: grid;
  grid-template-rows: auto auto 1fr;
  width: 100%;
}

.mobile-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-default);
}

.mobile-brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 700;
}

.brand-mark {
  width: 28px;
  height: 28px;
}

.mobile-nav {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-default);
  overflow: auto;
}

.mobile-nav button {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  border-radius: var(--radius-round);
  padding: 6px 12px;
}

.mobile-nav button.active {
  color: #11130f;
  background: var(--accent);
}

.mobile-content {
  min-height: 0;
  overflow: hidden;
  padding: var(--space-3);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  border-radius: var(--radius-round);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  background: var(--surface-1);
}

.status-chip.loading {
  border-color: rgba(212, 154, 79, 0.6);
  color: var(--warning);
}

.status-chip.error {
  border-color: rgba(176, 75, 61, 0.7);
  color: var(--danger);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-2);
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: var(--radius-2);
  cursor: pointer;
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 7, 6, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2800;
}

.loading-card {
  background: var(--surface-2);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  box-shadow: var(--shadow-1);
}

@media (max-width: 1023px) {
  .workspace-shell {
    display: none;
  }
}
</style>
