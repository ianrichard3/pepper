<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { WindowRect, WindowState } from '@/stores/windowManager'

const props = withDefaults(defineProps<{
  title: string
  rect: WindowRect
  state: WindowState
  zIndex: number
  variant?: 'tool' | 'utility' | 'confirm'
  showTitle?: boolean
  minWidth?: number
  minHeight?: number
}>(), {
  showTitle: true,
})

const emit = defineEmits<{
  (e: 'focus'): void
  (e: 'close'): void
  (e: 'move', payload: { x: number; y: number }): void
  (e: 'resize', payload: WindowRect): void
  (e: 'toggle-minimize'): void
  (e: 'toggle-maximize'): void
}>()

const minWidth = computed(() => props.minWidth ?? 300)
const minHeight = computed(() => props.minHeight ?? 180)
const variant = computed(() => props.variant ?? 'tool')
const showTitle = computed(() => props.showTitle)

const dragState = ref<null | {
  startX: number
  startY: number
  originX: number
  originY: number
}>(null)

const resizeState = ref<null | {
  edge: string
  startX: number
  startY: number
  origin: WindowRect
}>(null)

const styleObject = computed(() => {
  if (props.state === 'maximized') {
    return {
      left: '8px',
      top: '8px',
      width: 'calc(100% - 16px)',
      height: 'calc(100% - 16px)',
      zIndex: props.zIndex,
    }
  }
  const minimizedHeight = 42
  return {
    left: `${props.rect.x}px`,
    top: `${props.rect.y}px`,
    width: `${props.rect.width}px`,
    height: `${props.state === 'minimized' ? minimizedHeight : props.rect.height}px`,
    zIndex: props.zIndex,
  }
})

const onHeaderPointerDown = (event: PointerEvent) => {
  emit('focus')
  if (props.state === 'maximized') return
  if ((event.target as HTMLElement | null)?.closest('.window-btn')) return
  dragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: props.rect.x,
    originY: props.rect.y,
  }
}

const onResizePointerDown = (edge: string, event: PointerEvent) => {
  emit('focus')
  if (props.state !== 'normal') return
  event.stopPropagation()
  resizeState.value = {
    edge,
    startX: event.clientX,
    startY: event.clientY,
    origin: { ...props.rect },
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (dragState.value) {
    const x = dragState.value.originX + event.clientX - dragState.value.startX
    const y = dragState.value.originY + event.clientY - dragState.value.startY
    emit('move', { x, y })
    return
  }

  if (!resizeState.value) return
  const { edge, origin, startX, startY } = resizeState.value
  const deltaX = event.clientX - startX
  const deltaY = event.clientY - startY

  let next = { ...origin }
  if (edge.includes('right')) next.width = Math.max(minWidth.value, origin.width + deltaX)
  if (edge.includes('left')) {
    const width = Math.max(minWidth.value, origin.width - deltaX)
    next.x = origin.x + (origin.width - width)
    next.width = width
  }
  if (edge.includes('bottom')) next.height = Math.max(minHeight.value, origin.height + deltaY)
  if (edge.includes('top')) {
    const height = Math.max(minHeight.value, origin.height - deltaY)
    next.y = origin.y + (origin.height - height)
    next.height = height
  }

  emit('resize', next)
}

const onPointerUp = () => {
  dragState.value = null
  resizeState.value = null
}

window.addEventListener('pointermove', onPointerMove)
window.addEventListener('pointerup', onPointerUp)

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <section class="floating-window" :class="[`variant-${variant}`]" :style="styleObject" @pointerdown="emit('focus')">
    <header class="floating-window-header" @pointerdown="onHeaderPointerDown" @dblclick="emit('toggle-maximize')">
      <strong v-if="showTitle" class="window-title">{{ title }}</strong>
      <span v-else class="window-title-spacer" aria-hidden="true"></span>
      <div class="window-actions">
        <button class="window-btn" type="button" @click="emit('toggle-minimize')">
          {{ state === 'minimized' ? '+' : '-' }}
        </button>
        <button class="window-btn" type="button" @click="emit('toggle-maximize')">
          {{ state === 'maximized' ? 'o' : '[]' }}
        </button>
        <button class="window-btn" type="button" @click="emit('close')">x</button>
      </div>
    </header>

    <div v-if="state !== 'minimized'" class="floating-window-body">
      <slot />
    </div>

    <template v-if="state === 'normal'">
      <span class="resize-handle top" @pointerdown="onResizePointerDown('top', $event)" />
      <span class="resize-handle right" @pointerdown="onResizePointerDown('right', $event)" />
      <span class="resize-handle bottom" @pointerdown="onResizePointerDown('bottom', $event)" />
      <span class="resize-handle left" @pointerdown="onResizePointerDown('left', $event)" />
      <span class="resize-handle top-left" @pointerdown="onResizePointerDown('top-left', $event)" />
      <span class="resize-handle top-right" @pointerdown="onResizePointerDown('top-right', $event)" />
      <span class="resize-handle bottom-right" @pointerdown="onResizePointerDown('bottom-right', $event)" />
      <span class="resize-handle bottom-left" @pointerdown="onResizePointerDown('bottom-left', $event)" />
    </template>
  </section>
</template>

<style scoped>
.floating-window {
  position: absolute;
  border: 1px solid rgba(212, 154, 79, 0.45);
  border-radius: 12px;
  background: rgba(16, 14, 11, 0.96);
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.4);
  color: var(--text-primary);
  overflow: hidden;
  display: flex;
  flex-direction: column;
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
  margin-left: auto;
}

.window-title {
  line-height: 1.2;
}

.window-title-spacer {
  width: 1px;
  height: 1px;
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
  height: calc(100% - 42px);
  min-height: 0;
  overflow: hidden;
}

.floating-window.variant-tool .floating-window-body {
  padding: 0;
}

.floating-window.variant-utility .floating-window-body,
.floating-window.variant-confirm .floating-window-body {
  padding: 10px;
}

.floating-window.variant-confirm .floating-window-body {
  overflow: auto;
}

.resize-handle {
  position: absolute;
  background: transparent;
}

.resize-handle.top,
.resize-handle.bottom {
  height: 8px;
  left: 8px;
  right: 8px;
  cursor: ns-resize;
}

.resize-handle.top {
  top: -2px;
}

.resize-handle.bottom {
  bottom: -2px;
}

.resize-handle.left,
.resize-handle.right {
  width: 8px;
  top: 8px;
  bottom: 8px;
  cursor: ew-resize;
}

.resize-handle.left {
  left: -2px;
}

.resize-handle.right {
  right: -2px;
}

.resize-handle.top-left,
.resize-handle.top-right,
.resize-handle.bottom-right,
.resize-handle.bottom-left {
  width: 12px;
  height: 12px;
}

.resize-handle.top-left {
  top: -2px;
  left: -2px;
  cursor: nwse-resize;
}

.resize-handle.top-right {
  top: -2px;
  right: -2px;
  cursor: nesw-resize;
}

.resize-handle.bottom-right {
  bottom: -2px;
  right: -2px;
  cursor: nwse-resize;
}

.resize-handle.bottom-left {
  bottom: -2px;
  left: -2px;
  cursor: nesw-resize;
}
</style>
