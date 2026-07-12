// 拼音工具：去声调、拆声母/韵母。干扰项的"同声母/同韵母易混字"判定用（§9.3）。

const TONE_MAP: Record<string, string> = {
	ā: 'a', á: 'a', ǎ: 'a', à: 'a',
	ē: 'e', é: 'e', ě: 'e', è: 'e', ê: 'e',
	ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
	ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
	ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
	ǖ: 'ü', ǘ: 'ü', ǚ: 'ü', ǜ: 'ü',
	ń: 'n', ň: 'n', ǹ: 'n', ḿ: 'm',
};

/** 去掉声调符号（ǚ→ü 保留 ü 本体） */
export function stripTone(pinyin: string): string {
	let out = '';
	for (const c of pinyin.toLowerCase().normalize('NFC')) out += TONE_MAP[c] ?? c;
	return out;
}

const TWO_LETTER_INITIALS = ['zh', 'ch', 'sh'] as const;
const ONE_LETTER_INITIALS = new Set('bpmfdtnlgkhjqxrzcsyw');

/** 声母（零声母如 "ān" 返回 ''） */
export function initialOf(pinyin: string): string {
	const s = stripTone(pinyin);
	for (const t of TWO_LETTER_INITIALS) if (s.startsWith(t)) return t;
	const first = s[0] ?? '';
	return ONE_LETTER_INITIALS.has(first) ? first : '';
}

/** 韵母（去调后去掉声母的剩余部分） */
export function finalOf(pinyin: string): string {
	const s = stripTone(pinyin);
	return s.slice(initialOf(pinyin).length);
}
