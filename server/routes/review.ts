import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ok } from '../env';
import { commonPinyinOf } from '../lib/common-chars';
import { buildReadingPlan, type PlanArticle } from '../lib/reading-plan';

const SINGLE_HAN = /^\p{Script=Han}$/u;

interface DueRow {
	ch: string;
	pinyin: string;
	box: number;
}

interface ArticleRow {
	id: number;
	title: string;
	last_read: string | null;
}

interface PageContentRow {
	article_id: number;
	content_json: string;
}

/** 从一页 content_json 中抽出全部单个汉字 */
function collectHan(contentJson: string, into: Set<string>): void {
	let parsed: { lines?: { tokens?: { t?: string }[] }[] };
	try {
		parsed = JSON.parse(contentJson);
	} catch {
		return;
	}
	for (const line of parsed.lines ?? []) {
		for (const tok of line.tokens ?? []) {
			for (const ch of tok.t ?? '') if (SINGLE_HAN.test(ch)) into.add(ch);
		}
	}
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
	})

	// 重读计划：对目标生字集合 A 求“最少数量、能覆盖 A”的文章列表（贪心集合覆盖，见 lib/reading-plan.ts）。
	// scope=due（默认）取今日到期字；scope=all 取生字池全部未毕业字。
	.get('/review/reading-plan', async (c) => {
		const scope = c.req.query('scope') === 'all' ? 'all' : 'due';
		const targetSql =
			scope === 'all'
				? 'SELECT ch FROM review_items WHERE graduated = 0'
				: 'SELECT ch FROM review_items WHERE graduated = 0 AND due_at <= ?1';
		const targetStmt =
			scope === 'all'
				? c.env.DB.prepare(targetSql)
				: c.env.DB.prepare(targetSql).bind(new Date().toISOString());

		const { results: targetRows } = await targetStmt.all<{ ch: string }>();
		const targets = targetRows.map((r) => r.ch);
		if (targets.length === 0) {
			return c.json(ok({ scope, targetCount: 0, plan: [], uncovered: [] }));
		}

		// 已发布文章元信息 + 最近阅读时间（从没读过为 null → 重读时最优先）
		const [{ results: articleRows }, { results: pageRows }] = await Promise.all([
			c.env.DB.prepare(
				`SELECT a.id, a.title,
				        (SELECT MAX(s.started_at) FROM reading_sessions s WHERE s.article_id = a.id) AS last_read
				 FROM articles a WHERE a.status = 'published'`,
			).all<ArticleRow>(),
			c.env.DB.prepare(
				`SELECT p.article_id, p.content_json FROM pages p
				 JOIN articles a ON a.id = p.article_id WHERE a.status = 'published'`,
			).all<PageContentRow>(),
		]);

		const charsById = new Map<number, Set<string>>();
		for (const row of pageRows) {
			let set = charsById.get(row.article_id);
			if (!set) {
				set = new Set<string>();
				charsById.set(row.article_id, set);
			}
			collectHan(row.content_json, set);
		}

		const articles: PlanArticle[] = articleRows.map((a) => ({
			id: a.id,
			title: a.title,
			chars: charsById.get(a.id) ?? new Set<string>(),
			lastReadAt: a.last_read,
		}));

		const { plan, uncovered } = buildReadingPlan(targets, articles);
		return c.json(ok({ scope, targetCount: targets.length, plan, uncovered }));
	});
