<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  modelValue: Record<string, boolean>
  keys: string[]
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, boolean>): void
}>()

const draggingKey = ref<string | null>(null)

const granted = computed(() => props.keys.filter((key) => Boolean(props.modelValue[key])))
const denied = computed(() => props.keys.filter((key) => !props.modelValue[key]))

const labels: Record<string, string> = {
  ai_detection: 'AI Detection',
  ai_intent: 'AI Intent',
  ai_intent_device_match: 'Intent Device Match',
  export: 'Export',
  catalog: 'Catalog',
  device_edit: 'Device Editing',
  patchbay_edit: 'Patchbay Editing',
  patchbay_layout_edit: 'Patchbay Layout',
  routing_edit: 'Routing Editing',
  portability_import: 'Portability Import',
}

function displayLabel(key: string) {
  return labels[key] || key
}

function setValue(key: string, value: boolean) {
  const next = { ...props.modelValue, [key]: value }
  emit('update:modelValue', next)
}

function onDragStart(key: string) {
  draggingKey.value = key
}

function onDrop(bucket: 'granted' | 'denied') {
  if (!draggingKey.value) return
  setValue(draggingKey.value, bucket === 'granted')
  draggingKey.value = null
}
</script>

<template>
  <div class="feature-buckets">
    <h4 v-if="props.title" class="title">{{ props.title }}</h4>
    <div class="columns">
      <section class="bucket" @dragover.prevent @drop.prevent="onDrop('denied')">
        <header>
          <strong>Not granted</strong>
          <span>{{ denied.length }}</span>
        </header>
        <div class="items">
          <div
            v-for="key in denied"
            :key="key"
            class="item"
            draggable="true"
            @dragstart="onDragStart(key)"
          >
            <span>{{ displayLabel(key) }}</span>
            <button class="move" type="button" @click="setValue(key, true)">Grant</button>
          </div>
        </div>
      </section>

      <section class="bucket granted" @dragover.prevent @drop.prevent="onDrop('granted')">
        <header>
          <strong>Granted</strong>
          <span>{{ granted.length }}</span>
        </header>
        <div class="items">
          <div
            v-for="key in granted"
            :key="key"
            class="item"
            draggable="true"
            @dragstart="onDragStart(key)"
          >
            <span>{{ displayLabel(key) }}</span>
            <button class="move" type="button" @click="setValue(key, false)">Revoke</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.feature-buckets {
  display: grid;
  gap: var(--space-2);
}

.title {
  margin: 0;
}

.columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.bucket {
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  min-height: 180px;
  display: grid;
  grid-template-rows: auto 1fr;
}

.bucket header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
}

.bucket.granted header {
  background: color-mix(in oklab, var(--accent) 18%, transparent);
}

.items {
  padding: 10px;
  display: grid;
  gap: 8px;
  align-content: start;
}

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 8px 10px;
  cursor: grab;
}

.item span {
  font-size: 0.9rem;
}

.move {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-primary);
  border-radius: 999px;
  padding: 4px 8px;
  cursor: pointer;
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
