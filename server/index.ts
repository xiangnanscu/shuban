import { Hono } from 'hono';
import type { AppEnv, Bindings, OcrMessage } from './env';
import { err } from './env';
import { runOcrForPage } from './lib/ocr-run';
import { adminRoutes } from './routes/admin';
import { articleRoutes } from './routes/articles';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { quizRoutes } from './routes/quiz';
import { recordingRoutes } from './routes/recordings';
import { reviewRoutes } from './routes/review';
import { statsRoutes } from './routes/stats';
import { tapRoutes } from './routes/taps';
import { ttsRoutes } from './routes/tts';

const app = new Hono<AppEnv>();

app.route('/api/auth', authRoutes);
app.route('/api/articles', articleRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', tapRoutes);
app.route('/api', reviewRoutes);
app.route('/api', quizRoutes);
app.route('/api', recordingRoutes);
app.route('/api', statsRoutes);
app.route('/api', fileRoutes);
app.route('/api', ttsRoutes);

app.notFound((c) => c.json(err('not_found', '接口不存在'), 404));
app.onError((e, c) => {
	console.error('Unhandled error:', e);
	return c.json(err('internal', '服务器内部错误'), 500);
});

export default {
	fetch: app.fetch,

	// OCR 队列消费者：后台逐页识别，完全独立于 HTTP 请求与浏览器。
	// runOcrForPage 内部已捕获错误并把该页标 failed（正常返回）→ ack；
	// 仅在意外抛错（如 DB 故障）时 retry，交给队列重投。
	async queue(batch: MessageBatch<OcrMessage>, env: Bindings): Promise<void> {
		for (const msg of batch.messages) {
			try {
				await runOcrForPage(env, msg.body.pageId);
				msg.ack();
			} catch (e) {
				console.error(`OCR queue page ${msg.body?.pageId} 异常:`, e instanceof Error ? e.message : e);
				msg.retry();
			}
		}
	},
};
