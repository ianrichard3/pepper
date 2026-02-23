<script setup lang="ts">
import { computed, ref } from 'vue'
import { store } from '@/store'
import { strings } from '@/ui/strings'
import { windowManager } from '@/stores/windowManager'

const props = defineProps<{
  patchbayId: number
  patchbayName: string
  sourceWindowId?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const t = strings
const loading = ref(false)
const confirmInput = ref('')
const canConfirmDelete = computed(() => !loading.value && confirmInput.value.trim() === t.confirm.deleteKeyword)

const confirmDelete = async () => {
  if (!canConfirmDelete.value) return
  loading.value = true
  try {
    const result = await store.deletePatchbayPoint(props.patchbayId)
    if (result.deleted) {
      store.pushToast({ type: 'success', message: t.toast.patchbayPointDeleted })
      if (props.sourceWindowId) windowManager.closeWindow(props.sourceWindowId)
      emit('close')
      return
    }
    if (result.blocked) {
      store.pushToast({ type: 'error', message: t.patchbay.deleteBlocked })
      return
    }
    store.pushToast({ type: 'error', message: result.message || t.toast.patchbayPointDeleteFailed })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.patchbayPointDeleteFailed })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="delete-confirm">
    <h3 class="selectable-detail-text">{{ t.confirm.deletePatchbayPointTitle }}</h3>
    <p class="selectable-detail-text">{{ t.confirm.deletePatchbayPointMessage(patchbayName, patchbayId) }}</p>
    <p class="help selectable-detail-text">{{ t.confirm.deleteTypeToConfirm }}</p>
    <input
      v-model="confirmInput"
      class="confirm-input"
      :placeholder="t.confirm.deleteInputPlaceholder"
      :disabled="loading"
    />
    <div class="actions">
      <button class="btn ghost" :disabled="loading" @click="emit('close')">{{ t.confirm.cancel }}</button>
      <button class="btn solid" :disabled="!canConfirmDelete" @click="confirmDelete">
        {{ loading ? t.confirm.deleting : t.confirm.confirm }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.delete-confirm {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-2);
  height: 100%;
  min-height: 0;
  overflow: auto;
  align-content: start;
}

.help {
  margin: 0;
  color: var(--text-secondary);
}

.confirm-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  padding: 8px 10px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-wrap: wrap;
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

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
