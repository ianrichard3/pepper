export type ExportScope =
  | 'ALL'
  | 'DEVICES_ONLY'
  | 'SELECTED_DEVICES'
  | 'PATCHBAY_ONLY'
  | 'CONNECTIONS_ONLY'

export interface ExportInclude {
  ports: boolean
  patchbay_points: boolean
  connections: boolean
  device_configurations: boolean
}

export interface ExportBundlePayload {
  scope: ExportScope
  device_ids?: number[]
  include: ExportInclude
}

export interface Manifest {
  schema_version?: string
  exported_at?: string
  source?: {
    app?: string
    [key: string]: unknown
  }
  scope?: ExportScope | string
  included?: string[]
  [key: string]: unknown
}

export interface BundleDevice {
  export_id: string
  name: string
  type?: string | null
  category?: string | null
  location?: string | null
  tags?: string[]
  quantity_available?: number | null
  fingerprint?: string
  [key: string]: unknown
}

export interface BundlePort {
  export_id: string | number
  device_export_id: string
  label?: string | null
  type?: string | null
  direction?: string | null
  signal_type?: string | null
  connector?: string | null
  level?: string | null
  balanced?: string | boolean | null
  phantom_capable?: boolean | null
  phantom_safe?: boolean | null
  impedance_class?: string | null
  tags?: string[]
  patchbay_export_id?: string | null
  [key: string]: unknown
}

export interface BundlePatchbayPoint {
  export_id: string
  name?: string | null
  description?: string | null
  type?: string | null
  location?: string | null
  panel?: string | null
  connector?: string | null
  row?: number | null
  col?: number | null
  fingerprint?: string
  [key: string]: unknown
}

export interface BundlePatchCable {
  export_id: string
  a_patchbay_export_id: string
  b_patchbay_export_id: string
  is_active?: boolean
  [key: string]: unknown
}

export interface BundleConnection {
  export_id: string
  a_type?: string
  a_export_id?: string
  b_type?: string
  b_export_id?: string
  is_active?: boolean
  [key: string]: unknown
}

export interface BundleDeviceConfiguration {
  export_id: string | number
  device_export_id?: string | null
  name?: string | null
  data?: Record<string, unknown> | null
  schema_version?: string | null
  fingerprint?: string
  [key: string]: unknown
}

export interface PortabilityEntities {
  devices?: BundleDevice[]
  ports?: BundlePort[]
  patchbay_points?: BundlePatchbayPoint[]
  connections?: BundleConnection[]
  // Legacy import compatibility
  patch_cables?: BundlePatchCable[]
  device_configurations?: BundleDeviceConfiguration[]
  [key: string]: unknown
}

export interface PortabilityBundle {
  manifest?: Manifest
  entities?: PortabilityEntities
  [key: string]: unknown
}

export interface PortabilityConflict {
  type: string
  message?: string
  detail?: string
  severity?: 'warning' | 'error' | string
  entity?: string
  incoming_name?: string
  existing_id?: string | number | null
  target_patchbay_point_id?: number | null
  incoming?: Record<string, unknown> | null
  entity_type?: string
  entity_key?: string
  details?: Record<string, unknown>
  [key: string]: unknown
}

export interface PortabilityWarning {
  type?: string
  message: string
  details?: Record<string, unknown>
  [key: string]: unknown
}

export interface ImportPreviewPlan {
  creates?: Record<string, number>
  updates?: Record<string, number>
  skips?: Record<string, number>
  [key: string]: unknown
}

export interface ImportPreviewResponse {
  manifest?: Manifest
  detected?: Record<string, boolean>
  plan?: ImportPreviewPlan
  id_map_preview?: Record<string, Record<string, string | number>>
  conflicts?: PortabilityConflict[]
  warnings?: Array<PortabilityWarning | string>
  can_apply?: boolean
  blocking_errors?: string[]
  [key: string]: unknown
}

export type ImportMode = 'merge' | 'replace'
export type NameDuplicateStrategy = 'rename' | 'skip' | 'overwrite_if_fingerprint_match'
export type PatchbayMappingStrategy = 'remap_to_free' | 'skip_mapping' | 'fail'
export type PatchCableConflictStrategy = 'skip_conflicts' | 'fail'
export type ConfigConflictStrategy = 'rename' | 'skip' | 'overwrite_if_fingerprint_match'

export interface ImportApplyOptions {
  mode: ImportMode
  name_strategy: NameDuplicateStrategy
  patchbay_mapping_strategy: PatchbayMappingStrategy
  patch_cable_strategy: PatchCableConflictStrategy
  device_config_strategy: ConfigConflictStrategy
}

export interface ImportApplyPayload {
  bundle: PortabilityBundle
  options: ImportApplyOptions
}

export interface ImportApplyReport {
  created?: number | Record<string, number>
  updated?: number | Record<string, number>
  skipped?: number | Record<string, number>
  resolved_conflicts?: number
  conflicts_resolved?: number
  id_maps?: Record<string, Record<string, string | number>>
  warnings?: string[]
  [key: string]: unknown
}

export interface ImportApplyResponse {
  result?: string
  report?: ImportApplyReport
  id_map?: Record<string, Record<string, string | number>>
  id_maps?: Record<string, Record<string, string | number>>
  [key: string]: unknown
}
