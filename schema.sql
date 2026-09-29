CREATE TABLE IF NOT EXISTS articles (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT,
  image        TEXT,
  source       TEXT NOT NULL,
  category     TEXT NOT NULL,
  raw_category TEXT,
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  day          TEXT NOT NULL,
  img_tried    INTEGER NOT NULL DEFAULT 0,
  -- 整理過的全文 HTML；content_status：0 未擷取、1 成功、2 失敗
  content        TEXT,
  content_status INTEGER NOT NULL DEFAULT 0,
  -- 上次擷取全文的時間（剛發布的快訊會再重抓，見 src/ingest.js needsRefresh）
  content_at     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat ON articles (category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_src ON articles (source, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_day ON articles (day, published_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    INTEGER NOT NULL,
  job   TEXT NOT NULL,
  stats TEXT
);
