-- 0006_user_filter_prefs.sql
-- 로그인한 회원이 마지막으로 쓴 기간/정렬/사이트 필터를 기억해뒀다가, 다음에
-- 필터 없이 맨 홈("/")으로 들어오면 하드코딩된 기본값(3시간·종합·전체) 대신
-- 이 값을 기본으로 깔아준다.
ALTER TABLE users ADD COLUMN last_window TEXT;
ALTER TABLE users ADD COLUMN last_sort TEXT;
ALTER TABLE users ADD COLUMN last_site TEXT;
