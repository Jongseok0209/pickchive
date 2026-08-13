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
