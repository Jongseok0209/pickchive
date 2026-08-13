-- 루리웹은 Cloudflare Workers 아웃바운드 IP를 차단하고 있어(HTTP 522) 크롤링 불가 확인됨.
-- 82cook으로 교체.
DELETE FROM sites WHERE slug = 'ruliweb';

INSERT INTO sites (slug, name, base_url) VALUES
  ('cook82', '82cook', 'https://www.82cook.com');
