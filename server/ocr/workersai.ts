import { toBase64 } from '../lib/bytes';
import { OCR_SYSTEM_PROMPT, PAGE_SCHEMA } from './prompt';
import type { OcrProvider } from './types';
import { validatePageContent } from './validate';

interface ChatResponse {
	choices?: { message?: { content?: string } }[];
	response?: string;
}

/** Workers AI 备选（默认 @cf/moonshotai/kimi-k2.6：视觉 + 结构化输出，免额外 key） */
export function workersAiProvider(ai: Ai, model: string): OcrProvider {
	return {
		async recognize(image, { isFirstPage }) {
			const payload = {
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
				// OCR 是转写任务，不需要深推理；low 显著降低延迟与输出 token
				reasoning_effort: 'low',
				max_tokens: 8192,
			};

			const res = (await ai.run(model as Parameters<Ai['run']>[0], payload as never)) as ChatResponse;
			const text = res.choices?.[0]?.message?.content ?? res.response;
			if (!text) throw new Error('Workers AI 未返回文本');
			return validatePageContent(JSON.parse(text));
		},
	};
}
