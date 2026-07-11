import type { Bindings } from '../env';
import { claudeProvider } from './claude';
import { geminiProvider } from './gemini';
import type { OcrProvider } from './types';
import { workersAiProvider } from './workersai';

export interface NamedProvider {
	name: string;
	provider: OcrProvider;
}

/**
 * OCR_PROVIDER 为逗号分隔的优先级链（如 "gemini,workersai,claude"）。
 * 缺 key 的 provider 在构造期抛错 → 跳过并告警；识别时按序尝试，前一个失败自动降级到下一个。
 */
export function getOcrProviders(env: Bindings): NamedProvider[] {
	const names = env.OCR_PROVIDER.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const out: NamedProvider[] = [];
	for (const name of names) {
		try {
			out.push({ name, provider: makeProvider(name, env) });
		} catch (e) {
			console.warn(`OCR provider "${name}" 不可用：${e instanceof Error ? e.message : e}`);
		}
	}
	return out;
}

function makeProvider(name: string, env: Bindings): OcrProvider {
	switch (name) {
		case 'gemini':
			return geminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
		case 'workersai':
			return workersAiProvider(env.AI, env.WORKERSAI_MODEL);
		case 'claude':
			return claudeProvider(env.ANTHROPIC_API_KEY, env.CLAUDE_MODEL);
		default:
			throw new Error(`未知 OCR provider: ${name}`);
	}
}

export type { OcrProvider, PageContent, PageLine, PageToken } from './types';
export { validatePageContent } from './validate';
