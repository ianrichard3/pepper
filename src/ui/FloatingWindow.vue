<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  initialX?: number
  initialY?: number
  initialWidth?: number
  initialMinimized?: boolean
}>(), {
  initialX: 32,
  initialY: 96,
  initialWidth: 320,
  initialMinimized: false,
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const x = ref(props.initialX)
const y = ref(props.initialY)
const minimized = ref(props.initialMinimized)

const dragging = ref<null | {
  startX: number
  startY: number
  originX: number
  originY: number
}>(null)

const windowStyle = computed(() => ({
  left: `${x.value}px`,
  top: `${y.value}px`,
  width: `${props.initialWidth}px`,
}))

const onHeaderPointerDown = (event: PointerEvent) => {
  if ((event.target as HTMLElement | null)?.closest('.window-btn')) return
  dragging.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: x.value,
    originY: y.value,
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (!dragging.value) return
  x.value = Math.max(8, dragging.value.originX + event.clientX - dragging.value.startX)
  y.value = Math.max(8, dragging.value.originY + event.clientY - dragging.value.startY)
}

const onPointerUp = () => {
  dragging.value = null
}

window.addEventListener('pointermove', onPointerMove)
window.addEventListener('pointerup', onPointerUp)

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <section class="floating-window" :class="{ minimized }" :style="windowStyle">
    <header class="floating-window-header" @pointerdown="onHeaderPointerDown">
      <strong>{{ title }}</strong>
      <div class="window-actions">
        <button class="window-btn" type="button" @click="minimized = !minimized">{{ minimized ? '+' : '-' }}</button>
        <button class="window-btn" type="button" @click="emit('close')">x</button>
      </div>
    </header>

    <div v-if="!minimized" class="floating-window-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.floating-window {
  position: fixed;
  z-index: 1400;
  border: 1px solid rgba(212, 154, 79, 0.45);
  border-radius: 12px;
  background: rgba(16, 14, 11, 0.96);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.4);
  color: var(--text-primary);
  overflow: hidden;
}

.floating-window.minimized {
  width: 260px !important;
}

.floating-window-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: linear-gradient(180deg, rgba(50, 42, 31, 0.95), rgba(34, 29, 23, 0.95));
  border-bottom: 1px solid rgba(212, 154, 79, 0.25);
  cursor: grab;
  user-select: none;
}

.floating-window-header:active {
  cursor: grabbing;
}

.window-actions {
  display: inline-flex;
  gap: 6px;
}

.window-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid rgba(191, 170, 131, 0.45);
  background: rgba(20, 18, 15, 0.82);
  color: var(--text-secondary);
  cursor: pointer;
}

.window-btn:hover {
  border-color: rgba(212, 154, 79, 0.8);
  color: var(--text-primary);
}

.floating-window-body {
  padding: 10px;
  max-height: 56vh;
  overflow: auto;
}
</style>
