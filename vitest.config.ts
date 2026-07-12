// 单测只覆盖 server/lib 下的纯函数，独立于 vite.config.ts —— 避免拉起 @cloudflare/vite-plugin（需要远程凭据）。
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
});
