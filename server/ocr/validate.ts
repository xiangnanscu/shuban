import type { PageContent, PageLine, PageToken } from './types';

const HAN = /\p{Script=Han}/u;

/**
 * 校验并规范化模型输出。
 * - 结构不合法 → 抛错（该页标 failed，供重试）
 * - 可修复的问题做规范化：多字含汉 token 拆成单字、空 token 丢弃
 */
export function validatePageContent(x: unknown): PageContent {
	if (typeof x !== 'object' || x === null) throw new Error('OCR 输出不是对象');
	const obj = x as Record<string, unknown>;

	let title: string | null = null;
	if (typeof obj.title === 'string') title = obj.title.trim() || null;
	else if (obj.title !== null && obj.title !== undefined) throw new Error('title 类型错误');

	if (!Array.isArray(obj.lines)) throw new Error('lines 不是数组');

	const lines: PageLine[] = obj.lines.map((rawLine, i) => {
		if (typeof rawLine !== 'object' || rawLine === null) throw new Error(`第 ${i + 1} 行不是对象`);
		const line = rawLine as Record<string, unknown>;
		const align = line.align;
		if (align !== 'left' && align !== 'center' && align !== 'right') throw new Error(`第 ${i + 1} 行 align 非法`);
		if (!Array.isArray(line.tokens)) throw new Error(`第 ${i + 1} 行 tokens 不是数组`);

		const tokens: PageToken[] = [];
		for (const rawTok of line.tokens) {
			if (typeof rawTok !== 'object' || rawTok === null) throw new Error(`第 ${i + 1} 行含非法 token`);
			const tok = rawTok as Record<string, unknown>;
			if (typeof tok.t !== 'string') throw new Error(`第 ${i + 1} 行 token 缺 t`);
			const t = tok.t;
			if (t.length === 0) continue;
			const p = typeof tok.p === 'string' && tok.p.trim() ? tok.p.trim() : undefined;

			const chars = [...t];
			if (chars.length === 1) {
				tokens.push(HAN.test(t) ? { t, p: p ?? '' } : { t });
			} else if (HAN.test(t)) {
				// 模型违规合并了多个汉字：拆成单字，拼音无法对应则置空，交给校对
				for (const ch of chars) tokens.push(HAN.test(ch) ? { t: ch, p: '' } : { t: ch });
			} else {
				tokens.push({ t }); // 非汉字串，允许合并
			}
		}
		return { align, tokens };
	});

	// 去掉首尾的纯空行
	while (lines.length && lines[0].tokens.length === 0) lines.shift();
	while (lines.length && lines[lines.length - 1].tokens.length === 0) lines.pop();

	return { title, lines };
}
