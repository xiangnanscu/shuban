<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';
import type { ArticleDetail, ArticlePage, PageLine, PinyinMode } from '@/types';

const route = useRoute();
const router = useRouter();
const articleId = Number(route.params.id);

const title = ref('');
const status = ref<'draft' | 'published'>('draft');
const pages = reactive<ArticlePage[]>([]);
const showImage = reactive<Record<number, boolean>>({});
const msg = ref('');
const busy = ref(false);

// 选中的 token：页/行/列 + 编辑缓冲
const sel = ref<{ pi: number; li: number; ti: number } | null>(null);
const editZi = ref('');
const editPy = ref('');

const hasPending = computed(() => pages.some((p) => p.ocrStatus === 'pending'));
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function load(initial = false) {
	const a = await api<ArticleDetail>(`/api/articles/${articleId}`);
	title.value = initial ? a.title : title.value || a.title;
	status.value = a.status;
	for (const p of a.pages) {
		const local = pages.find((x) => x.id === p.id);
		if (!local) {
			pages.push(p);
		} else if (local.ocrStatus === 'pending') {
			// 只覆盖仍在识别中的页，避免轮询冲掉本地已做的修改
			local.ocrStatus = p.ocrStatus;
			local.content = p.content;
		}
	}
	syncPolling();
}

function syncPolling() {
	if (hasPending.value && !pollTimer) {
		pollTimer = setInterval(() => void load(), 2500);
	} else if (!hasPending.value && pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

onMounted(() => void load(true));
onBeforeUnmount(() => {
	if (pollTimer) clearInterval(pollTimer);
});

// —— token 编辑 ——

function lineAt(pi: number, li: number): PageLine | undefined {
	return pages[pi]?.content.lines[li];
}

function selectToken(pi: number, li: number, ti: number) {
	const tok = lineAt(pi, li)?.tokens[ti];
	if (!tok) return;
	sel.value = { pi, li, ti };
	editZi.value = tok.t;
	editPy.value = tok.p ?? '';
}

function applyToken() {
	if (!sel.value) return;
	const { pi, li, ti } = sel.value;
	const tok = lineAt(pi, li)?.tokens[ti];
	if (!tok) return;
	tok.t = editZi.value;
	if (/\p{Script=Han}/u.test(editZi.value)) tok.p = editPy.value.trim();
	else delete tok.p;
	sel.value = null;
}

function deleteToken() {
	if (!sel.value) return;
	const { pi, li, ti } = sel.value;
	lineAt(pi, li)?.tokens.splice(ti, 1);
	sel.value = null;
}

function insertBefore() {
	if (!sel.value) return;
	const { pi, li, ti } = sel.value;
	lineAt(pi, li)?.tokens.splice(ti, 0, { t: '？', p: '' });
	selectToken(pi, li, ti);
}

// —— 行操作 ——

const ALIGNS: PageLine['align'][] = ['left', 'center', 'right'];
const ALIGN_LABEL = { left: '左', center: '中', right: '右' } as const;

function cycleAlign(pi: number, li: number) {
	const line = lineAt(pi, li);
	if (!line) return;
	line.align = ALIGNS[(ALIGNS.indexOf(line.align) + 1) % ALIGNS.length] ?? 'left';
}

function deleteLine(pi: number, li: number) {
	pages[pi]?.content.lines.splice(li, 1);
	sel.value = null;
}

function insertLineAfter(pi: number, li: number) {
	pages[pi]?.content.lines.splice(li + 1, 0, { align: 'left', tokens: [] });
}

function addTokenToLine(pi: number, li: number) {
	const line = lineAt(pi, li);
	if (!line) return;
	line.tokens.push({ t: '？', p: '' });
	selectToken(pi, li, line.tokens.length - 1);
}

// —— 保存 / 发布 / 重识别 ——

async function save(publish = false) {
	busy.value = true;
	msg.value = '';
	try {
		await api(`/api/admin/articles/${articleId}`, {
			method: 'PUT',
			body: JSON.stringify({
				title: title.value,
				status: publish ? 'published' : undefined,
				pages: pages.map((p) => ({ id: p.id, lines: p.content.lines })),
			}),
		});
		msg.value = publish ? '已发布 ✓' : '已保存 ✓';
		if (publish) status.value = 'published';
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '保存失败';
	} finally {
		busy.value = false;
	}
}

async function reOcr(page: ArticlePage) {
	if (!confirm('重新识别会覆盖这一页当前的文字（含手动修改），继续？')) return;
	await api(`/api/admin/pages/${page.id}/ocr`, { method: 'POST' });
	page.ocrStatus = 'pending';
	page.content = { lines: [] };
	syncPolling();
}
</script>

<template>
	<div class="wrap">
		<header class="bar">
			<RouterLink to="/admin" class="btn ghost small">‹ 家长区</RouterLink>
			<span class="chip" :class="status">{{ status === 'published' ? '已发布' : '草稿' }}</span>
			<span class="grow" />
			<button type="button" class="btn ghost small" :disabled="busy" @click="save(false)">保存草稿</button>
			<button type="button" class="btn small" :disabled="busy || hasPending" @click="save(true)">发布</button>
		</header>
		<p v-if="msg" class="msg">{{ msg }}</p>

		<input v-model="title" class="title-input" type="text" placeholder="文章标题" />

		<section v-for="(page, pi) in pages" :key="page.id" class="pagecard">
			<header class="pagehead">
				<strong>第 {{ page.pageNo }} 页</strong>
				<span class="chip" :class="page.ocrStatus">
					{{ page.ocrStatus === 'pending' ? '识别中…' : page.ocrStatus === 'failed' ? '识别失败' : '已识别' }}
				</span>
				<span class="grow" />
				<button type="button" class="btn ghost small" @click="showImage[page.id] = !showImage[page.id]">
					{{ showImage[page.id] ? '收起原图' : '对照原图' }}
				</button>
				<button
					v-if="page.ocrStatus !== 'pending'"
					type="button"
					class="btn ghost small"
					@click="reOcr(page)"
				>
					重新识别
				</button>
			</header>

			<img v-if="showImage[page.id]" :src="page.imageUrl" class="original" alt="原书页面" />

			<p v-if="page.ocrStatus === 'pending'" class="hint">识别中，请稍候…（约 10~30 秒）</p>
			<p v-else-if="page.ocrStatus === 'failed'" class="hint fail">识别失败：图片可能过长或模糊，可点"重新识别"或删除本篇重拍。</p>

			<div v-for="(line, li) in page.content.lines" :key="li" class="linebox">
				<div class="linetools">
					<button type="button" class="tool" title="对齐" @click="cycleAlign(pi, li)">{{ ALIGN_LABEL[line.align] }}</button>
					<button type="button" class="tool" title="加字" @click="addTokenToLine(pi, li)">＋字</button>
					<button type="button" class="tool" title="下方插行" @click="insertLineAfter(pi, li)">＋行</button>
					<button type="button" class="tool danger" title="删行" @click="deleteLine(pi, li)">✕</button>
				</div>
				<p class="linetext" :class="line.align">
					<template v-for="(tok, ti) in line.tokens" :key="ti">
						<ruby
							v-if="tok.p !== undefined"
							class="tok"
							:class="{ sel: sel && sel.pi === pi && sel.li === li && sel.ti === ti, nopy: !tok.p }"
							@click="selectToken(pi, li, ti)"
							>{{ tok.t }}<rt>{{ tok.p || '？' }}</rt></ruby
						>
						<span
							v-else
							class="tok punct"
							:class="{ sel: sel && sel.pi === pi && sel.li === li && sel.ti === ti }"
							@click="selectToken(pi, li, ti)"
							>{{ tok.t }}</span
						>
					</template>
					<span v-if="line.tokens.length === 0" class="hint">（空行）</span>
				</p>
			</div>
		</section>

		<!-- 底部固定 token 编辑面板 -->
		<div v-if="sel" class="editor">
			<input v-model="editZi" class="zi" maxlength="4" placeholder="字" />
			<input v-model="editPy" class="py" placeholder="拼音（如 xiǎo）" />
			<button type="button" class="btn small" @click="applyToken">确定</button>
			<button type="button" class="btn ghost small" @click="insertBefore">前插</button>
			<button type="button" class="btn danger small" @click="deleteToken">删除</button>
			<button type="button" class="btn ghost small" @click="sel = null">关闭</button>
		</div>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 860px;
	margin: 0 auto;
	padding: 14px 16px 120px;
}
.bar {
	display: flex;
	align-items: center;
	gap: 8px;
	position: sticky;
	top: 0;
	background: var(--paper);
	padding: 8px 0;
	z-index: 5;
}
.grow {
	flex: 1;
}
.msg {
	color: var(--accent-dark);
}
.title-input {
	width: 100%;
	font-size: 20px;
	margin: 10px 0 18px;
}
.pagecard {
	background: #fff;
	border-radius: 14px;
	padding: 14px;
	margin-bottom: 18px;
	box-shadow: 0 2px 8px rgba(90, 70, 40, 0.1);
}
.pagehead {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-bottom: 8px;
}
.original {
	width: 100%;
	border-radius: 10px;
	margin: 8px 0;
}
.linebox {
	border-top: 1px dashed #eadfca;
	padding: 6px 0;
}
.linetools {
	display: flex;
	gap: 4px;
	margin-bottom: 2px;
}
.tool {
	border: 1px solid #d9cbb2;
	background: #faf6ee;
	border-radius: 8px;
	font-size: 12px;
	padding: 2px 8px;
	cursor: pointer;
	color: #8a6d3b;
}
.tool.danger {
	color: var(--danger);
}
.linetext {
	font-size: 26px;
	line-height: 2.1;
	margin: 0;
}
.linetext.left {
	text-align: left;
}
.linetext.center {
	text-align: center;
}
.linetext.right {
	text-align: right;
}
.tok {
	cursor: pointer;
	border-radius: 6px;
	padding: 0 1px;
}
.tok rt {
	font-size: 0.42em;
	color: var(--pinyin);
}
.tok.sel {
	background: rgba(217, 119, 54, 0.25);
	outline: 2px solid var(--accent);
}
.tok.nopy rt {
	color: var(--danger);
}
.editor {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	background: #fff;
	border-top: 2px solid var(--accent);
	display: flex;
	gap: 8px;
	padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
	align-items: center;
	flex-wrap: wrap;
	z-index: 20;
}
.editor .zi {
	width: 72px;
	font-size: 24px;
	text-align: center;
}
.editor .py {
	width: 150px;
	font-size: 18px;
}
.hint {
	color: #9a8a70;
	font-size: 14px;
}
.hint.fail {
	color: var(--danger);
}
</style>
