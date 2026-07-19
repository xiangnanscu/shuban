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
	border-radius: var(--r-md);
	overflow: hidden;
	background: #fff;
}
.seg {
	border: 0;
	background: transparent;
	padding: 8px 16px;
	font-size: 15px;
	font-weight: 600;
	color: var(--accent);
	cursor: pointer;
	transition: background-color 0.15s ease;
}
.seg + .seg {
	border-left: 1px solid var(--accent-soft);
}
.seg.active {
	background: var(--accent);
	color: #fff;
}
</style>
