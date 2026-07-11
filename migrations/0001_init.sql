-- 文章
CREATE TABLE articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  cover_key    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);

-- 页（一张上传图片 = 一页）
CREATE TABLE pages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  page_no      INTEGER NOT NULL,
  image_key    TEXT NOT NULL,
  ocr_status   TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','done','failed')),
  content_json TEXT NOT NULL DEFAULT '{"lines":[]}',
  UNIQUE (article_id, page_no)
);

-- 出现过的生字（点击即入库）
CREATE TABLE chars (
  ch            TEXT PRIMARY KEY,
  pinyin        TEXT NOT NULL DEFAULT '',
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
  box           INTEGER NOT NULL DEFAULT 0,
  due_at        TEXT NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count   INTEGER NOT NULL DEFAULT 0,
  graduated     INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_review_due ON review_items(graduated, due_at);

-- 测验答题流水
CREATE TABLE quiz_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ch          TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('listen_pick','read_aloud','pick_pinyin')),
  correct     INTEGER NOT NULL,
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
