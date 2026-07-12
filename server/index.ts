import { Hono } from 'hono';
import type { AppEnv } from './env';
import { err } from './env';
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

export default app;
