<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import type { StatsSummary } from '@/types';

const stats = ref<StatsSummary | null>(null);
const loading = ref(true);

onMounted(async () => {
	try {
		stats.value = await api<StatsSummary>('/api/stats/summary');
	} finally {
		loading.value = false;
	}
});
</script>

<template>
	<div class="wrap">
		<header class="bar">
			<RouterLink to="/" class="btn ghost small">‹ 返回</RouterLink>
			<h1><span class="tzg-mark" aria-hidden="true"></span> 学习报告</h1>
		</header>

		<p v-if="loading" class="hint">加载中…</p>

		<template v-else-if="stats">
			<div class="cards">
				<div class="card fire">
					<div class="num mono">🔥 {{ stats.streak }}</div>
					<div class="label">连续打卡（天）{{ stats.activeToday ? '' : '· 今天还没读哦' }}</div>
				</div>
				<div class="card">
					<div class="num mono">{{ stats.articlesRead }}</div>
					<div class="label">读过的文章</div>
				</div>
				<div class="card">
					<div class="num mono">{{ stats.poolActive }}</div>
					<div class="label">生字池</div>
				</div>
				<div class="card">
					<div class="num mono">{{ stats.graduated }}</div>
					<div class="label">已毕业 🎓</div>
				</div>
			</div>

			<RouterLink v-if="stats.dueToday > 0" to="/quiz" class="btn duebtn">今日待复习 {{ stats.dueToday }} 字，去测验 ›</RouterLink>

			<section v-if="stats.topChars.length" class="top">
				<h2>最常点的字</h2>
				<div class="chips">
					<span v-for="t in stats.topChars" :key="t.ch" class="topchip">
						<ruby>{{ t.ch }}<rt>{{ t.pinyin }}</rt></ruby>
						<em>{{ t.taps }}次</em>
					</span>
				</div>
			</section>

			<div class="links">
				<RouterLink to="/print/chars" class="btn ghost">🖨 打印生字表</RouterLink>
				<RouterLink to="/recordings" class="btn ghost">🎙 录音历史</RouterLink>
			</div>
		</template>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 680px;
	margin: 0 auto;
	padding: 20px 16px 60px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 20px;
}
h1 {
	color: var(--accent);
	margin: 0;
	font-size: 26px;
	display: flex;
	align-items: center;
	gap: 8px;
}
.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: 12px;
}
.card {
	background: var(--card);
	border-radius: var(--r-lg);
	padding: 18px;
	text-align: center;
	box-shadow: var(--shadow-sm);
}
.card.fire {
	grid-column: 1 / -1;
	background: linear-gradient(135deg, var(--accent-soft), #ffe0c2);
}
.num {
	font-size: 36px;
	font-weight: 700;
	color: var(--accent-dark);
}
.num.mono {
	font-family: var(--font-mono);
	font-variant-numeric: tabular-nums;
}
.label {
	color: var(--ink-soft);
	font-size: 13px;
	margin-top: 4px;
}
.duebtn {
	display: block;
	text-align: center;
	margin: 18px 0;
}
.top h2 {
	font-size: 18px;
	margin: 26px 0 12px;
}
.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}
.topchip {
	background: var(--card);
	border-radius: var(--r-md);
	padding: 7px 14px;
	font-size: 24px;
	box-shadow: var(--shadow-sm);
	display: inline-flex;
	align-items: center;
	gap: 8px;
}
.topchip rt {
	font-size: 11px;
	color: var(--pinyin);
}
.topchip em {
	font-style: normal;
	font-size: 12px;
	color: var(--ink-faint);
	font-family: var(--font-mono);
}
.links {
	display: flex;
	gap: 10px;
	margin-top: 32px;
	flex-wrap: wrap;
}
.hint {
	color: var(--ink-soft);
	text-align: center;
	margin-top: 40px;
}

@media (min-width: 1100px) and (orientation: landscape) {
	.wrap {
		max-width: 920px;
	}
	.cards {
		grid-template-columns: repeat(4, 1fr);
	}
	.card.fire {
		grid-column: auto;
	}
}
</style>
