import { createRouter, createWebHistory } from 'vue-router';
import { api } from '@/composables/useApi';
import Home from '@/views/Home.vue';
import Read from '@/views/Read.vue';

const router = createRouter({
	history: createWebHistory(import.meta.env.BASE_URL),
	routes: [
		{ path: '/', name: 'home', component: Home },
		{ path: '/read/:id', name: 'read', component: Read },
		{ path: '/quiz', name: 'quiz', component: () => import('@/views/Quiz.vue') },
		{ path: '/stats', name: 'stats', component: () => import('@/views/Stats.vue') },
		{ path: '/recordings', name: 'recordings', component: () => import('@/views/Recordings.vue') },
		{ path: '/print/chars', name: 'print-chars', component: () => import('@/views/PrintChars.vue') },
		{ path: '/admin/login', name: 'admin-login', component: () => import('@/views/admin/Login.vue') },
		{ path: '/admin', name: 'admin', component: () => import('@/views/admin/Manage.vue'), meta: { admin: true } },
		{
			path: '/admin/upload',
			name: 'admin-upload',
			component: () => import('@/views/admin/Upload.vue'),
			meta: { admin: true },
		},
		{
			path: '/admin/proofread/:id',
			name: 'admin-proofread',
			component: () => import('@/views/admin/Proofread.vue'),
			meta: { admin: true },
		},
		{
			path: '/admin/pool',
			name: 'admin-pool',
			component: () => import('@/views/admin/Pool.vue'),
			meta: { admin: true },
		},
	],
});

router.beforeEach(async (to) => {
	if (!to.meta.admin) return true;
	try {
		const s = await api<{ pinSet: boolean; authed: boolean }>('/api/auth/status');
		if (!s.authed) return { name: 'admin-login', query: { to: to.fullPath } };
		return true;
	} catch {
		return { name: 'admin-login' };
	}
});

export default router;
