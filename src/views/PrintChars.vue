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
	margin: 0 auto;
	padding: 16px;
	background: #fff;
	min-height: 100vh;
	color: #000;
}
.bar {
	display: flex;
	justify-content: space-between;
	margin-bottom: 12px;
}
h1 {
	font-size: 22px;
	text-align: center;
	margin: 4px 0 16px;
}
h1 small {
	font-size: 12px;
	font-weight: 400;
	color: #666;
	margin-left: 8px;
}
table {
	width: 100%;
	border-collapse: collapse;
}
th,
td {
	border: 1px solid #999;
	padding: 6px 8px;
	text-align: center;
}
.c-no {
	width: 36px;
	color: #666;
	font-size: 12px;
}
.c-ch {
	font-size: 26px;
	width: 70px;
}
.grad {
	font-size: 12px;
	vertical-align: super;
}
.c-py {
	font-size: 15px;
	width: 90px;
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
	color: #9a8a70;
	text-align: center;
}
@media print {
	.noprint {
		display: none !important;
	}
	.sheet {
		padding: 0;
	}
}
</style>
