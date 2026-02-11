<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { store, type Device, type DevicePort } from '../store'
import SuggestionsPanel from './suggestions/SuggestionsPanel.vue'
import { strings } from '../ui/strings'

const t = strings

interface PortSelection {
  device: Device | null
  port: DevicePort | null
}

interface MissingSelection {
  side: 'a' | 'b'
  selection: PortSelection
}

interface ConnectionResultSuccess {
  type: 'success'
  patchA: number
  patchB: number
  deviceA?: string
  portA?: string
  deviceB?: string
  portB?: string
}

interface ConnectionResultError {
  type: 'error'
  message: string
  missing: MissingSelection[]
}

const searchA = ref('')
const searchB = ref('')
const showDropdownA = ref(false)
const showDropdownB = ref(false)
const showReturnHint = ref(false)
const activeInnerTab = ref<'finder' | 'suggestions'>('finder')

const mappingChoice = ref<{ a: number | null; b: number | null }>({ a: null, b: null })

const allPorts = computed(() => {
  const result: { device: Device; port: DevicePort }[] = []
  for (const device of store.devices) {
    for (const port of device.ports) {
      result.push({ device, port })
    }
  }
  return result
})

const filteredPortsA = computed(() => {
  if (!searchA.value) return allPorts.value
  const query = searchA.value.toLowerCase()
  return allPorts.value.filter(item =>
    item.device.name.toLowerCase().includes(query) ||
    item.port.label.toLowerCase().includes(query)
  )
})

const filteredPortsB = computed(() => {
  if (!searchB.value) return allPorts.value
  const query = searchB.value.toLowerCase()
  return allPorts.value.filter(item =>
    item.device.name.toLowerCase().includes(query) ||
    item.port.label.toLowerCase().includes(query)
  )
})

const availablePatchPoints = computed(() => {
  return store.patchbayNodes.filter(node => !store.getDeviceByPatchbayId(node.id))
})

const getSelection = (side: 'a' | 'b'): PortSelection => {
  const state = store.connectionFinderState[side]
  if (!state) return { device: null, port: null }
  const device = store.devices.find(item => item.id === state.deviceId) || null
  if (!device) return { device: null, port: null }
  const port = device.ports.find(item => item.id === state.portId) || null
  if (!port) return { device: null, port: null }
  return { device, port }
}

const selectionA = computed(() => getSelection('a'))
const selectionB = computed(() => getSelection('b'))

const selectPortA = (device: Device, port: DevicePort) => {
  store.setConnectionFinderSelection('a', device.id, port.id)
  showDropdownA.value = false
}

const selectPortB = (device: Device, port: DevicePort) => {
  store.setConnectionFinderSelection('b', device.id, port.id)
  showDropdownB.value = false
}

const clearSelectionA = () => {
  store.clearConnectionFinderSelection('a')
  searchA.value = ''
}

const clearSelectionB = () => {
  store.clearConnectionFinderSelection('b')
  searchB.value = ''
}

watch(selectionA, (value) => {
  if (value.port && value.device) {
    searchA.value = `${value.device.name} - ${value.port.label}`
    mappingChoice.value.a = null
  }
})

watch(selectionB, (value) => {
  if (value.port && value.device) {
    searchB.value = `${value.device.name} - ${value.port.label}`
    mappingChoice.value.b = null
  }
})

const connectionResult = computed<ConnectionResultSuccess | ConnectionResultError | null>(() => {
  const portA = selectionA.value.port
  const portB = selectionB.value.port

  if (!portA || !portB) return null

  const patchA = portA.patchbayId
  const patchB = portB.patchbayId
  const missing: MissingSelection[] = []

  if (!patchA) missing.push({ side: 'a', selection: selectionA.value })
  if (!patchB) missing.push({ side: 'b', selection: selectionB.value })

  if (!patchA && !patchB) {
    return {
      type: 'error',
      message: t.connections.errorBothUnlinked,
      missing,
    }
  }

  if (!patchA) {
    return {
      type: 'error',
      message: t.connections.errorUnlinked(`${selectionA.value.device?.name} - ${portA.label}`),
      missing,
    }
  }

  if (!patchB) {
    return {
      type: 'error',
      message: t.connections.errorUnlinked(`${selectionB.value.device?.name} - ${portB.label}`),
      missing,
    }
  }

  return {
    type: 'success',
    patchA,
    patchB,
    deviceA: selectionA.value.device?.name,
    portA: portA.label,
    deviceB: selectionB.value.device?.name,
    portB: portB.label,
  }
})

const highlightedPatches = computed((): number[] => {
  if (connectionResult.value?.type === 'success') {
    return [connectionResult.value.patchA, connectionResult.value.patchB]
  }
  return []
})

watch(highlightedPatches, (newVal) => {
  store.highlightedPatchIds = newVal
}, { immediate: true })

watch(() => store.activeTab, (tab) => {
  if (tab !== 'connections') return
  const payload = store.lastLinkReturnPayload as { resume?: string; missingSide?: 'a' | 'b' } | null
  if (!payload || payload.resume !== 'connections') return
  showReturnHint.value = true
  store.clearLinkReturnPayload()
})

const dismissReturnHint = () => {
  showReturnHint.value = false
}

const goToPatchbay = () => {
  const focusId = highlightedPatches.value[0]
  store.patchbayFocusId = focusId || null
  store.setTab('patchbay')
}

const swapSelections = () => {
  store.swapConnectionFinderSelections()
}

const linkNow = (missing: MissingSelection) => {
  if (!missing.selection.device || !missing.selection.port) return
  store.startLinkingPort({
    portId: missing.selection.port.id,
    deviceId: missing.selection.device.id,
    deviceName: missing.selection.device.name,
    portLabel: missing.selection.port.label,
  }, {
    returnTab: 'connections',
    returnPayload: { resume: 'connections', missingSide: missing.side },
  })
}

const mapMissingPort = async (missing: MissingSelection) => {
  const patchbayId = mappingChoice.value[missing.side]
  if (!patchbayId) return
  if (!missing.selection.device || !missing.selection.port) return
  try {
    const didLink = await store.linkPatchbayToDevice(
      patchbayId,
      missing.selection.device.id,
      missing.selection.port.id
    )
    if (!didLink) return
    store.pushToast({
      type: 'success',
      message: strings.toast.linkedSuccess(
        missing.selection.device.name,
        missing.selection.port.label,
        patchbayId
      ),
    })
    mappingChoice.value[missing.side] = null
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || strings.toast.linkFailed })
  }
}

const copyInstruction = async () => {
  if (!connectionResult.value || connectionResult.value.type !== 'success') return
  const text = t.connections.resultInstruction(connectionResult.value.patchA, connectionResult.value.patchB)
  try {
    await navigator.clipboard.writeText(text)
    store.pushToast({ type: 'success', message: t.connections.copySuccess })
  } catch (err) {
    store.pushToast({ type: 'error', message: t.connections.copyFailed })
  }
}
</script>

<template>
  <div class="connection-finder">
    <div class="finder-header">
      <h2>{{ t.connections.title }}</h2>
      <p class="subtitle">{{ t.connections.subtitle }}</p>
    </div>

    <div v-if="showReturnHint" class="return-hint">
      <span>{{ t.connections.linkReturnHint }}</span>
      <button class="ghost-btn" @click="dismissReturnHint">{{ t.app.dismiss }}</button>
    </div>

    <div class="finder-body">
      <div class="inner-tabs">
        <button
          class="inner-tab-btn"
          :class="{ active: activeInnerTab === 'finder' }"
          @click="activeInnerTab = 'finder'"
        >
          {{ t.connections.tabs.finder }}
        </button>
        <button
          class="inner-tab-btn"
          :class="{ active: activeInnerTab === 'suggestions' }"
          @click="activeInnerTab = 'suggestions'"
        >
          {{ t.connections.tabs.suggestions }}
        </button>
      </div>

      <div v-if="activeInnerTab === 'finder'">
        <div class="selectors-container">
          <div class="selector-box">
            <label class="selector-label">
              <span class="label-icon">{{ t.connections.sideALabel }}</span>
              {{ t.connections.origin }}
            </label>
            <div class="search-wrapper">
              <input
                v-model="searchA"
                @focus="showDropdownA = true"
                @input="showDropdownA = true; store.clearConnectionFinderSelection('a')"
                :placeholder="t.connections.searchPlaceholder"
                class="search-input"
              />
              <button
                v-if="selectionA.port"
                class="clear-btn"
                :aria-label="t.connections.clearSelection"
                @click="clearSelectionA"
              >
                {{ t.app.closeSymbol }}
              </button>
            </div>

            <div v-if="showDropdownA && !selectionA.port" class="dropdown">
              <div
                v-for="item in filteredPortsA"
                :key="`${item.device.id}-${item.port.id}`"
                class="dropdown-item"
                @click="selectPortA(item.device, item.port)"
              >
                <span class="device-name">{{ item.device.name }}</span>
                <span class="port-info">
                  <span class="port-label">{{ item.port.label }}</span>
                  <span class="port-type" :class="item.port.type.toLowerCase()">
                    {{ t.devices.portTypes[item.port.type] }}
                  </span>
                  <span v-if="item.port.patchbayId" class="patch-id">#{{ item.port.patchbayId }}</span>
                  <span v-else class="not-linked">{{ t.connections.unlinked }}</span>
                </span>
              </div>
              <div v-if="filteredPortsA.length === 0" class="no-results">
                {{ t.connections.noResults }}
              </div>
            </div>

            <div v-if="selectionA.port" class="selection-info">
              <div class="selected-device">{{ selectionA.device?.name }}</div>
              <div class="selected-port">
                {{ selectionA.port.label }}
                <span class="port-type" :class="selectionA.port.type.toLowerCase()">
                  {{ t.devices.portTypes[selectionA.port.type] }}
                </span>
              </div>
              <div v-if="selectionA.port.patchbayId" class="patch-number">
                {{ t.connections.patchbayLabel }}: <strong>#{{ selectionA.port.patchbayId }}</strong>
              </div>
              <div v-else class="not-linked-warning">{{ t.connections.notLinkedWarning }}</div>
            </div>
          </div>

          <button class="swap-btn" :title="t.connections.swapTitle" @click="swapSelections">
            <span>{{ t.connections.swapLabel }}</span>
          </button>

          <div class="selector-box">
            <label class="selector-label">
              <span class="label-icon">{{ t.connections.sideBLabel }}</span>
              {{ t.connections.destination }}
            </label>
            <div class="search-wrapper">
              <input
                v-model="searchB"
                @focus="showDropdownB = true"
                @input="showDropdownB = true; store.clearConnectionFinderSelection('b')"
                :placeholder="t.connections.searchPlaceholder"
                class="search-input"
              />
              <button
                v-if="selectionB.port"
                class="clear-btn"
                :aria-label="t.connections.clearSelection"
                @click="clearSelectionB"
              >
                {{ t.app.closeSymbol }}
              </button>
            </div>

            <div v-if="showDropdownB && !selectionB.port" class="dropdown">
              <div
                v-for="item in filteredPortsB"
                :key="`${item.device.id}-${item.port.id}`"
                class="dropdown-item"
                @click="selectPortB(item.device, item.port)"
              >
                <span class="device-name">{{ item.device.name }}</span>
                <span class="port-info">
                  <span class="port-label">{{ item.port.label }}</span>
                  <span class="port-type" :class="item.port.type.toLowerCase()">
                    {{ t.devices.portTypes[item.port.type] }}
                  </span>
                  <span v-if="item.port.patchbayId" class="patch-id">#{{ item.port.patchbayId }}</span>
                  <span v-else class="not-linked">{{ t.connections.unlinked }}</span>
                </span>
              </div>
              <div v-if="filteredPortsB.length === 0" class="no-results">
                {{ t.connections.noResults }}
              </div>
            </div>

            <div v-if="selectionB.port" class="selection-info">
              <div class="selected-device">{{ selectionB.device?.name }}</div>
              <div class="selected-port">
                {{ selectionB.port.label }}
                <span class="port-type" :class="selectionB.port.type.toLowerCase()">
                  {{ t.devices.portTypes[selectionB.port.type] }}
                </span>
              </div>
              <div v-if="selectionB.port.patchbayId" class="patch-number">
                {{ t.connections.patchbayLabel }}: <strong>#{{ selectionB.port.patchbayId }}</strong>
              </div>
              <div v-else class="not-linked-warning">{{ t.connections.notLinkedWarning }}</div>
            </div>
          </div>
        </div>

        <div v-if="connectionResult" class="result-container">
          <div v-if="connectionResult.type === 'success'" class="result success">
            <div class="result-header">
              <span class="result-icon">{{ t.connections.successBadge }}</span>
              <h3>{{ t.connections.resultSuccessTitle }}</h3>
            </div>
            <div class="connection-diagram">
              <div class="patch-point">
                <span class="patch-number-big">#{{ connectionResult.patchA }}</span>
                <span class="patch-device">{{ connectionResult.deviceA }}</span>
                <span class="patch-port">{{ connectionResult.portA }}</span>
              </div>
              <div class="connection-line">
                <span class="cable-icon">{{ t.connections.cableLabel }}</span>
              </div>
              <div class="patch-point">
                <span class="patch-number-big">#{{ connectionResult.patchB }}</span>
                <span class="patch-device">{{ connectionResult.deviceB }}</span>
                <span class="patch-port">{{ connectionResult.portB }}</span>
              </div>
            </div>
            <p class="result-instruction">
              {{ t.connections.resultInstruction(connectionResult.patchA, connectionResult.patchB) }}
            </p>
            <div class="result-actions">
              <button class="primary-btn" @click="goToPatchbay">
                {{ t.connections.goToPatchbay }}
              </button>
              <button class="ghost-btn" @click="copyInstruction">
                {{ t.connections.copyInstruction }}
              </button>
              </div>
            </div>

          <div v-else class="result warning">
            <div class="result-header">
              <span class="result-icon">{{ t.connections.errorBadge }}</span>
              <h3>{{ t.connections.linkRequiredTitle }}</h3>
            </div>
            <p>{{ t.connections.linkRequiredHint }}</p>
            <div class="missing-grid">
              <div v-for="missing in connectionResult.missing" :key="missing.side" class="missing-card">
                <div class="missing-title">
                  {{ missing.selection.device?.name }} - {{ missing.selection.port?.label }}
                </div>
                <div class="missing-actions">
                  <select v-model="mappingChoice[missing.side]" class="patch-select">
                    <option :value="null" disabled>{{ t.connections.pickPatchPoint }}</option>
                    <option
                      v-for="patch in availablePatchPoints"
                      :key="patch.id"
                      :value="patch.id"
                    >
                      {{ t.connections.patchPointOption(patch.id, patch.name) }}
                    </option>
                  </select>
                  <button class="primary-btn" @click="mapMissingPort(missing)">
                    {{ t.connections.mapPort }}
                  </button>
                  <button class="ghost-btn" @click="linkNow(missing)">
                    {{ t.connections.linkNowFor(`${missing.selection.device?.name} - ${missing.selection.port?.label}`) }}
                  </button>
                </div>
              </div>
            </div>
            <p class="hint">{{ connectionResult.message }}</p>
          </div>
        </div>

        <div v-else class="empty-state">
          <div class="empty-icon">{{ t.connections.emptyIcon }}</div>
          <p>{{ t.connections.emptyTitle }}</p>
        </div>
      </div>

      <div v-else class="suggestions-tab">
        <SuggestionsPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.connection-finder {
  max-width: 1000px;
  margin: 0 auto;
  height: 100%;
  overflow: hidden;
  background: var(--surface-1);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-1);
  display: flex;
  flex-direction: column;
}

.finder-header {
  text-align: center;
  margin: var(--space-5) var(--space-5) var(--space-4);
}

.finder-header h2 {
  margin: 0 0 var(--space-2) 0;
  font-size: 1.8rem;
  color: var(--text-primary);
}

.subtitle {
  color: var(--text-secondary);
  margin: 0;
}

.return-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  margin: 0 var(--space-5) var(--space-4);
  border-radius: var(--radius-2);
  border: 1px solid rgba(106, 163, 111, 0.5);
  background: rgba(61, 122, 88, 0.18);
}

.finder-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-5) var(--space-5);
}

.inner-tabs {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.inner-tab-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 8px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
}

.inner-tab-btn.active {
  background: var(--surface-2);
  color: var(--text-primary);
  border-color: var(--accent);
}

.suggestions-tab {
  padding-top: var(--space-2);
}

.selectors-container {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
  margin-bottom: var(--space-5);
}

.selector-box {
  flex: 1;
  background-color: var(--surface-2);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  position: relative;
  border: 1px solid var(--border-default);
}

.selector-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
  font-weight: 600;
  margin-bottom: var(--space-3);
}

.label-icon {
  background-color: var(--accent);
  color: #0f120e;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 0.9rem;
}

.selector-box:last-of-type .label-icon {
  background-color: var(--accent-2);
}

.search-wrapper {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 12px 40px 12px 12px;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  font-size: 1rem;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--surface-3);
  border: none;
  color: var(--text-primary);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  max-height: 300px;
  overflow-y: auto;
  z-index: 100;
  margin-top: 4px;
}

.dropdown-item {
  padding: var(--space-3);
  cursor: pointer;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropdown-item:hover {
  background-color: var(--surface-2);
}

.dropdown-item:last-child {
  border-bottom: none;
}

.device-name {
  font-weight: 600;
  color: var(--text-primary);
}

.port-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 0.9rem;
}

.port-label {
  color: var(--text-secondary);
}

.port-type {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: var(--radius-1);
  text-transform: uppercase;
  background: var(--surface-3);
  color: var(--text-muted);
}

.patch-id {
  background-color: var(--accent);
  color: #0f120e;
  padding: 2px 6px;
  border-radius: var(--radius-1);
  font-size: 0.75rem;
  font-weight: 600;
}

.not-linked {
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.8rem;
}

.no-results {
  padding: var(--space-4);
  text-align: center;
  color: var(--text-muted);
}

.selection-info {
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-default);
}

.selected-device {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 1.1rem;
}

.selected-port {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  margin-top: 4px;
}

.patch-number {
  margin-top: var(--space-3);
  color: var(--accent-2);
  font-size: 1.1rem;
}

.not-linked-warning {
  margin-top: var(--space-3);
  color: var(--warning);
}

.swap-btn {
  background-color: var(--surface-3);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  width: 64px;
  height: 64px;
  border-radius: var(--radius-round);
  cursor: pointer;
  font-size: 0.85rem;
  margin-top: 52px;
  transition: all 0.2s;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.swap-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.result-container {
  margin-top: var(--space-4);
}

.result {
  background-color: var(--surface-2);
  border-radius: var(--radius-3);
  padding: var(--space-5);
  text-align: center;
  border: 1px solid var(--border-default);
}

.result.success {
  border-color: rgba(61, 122, 88, 0.7);
}

.result.warning {
  border-color: rgba(212, 154, 79, 0.6);
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.result-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.result-icon {
  font-size: 1rem;
  text-transform: uppercase;
  color: var(--text-muted);
}

.connection-diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  margin: var(--space-4) 0;
}

.patch-point {
  background-color: var(--surface-1);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 150px;
  border: 1px solid var(--border-default);
}

.patch-number-big {
  font-size: 1.9rem;
  font-weight: bold;
  color: var(--accent-2);
}

.patch-device {
  font-weight: 600;
  color: var(--text-primary);
}

.patch-port {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.connection-line {
  color: var(--accent);
  font-size: 0.9rem;
}

.cable-icon {
  display: inline-block;
  animation: pulse 1.5s ease-in-out infinite;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.result-instruction {
  color: var(--text-primary);
  font-size: 1rem;
  margin: var(--space-4) 0;
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.primary-btn {
  background-color: var(--accent);
  color: #0f120e;
  border: none;
  padding: 10px 18px;
  border-radius: var(--radius-2);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn {
  background-color: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  padding: 10px 18px;
  border-radius: var(--radius-2);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.missing-grid {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.missing-card {
  padding: var(--space-3);
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: var(--surface-1);
  text-align: left;
}

.missing-title {
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.missing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.patch-select {
  min-width: 180px;
  padding: 8px 10px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-primary);
}

.hint {
  color: var(--text-muted) !important;
  font-size: 0.9rem;
  margin-top: var(--space-3);
}

.empty-state {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  color: var(--text-muted);
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: var(--space-3);
}

.empty-state p {
  font-size: 1.1rem;
  max-width: 400px;
  margin: 0 auto;
}

@media (max-width: 960px) {
  .selectors-container {
    flex-direction: column;
    align-items: stretch;
  }

  .swap-btn {
    margin: 0 auto;
  }

  .connection-diagram {
    flex-direction: column;
  }
}
</style>
