<script setup lang="ts">
import type { PinyinMode } from '@/types';

defineProps<{ modelValue: PinyinMode }>();
const emit = defineEmits<{ 'update:modelValue': [mode: PinyinMode] }>();

const options: { value: PinyinMode; label: string }[] = [
	{ value: 'show', label: '拼音' },
	{ value: 'tap', label: '点显' },
	{ value: 'hidden', label: '隐藏' },
];
</script>

<template>
	<div class="toggle" role="group" aria-label="拼音显示方式">
		<button
			v-for="opt in options"
			:key="opt.value"
			type="button"
			class="seg"
			:class="{ active: modelValue === opt.value }"
			@click="emit('update:modelValue', opt.value)"
		>
			{{ opt.label }}
		</button>
	</div>
</template>

<style scoped>
.toggle {
	display: inline-flex;
	border: 2px solid var(--accent);
	border-radius: 12px;
	overflow: hidden;
}
.seg {
	border: 0;
	background: transparent;
	padding: 8px 14px;
	font-size: 15px;
	color: var(--accent);
	cursor: pointer;
}
.seg.active {
	background: var(--accent);
	color: #fff;
}
</style>
