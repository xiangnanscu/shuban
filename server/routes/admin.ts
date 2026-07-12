import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import { adminAuth, createSessionToken, currentPinVersion, hashPin, randomSaltHex, SESSION_COOKIE } from '../lib/auth';
import { runOcrForPage } from '../lib/ocr-run';
import { getSetting, setSetting } from '../lib/settings';
import { timingSafeEqual } from '../lib/bytes';
import type { PageLine } from '../ocr';

const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

		for (const pid of pageIds) {
			c.executionCtx.waitUntil(runOcrForPage(c.env, pid));
		}
		return c.json(ok({ articleId }));
	})

	// 单页重跑 OCR
	.post('/pages/:id/ocr', async (c) => {
		const pageId = Number(c.req.param('id'));
		if (!Number.isInteger(pageId)) return c.json(err('bad_id', '无效 id'), 400);
		const row = await c.env.DB.prepare("UPDATE pages SET ocr_status = 'pending' WHERE id = ?1 RETURNING id")
			.bind(pageId)
			.first();
		if (!row) return c.json(err('not_found', '页不存在'), 404);
		c.executionCtx.waitUntil(runOcrForPage(c.env, pageId));
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

	// 生字池清理（误点）
	.delete('/review/:ch', async (c) => {
		const ch = c.req.param('ch');
		await c.env.DB.prepare('DELETE FROM review_items WHERE ch = ?1').bind(ch).run();
		return c.json(ok({ ch }));
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
