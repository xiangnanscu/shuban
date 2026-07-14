import type { Bindings } from '../env';

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
	const row = await db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first<{ value: string }>();
	return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
	await db
		.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.bind(key, value)
		.run();
}

export async function deleteSetting(db: D1Database, key: string): Promise<void> {
	await db.prepare('DELETE FROM settings WHERE key = ?1').bind(key).run();
}

/** 家长区可配置的识别引擎，wrangler vars OCR_PROVIDER 中出现的顺序即默认降级顺序 */
export const AI_PROVIDERS = ['gemini', 'workersai', 'claude'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export interface AiSettings {
	/** 优先引擎；null = 用 wrangler vars 里 OCR_PROVIDER 的默认顺序 */
	primaryProvider: AiProviderName | null;
	geminiModel: string | null;
	workersaiModel: string | null;
	claudeModel: string | null;
	timeoutMs: number | null;
}

const AI_KEY = {
	primaryProvider: 'ai_primary_provider',
	geminiModel: 'ai_gemini_model',
	workersaiModel: 'ai_workersai_model',
	claudeModel: 'ai_claude_model',
	timeoutMs: 'ai_timeout_ms',
} as const satisfies Record<keyof AiSettings, string>;

export async function getAiSettings(db: D1Database): Promise<AiSettings> {
	const [primaryProvider, geminiModel, workersaiModel, claudeModel, timeoutMs] = await Promise.all([
		getSetting(db, AI_KEY.primaryProvider),
		getSetting(db, AI_KEY.geminiModel),
		getSetting(db, AI_KEY.workersaiModel),
		getSetting(db, AI_KEY.claudeModel),
		getSetting(db, AI_KEY.timeoutMs),
	]);
	return {
		primaryProvider: (AI_PROVIDERS as readonly string[]).includes(primaryProvider ?? '')
			? (primaryProvider as AiProviderName)
			: null,
		geminiModel,
		workersaiModel,
		claudeModel,
		timeoutMs: timeoutMs && Number(timeoutMs) > 0 ? Number(timeoutMs) : null,
	};
}

/** value 为 null 或空串 = 清除该项覆盖，恢复用 wrangler vars 默认值 */
export async function setAiSettings(db: D1Database, patch: Partial<Record<keyof AiSettings, string | null>>): Promise<void> {
	for (const field of Object.keys(patch) as (keyof AiSettings)[]) {
		const value = patch[field];
		const key = AI_KEY[field];
		if (value == null || value === '') await deleteSetting(db, key);
		else await setSetting(db, key, value);
	}
}

/** 用 DB 里家长设置的覆盖值替换 env 对应字段；未设置的项沿用 wrangler vars 默认值 */
export function applyAiSettings(env: Bindings, s: AiSettings): Bindings {
	const defaultOrder = env.OCR_PROVIDER.split(',')
		.map((x) => x.trim())
		.filter(Boolean);
	const order = s.primaryProvider ? [s.primaryProvider, ...defaultOrder.filter((p) => p !== s.primaryProvider)] : defaultOrder;
	return {
		...env,
		OCR_PROVIDER: order.join(','),
		GEMINI_MODEL: s.geminiModel || env.GEMINI_MODEL,
		WORKERSAI_MODEL: s.workersaiModel || env.WORKERSAI_MODEL,
		CLAUDE_MODEL: s.claudeModel || env.CLAUDE_MODEL,
		OCR_TIMEOUT_MS: s.timeoutMs ? String(s.timeoutMs) : env.OCR_TIMEOUT_MS,
	};
}
