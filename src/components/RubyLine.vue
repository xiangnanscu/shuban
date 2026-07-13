<script setup lang="ts">
import { ref } from 'vue';
import type { PageLine, PageToken, PinyinMode } from '@/types';

const props = defineProps<{
	line: PageLine;
	mode: PinyinMode;
	knownSet?: Set<string>;
}>();

const emit = defineEmits<{ tap: [token: PageToken] }>();

const revealed = ref<number | null>(null);
const popped = ref<number | null>(null);

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
				:class="{ known: knownSet?.has(tok.t), pop: popped === i }"
				@pointerdown.prevent="onTap(tok, i)"
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
	font-size: clamp(28px, 6vw, 44px);
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
	padding: 0 1px;
	transition: background-color 0.2s;
}
ruby.han.known {
	background: rgba(255, 214, 90, 0.35);
}
ruby.han.pop {
	background: rgba(255, 160, 60, 0.55);
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
	font-size: 0.55em;
	color: var(--pinyin, #8a6d3b);
	letter-spacing: 0.02em;
}
rt.ghost {
	visibility: hidden; /* 占位不塌陷，切换档位不跳版 */
}
.punct {
	color: var(--ink);
}
</style>
