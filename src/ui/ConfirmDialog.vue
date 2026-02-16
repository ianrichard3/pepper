<script setup lang="ts">
import { reactive } from 'vue'
import { strings } from './strings'
import FloatingWindow from './FloatingWindow.vue'

const t = strings

defineProps<{ title: string; message: string; confirmLabel?: string; cancelLabel?: string }>()

defineEmits<{ confirm: []; cancel: [] }>()

const rect = reactive({
  x: Math.max(20, Math.round((window.innerWidth - 420) / 2)),
  y: Math.max(20, Math.round((window.innerHeight - 220) / 2)),
  width: 420,
  height: 220,
})
</script>

<template>
  <FloatingWindow
    title="Confirm"
    :rect="rect"
    state="normal"
    :z-index="2600"
    :min-width="360"
    :min-height="200"
    role="dialog"
    aria-modal="true"
    @focus="() => {}"
    @close="$emit('cancel')"
    @move="(next) => { rect.x = next.x; rect.y = next.y }"
    @resize="(next) => { rect.x = next.x; rect.y = next.y; rect.width = next.width; rect.height = next.height }"
    @toggle-minimize="() => {}"
    @toggle-maximize="() => {}"
  >
    <div class="confirm-card">
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <div class="confirm-actions">
        <button class="btn ghost" @click="$emit('cancel')">
          {{ cancelLabel || t.confirm.cancel }}
        </button>
        <button class="btn solid" @click="$emit('confirm')">
          {{ confirmLabel || t.confirm.confirm }}
        </button>
      </div>
    </div>
  </FloatingWindow>
</template>

<style scoped>
.confirm-card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-2);
}

.confirm-card h3 {
  margin: 0 0 var(--space-2);
  font-size: 1.4rem;
}

.confirm-card p {
  margin: 0 0 var(--space-4);
  color: var(--text-secondary);
}

.confirm-actions {
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
