// Text shaping for the G2 firmware font: proportional, no ANSI, ~400-500 chars per full screen,
// and a 1000-char cap per container on create/rebuild.

/** Keeps a full page readable without the firmware's internal scrollbar. */
export const GLANCE_PAGE_CHARS = 380

/** `ListItemContainerProperty.itemName` limit. */
export const GLANCE_LIST_LABEL_CHARS = 64

/** `ListItemContainerProperty.itemCount` limit. */
export const GLANCE_LIST_MAX_ITEMS = 20

const ANSI_SEQUENCE_RE =
  // oxlint-disable-next-line no-control-regex -- matching terminal escapes is the point
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
// oxlint-disable-next-line no-control-regex -- strip C0/C1 controls the firmware would drop anyway
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

export function toGlassesText(raw: string): string {
  return raw
    .replace(ANSI_SEQUENCE_RE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(CONTROL_RE, '')
    .replace(/[  ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line for a list row: whitespace collapsed, ellipsized at the firmware limit. */
export function toGlassesLabel(raw: string, maxChars = GLANCE_LIST_LABEL_CHARS): string {
  const line = toGlassesText(raw).replace(/\s+/g, ' ')
  // Why: the firmware font has no U+2026, and missing glyphs render as nothing.
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 3).trimEnd()}...`
}

/** Splits at paragraph, line, then word boundaries; a single oversized word is hard-cut. */
export function paginateGlassesText(raw: string, maxChars = GLANCE_PAGE_CHARS): string[] {
  let rest = toGlassesText(raw)
  if (!rest) {
    return ['']
  }
  const pages: string[] = []
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1)
    const minBreak = Math.floor(maxChars / 2)
    const cut = [
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' ')
    ].find((index) => index >= minBreak)
    const end = cut ?? maxChars
    pages.push(rest.slice(0, end).trimEnd())
    rest = rest.slice(end).trimStart()
  }
  if (rest) {
    pages.push(rest)
  }
  return pages
}
