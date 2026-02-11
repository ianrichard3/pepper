import { requestJson } from '@/lib/apiClient'
import type {
  ExportBundlePayload,
  ImportApplyPayload,
  ImportApplyResponse,
  ImportPreviewResponse,
  PortabilityBundle,
} from '@/types/portability'

const PORTABILITY_BASE = '/api/portability'

export async function exportBundle(payload: ExportBundlePayload): Promise<PortabilityBundle> {
  return requestJson<PortabilityBundle>(`${PORTABILITY_BASE}/export`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function importPreview(bundle: PortabilityBundle): Promise<ImportPreviewResponse> {
  return requestJson<ImportPreviewResponse>(`${PORTABILITY_BASE}/import/preview`, {
    method: 'POST',
    body: JSON.stringify(bundle),
  })
}

export async function importApply(payload: ImportApplyPayload): Promise<ImportApplyResponse> {
  return requestJson<ImportApplyResponse>(`${PORTABILITY_BASE}/import/apply`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
