<script setup lang="ts">
// 复习测验（US-5）：每轮 ≤10 题，全部为听音选字（田字格四选一，孩子独立完成）；
// 对→升盒，错→归零；错题轮末重测一次（practice，不再动 Leitner）；连错 3 题温和收场。
import { onMounted, ref } from 'vue';
import { api } from '@/composables/useApi';
import { speak } from '@/composables/useTts';
import type { QuizQuestion } from '@/types';

type Phase = 'loading' | 'start' | 'question' | 'done' | 'empty';

const MAX_QUESTIONS = 10;
const MAX_CONSECUTIVE_WRONG = 3;

const phase = ref<Phase>('loading');
const dueCount = ref(0);
const question = ref<QuizQuestion | null>(null);
const selected = ref<string | null>(null);
const answered = ref(false);
const lastCorrect = ref(false);
const retesting = ref(false);
const practiceMode = ref(false);
const endedEarly = ref(false);

const askedCount = ref(0);
const correctCount = ref(0);
const wrongQuestions: QuizQuestion[] = [];
let consecutiveWrong = 0;
let advanceTimer = 0;

onMounted(loadDue);

async function loadDue() {
	phase.value = 'loading';
	try {
		const due = await api<{ ch: string }[]>('/api/review/due');
		dueCount.value = due.length;
		phase.value = due.length > 0 ? 'start' : 'empty';
	} catch {
		phase.value = 'empty';
	}
}

function start(practice = false) {
	practiceMode.value = practice;
	retesting.value = false;
	endedEarly.value = false;
	askedCount.value = 0;
	correctCount.value = 0;
	wrongQuestions.length = 0;
	consecutiveWrong = 0;
	speak(' '); // 用户手势内触发一次，解锁 iOS 语音合成
	void nextQuestion();
}

async function nextQuestion() {
	selected.value = null;
	answered.value = false;
	question.value = null;
	phase.value = 'question';

	if (retesting.value) {
		const q = wrongQuestions.shift();
		if (!q) return finish();
		question.value = q;
		speak(q.ch, q.pinyin);
		return;
	}
	if (askedCount.value >= MAX_QUESTIONS) return startRetest();

	try {
		const r = await api<{ done: boolean; question?: QuizQuestion }>(
			practiceMode.value ? '/api/quiz/next?practice=1' : '/api/quiz/next',
		);
		if (r.done || !r.question) return startRetest();
		question.value = r.question;
		speak(r.question.ch, r.question.pinyin);
	} catch {
		startRetest();
	}
}

function startRetest() {
	if (practiceMode.value || wrongQuestions.length === 0) return finish();
	retesting.value = true;
	void nextQuestion();
}

function finish() {
	phase.value = 'done';
}

function answer(choice: string) {
	const q = question.value;
	if (!q || answered.value) return;
	const correct = choice === q.ch;
	selected.value = choice;
	answered.value = true;
	lastCorrect.value = correct;

	if (!retesting.value) {
		askedCount.value++;
		if (correct) correctCount.value++;
		consecutiveWrong = correct ? 0 : consecutiveWrong + 1;
		if (!correct && !practiceMode.value) wrongQuestions.push(q);
	}

	if (correct) playDing();
	// 答错高亮正确答案并再播一遍发音巩固
	if (!correct) speak(q.ch, q.pinyin);

	// 重测与练习模式只记流水，不动 Leitner
	void api('/api/quiz/answer', {
		method: 'POST',
		body: JSON.stringify({ ch: q.ch, mode: q.mode, correct, practice: retesting.value || practiceMode.value }),
	}).catch(() => {});

	const stopRound = !retesting.value && consecutiveWrong >= MAX_CONSECUTIVE_WRONG;
	window.clearTimeout(advanceTimer);
	advanceTimer = window.setTimeout(
		() => {
			if (stopRound) {
				endedEarly.value = true;
				finish();
			} else {
				void nextQuestion();
			}
		},
		correct ? 1000 : 2400,
	);
}

function optionClass(opt: string): string {
	const q = question.value;
	if (!q || !answered.value) return '';
	if (opt === q.ch) return 'right';
	if (opt === selected.value) return 'wrong';
	return 'dim';
}

/** 答对音效：两个上行短音（WebAudio，无资源文件） */
function playDing() {
	try {
		const ctx = new AudioContext();
		const play = (freq: number, at: number) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.25, ctx.currentTime + at);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.18);
			osc.connect(gain).connect(ctx.destination);
			osc.start(ctx.currentTime + at);
			osc.stop(ctx.currentTime + at + 0.2);
		};
		play(880, 0);
		play(1320, 0.12);
		window.setTimeout(() => void ctx.close(), 500);
	} catch {
		/* 无音效不影响测验 */
	}
}
</script>

<template>
	<div class="page">
		<header class="top">
			<RouterLink to="/" class="back">‹ 首页</RouterLink>
			<span v-if="phase === 'question'" class="progress">
				<!-- 答完当前题后 askedCount 已 +1，反馈期间题号保持不动 -->
				{{
					retesting
						? '错题重测'
						: `第 ${Math.min(answered ? askedCount : askedCount + 1, MAX_QUESTIONS)} / ${MAX_QUESTIONS} 题`
				}}
			</span>
		</header>

		<p v-if="phase === 'loading'" class="hint center">加载中…</p>

		<!-- 开始页 -->
		<div v-else-if="phase === 'start'" class="center">
			<div class="big-emoji">🌟</div>
			<h1>今天有 {{ dueCount }} 个字要复习</h1>
			<button type="button" class="btn xl" @click="start()">开始测验</button>
		</div>

		<!-- 无到期字 -->
		<div v-else-if="phase === 'empty'" class="center">
			<div class="big-emoji">🎉</div>
			<h1>今天没有要复习的字</h1>
			<p class="hint">去读书点几个生字，明天再来吧。</p>
			<button type="button" class="btn ghost" @click="start(true)">随便练练（不计成绩）</button>
		</div>

		<!-- 答题：听发音，田字格四选一 -->
		<div v-else-if="phase === 'question'" class="quiz">
			<p v-if="!question" class="hint center">出题中…</p>
			<template v-else>
				<button type="button" class="speaker" @click="speak(question.ch, question.pinyin)">🔊</button>
				<p class="ask">听发音，选出正确的字</p>
				<div class="options">
					<button
						v-for="opt in question.options"
						:key="opt"
						type="button"
						class="opt char"
						:class="optionClass(opt)"
						:disabled="answered"
						@click="answer(opt)"
					>
						<span class="glyph">{{ opt }}</span>
					</button>
				</div>

				<p v-if="answered" class="feedback" :class="lastCorrect ? 'good' : 'bad'">
					{{ lastCorrect ? '答对啦！' : `正确答案：${question.ch} ${question.pinyin}` }}
				</p>
			</template>
		</div>

		<!-- 结束页 -->
		<div v-else-if="phase === 'done'" class="center">
			<div class="big-emoji">{{ endedEarly ? '🌈' : correctCount >= askedCount * 0.8 ? '🏆' : '💪' }}</div>
			<h1 v-if="endedEarly">今天先到这里</h1>
			<h1 v-else-if="practiceMode">练习结束</h1>
			<h1 v-else>本轮完成！</h1>
			<p v-if="endedEarly" class="hint">休息一下，这几个字明天会更熟悉，你已经很棒了！</p>
			<p v-else-if="askedCount > 0" class="score">答对 {{ correctCount }} / {{ askedCount }} 题</p>
			<div class="done-actions">
				<button type="button" class="btn" @click="loadDue">再来一轮</button>
				<RouterLink to="/" class="btn ghost">回首页</RouterLink>
			</div>
		</div>
	</div>
</template>

<style scoped>
.page {
	max-width: 620px;
	margin: 0 auto;
	padding: 16px 16px 60px;
}
.top {
	display: flex;
	justify-content: space-between;
	align-items: center;
	min-height: 36px;
}
.back {
	font-size: 15px;
	text-decoration: none;
}
.progress {
	font-size: 14px;
	color: #9a8a70;
}
.center {
	text-align: center;
	padding-top: 8vh;
}
.big-emoji {
	font-size: 72px;
	margin-bottom: 8px;
}
h1 {
	font-size: 26px;
	color: var(--accent);
	margin: 8px 0 24px;
}
.btn.xl {
	min-height: 64px;
	padding: 12px 40px;
	font-size: 22px;
	border-radius: 18px;
}
.quiz {
	text-align: center;
	padding-top: 4vh;
}
.speaker {
	font-size: 56px;
	background: #fff;
	border: 3px solid var(--accent);
	border-radius: 50%;
	width: 120px;
	height: 120px;
	cursor: pointer;
}
.speaker:active {
	background: #ffe9d6;
}
.ask {
	color: #9a8a70;
	font-size: 16px;
	margin: 16px 0 20px;
}
.options {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
	max-width: 380px;
	margin: 0 auto;
}
/* 田字格：正方形格子 + 虚线十字辅助线 */
.opt.char {
	position: relative;
	aspect-ratio: 1;
	border: 3px solid #e0b98c;
	border-radius: 12px;
	background: #fff;
	cursor: pointer;
	color: var(--ink);
	font-size: clamp(56px, 18vw, 96px);
	line-height: 1;
	font-family: 'Kaiti SC', 'STKaiti', KaiTi, serif;
}
.opt.char::before,
.opt.char::after {
	content: '';
	position: absolute;
	pointer-events: none;
}
.opt.char::before {
	left: 5%;
	right: 5%;
	top: 50%;
	border-top: 2px dashed #f0d9bd;
}
.opt.char::after {
	top: 5%;
	bottom: 5%;
	left: 50%;
	border-left: 2px dashed #f0d9bd;
}
.opt.char .glyph {
	position: relative;
	z-index: 1;
}
.opt:disabled {
	cursor: default;
}
.opt.right {
	background: #dcedd5;
	border-color: #5c9e4c;
}
.opt.wrong {
	background: #f7d9d4;
	border-color: var(--danger);
}
.opt.dim {
	opacity: 0.45;
}
.feedback {
	margin-top: 22px;
	font-size: 20px;
	font-weight: 600;
}
.feedback.good {
	color: #35682d;
}
.feedback.bad {
	color: var(--danger);
}
.score {
	font-size: 22px;
	margin-bottom: 24px;
}
.done-actions {
	display: flex;
	gap: 12px;
	justify-content: center;
	margin-top: 20px;
}
.hint {
	color: #9a8a70;
}
</style>
