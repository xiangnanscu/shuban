---
name: verify
description: 书伴（shuban）本地运行与验证配方 —— 构建 SPA 后用 wrangler dev 起全栈，curl 打 /api 路由观察真实行为。
---

# 书伴验证配方

## 构建 + 启动

```bash
npm run build                       # vite 构建 dist/client（wrangler assets 需要）
npx wrangler dev --port 8788 --local   # 全栈：静态资源 + Hono API，后台跑
```

- D1/R2 本地由 miniflare 模拟，首次为空。
- **AI binding 是 remote:true**：本地未登录 Cloudflare 时 `@cf/...` 调用报
  "Binding AI needs to be run remotely"——`/api/tts/:text`（MeloTTS 兜底）、OCR 在本地会 503，
  属环境限制，不是代码回归。
- 就绪探测：`curl -s -o /dev/null -w "%{http_code}" http://localhost:8788/api/syllable/ping`
  返回 404 即已就绪（ping 无此音节，路由正常工作）。

## 值得打的路由

- `GET /api/syllable/:pinyin` —— 带调拼音（URL 编码），200 返回 audio/mpeg；
  首次走 GitHub 源（~1s），二次走 R2 缓存（<10ms）。非法拼音 400，无录音 404。
- `GET /api/tts/:text` —— 本地 503（见上），线上才能真验。
- 阅读/测验页面需要已发布文章 + 会话，纯本地空库驱动不了 GUI 流程；
  客户端改动可 grep `dist/client/assets/*.js` 确认已进 bundle。

## 陷阱

- 结束后 `pkill -f "wrangler dev --port 8788"`，退出码 144/143 是被 kill，正常。
- 沙箱 shell 直连 raw.githubusercontent.com 偶尔挂起，curl 加 `--max-time`。
