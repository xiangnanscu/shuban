import { toBase64 } from '../lib/bytes';
import { OCR_SYSTEM_PROMPT, PAGE_SCHEMA } from './prompt';
import type { OcrProvider } from './types';
import { validatePageContent } from './validate';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	error?: { message?: string };
}

/**
 * MiMo 不支持 response_format=json_schema（静默忽略，自由发挥字段名/结构），
 * 必须在 prompt 里把 JSON 结构讲死，并要求裸 JSON（不要 markdown 代码块）。
 */
const MIMO_SCHEMA_NOTE = `严格按以下 JSON 结构输出，字段名和层级不得更改：
{"title": string|null, "lines": [{"align": "left"|"center"|"right", "tokens": [{"t": string, "p": string}]}]}
每一行是 lines 数组里的一个对象，自带 align；align 不是顶层字段。每个字符/串是 tokens 里的一个对象，字段名必须是 "t"（不是 token），拼音字段名必须是 "p"（无拼音则填空字符串）。
直接输出 JSON 对象本身，不要用 \`\`\` 包裹，不要输出任何 JSON 之外的文字。`;

/** 小米 MiMo，OpenAI 兼容 chat/completions 格式 */
export function mimoProvider(apiKey: string, model: string): OcrProvider {
	if (!apiKey) throw new Error('缺少 MIMO_KEY（wrangler secret / .dev.vars）');

	return {
		async recognize(image, { isFirstPage, signal }) {
			const res = await fetch(MIMO_API_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
				signal,
				body: JSON.stringify({
					model,
					messages: [
						{ role: 'system', content: `${OCR_SYSTEM_PROMPT}\n\n${MIMO_SCHEMA_NOTE}` },
						{
							role: 'user',
							content: [
								{
									type: 'image_url',
									image_url: { url: `data:image/jpeg;base64,${toBase64(image)}`, detail: 'high' },
								},
								{
									type: 'text',
									text: isFirstPage
										? '识别这一页。这是第一页，如页面上有书名/标题，填入 title；正文放 lines。'
										: '识别这一页正文，title 置为 null。',
								},
							],
						},
					],
					response_format: {
						type: 'json_schema',
						json_schema: { name: 'page_content', schema: PAGE_SCHEMA, strict: true },
					},
					max_tokens: 8192,
				}),
			});

			const data = (await res.json()) as ChatResponse;
			if (!res.ok) throw new Error(`MiMo HTTP ${res.status}: ${data.error?.message ?? '未知错误'}`);
			const text = data.choices?.[0]?.message?.content;
			if (!text) throw new Error('MiMo 未返回文本');
			// 忽略 response_format 时偶尔仍会用 ```json 包裹，容错剥离
			const stripped = text
				.trim()
				.replace(/^```(?:json)?\n?/, '')
				.replace(/```$/, '');
			return validatePageContent(JSON.parse(stripped));
		},
	};
}
