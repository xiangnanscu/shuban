<script setup lang="ts">
// 家长生字池管理：查看每个字的进度，移除误点的字（F7）。
import { computed, onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import type { PoolItem } from '@/types';

const items = ref<PoolItem[]>([]);
const loading = ref(true);

const active = computed(() => items.value.filter((i) => !i.graduated));
const graduatedItems = computed(() => items.value.filter((i) => i.graduated));

async function load() {
	loading.value = true;
	try {
		items.value = await api<PoolItem[]>('/api/admin/review');
	} finally {
		loading.value = false;
	}
}
onMounted(load);

async function remove(item: PoolItem) {
	if (!confirm(`把「${item.ch}」移出生字池？点击与答题历史保留，仅不再安排复习。`)) return;
	await api(`/api/admin/review/${encodeURIComponent(item.ch)}`, { method: 'DELETE' });
	items.value = items.value.filter((i) => i.ch !== item.ch);
}

function fmtDue(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	if (d.getTime() <= Date.now()) return '已到期';
	return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' });
}
</script>

<template>
	<div class="wrap">
		<header class="bar">
			<h1><span class="tzg-mark" aria-hidden="true"></span> 生字池</h1>
			<RouterLink to="/admin" class="btn ghost small">‹ 返回家长区</RouterLink>
		</header>

		<p v-if="loading" class="hint">加载中…</p>
		<p v-else-if="items.length === 0" class="hint">生字池是空的：孩子在阅读页点字后，生字会自动进来。</p>

		<template v-else>
			<h2>复习中（{{ active.length }}）</h2>
			<table class="list">
				<thead>
					<tr>
						<th>字</th>
						<th>拼音</th>
						<th>盒</th>
						<th>下次复习</th>
						<th>对 / 错</th>
						<th>点击</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="i in active" :key="i.ch">
						<td class="ch">{{ i.ch }}</td>
						<td class="py">{{ i.pinyin || '—' }}</td>
						<td>{{ i.box }}</td>
						<td>{{ fmtDue(i.dueAt) }}</td>
						<td>{{ i.correctCount }} / {{ i.wrongCount }}</td>
						<td>{{ i.totalTaps }}</td>
						<td class="ops">
							<button type="button" class="btn danger small" @click="remove(i)">移除</button>
						</td>
					</tr>
				</tbody>
			</table>

			<template v-if="graduatedItems.length">
				<h2>已毕业（{{ graduatedItems.length }}）</h2>
				<table class="list">
					<tbody>
						<tr v-for="i in graduatedItems" :key="i.ch">
							<td class="ch">{{ i.ch }}</td>
							<td class="py">{{ i.pinyin || '—' }}</td>
							<td>{{ i.correctCount }} / {{ i.wrongCount }}</td>
							<td>{{ i.totalTaps }} 次点击</td>
							<td class="ops">
								<button type="button" class="btn danger small" @click="remove(i)">移除</button>
							</td>
						</tr>
					</tbody>
				</table>
			</template>
		</template>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 720px;
	margin: 0 auto;
	padding: 20px 16px 60px;
}
.bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding-bottom: 16px;
	border-bottom: 2px dashed var(--paper-line);
}
h1 {
	color: var(--accent);
	margin: 0;
	font-size: 26px;
	display: flex;
	align-items: center;
	gap: 8px;
}
h2 {
	font-size: 16px;
	color: var(--ink-soft);
	margin: 28px 0 8px;
	font-weight: 600;
}
.list {
	width: 100%;
	border-collapse: collapse;
	background: var(--card);
	border-radius: var(--r-lg);
	overflow: hidden;
	box-shadow: var(--shadow-sm);
}
.list th {
	text-align: left;
	font-size: 12px;
	color: var(--ink-faint);
	font-weight: 600;
	padding: 10px 12px;
	background: var(--paper-deep);
}
.list td {
	padding: 11px 12px;
	border-bottom: 1px solid var(--paper-line);
	vertical-align: middle;
	font-size: 15px;
}
.list tr:last-child td {
	border-bottom: 0;
}
.ch {
	font-size: 24px;
	font-weight: 600;
	font-family: var(--font-display);
}
.py {
	color: var(--pinyin);
}
.ops {
	text-align: right;
}
.hint {
	color: var(--ink-soft);
	margin-top: 16px;
}

@media (min-width: 1100px) and (orientation: landscape) {
	.wrap {
		max-width: 960px;
	}
}
</style>
