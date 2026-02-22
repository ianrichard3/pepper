import { apiBaseUrl } from './authConfig'
import { getApiToken } from './authToken'

const REQUEST_TIMEOUT_MS = 20000

export interface ApiClientError extends Error {
  status?: number
  requestId?: string
  code?: string
}

function isOrgRequiredError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('active organization required') ||
    normalized.includes('organization required') ||
    normalized.includes('org required')
  )
}

function normalizeErrorCode(errorJson: any, errorText: string): string {
  const code = errorJson?.code || errorJson?.error?.code || errorJson?.error || ''
  const detail = typeof errorJson?.detail === 'string' ? errorJson.detail : errorText || ''
  return `${code} ${detail}`.toLowerCase()
}

function isEntitlementError(errorJson: any, errorText: string): boolean {
  const normalized = normalizeErrorCode(errorJson, errorText)
  return (
    normalized.includes('entitlement_required') ||
    normalized.includes('entitlement') ||
    normalized.includes('workspace disabled') ||
    normalized.includes('feature not enabled')
  )
}

function isQuotaError(errorJson: any, errorText: string): boolean {
  const normalized = normalizeErrorCode(errorJson, errorText)
  return normalized.includes('quota_exceeded') || normalized.includes('quota')
}

function isLimitError(errorJson: any, errorText: string): boolean {
  const normalized = normalizeErrorCode(errorJson, errorText)
  return normalized.includes('limit_reached') || normalized.includes('limit')
}

function buildApiError(message: string, status: number, requestId: string): ApiClientError {
  const error = new Error(message) as ApiClientError
  error.status = status
  error.requestId = requestId
  return error
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function readErrorBody(response: Response): Promise<{ text: string; json: any | null }> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const json = await response.json()
      const text = typeof json?.detail === 'string' ? json.detail : JSON.stringify(json)
      return { text, json }
    } catch {
      return { text: '', json: null }
    }
  }

  try {
    const text = await response.text()
    return { text, json: null }
  } catch {
    return { text: '', json: null }
  }
}

function withContentType(headers: Record<string, string>, body?: BodyInit | null) {
  if (body instanceof FormData) return headers
  return { 'Content-Type': 'application/json', ...headers }
}

function createApiErrorFromResponse(
  response: Response,
  errorText: string,
  errorJson: any,
  requestId: string
): ApiClientError {
  if (response.status === 401) {
    return buildApiError('AUTH_EXPIRED', response.status, requestId)
  }
  if (response.status === 403) {
    const detailText =
      typeof errorJson?.detail === 'string' ? errorJson.detail : errorText || ''
    if (isOrgRequiredError(detailText)) {
      return buildApiError('ORG_REQUIRED', response.status, requestId)
    }
    if (isEntitlementError(errorJson, errorText)) {
      return buildApiError('ENTITLEMENT_REQUIRED', response.status, requestId)
    }
    return buildApiError('AUTH_FORBIDDEN', response.status, requestId)
  }
  if (response.status === 402) {
    return buildApiError('PAYMENT_REQUIRED', response.status, requestId)
  }
  if (response.status === 503) {
    return buildApiError('AUTH_SERVICE_UNAVAILABLE', response.status, requestId)
  }
  if (response.status === 429) {
    if (isQuotaError(errorJson, errorText)) {
      return buildApiError('QUOTA_EXCEEDED', response.status, requestId)
    }
    if (isLimitError(errorJson, errorText)) {
      return buildApiError('LIMIT_REACHED', response.status, requestId)
    }
    return buildApiError('QUOTA_EXCEEDED', response.status, requestId)
  }
  if (response.status === 409) {
    if (isLimitError(errorJson, errorText)) {
      return buildApiError('LIMIT_REACHED', response.status, requestId)
    }
  }
  if (response.status === 502 || response.status === 504) {
    return buildApiError('UPSTREAM_UNAVAILABLE', response.status, requestId)
  }

  return buildApiError(`HTTP ${response.status}: ${errorText}`, response.status, requestId)
}

export async function requestJson<T>(path: string, options?: RequestInit, isRetry = false): Promise<T> {
  const url = `${apiBaseUrl}${path}`
  const body = options?.body
  const requestId = generateRequestId()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    'X-Request-Id': requestId,
  }

  const token = await getApiToken({ skipCache: isRetry })
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const controller = new AbortController()
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: withContentType(headers, body),
      })
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 && !isRetry && token) {
        console.warn(`[API] Got 401 for ${path}, retrying with fresh token...`, { requestId })
        return requestJson<T>(path, options, true)
      }

      const { text: errorText, json: errorJson } = await readErrorBody(response)
      throw createApiErrorFromResponse(response, errorText, errorJson, requestId)
    }

    return await response.json()
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error(`API request timed out: ${path}`, { requestId })
      throw new Error('NETWORK_TIMEOUT')
    }
    console.error(`API request failed: ${path}`, { requestId, error })
    throw error
  }
}

export async function requestJsonAllowErrors<T>(
  path: string,
  options?: RequestInit,
  allowedStatuses: number[] = [],
  isRetry = false
): Promise<{ data: T | null; status: number; errorJson: any | null; errorText: string; headers: Headers }>
{
  const url = `${apiBaseUrl}${path}`
  const body = options?.body
  const requestId = generateRequestId()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    'X-Request-Id': requestId,
  }

  const token = await getApiToken({ skipCache: isRetry })
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const controller = new AbortController()
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: withContentType(headers, body),
      })
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 && !isRetry && token) {
        console.warn(`[API] Got 401 for ${path}, retrying with fresh token...`, { requestId })
        return requestJsonAllowErrors<T>(path, options, allowedStatuses, true)
      }

      const { text: errorText, json: errorJson } = await readErrorBody(response)
      if (allowedStatuses.includes(response.status)) {
        return {
          data: null,
          status: response.status,
          errorJson,
          errorText,
          headers: response.headers,
        }
      }
      throw createApiErrorFromResponse(response, errorText, errorJson, requestId)
    }

    const data = await response.json()
    return { data, status: response.status, errorJson: null, errorText: '', headers: response.headers }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error(`API request timed out: ${path}`, { requestId })
      throw new Error('NETWORK_TIMEOUT')
    }
    console.error(`API request failed: ${path}`, { requestId, error })
    throw error
  }
}

export async function requestJsonWithMeta<T>(
  path: string,
  options?: RequestInit,
  isRetry = false
): Promise<{ data: T; headers: Headers }>
{
  const url = `${apiBaseUrl}${path}`
  const body = options?.body
  const requestId = generateRequestId()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    'X-Request-Id': requestId,
  }

  const token = await getApiToken({ skipCache: isRetry })
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const controller = new AbortController()
    if (options?.signal) {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: withContentType(headers, body),
      })
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!response.ok) {
      if (response.status === 401 && !isRetry && token) {
        console.warn(`[API] Got 401 for ${path}, retrying with fresh token...`, { requestId })
        return requestJsonWithMeta<T>(path, options, true)
      }

      const { text: errorText, json: errorJson } = await readErrorBody(response)
      throw createApiErrorFromResponse(response, errorText, errorJson, requestId)
    }

    const data = await response.json()
    return { data, headers: response.headers }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.error(`API request timed out: ${path}`, { requestId })
      throw new Error('NETWORK_TIMEOUT')
    }
    console.error(`API request failed: ${path}`, { requestId, error })
    throw error
  }
}

export async function fetchWithAuth(
  url: string,
  options?: RequestInit,
  isRetry = false
): Promise<{ response: Response; requestId: string }>
{
  const requestId = generateRequestId()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    'X-Request-Id': requestId,
  }

  const token = await getApiToken({ skipCache: isRetry })
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  return { response, requestId }
}
