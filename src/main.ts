import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(router)

app.mount('#app')

// PWA：生产环境注册 Service Worker（离线读已缓存文章）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
	window.addEventListener('load', () => {
		void navigator.serviceWorker.register('/sw.js')
	})
}
