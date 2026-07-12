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

const TONE_NUM: Record<string, number> = {
	ā: 1, á: 2, ǎ: 3, à: 4,
	ē: 1, é: 2, ě: 3, è: 4,
	ī: 1, í: 2, ǐ: 3, ì: 4,
	ō: 1, ó: 2, ǒ: 3, ò: 4,
	ū: 1, ú: 2, ǔ: 3, ù: 4,
	ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
	ń: 2, ň: 3, ǹ: 4, ḿ: 2,
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

/**
 * 带调拼音 → 真人音节录音库文件名（davinfifield/mp3-chinese-pinyin-sound 命名）：
 * xiǎo→xiao3、lǜ→luu4（ü 写作 uu）、轻声无调号→5（de→de5）。
 * 非法输入返回 null。
 */
export function syllableFileName(pinyin: string): string | null {
	const norm = pinyin.trim().toLowerCase().normalize('NFC');
	if (!norm) return null;
	let tone = 5;
	for (const c of norm) {
		const t = TONE_NUM[c];
		if (t) {
			tone = t;
			break;
		}
	}
	const base = stripTone(norm).replace(/ü/g, 'uu');
	if (!/^[a-z]{1,7}$/.test(base)) return null;
	return `${base}${tone}`;
}
