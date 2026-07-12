import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { err, ok } from '../env';
import { commonPinyinOf } from '../lib/common-chars';
import { applyAnswer } from '../lib/leitner';
import { buildQuestion, pickMode, QUIZ_MODES, type QuizChar, type QuizMode } from '../lib/quiz-gen';

const SINGLE_HAN = /^\p{Script=Han}$/u;

interface TargetRow {
	ch: string;
	pinyin: string;
	box: number;
}

export const quizRoutes = new Hono<AppEnv>()
	// 服务端出一题：默认取最早到期的字；practice=1 时从整个生字池随机抽（毕业字手动抽查）
	.get('/quiz/next', async (c) => {
		const practice = c.req.query('practice') === '1';
		const target = practice
			? await c.env.DB.prepare(
					`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin, r.box
					 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch
					 ORDER BY RANDOM() LIMIT 1`,
				).first<TargetRow>()
			: await c.env.DB.prepare(
					`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin, r.box
					 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch
					 WHERE r.graduated = 0 AND r.due_at <= ?1
					 ORDER BY r.due_at LIMIT 1`,
				)
					.bind(new Date().toISOString())
					.first<TargetRow>();
		if (!target) return c.json(ok({ done: true as const }));

		const pinyin = target.pinyin || commonPinyinOf(target.ch);
		const { results: pool } = await c.env.DB.prepare(
			`SELECT r.ch, COALESCE(c.pinyin, '') AS pinyin
			 FROM review_items r LEFT JOIN chars c ON c.ch = r.ch
			 WHERE r.ch != ?1`,
		)
			.bind(target.ch)
			.all<QuizChar>();

		const requested = c.req.query('mode') as QuizMode | undefined;
		let mode = requested && QUIZ_MODES.includes(requested) ? requested : pickMode();
		// 读音未知的字无法出选项题/校验读音，退化为家长判分的读字题
		if (!pinyin) mode = 'read_aloud';

		return c.json(ok({ done: false as const, question: buildQuestion({ ch: target.ch, pinyin }, pool, mode) }));
	})

	// 记答题流水 + Leitner 升降级；practice=true 只记流水不动盒（轮末重测、手动抽查用）
	.post('/quiz/answer', async (c) => {
		const body = await c.req
			.json<{ ch?: string; mode?: string; correct?: boolean; practice?: boolean }>()
			.catch(() => null);
		if (!body || typeof body.ch !== 'string' || !SINGLE_HAN.test(body.ch)) {
			return c.json(err('bad_ch', 'ch 必须是单个汉字'), 400);
		}
		if (!QUIZ_MODES.includes(body.mode as QuizMode)) return c.json(err('bad_mode', '无效测验模式'), 400);
		if (typeof body.correct !== 'boolean') return c.json(err('bad_correct', 'correct 必须是布尔值'), 400);
		const { ch, mode, correct } = body;

		await c.env.DB.prepare('INSERT INTO quiz_answers (ch, mode, correct) VALUES (?1, ?2, ?3)')
			.bind(ch, mode, correct ? 1 : 0)
			.run();

		if (body.practice) return c.json(ok({ practice: true }));

		const item = await c.env.DB.prepare('SELECT box FROM review_items WHERE ch = ?1')
			.bind(ch)
			.first<{ box: number }>();
		if (!item) return c.json(err('not_in_pool', '该字不在生字池中'), 404);

		const next = applyAnswer(item.box, correct);
		await c.env.DB.prepare(
			`UPDATE review_items SET box = ?1, graduated = ?2, due_at = ?3,
			   correct_count = correct_count + ?4, wrong_count = wrong_count + ?5,
			   updated_at = datetime('now')
			 WHERE ch = ?6`,
		)
			.bind(next.box, next.graduated ? 1 : 0, next.dueAt, correct ? 1 : 0, correct ? 0 : 1, ch)
			.run();
		return c.json(ok({ box: next.box, graduated: next.graduated, dueAt: next.dueAt }));
	});
