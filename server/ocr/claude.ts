import Anthropic from '@anthropic-ai/sdk';
import { toBase64 } from '../lib/bytes';
import { OCR_SYSTEM_PROMPT, PAGE_SCHEMA } from './prompt';
import type { OcrProvider } from './types';
import { validatePageContent } from './validate';

export function claudeProvider(apiKey: string, model: string): OcrProvider {
	if (!apiKey) throw new Error('缺少 ANTHROPIC_API_KEY（wrangler secret / .dev.vars）');
	const client = new Anthropic({ apiKey });

	return {
		async recognize(image, { isFirstPage, signal }) {
			const response = await client.messages.create(
				{
					model,
					max_tokens: 16000,
					system: OCR_SYSTEM_PROMPT,
					output_config: { format: { type: 'json_schema', schema: PAGE_SCHEMA as unknown as Record<string, unknown> } },
					messages: [
						{
							role: 'user',
							content: [
								{
									type: 'image',
									source: { type: 'base64', media_type: 'image/jpeg', data: toBase64(image) },
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
				},
				{ signal },
			);

			if (response.stop_reason === 'max_tokens') throw new Error('页面内容过长，请拆成两张图重拍');
			const textBlock = response.content.find((b) => b.type === 'text');
			if (!textBlock || textBlock.type !== 'text') throw new Error('模型未返回文本');
			return validatePageContent(JSON.parse(textBlock.text));
		},
	};
}
