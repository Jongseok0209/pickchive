-- 사이트(크롤링 대상 커뮤니티)
CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 크롤링해온 글
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id),
  source_post_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  recommend_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER,
  category TEXT,
  thumbnail_url TEXT,
  posted_at_raw TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, source_post_id)
);
CREATE INDEX idx_posts_first_seen_at ON posts(first_seen_at);
CREATE INDEX idx_posts_site_id ON posts(site_id);
CREATE INDEX idx_posts_ranking ON posts(first_seen_at, view_count, recommend_count);

-- 급상승 계산용 순위 스냅샷 (짧게 보관, 3일)
CREATE TABLE rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  crawled_at TEXT NOT NULL DEFAULT (datetime('now')),
  rank INTEGER NOT NULL,
  view_count INTEGER NOT NULL
);
CREATE INDEX idx_rank_snapshots_post_id ON rank_snapshots(post_id);
CREATE INDEX idx_rank_snapshots_crawled_at ON rank_snapshots(crawled_at);

-- 회원 (아이디+비밀번호만, 이메일/개인정보 없음)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 자체 댓글
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_comments_post_id ON comments(post_id);

-- 댓글 신고
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  reporter_user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_reports_comment_id ON reports(comment_id);
