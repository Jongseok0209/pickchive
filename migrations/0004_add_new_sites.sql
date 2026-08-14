-- 0004_add_new_sites.sql
-- 신규 커뮤니티 사이트 추가 (오늘의유머, 딴지일보, 웃긴대학, 이토랜드, 엠팍, SLR클럽, 펨코, 다모앙, 루리웹 재등록)
INSERT OR IGNORE INTO sites (slug, name, base_url) VALUES
  ('todayhumor', '오늘의유머', 'https://www.todayhumor.co.kr'),
  ('ddanzi', '딴지일보', 'https://www.ddanzi.com'),
  ('humoruniv', '웃긴대학', 'http://web.humoruniv.com'),
  ('etoland', '이토랜드', 'https://www.etoland.co.kr'),
  ('mlbpark', '엠팍', 'https://mlbpark.donga.com'),
  ('slrclub', 'SLR클럽', 'https://www.slrclub.com'),
  ('fmkorea', '펨코', 'https://www.fmkorea.com'),
  ('damoang', '다모앙', 'https://damoang.net'),
  ('ruliweb', '루리웹', 'https://m.ruliweb.com');
