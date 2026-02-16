<script setup lang="ts">
interface ConnectPortItem {
  id: string
  name: string
  statusLabel: string
  occupied: boolean
}

const props = defineProps<{
  nodeTitle: string
  ports: ConnectPortItem[]
  onSelectPort?: (portId: string) => void
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const selectPort = (portId: string) => {
  props.onSelectPort?.(portId)
  emit('close')
}
</script>

<template>
  <section class="graph-connect-window">
    <h3 class="selectable-detail-text">Connect to {{ nodeTitle }}</h3>

    <p class="help-text selectable-detail-text">Select destination port. Occupied ports are conflict candidates.</p>

    <div class="ports-list">
      <button
        v-for="port in ports"
        :key="port.id"
        class="port-item"
        :class="{ occupied: port.occupied }"
        type="button"
        @click="selectPort(port.id)"
      >
        <span class="port-item-title">{{ port.name }}</span>
        <span class="port-item-subtitle">{{ port.statusLabel }}</span>
        <span v-if="port.occupied" class="conflict-chip">Conflict candidate</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.graph-connect-window {
  display: grid;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.graph-connect-window h3 {
  margin: 0;
}

.help-text {
  margin: 0;
  color: var(--text-secondary);
}

.ports-list {
  display: grid;
  gap: var(--space-2);
}

.port-item {
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

.port-item.occupied {
  border-color: rgba(176, 75, 61, 0.7);
}

.port-item-title {
  font-weight: 600;
}

.port-item-subtitle {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.conflict-chip {
  justify-self: start;
  font-size: 0.72rem;
  border: 1px solid rgba(176, 75, 61, 0.7);
  border-radius: 999px;
  padding: 2px 8px;
  color: #f3cbc3;
  background: rgba(176, 75, 61, 0.16);
}
</style>
