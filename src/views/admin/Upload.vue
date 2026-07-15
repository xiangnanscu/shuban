<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import { compressImage } from '@/lib/compressImage';
import type { AiSettings, ArticleDetail } from '@/types';

type Rotation = 0 | 90 | 180 | 270;
type OcrStatus = 'pending' | 'done' | 'failed';

interface BatchPage {
	id: number;
	pageNo: number;
	ocrStatus: OcrStatus;
}
interface BatchArticle {
	articleId: number;
	title: string;
	pages: BatchPage[];
}

const router = useRouter();
const title = ref('');
const autoSplit = ref(false);
const files = ref<{ file: File; url: string; rotation: Rotation }[]>([]);
const busy = ref(false);
const progress = ref('');
const msg = ref('');
const segCompress = ref(true);

onMounted(async () => {
	try {
		const s = await api<AiSettings>('/api/admin/settings/ai');
		segCompress.value = s.segCompress;
	} catch {
		// 拿不到设置就沿用默认（压缩）
	}
});

// —— 分篇后的识别进度（自动识别到全部完成，无需人工确认）——
const results = ref<BatchArticle[]>([]);
const pendingSince = reactive<Record<number, number>>({});
const retriggered = new Set<number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
// 一页 pending 超过此时长仍无结果，判为卡住（如服务端 waitUntil 被回收），前端兜底重触发一次
const STUCK_RETRIGGER_MS = 90_000;

const allDone = computed(
	() => results.value.length > 0 && results.value.every((a) => a.pages.every((p) => p.ocrStatus !== 'pending')),
);
const doneCount = (a: BatchArticle) => a.pages.filter((p) => p.ocrStatus === 'done').length;
const failedCount = (a: BatchArticle) => a.pages.filter((p) => p.ocrStatus === 'failed').length;

function onPick(e: Event) {
	const input = e.target as HTMLInputElement;
	for (const f of input.files ?? []) {
		if (files.value.length >= 20) break;
		files.value.push({ file: f, url: URL.createObjectURL(f), rotation: 0 });
	}
	input.value = '';
}

function rotateAt(i: number) {
	const item = files.value[i];
	if (!item) return;
	item.rotation = (((item.rotation + 90) % 360) as Rotation);
}

function removeAt(i: number) {
	const item = files.value[i];
	if (!item) return;
	URL.revokeObjectURL(item.url);
	files.value.splice(i, 1);
}

async function submit() {
	if (files.value.length === 0) {
		msg.value = '请先选择或拍摄图片';
		return;
	}
	busy.value = true;
	msg.value = '';
	stopPolling();
	results.value = [];
	try {
		const form = new FormData();
		if (!autoSplit.value) form.set('title', title.value.trim());
		for (const [i, item] of files.value.entries()) {
			progress.value = `压缩图片 ${i + 1}/${files.value.length}…`;
			const blob = await compressImage(item.file, 1568, 0.85, item.rotation);
			form.append('images', new File([blob], `${i + 1}.jpg`, { type: 'image/jpeg' }));
			// 自动分篇：额外生成小缩略图，只用于「分组+排序」推断（无需 OCR 级分辨率），
			// 大幅降低一次性多图调用的 token 压力；正文仍用上面的全分辨率图识别。
			// 家长关闭「分篇时压缩」后不传缩略图，服务端会退回用全分辨率图分组，牺牲 token/速度换成功率。
			if (autoSplit.value && segCompress.value) {
				const thumb = await compressImage(item.file, 1024, 0.6, item.rotation);
				form.append('segThumbs', new File([thumb], `${i + 1}.jpg`, { type: 'image/jpeg' }));
			}
		}
		if (autoSplit.value) {
			progress.value = 'AI 正在按页码与语义分篇…';
			const { articles } = await api<{
				articles: { articleId: number; title: string; pages: { id: number; pageNo: number; ocrStatus?: OcrStatus }[] }[];
			}>('/api/admin/articles/batch', { method: 'POST', body: form });
			results.value = articles.map((a) => ({
				articleId: a.articleId,
				title: a.title,
				// 组合模式可能已直接识别完（done）；两段式返回 pending，随后由轮询更新
				pages: a.pages.map((p) => ({ id: p.id, pageNo: p.pageNo, ocrStatus: p.ocrStatus ?? ('pending' as OcrStatus) })),
			}));
			for (const item of files.value) URL.revokeObjectURL(item.url);
			files.value = [];
			startPolling();
		} else {
			progress.value = '上传并开始识别…';
			const { articleId } = await api<{ articleId: number }>('/api/admin/articles', { method: 'POST', body: form });
			void router.push(`/admin/proofread/${articleId}`);
		}
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '上传失败，请重试';
	} finally {
		busy.value = false;
		progress.value = '';
	}
}

// —— 进度轮询 + 卡住自愈 ——

function startPolling() {
	if (pollTimer) return;
	void pollAll();
	pollTimer = setInterval(() => void pollAll(), 2500);
}

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	for (const k of Object.keys(pendingSince)) delete pendingSince[Number(k)];
	retriggered.clear();
}

async function pollAll() {
	for (const art of results.value) {
		let detail: ArticleDetail;
		try {
			detail = await api<ArticleDetail>(`/api/articles/${art.articleId}`);
		} catch {
			continue;
		}
		for (const p of art.pages) {
			const dp = detail.pages.find((x) => x.id === p.id);
			if (!dp) continue;
			p.ocrStatus = dp.ocrStatus;
			if (dp.ocrStatus === 'pending') {
				const since = pendingSince[p.id];
				if (since === undefined) {
					pendingSince[p.id] = Date.now();
				} else if (Date.now() - since > STUCK_RETRIGGER_MS && !retriggered.has(p.id)) {
					// 兜底：可能服务端 waitUntil 被回收，主动在新请求里重跑该页
					retriggered.add(p.id);
					pendingSince[p.id] = Date.now();
					void api(`/api/admin/pages/${p.id}/ocr`, { method: 'POST' }).catch(() => {});
				}
			} else {
				delete pendingSince[p.id];
			}
		}
	}
	if (allDone.value && pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

async function retryPage(p: BatchPage) {
	if (p.ocrStatus !== 'failed') return;
	p.ocrStatus = 'pending';
	pendingSince[p.id] = Date.now();
	retriggered.delete(p.id);
	await api(`/api/admin/pages/${p.id}/ocr`, { method: 'POST' }).catch(() => {});
	startPolling();
}

function reset() {
	stopPolling();
	results.value = [];
}

onBeforeUnmount(stopPolling);
</script>

<template>
	<div class="wrap">
		<h1>上传绘本</h1>

		<div v-if="results.length" class="results">
			<p v-if="allDone" class="banner ok">✅ 全部识别完成，共 {{ results.length }} 篇草稿，请逐篇校对后发布</p>
			<p v-else class="banner run">🔍 已分为 {{ results.length }} 篇，正在后台逐篇识别正文…（识别在服务器进行，可关闭本页/浏览器，稍后回来校对）</p>

			<ul>
				<li v-for="a in results" :key="a.articleId" class="artrow">
					<div class="artmain">
						<RouterLink class="tlink" :to="`/admin/proofread/${a.articleId}`">《{{ a.title || '未命名' }}》</RouterLink>
						<span class="sub">
							{{ doneCount(a) }}/{{ a.pages.length }} 页已识别<template v-if="failedCount(a)">
								· {{ failedCount(a) }} 页失败（点红点重试）</template
							>
						</span>
					</div>
					<div class="pgdots">
						<button
							v-for="p in a.pages"
							:key="p.id"
							type="button"
							class="dot"
							:class="p.ocrStatus"
							:disabled="p.ocrStatus !== 'failed'"
							:title="`第 ${p.pageNo} 页：${p.ocrStatus === 'done' ? '已识别' : p.ocrStatus === 'failed' ? '失败，点击重识别' : '识别中…'}`"
							@click="retryPage(p)"
						>
							{{ p.pageNo }}
						</button>
					</div>
					<RouterLink class="btn ghost small" :to="`/admin/proofread/${a.articleId}`">校对</RouterLink>
				</li>
			</ul>

			<div class="rowbtns">
				<button type="button" class="btn ghost" @click="reset">继续上传</button>
				<RouterLink to="/admin" class="btn">返回家长区</RouterLink>
			</div>
		</div>

		<template v-else>
			<div class="modes">
				<label :class="['mode', { on: !autoSplit }]">
					<input v-model="autoSplit" type="radio" :value="false" />
					单篇上传
				</label>
				<label :class="['mode', { on: autoSplit }]">
					<input v-model="autoSplit" type="radio" :value="true" />
					AI 自动分篇
				</label>
			</div>
			<p class="hint">
				{{
					autoSplit
						? '一次上传多篇文章的所有页面（顺序可乱），AI 会按页码、语义衔接、版式自动分组并排序，随后自动逐篇识别正文，直到全部完成。'
						: '按阅读顺序选择同一篇文章的页面照片（一张照片 = 一页），上传后自动识别文字与拼音。'
				}}
			</p>

			<input v-if="!autoSplit" v-model="title" type="text" placeholder="标题（可留空，识别第一页时自动提取）" />

			<label class="picker btn ghost">
				📷 拍照 / 选图（可多选）
				<input type="file" accept="image/*" multiple hidden @change="onPick" />
			</label>

			<div v-if="files.length" class="thumbs">
				<div v-for="(f, i) in files" :key="f.url" class="thumb">
					<img :src="f.url" :style="{ transform: `rotate(${f.rotation}deg)` }" alt="" />
					<span class="no">{{ i + 1 }}</span>
					<button type="button" class="rotate" aria-label="旋转" @click="rotateAt(i)">↻</button>
					<button type="button" class="rm" aria-label="移除" @click="removeAt(i)">✕</button>
				</div>
			</div>

			<button type="button" class="btn" :disabled="busy || files.length === 0" @click="submit">
				{{ busy ? progress || '处理中…' : autoSplit ? `上传 ${files.length} 张并自动分篇` : `上传 ${files.length} 页并识别` }}
			</button>
			<p v-if="msg" class="err">{{ msg }}</p>

			<RouterLink to="/admin" class="back">‹ 返回家长区</RouterLink>
		</template>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 640px;
	margin: 0 auto;
	padding: 20px 16px 60px;
	display: flex;
	flex-direction: column;
	gap: 14px;
}
h1 {
	color: var(--accent);
	margin: 0;
}
.picker {
	cursor: pointer;
}
.thumbs {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
	gap: 10px;
}
.thumb {
	position: relative;
	aspect-ratio: 3 / 4;
	border-radius: 10px;
	overflow: hidden;
	background: #f3ead9;
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	background: #f3ead9;
	transition: transform 0.15s ease;
}
.no {
	position: absolute;
	left: 6px;
	top: 6px;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	border-radius: 6px;
	padding: 1px 7px;
	font-size: 12px;
}
.rm {
	position: absolute;
	top: 4px;
	right: 4px;
	border: 0;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	border-radius: 50%;
	width: 24px;
	height: 24px;
	cursor: pointer;
}
.rotate {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	border: 0;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	border-radius: 50%;
	width: 44px;
	height: 44px;
	font-size: 24px;
	line-height: 1;
	cursor: pointer;
}
.err {
	color: var(--danger);
}
.hint {
	color: #9a8a70;
	font-size: 14px;
	margin: 0;
}
.modes {
	display: flex;
	gap: 8px;
}
.mode {
	flex: 1;
	text-align: center;
	padding: 10px;
	border: 2px solid #eadfca;
	border-radius: 10px;
	cursor: pointer;
	font-size: 15px;
	color: #9a8a70;
}
.mode.on {
	border-color: var(--accent);
	color: var(--accent);
	font-weight: 600;
	background: #fff8ec;
}
.mode input {
	display: none;
}
.results {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.banner {
	margin: 0;
	font-weight: 600;
	padding: 10px 12px;
	border-radius: 10px;
}
.banner.ok {
	color: #2e7d32;
	background: #eaf6ea;
}
.banner.run {
	color: var(--accent);
	background: #fff8ec;
}
.results ul {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.artrow {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	padding: 10px 12px;
	border: 1px solid #eadfca;
	border-radius: 10px;
	background: #fff;
}
.artmain {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	flex: 1;
}
.tlink {
	font-size: 16px;
	font-weight: 600;
}
.sub {
	color: #9a8a70;
	font-size: 13px;
}
.pgdots {
	display: flex;
	gap: 5px;
	flex-wrap: wrap;
}
.dot {
	width: 26px;
	height: 26px;
	border-radius: 50%;
	border: 0;
	font-size: 12px;
	color: #fff;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.dot.done {
	background: #4caf50;
}
.dot.pending {
	background: #d9a441;
	animation: pulse 1.1s ease-in-out infinite;
}
.dot.failed {
	background: var(--danger);
	cursor: pointer;
}
@keyframes pulse {
	50% {
		opacity: 0.45;
	}
}
.rowbtns {
	display: flex;
	gap: 10px;
	margin-top: 6px;
}
.back {
	margin-top: 16px;
	font-size: 14px;
}
</style>
