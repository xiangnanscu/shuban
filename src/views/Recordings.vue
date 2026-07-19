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
const exporting = ref(false);
const groupByArticle = ref(false);

const sortedItems = computed(() => [...items.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

const groups = computed(() => {
	const map = new Map<string, RecordingItem[]>();
	for (const r of sortedItems.value) {
		const key = r.articleTitle || '未命名';
		if (!map.has(key)) map.set(key, []);
		map.get(key)?.push(r);
	}
	return [...map.entries()];
});

// +8h 后取 Date 对象（用于按天分组/展示，统一用 China 时区）
function toLocalDate(dbTime: string): Date {
	const iso = dbTime.includes('T') ? dbTime : `${dbTime.replace(' ', 'T')}Z`;
	return new Date(new Date(iso).getTime() + 8 * 3600_000);
}

function dateKey(dbTime: string): string {
	const d = toLocalDate(dbTime);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function fmtTime(dbTime: string): string {
	const d = toLocalDate(dbTime);
	return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const today = dateKey(new Date().toISOString());
const exportDate = ref(today);

const exportDayItems = computed(() =>
	items.value.filter((r) => dateKey(r.createdAt) === exportDate.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
);

// 合并当天所有录音为一个 mp3：录音均为客户端 lamejs 编码的等规格 MP3（单声道 128kbps），
// MP3 帧可直接首尾拼接播放，故按时间顺序拼字节即可，无需重新编码
async function exportDay() {
	const list = exportDayItems.value;
	if (list.length === 0 || exporting.value) return;
	exporting.value = true;
	msg.value = '';
	try {
		const buffers = await Promise.all(
			list.map(async (r) => {
				const res = await fetch(r.url);
				if (!res.ok) throw new Error('fetch_failed');
				return new Uint8Array(await res.arrayBuffer());
			}),
		);
		const total = buffers.reduce((n, b) => n + b.length, 0);
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const b of buffers) {
			merged.set(b, offset);
			offset += b.length;
		}
		const blob = new Blob([merged], { type: 'audio/mpeg' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${exportDate.value}-录音合集.mp3`;
		a.click();
		URL.revokeObjectURL(url);
	} catch {
		msg.value = '导出失败，请重试';
	} finally {
		exporting.value = false;
	}
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

		<section class="export-bar">
			<input type="date" v-model="exportDate" class="date-input" />
			<span class="hint small">{{ exportDayItems.length }} 段</span>
			<button
				type="button"
				class="btn ghost small"
				:disabled="exportDayItems.length === 0 || exporting"
				@click="exportDay"
			>
				{{ exporting ? '导出中…' : '导出该天录音' }}
			</button>
		</section>

		<label class="group-toggle">
			<input type="checkbox" v-model="groupByArticle" />
			<span>按文章分组</span>
		</label>

		<p v-if="loading" class="hint">加载中…</p>
		<p v-else-if="items.length === 0" class="hint">还没有录音。去阅读页点"🎙️ 朗读模式"录一段吧！</p>

		<section v-else-if="!groupByArticle" class="group">
			<div v-for="r in sortedItems" :key="r.id" class="item">
				<div class="meta">
					<span>{{ fmtTime(r.createdAt) }}</span>
					<span class="title-tag">{{ r.articleTitle || '未命名' }}</span>
					<span v-if="r.durationSec" class="dur">{{ fmtDur(r.durationSec) }}</span>
				</div>
				<audio :src="r.url" controls preload="none" class="player" />
				<div class="ops">
					<a class="btn ghost small" :href="r.url" :download="`${r.articleTitle || '未命名'}-${r.id}.mp3`">下载</a>
					<button type="button" class="btn danger small" @click="remove(r)">删除</button>
				</div>
			</div>
		</section>

		<template v-else>
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
}
h1 {
	color: var(--accent);
	margin: 0;
	font-size: 26px;
}
.export-bar {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-top: 18px;
	padding: 12px 14px;
	background: var(--card);
	border-radius: var(--r-lg);
	box-shadow: var(--shadow-sm);
}
.date-input {
	border: 1.5px solid var(--paper-line);
	border-radius: var(--r-sm);
	padding: 6px 8px;
	font-size: 14px;
	color: inherit;
	background: transparent;
}
.hint.small {
	margin: 0;
	font-size: 13px;
	flex: 1;
}
.group h2 {
	font-size: 18px;
	margin: 26px 0 8px;
}
.group-toggle {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 14px;
	font-size: 14px;
	color: var(--ink-soft);
	cursor: pointer;
	width: fit-content;
}
.title-tag {
	flex: 1;
	min-width: 0;
	color: var(--accent);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.item {
	background: var(--card);
	border-radius: var(--r-md);
	padding: 12px 14px;
	margin-bottom: 10px;
	box-shadow: var(--shadow-sm);
}
.meta {
	display: flex;
	gap: 12px;
	font-size: 13px;
	color: var(--ink-soft);
	margin-bottom: 6px;
	font-family: var(--font-mono);
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
	color: var(--ink-soft);
	text-align: center;
	margin-top: 40px;
}
.err {
	color: var(--danger);
}

@media (min-width: 1100px) and (orientation: landscape) {
	.wrap {
		max-width: 920px;
	}
	.group {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0 16px;
		align-content: start;
	}
	.group h2 {
		grid-column: 1 / -1;
	}
}
</style>
