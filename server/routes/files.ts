import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err } from '../env';

const ALLOWED_PREFIXES = ['img/', 'rec/', 'tts/'];

export const fileRoutes = new Hono<AppEnv>().get('/files/*', async (c) => {
	const key = decodeURIComponent(new URL(c.req.url).pathname.slice('/api/files/'.length));
	if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
		return c.json(err('forbidden', '非法路径'), 403);
	}
	const obj = await c.env.BUCKET.get(key);
	if (!obj) return c.json(err('not_found', '文件不存在'), 404);

	const headers = new Headers();
	headers.set('content-type', obj.httpMetadata?.contentType ?? guessType(key));
	headers.set('cache-control', 'public, max-age=31536000, immutable');
	headers.set('etag', obj.httpEtag);
	return new Response(obj.body, { headers });
});

function guessType(key: string): string {
	if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
	if (key.endsWith('.png')) return 'image/png';
	if (key.endsWith('.webp')) return 'image/webp';
	if (key.endsWith('.mp3')) return 'audio/mpeg';
	return 'application/octet-stream';
}
