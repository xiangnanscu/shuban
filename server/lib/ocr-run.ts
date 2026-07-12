import type { Bindings } from '../env';
import { getOcrProviders } from '../ocr';
import type { OcrProvider, PageContent } from '../ocr';

interface PageRow {
	id: number;
	article_id: number;
	page_no: number;
	image_key: string;
}

/** 单个 provider 尝试的硬上限：即使底层请求（网络挂起等）永不返回，也保证在此时限内失败并进入下一个 provider */
const PROVIDER_TIMEOUT_MS = 30_000;

async function recognizeWithTimeout(
	provider: OcrProvider,
	image: ArrayBuffer,
	isFirstPage: boolean,
): Promise<PageContent> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
	try {
		return await Promise.race([
			provider.recognize(image, { isFirstPage, signal: controller.signal }),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () =>
					reject(new Error(`超时（${PROVIDER_TIMEOUT_MS / 1000}s 未响应）`)),
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** 对单页执行 OCR（在 waitUntil 中调用）：按 provider 优先级链依次尝试，结果/失败写回 pages 表 */
export async function runOcrForPage(env: Bindings, pageId: number): Promise<void> {
	const page = await env.DB.prepare('SELECT id, article_id, page_no, image_key FROM pages WHERE id = ?1')
		.bind(pageId)
		.first<PageRow>();
	if (!page) return;

	try {
		const obj = await env.BUCKET.get(page.image_key);
		if (!obj) throw new Error(`R2 缺图 ${page.image_key}`);
		const image = await obj.arrayBuffer();

		const providers = getOcrProviders(env);
		if (providers.length === 0) throw new Error('没有任何可用的 OCR provider（检查 OCR_PROVIDER 与各家 key）');

		let content = null;
		const errors: string[] = [];
		for (const { name, provider } of providers) {
			try {
				content = await recognizeWithTimeout(provider, image, page.page_no === 1);
				console.log(`OCR page ${pageId} done via "${name}"`);
				break;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				errors.push(`${name}: ${msg}`);
				console.warn(`OCR page ${pageId} provider "${name}" failed: ${msg}`);
			}
		}
		if (!content) throw new Error(errors.join(' | '));

		await env.DB.prepare("UPDATE pages SET content_json = ?1, ocr_status = 'done' WHERE id = ?2")
			.bind(JSON.stringify({ lines: content.lines }), page.id)
			.run();

		if (page.page_no === 1 && content.title) {
			await env.DB.prepare("UPDATE articles SET title = ?1 WHERE id = ?2 AND title = ''")
				.bind(content.title, page.article_id)
				.run();
		}
	} catch (e) {
		console.error(`OCR failed for page ${pageId}:`, e instanceof Error ? e.message : e);
		await env.DB.prepare("UPDATE pages SET ocr_status = 'failed' WHERE id = ?1").bind(pageId).run();
	}
}
