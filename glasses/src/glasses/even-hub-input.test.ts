import {
  AudioEvent,
  List_ItemEvent,
  OsEventTypeList,
  Sys_ItemEvent,
  Text_ItemEvent,
  IMU_Report_Data
} from '@evenrealities/even_hub_sdk'
import { describe, expect, it } from 'vitest'
import { createGlassesSignalGate, readGlassesSignal } from './even-hub-input'

const ITEMS = ['◆ api: needs you', '○ web: done']

describe('readGlassesSignal', () => {
  it('reads a list click whose zero type and index the SDK dropped', () => {
    const event = { listEvent: new List_ItemEvent({ currentSelectItemName: ITEMS[0] }) }
    expect(readGlassesSignal(event, ITEMS)).toEqual({
      kind: 'input',
      input: { type: 'select', index: 0 }
    })
  })

  it('falls back to the item name when the index is missing', () => {
    const event = { listEvent: new List_ItemEvent({ currentSelectItemName: ITEMS[1] }) }
    expect(readGlassesSignal(event, ITEMS)).toMatchObject({ input: { index: 1 } })
  })

  it('maps text gestures, including hold-to-talk', () => {
    const cases: [OsEventTypeList, string][] = [
      [OsEventTypeList.DOUBLE_CLICK_EVENT, 'double-tap'],
      [OsEventTypeList.SCROLL_BOTTOM_EVENT, 'page-next'],
      [OsEventTypeList.SCROLL_TOP_EVENT, 'page-prev'],
      [OsEventTypeList.LONG_PRESS_EVENT, 'hold-start'],
      [OsEventTypeList.LONG_PRESS_RELEASE_EVENT, 'hold-end']
    ]
    for (const [eventType, type] of cases) {
      expect(readGlassesSignal({ textEvent: new Text_ItemEvent({ eventType }) }, [])).toEqual({
        kind: 'input',
        input: { type }
      })
    }
    expect(readGlassesSignal({ textEvent: new Text_ItemEvent({}) }, [])).toEqual({
      kind: 'input',
      input: { type: 'tap' }
    })
  })

  it('separates lifecycle and IMU system events from gestures', () => {
    expect(
      readGlassesSignal(
        { sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT }) },
        []
      )
    ).toEqual({ kind: 'lifecycle', lifecycle: 'background' })
    expect(
      readGlassesSignal(
        { sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SYSTEM_EXIT_EVENT }) },
        []
      )
    ).toEqual({ kind: 'lifecycle', lifecycle: 'exit' })
    expect(
      readGlassesSignal(
        { sysEvent: new Sys_ItemEvent({ imuData: new IMU_Report_Data({ x: 1 }) }) },
        []
      )
    ).toBeNull()
  })

  it('passes microphone frames through', () => {
    const audioPcm = new Uint8Array([1, 2, 3, 4])
    expect(readGlassesSignal({ audioEvent: new AudioEvent({ audioPcm }) }, [])).toEqual({
      kind: 'audio',
      pcm: audioPcm
    })
  })
})

describe('createGlassesSignalGate', () => {
  it('drops the duplicate the firmware sends for one action but not a later repeat', () => {
    let now = 0
    const gate = createGlassesSignalGate(() => now)
    const tap = { kind: 'input' as const, input: { type: 'tap' as const } }
    expect(gate(tap)).toBe(true)
    now = 80
    expect(gate(tap)).toBe(false)
    now = 500
    expect(gate(tap)).toBe(true)
  })

  it('holds lifecycle duplicates for longer and never drops audio', () => {
    let now = 0
    const gate = createGlassesSignalGate(() => now)
    const foreground = { kind: 'lifecycle' as const, lifecycle: 'foreground' as const }
    expect(gate(foreground)).toBe(true)
    now = 450
    expect(gate(foreground)).toBe(false)
    const audio = { kind: 'audio' as const, pcm: new Uint8Array(2) }
    expect(gate(audio)).toBe(true)
    expect(gate(audio)).toBe(true)
  })
})
