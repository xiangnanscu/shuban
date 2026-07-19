<script setup lang="ts">
// 重读计划：把要复习的生字集合 A 拆成“最少数量、能覆盖 A”的文章列表（后端贪心集合覆盖）。
// scope=due 今日到期字；scope=all 生字池全部未毕业字。点文章进阅读页并高亮要重读的字。
import { onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import type { ReadingPlan } from '@/types';

type Scope = 'due' | 'all';

const scope = ref<Scope>((new URLSearchParams(location.search).get('scope') as Scope) === 'all' ? 'all' : 'due');
const data = ref<ReadingPlan | null>(null);
const loading = ref(true);

async function load() {
	loading.value = true;
	try {
		data.value = await api<ReadingPlan>(`/api/review/reading-plan?scope=${scope.value}`);
	} finally {
		loading.value = false;
	}
}

function setScope(s: Scope) {
	if (scope.value === s) return;
	scope.value = s;
	void load();
}

function readLink(articleId: number, covers: string[]): string {
	return `/read/${articleId}?focus=${encodeURIComponent(covers.join(''))}`;
}

onMounted(load);
</script>

<template>
	<div class="page">
		<header class="top">
			<RouterLink to="/" class="back">‹ 首页</RouterLink>
			<h1>重读计划</h1>
		</header>

		<div class="tabs">
			<button type="button" class="tab" :class="{ on: scope === 'due' }" @click="setScope('due')">今日要复习</button>
			<button type="button" class="tab" :class="{ on: scope === 'all' }" @click="setScope('all')">全部生字</button>
		</div>

		<p v-if="loading" class="hint">加载中…</p>

		<template v-else-if="data">
			<p v-if="data.targetCount === 0" class="hint center">
				{{ scope === 'due' ? '今天没有要复习的字，去读书吧。' : '生字池是空的，去读书点几个生字。' }}
			</p>

			<template v-else>
				<p class="summary">
					{{ data.targetCount }} 个字，读这 {{ data.plan.length }} 篇就都覆盖到了：
				</p>

				<ol class="plan">
					<li v-for="(e, i) in data.plan" :key="e.articleId" class="item">
						<RouterLink class="link" :to="readLink(e.articleId, e.covers)">
							<span class="idx">{{ i + 1 }}</span>
							<span class="title">{{ e.title || '未命名' }}</span>
							<span class="count">{{ e.covers.length }} 字</span>
							<span class="covers">{{ e.covers.join(' ') }}</span>
						</RouterLink>
					</li>
				</ol>

				<p v-if="data.uncovered.length > 0" class="uncovered">
					这些字暂无文章可重读（原文可能已删）：<b>{{ data.uncovered.join(' ') }}</b>
				</p>
			</template>
		</template>
	</div>
</template>

<style scoped>
.page {
	max-width: 620px;
	margin: 0 auto;
	padding: 16px 16px 60px;
}
.top {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 16px;
}
.back {
	font-size: 15px;
	text-decoration: none;
	color: var(--ink-soft);
}
h1 {
	font-size: 24px;
	margin: 0;
	color: var(--accent);
}
.tabs {
	display: flex;
	gap: 8px;
	margin-bottom: 18px;
}
.tab {
	flex: 1;
	min-height: 44px;
	border: 2px solid var(--paper-line);
	background: var(--card);
	border-radius: var(--r-md);
	font-size: 16px;
	font-weight: 600;
	color: var(--ink-soft);
	cursor: pointer;
	transition: all 0.15s ease;
}
.tab.on {
	background: var(--accent);
	border-color: var(--accent);
	color: #fff;
}
.summary {
	font-size: 16px;
	margin: 4px 0 16px;
	color: var(--ink-soft);
}
.plan {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.link {
	display: grid;
	grid-template-columns: auto 1fr auto;
	align-items: center;
	gap: 8px 10px;
	background: var(--card);
	border-radius: var(--r-lg);
	padding: 14px 16px;
	text-decoration: none;
	color: var(--ink);
	box-shadow: var(--shadow-sm);
	transition:
		transform 0.12s ease,
		box-shadow 0.12s ease;
}
.link:hover {
	transform: translateY(-1px);
	box-shadow: var(--shadow-md);
}
.idx {
	grid-row: span 2;
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background: var(--accent);
	color: #fff;
	display: flex;
	align-items: center;
	justify-content: center;
	font-weight: 700;
}
.title {
	font-size: 18px;
	font-weight: 600;
}
.count {
	font-size: 13px;
	color: var(--ink-faint);
	white-space: nowrap;
	font-family: var(--font-mono);
}
.covers {
	grid-column: 2 / 4;
	font-size: 24px;
	font-family: var(--font-display);
	letter-spacing: 4px;
	color: var(--accent);
}
.uncovered {
	margin-top: 22px;
	font-size: 14px;
	color: var(--ink-soft);
}
.hint {
	color: var(--ink-soft);
}
.center {
	text-align: center;
	padding-top: 6vh;
}

@media (min-width: 720px) {
	.plan {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
	}
}

@media (min-width: 1100px) and (orientation: landscape) {
	.page {
		max-width: 900px;
	}
}
</style>
