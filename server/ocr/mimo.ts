import { toBase64 } from '../lib/bytes';
import { OCR_SYSTEM_PROMPT, PAGE_SCHEMA } from './prompt';
import type { OcrProvider } from './types';
import { validatePageContent } from './validate';

const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	error?: { message?: string };
}

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
						{ role: 'system', content: OCR_SYSTEM_PROMPT },
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
			return validatePageContent(JSON.parse(text));
		},
	};
}
