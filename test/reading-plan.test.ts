import { describe, expect, it } from 'vitest';
import { buildReadingPlan, type PlanArticle } from '../server/lib/reading-plan';

function art(id: number, chars: string, lastReadAt: string | null = null): PlanArticle {
	return { id, title: `文${id}`, chars: new Set([...chars]), lastReadAt };
}

describe('buildReadingPlan', () => {
	it('单篇即可全覆盖时只选一篇', () => {
		const r = buildReadingPlan('藏河', [art(1, '藏河望'), art(2, '藏')]);
		expect(r.plan.map((p) => p.articleId)).toEqual([1]);
		expect(r.plan[0]!.covers).toEqual(['河', '藏']); // sort() 后按码位
		expect(r.uncovered).toEqual([]);
	});

	it('贪心先取覆盖最多的文章', () => {
		// A = 甲乙丙丁；文1 覆盖甲乙丙，文2 覆盖丁，文3 覆盖甲
		const r = buildReadingPlan('甲乙丙丁', [art(1, '甲乙丙'), art(2, '丁戊'), art(3, '甲')]);
		expect(r.plan.map((p) => p.articleId)).toEqual([1, 2]);
		expect(r.uncovered).toEqual([]);
	});

	it('平局时取最久没读（从没读过最优先）', () => {
		// 两篇都覆盖同样的字，文2 从没读过 → 优先
		const r = buildReadingPlan('甲', [art(1, '甲', '2026-07-13 10:00:00'), art(2, '甲', null)]);
		expect(r.plan.map((p) => p.articleId)).toEqual([2]);
	});

	it('都读过时取阅读时间更早的', () => {
		const r = buildReadingPlan('甲', [art(1, '甲', '2026-07-13 10:00:00'), art(2, '甲', '2026-07-10 10:00:00')]);
		expect(r.plan.map((p) => p.articleId)).toEqual([2]);
	});

	it('覆盖数与时间都相同则取 id 小的（确定性）', () => {
		const r = buildReadingPlan('甲', [art(5, '甲', null), art(2, '甲', null)]);
		expect(r.plan.map((p) => p.articleId)).toEqual([2]);
	});

	it('无文章能覆盖的字进 uncovered', () => {
		const r = buildReadingPlan('甲乙', [art(1, '甲')]);
		expect(r.plan.map((p) => p.articleId)).toEqual([1]);
		expect(r.uncovered).toEqual(['乙']);
	});

	it('空目标返回空计划', () => {
		const r = buildReadingPlan('', [art(1, '甲')]);
		expect(r.plan).toEqual([]);
		expect(r.uncovered).toEqual([]);
	});

	it('多篇拼齐：每步都推进，不会死循环', () => {
		const r = buildReadingPlan('甲乙丙丁戊', [art(1, '甲乙'), art(2, '丙丁'), art(3, '戊'), art(4, '甲丙戊')]);
		// 文4 覆盖甲丙戊(3)最多先选；余乙丁；文1 覆盖乙、文2 覆盖丁
		expect(r.plan[0]!.articleId).toBe(4);
		expect(r.uncovered).toEqual([]);
		const covered = new Set(r.plan.flatMap((p) => p.covers));
		expect([...covered].sort()).toEqual(['丁', '丙', '乙', '戊', '甲'].sort());
	});
});
