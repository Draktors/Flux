// A title tag that holds a PR back, whatever the reviews say
export function markedBlocked(title: string): boolean {
  return /\[(?:BLOCKED|DO NOT MERGE)\]/.test(title)
}
