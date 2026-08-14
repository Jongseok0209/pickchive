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

// 상대 시간 표현 (예: "3분 전 수집", "방금 전 수집")
export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "방금 수집";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전 수집`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전 수집`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전 수집`;
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
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }
  return decoded;
}



