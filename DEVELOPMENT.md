# 「书伴」开发文档

> 纸质书伴读应用 · 部署于 Cloudflare Workers · v1.0（2026-07-11）
>
> 本文档是完整的开发规格，目标读者是后续实施开发的工程师（或 AI 编码助手）。所有模型 ID、API 参数均已对照官方文档核实，可直接照此实现。

---

## 目录

1. [项目概述与目标](#1-项目概述与目标)
2. [用户角色与核心场景](#2-用户角色与核心场景)
3. [功能需求详述](#3-功能需求详述)
4. [技术架构与选型理由](#4-技术架构与选型理由)
5. [数据模型](#5-数据模型)
6. [API 设计](#6-api-设计)
7. [OCR / 拼音识别设计](#7-ocr--拼音识别设计)
8. [前端设计](#8-前端设计)
9. [复习算法与测验设计](#9-复习算法与测验设计)
10. [安全与鉴权](#10-安全与鉴权)
11. [部署与运维](#11-部署与运维)
12. [开发里程碑](#12-开发里程碑)
13. [风险与备选方案](#13-风险与备选方案)
14. [端到端验证清单](#14-端到端验证清单)

---

## 1. 项目概述与目标

**问题**：一年级孩子每天要读老师指定的纸质书。遇到不认识的字只能先做标记，之后再问家长——中断阅读、依赖家长、无法沉淀复习。

**方案**：一个"给纸质书赋能"的 Web 应用。家长拍照上传绘本页面 → 系统识别出标题、正文和逐字拼音（排版与原书一致）→ 孩子在网页上对照纸书阅读，点击不认识的字立即听到发音，同时后台自动收集生字 → 系统按遗忘曲线安排复习测验 → 孩子还可以录下整篇朗读，导出 MP3 保存。

**设计原则**：

- **纸书是主体，应用是辅助**。网页排版忠实还原原书（换行、居中），孩子看纸书、点网页。
- **孩子端零门槛**：免登录、大字号、大按钮，一次点击完成"查字"。
- **家长端可控**：OCR 结果先进草稿，家长校对后发布；管理功能 PIN 保护。
- **单家庭自部署**：跑在 Cloudflare 免费/低价额度内，无多租户复杂度。

**非目标（v1 不做）**：多家庭注册、词语级点读（v1 只做单字）、离线 PWA（列为 M4 可选）、AI 语音评测打分。

---

## 2. 用户角色与核心场景

### 角色

| 角色 | 设备 | 权限 |
|---|---|---|
| 孩子（一年级） | 家长的手机 / 平板 / 电脑 | 阅读、点字、测验、录音（免登录） |
| 家长 | 手机（拍照）、电脑 | 全部 + 管理（PIN 登录） |

### 用户故事

**US-1 建文章**：家长在手机上打开 `/admin`，输入 PIN，拍摄或选择 1~N 张绘本图片上传。系统逐页 OCR，生成带拼音的草稿。家长在校对界面对照原图修正错字、错拼音，点"发布"。
**US-2 读文章**：孩子打开首页，看到大图卡片列表，点开今天要读的文章。屏幕上文字排版与纸书一致，每个汉字上方有拼音（可切换隐藏）。
**US-3 点字发音**：孩子读到不认识的"藏"字，用手指点它——立即发音"cáng"，该字轻微高亮动画。后台记录一次点击，"藏"进入生字池。
**US-4 录音**：孩子点"开始朗读"，读完整篇后点"完成"。系统生成 MP3，可直接保存到手机/电脑，也自动存档，供日后回放对比。
**US-5 复习**：第二天孩子打开首页，看到"今日复习 5 个字"角标。进入测验：听发音选汉字（自动判分）、看字读音（家长点"认识/不认识"）。答对的字复习间隔拉长，答错的重新开始。
**US-6 看报告**：家长在 `/stats` 查看连续打卡天数、生字池曲线、每个字的点击/答题历史，可打印生字表。

---

## 3. 功能需求详述

每项附验收标准（AC）。

### F1 文章创建（上传 + OCR）

- 支持拍照（`<input type="file" accept="image/*" capture="environment">`）和相册多选，单篇 1~20 张图。
- 客户端压缩：长边 ≤ 1568px、JPEG 质量 0.85 后再上传（控制 token 成本，见 §7.5；如识别不清可在校对页对单页触发"高清重识别"，用 2576px 原图重跑）。
- 上传后逐页调用 OCR Provider（§7），并发处理，返回结构化草稿。
- 失败可单页重试，不影响其他页。
- **AC**：上传 3 页共约 150 字的绘本，60 秒内得到草稿；正文识别准确率肉眼评估 ≥95%，拼音（含多音字）≥98%。

### F2 家长校对编辑器

- 左右分屏（窄屏上下）：原图 vs 可编辑的带拼音文本。
- 逐 token 编辑：改字、改拼音、删除、插入；行级操作：改对齐、合并/拆分行、增删空行。
- 标题单独编辑。保存为草稿，"发布"后孩子端可见。
- **AC**：修正一个错字 + 一个错拼音 + 一处对齐，全程 ≤1 分钟；发布后阅读页立即生效。

### F3 阅读页（排版还原 + 拼音标注）

- 按 `content_json` 渲染：每行独立、保留对齐（左/中/右）与空行；标题居中放大。
- 汉字用 `<ruby>` 标注拼音；标点、数字、拉丁字母不注音。
- 拼音显示三档切换（防拼音依赖）：**全显 / 点击显示（点字先出拼音再发音）/ 隐藏**。默认"全显"，档位记忆在 localStorage。
- 生字池中的字在正文中以淡黄色底纹微高亮（隐性复习，可在设置关闭）。
- 分页浏览（每张原图对应一页），可选查看原图对照。
- **AC**：原书居中的书名在网页居中；原书 4 行的诗在网页也是 4 行；切"隐藏"后拼音消失但布局不跳动（`<rt>` 占位用 `visibility:hidden` 而非 `display:none`）。

### F4 点字发音 + 生字收集

- 点击任意汉字：≤300ms 内开始发音（Web Speech API 本地合成，见 §8.3），字有 0.5s 高亮动画。
- 同时 `POST /api/taps`：记录字、文章、时间；该字首次点击时进入生字池（`review_items`，box=0，当天到期）。
- 连续快速点击不同字：中断上一个发音，播新的。
- 网络断开时发音仍可用（本地 TTS），点击记录进内存队列，恢复后补发。
- **AC**：点"藏"听到 cáng；数据库出现 tap 记录与 review_item；飞行模式下点字仍出声。

### F5 整句/整篇朗读（辅助）

- 每行行首长按或行尾小喇叭图标：朗读整行。
- 文章页"听全文"按钮：逐行朗读，当前行高亮跟随。
- **AC**：听全文过程中可暂停/继续。

### F6 录音模式 → MP3

- 阅读页进入"朗读模式"：大录音按钮，实时时长与音量指示。
- 采集用 `getUserMedia` + Web Audio（AudioWorklet 取 PCM），**前端 lamejs 实时编码 MP3**（无服务器转码）。
- 结束后：试听 → "保存到设备"（`<a download="日期-文章名.mp3">`）和/或"存档"（上传 R2，关联文章）。
- 录音历史页：按文章分组列出历史录音，可回放、下载、删除（删除需家长 PIN）。
- **AC**：录 60 秒得到可在微信/电脑正常播放的 MP3（44.1kHz、128kbps 单声道，约 1MB）；iOS Safari 与 Android Chrome 均可完成全流程。

### F7 复习与测验

- 首页角标显示今日到期字数（按 Asia/Shanghai 的"今天"）。
- 测验三模式（详见 §9）：听音选字（自动判分）、看字读音（家长判分）、看字选拼音（自动判分）。
- 每轮默认 ≤10 字；答题即时反馈（对：绿色+音效；错：显示正确答案并发音）。
- Leitner 盒调度：对→升级拉长间隔，错→归零。
- **AC**：昨天点过的字今天出现在到期列表；连对六次后该字标记"毕业"，不再默认出现（仍可手动抽查）。

### F8 打卡统计与报告

- 阅读会话记录（进入阅读页开始、离开结束）。
- `/stats`：连续打卡天数、累计阅读篇数、生字池规模曲线（新增/毕业）、最常点击 Top 字、每字详情（点击次数、答题记录）。
- 生字表打印视图：按拼音排序的"字 + 拼音"表格，`@media print` 样式，供听写用。
- **AC**：打印预览为干净的黑白表格，无导航栏。

---

## 4. 技术架构与选型理由

### 4.1 总览

```
                    ┌─────────────────────────────────────────────┐
                    │              Cloudflare Worker               │
  手机/平板/电脑      │  ┌───────────────┐   ┌────────────────────┐ │
 ┌─────────────┐    │  │ Static Assets  │   │   Hono API (/api)  │ │
 │  Vue 3 SPA  │◄───┼──│  (Vue build)   │   │  auth / articles   │ │
 │  Web Speech │    │  └───────────────┘   │  taps / review     │ │
 │  MediaRec + │────┼──────────────────────►│  quiz / recordings │ │
 │  lamejs MP3 │    │                       │  stats / tts / ocr │ │
 └─────────────┘    │                       └───┬────┬────┬─────┘ │
                    └───────────────────────────┼────┼────┼───────┘
                                                │    │    │
                                          ┌─────▼┐ ┌─▼──┐ ┌▼─────────────┐
                                          │  D1  │ │ R2 │ │ OCR Provider │
                                          │(SQL) │ │    │ │ Claude API / │
                                          └──────┘ └────┘ │ Workers AI   │
                                                          └──────────────┘
```

单 Worker 全栈：一个 Worker 同时提供 API（Hono 路由）和静态资源（Workers Static Assets，SPA 回退模式）。

### 4.2 选型与理由

| 层 | 选型 | 理由 |
|---|---|---|
| 计算 | Cloudflare Workers + **Hono** | 免运维、免费额度充裕（10 万请求/天）；Hono 是 Workers 生态事实标准路由器，中间件齐全 |
| 前端 | **Vue 3 + Vite + vue-router** | 用户选定；配合官方 `@cloudflare/vite-plugin`，`vite dev` 即可在本地同时跑 Worker 与前端热更新 |
| 数据库 | **D1**（SQLite） | 关系查询（到期复习、统计聚合）天然适合 SQL；免费 5GB 远超需求 |
| 对象存储 | **R2** | 原图、录音 MP3、TTS 缓存；免费 10GB，无出站流量费 |
| OCR/拼音 | **引擎优先级链（2026-07-11 起）：Gemini `gemini-flash-latest`（默认）→ Workers AI `@cf/moonshotai/kimi-k2.6` → Claude `claude-opus-4-8`**，前者失败自动降级 | 见 §7；`OCR_PROVIDER` 为逗号分隔链，缺 key 的引擎自动跳过 |
| 点字发音 | **浏览器 Web Speech API**（主）+ **Workers AI `@cf/myshell-ai/melotts`**（服务端兜底，R2 缓存） | 本地合成零成本、零延迟、离线可用；兜底覆盖无中文语音包的设备 |
| 录音→MP3 | **MediaDevices + AudioWorklet + lamejs**（纯前端） | Worker 无法跑 ffmpeg；lamejs 是成熟的纯 JS MP3 编码器，60s 音频手机端编码 <2s |
| 鉴权 | 家长 PIN（PBKDF2 哈希）→ HMAC 签名 Cookie | 单家庭最简方案，无第三方登录依赖 |

### 4.3 项目结构

```
char/
├─ package.json
├─ wrangler.jsonc
├─ vite.config.ts              # @cloudflare/vite-plugin + vue
├─ migrations/
│  └─ 0001_init.sql
├─ server/                     # Worker 侧
│  ├─ index.ts                 # Hono app 入口，/api/* + assets 回退
│  ├─ routes/
│  │  ├─ auth.ts  articles.ts  taps.ts  review.ts
│  │  ├─ quiz.ts  recordings.ts  stats.ts  tts.ts  admin.ts
│  ├─ ocr/
│  │  ├─ types.ts              # OcrProvider 接口 + PageContent 类型
│  │  ├─ claude.ts             # Claude 实现
│  │  ├─ workersai.ts          # Kimi K2.6 实现
│  │  └─ index.ts              # 按 env.OCR_PROVIDER 选择
│  └─ lib/
│     ├─ auth.ts               # PIN 哈希、cookie 签名/校验、admin 中间件
│     ├─ leitner.ts            # 盒间隔、升降级
│     ├─ time.ts               # Asia/Shanghai "今天" 计算
│     └─ db.ts                 # 类型化查询助手
├─ src/                        # Vue 侧
│  ├─ main.ts  App.vue  router.ts
│  ├─ pages/
│  │  ├─ Home.vue  Read.vue  Quiz.vue  Stats.vue
│  │  └─ admin/  Login.vue  Upload.vue  Proofread.vue  Manage.vue  Recordings.vue  Settings.vue
│  ├─ components/
│  │  ├─ RubyLine.vue          # 一行 tokens → ruby 渲染 + 点字事件
│  │  ├─ PinyinToggle.vue  Recorder.vue  QuizCard.vue  StreakBadge.vue
│  ├─ composables/
│  │  ├─ useTts.ts  useRecorder.ts  useApi.ts  useTapQueue.ts
│  └─ styles/  base.css  print.css
└─ test/                       # vitest（leitner、auth、ocr schema 校验）
```

脚手架：`npm create cloudflare@latest -- --framework=vue` 生成 Vue + Workers + vite-plugin 基础，再按上表调整。

---

## 5. 数据模型

### 5.1 D1 建表 SQL（`migrations/0001_init.sql`）

```sql
-- 文章
CREATE TABLE articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  cover_key    TEXT,                                  -- R2 key，取第 1 页图
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- 页（一张上传图片 = 一页）
CREATE TABLE pages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  page_no      INTEGER NOT NULL,
  image_key      TEXT NOT NULL,                       -- R2 key
  image_version  INTEGER NOT NULL DEFAULT 1,           -- 替换/旋转原图后自增，用于给 /api/files 的 immutable 缓存加 ?v= 破缓存
  ocr_status   TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  content_json TEXT NOT NULL DEFAULT '{"lines":[]}',
  UNIQUE (article_id, page_no)
);

-- 出现过的生字（点击即入库）
CREATE TABLE chars (
  ch            TEXT PRIMARY KEY,                     -- 单个汉字
  pinyin        TEXT NOT NULL DEFAULT '',             -- 默认读音（来自点击时上下文）
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_taps    INTEGER NOT NULL DEFAULT 0
);

-- 点击流水
CREATE TABLE tap_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ch         TEXT NOT NULL,
  article_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tap_events_ch   ON tap_events(ch);
CREATE INDEX idx_tap_events_time ON tap_events(created_at);

-- 复习计划（Leitner）
CREATE TABLE review_items (
  ch            TEXT PRIMARY KEY REFERENCES chars(ch),
  box           INTEGER NOT NULL DEFAULT 0,           -- 0..6
  due_at        TEXT NOT NULL,                        -- UTC ISO
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count   INTEGER NOT NULL DEFAULT 0,
  graduated     INTEGER NOT NULL DEFAULT 0,           -- 1=毕业
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_review_due ON review_items(graduated, due_at);

-- 测验答题流水
CREATE TABLE quiz_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ch          TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('listen_pick','read_aloud','pick_pinyin')),
  correct     INTEGER NOT NULL,                       -- 0/1
  answered_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 录音存档
CREATE TABLE recordings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  r2_key       TEXT NOT NULL,
  duration_sec REAL,
  size_bytes   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 阅读会话（打卡统计）
CREATE TABLE reading_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at   TEXT
);

-- 键值设置（PIN 哈希、开关）
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

时间一律存 UTC ISO 字符串；"今天/到期"判断在 `lib/time.ts` 中按 `Asia/Shanghai` 换算（`Intl.DateTimeFormat` 即可，无需依赖库）。

### 5.2 `content_json` 结构（页内容）

```jsonc
{
  "lines": [
    { "align": "center", "tokens": [ { "t": "小", "p": "xiǎo" }, { "t": "马", "p": "mǎ" }, { "t": "过", "p": "guò" }, { "t": "河", "p": "hé" } ] },
    { "align": "left", "tokens": [] },                    // 空行 = 段落间距
    { "align": "left",
      "tokens": [
        { "t": "马", "p": "mǎ" }, { "t": "棚", "p": "péng" }, { "t": "里", "p": "li" },
        { "t": "住", "p": "zhù" }, { "t": "着", "p": "zhe" }, { "t": "，" }
      ] }
  ]
}
```

规则：

- 每个 **token 恰好一个字符**（或一段连续的非汉字串，如 `"2026"`、`"…"`）。
- 汉字 token 必有 `p`（拼音，带调号 Unicode，如 `xiǎo`；轻声不带调，如 `zhe`、`li`）；标点/数字/拉丁 token 无 `p`。
- `align ∈ left | center | right`。缩进（首行空两格）由渲染层统一处理：正文行首自动 `text-indent: 2em`，诗歌/居中行不缩进——OCR 不需要输出缩进信息，减少误差。
- 标题不放在 lines 里，存 `articles.title`（渲染层单独展示）。

---

## 6. API 设计

Base：同域 `/api`。响应统一 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`。

### 6.1 公开端点（孩子端，免登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/articles` | 已发布文章列表：`[{id,title,coverUrl,pageCount,createdAt}]` |
| GET | `/api/articles/:id` | 文章详情，含全部 pages 的 `content_json`（草稿仅家长会话可见） |
| GET | `/api/files/:key` | R2 文件代理（图片/录音/TTS 缓存），带 `Cache-Control` |
| POST | `/api/taps` | `{ch, articleId}` → 记流水、`chars` upsert、首次点击建 `review_items(box=0, due=今晚)` |
| GET | `/api/review/due` | 今日到期字：`[{ch, pinyin, box}]`（`graduated=0 AND due_at<=now`） |
| GET | `/api/quiz/next?mode=listen_pick` | 服务端出一题（含干扰项，见 §9.3） |
| POST | `/api/quiz/answer` | `{ch, mode, correct}` → 记流水 + Leitner 升降级 |
| POST | `/api/sessions/start` | `{articleId}` → `{sessionId}` |
| POST | `/api/sessions/end` | `{sessionId}` |
| GET | `/api/tts/:ch` | 服务端 TTS 兜底：R2 有缓存直接回 MP3，否则调 MeloTTS 生成→存 R2→回 |
| POST | `/api/recordings` | multipart：`file`(mp3) + `articleId` + `durationSec` → 存 R2 + 建记录 |
| GET | `/api/recordings?articleId=` | 录音列表 |
| GET | `/api/stats/summary` | 打卡天数、生字池计数、今日到期数（首页角标复用） |

> 单家庭部署，点字/答题/录音上传视为孩子的正常使用，不设登录门槛；破坏性操作全部收进 admin。

### 6.2 家长端点（`/api/admin/*` + `/api/auth/*`，PIN 会话）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{pin}` → 校验 PBKDF2 哈希 → `Set-Cookie: session=<HMAC签名, 7天>` |
| POST | `/api/auth/logout` | 清 cookie |
| POST | `/api/admin/articles` | multipart：`images[]`（已压缩 JPEG）→ 建 draft 文章 + pages（存 R2）→ **逐页异步触发 OCR** → 返回 `{articleId}`；前端轮询 `GET /api/articles/:id` 看 `ocr_status` |
| POST | `/api/admin/pages/:id/ocr` | 重跑单页 OCR；`?hires=1` 用原图重跑 |
| POST | `/api/admin/pages/:id/image` | multipart：`image`（替换原图，如校对时修正拍歪/拍倒）→ 覆盖 R2 对象、`image_version+1`、`ocr_status='pending'` 并自动重新识别 |
| PUT | `/api/admin/articles/:id` | 更新 `title` / `status` / 各页 `content_json`（校对保存） |
| DELETE | `/api/admin/articles/:id` | 级联删 pages + R2 图片 |
| DELETE | `/api/admin/recordings/:id` | 删录音 |
| DELETE | `/api/admin/review/:ch` | 从生字池移除（误点清理） |
| PUT | `/api/admin/settings` | 改 PIN、开关（如生字高亮） |
| GET | `/api/admin/stats/chars` | 每字详情列表（点击数、答题正误、box） |

**OCR 的执行位置**：在 `POST /api/admin/articles` 的 handler 里对每页 `ctx.waitUntil(runOcr(page))` 异步执行，页面状态由 `pages.ocr_status` 驱动。Claude 单页调用通常 <30s，在 Worker 的 fetch 时限内（有 waitUntil 兜底）；无需 Queues。

---

## 7. OCR / 拼音识别设计

### 7.1 Provider 抽象

```ts
// server/ocr/types.ts
export interface PageContent {
  title: string | null;          // 仅第 1 页可能返回
  lines: { align: 'left'|'center'|'right';
           tokens: { t: string; p?: string }[] }[];
}
export interface OcrProvider {
  recognize(imageBytes: ArrayBuffer, opts: { isFirstPage: boolean }): Promise<PageContent>;
}
// server/ocr/index.ts — 按 env.OCR_PROVIDER（逗号分隔优先级链，如 "gemini,workersai,claude"）返回实现列表
```

两个实现共用同一 JSON Schema 与提示词，返回后统一走 `validatePageContent()`（手写校验：token 单字、汉字必有 p、align 枚举），不合法则该页标 `failed` 供重试。

### 7.2 默认实现：Claude API

- 模型：`claude-opus-4-8`（环境变量 `OCR_MODEL` 可换）。
- Worker 内用 `@anthropic-ai/sdk`（基于 fetch，Workers 兼容），密钥 `ANTHROPIC_API_KEY` 走 secret。
- **结构化输出**用 `output_config.format`（json_schema），保证返回严格合法 JSON，免去手动解析容错。

```ts
// server/ocr/claude.ts（核心调用）
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const response = await client.messages.create({
  model: env.OCR_MODEL,               // claude-opus-4-8
  max_tokens: 16000,
  system: OCR_SYSTEM_PROMPT,          // 见 7.4
  output_config: { format: { type: 'json_schema', schema: PAGE_SCHEMA } },
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: opts.isFirstPage
          ? '识别这一页。这是第一页，如页面上有书名/标题，填入 title；正文放 lines。'
          : '识别这一页正文，title 置为 null。' },
    ],
  }],
});
const text = response.content.find(b => b.type === 'text')!.text;
return JSON.parse(text) as PageContent;
```

注意事项（对照当前 API 规范）：

- `claude-opus-4-8` 不接受 `temperature/top_p/top_k`（传了直接 400），不要加。
- 非流式 `max_tokens: 16000` 以内安全；单页输出通常 <5k tokens。
- 解析一律 `JSON.parse`，不要对返回串做正则匹配。
- 若 `stop_reason === 'max_tokens'`（超长页面），把该页标 `failed`，提示家长拆两张图重拍。

### 7.3 JSON Schema（`PAGE_SCHEMA`）

结构化输出限制：所有 object 必须 `additionalProperties: false`；不支持 `minLength/maxLength` 等约束（长度规则放提示词 + 服务端校验）。

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "lines"],
  "properties": {
    "title": { "anyOf": [ { "type": "string" }, { "type": "null" } ] },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["align", "tokens"],
        "properties": {
          "align": { "type": "string", "enum": ["left", "center", "right"] },
          "tokens": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["t"],
              "properties": {
                "t": { "type": "string" },
                "p": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

### 7.4 提示词（`OCR_SYSTEM_PROMPT` 全文）

```
你是一个中文绘本 OCR 与注音引擎。输入是一张儿童绘本/课文的照片，输出该页的结构化文本。

规则：
1. 逐字输出：每个汉字是一个 token；连续的标点、数字、拉丁字母各自合并为一个 token。
2. 拼音：每个汉字 token 必须有 p 字段，使用带 Unicode 声调符号的小写拼音（如 xiǎo、lǜ）。
   - 如果图片中该字印有注音，以图片注音为准。
   - 如果图片没有注音，根据词语和句子语境推断正确读音，特别注意多音字
     （如"长大 zhǎng / 长江 cháng"、"觉得 jué / 睡觉 jiào"、"了 le/liǎo"）。
   - 轻声不标调（如 zhe、de、ma、li）；"一""不"按实际变调前的原调标注（yī、bù），变调由朗读引擎处理。
   - 儿化词尾"儿"单独成 token，注 er。
3. 排版：忠实还原换行——图片中的一行就是输出的一行；行的水平位置决定 align
   （明显居中的标题/诗句为 center，正常段落为 left）。段落之间的空行输出为 tokens 为空的行。
   不要自行断句或合并行。
4. 只识别文章本身：标题 + 正文，其余一律忽略。绘本/课文页面常见的配套辅助区域都不是正文，包括但不限于：
   - 导读、阅读提示、亲子/教师建议、评注、批注、赏析、旁白说明
   - 思考题、问答、练习，以及"读一读""想一想""说一说"之类的栏目框
   - 生字表、词语表、笔顺示范、页边注释、知识小贴士
   - 页码、页眉页脚、出版信息、插图内文字（如商店招牌）、水印
   判断标准：正文是版面的主体——字号最大、连续成篇的那部分文字；与正文字号或排版明显不同的小字块、边栏、色块/边框圈起来的文字，都是辅助区域。
   拿不准时宁可少收：把辅助文字混进正文比漏掉一句更糟（漏的家长校对时能补）。
5. 标题：仅当明确要求且页面存在书名/篇名时填 title（不含注音），并且不要把标题重复放进 lines。
6. 图片模糊无法辨认的字：按上下文给出最可能的字，不要输出占位符。
```

### 7.5 成本估算（Claude 默认路径）

图片 token ≈ 宽×高/750：1568px 长边的绘本页约 1,200~1,600 tokens；输出侧每个汉字 token 约 10~12 tokens JSON。

以典型绘本一篇 3 页、共 150 字计：

| 项 | 量 | 单价（opus-4-8） | 费用 |
|---|---|---|---|
| 输入（3 图 + 提示词 ≈ 6k tokens） | 6k | $5 / M | $0.03 |
| 输出（结构化 JSON ≈ 2.5k tokens） | 2.5k | $25 / M | $0.06 |
| **合计** | | | **≈ $0.09 ≈ ¥0.65 / 篇** |

每天一篇 → 每月约 ¥20。字多的课文（500 字+）单篇可到 ¥1.5~2。高清重识别（2576px，约 4,800 tokens/图）仅在需要时手动触发。

### 7.6 引擎链（2026-07-11 实现，取代单引擎切换）

`OCR_PROVIDER` 是逗号分隔的优先级链，默认 `"gemini,workersai,claude"`：按序尝试，构造期缺 key 的引擎跳过（告警日志），识别失败自动降级到下一个；全部失败该页才标 `failed`。

`OCR_TIMEOUT_MS`（默认 `30000`，即 30s）是单个 provider 一次识别尝试的硬超时：用 `AbortController` + `Promise.race` 兜底，即使底层请求（网络挂起、上游长时间不响应等）永不返回，也保证超时后判定该 provider 失败并降级到下一个，避免 `ocr_status` 永久卡在 `pending`。需要更宽松/更严格的超时时可在 `wrangler.jsonc` 的 `vars` 里调整。

**① Gemini（默认首选）——`gemini-flash-latest`**

- Google Generative Language REST API `models/{model}:generateContent`，`x-goog-api-key` 头；key 走 secret `GEMINI_API_KEY`。
- 结构化输出用 `generationConfig.responseMimeType: 'application/json'` + `responseSchema`。注意 **responseSchema 是 OpenAPI 子集**（`type: 'OBJECT'` 枚举 + `nullable: true`），不是标准 JSON Schema——schema 在 `server/ocr/gemini.ts` 内单独维护。
- `temperature: 0`、`maxOutputTokens: 16384`；处理 `promptFeedback.blockReason` 与 `finishReason: MAX_TOKENS`。
- 中文 OCR 与多音字能力强、速度快、成本低（flash 档），是家长日常使用的主路径。

**② Workers AI（免额外 key 的兜底）——`@cf/moonshotai/kimi-k2.6`**

- OpenAI 风格请求：`messages[].content` 数组传 `{type:'image_url', image_url:{url:'data:image/jpeg;base64,…', detail:'high'}}`；`response_format: {type:'json_schema', json_schema:{name, schema, strict:true}}`（直接复用 PAGE_SCHEMA）。
- **必须 `reasoning_effort: 'low'`**——OCR 是转写任务，默认推理档会慢到超时（本地 dev 远程代理直接 504）；low 档实测可用。
- $0.95/M 输入、$4/M 输出；质量预期低于 Gemini/Claude，靠校对编辑器兜底。

**③ Claude（最后备选）——`claude-opus-4-8`**

- 即原 §7.2 实现，需 `ANTHROPIC_API_KEY`。质量最高、成本也最高，适合作为链尾对付前两家都识别失败的疑难页。

模型均可换：vars `GEMINI_MODEL` / `WORKERSAI_MODEL` / `CLAUDE_MODEL`。

---

## 8. 前端设计

### 8.1 页面与路由

| 路由 | 页面 | 要点 |
|---|---|---|
| `/` | Home | 大封面卡片网格；顶部"今日复习 N 字"角标（点击进 `/quiz`）；连续打卡火苗 |
| `/read/:id` | Read | 核心阅读页：拼音三档切换、点字发音、页码切换、朗读模式入口、听全文 |
| `/quiz` | Quiz | 每轮 ≤10 题；三模式；结束页展示本轮成绩 |
| `/stats` | Stats | 打卡、曲线、Top 字；"打印生字表"按钮 |
| `/admin` | 家长区 | PIN 登录后：上传、校对、文章管理、录音管理、设置 |

路由守卫：`/admin/*` 无有效会话跳 `/admin/login`（会话有效性由任一 admin API 401 触发跳转即可，无需前端解析 cookie）。

### 8.2 拼音渲染（`RubyLine.vue`）

```html
<p :class="['line', line.align, { indent: needIndent }]">
  <template v-for="tk in line.tokens">
    <ruby v-if="tk.p" class="han" :class="{ known: inPool(tk.t) }" @pointerdown="tap(tk)">
      {{ tk.t }}<rt v-show="pinyinMode !== 'hidden'">{{ tk.p }}</rt>
    </ruby>
    <span v-else class="punct">{{ tk.t }}</span>
  </template>
</p>
```

- 关键 CSS：`ruby { ruby-align: center }`；隐藏档用 `rt { visibility: hidden }` 保持行高不跳；字号 `clamp(28px, 6vw, 44px)`，行距 2.2（给 rt 留空间）；点击热区最小 44×44px。
- "点击显示"档：`tap()` 先把该字 `rt` 置为可见 1.5s，再发音。
- 生字池高亮：`known` 类 → 淡黄底纹（设置可关）。

### 8.3 TTS（`useTts.ts`）

```
speak(text):
  1) speechSynthesis 可用且已选到 zh voice → SpeechSynthesisUtterance(text, lang='zh-CN', rate=0.8)
  2) 否则 → new Audio(`/api/tts/${encodeURIComponent(text)}`)   // 单字兜底
```

- 语音表异步加载：监听 `voiceschanged`，优先选 `lang.startsWith('zh')` 的本地语音（iOS 为 Ting-Ting/婷婷，Android 为 Google 普通话）。
- iOS 要求用户手势内触发——点字本身就是手势，满足；但"听全文"的逐行链式播放需在首次点击时先 `speak('')` 解锁。
- 整句朗读传整行文本（引擎自带变调，"一、不"读音正确）。
- 服务端兜底 `/api/tts/:ch`：R2 键 `tts/{ch}.mp3`；未命中时 `env.AI.run('@cf/myshell-ai/melotts', { prompt: ch, lang: 'zh' })` → base64 解码 → 存 R2 → 返回。**MeloTTS 的 `lang:'zh'` 支持需在 M1 实测**（官方文档只举例 en/fr，上游 MeloTTS 支持中文）；若不可用，兜底降级为提示"请安装中文语音"并仅依赖 Web Speech（见 §13）。

### 8.4 录音（`useRecorder.ts` + `Recorder.vue`）

```
getUserMedia({ audio: { echoCancellation:false, noiseSuppression:true } })
  → AudioContext(44100) → MediaStreamSource → AudioWorkletNode('pcm-capture')
  → worklet 把 Float32 PCM 分块 postMessage 回主线程
  → lamejs Mp3Encoder(1, 44100, 128) 实时 encodeBuffer()
  → stop 时 flush() → Blob(['audio/mpeg'])
```

- 依赖 `@breezystack/lamejs`（lamejs 的维护版，修复了原库的打包问题）。
- 保存到设备：`URL.createObjectURL(blob)` + `<a download="2026-07-11-小马过河.mp3">`；iOS Safari 会走"共享/存储到文件"面板，属预期行为，UI 上给一句提示。
- 存档：`FormData` POST `/api/recordings`；60s ≈ 1MB，直传即可。
- 录音中锁屏防误关：`navigator.wakeLock.request('screen')`（不支持则忽略）。

### 8.5 儿童 UI 规范

- 正文最小 28px；按钮最小 56px 高；主操作永远单击可达，无双击/长按依赖（整行朗读的长按有等价的小喇叭按钮）。
- 反馈即时且具象：点字有波纹动画 + 声音；答对有"叮"，答错温和无惩罚音。
- 阅读页除"返回、翻页、拼音档、朗读"外无其他导航，防误触进管理区（管理入口只在首页页脚小字）。
- 色彩：暖纸色背景（近似纸书），高对比深墨字色；避免纯白刺眼。

---

## 9. 复习算法与测验设计

### 9.1 Leitner 盒（`lib/leitner.ts`）

| box | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|---|
| 间隔 | 当天 | 1 天 | 2 天 | 4 天 | 7 天 | 15 天 | 30 天 |

- **入池**：某字首次被点击 → `box=0, due_at=当天 20:00（上海时区）`（当天晚上即可第一次巩固）。再次点击已毕业的字 → 重新入池 box=1。
- **答对**：`box = min(box+1, 6)`，`due_at = now + interval[box]`；在 box=6 答对 → `graduated=1`。
- **答错**：`box = 0`，`due_at = now + 10 分钟`（本轮内可再来一次）。
- 到期查询：`WHERE graduated=0 AND due_at <= now ORDER BY due_at LIMIT 10`。

### 9.2 三种测验模式

| 模式 | 题面 | 判分 | 说明 |
|---|---|---|---|
| `listen_pick` 听音选字 | 播放发音，四选一选汉字 | 自动 | 主力模式，孩子可独立完成 |
| `pick_pinyin` 看字选拼音 | 大字展示，四选一选拼音 | 自动 | 检验注音记忆 |
| `read_aloud` 看字读音 | 大字展示，孩子读出，显示"认识 / 不认识"两键 | 家长/自评 | 最接近真实识字，穿插出现 |

每轮混合出题（默认 listen_pick 60% / pick_pinyin 20% / read_aloud 20%，家长可在设置调整或关闭 read_aloud）。

### 9.3 干扰项生成（服务端 `GET /api/quiz/next`）

1. 优先从生字池取同拼音声母或同韵母的字（易混）；
2. 不足时从池内随机补；
3. 仍不足（池 <4 字）时从内置的一年级常用字表（约 300 字的静态数组，随代码打包）补齐；
4. 干扰项拼音去重（听音选字模式下，四个选项读音必须互不相同）。

### 9.4 防挫败机制

- 每轮上限 10 题；错题在轮末重测一次（不额外计 Leitner 降级）。
- 连错 3 题自动结束本轮，给鼓励文案——避免低龄挫败。

---

## 10. 安全与鉴权

- **PIN**：6 位数字。存储：`PBKDF2(pin, salt, 100k 次, SHA-256)`（WebCrypto `deriveBits`），`settings` 表存 `pin_hash`、`pin_salt`。首次访问 `/admin` 无 PIN 记录时进入"设置 PIN"引导。
- **会话**：登录成功签发 cookie `session = base64(payload).base64(HMAC-SHA256(payload, SESSION_SECRET))`，payload 含 `exp`（7 天）。`HttpOnly; Secure; SameSite=Lax`。中间件校验签名与过期，失败 401。
- **登录限速**：D1 记录失败次数，5 次失败锁 15 分钟（防 PIN 爆破）。
- **上传约束**：图片 ≤8MB/张、仅 `image/jpeg|png|webp`；录音 ≤20MB、仅 `audio/mpeg`。R2 key 服务端生成（`img/{articleId}/{pageNo}.jpg`、`rec/{id}.mp3`），不接受客户端指定路径。
- **R2 代理**：所有文件经 `/api/files/:key` 读取，key 白名单前缀（`img/`、`rec/`、`tts/`）校验，不暴露桶。
- **密钥**：`ANTHROPIC_API_KEY`、`SESSION_SECRET` 仅存 Worker secret，前端永不接触。
- 公开端点（taps/quiz/recordings 上传）无鉴权是接受的取舍（单家庭、URL 不公开）；如需更严，可在 M4 给整站加一个"家庭口令"轻门槛或 Cloudflare Access。

---

## 11. 部署与运维

### 11.1 `wrangler.jsonc` 样例

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "shuban",
  "main": "server/index.ts",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./dist/client",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS"
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "shuban", "database_id": "<create 后填入>" }
  ],
  "r2_buckets": [
    { "binding": "BUCKET", "bucket_name": "shuban" }
  ],
  "ai": { "binding": "AI" },
  "vars": {
    "OCR_PROVIDER": "gemini,workersai,claude",
    "GEMINI_MODEL": "gemini-flash-latest",
    "WORKERSAI_MODEL": "@cf/moonshotai/kimi-k2.6",
    "CLAUDE_MODEL": "claude-opus-4-8",
    "OCR_TIMEOUT_MS": "30000"
  },
  "observability": { "enabled": true }
}
```

### 11.2 初始化步骤

```sh
npm create cloudflare@latest shuban -- --framework=vue   # 脚手架
cd shuban && npm i hono @anthropic-ai/sdk @breezystack/lamejs

npx wrangler d1 create shuban                            # 取 database_id 填入 wrangler.jsonc
npx wrangler d1 migrations apply shuban --local          # 本地建表
npx wrangler r2 bucket create shuban

npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SESSION_SECRET                   # openssl rand -hex 32

npm run dev                                              # vite + workers 本地联调
npx wrangler d1 migrations apply shuban --remote
npm run build && npx wrangler deploy                     # 上线，得到 https://shuban.<acct>.workers.dev
```

### 11.3 运行成本

| 项 | 用量（每日一篇 + 日常使用） | 费用 |
|---|---|---|
| Workers 请求 | << 10 万/天 | 免费 |
| D1 | 数据量 MB 级 | 免费（5GB 内） |
| R2 | 图片+录音，年增 ~2GB | 免费（10GB 内） |
| Claude OCR | ~30 篇/月 | ≈ ¥20/月（§7.5） |
| MeloTTS 兜底 | 单字缓存后趋近 0 | $0.0002/分钟，可忽略 |
| Web Speech / lamejs | 纯客户端 | 0 |

**总计 ≈ ¥20/月**，主要是 Claude OCR；切 Workers AI provider 可降到 ≈ ¥3/月。

### 11.4 备份

家长区提供"导出数据"：打包 D1 全表 JSON（生字/记录为主）下载；R2 图片可不备份（纸书在手可重拍）。cron 自动备份列为可选。

---

## 12. 开发里程碑

### M1 核心闭环（上传 → OCR → 校对 → 阅读 → 点字发音）⭐ 最优先 —— ✅ 已完成（2026-07-11）

> 实施记录：已部署 https://shuban.xnscu.workers.dev （D1 `shuban`、R2 `shuban`、SESSION_SECRET 已配）。
> 待办：`npx wrangler secret put ANTHROPIC_API_KEY`（配好后 OCR 即可用；本地开发填 `.dev.vars`）。
> 与文档的两处偏差：① MeloTTS 实测不可用（见 §13，已按备选降级）；② "高清重识别"暂未实现——M1 只存压缩图，识别不清的页删除后重拍即可。

- 脚手架 + D1/R2 + 鉴权（PIN 设置/登录/中间件）
- 上传压缩、R2 存储、Claude OCR provider + schema 校验
- 校对编辑器（token/行编辑、发布）
- 阅读页（ruby 渲染、排版还原、拼音三档、点字发音 Web Speech、tap 记录）
- **M1 验证项**：MeloTTS `lang:'zh'` 实测（决定 §8.3 兜底方案走向）
- 验收：US-1/2/3 全流程真机跑通（iOS Safari + Android Chrome）

### M2 复习与测验 —— ✅ 已完成（2026-07-12）

> 实施记录：Leitner 纯函数 `server/lib/leitner.ts`（vitest 覆盖，`npm test`）；干扰项生成 `server/lib/quiz-gen.ts` + 内置约 300 字常用字表 `server/lib/common-chars.ts`（拼音工具 `server/lib/pinyin.ts`）。
> API 新增：`GET /api/review/due`、`GET /api/quiz/next`（`?practice=1` 从全池随机抽，供毕业字手动抽查）、`POST /api/quiz/answer`（`practice: true` 只记流水不动 Leitner——轮末错题重测用）、`GET /api/admin/review`（生字池全量列表）。
> 前端新增：`/quiz` 测验页（每轮 ≤10 题、三模式混合、错题轮末重测、连错 3 题温和收场）、`/admin/pool` 生字池管理页、首页"今日复习 N 字"角标。
> 与文档的偏差：单测配置用独立 `vitest.config.ts`（`vite.config.ts` 里的 @cloudflare/vite-plugin 需要远程凭据，纯函数单测不必拉起）。

- Leitner 调度、到期查询、首页角标
- 三模式测验 + 干扰项生成 + 内置常用字表
- 家长生字池管理（移除误点）
- 验收：US-5 跑通；单元测试覆盖 leitner.ts

### M3 录音 + 统计 —— ✅ 已完成（2026-07-12）

> AudioWorklet+lamejs 录音（ScriptProcessor 降级、静音增益防啸叫、wakeLock）、MP3 下载/存档/历史回放（删除需 PIN）；
> 阅读会话（sendBeacon 收尾）、/stats 学习报告（打卡 streak 按上海时区、Top 字）、/print/chars 生字表打印视图。
> M2 由用户另行完成（quiz/next + practice 模式 + quiz-gen/pinyin/common-chars 库 + 18 个单测）。

- AudioWorklet + lamejs 录音、MP3 下载与存档、录音历史回放
- 阅读会话、打卡统计页、生字表打印视图
- 验收：US-4/6 跑通；两端真机录音兼容确认

### M4 打磨（可选项按需取舍）—— 大部分完成（2026-07-12）

- ~~Workers AI OCR 备选实现落地~~ ✅ 已提前实现（2026-07-11，连同 Gemini 默认引擎与优先级链，见 §7.6）
- ~~生字文中高亮~~ ✅（M1 已含）；~~听全文逐行跟随~~ ✅（暂停=记行重启，绕开 iOS pause/resume 不可靠）
- ~~PWA~~ ✅ 手写 sw.js：assets/图片缓存优先，文章类 API 网络优先离线回退；admin/auth/非 GET 不缓存
- ~~数据导出~~ ✅ `/api/admin/export`（8 表 JSON，含 attachment 头；不含 settings/PIN）
- 整站轻门槛：**未做**——与"孩子端零门槛"原则冲突，workers.dev 随机域名 + 管理侧 PIN 已够单家庭用；要做再说
- 多孩子档案：按原计划 v1 不实现
- 生字文中高亮、听全文逐行跟随
- PWA（离线读已缓存文章）、数据导出、整站轻门槛
- 多孩子档案（数据表加 `kid_id` 维度——schema 预留但 v1 不实现）

---

## 13. 风险与备选方案

| 风险 | 影响 | 缓解 |
|---|---|---|
| OCR 错字/错拼音 | 孩子学错 | 草稿→校对→发布的强制流程；结构化输出杜绝格式错误；单页高清重识别 |
| 多音字误判 | 拼音错误 | 提示词明确按语境判断 + 常见多音字示例；校对页对多音字（内置 ~120 字表）加黄点提示家长重点检查 |
| iOS Web Speech 限制（需手势、语音包缺失、系统静音开关） | 点字无声 | 点字即手势；检测 `getVoices()` 无 zh 时自动切 `/api/tts` 兜底并提示开媒体音量 |
| ~~MeloTTS 中文支持未证实~~ **M1 已实测（2026-07-11）：`@cf/myshell-ai/melotts` 对 en 和 zh 均返回 Workers AI `3043: Internal server error`，模型当前不可用** | 服务端兜底不可用 | 已按备选处理：`/api/tts` 保留（模型恢复即自动可用），失败返回 503，前端静默降级为仅 Web Speech。后续可选：预生成常用 3500 字音频包存 R2 |
| MediaRecorder/AudioWorklet 兼容性 | 录音失败 | 走 AudioWorklet+lamejs 主路径（iOS 14.5+ 支持）；不支持时降级 ScriptProcessorNode；再不支持则隐藏录音功能而非报错 |
| Worker 单请求时限内 OCR 超时 | 建文章失败 | 逐页独立请求 + `waitUntil` + 状态轮询 + 单页重试，互不影响 |
| Anthropic API 偶发失败/限流 | 草稿缺页 | 指数退避重试 2 次；仍失败标 `failed`，UI 一键重跑 |
| 拼音成为拐棍 | 识字效果打折 | 拼音三档切换 + 家长可设默认档 |
| workers.dev URL 被外人访问 | 数据泄露（低敏感） | 破坏性操作全在 PIN 后；可选整站轻门槛（M4） |

---

## 14. 端到端验证清单

上线前逐项人工验证（真机：iOS Safari + Android Chrome + 桌面 Chrome）：

**创建流**
- [ ] 手机拍 3 页绘本上传，每页 OCR 状态从 pending → done
- [ ] 有印刷注音的页：拼音与图一致；无注音的页：抽查 10 字拼音全对，含至少 1 个多音字
- [ ] 校对页改 1 字 1 拼音 1 对齐，发布后阅读页生效
- [ ] 故意传 1 张模糊图 → 该页 failed → 高清重跑成功

**阅读流**
- [ ] 排版对照：居中标题居中、行数与原书一致、段间空行保留
- [ ] 拼音三档切换正常，隐藏档行高不跳动
- [ ] 点字 ≤300ms 出声；连点 5 个字不串音；tap_events 入库；该字入生字池
- [ ] 飞行模式点字仍发音（Web Speech 本地）
- [ ] 无中文语音的设备走 `/api/tts` 兜底出声

**录音流**
- [ ] 录 60s → 下载 MP3 在微信和电脑可播 → 存档后历史页可回放
- [ ] 录音中来电/切后台，恢复后不崩（允许该次作废重录）

**复习流**
- [ ] 昨日点击的字今日出现在到期列表，首页角标数正确（上海时区跨天验证）
- [ ] 听音选字四个选项读音互异；答对 box+1、答错归 0（查库确认）
- [ ] box6 答对 → 毕业，不再出现在默认到期列表
- [ ] 生字池 <4 字时测验仍能出题（常用字表补位）

**家长/安全**
- [ ] 未登录访问 `/api/admin/*` 返回 401；错 PIN 5 次锁 15 分钟
- [ ] 改 PIN 后旧会话失效（payload 内嵌 pin 版本号）
- [ ] 生字表打印预览干净无导航

**成本/配额**
- [ ] 部署后 Cloudflare 面板确认请求/D1/R2 用量在免费档
- [ ] 一篇 OCR 的 Anthropic 用量与 §7.5 估算同数量级

---

*文档结束。实施时若 Cloudflare / Anthropic API 细节与本文有出入，以官方当日文档为准并回写本文。*
