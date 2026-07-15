import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppEnv, OcrMessage } from '../env';
import { err, ok } from '../env';
import { adminAuth, createSessionToken, currentPinVersion, hashPin, randomSaltHex, SESSION_COOKIE } from '../lib/auth';
import { segmentImages } from '../ocr/segment';
import {
	AI_PROVIDERS,
	type AiProviderName,
	DEFAULT_MAX_REC_SEC,
	getAiSettings,
	getMaxRecSec,
	getSetting,
	setAiSettings,
	setMaxRecSec,
	setSetting,
} from '../lib/settings';
import { getProviderTimeoutMs } from '../lib/ocr-run';
import { timingSafeEqual } from '../lib/bytes';
import type { PageLine } from '../ocr';
import type { Bindings } from '../env';

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** 当前生效的 AI 设置 + wrangler vars 里的出厂默认值；GET/PUT /settings/ai 共用，避免 PUT 响应漏字段 */
async function aiSettingsPayload(env: Bindings) {
	const s = await getAiSettings(env.DB);
	return {
		primaryProvider: s.primaryProvider,
		geminiModel: s.geminiModel,
		workersaiModel: s.workersaiModel,
		claudeModel: s.claudeModel,
		mimoModel: s.mimoModel,
		timeoutMs: s.timeoutMs,
		segCompress: s.segCompress,
		defaults: {
			providerOrder: env.OCR_PROVIDER.split(',')
				.map((x) => x.trim())
				.filter(Boolean),
			geminiModel: env.GEMINI_MODEL,
			workersaiModel: env.WORKERSAI_MODEL,
			claudeModel: env.CLAUDE_MODEL,
			mimoModel: env.MIMO_MODEL,
			timeoutMs: getProviderTimeoutMs(env),
		},
	};
}

export const adminRoutes = new Hono<AppEnv>()
	.use('*', adminAuth)

	// 建文章：multipart images[] → R2 + pages → 异步逐页 OCR
	.post('/articles', async (c) => {
		const form = await c.req.raw.formData();
		const files = form.getAll('images').filter((f): f is File => f instanceof File);
		if (files.length === 0) return c.json(err('no_images', '未收到图片'), 400);
		if (files.length > MAX_IMAGES) return c.json(err('too_many', `最多 ${MAX_IMAGES} 张`), 400);
		for (const f of files) {
			if (!IMAGE_TYPES.has(f.type)) return c.json(err('bad_type', `不支持的图片类型 ${f.type}`), 400);
			if (f.size > MAX_IMAGE_BYTES) return c.json(err('too_large', '单张图片需 ≤8MB'), 400);
		}

		const title = typeof form.get('title') === 'string' ? (form.get('title') as string).trim() : '';
		const ins = await c.env.DB.prepare('INSERT INTO articles (title) VALUES (?1)').bind(title).run();
		const articleId = ins.meta.last_row_id;

		const pageIds: number[] = [];
		for (let i = 0; i < files.length; i++) {
			const key = `img/${articleId}/${i + 1}.jpg`;
			await c.env.BUCKET.put(key, await files[i].arrayBuffer(), {
				httpMetadata: { contentType: files[i].type },
			});
			const p = await c.env.DB.prepare('INSERT INTO pages (article_id, page_no, image_key) VALUES (?1, ?2, ?3)')
				.bind(articleId, i + 1, key)
				.run();
			pageIds.push(p.meta.last_row_id);
		}
		await c.env.DB.prepare('UPDATE articles SET cover_key = ?1 WHERE id = ?2')
			.bind(`img/${articleId}/1.jpg`, articleId)
			.run();

		await c.env.OCR_QUEUE.sendBatch(pageIds.map((id) => ({ body: { pageId: id } })));
		return c.json(ok({ articleId }));
	})

	// AI 自动分篇建文章：multipart images[]（可能跨多篇）→ AI 按页码/语义/版式推断分组 → 一次建 1~N 篇 draft
	.post('/articles/batch', async (c) => {
		const form = await c.req.raw.formData();
		const files = form.getAll('images').filter((f): f is File => f instanceof File);
		if (files.length === 0) return c.json(err('no_images', '未收到图片'), 400);
		if (files.length > MAX_IMAGES) return c.json(err('too_many', `最多 ${MAX_IMAGES} 张`), 400);
		for (const f of files) {
			if (!IMAGE_TYPES.has(f.type)) return c.json(err('bad_type', `不支持的图片类型 ${f.type}`), 400);
			if (f.size > MAX_IMAGE_BYTES) return c.json(err('too_large', '单张图片需 ≤8MB'), 400);
		}

		const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
		// 分篇用小缩略图（前端另传，只做分组+排序，省 token）；缺失或数量不符则退回全分辨率图
		const thumbFiles = form.getAll('segThumbs').filter((f): f is File => f instanceof File);
		const segBuffers =
			thumbFiles.length === files.length ? await Promise.all(thumbFiles.map((f) => f.arrayBuffer())) : buffers;
		const groups = await segmentImages(c.env, segBuffers);

		const created: { articleId: number; title: string; pages: { id: number; pageNo: number }[] }[] = [];
		const ocrMessages: { body: OcrMessage }[] = [];
		for (const g of groups) {
			const title = g.title ?? '';
			const ins = await c.env.DB.prepare('INSERT INTO articles (title) VALUES (?1)').bind(title).run();
			const articleId = ins.meta.last_row_id;

			const pagesMeta: { id: number; pageNo: number }[] = [];
			for (let pn = 0; pn < g.pages.length; pn++) {
				const idx = g.pages[pn];
				const key = `img/${articleId}/${pn + 1}.jpg`;
				await c.env.BUCKET.put(key, buffers[idx], { httpMetadata: { contentType: files[idx].type } });
				const p = await c.env.DB.prepare('INSERT INTO pages (article_id, page_no, image_key) VALUES (?1, ?2, ?3)')
					.bind(articleId, pn + 1, key)
					.run();
				pagesMeta.push({ id: p.meta.last_row_id, pageNo: pn + 1 });
			}
			await c.env.DB.prepare('UPDATE articles SET cover_key = ?1 WHERE id = ?2')
				.bind(`img/${articleId}/1.jpg`, articleId)
				.run();

			for (const { id } of pagesMeta) ocrMessages.push({ body: { pageId: id } });
			created.push({ articleId, title, pages: pagesMeta });
		}
		// 全部页投递到 OCR 队列，由后台消费者识别（不依赖本请求存活或浏览器开着）
		if (ocrMessages.length) await c.env.OCR_QUEUE.sendBatch(ocrMessages);
		return c.json(ok({ articles: created }));
	})

	// 单页替换原图（校对时修正拍歪/拍倒），替换后自动重新识别
	.post('/pages/:id/image', async (c) => {
		const pageId = Number(c.req.param('id'));
		if (!Number.isInteger(pageId)) return c.json(err('bad_id', '无效 id'), 400);
		const row = await c.env.DB.prepare('SELECT image_key, image_version FROM pages WHERE id = ?1')
			.bind(pageId)
			.first<{ image_key: string; image_version: number }>();
		if (!row) return c.json(err('not_found', '页不存在'), 404);

		const form = await c.req.raw.formData();
		const file = form.get('image');
		if (!(file instanceof File)) return c.json(err('no_image', '未收到图片'), 400);
		if (!IMAGE_TYPES.has(file.type)) return c.json(err('bad_type', `不支持的图片类型 ${file.type}`), 400);
		if (file.size > MAX_IMAGE_BYTES) return c.json(err('too_large', '图片需 ≤8MB'), 400);

		await c.env.BUCKET.put(row.image_key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
		const imageVersion = row.image_version + 1;
		await c.env.DB.prepare("UPDATE pages SET image_version = ?1, ocr_status = 'pending', ocr_error = NULL WHERE id = ?2")
			.bind(imageVersion, pageId)
			.run();
		await c.env.OCR_QUEUE.send({ pageId });
		return c.json(ok({ pageId, imageUrl: `/api/files/${row.image_key}?v=${imageVersion}` }));
	})

	// 单页重跑 OCR
	.post('/pages/:id/ocr', async (c) => {
		const pageId = Number(c.req.param('id'));
		if (!Number.isInteger(pageId)) return c.json(err('bad_id', '无效 id'), 400);
		const row = await c.env.DB.prepare("UPDATE pages SET ocr_status = 'pending', ocr_error = NULL WHERE id = ?1 RETURNING id")
			.bind(pageId)
			.first();
		if (!row) return c.json(err('not_found', '页不存在'), 404);
		await c.env.OCR_QUEUE.send({ pageId });
		return c.json(ok({ pageId }));
	})

	// 校对保存 / 发布
	.put('/articles/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json(err('bad_id', '无效 id'), 400);
		const body = await c.req
			.json<{ title?: string; status?: 'draft' | 'published'; pages?: { id: number; lines: PageLine[] }[] }>()
			.catch(() => null);
		if (!body) return c.json(err('bad_body', '请求体不是 JSON'), 400);

		const exists = await c.env.DB.prepare('SELECT id FROM articles WHERE id = ?1').bind(id).first();
		if (!exists) return c.json(err('not_found', '文章不存在'), 404);

		if (typeof body.title === 'string') {
			await c.env.DB.prepare('UPDATE articles SET title = ?1 WHERE id = ?2').bind(body.title.trim(), id).run();
		}
		if (Array.isArray(body.pages)) {
			for (const p of body.pages) {
				if (!Number.isInteger(p.id) || !Array.isArray(p.lines)) return c.json(err('bad_page', '页数据非法'), 400);
				await c.env.DB.prepare("UPDATE pages SET content_json = ?1, ocr_status = 'done' WHERE id = ?2 AND article_id = ?3")
					.bind(JSON.stringify({ lines: p.lines }), p.id, id)
					.run();
			}
		}
		if (body.status === 'published' || body.status === 'draft') {
			await c.env.DB.prepare(
				"UPDATE articles SET status = ?1, published_at = CASE WHEN ?1 = 'published' THEN datetime('now') ELSE published_at END WHERE id = ?2",
			)
				.bind(body.status, id)
				.run();
		}
		return c.json(ok({ id }));
	})

	.delete('/articles/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json(err('bad_id', '无效 id'), 400);
		const { results: pages } = await c.env.DB.prepare('SELECT image_key FROM pages WHERE article_id = ?1')
			.bind(id)
			.all<{ image_key: string }>();
		if (pages.length) await c.env.BUCKET.delete(pages.map((p) => p.image_key));
		await c.env.DB.prepare('DELETE FROM pages WHERE article_id = ?1').bind(id).run();
		await c.env.DB.prepare('DELETE FROM articles WHERE id = ?1').bind(id).run();
		return c.json(ok({ id }));
	})

	// 清除单篇文章的点击历史（tap_events），并重算受影响字的 total_taps
	.delete('/articles/:id/taps', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json(err('bad_id', '无效 id'), 400);
		const { results } = await c.env.DB.prepare('SELECT DISTINCT ch FROM tap_events WHERE article_id = ?1')
			.bind(id)
			.all<{ ch: string }>();
		await c.env.DB.prepare('DELETE FROM tap_events WHERE article_id = ?1').bind(id).run();
		for (const { ch } of results) {
			await c.env.DB.prepare('UPDATE chars SET total_taps = (SELECT COUNT(*) FROM tap_events WHERE ch = ?1) WHERE ch = ?1')
				.bind(ch)
				.run();
		}
		return c.json(ok({ id, cleared: results.length }));
	})

	// 清除全部点击历史（tap_events 清空，chars.total_taps 归零）
	.delete('/taps', async (c) => {
		await c.env.DB.prepare('DELETE FROM tap_events').run();
		await c.env.DB.prepare('UPDATE chars SET total_taps = 0').run();
		return c.json(ok({ cleared: true }));
	})

	// 生字池全量列表（含毕业字），家长管理页用
	.get('/review', async (c) => {
		const { results } = await c.env.DB.prepare(
			`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin, r.box, r.due_at, r.graduated,
			        r.correct_count, r.wrong_count, COALESCE(c.total_taps, 0) AS total_taps
			 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch
			 ORDER BY r.graduated, r.due_at`,
		).all<{
			ch: string;
			pinyin: string;
			box: number;
			due_at: string;
			graduated: number;
			correct_count: number;
			wrong_count: number;
			total_taps: number;
		}>();
		return c.json(
			ok(
				results.map((r) => ({
					ch: r.ch,
					pinyin: r.pinyin,
					box: r.box,
					dueAt: r.due_at,
					graduated: r.graduated === 1,
					correctCount: r.correct_count,
					wrongCount: r.wrong_count,
					totalTaps: r.total_taps,
				})),
			),
		);
	})

	// 删除录音（R2 + 记录）
	.delete('/recordings/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json(err('bad_id', '无效 id'), 400);
		const row = await c.env.DB.prepare('DELETE FROM recordings WHERE id = ?1 RETURNING r2_key')
			.bind(id)
			.first<{ r2_key: string }>();
		if (!row) return c.json(err('not_found', '录音不存在'), 404);
		await c.env.BUCKET.delete(row.r2_key);
		return c.json(ok({ id }));
	})

	// 数据导出（学习数据 JSON 备份；不含 PIN 等 settings）
	.get('/export', async (c) => {
		const tables = [
			'articles',
			'pages',
			'chars',
			'tap_events',
			'review_items',
			'quiz_answers',
			'recordings',
			'reading_sessions',
		] as const;
		const data: Record<string, unknown[]> = {};
		for (const t of tables) {
			data[t] = (await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
		}
		const body = JSON.stringify({ app: 'shuban', version: 1, exportedAt: new Date().toISOString(), data });
		return new Response(body, {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="shuban-export-${new Date().toISOString().slice(0, 10)}.json"`,
			},
		});
	})

	// 生字池清理（误点）
	.delete('/review/:ch', async (c) => {
		const ch = c.req.param('ch');
		await c.env.DB.prepare('DELETE FROM review_items WHERE ch = ?1').bind(ch).run();
		return c.json(ok({ ch }));
	})

	// AI 设置：识别引擎优先级、各家模型、超时。当前生效值 + wrangler vars 里的出厂默认值
	.get('/settings/ai', async (c) => c.json(ok(await aiSettingsPayload(c.env))))

	.put('/settings/ai', async (c) => {
		const body = await c.req
			.json<{
				primaryProvider?: AiProviderName | null;
				geminiModel?: string | null;
				workersaiModel?: string | null;
				claudeModel?: string | null;
				mimoModel?: string | null;
				timeoutMs?: number | string | null;
				segCompress?: boolean | null;
			}>()
			.catch(() => null);
		if (!body) return c.json(err('bad_body', '请求体不是 JSON'), 400);

		if (body.primaryProvider != null && !(AI_PROVIDERS as readonly string[]).includes(body.primaryProvider)) {
			return c.json(err('bad_provider', '未知引擎'), 400);
		}
		let timeoutStr: string | null | undefined;
		if (body.timeoutMs !== undefined) {
			if (body.timeoutMs === null || body.timeoutMs === '') timeoutStr = null;
			else {
				const n = Number(body.timeoutMs);
				if (!Number.isFinite(n) || n <= 0) return c.json(err('bad_timeout', '超时需为正数'), 400);
				timeoutStr = String(Math.round(n));
			}
		}

		await setAiSettings(c.env.DB, {
			...(body.primaryProvider !== undefined && { primaryProvider: body.primaryProvider }),
			...(body.geminiModel !== undefined && { geminiModel: body.geminiModel?.trim() || null }),
			...(body.workersaiModel !== undefined && { workersaiModel: body.workersaiModel?.trim() || null }),
			...(body.claudeModel !== undefined && { claudeModel: body.claudeModel?.trim() || null }),
			...(body.mimoModel !== undefined && { mimoModel: body.mimoModel?.trim() || null }),
			...(timeoutStr !== undefined && { timeoutMs: timeoutStr }),
			...(body.segCompress !== undefined && { segCompress: body.segCompress === false ? '0' : null }),
		});
		return c.json(ok(await aiSettingsPayload(c.env)));
	})

	// 录音设置：超过阈值秒数视为孩子走开、朗读未完成，上传时舍弃
	.get('/settings/recording', async (c) =>
		c.json(ok({ maxRecSec: await getMaxRecSec(c.env.DB), defaults: { maxRecSec: DEFAULT_MAX_REC_SEC } })),
	)

	.put('/settings/recording', async (c) => {
		const body = await c.req.json<{ maxRecSec?: number | string | null }>().catch(() => null);
		if (!body) return c.json(err('bad_body', '请求体不是 JSON'), 400);

		let maxRecSecStr: string | null = null;
		if (body.maxRecSec !== undefined && body.maxRecSec !== null && body.maxRecSec !== '') {
			const n = Number(body.maxRecSec);
			if (!Number.isFinite(n) || n <= 0) return c.json(err('bad_max_rec_sec', '阈值需为正数'), 400);
			maxRecSecStr = String(Math.round(n));
		}
		await setMaxRecSec(c.env.DB, maxRecSecStr);
		return c.json(ok({ maxRecSec: await getMaxRecSec(c.env.DB), defaults: { maxRecSec: DEFAULT_MAX_REC_SEC } }));
	})

	// 改 PIN（会话全部失效并重发本会话）
	.put('/settings/pin', async (c) => {
		const { oldPin, newPin } = await c.req.json<{ oldPin?: string; newPin?: string }>().catch(() => ({}) as never);
		if (typeof newPin !== 'string' || !/^\d{6}$/.test(newPin)) return c.json(err('bad_pin', '新 PIN 需为 6 位数字'), 400);
		const hash = await getSetting(c.env.DB, 'pin_hash');
		const salt = await getSetting(c.env.DB, 'pin_salt');
		if (!hash || !salt || typeof oldPin !== 'string' || !timingSafeEqual(await hashPin(oldPin, salt), hash)) {
			return c.json(err('wrong_pin', '当前 PIN 不正确'), 401);
		}
		const newSalt = randomSaltHex();
		const version = (await currentPinVersion(c.env.DB)) + 1;
		await setSetting(c.env.DB, 'pin_salt', newSalt);
		await setSetting(c.env.DB, 'pin_hash', await hashPin(newPin, newSalt));
		await setSetting(c.env.DB, 'pin_version', String(version));
		setCookie(c, SESSION_COOKIE, await createSessionToken(c.env.SESSION_SECRET, version), {
			httpOnly: true,
			secure: c.req.url.startsWith('https://'),
			sameSite: 'Lax',
			path: '/',
			maxAge: 7 * 24 * 3600,
		});
		return c.json(ok({ changed: true }));
	});
