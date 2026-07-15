import Anthropic from '@anthropic-ai/sdk';
import type { Bindings } from '../env';
import { toBase64 } from '../lib/bytes';
import { getProviderTimeoutMs } from '../lib/ocr-run';
import { applyAiSettings, getAiSettings } from '../lib/settings';
import { OCR_SYSTEM_PROMPT, PAGE_SCHEMA } from './prompt';
import type { PageContent } from './types';
import { validatePageContent } from './validate';

/** 组合模式下一页的结果：index 为上传图片 0 基下标；content 为该页识别结果，null = 模型未给出，需退回单页 OCR */
export interface CombinedPage {
	index: number;
	content: PageContent | null;
}
export interface CombinedGroup {
	title: string | null;
	pages: CombinedPage[];
}

interface RawPage {
	index?: unknown;
	lines?: unknown;
}
interface RawGroup {
	title?: unknown;
	pages?: unknown;
}

// 组合任务说明：分篇规则在前，逐页 lines 的识别规范直接复用单页 OCR 系统提示词（零漂移），
// 只额外声明「页级不输出 title，书名统一填到文章 title」，与下面 schema（页级无 title 字段）一致。
const COMBINED_SYSTEM_PROMPT = `你是中文绘本 / 语文课文图片整理与识别助手。用户一次性上传了多张照片，可能来自同一篇文章，也可能来自多篇不同文章，且顺序可能被打乱。

请一次性完成两件事：
一、分组与排序：把图片按文章分组，并在每篇内部按正确阅读顺序排列。判断依据：页码（页眉/页脚数字）、新标题的出现、上下页语义是否连续、字体版式插图风格是否一致。
二、逐页识别：对每一张图片，识别其正文文字与逐字拼音。

我按上传顺序提供图片，第 1 张记为 index 0，第 2 张记为 index 1，依此类推（每张图前我会用文字标出它的 index）。

输出 JSON，字段为 articles 数组，每个元素：
- title：该文章的书名 / 篇名（某张图能看到就填，不含拼音），看不到就填 null。
- pages：属于该文章的页数组，必须按正确阅读顺序排列；每个元素：
  - index：该页对应的上传图片 index。
  - lines：该页正文的结构化识别结果（规则见下）。

分组硬性要求：每个 index 必须且只能出现一次；所有上传的图片都要被分配，绝不丢弃；无法确定归属时就近并入页码 / 语义最接近的一篇。

每页 lines 的识别规范如下：

${OCR_SYSTEM_PROMPT}

特别说明：本组合任务中每张图片只需输出 lines（正文行数组），页级不要输出 title 字段；书名 / 篇名统一填在所属文章的 title 上。`;

const COMBINED_INSTRUCTION =
	'以上是全部图片。请把它们划分成一篇或多篇文章、排好页序，并逐页识别正文与拼音，只输出 articles 结果。';

// Claude / 标准 JSON Schema：复用单页 PAGE_SCHEMA 的 lines 定义，避免与单页 OCR 漂移
const CLAUDE_SCHEMA = {
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
					pages: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							required: ['index', 'lines'],
							properties: {
								index: { type: 'integer' },
								lines: PAGE_SCHEMA.properties.lines,
							},
						},
					},
				},
			},
		},
	},
} as const;

// Gemini responseSchema：OpenAPI 子集（Type 枚举 + nullable）
const GEMINI_SCHEMA = {
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
					pages: {
						type: 'ARRAY',
						items: {
							type: 'OBJECT',
							required: ['index', 'lines'],
							properties: {
								index: { type: 'INTEGER' },
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
						},
					},
				},
			},
		},
	},
};

interface Runner {
	name: string;
	run(images: ArrayBuffer[], signal: AbortSignal): Promise<RawGroup[]>;
}

interface GeminiResponse {
	candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
	promptFeedback?: { blockReason?: string };
	error?: { message?: string };
}

function geminiRunner(apiKey: string, model: string): Runner {
	return {
		name: 'gemini',
		async run(images, signal) {
			const parts: unknown[] = [];
			images.forEach((img, i) => {
				parts.push({ text: `图片 index ${i}：` });
				parts.push({ inlineData: { mimeType: 'image/jpeg', data: toBase64(img) } });
			});
			parts.push({ text: COMBINED_INSTRUCTION });

			const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
				signal,
				body: JSON.stringify({
					systemInstruction: { parts: [{ text: COMBINED_SYSTEM_PROMPT }] },
					contents: [{ role: 'user', parts }],
					generationConfig: {
						responseMimeType: 'application/json',
						responseSchema: GEMINI_SCHEMA,
						temperature: 0,
						maxOutputTokens: 32768,
					},
				}),
			});
			const data = (await res.json()) as GeminiResponse;
			if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${data.error?.message ?? '未知错误'}`);
			if (data.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝请求: ${data.promptFeedback.blockReason}`);
			const candidate = data.candidates?.[0];
			if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('组合识别结果过长');
			const text = (candidate?.content?.parts ?? [])
				.map((p) => p.text ?? '')
				.join('')
				.trim();
			if (!text) throw new Error('Gemini 返回为空');
			return parseArticles(text);
		},
	};
}

function claudeRunner(apiKey: string, model: string): Runner {
	const client = new Anthropic({ apiKey });
	return {
		name: 'claude',
		async run(images, signal) {
			const content: Anthropic.ContentBlockParam[] = [];
			images.forEach((img, i) => {
				content.push({ type: 'text', text: `图片 index ${i}：` });
				content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: toBase64(img) } });
			});
			content.push({ type: 'text', text: COMBINED_INSTRUCTION });

			const response = await client.messages.create(
				{
					model,
					max_tokens: 32000,
					system: COMBINED_SYSTEM_PROMPT,
					output_config: {
						format: { type: 'json_schema', schema: CLAUDE_SCHEMA as unknown as Record<string, unknown> },
					},
					messages: [{ role: 'user', content }],
				},
				{ signal },
			);
			if (response.stop_reason === 'max_tokens') throw new Error('组合识别结果过长');
			const textBlock = response.content.find((b) => b.type === 'text');
			if (!textBlock || textBlock.type !== 'text') throw new Error('模型未返回文本');
			return parseArticles(textBlock.text);
		},
	};
}

function parseArticles(text: string): RawGroup[] {
	const obj = JSON.parse(text) as { articles?: unknown };
	if (!Array.isArray(obj.articles)) throw new Error('组合识别输出缺少 articles 数组');
	return obj.articles as RawGroup[];
}

/** 只有 gemini / claude 适合多图整篇推理；workersai / mimo 多图推理不稳，组合模式跳过 */
function getRunners(env: Bindings): Runner[] {
	const names = env.OCR_PROVIDER.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const out: Runner[] = [];
	for (const name of names) {
		if (name === 'gemini' && env.GEMINI_API_KEY) out.push(geminiRunner(env.GEMINI_API_KEY, env.GEMINI_MODEL));
		else if (name === 'claude' && env.ANTHROPIC_API_KEY) out.push(claudeRunner(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL));
	}
	return out;
}

/**
 * 归一化：保证每个下标恰好出现一次、无越界；lines 非法或缺失的页 content 置 null（交由调用方退回单页 OCR），
 * 模型漏分的图就近并入最后一篇，绝不丢弃。
 */
function normalizeGroups(raw: RawGroup[], n: number): CombinedGroup[] {
	const seen = new Set<number>();
	const groups: CombinedGroup[] = [];
	for (const g of raw) {
		const pages: CombinedPage[] = [];
		if (Array.isArray(g.pages)) {
			for (const rp of g.pages as RawPage[]) {
				const i = Math.trunc(Number(rp?.index));
				if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) continue;
				let content: PageContent | null = null;
				try {
					content = validatePageContent({ title: null, lines: rp?.lines });
				} catch {
					content = null; // 识别不合法：留给单页 OCR 兜底
				}
				seen.add(i);
				pages.push({ index: i, content });
			}
		}
		if (pages.length) {
			const title = typeof g.title === 'string' && g.title.trim() ? g.title.trim() : null;
			groups.push({ title, pages });
		}
	}
	const missing: CombinedPage[] = [];
	for (let i = 0; i < n; i++) if (!seen.has(i)) missing.push({ index: i, content: null });
	if (missing.length) {
		if (groups.length) groups[groups.length - 1].pages.push(...missing);
		else groups.push({ title: null, pages: missing });
	}
	return groups.length ? groups : [{ title: null, pages: Array.from({ length: n }, (_, i) => ({ index: i, content: null })) }];
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await Promise.race([
			run(controller.signal),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () => reject(new Error(`组合识别超时（${timeoutMs / 1000}s 未响应）`)));
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 组合模式：一次 prompt 同时完成分篇 + 逐页识别。成功返回分组（含每页识别结果）；
 * 无可用引擎或全部失败时返回 null，调用方应退回「分篇 + 队列逐页 OCR」两段式流程。
 */
export async function segmentAndRecognizeImages(env: Bindings, images: ArrayBuffer[]): Promise<CombinedGroup[] | null> {
	if (images.length === 0) return [];
	const effectiveEnv = applyAiSettings(env, await getAiSettings(env.DB));
	const runners = getRunners(effectiveEnv);
	if (runners.length === 0) return null;
	// 一次推理既分篇又逐页转写，比单页 OCR 重得多，给 3 倍超时
	const timeoutMs = getProviderTimeoutMs(effectiveEnv) * 3;
	for (const r of runners) {
		try {
			const raw = await withTimeout((signal) => r.run(images, signal), timeoutMs);
			const groups = normalizeGroups(raw, images.length);
			const recognized = groups.reduce((s, g) => s + g.pages.filter((p) => p.content).length, 0);
			console.log(`组合分篇+识别 via "${r.name}"：${images.length} 图 → ${groups.length} 篇，${recognized}/${images.length} 页直接识别`);
			return groups;
		} catch (e) {
			console.warn(`组合分篇+识别 provider "${r.name}" 失败：${e instanceof Error ? e.message : e}`);
		}
	}
	return null;
}
