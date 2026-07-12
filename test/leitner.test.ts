import { describe, expect, it } from 'vitest';
import { applyAnswer, BOX_INTERVAL_DAYS, MAX_BOX, WRONG_RETRY_MINUTES } from '../server/lib/leitner';

const NOW = new Date('2026-07-12T04:00:00.000Z');
const DAY_MS = 86_400_000;

describe('applyAnswer', () => {
	it('答对升一盒，间隔按新盒拉长', () => {
		for (let box = 0; box < MAX_BOX; box++) {
			const next = applyAnswer(box, true, NOW);
			expect(next.box).toBe(box + 1);
			expect(next.graduated).toBe(false);
			expect(new Date(next.dueAt).getTime()).toBe(NOW.getTime() + BOX_INTERVAL_DAYS[box + 1]! * DAY_MS);
		}
	});

	it('box=6 答对 → 毕业', () => {
		const next = applyAnswer(6, true, NOW);
		expect(next.graduated).toBe(true);
		expect(next.box).toBe(MAX_BOX);
	});

	it('答错归零，10 分钟后重试', () => {
		for (const box of [0, 3, 6]) {
			const next = applyAnswer(box, false, NOW);
			expect(next.box).toBe(0);
			expect(next.graduated).toBe(false);
			expect(new Date(next.dueAt).getTime()).toBe(NOW.getTime() + WRONG_RETRY_MINUTES * 60_000);
		}
	});

	it('从 0 连对到毕业的完整路径', () => {
		let box = 0;
		let graduated = false;
		let steps = 0;
		while (!graduated && steps < 20) {
			const next = applyAnswer(box, true, NOW);
			box = next.box;
			graduated = next.graduated;
			steps++;
		}
		expect(graduated).toBe(true);
		// 0→1→2→3→4→5→6 共 6 次，第 7 次在 box6 答对毕业
		expect(steps).toBe(7);
	});

	it('中途答错回到起点', () => {
		let box = applyAnswer(4, false, NOW).box;
		expect(box).toBe(0);
		box = applyAnswer(box, true, NOW).box;
		expect(box).toBe(1);
	});
});
