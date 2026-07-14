import Anthropic from '@anthropic-ai/sdk';
import type { Bindings } from '../env';
import { toBase64 } from '../lib/bytes';
import { getProviderTimeoutMs } from '../lib/ocr-run';

/** 一篇文章的分组结果：title 为可读到的篇名，pages 为上传图片的 0 基下标（阅读顺序） */
export interface ArticleGroup {
	title: string | null;
	pages: number[];
}

interface RawGroup {
	title?: string | null;
	pages?: unknown;
}

const SEGMENT_SYSTEM_PROMPT = `你是中文绘本 / 语文课文图片整理助手。用户一次性上传了多张照片，这些照片可能来自同一篇文章，也可能来自多篇不同的文章，且顺序可能被打乱。

你的唯一任务是「分组和排序」，不要转写或输出正文文字内容。

判断依据（综合使用）：
- 页码：页眉或页脚的数字，是同一篇内部排序的最强线索。
- 标题 / 篇名：某张图出现明显的新标题，通常意味着一篇新文章的开始。
- 语义衔接：上一页结尾的句子与下一页开头是否自然连续；连续则同属一篇。
- 版式与插图风格：同一篇通常字体、版式、插画风格一致。

我会按上传顺序提供图片，第 1 张记为 index 0，第 2 张记为 index 1，依此类推（每张图前我会用文字标出它的 index）。

输出 JSON，字段为 articles 数组，每个元素：
- title：该文章的书名 / 篇名（如果某张图能看到），看不到就填 null。不要包含拼音。
- pages：属于该文章的图片 index 数组，必须按正确的阅读顺序排列。

硬性要求：
- 每个 index 必须且只能出现一次；所有上传的图片都要被分配，不允许丢弃。
- 如果所有图片明显同属一篇，就只返回一篇。
- 无法确定某张图归属时，就近并入语义或页码最接近的一篇，绝不丢弃。`;

const SEGMENT_INSTRUCTION = '以上是全部图片。请按规则把它们划分成一篇或多篇文章并排好页序，只输出 articles 分组结果。';

// Gemini responseSchema：OpenAPI 子集
const GEMINI_SEGMENT_SCHEMA = {
	type: 'OBJECT',
	required: ['articles'],
	properties: {
		articles: {
			type: 'ARRAY',
			items: {
				type: 'OBJECT',
				required: ['title', 'pages'],
				properties: {
					title: { type: 'STRING', nullable: true },
					pages: { type: 'ARRAY', items: { type: 'INTEGER' } },
				},
			},
		},
	},
};

// Claude / 标准 JSON Schema
const CLAUDE_SEGMENT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['articles'],
	properties: {
		articles: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['title', 'pages'],
				properties: {
					title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
					pages: { type: 'array', items: { type: 'integer' } },
				},
			},
		},
	},
} as const;

interface Segmenter {
	name: string;
	segment(images: ArrayBuffer[], signal: AbortSignal): Promise<RawGroup[]>;
}

interface GeminiResponse {
	candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
	promptFeedback?: { blockReason?: string };
	error?: { message?: string };
}

function geminiSegmenter(apiKey: string, model: string): Segmenter {
	return {
		name: 'gemini',
		async segment(images, signal) {
			const parts: unknown[] = [];
			images.forEach((img, i) => {
				parts.push({ text: `图片 index ${i}：` });
				parts.push({ inlineData: { mimeType: 'image/jpeg', data: toBase64(img) } });
			});
			parts.push({ text: SEGMENT_INSTRUCTION });

			const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
				signal,
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: SEGMENT_SYSTEM_PROMPT }] },
					contents: [{ role: 'user', parts }],
					generationConfig: {
						responseMimeType: 'application/json',
						responseSchema: GEMINI_SEGMENT_SCHEMA,
						temperature: 0,
						maxOutputTokens: 4096,
					},
				}),
			});
			const data = (await res.json()) as GeminiResponse;
			if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data.error?.message ?? '未知错误'}`);
			if (data.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝请求: ${data.promptFeedback.blockReason}`);
			const candidate = data.candidates?.[0];
			if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('分篇结果过长');
			const text = (candidate?.content?.parts ?? [])
				.map((p) => p.text ?? '')
				.join('')
				.trim();
			if (!text) throw new Error('Gemini 返回为空');
			return parseArticles(text);
		},
	};
}

function claudeSegmenter(apiKey: string, model: string): Segmenter {
	const client = new Anthropic({ apiKey });
	return {
		name: 'claude',
		async segment(images, signal) {
			const content: Anthropic.ContentBlockParam[] = [];
			images.forEach((img, i) => {
				content.push({ type: 'text', text: `图片 index ${i}：` });
				content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: toBase64(img) } });
			});
			content.push({ type: 'text', text: SEGMENT_INSTRUCTION });

			const response = await client.messages.create(
				{
					model,
					max_tokens: 4096,
					system: SEGMENT_SYSTEM_PROMPT,
					output_config: {
						format: { type: 'json_schema', schema: CLAUDE_SEGMENT_SCHEMA as unknown as Record<string, unknown> },
					},
					messages: [{ role: 'user', content }],
				},
				{ signal },
			);
			if (response.stop_reason === 'max_tokens') throw new Error('分篇结果过长');
			const textBlock = response.content.find((b) => b.type === 'text');
			if (!textBlock || textBlock.type !== 'text') throw new Error('模型未返回文本');
			return parseArticles(textBlock.text);
		},
	};
}

function parseArticles(text: string): RawGroup[] {
	const obj = JSON.parse(text) as { articles?: unknown };
	if (!Array.isArray(obj.articles)) throw new Error('分篇输出缺少 articles 数组');
	return obj.articles as RawGroup[];
}

/** 只有 gemini / claude 适合做多图整篇推理；workersai（Kimi）多图推理不稳，跳过 */
function getSegmenters(env: Bindings): Segmenter[] {
	const names = env.OCR_PROVIDER.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const out: Segmenter[] = [];
	for (const name of names) {
		if (name === 'gemini' && env.GEMINI_API_KEY) out.push(geminiSegmenter(env.GEMINI_API_KEY, env.GEMINI_MODEL));
		else if (name === 'claude' && env.ANTHROPIC_API_KEY) out.push(claudeSegmenter(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL));
	}
	return out;
}

/** 保证每个下标恰好出现一次、无越界；模型漏分的图就近并入最后一篇，绝不丢弃 */
function normalizeGroups(raw: RawGroup[], n: number): ArticleGroup[] {
	const seen = new Set<number>();
	const groups: ArticleGroup[] = [];
	for (const g of raw) {
		const pages: number[] = [];
		if (Array.isArray(g.pages)) {
			for (const v of g.pages) {
				const i = Math.trunc(Number(v));
				if (Number.isInteger(i) && i >= 0 && i < n && !seen.has(i)) {
					seen.add(i);
					pages.push(i);
				}
			}
		}
		if (pages.length) {
			const title = typeof g.title === 'string' && g.title.trim() ? g.title.trim() : null;
			groups.push({ title, pages });
		}
	}
	const missing: number[] = [];
	for (let i = 0; i < n; i++) if (!seen.has(i)) missing.push(i);
	if (missing.length) {
		if (groups.length) groups[groups.length - 1].pages.push(...missing);
		else groups.push({ title: null, pages: missing });
	}
	return groups.length ? groups : [{ title: null, pages: Array.from({ length: n }, (_, i) => i) }];
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await Promise.race([
			run(controller.signal),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () => reject(new Error(`分篇超时（${timeoutMs / 1000}s 未响应）`)));
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 让 AI 从多张图片中推断出一篇或多篇文章的分组与页序。
 * 单图直接单篇；分篇失败（无可用引擎 / 全部报错）时退化为「所有图按上传顺序合成一篇」，绝不阻断建文章。
 */
export async function segmentImages(env: Bindings, images: ArrayBuffer[]): Promise<ArticleGroup[]> {
	if (images.length <= 1) return [{ title: null, pages: images.map((_, i) => i) }];

	const segmenters = getSegmenters(env);
	// 多图一次推理比单页 OCR 重，给 2 倍超时
	const timeoutMs = getProviderTimeoutMs(env) * 2;
	for (const s of segmenters) {
		try {
			const raw = await withTimeout((signal) => s.segment(images, signal), timeoutMs);
			const groups = normalizeGroups(raw, images.length);
			console.log(`分篇完成 via "${s.name}"：${images.length} 图 → ${groups.length} 篇`);
			return groups;
		} catch (e) {
			console.warn(`分篇 provider "${s.name}" 失败：${e instanceof Error ? e.message : e}`);
		}
	}
	console.warn('分篇失败，退化为单篇');
	return [{ title: null, pages: images.map((_, i) => i) }];
}
