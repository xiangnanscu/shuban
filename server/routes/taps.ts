import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import { dueTonightUtcIso } from '../lib/time';

const SINGLE_HAN = /^\p{Script=Han}$/u;

export const tapRoutes = new Hono<AppEnv>()
	// 点字：记流水 + chars upsert + 入复习池
	.post('/taps', async (c) => {
		const body = await c.req.json<{ ch?: string; pinyin?: string; articleId?: number }>().catch(() => null);
		if (!body || typeof body.ch !== 'string' || !SINGLE_HAN.test(body.ch)) {
			return c.json(err('bad_ch', 'ch 必须是单个汉字'), 400);
		}
		const ch = body.ch;
		const pinyin = typeof body.pinyin === 'string' ? body.pinyin.slice(0, 16) : '';
		const articleId = Number.isInteger(body.articleId) ? body.articleId : null;

		await c.env.DB.batch([
			c.env.DB.prepare(
				`INSERT INTO chars (ch, pinyin, total_taps) VALUES (?1, ?2, 1)
				 ON CONFLICT(ch) DO UPDATE SET
				   total_taps = total_taps + 1,
				   pinyin = CASE WHEN chars.pinyin = '' THEN excluded.pinyin ELSE chars.pinyin END`,
			).bind(ch, pinyin),
			c.env.DB.prepare('INSERT INTO tap_events (ch, article_id) VALUES (?1, ?2)').bind(ch, articleId),
			c.env.DB.prepare(
				`INSERT INTO review_items (ch, box, due_at) VALUES (?1, 0, ?2)
				 ON CONFLICT(ch) DO UPDATE SET
				   box = CASE WHEN review_items.graduated = 1 THEN 1 ELSE review_items.box END,
				   due_at = CASE WHEN review_items.graduated = 1 THEN excluded.due_at ELSE review_items.due_at END,
				   graduated = 0,
				   updated_at = datetime('now')`,
			).bind(ch, dueTonightUtcIso()),
		]);
		return c.json(ok({ ch }));
	})

	// 生字池全量字集（阅读页高亮用）
	.get('/pool', async (c) => {
		const { results } = await c.env.DB.prepare('SELECT ch FROM review_items WHERE graduated = 0').all<{ ch: string }>();
		return c.json(ok(results.map((r) => r.ch)));
	});
