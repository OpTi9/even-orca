import {
  StartUpPageCreateResult,
  type CreateStartUpPageContainer,
  type RebuildPageContainer
} from '@evenrealities/even_hub_sdk'
import { describe, expect, it } from 'vitest'
import {
  buildGlassesPage,
  EvenHubPageRenderer,
  type GlassesPageBridge
} from './even-hub-page-renderer'

function fakeBridge(createResult = StartUpPageCreateResult.success) {
  const calls: string[] = []
  const bridge: GlassesPageBridge = {
    createStartUpPageContainer: async (_page: CreateStartUpPageContainer) => {
      calls.push('create')
      return createResult
    },
    rebuildPageContainer: async (_page: RebuildPageContainer) => {
      calls.push('rebuild')
      return true
    }
  }
  return { bridge, calls }
}

describe('buildGlassesPage', () => {
  it('gives a list screen a passive header and an input-capturing list', () => {
    const page = buildGlassesPage({ kind: 'list', header: 'h', items: ['a', 'b'] })
    expect(page.containerTotalNum).toBe(2)
    expect(page.textObject[0]?.isEventCapture).toBe(0)
    expect(page.listObject?.[0]?.isEventCapture).toBe(1)
    expect(page.listObject?.[0]?.itemContainer?.itemCount).toBe(2)
  })

  it('caps text at the firmware limit', () => {
    const page = buildGlassesPage({ kind: 'text', body: 'x'.repeat(1_500) })
    expect(page.textObject[0]?.content).toHaveLength(1_000)
    expect(page.textObject[0]?.isEventCapture).toBe(1)
  })
})

describe('EvenHubPageRenderer', () => {
  it('creates once, rebuilds on change and skips identical screens', async () => {
    const { bridge, calls } = fakeBridge()
    const renderer = new EvenHubPageRenderer(bridge)
    await renderer.render({ kind: 'text', body: 'one' })
    await renderer.render({ kind: 'text', body: 'one' })
    await renderer.render({ kind: 'list', header: 'h', items: ['a'] })
    expect(calls).toEqual(['create', 'rebuild'])
    expect(renderer.listItems).toEqual(['a'])
  })

  it('falls through to a rebuild after a failed startup create', async () => {
    const { bridge, calls } = fakeBridge(StartUpPageCreateResult.invalid)
    const renderer = new EvenHubPageRenderer(bridge)
    await renderer.render({ kind: 'text', body: 'one' })
    expect(calls).toEqual(['create', 'rebuild'])
  })

  it('redraws after the host cleared the page and creates again after a relaunch', async () => {
    const { bridge, calls } = fakeBridge()
    const renderer = new EvenHubPageRenderer(bridge)
    await renderer.render({ kind: 'text', body: 'one' })
    renderer.invalidate()
    await renderer.render({ kind: 'text', body: 'one' })
    renderer.reset()
    await renderer.render({ kind: 'text', body: 'one' })
    expect(calls).toEqual(['create', 'rebuild', 'create'])
  })
})
