import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const roleRef = ref<string | null>('org:member')
const loadAuthContext = vi.fn(() => Promise.resolve({}))

vi.mock('@/App.vue', () => ({
  default: {
    render: () => null,
  },
}))

vi.mock('@/lib/authz', () => ({
  loadAuthContext,
  useAuthz: () => ({
    role: roleRef,
  }),
}))

const { resolveAdminGuard } = await import('@/router')

describe('admin route guard', () => {
  beforeEach(() => {
    roleRef.value = 'org:member'
    loadAuthContext.mockClear()
    loadAuthContext.mockResolvedValue({})
  })

  it('allows org admin', async () => {
    roleRef.value = 'org:admin'

    const result = await resolveAdminGuard(true)

    expect(loadAuthContext).toHaveBeenCalledWith({ force: true })
    expect(result).toBe(true)
  })

  it('redirects org member', async () => {
    roleRef.value = 'org:member'

    const result = await resolveAdminGuard(true)

    expect(result).toEqual({ name: 'home' })
  })
})
