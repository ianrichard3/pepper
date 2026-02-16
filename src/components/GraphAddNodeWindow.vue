<script setup lang="ts">
import { computed, ref } from 'vue'
import { store } from '@/store'

type NodeKind = 'device' | 'patchbay'
type NodeDirection = 'input' | 'output' | 'io'

interface NodeTemplate {
  templateId: string
  title: string
  subtitle: string
  kind: NodeKind
  details: string[]
  ports: Array<{ id: string; name: string; direction: NodeDirection }>
}

const props = withDefaults(defineProps<{
  onSelectTemplate?: (template: NodeTemplate) => void
  initialTab?: 'devices' | 'patchbay'
}>(), {
  initialTab: 'devices',
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const tab = ref<'devices' | 'patchbay'>(props.initialTab)
const query = ref('')

const mapStorePortDirection = (type: string): NodeDirection => {
  const normalized = String(type || '').trim().toLowerCase()
  if (normalized === 'input') return 'input'
  if (normalized === 'output') return 'output'
  return 'io'
}

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
      : [{ id: `port-${device.id}`, name: 'Port', direction: 'io' }],
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
  return tab.value === 'devices' ? deviceCatalog.value : patchbayCatalog.value
})

const filteredCatalog = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return activeCatalog.value
  return activeCatalog.value.filter((item) => {
    const haystack = `${item.title} ${item.subtitle} ${item.details.join(' ')} ${item.ports.map((port) => port.name).join(' ')}`.toLowerCase()
    return haystack.includes(normalized)
  })
})

const selectTemplate = (item: NodeTemplate) => {
  props.onSelectTemplate?.(item)
  emit('close')
}
</script>

<template>
  <section class="graph-add-window">
    <header class="panel-header">
      <h3>Add Node</h3>
      <button class="close-btn" type="button" @click="emit('close')">x</button>
    </header>

    <div class="catalog-tabs">
      <button class="ghost-btn" :class="{ active: tab === 'devices' }" type="button" @click="tab = 'devices'">
        Devices
      </button>
      <button class="ghost-btn" :class="{ active: tab === 'patchbay' }" type="button" @click="tab = 'patchbay'">
        Patchbay Ports
      </button>
    </div>

    <input v-model="query" class="add-search" placeholder="Search nodes..." />

    <div class="catalog-list">
      <button
        v-for="item in filteredCatalog"
        :key="item.templateId"
        class="catalog-item"
        type="button"
        @click="selectTemplate(item)"
      >
        <span class="catalog-item-title">{{ item.title }}</span>
        <span class="catalog-item-subtitle">{{ item.subtitle }}</span>
      </button>
      <p v-if="filteredCatalog.length === 0" class="catalog-empty">No items found.</p>
    </div>
  </section>
</template>

<style scoped>
.graph-add-window {
  display: grid;
  gap: var(--space-3);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 {
  margin: 0;
}

.close-btn {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: var(--radius-2);
  width: 30px;
  height: 30px;
  cursor: pointer;
}

.catalog-tabs {
  display: flex;
  gap: var(--space-2);
}

.ghost-btn {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-secondary);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  cursor: pointer;
}

.ghost-btn.active {
  border-color: rgba(212, 154, 79, 0.7);
  color: var(--text-primary);
}

.add-search {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  color: var(--text-primary);
  padding: 8px 10px;
}

.catalog-list {
  display: grid;
  gap: var(--space-2);
  max-height: 360px;
  overflow: auto;
}

.catalog-item {
  display: grid;
  gap: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
}

.catalog-item-title {
  font-weight: 600;
}

.catalog-item-subtitle {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.catalog-empty {
  margin: 0;
  color: var(--text-secondary);
}
</style>
