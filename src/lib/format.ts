// 한국식 숫자 축약: 12345 -> "1.2만", 999 -> "999"
export function formatCount(n: number): string {
  if (n >= 10000) {
    const man = n / 10000;
    return `${man >= 100 ? Math.round(man) : man.toFixed(1).replace(/\.0$/, "")}만`;
  }
  if (n >= 1000) {
    const cheon = n / 1000;
    return `${cheon.toFixed(1).replace(/\.0$/, "")}천`;
  }
  return String(n);
}

// 상대 시간 표현 (예: "게시 3분 전", "방금 업데이트"). label로 무엇의 시각인지 구분한다 —
// "게시"(first_seen_at, 기간 필터가 실제로 쓰는 기준)와 "업데이트"(crawled_at, 마지막
// 조회수/추천수 갱신 시각)를 혼동하기 쉬워서 라벨을 붙여 명확히 구분해준다.
export function formatElapsedLabel(
  dateStr: string | null,
  label: string
): string {
  if (!dateStr) return "";
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return `방금 ${label}`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${label} ${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${label} ${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${label} ${diffDay}일 전`;
}

// 일부 사이트는 제목 끝에 이미 "(N)" 형태로 댓글수를 붙여 보여준다(예: "... (10)").
// 이 경우 "[원본 댓글 N]" 배지까지 또 붙이면 같은 숫자가 중복 노출된다.
export function titleHasCommentCountSuffix(
  title: string,
  commentCount: number | null
): boolean {
  if (!commentCount) return false;
  const match = title.match(/\((\d+)\)\s*$/);
  return !!match && Number(match[1]) === commentCount;
}

// HTML 엔티티 디코딩
export function decodeEntities(text: string | null): string {
  if (!text) return "";
  let decoded = text;
  let prev = "";
  // 중복 인코딩된 이스케이프 문자(&amp;#039; -> &#039; -> ')를 완전히 복원할 때까지 루프
  while (decoded !== prev) {
    prev = decoded;
    decoded = decoded
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        String.fromCharCode(parseInt(code, 16))
      );
  }
  return decoded;
}
