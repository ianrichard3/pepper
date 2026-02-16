<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  requiredText?: string
  onConfirm?: (input: string) => void
}>(), {
  requiredText: 'REPLACE',
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const value = ref('')

const confirm = () => {
  props.onConfirm?.(value.value)
  emit('close')
}
</script>

<template>
  <section class="replace-confirm-window">
    <h3 class="selectable-detail-text">Confirm replace mode</h3>
    <p class="selectable-detail-text">This operation can replace workspace data. Type <code>{{ requiredText }}</code> to continue.</p>

    <input v-model="value" class="input" :placeholder="`Type ${requiredText}`" />

    <div class="actions">
      <button class="ghost-btn" type="button" @click="emit('close')">Cancel</button>
      <button class="primary-btn" type="button" :disabled="value !== requiredText" @click="confirm">Confirm and apply</button>
    </div>
  </section>
</template>

<style scoped>
.replace-confirm-window {
  display: grid;
  gap: var(--space-3);
}

.replace-confirm-window h3,
.replace-confirm-window p {
  margin: 0;
}

.input {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  color: var(--text-primary);
  padding: 8px 10px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.ghost-btn,
.primary-btn {
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  padding: 8px 12px;
  cursor: pointer;
}

.ghost-btn {
  background: transparent;
  color: var(--text-secondary);
}

.primary-btn {
  background: var(--danger);
  border-color: rgba(176, 75, 61, 0.8);
  color: #fff;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
