<script setup lang="ts">
import { ref } from 'vue'
import { store } from '@/store'
import { strings } from '@/ui/strings'
import { windowManager } from '@/stores/windowManager'

const props = defineProps<{
  deviceId: number
  deviceName: string
  sourceWindowId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const t = strings
const loading = ref(false)

const confirmDelete = async () => {
  loading.value = true
  try {
    await store.deleteDevice(props.deviceId)
    store.pushToast({ type: 'success', message: strings.toast.deviceDeleted })
    if (props.sourceWindowId) {
      windowManager.closeWindow(props.sourceWindowId)
    }
    emit('close')
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || strings.toast.deviceDeleteFailed })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="delete-confirm">
    <h3 class="selectable-detail-text">{{ t.confirm.deleteDeviceTitle }}</h3>
    <p class="selectable-detail-text">{{ t.confirm.deleteDeviceMessage(deviceName) }}</p>
    <div class="actions">
      <button class="btn ghost" :disabled="loading" @click="emit('close')">{{ t.confirm.cancel }}</button>
      <button class="btn solid" :disabled="loading" @click="confirmDelete">
        {{ loading ? 'Deleting...' : t.confirm.confirm }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.delete-confirm {
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
  background: var(--danger);
  color: #fff;
}
</style>
