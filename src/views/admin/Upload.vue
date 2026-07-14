<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import { compressImage } from '@/lib/compressImage';

type Rotation = 0 | 90 | 180 | 270;

const router = useRouter();
const title = ref('');
const autoSplit = ref(false);
const files = ref<{ file: File; url: string; rotation: Rotation }[]>([]);
const busy = ref(false);
const progress = ref('');
const msg = ref('');
const results = ref<{ articleId: number; title: string; pageCount: number }[]>([]);

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
	results.value = [];
	try {
		const form = new FormData();
		if (!autoSplit.value) form.set('title', title.value.trim());
		for (const [i, item] of files.value.entries()) {
			progress.value = `压缩图片 ${i + 1}/${files.value.length}…`;
			const blob = await compressImage(item.file, 1568, 0.85, item.rotation);
			form.append('images', new File([blob], `${i + 1}.jpg`, { type: 'image/jpeg' }));
		}
		if (autoSplit.value) {
			progress.value = 'AI 正在按页码与语义分篇…';
			const { articles } = await api<{ articles: typeof results.value }>('/api/admin/articles/batch', {
				method: 'POST',
				body: form,
			});
			const first = articles[0];
			if (articles.length === 1 && first) {
				void router.push(`/admin/proofread/${first.articleId}`);
				return;
			}
			results.value = articles;
			for (const item of files.value) URL.revokeObjectURL(item.url);
			files.value = [];
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
</script>

<template>
	<div class="wrap">
		<h1>上传绘本</h1>

		<div v-if="results.length" class="results">
			<p class="ok">✅ AI 识别为 {{ results.length }} 篇文章，已建为草稿，请逐篇校对后发布：</p>
			<ul>
				<li v-for="r in results" :key="r.articleId">
					<RouterLink class="btn ghost small" :to="`/admin/proofread/${r.articleId}`">
						校对《{{ r.title || '未命名' }}》（{{ r.pageCount }} 页）
					</RouterLink>
				</li>
			</ul>
			<div class="rowbtns">
				<button type="button" class="btn ghost" @click="results = []">继续上传</button>
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
						? '一次上传多篇文章的所有页面（顺序可乱），AI 会按页码、语义衔接、版式自动分组并排序，一次建成多篇草稿。'
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
.results .ok {
	color: var(--accent);
	font-weight: 600;
	margin: 0;
}
.results ul {
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 10px;
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
