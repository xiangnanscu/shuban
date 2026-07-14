import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import { isAuthed } from '../lib/auth';

interface ArticleRow {
	id: number;
	title: string;
	status: string;
	cover_key: string | null;
	cover_version: number | null;
	created_at: string;
	page_count: number;
}

interface PageRow {
	id: number;
	page_no: number;
	image_key: string;
	image_version: number;
	ocr_status: string;
	ocr_error: string | null;
	content_json: string;
}

export const articleRoutes = new Hono<AppEnv>()
	// 列表：孩子端只见已发布；家长会话可带草稿
	.get('/', async (c) => {
		const authed = await isAuthed(c);
		const where = authed ? '' : "WHERE a.status = 'published'";
		const { results } = await c.env.DB.prepare(
			`SELECT a.id, a.title, a.status, a.cover_key, a.created_at,
			        (SELECT COUNT(*) FROM pages p WHERE p.article_id = a.id) AS page_count,
			        (SELECT image_version FROM pages p WHERE p.article_id = a.id AND p.page_no = 1) AS cover_version
			 FROM articles a ${where} ORDER BY a.id DESC`,
		).all<ArticleRow>();

		return c.json(
			ok(
				results.map((a) => ({
					id: a.id,
					title: a.title,
					status: a.status,
					coverUrl: a.cover_key ? `/api/files/${a.cover_key}?v=${a.cover_version ?? 1}` : null,
					pageCount: a.page_count,
					createdAt: a.created_at,
				})),
			),
		);
	})

	.get('/:id', async (c) => {
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json(err('bad_id', '无效 id'), 400);

		const article = await c.env.DB.prepare(
			'SELECT id, title, status, cover_key, created_at FROM articles WHERE id = ?1',
		)
			.bind(id)
			.first<Omit<ArticleRow, 'page_count' | 'cover_version'>>();
		if (!article) return c.json(err('not_found', '文章不存在'), 404);

		if (article.status !== 'published' && !(await isAuthed(c))) {
			return c.json(err('not_found', '文章不存在'), 404);
		}

		const { results: pages } = await c.env.DB.prepare(
			'SELECT id, page_no, image_key, image_version, ocr_status, ocr_error, content_json FROM pages WHERE article_id = ?1 ORDER BY page_no',
		)
			.bind(id)
			.all<PageRow>();

		const authed = await isAuthed(c);
		const visWhere = authed ? '' : "AND status = 'published'";
		const [prev, next] = await Promise.all([
			c.env.DB.prepare(`SELECT id FROM articles WHERE id < ?1 ${visWhere} ORDER BY id DESC LIMIT 1`)
				.bind(id)
				.first<{ id: number }>(),
			c.env.DB.prepare(`SELECT id FROM articles WHERE id > ?1 ${visWhere} ORDER BY id ASC LIMIT 1`)
				.bind(id)
				.first<{ id: number }>(),
		]);

		return c.json(
			ok({
				id: article.id,
				title: article.title,
				status: article.status,
				createdAt: article.created_at,
				prevId: prev?.id ?? null,
				nextId: next?.id ?? null,
				pages: pages.map((p) => ({
					id: p.id,
					pageNo: p.page_no,
					imageUrl: `/api/files/${p.image_key}?v=${p.image_version}`,
					ocrStatus: p.ocr_status,
					ocrError: p.ocr_error,
					content: JSON.parse(p.content_json) as { lines: unknown[] },
				})),
			}),
		);
	});
