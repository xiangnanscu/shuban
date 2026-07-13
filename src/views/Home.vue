<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import type { ArticleSummary, DueItem } from '@/types';

const articles = ref<ArticleSummary[]>([]);
const poolCount = ref(0);
const dueCount = ref(0);
const loading = ref(true);

onMounted(async () => {
	try {
		const [list, pool, due] = await Promise.all([
			api<ArticleSummary[]>('/api/articles'),
			api<string[]>('/api/pool'),
			api<DueItem[]>('/api/review/due'),
		]);
		articles.value = list.filter((a) => a.status === 'published');
		poolCount.value = pool.length;
		dueCount.value = due.length;
	} finally {
		loading.value = false;
	}
});
</script>

<template>
	<div class="page">
		<header class="top">
			<h1>书伴</h1>
			<RouterLink v-if="dueCount > 0" to="/quiz" class="badge due">今日复习 {{ dueCount }} 字 ›</RouterLink>
			<span v-else-if="poolCount > 0" class="badge quiet">生字池 {{ poolCount }} 字</span>
		</header>

		<p v-if="loading" class="hint">加载中…</p>

		<div v-else-if="articles.length === 0" class="empty">
			<p>还没有文章。</p>
			<p class="hint">请家长到 <RouterLink to="/admin">家长区</RouterLink> 拍照上传第一篇绘本。</p>
		</div>

		<div v-else class="grid">
			<RouterLink v-for="a in articles" :key="a.id" class="card" :to="`/read/${a.id}`">
				<div class="cover">
					<img v-if="a.coverUrl" :src="a.coverUrl" :alt="a.title" loading="lazy" />
					<div v-else class="cover-fallback">📖</div>
				</div>
				<div class="card-title">{{ a.title || '未命名' }}</div>
				<div class="card-meta">{{ a.pageCount }} 页</div>
			</RouterLink>
		</div>

		<footer class="foot">
			<RouterLink to="/quiz" class="small">复习测验</RouterLink>
			·
			<RouterLink to="/plan" class="small">重读计划</RouterLink>
			·
			<RouterLink to="/stats" class="small">学习报告</RouterLink>
			·
			<RouterLink to="/recordings" class="small">录音历史</RouterLink>
			·
			<RouterLink to="/admin" class="small">家长区</RouterLink>
		</footer>
	</div>
</template>

<style scoped>
.page {
	max-width: 900px;
	margin: 0 auto;
	padding: 20px 16px 60px;
}
.top {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 16px;
}
h1 {
	font-size: 32px;
	margin: 0;
	color: var(--accent);
}
.badge {
	background: var(--accent);
	color: #fff;
	border-radius: 999px;
	padding: 4px 12px;
	font-size: 14px;
}
.badge.due {
	text-decoration: none;
	font-weight: 600;
}
.badge.quiet {
	background: #e8ddc6;
	color: #8a6d3b;
}
.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 16px;
}
.card {
	background: #fff;
	border-radius: 16px;
	overflow: hidden;
	text-decoration: none;
	color: var(--ink);
	box-shadow: 0 2px 8px rgba(90, 70, 40, 0.12);
}
.cover {
	aspect-ratio: 3 / 4;
	background: #f3ead9;
}
.cover img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}
.cover-fallback {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	font-size: 48px;
}
.card-title {
	font-size: 18px;
	font-weight: 600;
	padding: 8px 10px 2px;
}
.card-meta {
	font-size: 13px;
	color: #9a8a70;
	padding: 0 10px 10px;
}
.empty {
	text-align: center;
	padding: 60px 0;
	font-size: 18px;
}
.hint {
	color: #9a8a70;
}
.foot {
	margin-top: 48px;
	text-align: center;
}
.small {
	font-size: 13px;
	color: #b0a186;
}
</style>
