<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import { compressImage } from '@/lib/compressImage';

const router = useRouter();
const title = ref('');
const files = ref<{ file: File; url: string }[]>([]);
const busy = ref(false);
const progress = ref('');
const msg = ref('');

function onPick(e: Event) {
	const input = e.target as HTMLInputElement;
	for (const f of input.files ?? []) {
		if (files.value.length >= 20) break;
		files.value.push({ file: f, url: URL.createObjectURL(f) });
	}
	input.value = '';
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
	try {
		const form = new FormData();
		form.set('title', title.value.trim());
		for (const [i, item] of files.value.entries()) {
			progress.value = `压缩图片 ${i + 1}/${files.value.length}…`;
			const blob = await compressImage(item.file);
			form.append('images', new File([blob], `${i + 1}.jpg`, { type: 'image/jpeg' }));
		}
		progress.value = '上传并开始识别…';
		const { articleId } = await api<{ articleId: number }>('/api/admin/articles', { method: 'POST', body: form });
		void router.push(`/admin/proofread/${articleId}`);
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
		<p class="hint">按阅读顺序选择页面照片（一张照片 = 一页），上传后自动识别文字与拼音。</p>

		<input v-model="title" type="text" placeholder="标题（可留空，识别第一页时自动提取）" />

		<label class="picker btn ghost">
			📷 拍照 / 选图（可多选）
			<input type="file" accept="image/*" multiple hidden @change="onPick" />
		</label>

		<div v-if="files.length" class="thumbs">
			<div v-for="(f, i) in files" :key="f.url" class="thumb">
				<img :src="f.url" alt="" />
				<span class="no">{{ i + 1 }}</span>
				<button type="button" class="rm" aria-label="移除" @click="removeAt(i)">✕</button>
			</div>
		</div>

		<button type="button" class="btn" :disabled="busy || files.length === 0" @click="submit">
			{{ busy ? progress || '处理中…' : `上传 ${files.length} 页并识别` }}
		</button>
		<p v-if="msg" class="err">{{ msg }}</p>

		<RouterLink to="/admin" class="back">‹ 返回家长区</RouterLink>
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
	object-fit: cover;
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
	right: 4px;
	top: 4px;
	border: 0;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	border-radius: 50%;
	width: 24px;
	height: 24px;
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
.back {
	margin-top: 16px;
	font-size: 14px;
}
</style>
