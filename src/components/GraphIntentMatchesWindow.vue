<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiDeviceMatchItem, ApiIntent } from '@/lib/api'

const props = defineProps<{
  intent: ApiIntent
  queryText: string
  matches: ApiDeviceMatchItem[]
  topCandidates: {
    source_device_ids: number[]
    destination_device_ids: number[]
    processor_device_ids_by_tag: Record<string, number[]>
  }
  onAddSelected?: (deviceIds: number[]) => void
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const selectedIds = ref<number[]>([])

const topIdSet = computed(() => {
  const ids = new Set<number>()
  for (const id of props.topCandidates.source_device_ids) ids.add(id)
  for (const id of props.topCandidates.destination_device_ids) ids.add(id)
  for (const idsByTag of Object.values(props.topCandidates.processor_device_ids_by_tag)) {
    for (const id of idsByTag) ids.add(id)
  }
  return ids
})

watch(
  () => props.matches,
  (next) => {
    const top = next.filter((row) => topIdSet.value.has(row.device_id)).map((row) => row.device_id)
    selectedIds.value = top
  },
  { immediate: true },
)

const toggleSelection = (deviceId: number) => {
  if (selectedIds.value.includes(deviceId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== deviceId)
    return
  }
  selectedIds.value = [...selectedIds.value, deviceId]
}

const selectOnlyTop = () => {
  selectedIds.value = props.matches.filter((row) => topIdSet.value.has(row.device_id)).map((row) => row.device_id)
}

const selectAll = () => {
  selectedIds.value = props.matches.map((row) => row.device_id)
}

const clearSelection = () => {
  selectedIds.value = []
}

const roleBadges = (item: ApiDeviceMatchItem) => {
  const badges: string[] = []
  if (props.topCandidates.source_device_ids.includes(item.device_id)) badges.push('Top source')
  if (props.topCandidates.destination_device_ids.includes(item.device_id)) badges.push('Top destination')
  for (const [tag, ids] of Object.entries(props.topCandidates.processor_device_ids_by_tag)) {
    if (ids.includes(item.device_id)) badges.push(`Top ${tag}`)
  }
  return badges
}

const addSelected = () => {
  props.onAddSelected?.(selectedIds.value)
  emit('close')
}
</script>

<template>
  <section class="graph-intent-window">
    <header class="summary">
      <h3>Intent Device Match</h3>
      <p class="summary-line">Task: <strong>{{ intent.task }}</strong></p>
      <p class="summary-line">Query: {{ queryText }}</p>
    </header>

    <div class="actions">
      <button class="ghost-btn" type="button" @click="selectOnlyTop">Select top</button>
      <button class="ghost-btn" type="button" @click="selectAll">Select all</button>
      <button class="ghost-btn" type="button" @click="clearSelection">Clear</button>
    </div>

    <div class="list">
      <label
        v-for="item in matches"
        :key="item.device_id"
        class="row"
        :class="{ highlighted: topIdSet.has(item.device_id) }"
      >
        <input
          type="checkbox"
          :checked="selectedIds.includes(item.device_id)"
          @change="toggleSelection(item.device_id)"
        />
        <div class="row-main">
          <div class="row-title">
            <span>{{ item.device_name }}</span>
            <span class="score">{{ Math.round(item.score * 100) }}%</span>
          </div>
          <p class="row-subtitle">{{ item.category }} | {{ item.type }} | role: {{ item.role_fit }}</p>
          <div class="badges">
            <span v-for="badge in roleBadges(item)" :key="badge" class="badge">{{ badge }}</span>
          </div>
        </div>
      </label>
      <p v-if="matches.length === 0" class="empty">No matched devices returned.</p>
    </div>

    <footer class="footer">
      <span>{{ selectedIds.length }} selected</span>
      <div class="footer-actions">
        <button class="ghost-btn" type="button" @click="emit('close')">Cancel</button>
        <button class="ghost-btn primary" type="button" :disabled="selectedIds.length === 0" @click="addSelected">Add selected nodes</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.graph-intent-window {
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
}

.summary h3 {
  margin: 0;
}

.summary-line {
  margin: 2px 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.ghost-btn {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  cursor: pointer;
}

.ghost-btn.primary {
  border-color: rgba(106, 163, 111, 0.7);
  color: #bfe0be;
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.list {
  display: grid;
  gap: var(--space-2);
  overflow: auto;
  min-height: 0;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2);
  align-items: start;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  padding: 10px;
}

.row.highlighted {
  border-color: rgba(212, 154, 79, 0.75);
}

.row-main {
  display: grid;
  gap: 2px;
}

.row-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-weight: 600;
}

.score {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.row-subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.badge {
  font-size: 0.72rem;
  border: 1px solid rgba(212, 154, 79, 0.75);
  border-radius: 999px;
  padding: 2px 8px;
  background: rgba(212, 154, 79, 0.16);
}

.empty {
  margin: 0;
  color: var(--text-secondary);
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.footer-actions {
  display: flex;
  gap: var(--space-2);
}
</style>
