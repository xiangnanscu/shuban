// 书伴 Service Worker：离线阅读已缓存文章
// - /assets/*（哈希文件名）、/api/files/*（图片/录音，key 不变内容不变）→ 缓存优先
// - 导航与文章类 GET API → 网络优先，离线回退缓存
// - /api/admin、/api/auth、所有非 GET → 不缓存
const CACHE = 'shuban-v1';

const CACHE_FIRST = [/^\/assets\//, /^\/api\/files\//, /^\/icon(-maskable)?\.svg$/, /^\/favicon\.ico$/, /^\/manifest\.webmanifest$/];
const NETWORK_FIRST = [/^\/api\/articles/, /^\/api\/pool/, /^\/api\/review\/due/, /^\/api\/stats\/summary/, /^\/api\/recordings$/];

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})(),
	);
});

async function cacheFirst(request) {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(request);
	if (hit) return hit;
	const res = await fetch(request);
	if (res.ok) await cache.put(request, res.clone());
	return res;
}

async function networkFirst(request, cacheKey) {
	const cache = await caches.open(CACHE);
	try {
		const res = await fetch(request);
		if (res.ok) await cache.put(cacheKey ?? request, res.clone());
		return res;
	} catch (err) {
		const hit = await cache.match(cacheKey ?? request);
		if (hit) return hit;
		throw err;
	}
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return;
	const path = url.pathname;

	if (request.mode === 'navigate') {
		// SPA：所有导航共用同一个 shell
		event.respondWith(networkFirst(request, '/'));
		return;
	}
	if (CACHE_FIRST.some((re) => re.test(path))) {
		event.respondWith(cacheFirst(request));
		return;
	}
	if (NETWORK_FIRST.some((re) => re.test(path))) {
		event.respondWith(networkFirst(request));
	}
});
