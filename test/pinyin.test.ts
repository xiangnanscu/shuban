import { describe, expect, it } from 'vitest';
import { finalOf, initialOf, stripTone } from '../server/lib/pinyin';

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
