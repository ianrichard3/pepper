<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { store } from '@/store'
import { strings } from '@/ui/strings'

const props = withDefaults(defineProps<{
  mode: 'add' | 'edit'
  patchbayId?: number
}>(), {
  patchbayId: 0,
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', payload: { id: number; mode: 'add' | 'edit' }): void
}>()

const t = strings
const saving = ref(false)
const tagInput = ref('')
const tagDraftColor = ref('#4f6f95')
const tagFieldRef = ref<HTMLElement | null>(null)
const tagDropdownOpen = ref(false)
const tagDropdownIndex = ref(0)
const TAG_SWATCHES = ['#4f6f95', '#3d7a58', '#d49a4f', '#b04b3d', '#8f5ab6', '#2f8898', '#9c6b43', '#6f7f2e']

const formState = reactive({
  id: 0,
  name: '',
  description: '',
  type: 'standard',
  panel: '',
  connector: '',
  tag: '',
})

const node = computed(() => {
  if (props.mode !== 'edit') return null
  return store.patchbayNodes.find((item) => item.id === props.patchbayId) || null
})

const knownTagNames = computed(() => store.patchbayTags.map((item) => item.name))
const filteredTagNames = computed(() => {
  const token = tagInput.value.trim().toLowerCase()
  if (!token) return knownTagNames.value
  return knownTagNames.value.filter((name) => name.toLowerCase().includes(token))
})
const hasTagMatches = computed(() => filteredTagNames.value.length > 0)
const selectedExistingTag = computed(() => store.getPatchbayTag(tagInput.value))
const canCreateTag = computed(() => {
  const token = tagInput.value.trim().toLowerCase()
  if (!token) return false
  return !store.patchbayTags.some((tag) => tag.name.trim().toLowerCase() === token)
})
const previewTagColor = computed(() => selectedExistingTag.value?.color || tagDraftColor.value)

function openTagDropdown() {
  tagDropdownOpen.value = true
  tagDropdownIndex.value = 0
}

function closeTagDropdown() {
  tagDropdownOpen.value = false
}

watch(filteredTagNames, (items) => {
  if (items.length === 0) {
    tagDropdownIndex.value = 0
    return
  }
  if (tagDropdownIndex.value >= items.length) {
    tagDropdownIndex.value = items.length - 1
  }
})

const getTagColor = (tag: string | null | undefined): string | null => {
  const token = String(tag || '').trim().toLowerCase()
  if (!token) return null
  return store.getPatchbayTag(token)?.color || null
}

const resetForm = () => {
  formState.id = 0
  formState.name = ''
  formState.description = ''
  formState.type = 'standard'
  formState.panel = ''
  formState.connector = ''
  formState.tag = ''
  tagInput.value = ''
  tagDraftColor.value = TAG_SWATCHES[0]
  closeTagDropdown()
}

const loadFromNode = () => {
  try {
    if (props.mode !== 'edit') {
      resetForm()
      return
    }
    if (!node.value) {
      resetForm()
      return
    }
    formState.id = node.value.id
    formState.name = node.value.name
    formState.description = node.value.description
    formState.type = node.value.type
    formState.panel = node.value.panel || ''
    formState.connector = node.value.connector || ''
    formState.tag = node.value.tag || ''
    tagInput.value = node.value.tag || ''
    tagDraftColor.value = getTagColor(node.value.tag) || TAG_SWATCHES[0]
    closeTagDropdown()
  } catch (err) {
    console.error('[PatchbayPointEditor] loadFromNode failed', err)
    store.pushToast({ type: 'error', message: t.toast.loadFailed })
  }
}

watch(() => [props.mode, props.patchbayId, store.patchbayNodes.length] as const, loadFromNode, { immediate: true })

const selectTag = (name: string) => {
  tagInput.value = name
  formState.tag = name
  const existing = store.getPatchbayTag(name)
  if (existing?.color) tagDraftColor.value = existing.color
  closeTagDropdown()
}

const handleTagKeydown = (event: KeyboardEvent) => {
  if (!tagDropdownOpen.value && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
    openTagDropdown()
  }
  if (!tagDropdownOpen.value) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!filteredTagNames.value.length) return
    tagDropdownIndex.value = Math.min(tagDropdownIndex.value + 1, filteredTagNames.value.length - 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!filteredTagNames.value.length) return
    tagDropdownIndex.value = Math.max(tagDropdownIndex.value - 1, 0)
    return
  }
  if (event.key === 'Enter' && filteredTagNames.value.length) {
    event.preventDefault()
    const chosen = filteredTagNames.value[tagDropdownIndex.value]
    if (chosen) selectTag(chosen)
    return
  }
  if (event.key === 'Escape') closeTagDropdown()
}

const handleOutsideClick = (event: Event) => {
  const target = event.target as Node | null
  if (!target) return
  if (!tagFieldRef.value?.contains(target)) closeTagDropdown()
}

onMounted(() => {
  window.addEventListener('pointerdown', handleOutsideClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleOutsideClick)
})

const createTagFromInput = async () => {
  const token = tagInput.value.trim()
  if (!token) return
  try {
    const created = await store.ensurePatchbayTag(token, tagDraftColor.value)
    formState.tag = created?.name || token
    tagInput.value = formState.tag
    closeTagDropdown()
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  }
}

const saveForm = async () => {
  if (saving.value) return
  if (!formState.name.trim()) {
    store.pushToast({ type: 'error', message: 'Name is required.' })
    return
  }
  if (props.mode === 'edit' && !node.value) {
    store.pushToast({ type: 'error', message: 'Patchbay point not found.' })
    return
  }
  const payload = {
    name: formState.name.trim(),
    description: formState.description.trim(),
    type: formState.type.trim() || 'standard',
    panel: formState.panel.trim() || null,
    connector: formState.connector.trim() || null,
    tag: (formState.tag || tagInput.value).trim() || null,
  }
  if (payload.tag) {
    await store.ensurePatchbayTag(payload.tag, tagDraftColor.value)
  }
  saving.value = true
  try {
    if (props.mode === 'add') {
      const created = await store.createPatchbayPoint(payload)
      store.pushToast({ type: 'success', message: t.toast.patchbayPointCreated })
      emit('saved', { id: created.id, mode: 'add' })
    } else {
      const updated = await store.updatePatchbayPoint(formState.id, payload)
      store.pushToast({ type: 'success', message: t.toast.patchbayPointUpdated })
      emit('saved', { id: updated.id, mode: 'edit' })
    }
    emit('close')
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="patchbay-point-editor">
    <div v-if="mode === 'edit' && !node" class="editor-missing">
      <p class="selectable-detail-text">Patch point not found.</p>
      <div class="form-actions">
        <button class="secondary" @click="emit('close')">{{ t.confirm.cancel }}</button>
      </div>
    </div>

    <template v-else>
      <div class="form-grid">
        <label>Name <input v-model="formState.name" :disabled="saving" /></label>
        <label>Type <input v-model="formState.type" :disabled="saving" /></label>
        <label>Panel <input v-model="formState.panel" :disabled="saving" /></label>
        <label>Connector <input v-model="formState.connector" :disabled="saving" /></label>
        <div class="tag-field" ref="tagFieldRef">
          <label>
            {{ t.patchbay.tagLabel }}
            <input
              v-model="tagInput"
              :disabled="saving"
              :placeholder="t.patchbay.newTagPlaceholder"
              @focus="openTagDropdown"
              @input="() => { formState.tag = tagInput; openTagDropdown() }"
              @keydown="handleTagKeydown"
            />
          </label>
          <div v-if="tagDropdownOpen && hasTagMatches" class="tag-dropdown">
            <button
              v-for="(tagName, idx) in filteredTagNames"
              :key="tagName"
              type="button"
              class="tag-option"
              :class="{ active: idx === tagDropdownIndex }"
              @click="selectTag(tagName)"
              @mouseenter="tagDropdownIndex = idx"
            >
              <span class="tag-dot" :style="{ background: store.getPatchbayTag(tagName)?.color || '#4f6f95' }"></span>
              <span>{{ tagName }}</span>
            </button>
          </div>
          <button v-if="canCreateTag" type="button" class="secondary tag-create-btn" :disabled="saving" @click="createTagFromInput">
            {{ t.patchbay.createTag }} "{{ tagInput }}"
          </button>
          <div class="tag-color-controls">
            <span class="tag-color-label">Color</span>
            <div class="tag-swatches">
              <button
                v-for="color in TAG_SWATCHES"
                :key="color"
                type="button"
                class="tag-swatch"
                :class="{ active: tagDraftColor.toLowerCase() === color.toLowerCase() }"
                :style="{ background: color }"
                :disabled="saving"
                @click="tagDraftColor = color"
              ></button>
            </div>
            <div class="tag-color-custom">
              <input v-model="tagDraftColor" type="color" :disabled="saving" />
              <span class="tag-preview-chip" :style="{ '--tag-color': previewTagColor }">{{ tagInput.trim() || 'Tag' }}</span>
            </div>
          </div>
        </div>
        <label class="full">Description <textarea v-model="formState.description" rows="3" :disabled="saving"></textarea></label>
      </div>
      <div class="form-actions">
        <button class="secondary" :disabled="saving" @click="emit('close')">{{ t.confirm.cancel }}</button>
        <button :disabled="saving" @click="saveForm">
          {{ saving ? t.devices.saving : t.confirm.confirm }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.patchbay-point-editor {
  display: grid;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  overflow: auto;
  align-content: start;
}

.editor-missing {
  display: grid;
  gap: var(--space-3);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
}

.tag-field {
  position: relative;
  display: grid;
  gap: 8px;
}

.form-grid .full {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid textarea {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 8px 10px;
  min-width: 0;
  box-sizing: border-box;
}

.secondary {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.tag-create-btn {
  width: fit-content;
}

.tag-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  box-shadow: var(--shadow-1);
  z-index: 20;
  max-height: 220px;
  overflow: auto;
}

.tag-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-bottom: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}

.tag-option:last-child {
  border-bottom: none;
}

.tag-option:hover,
.tag-option.active {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-1));
}

.tag-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
}

.tag-color-controls {
  display: grid;
  gap: 8px;
}

.tag-color-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.tag-swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid transparent;
  cursor: pointer;
}

.tag-swatch.active {
  border-color: var(--text-primary);
}

.tag-color-custom {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.tag-color-custom input[type='color'] {
  width: 34px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: transparent;
}

.tag-preview-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.78rem;
  background: color-mix(in srgb, var(--tag-color, #4f6f95) 24%, #fff);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.form-actions button {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 8px 12px;
  background: var(--surface-2);
  color: var(--text-primary);
  cursor: pointer;
}

@media (max-width: 980px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
