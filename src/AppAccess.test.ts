import { describe, it, expect, vi } from 'vitest'
import { createApp, nextTick, ref, h, reactive } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => reactive({ path: '/' }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@clerk/vue', () => ({
  SignedIn: {
    setup(_props: any, { slots }: any) {
      return () => (slots.default ? slots.default() : null)
    },
  },
  SignedOut: {
    setup() {
      return () => null
    },
  },
  UserButton: {
    setup() {
      return () => h('div')
    },
  },
  OrganizationSwitcher: {
    setup() {
      return () => h('div')
    },
  },
  useAuth: () => ({
    isLoaded: ref(true),
    isSignedIn: ref(true),
    orgId: ref('org_1'),
    getToken: ref(async () => 'token'),
  }),
  useClerk: () => ref({ signOut: vi.fn() }),
}))

vi.mock('@/store', () => ({
  store: reactive({
    orgRequired: false,
    hasLoadedInitialData: true,
    loading: false,
    authError: false,
    error: null,
    backendAuthDegraded: false,
    activeTab: 'devices',
    loadData: vi.fn(),
    retryInitialLoad: vi.fn(),
    setTab: vi.fn(),
    resetState: vi.fn(),
    pushToast: vi.fn(),
  }),
}))

vi.mock('@/lib/authz', () => ({
  useAuthz: () => {
    const authContext = ref({ enabled: false })
    const features = ref({ app_access: false })
    return {
      authContext,
      authContextLoaded: ref(true),
      authContextLoading: ref(false),
      authContextError: ref(null),
      plan: ref('free'),
      role: ref('member'),
      orgId: ref('org_1'),
      userId: ref('user_1'),
      features,
      limits: ref({}),
      hasFeature: (key: string, fallback = false) => (features.value as any)[key] ?? fallback,
      getLimit: () => null,
      loadAuthContext: vi.fn(() => Promise.resolve(null)),
      resetAuthContext: vi.fn(),
    }
  },
}))

vi.mock('@/components/PatchBayGrid.vue', () => ({ default: { render: () => h('div') } }))
vi.mock('@/components/DevicesManager.vue', () => ({ default: { render: () => h('div') } }))
vi.mock('@/components/ConnectionFinder.vue', () => ({ default: { render: () => h('div') } }))
vi.mock('@/components/AuthScreen.vue', () => ({ default: { render: () => h('div') } }))
vi.mock('@/components/AuthDiagnosticsPanel.vue', () => ({ default: { render: () => h('div') } }))
vi.mock('@/ui/ToastHost.vue', () => ({ default: { render: () => h('div') } }))

const { default: App } = await import('@/App.vue')

describe('App access gating', () => {
  it('renders AccessDisabledScreen when app_access is false', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createApp(App)
    app.mount(container)
    await nextTick()

    expect(container.textContent).toContain('Access not enabled')

    app.unmount()
    document.body.removeChild(container)
  })
})
