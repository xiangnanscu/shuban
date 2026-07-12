import { describe, expect, it } from 'vitest';
import { COMMON_CHARS } from '../server/lib/common-chars';
import { buildDistractors, buildQuestion, type QuizChar } from '../server/lib/quiz-gen';

const HAN = /^\p{Script=Han}$/u;
const PINYIN = /^[a-zümḿń̀áǎàēéěèêīíǐìōóǒòūúǔùǖǘǚǜāńňǹ]+$/u;

describe('COMMON_CHARS 表完整性', () => {
	it('每项都是单个汉字 + 非空拼音，无重复字', () => {
		expect(COMMON_CHARS.length).toBeGreaterThanOrEqual(280);
		const seen = new Set<string>();
		for (const { ch, pinyin } of COMMON_CHARS) {
			expect(ch, `字「${ch}」`).toMatch(HAN);
			expect(pinyin.length, `「${ch}」的拼音`).toBeGreaterThan(0);
			expect(pinyin, `「${ch}」的拼音 ${pinyin}`).toMatch(PINYIN);
			expect(seen.has(ch), `重复字「${ch}」`).toBe(false);
			seen.add(ch);
		}
	});
});

describe('buildDistractors', () => {
	const target: QuizChar = { ch: '藏', pinyin: 'cáng' };

	it('池不足时用常用字表补满 3 个干扰项', () => {
		const d = buildDistractors(target, []);
		expect(d).toHaveLength(3);
		for (const c of d) expect(c.ch).not.toBe(target.ch);
	});

	it('干扰项与目标读音（含调）互不相同', () => {
		for (let i = 0; i < 30; i++) {
			const d = buildDistractors(target, COMMON_CHARS.slice(0, 20));
			const pinyins = new Set([target.pinyin, ...d.map((c) => c.pinyin)]);
			expect(pinyins.size).toBe(4);
		}
	});

	it('优先选池内同声母/同韵母的易混字', () => {
		const pool: QuizChar[] = [
			{ ch: '仓', pinyin: 'cāng' }, // 同声母同韵母
			{ ch: '曾', pinyin: 'céng' }, // 同声母
			{ ch: '狼', pinyin: 'láng' }, // 同韵母
			{ ch: '树', pinyin: 'shù' }, // 都不同
			{ ch: '花', pinyin: 'huā' }, // 都不同
		];
		const d = buildDistractors(target, pool, () => 0.5);
		const chosen = new Set(d.map((c) => c.ch));
		expect(chosen.has('仓')).toBe(true);
		expect(chosen.has('曾')).toBe(true);
		expect(chosen.has('狼')).toBe(true);
	});

	it('跳过没有拼音的池字', () => {
		const d = buildDistractors(target, [{ ch: '汉', pinyin: '' }]);
		expect(d.every((c) => c.pinyin !== '')).toBe(true);
		expect(d.every((c) => c.ch !== '汉')).toBe(true);
	});
});

describe('buildQuestion', () => {
	const target: QuizChar = { ch: '马', pinyin: 'mǎ' };

	it('4 个汉字选项，含目标字且互不相同', () => {
		const q = buildQuestion(target, []);
		expect(q.mode).toBe('listen_pick');
		expect(q.options).toHaveLength(4);
		expect(q.options).toContain('马');
		expect(new Set(q.options).size).toBe(4);
		expect(q.pinyin).toBe('mǎ');
	});
});
