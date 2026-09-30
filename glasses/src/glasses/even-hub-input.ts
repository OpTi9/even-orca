import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { GlanceInput } from '../glance/glance-controller'

export type GlassesLifecycle = 'foreground' | 'background' | 'exit'

export type GlassesSignal =
  | { kind: 'input'; input: GlanceInput }
  | { kind: 'lifecycle'; lifecycle: GlassesLifecycle }
  | { kind: 'audio'; pcm: Uint8Array }

// The SDK normalizes CLICK_EVENT (0) to undefined in most payloads.
function isClick(eventType: OsEventTypeList | undefined): boolean {
  return eventType === OsEventTypeList.CLICK_EVENT || eventType === undefined
}

function gestureInput(eventType: OsEventTypeList | undefined): GlanceInput | null {
  if (isClick(eventType)) {
    return { type: 'tap' }
  }
  switch (eventType) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { type: 'double-tap' }
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { type: 'page-next' }
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { type: 'page-prev' }
    case OsEventTypeList.LONG_PRESS_EVENT:
      return { type: 'hold-start' }
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return { type: 'hold-end' }
    default:
      return null
  }
}

function lifecycleOf(eventType: OsEventTypeList | undefined): GlassesLifecycle | null {
  switch (eventType) {
    case OsEventTypeList.FOREGROUND_ENTER_EVENT:
      return 'foreground'
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
      return 'background'
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      return 'exit'
    default:
      return null
  }
}

/** `listItems` resolves a click whose index the firmware omitted (it does so for item 0). */
export function readGlassesSignal(
  event: EvenHubEvent,
  listItems: readonly string[]
): GlassesSignal | null {
  if (event.audioEvent) {
    return { kind: 'audio', pcm: event.audioEvent.audioPcm }
  }
  if (event.listEvent) {
    const { eventType, currentSelectItemIndex, currentSelectItemName } = event.listEvent
    if (isClick(eventType)) {
      const byName = currentSelectItemName ? listItems.indexOf(currentSelectItemName) : -1
      return {
        kind: 'input',
        input: { type: 'select', index: currentSelectItemIndex ?? Math.max(0, byName) }
      }
    }
    const input = gestureInput(eventType)
    return input ? { kind: 'input', input } : null
  }
  const source = event.textEvent ?? event.sysEvent
  if (!source) {
    return null
  }
  const lifecycle = lifecycleOf(source.eventType)
  if (lifecycle) {
    return { kind: 'lifecycle', lifecycle }
  }
  // An IMU report carries no gesture; its normalized type can also read as undefined.
  if (event.sysEvent?.imuData) {
    return null
  }
  const input = gestureInput(source.eventType)
  return input ? { kind: 'input', input } : null
}

const GESTURE_REPEAT_MS = 300
const LIFECYCLE_REPEAT_MS = 600

/**
 * Drops the duplicates the firmware emits for one physical action (~50-100 ms apart) and the
 * burst a fast swipe produces.
 */
export function createGlassesSignalGate(now: () => number = () => Date.now()) {
  let lastKey: string | null = null
  let lastAt = 0
  return (signal: GlassesSignal): boolean => {
    if (signal.kind === 'audio') {
      return true
    }
    const key = signal.kind === 'input' ? JSON.stringify(signal.input) : `life:${signal.lifecycle}`
    const window = signal.kind === 'input' ? GESTURE_REPEAT_MS : LIFECYCLE_REPEAT_MS
    const at = now()
    const duplicate = key === lastKey && at - lastAt < window
    lastKey = key
    lastAt = at
    return !duplicate
  }
}
