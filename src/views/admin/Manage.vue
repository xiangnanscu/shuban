<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import type { AiProviderName, AiSettings, ArticleSummary, RecordingSettings } from '@/types';

const router = useRouter();
const articles = ref<ArticleSummary[]>([]);
const selected = ref<Set<number>>(new Set());
const msg = ref('');
const showPinForm = ref(false);
const oldPin = ref('');
const newPin = ref('');

const PROVIDER_LABEL: Record<AiProviderName, string> = {
	gemini: 'Gemini',
	workersai: 'Workers AI',
	claude: 'Claude',
	mimo: 'MiMo',
};
const showAiForm = ref(false);
const ai = ref<AiSettings | null>(null);
const aiPrimaryProvider = ref<AiProviderName | ''>('');
const aiGeminiModel = ref('');
const aiWorkersaiModel = ref('');
const aiClaudeModel = ref('');
const aiMimoModel = ref('');
const aiTimeoutMs = ref('');
const aiSegCompress = ref(true);
const aiSegCombined = ref(false);
const aiBatchGroupSize = ref('');

const showRecForm = ref(false);
const rec = ref<RecordingSettings | null>(null);
const recMaxRecSec = ref('');

async function loadAiSettings() {
	ai.value = await api<AiSettings>('/api/admin/settings/ai');
	aiPrimaryProvider.value = ai.value.primaryProvider ?? '';
	aiGeminiModel.value = ai.value.geminiModel ?? '';
	aiWorkersaiModel.value = ai.value.workersaiModel ?? '';
	aiClaudeModel.value = ai.value.claudeModel ?? '';
	aiMimoModel.value = ai.value.mimoModel ?? '';
	aiTimeoutMs.value = ai.value.timeoutMs ? String(ai.value.timeoutMs) : '';
	aiSegCompress.value = ai.value.segCompress;
	aiSegCombined.value = ai.value.segCombined;
	aiBatchGroupSize.value = String(ai.value.batchGroupSize);
}

async function toggleAiForm() {
	showAiForm.value = !showAiForm.value;
	if (showAiForm.value && !ai.value) await loadAiSettings();
}

async function saveAiSettings() {
	msg.value = '';
	try {
		ai.value = await api<AiSettings>('/api/admin/settings/ai', {
			method: 'PUT',
			body: JSON.stringify({
				primaryProvider: aiPrimaryProvider.value || null,
				geminiModel: aiGeminiModel.value.trim() || null,
				workersaiModel: aiWorkersaiModel.value.trim() || null,
				claudeModel: aiClaudeModel.value.trim() || null,
				mimoModel: aiMimoModel.value.trim() || null,
				timeoutMs: String(aiTimeoutMs.value ?? '').trim() || null,
				segCompress: aiSegCompress.value,
				segCombined: aiSegCombined.value,
				batchGroupSize: aiBatchGroupSize.value.trim() || null,
			}),
		});
		msg.value = 'AI 设置已保存';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '保存失败';
	}
}

async function loadRecSettings() {
	rec.value = await api<RecordingSettings>('/api/admin/settings/recording');
	recMaxRecSec.value = String(rec.value.maxRecSec);
}

async function toggleRecForm() {
	showRecForm.value = !showRecForm.value;
	if (showRecForm.value && !rec.value) await loadRecSettings();
}

async function saveRecSettings() {
	msg.value = '';
	try {
		rec.value = await api<RecordingSettings>('/api/admin/settings/recording', {
			method: 'PUT',
			body: JSON.stringify({ maxRecSec: recMaxRecSec.value.trim() || null }),
		});
		recMaxRecSec.value = String(rec.value.maxRecSec);
		msg.value = '录音设置已保存';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '保存失败';
	}
}

async function load() {
	articles.value = await api<ArticleSummary[]>('/api/articles');
	selected.value.clear();
}
onMounted(load);

function toggleSelect(id: number) {
	if (selected.value.has(id)) selected.value.delete(id);
	else selected.value.add(id);
}

function toggleSelectAll() {
	if (selected.value.size === articles.value.length) selected.value.clear();
	else selected.value = new Set(articles.value.map((a) => a.id));
}

async function batchSetStatus(status: 'draft' | 'published') {
	if (!selected.value.size) return;
	try {
		await api('/api/admin/articles/batch', {
			method: 'PUT',
			body: JSON.stringify({ ids: [...selected.value], status }),
		});
		msg.value = status === 'published' ? '已发布选中文章' : '已下架选中文章';
		await load();
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '操作失败';
	}
}

async function batchRemove() {
	if (!selected.value.size) return;
	if (!confirm(`删除选中的 ${selected.value.size} 篇文章？图片与识别结果将一并删除，不可恢复。`)) return;
	try {
		await api('/api/admin/articles/batch', { method: 'DELETE', body: JSON.stringify({ ids: [...selected.value] }) });
		msg.value = '已删除选中文章';
		await load();
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '操作失败';
	}
}

async function batchClearTaps() {
	if (!selected.value.size) return;
	if (!confirm(`清除选中 ${selected.value.size} 篇文章的点击历史？生字池与答题记录不受影响，不可恢复。`)) return;
	try {
		await api('/api/admin/articles/batch/taps', { method: 'DELETE', body: JSON.stringify({ ids: [...selected.value] }) });
		msg.value = '点击历史已清除';
		selected.value.clear();
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '操作失败';
	}
}

async function clearAllTaps() {
	if (!confirm('清除所有文章的点击历史？生字池与答题记录不受影响，不可恢复。')) return;
	try {
		await api('/api/admin/taps', { method: 'DELETE' });
		msg.value = '所有点击历史已清除';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '操作失败';
	}
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
				<button type="button" class="btn ghost small" @click="toggleAiForm">AI 设置</button>
				<button type="button" class="btn ghost small" @click="toggleRecForm">录音设置</button>
				<button type="button" class="btn ghost small" @click="logout">退出</button>
			</div>
		</header>

		<form v-if="showPinForm" class="pinform" @submit.prevent="changePin">
			<input v-model="oldPin" type="password" inputmode="numeric" maxlength="6" placeholder="当前 PIN" />
			<input v-model="newPin" type="password" inputmode="numeric" maxlength="6" placeholder="新 PIN（6 位数字）" />
			<button class="btn small" type="submit">确认修改</button>
		</form>

		<form v-if="showAiForm && ai" class="aiform" @submit.prevent="saveAiSettings">
			<label>
				优先识别引擎
				<select v-model="aiPrimaryProvider">
					<option value="">默认顺序（{{ ai.defaults.providerOrder.map((p) => PROVIDER_LABEL[p]).join(' → ') }}）</option>
					<option v-for="p in ai.defaults.providerOrder" :key="p" :value="p">{{ PROVIDER_LABEL[p] }} 优先</option>
				</select>
			</label>
			<p class="hint small">选中引擎失败会自动降级到其余引擎，顺序不变，保证识别不中断。</p>
			<label>
				Gemini 模型
				<input v-model="aiGeminiModel" type="text" :placeholder="ai.defaults.geminiModel" />
			</label>
			<label>
				Workers AI 模型
				<input v-model="aiWorkersaiModel" type="text" :placeholder="ai.defaults.workersaiModel" />
			</label>
			<label>
				Claude 模型
				<input v-model="aiClaudeModel" type="text" :placeholder="ai.defaults.claudeModel" />
			</label>
			<label>
				MiMo 模型
				<input v-model="aiMimoModel" type="text" :placeholder="ai.defaults.mimoModel" />
			</label>
			<label>
				单次识别超时（毫秒）
				<input v-model="aiTimeoutMs" type="number" min="1" :placeholder="String(ai.defaults.timeoutMs)" />
			</label>
			<p class="hint small">模型 / 超时留空即用出厂默认值（Workers AI 出厂默认为 Kimi）。</p>
			<label class="checkline">
				<input v-model="aiSegCompress" type="checkbox" />
				AI 自动分篇时压缩缩略图
			</label>
			<p class="hint small">关闭后分篇用原图分组识别，成功率更高（避免被误判为一篇），但更耗 token、更慢。</p>
			<label class="checkline">
				<input v-model="aiSegCombined" type="checkbox" />
				分篇与识别合并为一次调用
			</label>
			<p class="hint small">
				开启后自动分篇时一次 prompt 同时完成分组与正文识别，简单页面更快、更省调用；页面复杂或漏识别的会自动退回逐页识别。仅 Gemini /
				Claude 支持。单组图片数 &gt; 4 张时会自动改用「先分篇、逐页排队识别」，避免大批量卡在一次不可拆分的调用里看不到进度。
			</p>
			<label>
				批量上传每组最大张数
				<input v-model="aiBatchGroupSize" type="number" min="1" :max="ai.defaults.maxBatchImages" :placeholder="String(ai.defaults.batchGroupSize)" />
			</label>
			<p class="hint small">
				一次性选很多张照片上传时，前端会按此张数自动分组、并发提交给后端识别，超过 {{ ai.defaults.maxBatchImages }} 无效（服务端硬上限）。留空即用出厂默认值 {{ ai.defaults.batchGroupSize }} 张。
			</p>
			<button class="btn small" type="submit">保存 AI 设置</button>
		</form>

		<form v-if="showRecForm && rec" class="aiform" @submit.prevent="saveRecSettings">
			<label>
				录音最大时长阈值（秒）
				<input v-model="recMaxRecSec" type="number" min="1" :placeholder="String(rec.defaults.maxRecSec)" />
			</label>
			<p class="hint small">
				超过此时长的录音视为孩子中途走开、朗读未完成，上传时直接舍弃（不保存）。留空即用出厂默认值 {{ rec.defaults.maxRecSec }} 秒。
			</p>
			<button class="btn small" type="submit">保存录音设置</button>
		</form>

		<p v-if="msg" class="hint">{{ msg }}</p>

		<div v-if="articles.length" class="batchbar">
			<label class="checkline">
				<input type="checkbox" :checked="selected.size > 0 && selected.size === articles.length" @change="toggleSelectAll" />
				全选
			</label>
			<span class="hint small">已选 {{ selected.size }} 篇</span>
			<button type="button" class="btn ghost small" :disabled="!selected.size" @click="batchSetStatus('published')">批量发布</button>
			<button type="button" class="btn ghost small" :disabled="!selected.size" @click="batchSetStatus('draft')">批量下架</button>
			<button type="button" class="btn ghost small" :disabled="!selected.size" @click="batchClearTaps">批量清除点击历史</button>
			<button type="button" class="btn danger small" :disabled="!selected.size" @click="batchRemove">批量删除</button>
		</div>

		<table v-if="articles.length" class="list">
			<tbody>
				<tr v-for="a in articles" :key="a.id">
					<td class="sel">
						<input type="checkbox" :checked="selected.has(a.id)" @change="toggleSelect(a.id)" />
					</td>
					<td class="t">
						{{ a.title || '未命名' }}
						<span class="chip" :class="a.status">{{ a.status === 'published' ? '已发布' : '草稿' }}</span>
					</td>
					<td class="meta">{{ a.pageCount }} 页</td>
					<td class="ops">
						<RouterLink class="btn ghost small" :to="`/admin/proofread/${a.id}`">校对</RouterLink>
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
.aiform {
	display: flex;
	flex-direction: column;
	gap: 10px;
	margin-top: 14px;
	padding: 14px;
	border: 1px solid #eadfca;
	border-radius: 8px;
	max-width: 420px;
}
.aiform label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 14px;
	font-weight: 600;
}
.aiform input,
.aiform select {
	font-weight: normal;
	padding: 6px 8px;
	border: 1px solid #eadfca;
	border-radius: 6px;
}
.aiform .checkline {
	flex-direction: row;
	align-items: center;
	gap: 8px;
}
.aiform .checkline input {
	width: auto;
}
.hint.small {
	font-size: 12px;
	margin: 0;
}
.batchbar {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	margin-top: 20px;
}
.batchbar .checkline {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 14px;
	font-weight: 600;
}
.list {
	width: 100%;
	margin-top: 10px;
	border-collapse: collapse;
}
.list td {
	padding: 12px 8px;
	border-bottom: 1px solid #eadfca;
	vertical-align: middle;
}
.list td.sel {
	width: 32px;
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
