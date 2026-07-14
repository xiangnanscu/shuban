/** OCR 队列消息：一条 = 待识别的一页 */
export interface OcrMessage {
	pageId: number;
}

// Env（DB/BUCKET/AI/vars）由 wrangler types 生成到 worker-configuration.d.ts；
// secrets 与 queue 绑定不在生成范围内，这里补充声明。
export type Bindings = Omit<
	Env,
	'OCR_PROVIDER' | 'OCR_TIMEOUT_MS' | 'GEMINI_MODEL' | 'WORKERSAI_MODEL' | 'CLAUDE_MODEL'
> & {
	/** 逗号分隔的 provider 优先级链，如 "gemini,workersai,claude"；家长区可在 settings 表覆盖，见 lib/settings.ts */
	OCR_PROVIDER: string;
	/** 单个 OCR provider 尝试的超时（毫秒），字符串形式，见 wrangler.jsonc vars，同样可被家长区覆盖 */
	OCR_TIMEOUT_MS: string;
	GEMINI_MODEL: string;
	WORKERSAI_MODEL: string;
	CLAUDE_MODEL: string;
	GEMINI_API_KEY: string;
	ANTHROPIC_API_KEY: string;
	SESSION_SECRET: string;
	/** OCR 任务队列：建文章/重识别时投递每页，由 Worker 的 queue 消费者后台识别，不依赖请求或浏览器 */
	OCR_QUEUE: Queue<OcrMessage>;
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
