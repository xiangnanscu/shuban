<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { api, ApiError } from '@/composables/useApi';
import { useRecorder } from '@/composables/useRecorder';

const props = defineProps<{ articleId: number; articleTitle: string }>();
const emit = defineEmits<{ close: [] }>();

const rec = useRecorder();
const saving = ref(false);
const savedId = ref<number | null>(null);
const msg = ref('');

const timeLabel = computed(() => {
	const s = rec.recording.value ? rec.seconds.value : Math.round(rec.durationSec.value);
	return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});

const fileName = computed(() => {
	const d = new Date();
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	return `${date}-${props.articleTitle || '朗读'}.mp3`;
});

async function begin() {
	msg.value = '';
	savedId.value = null;
	try {
		await rec.start();
	} catch {
		msg.value = rec.error.value;
	}
}

function finish() {
	rec.stop();
}

async function archive() {
	const blob = rec.getBlob();
	if (!blob) return;
	saving.value = true;
	msg.value = '';
	try {
		const form = new FormData();
		form.set('file', new File([blob], fileName.value, { type: 'audio/mpeg' }));
		form.set('articleId', String(props.articleId));
		form.set('durationSec', String(rec.durationSec.value));
		const { id } = await api<{ id: number }>('/api/recordings', { method: 'POST', body: form });
		savedId.value = id;
		msg.value = '已存档 ✓';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '存档失败，请重试';
	} finally {
		saving.value = false;
	}
}

function close() {
	rec.cancel();
	emit('close');
}

onBeforeUnmount(() => rec.cancel());
</script>

<template>
	<div class="sheet">
		<div class="head">
			<strong>朗读录音</strong>
			<span class="grow" />
			<button type="button" class="btn ghost small" @click="close">关闭</button>
		</div>

		<p v-if="!rec.supported" class="hint">这台设备不支持录音。</p>

		<template v-else>
			<!-- 待开始 -->
			<div v-if="!rec.recording.value && !rec.blobUrl.value" class="stage">
				<button type="button" class="record-btn" aria-label="开始录音" @click="begin">🎙️</button>
				<p class="hint">点击开始，大声读完这篇文章吧</p>
			</div>

			<!-- 录音中 -->
			<div v-else-if="rec.recording.value" class="stage">
				<div class="time rec">● {{ timeLabel }}</div>
				<div class="meter"><div class="fill" :style="{ width: `${Math.round(rec.level.value * 100)}%` }" /></div>
				<div class="row">
					<button type="button" class="btn" @click="finish">完成</button>
					<button type="button" class="btn ghost" @click="rec.cancel()">取消</button>
				</div>
			</div>

			<!-- 试听 / 保存 -->
			<div v-else class="stage">
				<div class="time">{{ timeLabel }}</div>
				<audio :src="rec.blobUrl.value ?? undefined" controls class="player" />
				<div class="row">
					<a class="btn" :href="rec.blobUrl.value ?? '#'" :download="fileName">保存到设备</a>
					<button type="button" class="btn ghost" :disabled="saving || savedId !== null" @click="archive">
						{{ savedId !== null ? '已存档 ✓' : saving ? '存档中…' : '存档' }}
					</button>
					<button type="button" class="btn ghost" @click="rec.discard()">重录</button>
				</div>
				<p class="hint">iPhone 上"保存到设备"会弹出分享面板，选"存储到文件"即可。</p>
			</div>

			<p v-if="msg" class="msg">{{ msg }}</p>
		</template>
	</div>
</template>

<style scoped>
.sheet {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	background: #fff;
	border-top: 2px solid var(--accent);
	border-radius: 16px 16px 0 0;
	padding: 14px 16px calc(18px + env(safe-area-inset-bottom));
	z-index: 30;
	box-shadow: 0 -4px 20px rgba(90, 70, 40, 0.18);
}
.head {
	display: flex;
	align-items: center;
	margin-bottom: 8px;
}
.grow {
	flex: 1;
}
.stage {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	padding: 8px 0;
}
.record-btn {
	width: 84px;
	height: 84px;
	border-radius: 50%;
	border: 0;
	background: var(--accent);
	font-size: 36px;
	cursor: pointer;
	box-shadow: 0 4px 14px rgba(217, 119, 54, 0.45);
}
.record-btn:active {
	transform: scale(0.95);
}
.time {
	font-size: 28px;
	font-variant-numeric: tabular-nums;
	color: var(--ink);
}
.time.rec {
	color: var(--danger);
}
.meter {
	width: 70%;
	height: 10px;
	background: #f0e8d8;
	border-radius: 999px;
	overflow: hidden;
}
.fill {
	height: 100%;
	background: var(--accent);
	transition: width 0.1s linear;
}
.row {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
	justify-content: center;
}
.player {
	width: 100%;
}
.hint {
	color: #9a8a70;
	font-size: 13px;
	margin: 0;
	text-align: center;
}
.msg {
	color: var(--accent-dark);
	text-align: center;
	margin: 6px 0 0;
}
</style>
