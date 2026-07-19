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
export const AI_PROVIDERS = ['gemini', 'workersai', 'claude', 'mimo'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export interface AiSettings {
	/** 优先引擎；null = 用 wrangler vars 里 OCR_PROVIDER 的默认顺序 */
	primaryProvider: AiProviderName | null;
	geminiModel: string | null;
	workersaiModel: string | null;
	claudeModel: string | null;
	mimoModel: string | null;
	timeoutMs: number | null;
	/** 自动分篇时是否压缩分组用缩略图；关闭则用原图分组，成功率更高但更耗 token/更慢 */
	segCompress: boolean;
	/** 组合模式：一次 prompt 同时完成分篇+逐页识别；简单页面更快、更省调用，默认关闭 */
	segCombined: boolean;
	/** 前端批量上传时，单次提交给后端识别的最大张数；超出则前端自动分组、并发多次提交 */
	batchGroupSize: number;
}

/** 单次批量识别请求最多接受的图片数（服务端硬上限，batchGroupSize 不可超过它） */
export const MAX_BATCH_IMAGES = 20;
export const DEFAULT_BATCH_GROUP_SIZE = 10;

const AI_KEY = {
	primaryProvider: 'ai_primary_provider',
	geminiModel: 'ai_gemini_model',
	workersaiModel: 'ai_workersai_model',
	claudeModel: 'ai_claude_model',
	mimoModel: 'ai_mimo_model',
	timeoutMs: 'ai_timeout_ms',
	segCompress: 'ai_seg_compress',
	segCombined: 'ai_seg_combined',
	batchGroupSize: 'ai_batch_group_size',
} as const satisfies Record<keyof AiSettings, string>;

export async function getAiSettings(db: D1Database): Promise<AiSettings> {
	const [primaryProvider, geminiModel, workersaiModel, claudeModel, mimoModel, timeoutMs, segCompress, segCombined, batchGroupSize] =
		await Promise.all([
			getSetting(db, AI_KEY.primaryProvider),
			getSetting(db, AI_KEY.geminiModel),
			getSetting(db, AI_KEY.workersaiModel),
			getSetting(db, AI_KEY.claudeModel),
			getSetting(db, AI_KEY.mimoModel),
			getSetting(db, AI_KEY.timeoutMs),
			getSetting(db, AI_KEY.segCompress),
			getSetting(db, AI_KEY.segCombined),
			getSetting(db, AI_KEY.batchGroupSize),
		]);
	const groupSizeNum = batchGroupSize ? Number(batchGroupSize) : NaN;
	return {
		primaryProvider: (AI_PROVIDERS as readonly string[]).includes(primaryProvider ?? '')
			? (primaryProvider as AiProviderName)
			: null,
		geminiModel,
		workersaiModel,
		claudeModel,
		mimoModel,
		timeoutMs: timeoutMs && Number(timeoutMs) > 0 ? Number(timeoutMs) : null,
		segCompress: segCompress !== '0',
		segCombined: segCombined === '1',
		batchGroupSize:
			Number.isFinite(groupSizeNum) && groupSizeNum > 0
				? Math.min(Math.round(groupSizeNum), MAX_BATCH_IMAGES)
				: DEFAULT_BATCH_GROUP_SIZE,
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

/** 录音时长超过此阈值（秒）视为孩子中途走开、朗读未完成，上传时直接舍弃 */
export const DEFAULT_MAX_REC_SEC = 180;
const MAX_REC_SEC_KEY = 'rec_max_sec';

export async function getMaxRecSec(db: D1Database): Promise<number> {
	const v = await getSetting(db, MAX_REC_SEC_KEY);
	const n = v ? Number(v) : NaN;
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_REC_SEC;
}

export async function setMaxRecSec(db: D1Database, value: string | null): Promise<void> {
	if (value == null || value === '') await deleteSetting(db, MAX_REC_SEC_KEY);
	else await setSetting(db, MAX_REC_SEC_KEY, value);
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
		MIMO_MODEL: s.mimoModel || env.MIMO_MODEL,
		OCR_TIMEOUT_MS: s.timeoutMs ? String(s.timeoutMs) : env.OCR_TIMEOUT_MS,
	};
}
