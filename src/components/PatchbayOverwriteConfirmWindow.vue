<script setup lang="ts">
import { strings } from '@/ui/strings'
import { store } from '@/store'

const props = defineProps<{
  patchbayId: number
  deviceName: string
  portLabel: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const t = strings

const confirmOverwrite = async () => {
  await store.completeLink(props.patchbayId)
  emit('close')
}
</script>

<template>
  <section class="overwrite-confirm">
    <h3 class="selectable-detail-text">{{ t.confirm.overwriteTitle }}</h3>
    <p class="selectable-detail-text">{{ t.confirm.overwriteMessage(deviceName, portLabel) }}</p>
    <div class="actions">
      <button class="btn ghost" @click="emit('close')">{{ t.confirm.cancel }}</button>
      <button class="btn solid" @click="confirmOverwrite">{{ t.confirm.confirm }}</button>
    </div>
  </section>
</template>

<style scoped>
.overwrite-confirm {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-2);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.btn {
  border-radius: var(--radius-2);
  border: 1px solid transparent;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
  border-color: var(--border-default);
  color: var(--text-secondary);
}

.btn.solid {
  background: var(--accent);
  color: #0d0f0c;
}
</style>
