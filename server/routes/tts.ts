import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err } from '../env';
import { fromBase64 } from '../lib/bytes';
import { syllableFileName } from '../lib/pinyin';

const MAX_LEN = 20;
const AUDIO_HEADERS = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' };
// 真人音节录音源（Unlicense 公有领域），首次命中后缓存到 R2 syllables/ 前缀
const SYLLABLE_SOURCE = 'https://raw.githubusercontent.com/davinfifield/mp3-chinese-pinyin-sound/master/mp3';

/**
 * 服务端 TTS 兜底（设备无中文语音时用）。
 * MeloTTS 中文（lang:'zh'）为 M1 验证项——官方文档仅举例 en/fr。
 * 结果按文本缓存到 R2 tts/ 前缀。
 */
export const ttsRoutes = new Hono<AppEnv>()
	.get('/syllable/:pinyin', async (c) => {
		// 点字/测验单字发音：按校对拼音播真人音节录音，声调不再靠 TTS 猜
		const name = syllableFileName(c.req.param('pinyin'));
		if (!name) return c.json(err('bad_pinyin', '无法识别的拼音'), 400);

		const key = `syllables/${name}.mp3`;
		const cached = await c.env.BUCKET.get(key);
		if (cached) return new Response(cached.body, { headers: AUDIO_HEADERS });

		// 录音库轻声命名不统一（de5 / 裸 de），依次尝试
		const candidates = name.endsWith('5') ? [name, name.slice(0, -1)] : [name];
		for (const n of candidates) {
			const res = await fetch(`${SYLLABLE_SOURCE}/${n}.mp3`);
			if (!res.ok) continue;
			const bytes = await res.arrayBuffer();
			c.executionCtx.waitUntil(c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }));
			return new Response(bytes, { headers: AUDIO_HEADERS });
		}
		return c.json(err('syllable_not_found', '该音节暂无录音'), 404);
	})
	.get('/tts/:text', async (c) => {
		const text = c.req.param('text').trim();
		if (!text || [...text].length > MAX_LEN) return c.json(err('bad_text', `文本需为 1~${MAX_LEN} 字`), 400);

		// lang 查询参数仅用于调试对照（默认 zh）
		const lang = c.req.query('lang') ?? 'zh';
		const key = `tts/${lang === 'zh' ? '' : `${lang}/`}${text}.mp3`;
		const cached = await c.env.BUCKET.get(key);
		if (cached) {
			return new Response(cached.body, { headers: AUDIO_HEADERS });
		}

		try {
			const result = (await c.env.AI.run(
				'@cf/myshell-ai/melotts' as Parameters<Ai['run']>[0],
				{ prompt: text, lang } as never,
			)) as { audio?: string };
			if (!result?.audio) throw new Error('MeloTTS 未返回音频');
			const bytes = fromBase64(result.audio);
			c.executionCtx.waitUntil(c.env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'audio/mpeg' } }));
			return new Response(bytes, { headers: AUDIO_HEADERS });
		} catch (e) {
			console.error('TTS fallback failed:', e instanceof Error ? e.message : e);
			return c.json(err('tts_unavailable', '服务端语音暂不可用，请在系统设置中安装中文语音'), 503);
		}
	});
