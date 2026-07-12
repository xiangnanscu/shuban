import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import { commonPinyinOf } from '../lib/common-chars';
import { shanghaiToday } from '../lib/time';

/** D1 datetime('now') 存 'YYYY-MM-DD HH:MM:SS'（UTC 无时区标记），review 侧存 ISO；统一转上海日期 */
function toShanghaiDate(dbTime: string): string {
	const iso = dbTime.includes('T') ? dbTime : `${dbTime.replace(' ', 'T')}Z`;
	const t = new Date(iso).getTime();
	return new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
}

function prevDay(ymd: string): string {
	return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);
}

export const statsRoutes = new Hono<AppEnv>()
	// —— 阅读会话（打卡数据来源） ——
	.post('/sessions/start', async (c) => {
		const body = await c.req.json<{ articleId?: number }>().catch(() => null);
		if (!body || !Number.isInteger(body.articleId)) return c.json(err('bad_id', '缺少 articleId'), 400);
		const ins = await c.env.DB.prepare('INSERT INTO reading_sessions (article_id) VALUES (?1)')
			.bind(body.articleId)
			.run();
		return c.json(ok({ sessionId: ins.meta.last_row_id }));
	})

	// sendBeacon 可能不带标准 JSON 头，用 text + 手动 parse 兜底
	.post('/sessions/end', async (c) => {
		let sessionId: unknown;
		try {
			sessionId = (JSON.parse(await c.req.raw.text()) as { sessionId?: unknown }).sessionId;
		} catch {
			return c.json(err('bad_body', '请求体不是 JSON'), 400);
		}
		if (!Number.isInteger(sessionId)) return c.json(err('bad_id', '缺少 sessionId'), 400);
		await c.env.DB.prepare("UPDATE reading_sessions SET ended_at = datetime('now') WHERE id = ?1 AND ended_at IS NULL")
			.bind(sessionId)
			.run();
		return c.json(ok({ ended: true }));
	})

	// —— 学习报告汇总 ——
	.get('/stats/summary', async (c) => {
		const db = c.env.DB;
		const nowIso = new Date().toISOString();
		const since = new Date(Date.now() - 90 * 864e5).toISOString();

		const [poolActive, graduated, dueToday, articlesRead, topChars, sessionDates, quizDates] = await Promise.all([
			db.prepare('SELECT COUNT(*) AS n FROM review_items WHERE graduated = 0').first<{ n: number }>(),
			db.prepare('SELECT COUNT(*) AS n FROM review_items WHERE graduated = 1').first<{ n: number }>(),
			db
				.prepare('SELECT COUNT(*) AS n FROM review_items WHERE graduated = 0 AND due_at <= ?1')
				.bind(nowIso)
				.first<{ n: number }>(),
			db.prepare('SELECT COUNT(DISTINCT article_id) AS n FROM reading_sessions').first<{ n: number }>(),
			db
				.prepare('SELECT ch, pinyin, total_taps FROM chars ORDER BY total_taps DESC, ch LIMIT 10')
				.all<{ ch: string; pinyin: string; total_taps: number }>(),
			db
				.prepare('SELECT started_at AS t FROM reading_sessions WHERE started_at >= ?1')
				.bind(since.replace('T', ' ').slice(0, 19))
				.all<{ t: string }>(),
			db
				.prepare('SELECT answered_at AS t FROM quiz_answers WHERE answered_at >= ?1')
				.bind(since.replace('T', ' ').slice(0, 19))
				.all<{ t: string }>(),
		]);

		// 打卡日 = 当天（上海时区）有阅读会话或答题
		const activeDays = new Set<string>();
		for (const r of sessionDates.results) activeDays.add(toShanghaiDate(r.t));
		for (const r of quizDates.results) activeDays.add(toShanghaiDate(r.t));

		let streak = 0;
		let day = shanghaiToday();
		if (!activeDays.has(day)) day = prevDay(day); // 今天还没读，从昨天起算
		while (activeDays.has(day)) {
			streak++;
			day = prevDay(day);
		}

		return c.json(
			ok({
				streak,
				activeToday: activeDays.has(shanghaiToday()),
				articlesRead: articlesRead?.n ?? 0,
				poolActive: poolActive?.n ?? 0,
				graduated: graduated?.n ?? 0,
				dueToday: dueToday?.n ?? 0,
				topChars: topChars.results.map((r) => ({
					ch: r.ch,
					pinyin: r.pinyin || commonPinyinOf(r.ch),
					taps: r.total_taps,
				})),
			}),
		);
	})

	// —— 生字表（打印视图用，含毕业字标记） ——
	.get('/pool/detail', async (c) => {
		const { results } = await c.env.DB.prepare(
			`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin, r.graduated
			 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch`,
		).all<{ ch: string; pinyin: string; graduated: number }>();
		const items = results
			.map((r) => ({ ch: r.ch, pinyin: r.pinyin || commonPinyinOf(r.ch), graduated: r.graduated === 1 }))
			.sort((a, b) => a.pinyin.localeCompare(b.pinyin, 'zh') || a.ch.localeCompare(b.ch, 'zh'));
		return c.json(ok(items));
	});
