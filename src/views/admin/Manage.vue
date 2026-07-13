<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import type { ArticleSummary } from '@/types';

const router = useRouter();
const articles = ref<ArticleSummary[]>([]);
const msg = ref('');
const showPinForm = ref(false);
const oldPin = ref('');
const newPin = ref('');

async function load() {
	articles.value = await api<ArticleSummary[]>('/api/articles');
}
onMounted(load);

async function toggleStatus(a: ArticleSummary) {
	await api(`/api/admin/articles/${a.id}`, {
		method: 'PUT',
		body: JSON.stringify({ status: a.status === 'published' ? 'draft' : 'published' }),
	});
	await load();
}

async function remove(a: ArticleSummary) {
	if (!confirm(`删除《${a.title || '未命名'}》？图片与识别结果将一并删除，不可恢复。`)) return;
	await api(`/api/admin/articles/${a.id}`, { method: 'DELETE' });
	await load();
}

async function clearTaps(a: ArticleSummary) {
	if (!confirm(`清除《${a.title || '未命名'}》的点击历史？生字池与答题记录不受影响，不可恢复。`)) return;
	await api(`/api/admin/articles/${a.id}/taps`, { method: 'DELETE' });
	msg.value = '点击历史已清除';
}

async function clearAllTaps() {
	if (!confirm('清除所有文章的点击历史？生字池与答题记录不受影响，不可恢复。')) return;
	await api('/api/admin/taps', { method: 'DELETE' });
	msg.value = '所有点击历史已清除';
}

async function changePin() {
	msg.value = '';
	try {
		await api('/api/admin/settings/pin', {
			method: 'PUT',
			body: JSON.stringify({ oldPin: oldPin.value, newPin: newPin.value }),
		});
		msg.value = 'PIN 已修改';
		showPinForm.value = false;
		oldPin.value = newPin.value = '';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '修改失败';
	}
}

async function logout() {
	await api('/api/auth/logout', { method: 'POST' });
	void router.push('/');
}
</script>

<template>
	<div class="wrap">
		<header class="bar">
			<h1>家长区</h1>
			<div class="actions">
				<RouterLink to="/admin/upload" class="btn">＋ 上传新文章</RouterLink>
				<RouterLink to="/admin/pool" class="btn ghost small">生字池</RouterLink>
				<a href="/api/admin/export" download class="btn ghost small">导出数据</a>
				<button type="button" class="btn ghost small" @click="clearAllTaps">清除所有点击历史</button>
				<button type="button" class="btn ghost small" @click="showPinForm = !showPinForm">修改 PIN</button>
				<button type="button" class="btn ghost small" @click="logout">退出</button>
			</div>
		</header>

		<form v-if="showPinForm" class="pinform" @submit.prevent="changePin">
			<input v-model="oldPin" type="password" inputmode="numeric" maxlength="6" placeholder="当前 PIN" />
			<input v-model="newPin" type="password" inputmode="numeric" maxlength="6" placeholder="新 PIN（6 位数字）" />
			<button class="btn small" type="submit">确认修改</button>
		</form>
		<p v-if="msg" class="hint">{{ msg }}</p>

		<table v-if="articles.length" class="list">
			<tbody>
				<tr v-for="a in articles" :key="a.id">
					<td class="t">
						{{ a.title || '未命名' }}
						<span class="chip" :class="a.status">{{ a.status === 'published' ? '已发布' : '草稿' }}</span>
					</td>
					<td class="meta">{{ a.pageCount }} 页</td>
					<td class="ops">
						<RouterLink class="btn ghost small" :to="`/admin/proofread/${a.id}`">校对</RouterLink>
						<button type="button" class="btn ghost small" @click="toggleStatus(a)">
							{{ a.status === 'published' ? '下架' : '发布' }}
						</button>
						<button type="button" class="btn ghost small" @click="clearTaps(a)">清除点击历史</button>
						<button type="button" class="btn danger small" @click="remove(a)">删除</button>
					</td>
				</tr>
			</tbody>
		</table>
		<p v-else class="hint">暂无文章，点右上角上传。</p>

		<RouterLink to="/" class="back">‹ 回首页</RouterLink>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 860px;
	margin: 0 auto;
	padding: 20px 16px 60px;
}
.bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 10px;
}
h1 {
	color: var(--accent);
	margin: 0;
}
.actions {
	display: flex;
	gap: 8px;
	align-items: center;
}
.pinform {
	display: flex;
	gap: 8px;
	margin-top: 14px;
	flex-wrap: wrap;
}
.list {
	width: 100%;
	margin-top: 20px;
	border-collapse: collapse;
}
.list td {
	padding: 12px 8px;
	border-bottom: 1px solid #eadfca;
	vertical-align: middle;
}
.t {
	font-size: 17px;
	font-weight: 600;
}
.t .chip {
	margin-left: 8px;
}
.meta {
	color: #9a8a70;
	white-space: nowrap;
}
.ops {
	display: flex;
	gap: 6px;
	justify-content: flex-end;
	flex-wrap: wrap;
}
.hint {
	color: #9a8a70;
	margin-top: 16px;
}
.back {
	display: inline-block;
	margin-top: 30px;
	font-size: 14px;
}
</style>
