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
			<div class="brand">
				<span class="tzg-mark" aria-hidden="true"></span>
				<h1>书伴</h1>
			</div>
			<RouterLink v-if="dueCount > 0" to="/quiz" class="badge due">🔥 今日复习 {{ dueCount }} 字 ›</RouterLink>
			<span v-else-if="poolCount > 0" class="badge quiet">生字池 {{ poolCount }} 字</span>
		</header>

		<p v-if="loading" class="hint">加载中…</p>

		<div v-else-if="articles.length === 0" class="empty">
			<p class="empty-emoji">📖</p>
			<p>还没有文章。</p>
			<p class="hint">请家长到 <RouterLink to="/admin">家长区</RouterLink> 拍照上传第一篇绘本。</p>
		</div>

		<div v-else class="shelf">
			<RouterLink v-for="a in articles" :key="a.id" class="book" :to="`/read/${a.id}`">
				<span class="spine" aria-hidden="true"></span>
				<div class="book-body">
					<div class="book-title">{{ a.title || '未命名' }}</div>
					<div class="book-meta">{{ a.pageCount }} 页 · 去读 ›</div>
				</div>
			</RouterLink>
		</div>

		<footer class="foot">
			<RouterLink to="/quiz" class="footlink">复习测验</RouterLink>
			<RouterLink to="/plan" class="footlink">重读计划</RouterLink>
			<RouterLink to="/stats" class="footlink">学习报告</RouterLink>
			<RouterLink to="/recordings" class="footlink">录音历史</RouterLink>
			<RouterLink to="/admin" class="footlink quiet">家长区</RouterLink>
		</footer>
	</div>
</template>

<style scoped>
.page {
	max-width: 900px;
	margin: 0 auto;
	padding: 24px 16px 60px;
}
.top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 28px;
}
.brand {
	display: flex;
	align-items: center;
	gap: 10px;
	color: var(--accent);
}
h1 {
	font-size: 34px;
	margin: 0;
	color: var(--accent);
	letter-spacing: 0.04em;
}
.badge {
	background: var(--accent);
	color: #fff;
	border-radius: var(--r-pill);
	padding: 7px 16px;
	font-size: 14px;
	font-weight: 700;
	box-shadow: var(--shadow-sm);
}
.badge.due {
	text-decoration: none;
}
.badge.quiet {
	background: var(--paper-deep);
	color: var(--pinyin);
	box-shadow: none;
}
.shelf {
	display: grid;
	grid-template-columns: 1fr;
	gap: 14px;
}
.book {
	position: relative;
	background: var(--card);
	border-radius: var(--r-lg);
	display: flex;
	align-items: stretch;
	gap: 4px;
	overflow: hidden;
	text-decoration: none;
	color: var(--ink);
	box-shadow: var(--shadow-sm);
	transition:
		transform 0.15s ease,
		box-shadow 0.15s ease;
}
.book:hover {
	transform: translateY(-2px);
	box-shadow: var(--shadow-md);
}
.book:active {
	transform: translateY(0);
}
.spine {
	flex: none;
	width: 10px;
	background: linear-gradient(180deg, var(--accent), var(--accent-dark));
}
.book-body {
	flex: 1;
	min-width: 0;
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 12px;
	padding: 18px 18px;
}
.book-title {
	font-size: 19px;
	font-weight: 700;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.book-meta {
	font-size: 13px;
	color: var(--ink-faint);
	white-space: nowrap;
}
.empty {
	text-align: center;
	padding: 60px 0;
	font-size: 18px;
}
.empty-emoji {
	font-size: 48px;
	margin: 0 0 4px;
}
.foot {
	margin-top: 56px;
	display: flex;
	justify-content: center;
	flex-wrap: wrap;
	gap: 4px 18px;
}
.footlink {
	font-size: 13px;
	color: var(--ink-faint);
	text-decoration: none;
}
.footlink:hover {
	color: var(--accent);
}
.footlink.quiet {
	opacity: 0.7;
}

@media (min-width: 720px) {
	.page {
		padding-top: 40px;
	}
	h1 {
		font-size: 40px;
	}
	.shelf {
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (min-width: 1100px) and (orientation: landscape) {
	.page {
		max-width: 1200px;
	}
	.shelf {
		grid-template-columns: repeat(3, 1fr);
	}
}
</style>
