// Keyless assembled coverage for the Tauri-only titlebar. Chromium supplies
// the real layout and shared sidebar store; native window actions remain in
// the Rust/Tauri lane, while this scenario exercises the model-visible Web
// composition and the moved fold control.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-titlebar', import.meta.url))
const MACOS_TITLEBAR_EXPECTED = join(SNAPSHOT_DIR, 'macos-titlebar.expected.md')
const WINDOWS_TITLEBAR_EXPECTED = join(SNAPSHOT_DIR, 'windows-titlebar.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: Tauri desktop titlebar', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(`${scaffold.authenticatedUrl}#dsh-platform=tauri&dsh-os=macos`, { waitUntil: 'load' })
    await page.getByRole('toolbar', { name: 'Window controls' }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('reserves the macOS overlay for native traffic lights', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-titlebar'))
    const toolbar = page.getByRole('toolbar', { name: 'Window controls' })
    expect(await toolbar.getAttribute('data-tauri-drag-region')).not.toBeNull()
    expect(await toolbar.getAttribute('data-platform')).toBe('macos')
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).hash).toBe('#dsh-platform=tauri&dsh-os=macos')
    expect(await page.getByRole('button', { name: 'Collapse sidebar' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'New session' }).count()).toBe(1)
    expect(await toolbar.locator('[class*="titlebarWordmark"]').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Minimize window' }).count()).toBe(0)

    const geometry = await page.evaluate(() => {
      const titlebar = document.querySelector<HTMLElement>('[role="toolbar"]')
      const frame = document.querySelector<HTMLElement>('[class*="frame"]')
      if (titlebar === null || frame === null) throw new Error('desktop frame did not render')
      const titlebarBox = titlebar.getBoundingClientRect()
      const frameBox = frame.getBoundingClientRect()
      const toggleBox = titlebar.querySelector('button')?.getBoundingClientRect()
      const center = document.querySelector<HTMLElement>('[class*="centerCol"]')
      return {
        titlebarTop: titlebarBox.top,
        titlebarHeight: titlebarBox.height,
        frameTop: frameBox.top,
        toggleLeft: toggleBox?.left,
        toggleTop: toggleBox?.top,
        toggleHeight: toggleBox?.height,
        centerTopLeftRadius: center === null ? undefined : getComputedStyle(center).borderTopLeftRadius,
      }
    })
    expect(geometry).toEqual({
      titlebarTop: 0,
      titlebarHeight: 48,
      frameTop: 48,
      toggleLeft: 234,
      toggleTop: 6,
      toggleHeight: 36,
      centerTopLeftRadius: '15px',
    })

    await toolbar.evaluate((element) => { element.setAttribute('data-fullscreen', '') })
    expect(await toolbar.locator('[class*="titlebarWordmark"]').evaluate(element => element.getBoundingClientRect().left)).toBe(12)
    expect(await toolbar.locator('button').first().evaluate(element => element.getBoundingClientRect().left)).toBe(234)
    await toolbar.evaluate((element) => { element.removeAttribute('data-fullscreen') })

    const snapshot = await captureStableAria(page, '[role="toolbar"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MACOS_TITLEBAR_EXPECTED, snapshot, MODE)

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await page.locator('[class*="frame"][data-sidebar-collapsed]').waitFor()
    expect(await page.getByRole('button', { name: 'Open sidebar' }).count()).toBe(1)
    const readCollapsedChrome = () => page.evaluate(() => {
      const titlebar = document.querySelector<HTMLElement>('[role="toolbar"]')
      const sidebar = titlebar?.firstElementChild
      const main = titlebar?.lastElementChild
      if (!(sidebar instanceof HTMLElement) || !(main instanceof HTMLElement)) {
        throw new Error('desktop titlebar columns did not render')
      }
      const sidebarBox = sidebar.getBoundingClientRect()
      const toggleBox = sidebar.querySelector('button')?.getBoundingClientRect()
      const frame = document.querySelector<HTMLElement>('[class*="frame"]')
      const sidebarRegion = document.querySelector<HTMLElement>('[class*="sidebarCol"]')
      const center = document.querySelector<HTMLElement>('[class*="centerCol"]')
      if (titlebar === null || frame === null || sidebarRegion === null || center === null) {
        throw new Error('desktop frame regions did not render')
      }
      return {
        sidebarWidth: sidebarBox.width,
        sidebarRight: sidebarBox.right,
        toggleLeft: toggleBox?.left,
        titlebarBackground: getComputedStyle(titlebar).backgroundColor,
        sidebarBackground: getComputedStyle(sidebar).backgroundColor,
        mainBackground: getComputedStyle(main).backgroundColor,
        sidebarRegionBackground: getComputedStyle(sidebarRegion).backgroundColor,
        sidebarRegionBorderRightWidth: getComputedStyle(sidebarRegion).borderRightWidth,
        frameBackground: getComputedStyle(frame).backgroundColor,
        centerTopLeftRadius: getComputedStyle(center).borderTopLeftRadius,
      }
    })
    await expect.poll(async () => (await readCollapsedChrome()).sidebarWidth).toBe(120)
    const collapsedChrome = await readCollapsedChrome()
    expect(collapsedChrome).toMatchObject({ sidebarWidth: 120, sidebarRight: 120, toggleLeft: 82 })
    expect(collapsedChrome.titlebarBackground).toBe(collapsedChrome.sidebarRegionBackground)
    expect(collapsedChrome.frameBackground).toBe(collapsedChrome.sidebarRegionBackground)
    expect(collapsedChrome.sidebarRegionBorderRightWidth).toBe('0px')
    expect(collapsedChrome.sidebarBackground).toBe('rgba(0, 0, 0, 0)')
    expect(collapsedChrome.mainBackground).toBe('rgba(0, 0, 0, 0)')
    expect(collapsedChrome.centerTopLeftRadius).toBe('15px')
    await toolbar.evaluate((element) => { element.setAttribute('data-fullscreen', '') })
    const readFullscreenCollapsedGeometry = () => toolbar.evaluate((element) => {
      const sidebar = element.firstElementChild
      const toggle = sidebar?.querySelector('button')
      return {
        sidebarWidth: sidebar?.getBoundingClientRect().width,
        toggleLeft: toggle?.getBoundingClientRect().left,
      }
    })
    await expect.poll(async () => (await readFullscreenCollapsedGeometry()).sidebarWidth).toBe(56)
    const fullscreenCollapsedGeometry = await readFullscreenCollapsedGeometry()
    expect(fullscreenCollapsedGeometry).toEqual({ sidebarWidth: 56, toggleLeft: 10 })
    await toolbar.evaluate((element) => { element.removeAttribute('data-fullscreen') })
    const toggle = page.getByRole('button', { name: 'Open sidebar' })
    const newSession = page.getByRole('button', { name: 'New session' })
    await newSession.hover()
    const newSessionHover = await newSession.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      radius: getComputedStyle(element).borderRadius,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
    expect(await toolbar.locator('[class*="titlebarFish"]').isVisible()).toBe(true)
    expect(await toolbar.locator('[class*="titlebarPanelIcon"]').isVisible()).toBe(false)
    await toggle.hover()
    await page.getByRole('tooltip').waitFor({ timeout: 2_000 })
    expect(await page.getByRole('tooltip').textContent()).toBe('Open sidebar (⌘B)')
    expect(await toolbar.locator('[class*="titlebarFish"]').isVisible()).toBe(false)
    expect(await toolbar.locator('[class*="titlebarPanelIcon"]').isVisible()).toBe(true)
    const toggleHover = await toggle.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      radius: getComputedStyle(element).borderRadius,
      padding: getComputedStyle(element).padding,
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    }))
    expect(toggleHover).toEqual({
      background: newSessionHover.background,
      radius: newSessionHover.radius,
      padding: '8px',
      width: newSessionHover.width,
      height: newSessionHover.height,
    })
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await expect.poll(() => page.locator('[class*="frame"]').getAttribute('data-sidebar-collapsed')).toBeNull()
    await page.keyboard.press('Meta+B')
    await page.locator('[class*="frame"][data-sidebar-collapsed]').waitFor()
    await page.keyboard.press('Meta+B')
    await expect.poll(() => page.locator('[class*="frame"]').getAttribute('data-sidebar-collapsed')).toBeNull()
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps custom window controls on Windows', async () => {
    await page.goto(`${scaffold.baseUrl}#dsh-platform=tauri&dsh-os=windows`, { waitUntil: 'load' })
    await page.reload({ waitUntil: 'load' })
    const toolbar = page.getByRole('toolbar', { name: 'Window controls' })
    await toolbar.waitFor()
    expect(await toolbar.getAttribute('data-platform')).toBe('windows')
    expect(await page.getByRole('button', { name: 'Minimize window' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Maximize or restore window' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Close window' }).count()).toBe(1)
    const windowsGeometry = await toolbar.evaluate((element) => {
      const controls = Array.from(element.querySelectorAll('button'))
      return {
        titlebarHeight: element.getBoundingClientRect().height,
        controlHeights: controls.map(control => control.getBoundingClientRect().height),
      }
    })
    expect(windowsGeometry).toEqual({ titlebarHeight: 48, controlHeights: [36, 48, 48, 48] })
    const snapshot = await captureStableAria(page, '[role="toolbar"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(WINDOWS_TITLEBAR_EXPECTED, snapshot, MODE)
  })

  it('keeps its snapshot inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'macos-titlebar.expected.md',
      'windows-titlebar.expected.md',
    ])
  })
})
