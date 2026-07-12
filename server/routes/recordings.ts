import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err, ok } from '../env';

const MAX_REC_BYTES = 20 * 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3']);

interface RecordingRow {
	id: number;
	article_id: number | null;
	title: string | null;
	r2_key: string;
	duration_sec: number | null;
	size_bytes: number | null;
	created_at: string;
}

export const recordingRoutes = new Hono<AppEnv>()
	// 存档录音（孩子端朗读模式直接上传，单家庭不设门槛；删除在 admin）
	.post('/recordings', async (c) => {
		const form = await c.req.raw.formData();
		const file = form.get('file');
		if (!(file instanceof File)) return c.json(err('no_file', '未收到录音文件'), 400);
		if (!AUDIO_TYPES.has(file.type)) return c.json(err('bad_type', `不支持的音频类型 ${file.type}`), 400);
		if (file.size > MAX_REC_BYTES) return c.json(err('too_large', '录音需 ≤20MB'), 400);

		const articleIdRaw = Number(form.get('articleId'));
		const articleId = Number.isInteger(articleIdRaw) && articleIdRaw > 0 ? articleIdRaw : null;
		const durationRaw = Number(form.get('durationSec'));
		const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw * 10) / 10 : null;

		const key = `rec/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.mp3`;
		await c.env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'audio/mpeg' } });
		const ins = await c.env.DB.prepare(
			'INSERT INTO recordings (article_id, r2_key, duration_sec, size_bytes) VALUES (?1, ?2, ?3, ?4)',
		)
			.bind(articleId, key, durationSec, file.size)
			.run();
		return c.json(ok({ id: ins.meta.last_row_id, url: `/api/files/${key}` }));
	})

	// 录音历史（可按文章过滤）
	.get('/recordings', async (c) => {
		const articleIdRaw = Number(c.req.query('articleId'));
		const filter = Number.isInteger(articleIdRaw) && articleIdRaw > 0;
		const { results } = await c.env.DB.prepare(
			`SELECT r.id, r.article_id, a.title, r.r2_key, r.duration_sec, r.size_bytes, r.created_at
			 FROM recordings r LEFT JOIN articles a ON a.id = r.article_id
			 ${filter ? 'WHERE r.article_id = ?1' : ''}
			 ORDER BY r.created_at DESC LIMIT 200`,
		)
			.bind(...(filter ? [articleIdRaw] : []))
			.all<RecordingRow>();

		return c.json(
			ok(
				results.map((r) => ({
					id: r.id,
					articleId: r.article_id,
					articleTitle: r.title ?? '（文章已删除）',
					url: `/api/files/${r.r2_key}`,
					durationSec: r.duration_sec,
					sizeBytes: r.size_bytes,
					createdAt: r.created_at,
				})),
			),
		);
	});
