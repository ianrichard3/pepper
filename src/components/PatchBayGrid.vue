<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { store, type PatchBayNode } from '../store'
import { windowManager } from '@/stores/windowManager'
import { strings } from '../ui/strings'

const t = strings
const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})
const nodes = computed(() => store.patchbayNodes)
const gridSearchQuery = ref('')

const rowLabels = t.patchbay.rowLabels
const columnLabels = Array.from({ length: 48 }, (_, index) => index + 1)

// Helper to get connection info
const getConnection = (patchbayId: number) => {
  return store.getDeviceByPatchbayId(patchbayId)
}

const isLinked = (patchbayId: number) => {
  return !!getConnection(patchbayId)
}

const isMatch = (node: PatchBayNode) => {
  if (!gridSearchQuery.value) return false
  const query = gridSearchQuery.value.toLowerCase()

  if (node.name.toLowerCase().includes(query)) return true

  const connection = getConnection(node.id)
  if (connection) {
    if (connection.device.name.toLowerCase().includes(query)) return true
    if (connection.port.label.toLowerCase().includes(query)) return true
  }

  return false
}

const isHighlightedConnection = (patchbayId: number) => {
  return store.highlightedPatchIds.includes(patchbayId)
}

const selectionBannerText = computed(() => {
  if (store.pendingLink) {
    return t.patchbay.linkingBanner(store.pendingLink.deviceName, store.pendingLink.portLabel)
  }
  return t.patchbay.linkingFallback
})

const getSectionNodes = (sectionIndex: number) => {
  return nodes.value.slice((sectionIndex - 1) * 96, sectionIndex * 96)
}

const getCellTooltip = (patchbayId: number) => {
  const connection = getConnection(patchbayId)
  if (!connection) return ''
  return t.patchbay.tooltip(connection.device.name, connection.port.label)
}

const handleCellClick = async (node: PatchBayNode) => {
  const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
  if (store.selectionMode) {
    const existing = getConnection(node.id)
    if (existing) {
      windowManager.openChildWindow(
        parentWindowId,
        'patchbay-overwrite-confirm',
        t.confirm.overwriteTitle,
        {
          patchbayId: node.id,
          deviceName: existing.device.name,
          portLabel: existing.port.label,
        },
        { forceUnique: true },
      )
      return
    }
    await store.completeLink(node.id)
  } else {
    windowManager.openChildWindow(
      parentWindowId,
      'patchbay-point-detail',
      t.patchbay.patchPointTitle(node.id),
      { patchbayId: node.id, parentWindowId },
      { id: `patchbay-point-detail:${node.id}` },
    )
  }
}

// Search Logic
watch(() => store.patchbayFocusId, async (focusId) => {
  if (!focusId) return
  await nextTick()
  const target = document.querySelector(`[data-patch-id=\"${focusId}\"]`) as HTMLElement | null
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }
  store.patchbayFocusId = null
})
</script>

<template>
  <div class="main-container" :class="{ 'selection-mode': store.selectionMode, 'floating-mode': props.floatingMode }">
    <div class="top-controls">
      <div v-if="store.selectionMode" class="selection-banner">
        <span>{{ selectionBannerText }}</span>
        <button @click="store.cancelLinking()">{{ t.patchbay.cancel }}</button>
      </div>

      <div v-if="store.highlightedPatchIds.length > 0" class="highlight-banner">
        <span>{{ t.patchbay.showingConnection(store.highlightedPatchIds[0], store.highlightedPatchIds[1]) }}</span>
        <button @click="store.highlightedPatchIds = []">{{ t.patchbay.clearHighlights }}</button>
      </div>

      <div class="grid-controls">
        <input
          v-model="gridSearchQuery"
          :placeholder="t.patchbay.searchPlaceholder"
          class="grid-search-input"
        />
        <div class="grid-legend">
          <span class="legend-title">{{ t.patchbay.legendTitle }}</span>
          <span class="legend-chip linked">{{ t.patchbay.legendLinked }}</span>
          <span class="legend-chip open">{{ t.patchbay.legendOpen }}</span>
          <span class="legend-chip match">{{ t.patchbay.legendMatch }}</span>
          <span class="legend-chip highlight">{{ t.patchbay.legendHighlight }}</span>
        </div>
      </div>
    </div>

    <div class="grid-wrapper">
      <div v-for="sectionIndex in 3" :key="sectionIndex" class="grid-section" :class="'section-' + sectionIndex">
        <div class="grid-corner"></div>
        <div v-for="col in columnLabels" :key="`col-${sectionIndex}-${col}`" class="grid-col-label">
          {{ col }}
        </div>
        <div class="grid-row-label">{{ rowLabels[0] }}</div>
        <div
          v-for="item in getSectionNodes(sectionIndex).slice(0, 48)"
          :key="item.id"
          class="grid-cell"
          :class="{
            linked: isLinked(item.id),
            open: !isLinked(item.id),
            'highlight-match': isMatch(item),
            'highlight-connection': isHighlightedConnection(item.id),
          }"
          :data-patch-id="item.id"
          :data-tooltip="getCellTooltip(item.id) || null"
          @click="handleCellClick(item)"
        >
          <div class="cell-content">
            <span class="cell-text">{{ item.id }}</span>
          </div>
        </div>
        <div class="grid-row-label">{{ rowLabels[1] }}</div>
        <div
          v-for="item in getSectionNodes(sectionIndex).slice(48, 96)"
          :key="item.id"
          class="grid-cell"
          :class="{
            linked: isLinked(item.id),
            open: !isLinked(item.id),
            'highlight-match': isMatch(item),
            'highlight-connection': isHighlightedConnection(item.id),
          }"
          :data-patch-id="item.id"
          :data-tooltip="getCellTooltip(item.id) || null"
          @click="handleCellClick(item)"
        >
          <div class="cell-content">
            <span class="cell-text">{{ item.id }}</span>
          </div>
        </div>
      </div>
    </div>

    
  </div>
</template>

<style scoped>
.main-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background-color: var(--surface-1);
  width: 100%;
  height: 100%;
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-1);
  overflow: auto;
  min-height: 0;
}

.main-container.floating-mode {
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  padding: var(--space-3);
}

.selection-mode {
  border: 2px solid rgba(61, 122, 88, 0.9);
  box-shadow: 0 0 0 2px rgba(61, 122, 88, 0.2);
}

.selection-banner {
  background-color: rgba(61, 122, 88, 0.2);
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  text-align: center;
  font-weight: 600;
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  align-items: center;
  border-radius: var(--radius-2);
  border: 1px solid rgba(61, 122, 88, 0.4);
}

.selection-banner button {
  background: var(--surface-1);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  padding: 4px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
}

.highlight-banner {
  background: linear-gradient(120deg, rgba(61, 122, 88, 0.3), rgba(212, 154, 79, 0.25));
  color: var(--text-primary);
  padding: var(--space-2) var(--space-3);
  text-align: center;
  font-weight: 500;
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  align-items: center;
  border-radius: var(--radius-2);
  border: 1px solid rgba(212, 154, 79, 0.3);
}

.highlight-banner button {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  padding: 4px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
}

.grid-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.grid-search-input {
  width: 100%;
  max-width: 360px;
  padding: 10px 12px;
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  border-radius: var(--radius-2);
}

.grid-legend {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.legend-title {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.legend-chip {
  padding: 4px 10px;
  border-radius: var(--radius-round);
  font-size: 0.8rem;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.legend-chip.linked {
  border-color: rgba(106, 163, 111, 0.6);
}

.legend-chip.open {
  border-color: rgba(141, 135, 122, 0.6);
}

.legend-chip.match {
  border-color: rgba(212, 154, 79, 0.6);
}

.legend-chip.highlight {
  border-color: rgba(61, 122, 88, 0.7);
}

.grid-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
}

.grid-section {
  display: grid;
  grid-template-columns: 32px repeat(48, minmax(22px, 1fr));
  grid-template-rows: auto repeat(2, minmax(28px, 1fr));
  gap: 4px;
  width: 100%;
  min-width: 1280px;
  position: relative;
}

.grid-corner {
  position: sticky;
  left: 0;
  top: 0;
  background: var(--surface-1);
  z-index: 2;
}

.grid-col-label {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-align: center;
  position: sticky;
  top: 0;
  background: var(--surface-1);
  padding-bottom: 4px;
  z-index: 2;
}

.grid-row-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  position: sticky;
  left: 0;
  background: var(--surface-1);
  z-index: 1;
}

.grid-cell {
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s, border-color 0.2s, transform 0.2s;
  height: 34px;
  position: relative;
}

.grid-cell.open {
  background-color: var(--surface-2);
}

.grid-cell.linked {
  background-color: rgba(61, 122, 88, 0.25);
  border-color: rgba(61, 122, 88, 0.6);
}

.grid-cell:hover {
  border-color: rgba(212, 154, 79, 0.6);
  transform: translateY(-1px);
}

.grid-cell[data-tooltip]:hover::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 50%;
  top: -34px;
  transform: translateX(-50%);
  background: var(--surface-3);
  color: var(--text-primary);
  padding: 6px 10px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  white-space: nowrap;
  font-size: 0.75rem;
  z-index: 20;
  box-shadow: var(--shadow-1);
}

.grid-cell.highlight-match {
  background-color: rgba(212, 154, 79, 0.35);
  border-color: rgba(212, 154, 79, 0.7);
  box-shadow: 0 0 6px rgba(212, 154, 79, 0.3);
  z-index: 1;
}

.grid-cell.highlight-connection {
  background-color: rgba(61, 122, 88, 0.6);
  border-color: rgba(61, 122, 88, 0.9);
  box-shadow: 0 0 18px rgba(61, 122, 88, 0.5);
  z-index: 10;
  animation: connection-pulse 1s ease-in-out infinite;
  transform: scale(1.08);
  border-width: 2px;
}

.grid-cell.highlight-connection .cell-text {
  font-weight: bold;
  font-size: 0.75rem;
}

@keyframes connection-pulse {
  0%, 100% {
    box-shadow: 0 0 12px rgba(61, 122, 88, 0.5);
  }
  50% {
    box-shadow: 0 0 18px rgba(106, 163, 111, 0.7);
  }
}

.cell-text {
  font-size: 0.6rem;
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 1px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(7, 6, 5, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--surface-2);
  padding: var(--space-5);
  border-radius: var(--radius-3);
  min-width: 300px;
  box-shadow: var(--shadow-2);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.modal-content.search-modal {
  width: 640px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.modal-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
}

.connection-status {
  margin: var(--space-4) 0;
  padding: var(--space-3);
  background-color: var(--surface-1);
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
}

.link-btn {
  background-color: var(--accent);
  color: #0c0e0b;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-2);
  cursor: pointer;
  margin-top: var(--space-2);
  font-weight: 600;
}

.unlink-btn {
  background-color: var(--danger);
  color: #fdf7ee;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-2);
  cursor: pointer;
  margin-top: var(--space-2);
}

.close-btn-main {
  margin-top: var(--space-3);
  padding: 0.5rem 1rem;
  background-color: var(--surface-3);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  cursor: pointer;
}

.search-input {
  margin: var(--space-4);
  padding: 10px;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  border-radius: var(--radius-2);
}

.device-search-list {
  overflow-y: auto;
  padding: 0 var(--space-4) var(--space-4) var(--space-4);
}

.search-device-item {
  margin-bottom: var(--space-3);
  background-color: var(--surface-1);
  padding: var(--space-3);
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
}

.device-name {
  font-weight: bold;
  margin-bottom: var(--space-2);
  color: var(--text-primary);
}

.device-ports {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.port-select-btn {
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  padding: 4px 8px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-size: 0.85rem;
}

.port-select-btn:hover:not(:disabled) {
  background-color: rgba(61, 122, 88, 0.25);
}

.port-select-btn.active {
  background-color: var(--accent);
  color: #0c0e0b;
  border-color: var(--accent);
}

.port-select-btn.occupied {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: var(--surface-2);
}

.occupied-tag {
  font-size: 0.7rem;
  color: var(--text-muted);
}

@media (max-width: 960px) {
  .main-container {
    padding: var(--space-3);
  }

  .grid-section {
    min-width: 960px;
  }
}
</style>
