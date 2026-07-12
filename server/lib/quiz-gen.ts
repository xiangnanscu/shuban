// 测验出题（纯函数，便于单测）：模式抽取 + 干扰项生成，规则见 DEVELOPMENT.md §9.2/§9.3。

import { COMMON_CHARS } from './common-chars';
import { finalOf, initialOf } from './pinyin';

export type QuizMode = 'listen_pick' | 'pick_pinyin' | 'read_aloud';
export const QUIZ_MODES: readonly QuizMode[] = ['listen_pick', 'pick_pinyin', 'read_aloud'];

export interface QuizChar {
	ch: string;
	pinyin: string;
}

export interface QuizQuestion {
	mode: QuizMode;
	ch: string;
	pinyin: string;
	/** listen_pick：4 个汉字；pick_pinyin：4 个拼音；read_aloud：空数组 */
	options: string[];
}

/** 默认混合比例：听音选字 60% / 看字选拼音 20% / 看字读音 20% */
export function pickMode(rand: () => number = Math.random): QuizMode {
	const r = rand();
	if (r < 0.6) return 'listen_pick';
	if (r < 0.8) return 'pick_pinyin';
	return 'read_aloud';
}

const OPTION_COUNT = 4;

/**
 * 干扰项：① 池内同声母或同韵母（易混）→ ② 池内随机 → ③ 内置常用字表补齐。
 * 所有选中项与目标字读音（含调）互不相同。
 */
export function buildDistractors(target: QuizChar, pool: QuizChar[], rand: () => number = Math.random): QuizChar[] {
	const usedCh = new Set([target.ch]);
	const usedPinyin = new Set([target.pinyin]);
	const chosen: QuizChar[] = [];

	const take = (candidates: QuizChar[]) => {
		for (const c of shuffle(candidates, rand)) {
			if (chosen.length >= OPTION_COUNT - 1) return;
			if (!c.pinyin || usedCh.has(c.ch) || usedPinyin.has(c.pinyin)) continue;
			chosen.push(c);
			usedCh.add(c.ch);
			usedPinyin.add(c.pinyin);
		}
	};

	const ini = initialOf(target.pinyin);
	const fin = finalOf(target.pinyin);
	const confusable = pool.filter(
		(c) => c.pinyin && ((ini !== '' && initialOf(c.pinyin) === ini) || finalOf(c.pinyin) === fin),
	);
	take(confusable);
	take(pool);
	take(COMMON_CHARS);
	return chosen;
}

export function buildQuestion(
	target: QuizChar,
	pool: QuizChar[],
	mode: QuizMode,
	rand: () => number = Math.random,
): QuizQuestion {
	if (mode === 'read_aloud') {
		return { mode, ch: target.ch, pinyin: target.pinyin, options: [] };
	}
	const all = shuffle([target, ...buildDistractors(target, pool, rand)], rand);
	return {
		mode,
		ch: target.ch,
		pinyin: target.pinyin,
		options: all.map((c) => (mode === 'listen_pick' ? c.ch : c.pinyin)),
	};
}

export function shuffle<T>(arr: readonly T[], rand: () => number = Math.random): T[] {
	const out = [...arr];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}
