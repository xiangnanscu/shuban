<script setup lang="ts">
import { ref } from 'vue';
import type { PageLine, PageToken, PinyinMode } from '@/types';

const props = defineProps<{
	line: PageLine;
	mode: PinyinMode;
	knownSet?: Set<string>;
	/** 重读计划要重点复习的字，比普通生字高亮更醒目 */
	focusSet?: Set<string>;
}>();

const emit = defineEmits<{ tap: [token: PageToken] }>();

const revealed = ref<number | null>(null);
const popped = ref<number | null>(null);

// 滑动翻页/滚动时手指按下的起点也会先触发 pointerdown，
// 所以真正的“点字”判定要等 pointerup，且要求位移和耗时都很小，
// 否则会把滑动误判成点字。
const TAP_MOVE_TOLERANCE = 10; // px
const TAP_MAX_DURATION = 400; // ms
let startX = 0;
let startY = 0;
let startT = 0;
let tracking = false;

function onPointerDown(e: PointerEvent) {
	tracking = true;
	startX = e.clientX;
	startY = e.clientY;
	startT = e.timeStamp;
}

function onPointerUp(e: PointerEvent, tok: PageToken, i: number) {
	if (!tracking) return;
	tracking = false;
	const dx = e.clientX - startX;
	const dy = e.clientY - startY;
	const dt = e.timeStamp - startT;
	if (Math.hypot(dx, dy) > TAP_MOVE_TOLERANCE || dt > TAP_MAX_DURATION) return;
	onTap(tok, i);
}

function onPointerCancel() {
	tracking = false;
}

function onTap(tok: PageToken, i: number) {
	if (tok.p === undefined) return;
	if (props.mode === 'tap') {
		revealed.value = i;
		setTimeout(() => {
			if (revealed.value === i) revealed.value = null;
		}, 1800);
	}
	popped.value = i;
	setTimeout(() => {
		if (popped.value === i) popped.value = null;
	}, 500);
	emit('tap', tok);
}
</script>

<template>
	<p v-if="line.tokens.length === 0" class="line blank">&nbsp;</p>
	<p v-else class="line" :class="line.align">
		<template v-for="(tok, i) in line.tokens" :key="i">
			<ruby
				v-if="tok.p !== undefined"
				class="han"
				:class="{ known: knownSet?.has(tok.t), focus: focusSet?.has(tok.t), pop: popped === i }"
				@pointerdown="onPointerDown"
				@pointerup="onPointerUp($event, tok, i)"
				@pointercancel="onPointerCancel"
				>{{ tok.t }}<rt :class="{ ghost: mode === 'hidden' || (mode === 'tap' && revealed !== i) }">{{
					tok.p || ' '
				}}</rt></ruby
			>
			<span v-else class="punct">{{ tok.t }}</span>
		</template>
	</p>
</template>

<style scoped>
.line {
	font-size: clamp(28px, 6vw, 46px);
	line-height: 2.3;
	margin: 0;
	color: var(--ink);
	touch-action: manipulation;
	user-select: none;
	-webkit-user-select: none;
}
.line.left {
	text-align: left;
}
.line.center {
	text-align: center;
}
.line.right {
	text-align: right;
}
.line.blank {
	line-height: 1;
	min-height: 0.8em;
}
ruby.han {
	ruby-align: center;
	cursor: pointer;
	border-radius: 8px;
	padding: 0 2px;
	transition: background-color 0.2s ease;
}
ruby.han.known {
	background: var(--gold-glow);
	box-shadow: 0 0 0 1px rgba(247, 199, 90, 0.55);
}
/* 重读计划的目标字：更醒目（在 known 之后，覆盖淡黄底纹） */
ruby.han.focus {
	background: var(--accent-soft);
	outline: 2px solid var(--accent);
}
ruby.han.pop {
	background: rgba(221, 90, 44, 0.28);
	animation: pop 0.4s ease-out;
}
@keyframes pop {
	0% {
		transform: scale(1);
	}
	40% {
		transform: scale(1.18);
	}
	100% {
		transform: scale(1);
	}
}
rt {
	font-size: 0.52em;
	color: var(--pinyin);
	letter-spacing: 0.02em;
	font-weight: 600;
}
rt.ghost {
	visibility: hidden; /* 占位不塌陷，切换档位不跳版 */
}
.punct {
	color: var(--ink);
}
</style>
