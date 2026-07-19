<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError } from '@/composables/useApi';

const router = useRouter();
const route = useRoute();

const pinSet = ref<boolean | null>(null);
const pin = ref('');
const pin2 = ref('');
const msg = ref('');
const busy = ref(false);

onMounted(async () => {
	const s = await api<{ pinSet: boolean; authed: boolean }>('/api/auth/status');
	if (s.authed) return goNext();
	pinSet.value = s.pinSet;
});

function goNext() {
	const to = typeof route.query.to === 'string' ? route.query.to : '/admin';
	void router.replace(to);
}

async function submit() {
	msg.value = '';
	if (!/^\d{6}$/.test(pin.value)) {
		msg.value = 'PIN 需为 6 位数字';
		return;
	}
	if (pinSet.value === false && pin.value !== pin2.value) {
		msg.value = '两次输入不一致';
		return;
	}
	busy.value = true;
	try {
		await api(pinSet.value ? '/api/auth/login' : '/api/auth/setup', {
			method: 'POST',
			body: JSON.stringify({ pin: pin.value }),
		});
		goNext();
	} catch (e) {
		msg.value = e instanceof ApiError ? e.message : '请求失败';
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="wrap">
		<div class="card">
			<div class="emblem"><span class="tzg-mark" aria-hidden="true"></span></div>
			<h1>家长区</h1>
			<p v-if="pinSet === null" class="hint">加载中…</p>
			<form v-else @submit.prevent="submit">
				<p v-if="pinSet === false" class="hint">首次使用，请设置 6 位数字 PIN（用于保护管理功能）。</p>
				<input
					v-model="pin"
					type="password"
					inputmode="numeric"
					maxlength="6"
					autocomplete="off"
					:placeholder="pinSet ? '输入 PIN' : '设置 6 位 PIN'"
				/>
				<input
					v-if="pinSet === false"
					v-model="pin2"
					type="password"
					inputmode="numeric"
					maxlength="6"
					autocomplete="off"
					placeholder="再输一次"
				/>
				<button class="btn" type="submit" :disabled="busy">{{ pinSet ? '登录' : '设置并进入' }}</button>
				<p v-if="msg" class="err">{{ msg }}</p>
			</form>
		</div>
		<RouterLink to="/" class="back">‹ 回首页</RouterLink>
	</div>
</template>

<style scoped>
.wrap {
	max-width: 380px;
	margin: 12vh auto 0;
	padding: 0 20px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 20px;
}
.card {
	width: 100%;
	background: var(--card);
	border-radius: var(--r-xl);
	box-shadow: var(--shadow-lg);
	padding: 32px 28px;
	text-align: center;
}
.emblem {
	width: 48px;
	height: 48px;
	margin: 0 auto 14px;
	border-radius: 50%;
	background: var(--accent-soft);
	color: var(--accent);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
}
h1 {
	color: var(--accent);
	margin: 0 0 18px;
	font-size: 26px;
}
form {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
input {
	font-size: 24px;
	text-align: center;
	letter-spacing: 10px;
	padding: 12px;
}
.err {
	color: var(--danger);
	margin: 0;
}
.hint {
	color: var(--ink-soft);
	font-size: 14px;
	margin: 0 0 4px;
}
.back {
	font-size: 14px;
	color: var(--ink-faint);
	text-decoration: none;
}
.back:hover {
	color: var(--accent);
}

@media (min-width: 720px) {
	.wrap {
		margin-top: 16vh;
	}
	.card {
		padding: 40px 36px;
	}
}
</style>
