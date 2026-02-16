<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { store } from '@/store'
import { windowManager } from '@/stores/windowManager'
import { strings } from '@/ui/strings'
import { buildDateStamp, downloadJsonFile } from '@/lib/download'
import { exportBundle, importApply, importPreview } from '@/services/portabilityApi'
import type {
  ExportScope,
  ImportApplyOptions,
  ImportApplyResponse,
  ImportPreviewResponse,
  PortabilityBundle,
  PortabilityConflict,
} from '@/types/portability'

const t = strings
const OPTIONS_STORAGE_KEY = 'pepper.portability.options.v1'

const props = withDefaults(defineProps<{
  floatingMode?: boolean
  parentWindowId?: string
}>(), {
  floatingMode: false,
  parentWindowId: '',
})

const exportScopes: Array<{ value: ExportScope; label: string; hint: string }> = [
  { value: 'ALL', label: 'All data', hint: 'Exports devices, patchbay, cables, and configurations.' },
  { value: 'DEVICES_ONLY', label: 'Devices only', hint: 'Defaults to devices + ports.' },
  { value: 'SELECTED_DEVICES', label: 'Selected devices', hint: 'Export selected devices and selected dependencies.' },
  { value: 'PATCHBAY_ONLY', label: 'Patchbay only', hint: 'Only patchbay points and related metadata.' },
  { value: 'CONNECTIONS_ONLY', label: 'Connections only', hint: 'Defaults to ports + patchbay points + patch cables.' },
]

const exportForm = reactive({
  scope: 'ALL' as ExportScope,
  selectedDeviceIds: [] as number[],
  include: {
    ports: true,
    patchbay_points: true,
    patch_cables: true,
    device_configurations: true,
  },
  loading: false,
  error: '',
})

const importStep = ref<'select' | 'preview' | 'options' | 'result'>('select')
const importFileName = ref('')
const importFileSize = ref(0)
const importRawJson = ref('')
const importParsedBundle = ref<PortabilityBundle | null>(null)
const previewResponse = ref<ImportPreviewResponse | null>(null)
const applyResponse = ref<ImportApplyResponse | null>(null)
const importLoadingPreview = ref(false)
const importLoadingApply = ref(false)
const importError = ref('')
const pasteMode = ref(false)
const pastedJson = ref('')
const dragOver = ref(false)

const importOptions = reactive<ImportApplyOptions>({
  mode: 'merge',
  name_duplicates: 'rename',
  patchbay_mapping_conflicts: 'remap_to_free',
  patch_cable_conflicts: 'skip_conflicts',
  config_conflicts: 'rename',
})

const showReplaceConfirm = ref(false)
const replaceConfirmInput = ref('')

const deviceSearch = ref('')
const filteredDevices = computed(() => {
  const query = deviceSearch.value.trim().toLowerCase()
  if (!query) return store.devices
  return store.devices.filter((device) => {
    return device.name.toLowerCase().includes(query) || device.type.toLowerCase().includes(query)
  })
})

const allFilteredSelected = computed(() => {
  const devices = filteredDevices.value
  if (!devices.length) return false
  const selected = new Set(exportForm.selectedDeviceIds)
  return devices.every((device) => selected.has(device.id))
})

const shouldShowSelectedDevices = computed(() => exportForm.scope === 'SELECTED_DEVICES')

const previewPlan = computed(() => {
  const plan = previewResponse.value?.plan
  const sum = (bucket: Record<string, number> | undefined) =>
    Object.values(bucket || {}).reduce((acc, value) => acc + Number(value || 0), 0)
  return {
    creates: sum(plan?.creates),
    updates: sum(plan?.updates),
    skips: sum(plan?.skips),
  }
})

const detectedEntityEntries = computed(() => {
  const detected = previewResponse.value?.detected || {}
  return Object.entries(detected).filter(([, present]) => Boolean(present))
})

const conflicts = computed(() => {
  return previewResponse.value?.conflicts || []
})

const conflictsByType = computed(() => {
  const grouped = new Map<string, PortabilityConflict[]>()
  for (const conflict of conflicts.value) {
    const type = conflict.type || 'UNKNOWN'
    const items = grouped.get(type) || []
    items.push(conflict)
    grouped.set(type, items)
  }
  return Array.from(grouped.entries())
})

const warningMessages = computed(() => {
  const warnings = previewResponse.value?.warnings || []
  return warnings.map((warning) => {
    if (typeof warning === 'string') return warning
    return warning.message || warning.type || 'Warning'
  })
})

const planBreakdownEntries = computed(() => {
  const plan = previewResponse.value?.plan
  const creates = plan?.creates || {}
  const updates = plan?.updates || {}
  const skips = plan?.skips || {}
  const keys = new Set([...Object.keys(creates), ...Object.keys(updates), ...Object.keys(skips)])
  return Array.from(keys).map((key) => ({
    entity: key,
    creates: Number(creates[key] || 0),
    updates: Number(updates[key] || 0),
    skips: Number(skips[key] || 0),
  }))
})

const hasMissingDependencies = computed(() => {
  if (previewResponse.value?.can_apply === false) return true
  if ((previewResponse.value?.blocking_errors || []).length > 0) return true
  return conflicts.value.some((conflict) => {
    const type = (conflict.type || '').toUpperCase()
    const severity = (conflict.severity || '').toLowerCase()
    return type === 'MISSING_DEPENDENCY' || severity === 'error_missing_dependency'
  })
})

const hasFailStrategyRisk = computed(() => {
  if (!conflicts.value.length) return false
  return (
    importOptions.patchbay_mapping_conflicts === 'fail' ||
    importOptions.patch_cable_conflicts === 'fail'
  )
})

const canApplyImport = computed(() => {
  if (!previewResponse.value || !importParsedBundle.value) return false
  if (importLoadingApply.value) return false
  if (importOptions.mode === 'replace') return replaceConfirmInput.value === 'REPLACE'
  return true
})

watch(
  () => exportForm.scope,
  (scope) => {
    exportForm.error = ''
    applyDefaultIncludeForScope(scope)
    if (scope !== 'SELECTED_DEVICES') {
      exportForm.selectedDeviceIds = []
    }
  },
  { immediate: true }
)

watch(
  () => importOptions.mode,
  (mode) => {
    if (mode !== 'replace') {
      replaceConfirmInput.value = ''
      showReplaceConfirm.value = false
    }
  }
)

onMounted(() => {
  const raw = window.localStorage.getItem(OPTIONS_STORAGE_KEY)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || !parsed) return
    if (parsed.mode === 'merge' || parsed.mode === 'replace') importOptions.mode = parsed.mode
    if (
      parsed.name_duplicates === 'rename' ||
      parsed.name_duplicates === 'skip' ||
      parsed.name_duplicates === 'overwrite_if_fingerprint_match'
    ) {
      importOptions.name_duplicates = parsed.name_duplicates
    }
    if (
      parsed.patchbay_mapping_conflicts === 'remap_to_free' ||
      parsed.patchbay_mapping_conflicts === 'skip_mapping' ||
      parsed.patchbay_mapping_conflicts === 'fail'
    ) {
      importOptions.patchbay_mapping_conflicts = parsed.patchbay_mapping_conflicts
    }
    if (parsed.patch_cable_conflicts === 'skip_conflicts' || parsed.patch_cable_conflicts === 'fail') {
      importOptions.patch_cable_conflicts = parsed.patch_cable_conflicts
    }
    if (
      parsed.config_conflicts === 'rename' ||
      parsed.config_conflicts === 'skip' ||
      parsed.config_conflicts === 'overwrite_if_fingerprint_match'
    ) {
      importOptions.config_conflicts = parsed.config_conflicts
    }
  } catch {
    window.localStorage.removeItem(OPTIONS_STORAGE_KEY)
  }
})

watch(
  () => ({ ...importOptions }),
  (options) => {
    window.localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(options))
  },
  { deep: true }
)

function applyDefaultIncludeForScope(scope: ExportScope) {
  if (scope === 'ALL') {
    exportForm.include.ports = true
    exportForm.include.patchbay_points = true
    exportForm.include.patch_cables = true
    exportForm.include.device_configurations = true
    return
  }
  if (scope === 'DEVICES_ONLY' || scope === 'SELECTED_DEVICES') {
    exportForm.include.ports = true
    exportForm.include.patchbay_points = false
    exportForm.include.patch_cables = false
    exportForm.include.device_configurations = true
    return
  }
  if (scope === 'PATCHBAY_ONLY') {
    exportForm.include.ports = false
    exportForm.include.patchbay_points = true
    exportForm.include.patch_cables = false
    exportForm.include.device_configurations = false
    return
  }
  exportForm.include.ports = true
  exportForm.include.patchbay_points = true
  exportForm.include.patch_cables = true
  exportForm.include.device_configurations = false
}

function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function toggleSelectAllFiltered() {
  const ids = filteredDevices.value.map((device) => device.id)
  if (!ids.length) return

  if (allFilteredSelected.value) {
    const toRemove = new Set(ids)
    exportForm.selectedDeviceIds = exportForm.selectedDeviceIds.filter((id) => !toRemove.has(id))
    return
  }

  const merged = new Set(exportForm.selectedDeviceIds)
  for (const id of ids) merged.add(id)
  exportForm.selectedDeviceIds = Array.from(merged)
}

async function runExport() {
  exportForm.error = ''
  if (exportForm.scope === 'SELECTED_DEVICES' && exportForm.selectedDeviceIds.length === 0) {
    exportForm.error = 'Select at least one device for selected-devices export.'
    return
  }

  exportForm.loading = true
  try {
    const payload = {
      scope: exportForm.scope,
      include: { ...exportForm.include },
      selected_device_ids:
        exportForm.scope === 'SELECTED_DEVICES' ? exportForm.selectedDeviceIds : undefined,
    }

    const bundle = await exportBundle(payload)
    const fileName = `workspace-export-${buildDateStamp()}.json`
    downloadJsonFile(bundle, fileName)
    store.pushToast({ type: 'success', message: `Export downloaded: ${fileName}` })
  } catch (err: any) {
    exportForm.error = err?.message || 'Failed to export workspace bundle.'
    store.pushToast({ type: 'error', message: exportForm.error })
  } finally {
    exportForm.loading = false
  }
}

function resetImportFlow() {
  importStep.value = 'select'
  importFileName.value = ''
  importFileSize.value = 0
  importRawJson.value = ''
  importParsedBundle.value = null
  previewResponse.value = null
  applyResponse.value = null
  importError.value = ''
  pastedJson.value = ''
  replaceConfirmInput.value = ''
  showReplaceConfirm.value = false
}

async function parseAndSetBundle(rawText: string, fileName = '', fileSize = 0) {
  importError.value = ''
  try {
    const parsed = JSON.parse(rawText) as PortabilityBundle
    importRawJson.value = rawText
    importParsedBundle.value = parsed
    importFileName.value = fileName
    importFileSize.value = fileSize
    previewResponse.value = null
    applyResponse.value = null
    importStep.value = 'select'
  } catch (err: any) {
    const message = err?.message || 'Invalid JSON file.'
    importError.value = `JSON parse error: ${message}`
    importParsedBundle.value = null
  }
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!file.name.toLowerCase().endsWith('.json') && !file.type.includes('json')) {
    importError.value = 'Invalid file type. Please select a .json file.'
    return
  }

  const text = await file.text()
  await parseAndSetBundle(text, file.name, file.size)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.json') && !file.type.includes('json')) {
    importError.value = 'Invalid file type. Please select a .json file.'
    return
  }
  file
    .text()
    .then((text) => parseAndSetBundle(text, file.name, file.size))
    .catch((err: any) => {
      importError.value = err?.message || 'Failed to read file.'
    })
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  dragOver.value = true
}

function onDragLeave(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
}

async function parsePastedJson() {
  if (!pastedJson.value.trim()) {
    importError.value = 'Paste bundle JSON to continue.'
    return
  }
  await parseAndSetBundle(pastedJson.value.trim(), 'pasted-bundle.json', pastedJson.value.length)
}

async function runPreview() {
  if (!importParsedBundle.value) {
    importError.value = 'Select or paste a JSON bundle before previewing.'
    return
  }

  importError.value = ''
  importLoadingPreview.value = true
  try {
    previewResponse.value = await importPreview(importParsedBundle.value)
    importStep.value = 'preview'
  } catch (err: any) {
    importError.value = err?.message || 'Preview failed.'
  } finally {
    importLoadingPreview.value = false
  }
}

function continueToOptions() {
  if (!previewResponse.value || hasMissingDependencies.value) return
  importStep.value = 'options'
}

async function executeApply() {
  if (!importParsedBundle.value) return

  importLoadingApply.value = true
  importError.value = ''
  try {
    applyResponse.value = await importApply({
      bundle: importParsedBundle.value,
      options: {
        mode: importOptions.mode,
        name_duplicates: importOptions.name_duplicates,
        patchbay_mapping_conflicts: importOptions.patchbay_mapping_conflicts,
        patch_cable_conflicts: importOptions.patch_cable_conflicts,
        config_conflicts: importOptions.config_conflicts,
      },
    })
    importStep.value = 'result'
    await store.loadData()
    store.pushToast({ type: 'success', message: 'Import applied successfully.' })
  } catch (err: any) {
    importError.value = err?.message || 'Import apply failed.'
  } finally {
    importLoadingApply.value = false
  }
}

async function onApplyImport() {
  if (importOptions.mode === 'replace' && replaceConfirmInput.value !== 'REPLACE') {
    if (props.floatingMode) {
      const parentId = props.parentWindowId || windowManager.getToolWindow('portability')?.id || 'tool:portability'
      windowManager.openChildWindow(
        parentId,
        'portability-replace-confirm',
        'Confirm replace mode',
        {
          requiredText: 'REPLACE',
          onConfirm: (input: string) => {
            replaceConfirmInput.value = input
            if (input === 'REPLACE') {
              void executeApply()
            }
          },
        },
        { id: `portability-replace-confirm:${parentId}` },
      )
      return
    }
    showReplaceConfirm.value = true
    return
  }
  await executeApply()
}

function confirmReplaceAndApply() {
  showReplaceConfirm.value = false
  if (replaceConfirmInput.value !== 'REPLACE') return
  void executeApply()
}

function downloadApplyReport() {
  if (!applyResponse.value) return
  const fileName = `workspace-import-report-${buildDateStamp()}.json`
  downloadJsonFile(applyResponse.value, fileName)
}

async function refreshWorkspaceData() {
  try {
    await store.loadData()
    store.pushToast({ type: 'success', message: 'Workspace data refreshed.' })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || 'Failed to refresh workspace data.' })
  }
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
</script>

<template>
  <section class="portability-page" :class="{ 'floating-mode': props.floatingMode }">
    <header class="portability-header">
      <div v-if="!props.floatingMode">
        <h2>{{ t.portability.title }}</h2>
        <p>{{ t.portability.subtitle }}</p>
      </div>
      <button class="ghost-btn" type="button" @click="resetImportFlow">Start over</button>
    </header>

    <div class="portability-grid">
      <article class="panel">
        <h3 v-if="!props.floatingMode">{{ t.portability.exportTitle }}</h3>

        <label class="field-label" for="export-scope">Scope</label>
        <select id="export-scope" v-model="exportForm.scope" class="input">
          <option v-for="scope in exportScopes" :key="scope.value" :value="scope.value">
            {{ scope.label }}
          </option>
        </select>
        <p class="field-hint">
          {{ exportScopes.find((scope) => scope.value === exportForm.scope)?.hint }}
        </p>

        <div v-if="shouldShowSelectedDevices" class="selected-devices">
          <div class="selected-devices-top">
            <label class="field-label" for="device-search">Select devices</label>
            <button class="ghost-btn" type="button" @click="toggleSelectAllFiltered">
              {{ allFilteredSelected ? 'Clear filtered' : 'Select filtered' }}
            </button>
          </div>
          <input
            id="device-search"
            v-model="deviceSearch"
            class="input"
            type="search"
            placeholder="Search devices"
          />
          <div class="device-list">
            <label v-for="device in filteredDevices" :key="device.id" class="device-item">
              <input v-model="exportForm.selectedDeviceIds" type="checkbox" :value="device.id" />
              <span>{{ device.name }}</span>
              <small>{{ device.type }}</small>
            </label>
            <p v-if="!filteredDevices.length" class="empty-copy">No devices match your search.</p>
          </div>
        </div>

        <fieldset class="include-grid">
          <legend>Include</legend>
          <label>
            <input v-model="exportForm.include.ports" type="checkbox" />
            Ports
          </label>
          <label>
            <input v-model="exportForm.include.patchbay_points" type="checkbox" />
            Patchbay points
          </label>
          <label>
            <input v-model="exportForm.include.patch_cables" type="checkbox" />
            Patch cables
          </label>
          <label>
            <input v-model="exportForm.include.device_configurations" type="checkbox" />
            Device configurations
          </label>
        </fieldset>

        <p v-if="exportForm.error" class="error-copy">{{ exportForm.error }}</p>

        <button class="primary-btn" type="button" :disabled="exportForm.loading" @click="runExport">
          {{ exportForm.loading ? 'Exporting…' : 'Download JSON export' }}
        </button>
      </article>

      <article class="panel import-panel">
        <h3 v-if="!props.floatingMode">{{ t.portability.importTitle }}</h3>

        <div class="steps">
          <span :class="{ active: importStep === 'select' }">1 Select</span>
          <span :class="{ active: importStep === 'preview' }">2 Preview</span>
          <span :class="{ active: importStep === 'options' }">3 Options</span>
          <span :class="{ active: importStep === 'result' }">4 Result</span>
        </div>

        <div v-if="importStep === 'select'" class="step-panel">
          <label
            class="drop-zone"
            :class="{ drag: dragOver }"
            @drop="onDrop"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
          >
            <input class="hidden-input" type="file" accept=".json,application/json" @change="onFileSelected" />
            <span>Drop JSON bundle here, or browse file</span>
            <small>Accepts `.json` export bundles.</small>
          </label>

          <button class="ghost-btn" type="button" @click="pasteMode = !pasteMode">
            {{ pasteMode ? 'Hide paste mode' : 'Paste JSON instead' }}
          </button>

          <div v-if="pasteMode" class="paste-mode">
            <textarea v-model="pastedJson" rows="10" placeholder="Paste bundle JSON"></textarea>
            <button class="ghost-btn" type="button" @click="parsePastedJson">Parse pasted JSON</button>
          </div>

          <div v-if="importParsedBundle" class="file-chip">
            <strong>{{ importFileName || 'Bundle ready' }}</strong>
            <span>{{ humanFileSize(importFileSize) }}</span>
          </div>

          <button
            class="primary-btn"
            type="button"
            :disabled="!importParsedBundle || importLoadingPreview"
            @click="runPreview"
          >
            {{ importLoadingPreview ? 'Previewing…' : 'Preview import' }}
          </button>
        </div>

        <div v-if="importStep === 'preview'" class="step-panel">
          <div class="summary-cards">
            <div class="summary-card">
              <span>Creates</span>
              <strong>{{ previewPlan.creates }}</strong>
            </div>
            <div class="summary-card">
              <span>Updates</span>
              <strong>{{ previewPlan.updates }}</strong>
            </div>
            <div class="summary-card">
              <span>Skips</span>
              <strong>{{ previewPlan.skips }}</strong>
            </div>
          </div>

          <div v-if="detectedEntityEntries.length" class="entity-list">
            <h4>Detected entities</h4>
            <ul>
              <li v-for="[entityType] in detectedEntityEntries" :key="entityType">
                {{ toTitleCase(entityType) }}
              </li>
            </ul>
          </div>

          <div v-if="planBreakdownEntries.length" class="entity-list">
            <h4>Plan breakdown</h4>
            <ul>
              <li v-for="row in planBreakdownEntries" :key="row.entity">
                {{ toTitleCase(row.entity) }}: +{{ row.creates }} / ~{{ row.updates }} / ={{ row.skips }}
              </li>
            </ul>
          </div>

          <div v-if="conflictsByType.length" class="conflict-list">
            <h4>Conflicts</h4>
            <div v-for="[type, items] in conflictsByType" :key="type" class="conflict-group">
              <strong>{{ type }} ({{ items.length }})</strong>
              <ul>
                <li v-for="(item, index) in items" :key="`${type}-${index}`">
                  {{ item.message || 'Conflict detected.' }}
                </li>
              </ul>
            </div>
          </div>

          <div v-if="warningMessages.length" class="warning-list">
            <h4>Warnings</h4>
            <ul>
              <li v-for="(warning, index) in warningMessages" :key="`${warning}-${index}`">{{ warning }}</li>
            </ul>
          </div>

          <p v-if="hasMissingDependencies" class="error-copy">
            This bundle has missing dependencies and cannot be imported as-is.
          </p>

          <div class="step-actions">
            <button class="ghost-btn" type="button" @click="importStep = 'select'">Back</button>
            <button class="primary-btn" type="button" :disabled="hasMissingDependencies" @click="continueToOptions">
              Continue to import options
            </button>
          </div>
        </div>

        <div v-if="importStep === 'options'" class="step-panel">
          <div class="option-grid">
            <label>
              Import mode
              <select v-model="importOptions.mode">
                <option value="merge">Merge (recommended)</option>
                <option value="replace">Replace (danger)</option>
              </select>
            </label>

            <label>
              Name duplicates
              <select v-model="importOptions.name_duplicates">
                <option value="rename">Rename (recommended)</option>
                <option value="skip">Skip</option>
                <option value="overwrite_if_fingerprint_match">Overwrite if fingerprint matches</option>
              </select>
            </label>

            <label>
              Patchbay mapping conflicts
              <select v-model="importOptions.patchbay_mapping_conflicts">
                <option value="remap_to_free">Remap to free (recommended)</option>
                <option value="skip_mapping">Skip mapping</option>
                <option value="fail">Fail on conflict</option>
              </select>
            </label>

            <label>
              Patch cable conflicts
              <select v-model="importOptions.patch_cable_conflicts">
                <option value="skip_conflicts">Skip conflicts (recommended)</option>
                <option value="fail">Fail on conflict</option>
              </select>
            </label>

            <label>
              Device config conflicts
              <select v-model="importOptions.config_conflicts">
                <option value="rename">Rename (recommended)</option>
                <option value="skip">Skip</option>
                <option value="overwrite_if_fingerprint_match">Overwrite if fingerprint matches</option>
              </select>
            </label>
          </div>

          <div v-if="importOptions.mode === 'replace'" class="danger-box">
            <strong>Replace mode selected</strong>
            <p>This can replace workspace data. Type <code>REPLACE</code> to unlock apply.</p>
            <input v-model="replaceConfirmInput" class="input" placeholder="Type REPLACE" />
          </div>

          <p v-if="hasFailStrategyRisk" class="warning-copy">
            Fail strategies selected. Apply can fail if conflicts remain.
          </p>

          <div class="step-actions">
            <button class="ghost-btn" type="button" @click="importStep = 'preview'">Back to preview</button>
            <button class="primary-btn" type="button" :disabled="!canApplyImport" @click="onApplyImport">
              {{ importLoadingApply ? 'Applying…' : 'Apply import' }}
            </button>
          </div>
        </div>

        <div v-if="importStep === 'result'" class="step-panel">
          <h4>Import report</h4>
          <pre>{{ JSON.stringify(applyResponse, null, 2) }}</pre>

          <div class="step-actions">
            <button class="ghost-btn" type="button" @click="downloadApplyReport">Download report JSON</button>
            <button class="ghost-btn" type="button" @click="refreshWorkspaceData">Refresh workspace data</button>
            <button class="primary-btn" type="button" @click="resetImportFlow">Start over</button>
          </div>
        </div>

        <p v-if="importError" class="error-copy">{{ importError }}</p>
      </article>
    </div>

    <div v-if="showReplaceConfirm && !props.floatingMode" class="replace-overlay" role="dialog" aria-modal="true">
      <div class="replace-card">
        <h3>Confirm replace mode</h3>
        <p>This operation can replace workspace data. Type <code>REPLACE</code> to continue.</p>
        <input v-model="replaceConfirmInput" class="input" placeholder="Type REPLACE" />
        <div class="replace-actions">
          <button class="ghost-btn" type="button" @click="showReplaceConfirm = false">Cancel</button>
          <button
            class="primary-btn"
            type="button"
            :disabled="replaceConfirmInput !== 'REPLACE'"
            @click="confirmReplaceAndApply"
          >
            Confirm and apply
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.portability-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  height: 100%;
  overflow: auto;
  min-height: 0;
}

.portability-page.floating-mode {
  gap: var(--space-2);
  padding: var(--space-2);
}

.portability-header {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  align-items: flex-start;
}

.portability-page.floating-mode .portability-header {
  align-items: center;
  gap: var(--space-2);
}

.portability-header h2 {
  margin: 0 0 var(--space-1);
  font-size: 1.8rem;
}

.portability-header p {
  margin: 0;
  color: var(--text-secondary);
}

.portability-grid {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: var(--space-4);
  min-height: 0;
}

.panel {
  background: rgba(28, 25, 21, 0.9);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
}

.portability-page.floating-mode .panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: var(--space-2);
}

.import-panel {
  overflow: auto;
}

.portability-page.floating-mode .import-panel {
  overflow: visible;
}

.panel h3 {
  margin: 0;
  font-size: 1.4rem;
}

.portability-page.floating-mode h2,
.portability-page.floating-mode h3,
.portability-page.floating-mode h4,
.portability-page.floating-mode h5 {
  display: none;
}

.field-label {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.field-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.selected-devices-top {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  align-items: center;
}

.device-list {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  max-height: 220px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.device-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-2);
  align-items: center;
}

.device-item small {
  color: var(--text-muted);
}

.empty-copy {
  color: var(--text-muted);
  margin: 0;
}

.include-grid {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-3);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}

.include-grid legend {
  padding: 0 var(--space-1);
  color: var(--text-secondary);
}

.steps {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.steps span {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-round);
  padding: 4px 10px;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.steps span.active {
  border-color: var(--accent);
  color: var(--text-primary);
}

.step-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.drop-zone {
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-3);
  min-height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  flex-direction: column;
  gap: var(--space-1);
  color: var(--text-secondary);
  cursor: pointer;
}

.drop-zone.drag {
  border-color: var(--accent-2);
  background: rgba(61, 122, 88, 0.12);
}

.hidden-input {
  display: none;
}

.paste-mode {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.file-chip {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: flex;
  justify-content: space-between;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}

.summary-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-card span {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.entity-list ul,
.warning-list ul,
.conflict-group ul {
  margin: var(--space-1) 0 0;
  padding-left: 20px;
}

.conflict-list {
  border: 1px solid rgba(176, 75, 61, 0.4);
  background: rgba(176, 75, 61, 0.08);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}

.conflict-group + .conflict-group {
  margin-top: var(--space-2);
}

.warning-list {
  border: 1px solid rgba(212, 154, 79, 0.5);
  background: rgba(212, 154, 79, 0.08);
  border-radius: var(--radius-2);
  padding: var(--space-2);
}

.option-grid {
  display: grid;
  gap: var(--space-2);
}

.option-grid label {
  display: grid;
  gap: var(--space-1);
}

.danger-box {
  border: 1px solid rgba(176, 75, 61, 0.6);
  background: rgba(176, 75, 61, 0.12);
  border-radius: var(--radius-2);
  padding: var(--space-3);
}

.danger-box p {
  margin: var(--space-1) 0 var(--space-2);
  color: var(--text-secondary);
}

.step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.ghost-btn,
.primary-btn {
  border-radius: var(--radius-2);
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn {
  background: transparent;
  color: var(--text-secondary);
}

.primary-btn {
  border-color: transparent;
  background: var(--accent);
  color: #11130f;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-copy {
  margin: 0;
  color: #ffb5ab;
}

.warning-copy {
  margin: 0;
  color: var(--warning);
}

pre {
  max-height: 280px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: #14120f;
  padding: var(--space-2);
  font-size: 0.82rem;
}

.replace-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6, 6, 5, 0.72);
  display: grid;
  place-items: center;
  z-index: 2500;
}

.replace-card {
  width: min(460px, calc(100% - 32px));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  background: var(--surface-2);
  padding: var(--space-4);
  display: grid;
  gap: var(--space-2);
}

.replace-card h3,
.replace-card p {
  margin: 0;
}

.replace-card p {
  color: var(--text-secondary);
}

.replace-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 1100px) {
  .portability-grid {
    grid-template-columns: 1fr;
  }
}
</style>
