import { createApp } from 'vue'
import { clerkPlugin } from '@clerk/vue'
import './style.css'
import App from './App.vue'
import router from './router'

// Validar que la env var de Clerk esté presente
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!clerkPubKey) {
  console.error(
    '❌ VITE_CLERK_PUBLISHABLE_KEY no está configurada.\n' +
    'Verificá que exista en .env y que empiece con "pk_"'
  )
}

const app = createApp(App)

// Inicializar Clerk
if (clerkPubKey) {
  app.use(clerkPlugin, {
    publishableKey: clerkPubKey
  })
}

app.use(router)

app.mount('#app')

