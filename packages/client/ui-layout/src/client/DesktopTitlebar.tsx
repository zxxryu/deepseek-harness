/** Tauri-only window chrome rendered above the shared application frame. */
import { useEffect, useState } from 'react'
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window'
import {
  BrandWordmark, FishLogo,
  IconCloseOutline16, IconPanelLeftOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AppFrame.module.css'

interface DesktopTitlebarProps {
  /** Native platform whose window chrome surrounds the shared client. */
  platform: 'linux' | 'macos' | 'windows'
  /** Current sidebar track width, used to align the titlebar split. */
  sidebarWidth: number
  /** Whether the sidebar currently renders its compact rail. */
  sidebarCollapsed: boolean
  /** Whether a panel drag is in progress. */
  dragging: boolean
  /** Toggle the shared layout store's sidebar state. */
  toggleSidebar: () => void
  /** Common-namespace translate seat: all desktop chrome copy is locale-owned. */
  t: TranslateNS<'common'>
}

type DesktopWindowAction = (window: TauriWindow) => Promise<void>

function runWindowAction(action: DesktopWindowAction): void {
  void action(getCurrentWindow()).catch((error: unknown) => {
    console.error('desktop titlebar window action failed', error)
  })
}

/** Render the drag region and the controls owned by the Tauri window. */
export function DesktopTitlebar({
  platform,
  sidebarWidth,
  sidebarCollapsed,
  dragging,
  toggleSidebar,
  t,
}: DesktopTitlebarProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const brandedSidebar = platform === 'macos' || platform === 'windows'
  const toggleLabel = t(sidebarCollapsed ? 'desktop.openSidebar' : 'desktop.collapseSidebar')
  const toggleTooltip = `${toggleLabel} (${platform === 'macos' ? '⌘B' : 'Ctrl+B'})`

  useEffect(() => {
    if (platform !== 'macos' || !('__TAURI_INTERNALS__' in window)) return
    const desktopWindow = getCurrentWindow()
    let disposed = false
    let unlisten: (() => void) | undefined
    const refresh = async () => {
      const next = await desktopWindow.isFullscreen()
      if (!disposed) setFullscreen(next)
    }
    void (async () => {
      await refresh()
      unlisten = await desktopWindow.onResized(() => { void refresh() })
    })().catch((error: unknown) => {
      console.error('desktop titlebar fullscreen observation failed', error)
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [platform])

  return (
    <header
      className={css.titlebar}
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
      data-dragging={dragging || undefined}
      data-fullscreen={fullscreen || undefined}
      data-platform={platform}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-tauri-drag-region
      role="toolbar"
      aria-label={t('desktop.windowControls')}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button') !== null) return
        runWindowAction(async (window) => { await window.toggleMaximize() })
      }}
    >
      <div className={css.titlebarSidebar} data-tauri-drag-region>
        {/* Desktop chrome moves the sidebar brand into the titlebar: expanded
            shows the full wordmark, while the collapsed control rests on the
            whale mark. Linux keeps the plain panel control. */}
        {brandedSidebar && !sidebarCollapsed && (
          <BrandWordmark className={css.titlebarWordmark} size={platform === 'macos' ? 18 : 24} />
        )}
        <Tooltip label={toggleTooltip} delayMs={500}>
          <button
            type="button"
            className={css.titlebarSidebarToggle}
            aria-label={toggleLabel}
            onClick={toggleSidebar}
          >
            {brandedSidebar && sidebarCollapsed && (
              <FishLogo className={css.titlebarFish} size={24} />
            )}
            <IconPanelLeftOutline16
              className={css.titlebarPanelIcon}
              size={brandedSidebar && sidebarCollapsed ? 18 : 16}
            />
          </button>
        </Tooltip>
      </div>
      <div className={css.titlebarMain} data-tauri-drag-region>
        {platform !== 'macos' && <div className={css.windowControls}>
          <button
            type="button"
            className={css.windowControl}
            aria-label={t('desktop.minimize')}
            title={t('desktop.minimize')}
            onClick={() => { runWindowAction(async (window) => { await window.minimize() }) }}
          >
            <span className={css.minimizeIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={css.windowControl}
            aria-label={t('desktop.maximizeOrRestore')}
            title={t('desktop.maximizeOrRestore')}
            onClick={() => { runWindowAction(async (window) => { await window.toggleMaximize() }) }}
          >
            <span className={css.maximizeIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${css.windowControl} ${css.closeWindow}`}
            aria-label={t('desktop.closeWindow')}
            title={t('desktop.closeWindow')}
            onClick={() => { runWindowAction(async (window) => { await window.close() }) }}
          >
            <IconCloseOutline16 size={12} />
          </button>
        </div>}
      </div>
    </header>
  )
}
