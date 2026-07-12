// Leitner 盒复习调度（纯函数，便于单测）。规则见 DEVELOPMENT.md §9.1：
// 答对 → box+1（上限 6）、间隔拉长；在 box=6 答对 → 毕业。
// 答错 → 归零，10 分钟后重试（本轮内可再来一次）。

export const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 7, 15, 30] as const;
export const MAX_BOX = 6;
export const WRONG_RETRY_MINUTES = 10;

export interface LeitnerNext {
	box: number;
	graduated: boolean;
	dueAt: string; // UTC ISO
}

export function applyAnswer(box: number, correct: boolean, now = new Date()): LeitnerNext {
	if (!correct) {
		return { box: 0, graduated: false, dueAt: addMinutes(now, WRONG_RETRY_MINUTES) };
	}
	if (box >= MAX_BOX) {
		return { box: MAX_BOX, graduated: true, dueAt: addDays(now, BOX_INTERVAL_DAYS[MAX_BOX]) };
	}
	const next = box + 1;
	return { box: next, graduated: false, dueAt: addDays(now, BOX_INTERVAL_DAYS[next] ?? BOX_INTERVAL_DAYS[MAX_BOX]) };
}

function addMinutes(d: Date, minutes: number): string {
	return new Date(d.getTime() + minutes * 60_000).toISOString();
}

function addDays(d: Date, days: number): string {
	return new Date(d.getTime() + days * 86_400_000).toISOString();
}
