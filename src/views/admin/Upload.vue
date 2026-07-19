<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, apiUpload, ApiError } from '@/composables/useApi';
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

// uploading=图片仍在网络传输；processing=已全部送达服务器，AI 正在分篇/识别（此后即使关闭浏览器也不影响后台识别）
type GroupStatus = 'pending' | 'compressing' | 'uploading' | 'processing' | 'done' | 'error';
interface FileItem {
	file: File;
	url: string;
	rotation: Rotation;
}
interface BatchGroup {
	id: number;
	items: FileItem[];
	status: GroupStatus;
	error: string;
	articleCount: number;
	uploadPct: number;
}

// 本地一次可选很多张（几百张），实际每次提交给后端识别的张数由 batchGroupSize 控制
const MAX_PICK = 300;

const router = useRouter();
const title = ref('');
const autoSplit = ref(false);
const files = ref<FileItem[]>([]);
const busy = ref(false);
const progress = ref('');
const msg = ref('');
const segCompress = ref(true);
const batchGroupSize = ref(10);

onMounted(async () => {
	try {
		const s = await api<AiSettings>('/api/admin/settings/ai');
		segCompress.value = s.segCompress;
		batchGroupSize.value = s.batchGroupSize || 10;
	} catch {
		// 拿不到设置就沿用默认（压缩 + 每组 10 张）
	}
});

// —— 批量分组处理（自动分篇模式下，本地按 batchGroupSize 分组、并发提交）——
const groups = ref<BatchGroup[]>([]);
const groupsProcessing = computed(() =>
	groups.value.some(
		(g) => g.status === 'pending' || g.status === 'compressing' || g.status === 'uploading' || g.status === 'processing',
	),
);
const groupsFailedCount = computed(() => groups.value.filter((g) => g.status === 'error').length);

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
		if (files.value.length >= MAX_PICK) break;
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

// 压缩单组图片并提交给 /articles/batch；结果并入 results，供下方进度面板轮询
async function processGroup(g: BatchGroup) {
	g.status = 'compressing';
	g.error = '';
	g.uploadPct = 0;
	try {
		const form = new FormData();
		for (const [i, item] of g.items.entries()) {
			const blob = await compressImage(item.file, 1568, 0.85, item.rotation);
			form.append('images', new File([blob], `${i + 1}.jpg`, { type: 'image/jpeg' }));
			// 见下方 submit() 注释：分篇用缩略图省 token，家长关闭「分篇时压缩」则用原图分组
			if (segCompress.value) {
				const thumb = await compressImage(item.file, 1024, 0.6, item.rotation);
				form.append('segThumbs', new File([thumb], `${i + 1}.jpg`, { type: 'image/jpeg' }));
			}
		}
		g.status = 'uploading';
		const { articles } = await apiUpload<{
			articles: { articleId: number; title: string; pages: { id: number; pageNo: number; ocrStatus?: OcrStatus }[] }[];
		}>('/api/admin/articles/batch', form, (pct) => {
			g.uploadPct = pct;
			// 上传字节全部发出＝图片已送达服务器；接下来是服务器端 AI 分篇/识别，与网络无关
			if (pct >= 100 && g.status === 'uploading') g.status = 'processing';
		});
		results.value.push(
			...articles.map((a) => ({
				articleId: a.articleId,
				title: a.title,
				pages: a.pages.map((p) => ({ id: p.id, pageNo: p.pageNo, ocrStatus: p.ocrStatus ?? ('pending' as OcrStatus) })),
			})),
		);
		g.articleCount = articles.length;
		g.status = 'done';
	} catch (e) {
		g.status = 'error';
		g.error = e instanceof ApiError ? e.message : '上传失败';
	}
}

async function retryGroup(g: BatchGroup) {
	if (g.status === 'compressing' || g.status === 'uploading') return;
	await processGroup(g);
	startPolling();
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
	groups.value = [];
	try {
		if (autoSplit.value) {
			// 本地按配置的单次批量识别最大张数分组，各组并发向后端提交，
			// AI 各自在组内按页码/语义分篇，最终结果汇总到 results 面板逐篇轮询识别进度。
			const size = Math.max(1, Math.floor(batchGroupSize.value) || 10);
			const chunks: FileItem[][] = [];
			for (let i = 0; i < files.value.length; i += size) chunks.push(files.value.slice(i, i + size));
			groups.value = chunks.map((items, i) => ({
				id: i + 1,
				items,
				status: 'pending',
				error: '',
				articleCount: 0,
				uploadPct: 0,
			}));
			progress.value = `并发处理 ${groups.value.length} 组…`;
			await Promise.allSettled(groups.value.map((g) => processGroup(g)));
			for (const item of files.value) URL.revokeObjectURL(item.url);
			files.value = [];
			startPolling();
		} else {
			const form = new FormData();
			form.set('title', title.value.trim());
			for (const [i, item] of files.value.entries()) {
				progress.value = `压缩图片 ${i + 1}/${files.value.length}…`;
				const blob = await compressImage(item.file, 1568, 0.85, item.rotation);
				form.append('images', new File([blob], `${i + 1}.jpg`, { type: 'image/jpeg' }));
			}
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
	groups.value = [];
}

onBeforeUnmount(stopPolling);
</script>

<template>
	<div class="wrap">
		<h1><span class="tzg-mark" aria-hidden="true"></span> 上传绘本</h1>

		<div v-if="results.length || groups.length" class="results">
			<div v-if="groups.length" class="grouppanel">
				<p v-if="groupsProcessing" class="banner run">
					🚀 正在并发处理 {{ groups.length }} 组（每组最多 {{ batchGroupSize }} 张，前端本地分组）…
				</p>
				<p v-else-if="groupsFailedCount" class="banner run">⚠️ {{ groupsFailedCount }}/{{ groups.length }} 组提交失败，可点击重试</p>
				<p v-else class="banner ok">✅ 图片已全部送达服务器并加入后台识别队列，可安全关闭本页</p>

				<ul class="grouplist">
					<li v-for="g in groups" :key="g.id" class="grouprow" :class="g.status">
						<span class="gname">第 {{ g.id }} 组</span>
						<span class="gcount">{{ g.items.length }} 张</span>
						<span class="gstatus">
							<template v-if="g.status === 'pending'">等待中</template>
							<template v-else-if="g.status === 'compressing'">压缩图片中…</template>
							<template v-else-if="g.status === 'uploading'">上传中 {{ g.uploadPct }}%</template>
							<template v-else-if="g.status === 'processing'">已送达服务器，AI 识别中…</template>
							<template v-else-if="g.status === 'done'">✅ 完成，{{ g.articleCount }} 篇，已入后台识别队列</template>
							<template v-else>❌ {{ g.error || '失败' }}</template>
						</span>
						<button v-if="g.status === 'error'" type="button" class="btn ghost small" @click="retryGroup(g)">重试</button>
					</li>
				</ul>
			</div>

			<template v-if="results.length">
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
			</template>

			<div v-if="!groupsProcessing" class="rowbtns">
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
						? `一次最多可选 ${MAX_PICK} 张（可跨多篇书，顺序可乱），前端会按每组 ${batchGroupSize} 张自动分组并发提交，AI 在组内按页码、语义衔接、版式自动分篇排序，随后自动逐篇识别正文，直到全部完成。`
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
				{{
					busy
						? progress || '处理中…'
						: autoSplit
							? `上传 ${files.length} 张（分 ${Math.max(1, Math.ceil(files.length / batchGroupSize))} 组并发处理）`
							: `上传 ${files.length} 页并识别`
				}}
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
	gap: 16px;
}
h1 {
	color: var(--accent);
	margin: 0;
	font-size: 26px;
	display: flex;
	align-items: center;
	gap: 8px;
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
	border-radius: var(--r-md);
	overflow: hidden;
	background: var(--paper-deep);
	box-shadow: var(--shadow-sm);
}
.thumb img {
	width: 100%;
	height: 100%;
	object-fit: contain;
	background: var(--paper-deep);
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
	color: var(--ink-soft);
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
	padding: 12px;
	border: 2px solid var(--paper-line);
	border-radius: var(--r-md);
	cursor: pointer;
	font-size: 15px;
	font-weight: 600;
	color: var(--ink-soft);
	transition: all 0.15s ease;
}
.mode.on {
	border-color: var(--accent);
	color: var(--accent);
	background: var(--accent-soft);
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
	padding: 12px 14px;
	border-radius: var(--r-md);
}
.banner.ok {
	color: var(--bamboo-dark);
	background: var(--bamboo-soft);
}
.banner.run {
	color: var(--accent);
	background: var(--accent-soft);
}
.results ul {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.grouppanel {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.grouplist {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.grouprow {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	padding: 9px 14px;
	border-radius: var(--r-md);
	background: var(--card);
	box-shadow: var(--shadow-sm);
	font-size: 14px;
}
.grouprow .gname {
	font-weight: 600;
	min-width: 4.5em;
}
.grouprow .gcount {
	color: var(--ink-faint);
	font-family: var(--font-mono);
}
.grouprow .gstatus {
	flex: 1;
}
.grouprow.error .gstatus {
	color: var(--danger);
}
.grouprow.done .gstatus {
	color: var(--bamboo-dark);
}
.grouprow.uploading .gstatus,
.grouprow.compressing .gstatus,
.grouprow.processing .gstatus {
	color: var(--accent);
}
.artrow {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
	padding: 12px 14px;
	border-radius: var(--r-md);
	background: var(--card);
	box-shadow: var(--shadow-sm);
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
	color: var(--ink-soft);
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
	font-family: var(--font-mono);
}
.dot.done {
	background: var(--bamboo);
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
	color: var(--ink-faint);
	text-decoration: none;
}
.back:hover {
	color: var(--accent);
}

@media (min-width: 720px) {
	.wrap {
		max-width: 720px;
	}
	.thumbs {
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
	}
}

@media (min-width: 1100px) and (orientation: landscape) {
	.wrap {
		max-width: 900px;
	}
	.artrow,
	.grouprow {
		padding: 12px 18px;
	}
}
</style>
