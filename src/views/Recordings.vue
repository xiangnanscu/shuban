<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import type { RecordingItem } from '@/types';

const route = useRoute();
const articleId = Number(route.query.articleId) || null;

const items = ref<RecordingItem[]>([]);
const loading = ref(true);
const msg = ref('');

const groups = computed(() => {
	const map = new Map<string, RecordingItem[]>();
	for (const r of items.value) {
		const key = r.articleTitle || '未命名';
		if (!map.has(key)) map.set(key, []);
		map.get(key)?.push(r);
	}
	return [...map.entries()];
});

function fmtTime(dbTime: string): string {
	const iso = dbTime.includes('T') ? dbTime : `${dbTime.replace(' ', 'T')}Z`;
	const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
	return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtDur(s: number | null): string {
	if (!s) return '';
	return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

async function load() {
	loading.value = true;
	try {
		items.value = await api<RecordingItem[]>(`/api/recordings${articleId ? `?articleId=${articleId}` : ''}`);
	} finally {
		loading.value = false;
	}
}
onMounted(load);

async function remove(r: RecordingItem) {
	if (!confirm('删除这段录音？不可恢复。')) return;
	try {
		await api(`/api/admin/recordings/${r.id}`, { method: 'DELETE' });
		items.value = items.value.filter((x) => x.id !== r.id);
	} catch (e) {
		msg.value = e instanceof ApiError && e.status === 401 ? '删除录音需要家长先在家长区登录' : '删除失败';
	}
}
</script>

<template>
	<div class="wrap">
		<header class="bar">
			<RouterLink :to="articleId ? `/read/${articleId}` : '/'" class="btn ghost small">‹ 返回</RouterLink>
			<h1>录音历史</h1>
		</header>
		<p v-if="msg" class="err">{{ msg }}</p>

		<p v-if="loading" class="hint">加载中…</p>
		<p v-else-if="items.length === 0" class="hint">还没有录音。去阅读页点"🎙️ 朗读模式"录一段吧！</p>

		<section v-for="[title, list] in groups" :key="title" class="group">
			<h2>{{ title }}</h2>
			<div v-for="r in list" :key="r.id" class="item">
				<div class="meta">
					<span>{{ fmtTime(r.createdAt) }}</span>
					<span v-if="r.durationSec" class="dur">{{ fmtDur(r.durationSec) }}</span>
				</div>
				<audio :src="r.url" controls preload="none" class="player" />
				<div class="ops">
					<a class="btn ghost small" :href="r.url" :download="`${title}-${r.id}.mp3`">下载</a>
					<button type="button" class="btn danger small" @click="remove(r)">删除</button>
				</div>
			</div>
		</section>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 680px;
	margin: 0 auto;
	padding: 16px 16px 60px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 12px;
}
h1 {
	color: var(--accent);
	margin: 0;
	font-size: 24px;
}
.group h2 {
	font-size: 18px;
	margin: 22px 0 6px;
}
.item {
	background: #fff;
	border-radius: 12px;
	padding: 10px 12px;
	margin-bottom: 10px;
	box-shadow: 0 2px 6px rgba(90, 70, 40, 0.1);
}
.meta {
	display: flex;
	gap: 12px;
	font-size: 13px;
	color: #9a8a70;
	margin-bottom: 6px;
}
.player {
	width: 100%;
}
.ops {
	display: flex;
	gap: 8px;
	margin-top: 8px;
	justify-content: flex-end;
}
.hint {
	color: #9a8a70;
	text-align: center;
	margin-top: 40px;
}
.err {
	color: var(--danger);
}
</style>
