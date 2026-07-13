// 重读计划（纯函数，便于单测）：给定目标生字集合 A，求最少数量、能覆盖 A 的文章列表。
// 这是最小集合覆盖（NP-hard），用贪心近似：每步选“新覆盖 A 中字最多”的文章；
// 平局取“最久没读”的（lastReadAt 最早，从没读过视为最早 → 最优先），再平取 id 小的（保证确定性）。
// 规则见 DEVELOPMENT.md §9.5。

export interface PlanArticle {
	id: number;
	title: string;
	/** 该文出现过的全部汉字（去重） */
	chars: Set<string>;
	/** 最近一次阅读时间（session started_at），从没读过为 null */
	lastReadAt: string | null;
}

export interface PlanEntry {
	articleId: number;
	title: string;
	/** 本篇为 A 覆盖到的字（已排序，稳定输出） */
	covers: string[];
}

export interface ReadingPlan {
	/** 贪心选出的文章序列 */
	plan: PlanEntry[];
	/** A 中没有任何文章包含的字（如原文章已删） */
	uncovered: string[];
}

/** a 的阅读时间是否比 b 更早（null=从没读过，视为最早）：负=a 更早，正=a 更晚，0=相同 */
function compareAge(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null) return -1;
	if (b === null) return 1;
	return a < b ? -1 : a > b ? 1 : 0;
}

export function buildReadingPlan(targets: Iterable<string>, articles: PlanArticle[]): ReadingPlan {
	const remaining = new Set(targets);
	const used = new Set<number>();
	const plan: PlanEntry[] = [];

	while (remaining.size > 0) {
		let best: PlanArticle | null = null;
		let bestCovers: string[] = [];

		for (const a of articles) {
			if (used.has(a.id)) continue;
			const covers: string[] = [];
			for (const ch of remaining) if (a.chars.has(ch)) covers.push(ch);
			if (covers.length === 0) continue;

			const better =
				best === null ||
				covers.length > bestCovers.length ||
				(covers.length === bestCovers.length &&
					(compareAge(a.lastReadAt, best.lastReadAt) < 0 ||
						(compareAge(a.lastReadAt, best.lastReadAt) === 0 && a.id < best.id)));
			if (better) {
				best = a;
				bestCovers = covers;
			}
		}

		if (!best) break; // 剩余的字没有文章能覆盖
		used.add(best.id);
		plan.push({ articleId: best.id, title: best.title, covers: bestCovers.sort() });
		for (const ch of bestCovers) remaining.delete(ch);
	}

	return { plan, uncovered: [...remaining].sort() };
}
