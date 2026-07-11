import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err } from '../env';
import { fromBase64 } from '../lib/bytes';

const MAX_LEN = 20;

/**
 * 服务端 TTS 兜底（设备无中文语音时用）。
 * MeloTTS 中文（lang:'zh'）为 M1 验证项——官方文档仅举例 en/fr。
 * 结果按文本缓存到 R2 tts/ 前缀。
 */
export const ttsRoutes = new Hono<AppEnv>().get('/tts/:text', async (c) => {
	const text = c.req.param('text').trim();
	if (!text || [...text].length > MAX_LEN) return c.json(err('bad_text', `文本需为 1~${MAX_LEN} 字`), 400);

	// lang 查询参数仅用于调试对照（默认 zh）
	const lang = c.req.query('lang') ?? 'zh';
	const key = `tts/${lang === 'zh' ? '' : `${lang}/`}${text}.mp3`;
	const cached = await c.env.BUCKET.get(key);
	if (cached) {
		return new Response(cached.body, {
			headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' },
		});
	}

	try {
		const result = (await c.env.AI.run(
			'@cf/myshell-ai/melotts' as Parameters<Ai['run']>[0],
			{ prompt: text, lang } as never,
		)) as { audio?: string };
		if (!result?.audio) throw new Error('MeloTTS 未返回音频');
		const bytes = fromBase64(result.audio);
		c.executionCtx.waitUntil(c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }));
		return new Response(bytes, {
			headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' },
		});
	} catch (e) {
		console.error('TTS fallback failed:', e instanceof Error ? e.message : e);
		return c.json(err('tts_unavailable', '服务端语音暂不可用，请在系统设置中安装中文语音'), 503);
	}
});
