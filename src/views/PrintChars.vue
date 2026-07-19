<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import type { PoolDetailItem } from '@/types';

const items = ref<PoolDetailItem[]>([]);
const loading = ref(true);
const today = new Date().toLocaleDateString('zh-CN');

function doPrint() {
	window.print();
}

onMounted(async () => {
	try {
		items.value = await api<PoolDetailItem[]>('/api/pool/detail');
	} finally {
		loading.value = false;
	}
});
</script>

<template>
	<div class="sheet">
		<div class="noprint bar">
			<RouterLink to="/stats" class="btn ghost small">‹ 返回</RouterLink>
			<button type="button" class="btn small" @click="doPrint">🖨 打印</button>
		</div>

		<h1>生字表 <small>{{ today }} · 共 {{ items.length }} 字</small></h1>

		<p v-if="loading" class="noprint hint">加载中…</p>
		<p v-else-if="items.length === 0" class="hint">生字池是空的。</p>

		<table v-else>
			<thead>
				<tr>
					<th class="c-no">#</th>
					<th class="c-ch">字</th>
					<th class="c-py">拼音</th>
					<th class="c-w">听写</th>
					<th class="c-ok">掌握</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(it, i) in items" :key="it.ch">
					<td class="c-no">{{ i + 1 }}</td>
					<td class="c-ch">{{ it.ch }}<span v-if="it.graduated" class="grad">🎓</span></td>
					<td class="c-py">{{ it.pinyin }}</td>
					<td class="c-w"></td>
					<td class="c-ok">□</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>

<style scoped>
.sheet {
	max-width: 640px;
	margin: 24px auto;
	padding: 28px;
	background: #fff;
	min-height: calc(100vh - 48px);
	color: #000;
	border-radius: var(--r-lg);
	box-shadow: var(--shadow-md);
}
.bar {
	display: flex;
	justify-content: space-between;
	margin-bottom: 16px;
}
h1 {
	font-size: 22px;
	text-align: center;
	margin: 4px 0 20px;
	color: #000;
	font-family: var(--font-display);
}
h1 small {
	font-size: 12px;
	font-weight: 400;
	color: #666;
	margin-left: 8px;
	font-family: var(--font-body);
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	border: 1px solid #999;
	padding: 8px 8px;
	text-align: center;
}
thead th {
	background: #f4f0e6;
	font-weight: 700;
}
.c-no {
	width: 36px;
	color: #666;
	font-size: 12px;
}
.c-ch {
	font-size: 26px;
	width: 70px;
	font-family: var(--font-display);
}
.grad {
	font-size: 12px;
	vertical-align: super;
}
.c-py {
	font-size: 15px;
	width: 90px;
	color: var(--pinyin);
}
.c-w {
	min-width: 120px;
	height: 44px;
}
.c-ok {
	width: 50px;
	font-size: 18px;
}
.hint {
	color: var(--ink-soft);
	text-align: center;
}
@media print {
	.noprint {
		display: none !important;
	}
	.sheet {
		padding: 0;
		margin: 0;
		box-shadow: none;
		border-radius: 0;
		min-height: 0;
	}
	thead th {
		background: none;
	}
}

@media (min-width: 720px) {
	.sheet {
		padding: 36px 40px;
	}
}
</style>
