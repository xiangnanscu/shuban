// Env（DB/BUCKET/AI/vars）由 wrangler types 生成到 worker-configuration.d.ts；
// secrets 不在生成范围内，这里补充声明。
export type Bindings = Omit<Env, 'OCR_PROVIDER'> & {
	/** 逗号分隔的 provider 优先级链，如 "gemini,workersai,claude" */
	OCR_PROVIDER: string;
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
