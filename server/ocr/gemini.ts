import { toBase64 } from '../lib/bytes';
import { OCR_SYSTEM_PROMPT } from './prompt';
import type { OcrProvider } from './types';
import { validatePageContent } from './validate';

// Gemini responseSchema 用 OpenAPI 子集（Type 枚举 + nullable），非标准 JSON Schema
const GEMINI_SCHEMA = {
	type: 'OBJECT',
	required: ['title', 'lines'],
	properties: {
		title: { type: 'STRING', nullable: true },
		lines: {
			type: 'ARRAY',
			items: {
				type: 'OBJECT',
				required: ['align', 'tokens'],
				properties: {
					align: { type: 'STRING', enum: ['left', 'center', 'right'] },
					tokens: {
						type: 'ARRAY',
						items: {
							type: 'OBJECT',
							required: ['t'],
							properties: {
								t: { type: 'STRING' },
								p: { type: 'STRING', nullable: true },
							},
						},
					},
				},
			},
		},
	},
};

interface GeminiResponse {
	candidates?: {
		content?: { parts?: { text?: string }[] };
		finishReason?: string;
	}[];
	promptFeedback?: { blockReason?: string };
	error?: { message?: string };
}

export function geminiProvider(apiKey: string, model: string): OcrProvider {
	if (!apiKey) throw new Error('缺少 GEMINI_API_KEY（wrangler secret / .dev.vars）');

	return {
		async recognize(image, { isFirstPage, signal }) {
			const res = await fetch(
				`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
					signal,
					body: JSON.stringify({
						systemInstruction: { parts: [{ text: OCR_SYSTEM_PROMPT }] },
						contents: [
							{
								role: 'user',
								parts: [
									{ inlineData: { mimeType: 'image/jpeg', data: toBase64(image) } },
									{
										text: isFirstPage
											? '识别这一页。这是第一页，如页面上有书名/标题，填入 title；正文放 lines。'
											: '识别这一页正文，title 置为 null。',
									},
								],
							},
						],
						generationConfig: {
							responseMimeType: 'application/json',
							responseSchema: GEMINI_SCHEMA,
							temperature: 0,
							maxOutputTokens: 16384,
						},
					}),
				},
			);

			const data = (await res.json()) as GeminiResponse;
			if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data.error?.message ?? '未知错误'}`);
			if (data.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝请求: ${data.promptFeedback.blockReason}`);

			const candidate = data.candidates?.[0];
			if (!candidate) throw new Error('Gemini 未返回候选结果');
			if (candidate.finishReason === 'MAX_TOKENS') throw new Error('页面内容过长，请拆成两张图重拍');

			const text = (candidate.content?.parts ?? [])
				.map((p) => p.text ?? '')
				.join('')
				.trim();
			if (!text) throw new Error(`Gemini 返回为空（finishReason=${candidate.finishReason ?? '未知'}）`);
			return validatePageContent(JSON.parse(text));
		},
	};
}
