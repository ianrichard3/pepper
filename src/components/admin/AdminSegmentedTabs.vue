<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface TabItem {
  id: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  items: TabItem[]
  modelValue: string
  size?: 'sm' | 'md'
  fullWidth?: boolean
}>(), {
  size: 'md',
  fullWidth: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const buttonRefs = ref<Array<HTMLButtonElement | null>>([])
const indicator = ref({ left: 0, width: 0, ready: false })

const activeIndex = computed(() => {
  const index = props.items.findIndex((item) => item.id === props.modelValue)
  return index >= 0 ? index : 0
})

const rootStyle = computed(() => ({
  '--seg-count': String(Math.max(props.items.length, 1)),
}))

function setButtonRef(index: number, el: HTMLButtonElement | null) {
  buttonRefs.value[index] = el
}

function selectTab(id: string) {
  if (id === props.modelValue) return
  emit('update:modelValue', id)
  emit('change', id)
}

function focusTab(index: number) {
  const target = buttonRefs.value[index]
  target?.focus()
}

function onKeydown(event: KeyboardEvent, index: number) {
  const total = props.items.length
  if (!total) return
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    for (let step = 1; step <= total; step += 1) {
      const next = (index + step) % total
      if (!props.items[next]?.disabled) {
        focusTab(next)
        selectTab(props.items[next]!.id)
        return
      }
    }
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    for (let step = 1; step <= total; step += 1) {
      const next = (index - step + total) % total
      if (!props.items[next]?.disabled) {
        focusTab(next)
        selectTab(props.items[next]!.id)
        return
      }
    }
  }
  if (event.key === 'Home') {
    event.preventDefault()
    const next = props.items.findIndex((item) => !item.disabled)
    if (next >= 0) {
      focusTab(next)
      selectTab(props.items[next]!.id)
    }
  }
  if (event.key === 'End') {
    event.preventDefault()
    const next = [...props.items].map((_, i) => i).reverse().find((i) => !props.items[i]?.disabled)
    if (typeof next === 'number') {
      focusTab(next)
      selectTab(props.items[next]!.id)
    }
  }
}

function updateIndicator() {
  const root = rootRef.value
  const activeButton = buttonRefs.value[activeIndex.value]
  if (!root || !activeButton) {
    indicator.value.ready = false
    return
  }
  const rootRect = root.getBoundingClientRect()
  const buttonRect = activeButton.getBoundingClientRect()
  indicator.value = {
    left: Math.max(buttonRect.left - rootRect.left, 0),
    width: buttonRect.width,
    ready: true,
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  updateIndicator()
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    resizeObserver = new ResizeObserver(() => updateIndicator())
    resizeObserver.observe(rootRef.value)
    for (const btn of buttonRefs.value) {
      if (btn) resizeObserver.observe(btn)
    }
  }
  window.addEventListener('resize', updateIndicator)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateIndicator)
})

watch(() => props.modelValue, async () => {
  await nextTick()
  updateIndicator()
})

watch(() => props.items.map((item) => `${item.id}:${item.label}:${Boolean(item.disabled)}`).join('|'), async () => {
  await nextTick()
  updateIndicator()
})
</script>

<template>
  <nav
    ref="rootRef"
    class="seg-tabs"
    :class="[`size-${props.size}`, { 'full-width': props.fullWidth }]"
    :style="rootStyle"
    role="tablist"
    aria-orientation="horizontal"
  >
    <div
      class="seg-indicator"
      :class="{ ready: indicator.ready }"
      :style="{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }"
      aria-hidden="true"
    />

    <button
      v-for="(item, index) in props.items"
      :key="item.id"
      :ref="(el) => setButtonRef(index, el as HTMLButtonElement | null)"
      class="seg-tab"
      :class="{ active: item.id === props.modelValue }"
      :disabled="item.disabled"
      type="button"
      role="tab"
      :aria-selected="item.id === props.modelValue"
      :tabindex="item.id === props.modelValue ? 0 : -1"
      @click="selectTab(item.id)"
      @keydown="onKeydown($event, index)"
    >
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.seg-tabs {
  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  align-items: center;
  align-self: start;
  justify-self: start;
  gap: 3px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--border-default) 85%, white 8%);
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 88%, white 3%), color-mix(in oklab, var(--surface-2) 94%, black 3%));
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, white 14%, transparent),
    inset 0 -1px 0 color-mix(in oklab, black 12%, transparent);
  width: fit-content;
  overflow: hidden;
}

.seg-tabs.full-width {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(var(--seg-count, 1), minmax(0, 1fr));
  justify-self: stretch;
}

.seg-indicator {
  position: absolute;
  top: 5px;
  bottom: 5px;
  left: 0;
  border-radius: 999px;
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--accent) 92%, white 6%), color-mix(in oklab, var(--accent) 88%, black 10%));
  box-shadow:
    0 6px 14px color-mix(in oklab, var(--accent) 22%, transparent),
    inset 0 1px 0 color-mix(in oklab, white 30%, transparent);
  opacity: 0;
  transition:
    transform 190ms cubic-bezier(0.2, 0.7, 0.2, 1),
    width 190ms cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 120ms ease;
  will-change: transform, width;
  pointer-events: none;
}

.seg-indicator.ready {
  opacity: 1;
}

.seg-tab {
  position: relative;
  z-index: 1;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 999px;
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  transition:
    color 160ms ease,
    transform 160ms ease,
    opacity 160ms ease;
}

.seg-tab:hover:not(:disabled) {
  color: var(--text-primary);
  transform: translateY(-1px);
}

.seg-tab.active {
  color: #11130f;
}

.seg-tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.seg-tab:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--accent) 70%, white 15%);
  outline-offset: 2px;
}

.seg-tab span {
  display: inline-block;
  white-space: nowrap;
  line-height: 1;
}

.size-sm .seg-tab {
  padding: 7px 12px;
  font-size: 0.80rem;
}

.size-md .seg-tab {
  padding: 12px 14px;
  font-size: 0.84rem;
}

@media (prefers-reduced-motion: reduce) {
  .seg-indicator,
  .seg-tab {
    transition: none;
  }
  .seg-tab:hover:not(:disabled) {
    transform: none;
  }
}
</style>
