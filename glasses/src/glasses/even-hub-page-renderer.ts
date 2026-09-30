import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  type EvenAppBridge
} from '@evenrealities/even_hub_sdk'
import { glanceScreensEqual, type GlanceScreen } from '../glance/glance-screen'

const CANVAS_WIDTH = 576
const CANVAS_HEIGHT = 288
const HEADER_HEIGHT = 40
const TEXT_LIMIT = 1000

export type GlassesPageBridge = Pick<
  EvenAppBridge,
  'createStartUpPageContainer' | 'rebuildPageContainer'
>

export type GlassesPage = {
  containerTotalNum: number
  textObject: TextContainerProperty[]
  listObject?: ListContainerProperty[]
}

/** One page per screen. Exactly one container captures input, as the firmware requires. */
export function buildGlassesPage(screen: GlanceScreen): GlassesPage {
  if (screen.kind === 'text') {
    return {
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          borderWidth: 0,
          paddingLength: 6,
          containerID: 1,
          containerName: 'glance-body',
          content: screen.body.slice(0, TEXT_LIMIT),
          isEventCapture: 1
        })
      ]
    }
  }
  return {
    containerTotalNum: 2,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: CANVAS_WIDTH,
        height: HEADER_HEIGHT,
        borderWidth: 0,
        paddingLength: 6,
        containerID: 1,
        containerName: 'glance-header',
        content: screen.header,
        isEventCapture: 0
      })
    ],
    listObject: [
      new ListContainerProperty({
        xPosition: 0,
        yPosition: HEADER_HEIGHT,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT - HEADER_HEIGHT,
        borderWidth: 1,
        borderColor: 5,
        borderRadius: 6,
        paddingLength: 4,
        containerID: 2,
        containerName: 'glance-list',
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: screen.items.length,
          itemWidth: 0,
          isItemSelectBorderEn: 1,
          itemName: screen.items
        })
      })
    ]
  }
}

/** Drives one bridge: creates the startup page once, then rebuilds only on visible change. */
export class EvenHubPageRenderer {
  private shown: GlanceScreen | null = null
  private created = false
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly bridge: GlassesPageBridge) {}

  /** The list the glasses currently show, for resolving index-less clicks. */
  get listItems(): readonly string[] {
    return this.shown?.kind === 'list' ? this.shown.items : []
  }

  render(screen: GlanceScreen): Promise<void> {
    // Why: host calls must not interleave; a rebuild racing the startup create is refused.
    this.queue = this.queue
      .then(() => this.apply(screen))
      .catch((error: unknown) => {
        console.error('[orca-glasses] render failed', error)
      })
    return this.queue
  }

  /** The host clears the page on exit and backgrounding; the next render must rebuild. */
  invalidate(): void {
    this.shown = null
  }

  /** A relaunch starts from no page, so the next render must create rather than rebuild. */
  reset(): void {
    this.shown = null
    this.created = false
  }

  private async apply(screen: GlanceScreen): Promise<void> {
    if (glanceScreensEqual(this.shown, screen)) {
      return
    }
    const page = buildGlassesPage(screen)
    if (!this.created) {
      const result = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer(page)
      )
      // Why: after a failed create only rebuild remains, so don't retry the create forever.
      this.created = true
      if (result === StartUpPageCreateResult.success) {
        this.shown = screen
        return
      }
    }
    if (await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))) {
      this.shown = screen
    }
  }
}
