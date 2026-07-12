<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import PinyinToggle from '@/components/PinyinToggle.vue';
import Recorder from '@/components/Recorder.vue';
import RubyLine from '@/components/RubyLine.vue';
import { api } from '@/composables/useApi';
import { recordTap } from '@/composables/useTapQueue';
import { cancelSpeak, speak, speakAsync } from '@/composables/useTts';
import type { ArticleDetail, PageLine, PageToken, PinyinMode } from '@/types';

const route = useRoute();
const articleId = Number(route.params.id);

const article = ref<ArticleDetail | null>(null);
const pool = ref<Set<string>>(new Set());
const pageIdx = ref(0);
const showImage = ref(false);
const showRecorder = ref(false);
const error = ref('');

const MODE_KEY = 'shuban.pinyinMode';
const mode = ref<PinyinMode>((localStorage.getItem(MODE_KEY) as PinyinMode) || 'show');
function setMode(m: PinyinMode) {
	mode.value = m;
	localStorage.setItem(MODE_KEY, m);
}

const page = computed(() => article.value?.pages[pageIdx.value] ?? null);

// —— 阅读会话（打卡统计） ——
let sessionId: number | null = null;

function endSession() {
	if (sessionId === null) return;
	const payload = JSON.stringify({ sessionId });
	sessionId = null;
	if (navigator.sendBeacon) {
		navigator.sendBeacon('/api/sessions/end', new Blob([payload], { type: 'application/json' }));
	} else {
		void fetch('/api/sessions/end', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
	}
}
const onPageHide = () => endSession();

onMounted(async () => {
	window.addEventListener('pagehide', onPageHide);
	try {
		const [a, p] = await Promise.all([api<ArticleDetail>(`/api/articles/${articleId}`), api<string[]>('/api/pool')]);
		article.value = a;
		pool.value = new Set(p);
	} catch (e) {
		error.value = e instanceof Error ? e.message : '加载失败';
	}
	try {
		const s = await api<{ sessionId: number }>('/api/sessions/start', {
			method: 'POST',
			body: JSON.stringify({ articleId }),
		});
		sessionId = s.sessionId;
	} catch {
		/* 打卡失败不影响阅读 */
	}
});

onBeforeUnmount(() => {
	window.removeEventListener('pagehide', onPageHide);
	stopListen();
	endSession();
});

// —— 点字 ——
function onTap(tok: PageToken) {
	stopListen();
	speak(tok.t);
	recordTap({ ch: tok.t, pinyin: tok.p, articleId });
	const next = new Set(pool.value);
	next.add(tok.t);
	pool.value = next;
}

function speakLine(line: PageLine) {
	stopListen();
	speak(line.tokens.map((t) => t.t).join(''));
}

// —— 听全文（逐行跟随） ——
const listenState = ref<'idle' | 'playing' | 'paused'>('idle');
const currentLine = ref(-1);
let playToken = 0;

async function playFrom(startIdx: number) {
	const my = ++playToken;
	listenState.value = 'playing';
	const lines = page.value?.content.lines ?? [];
	for (let i = startIdx; i < lines.length; i++) {
		if (playToken !== my || listenState.value !== 'playing') return;
		currentLine.value = i;
		document.getElementById(`line-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		const text = lines[i]?.tokens.map((t) => t.t).join('') ?? '';
		if (!text) continue;
		await speakAsync(text);
	}
	if (playToken === my && listenState.value === 'playing') stopListen();
}

function toggleListen() {
	if (listenState.value === 'playing') {
		// 暂停 = 停当前行，记住位置（iOS 的 pause/resume 不可靠，重启更稳）
		listenState.value = 'paused';
		playToken++;
		cancelSpeak();
	} else {
		void playFrom(listenState.value === 'paused' && currentLine.value >= 0 ? currentLine.value : 0);
	}
}

function stopListen() {
	if (listenState.value === 'idle') return;
	listenState.value = 'idle';
	currentLine.value = -1;
	playToken++;
	cancelSpeak();
}

watch(pageIdx, () => stopListen());
</script>

<template>
	<div class="page">
		<header class="bar">
			<RouterLink to="/" class="btn ghost">‹ 返回</RouterLink>
			<PinyinToggle :model-value="mode" @update:model-value="setMode" />
			<button type="button" class="btn ghost" @click="showImage = !showImage">
				{{ showImage ? '收起原图' : '看原图' }}
			</button>
		</header>

		<p v-if="error" class="hint">{{ error }}</p>
		<p v-else-if="!article" class="hint">加载中…</p>

		<template v-else>
			<h1 class="title">{{ article.title || '未命名' }}</h1>

			<div class="toolbar">
				<button type="button" class="btn ghost small" @click="toggleListen">
					{{ listenState === 'playing' ? '⏸ 暂停' : listenState === 'paused' ? '▶ 继续' : '▶ 听全文' }}
				</button>
				<button v-if="listenState !== 'idle'" type="button" class="btn ghost small" @click="stopListen">⏹ 停止</button>
				<span class="grow" />
				<button type="button" class="btn small" @click="showRecorder = true">🎙️ 朗读模式</button>
				<RouterLink class="btn ghost small" :to="`/recordings?articleId=${articleId}`">录音历史</RouterLink>
			</div>

			<img v-if="showImage && page" :src="page.imageUrl" class="original" alt="原书页面" />

			<main v-if="page" class="content">
				<p v-if="page.ocrStatus !== 'done'" class="hint">这一页还在识别中…</p>
				<div
					v-for="(line, li) in page.content.lines"
					:id="`line-${li}`"
					:key="li"
					class="line-row"
					:class="{ active: li === currentLine && listenState !== 'idle' }"
				>
					<RubyLine :line="line" :mode="mode" :known-set="pool" @tap="onTap" />
					<button
						v-if="line.tokens.length > 0"
						type="button"
						class="speaker"
						aria-label="朗读这一行"
						@click="speakLine(line)"
					>
						🔊
					</button>
				</div>
			</main>

			<nav v-if="article.pages.length > 1" class="pager">
				<button type="button" class="btn" :disabled="pageIdx === 0" @click="pageIdx--">‹ 上一页</button>
				<span class="pageno">第 {{ pageIdx + 1 }} / {{ article.pages.length }} 页</span>
				<button type="button" class="btn" :disabled="pageIdx === article.pages.length - 1" @click="pageIdx++">
					下一页 ›
				</button>
			</nav>

			<Recorder
				v-if="showRecorder"
				:article-id="articleId"
				:article-title="article.title"
				@close="showRecorder = false"
			/>
		</template>
	</div>
</template>

<style scoped>
.page {
	max-width: 760px;
	margin: 0 auto;
	padding: 12px 16px 80px;
}
.bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 8px;
	position: sticky;
	top: 0;
	background: var(--paper);
	padding: 8px 0;
	z-index: 5;
}
.title {
	text-align: center;
	font-size: clamp(30px, 7vw, 48px);
	margin: 12px 0 12px;
	color: var(--ink);
}
.toolbar {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-bottom: 14px;
}
.grow {
	flex: 1;
}
.original {
	width: 100%;
	border-radius: 12px;
	margin-bottom: 16px;
	box-shadow: 0 2px 10px rgba(90, 70, 40, 0.2);
}
.line-row {
	display: flex;
	align-items: baseline;
	gap: 6px;
	border-radius: 12px;
	padding: 0 4px;
}
.line-row.active {
	background: rgba(217, 119, 54, 0.14);
	outline: 2px solid rgba(217, 119, 54, 0.4);
}
.line-row > :first-child {
	flex: 1;
	min-width: 0;
}
.speaker {
	border: 0;
	background: transparent;
	font-size: 18px;
	cursor: pointer;
	opacity: 0.45;
	padding: 4px;
}
.speaker:active {
	opacity: 1;
}
.pager {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: 28px;
}
.pageno {
	color: #9a8a70;
	font-size: 15px;
}
.hint {
	color: #9a8a70;
	text-align: center;
}
</style>
