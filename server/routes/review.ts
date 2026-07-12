import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ok } from '../env';
import { commonPinyinOf } from '../lib/common-chars';

interface DueRow {
	ch: string;
	pinyin: string;
	box: number;
}

export const reviewRoutes = new Hono<AppEnv>()
	// 今日到期字（首页角标 + 测验轮次都用它）
	.get('/review/due', async (c) => {
		const { results } = await c.env.DB.prepare(
			`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin, r.box
			 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch
			 WHERE r.graduated = 0 AND r.due_at <= ?1
			 ORDER BY r.due_at`,
		)
			.bind(new Date().toISOString())
			.all<DueRow>();
		return c.json(ok(results.map((r) => ({ ch: r.ch, pinyin: r.pinyin || commonPinyinOf(r.ch), box: r.box }))));
	});
