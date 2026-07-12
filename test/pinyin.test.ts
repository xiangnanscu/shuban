import { describe, expect, it } from 'vitest';
import { finalOf, initialOf, stripTone, syllableFileName } from '../server/lib/pinyin';

describe('stripTone', () => {
	it('去掉各调号', () => {
		expect(stripTone('xiǎo')).toBe('xiao');
		expect(stripTone('lǜ')).toBe('lü');
		expect(stripTone('ér')).toBe('er');
		expect(stripTone('zhe')).toBe('zhe');
	});
});

describe('initialOf / finalOf', () => {
	it('双字母声母优先', () => {
		expect(initialOf('zhǎng')).toBe('zh');
		expect(finalOf('zhǎng')).toBe('ang');
		expect(initialOf('chī')).toBe('ch');
		expect(initialOf('shuǐ')).toBe('sh');
	});

	it('单字母声母', () => {
		expect(initialOf('mǎ')).toBe('m');
		expect(finalOf('mǎ')).toBe('a');
		expect(initialOf('qī')).toBe('q');
	});

	it('零声母', () => {
		expect(initialOf('ér')).toBe('');
		expect(finalOf('ér')).toBe('er');
		expect(initialOf('ān')).toBe('');
	});
});

describe('syllableFileName', () => {
	it('声调符号转数字', () => {
		expect(syllableFileName('xiǎo')).toBe('xiao3');
		expect(syllableFileName('cáng')).toBe('cang2');
		expect(syllableFileName('ér')).toBe('er2');
		expect(syllableFileName('zhǎng')).toBe('zhang3');
	});

	it('ü 写作 uu', () => {
		expect(syllableFileName('lǜ')).toBe('luu4');
		expect(syllableFileName('nǚ')).toBe('nuu3');
		expect(syllableFileName('nüè')).toBe('nuue4');
	});

	it('轻声记 5', () => {
		expect(syllableFileName('de')).toBe('de5');
		expect(syllableFileName('ma')).toBe('ma5');
	});

	it('非法输入返回 null', () => {
		expect(syllableFileName('')).toBeNull();
		expect(syllableFileName('小')).toBeNull();
		expect(syllableFileName('abc123')).toBeNull();
	});
});
