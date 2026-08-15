/** Tauri-only window chrome rendered above the shared application frame. */
import { useEffect, useState } from 'react'
import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window'
import { IconCloseOutline16, IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
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
}

type DesktopWindowAction = (window: TauriWindow) => Promise<void>

function label(english: string, chinese: string): string {
  return navigator.language.toLowerCase().startsWith('zh') ? chinese : english
}

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
}: DesktopTitlebarProps) {
  const [fullscreen, setFullscreen] = useState(false)
  const toggleLabel = sidebarCollapsed
    ? label('Open sidebar', '打开侧边栏')
    : label('Collapse sidebar', '收起侧边栏')
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
      aria-label={label('Window controls', '窗口控制')}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button') !== null) return
        runWindowAction(async (window) => { await window.toggleMaximize() })
      }}
    >
      <div className={css.titlebarSidebar} data-tauri-drag-region>
        <Tooltip label={toggleTooltip} delayMs={500}>
          <button
            type="button"
            className={css.titlebarSidebarToggle}
            aria-label={toggleLabel}
            onClick={toggleSidebar}
          >
            <IconPanelLeftOutline16 size={16} />
          </button>
        </Tooltip>
      </div>
      <div className={css.titlebarMain} data-tauri-drag-region>
        {platform !== 'macos' && <div className={css.windowControls}>
          <button
            type="button"
            className={css.windowControl}
            aria-label={label('Minimize window', '最小化窗口')}
            title={label('Minimize', '最小化')}
            onClick={() => { runWindowAction(async (window) => { await window.minimize() }) }}
          >
            <span className={css.minimizeIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={css.windowControl}
            aria-label={label('Maximize or restore window', '最大化或还原窗口')}
            title={label('Maximize or restore', '最大化或还原')}
            onClick={() => { runWindowAction(async (window) => { await window.toggleMaximize() }) }}
          >
            <span className={css.maximizeIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${css.windowControl} ${css.closeWindow}`}
            aria-label={label('Close window', '关闭窗口')}
            title={label('Close', '关闭')}
            onClick={() => { runWindowAction(async (window) => { await window.close() }) }}
          >
            <IconCloseOutline16 size={12} />
          </button>
        </div>}
      </div>
    </header>
  )
}
