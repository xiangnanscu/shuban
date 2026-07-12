// Env（DB/BUCKET/AI/vars）由 wrangler types 生成到 worker-configuration.d.ts；
// secrets 不在生成范围内，这里补充声明。
export type Bindings = Omit<Env, 'OCR_PROVIDER' | 'OCR_TIMEOUT_MS'> & {
	/** 逗号分隔的 provider 优先级链，如 "gemini,workersai,claude" */
	OCR_PROVIDER: string;
	/** 单个 OCR provider 尝试的超时（毫秒），字符串形式，见 wrangler.jsonc vars */
	OCR_TIMEOUT_MS: string;
	GEMINI_API_KEY: string;
	ANTHROPIC_API_KEY: string;
	SESSION_SECRET: string;
};

export type AppEnv = { Bindings: Bindings };

export interface ApiError {
	code: string;
	message: string;
}

export function ok<T>(data: T) {
	return { ok: true as const, data };
}

export function err(code: string, message: string) {
	return { ok: false as const, error: { code, message } };
}
