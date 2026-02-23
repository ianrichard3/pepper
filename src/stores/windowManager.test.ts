import { beforeEach, describe, expect, it } from 'vitest'
import { windowManager } from '@/stores/windowManager'

function resetWindowManagerState() {
  localStorage.clear()
  windowManager.windows = []
  windowManager.nextZIndex = 1500
  windowManager.viewport.width = 1440
  windowManager.viewport.height = 900
  windowManager.storageScope = 'test'
  windowManager.hydrated = true
}

describe('windowManager bounds', () => {
  beforeEach(() => {
    resetWindowManagerState()
    windowManager.setViewport(1000, 800)
  })

  it('clamps minimized windows using minimized visible height', () => {
    const win = windowManager.openTool('devices', 'Devices')
    windowManager.minimizeWindow(win.id)
    windowManager.moveWindow(win.id, 120, 5000)

    const updated = windowManager.getWindow(win.id)
    expect(updated).not.toBeNull()
    expect(updated?.rect.y).toBe(750)
  })

  it('allows partial horizontal off-canvas while keeping header reachable', () => {
    const win = windowManager.openTool('patchbay', 'Patchbay')
    windowManager.moveWindow(win.id, -500, 120)
    const moved = windowManager.getWindow(win.id)

    expect(moved).not.toBeNull()
    expect(moved?.rect.x).toBe(-500)

    windowManager.moveWindow(win.id, -5000, 120)
    const clamped = windowManager.getWindow(win.id)
    expect(clamped).not.toBeNull()
    expect(clamped?.rect.x).toBe(-852)
  })

  it('re-clamps windows on viewport changes with state-aware limits', () => {
    const win = windowManager.openTool('devices', 'Devices')
    windowManager.minimizeWindow(win.id)
    windowManager.moveWindow(win.id, 120, 5000)

    windowManager.setViewport(640, 420)
    const updated = windowManager.getWindow(win.id)

    expect(updated).not.toBeNull()
    expect(updated?.rect.y).toBe(370)
  })

  it('clamps resize dimensions and keeps header reachable', () => {
    const win = windowManager.openTool('graph', 'Graph')
    windowManager.resizeWindow(win.id, { x: 5000, y: 5000, width: 5000, height: 5000 })

    const resized = windowManager.getWindow(win.id)
    expect(resized).not.toBeNull()
    expect(resized?.rect.width).toBe(984)
    expect(resized?.rect.height).toBe(784)
    expect(resized?.rect.x).toBe(872)
    expect(resized?.rect.y).toBe(750)
  })

  it('clamps tool windows to tool-specific minimum sizes', () => {
    const patchbay = windowManager.openTool('patchbay', 'Patchbay')
    const graph = windowManager.openTool('graph', 'Graph')

    windowManager.resizeWindow(patchbay.id, { x: 40, y: 24, width: 100, height: 100 })
    windowManager.resizeWindow(graph.id, { x: 220, y: 86, width: 100, height: 100 })

    const patchbayResized = windowManager.getWindow(patchbay.id)
    const graphResized = windowManager.getWindow(graph.id)

    expect(patchbayResized?.rect.width).toBe(760)
    expect(patchbayResized?.rect.height).toBe(560)
    expect(graphResized?.rect.width).toBe(860)
    expect(graphResized?.rect.height).toBe(540)
  })

  it('clamps utility child windows using baseline and exception minimums', () => {
    const parent = windowManager.openTool('graph', 'Routing Canvas')
    const selectPort = windowManager.openChildWindow(parent.id, 'canvas-select-port', 'Select Port', {}, { id: 'test:select-port' })
    const intentMatches = windowManager.openChildWindow(parent.id, 'canvas-intent-matches', 'Intent Matches', {}, { id: 'test:intent-matches' })

    windowManager.resizeWindow(selectPort.id, { x: 0, y: 0, width: 100, height: 100 })
    windowManager.resizeWindow(intentMatches.id, { x: 0, y: 0, width: 100, height: 100 })

    const selectPortResized = windowManager.getWindow(selectPort.id)
    const intentMatchesResized = windowManager.getWindow(intentMatches.id)

    expect(selectPortResized?.rect.width).toBe(460)
    expect(selectPortResized?.rect.height).toBe(320)
    expect(intentMatchesResized?.rect.width).toBe(640)
    expect(intentMatchesResized?.rect.height).toBe(420)
  })

  it('clamps confirm child windows to confirm minimum sizes', () => {
    const parent = windowManager.openTool('devices', 'Devices')
    const confirm = windowManager.openChildWindow(parent.id, 'devices-delete-confirm', 'Delete Device', {}, { id: 'test:delete-confirm' })

    windowManager.resizeWindow(confirm.id, { x: 0, y: 0, width: 100, height: 100 })
    const resized = windowManager.getWindow(confirm.id)

    expect(resized?.rect.width).toBe(460)
    expect(resized?.rect.height).toBe(260)
  })

  it('re-clamps hydrated windows using per-kind minimums', () => {
    localStorage.setItem(
      windowManager.storageKey,
      JSON.stringify({
        windows: [
          {
            id: 'tool:patchbay',
            kind: 'patchbay',
            title: 'Patchbay',
            parentId: null,
            state: 'normal',
            rect: { x: 40, y: 24, width: 100, height: 100 },
            previousRect: null,
            payload: {},
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    )

    windowManager.hydrate()
    const hydrated = windowManager.getWindow('tool:patchbay')

    expect(hydrated?.rect.width).toBe(760)
    expect(hydrated?.rect.height).toBe(560)
  })

  it('keeps newly opened child window on top after same-tick parent focus', async () => {
    const parent = windowManager.openTool('graph', 'Routing Canvas')
    const child = windowManager.openChildWindow(
      parent.id,
      'canvas-select-port',
      'Select Port',
      {},
      { id: 'canvas-select-port:test-parent' },
    )

    windowManager.focusWindow(parent.id)
    await Promise.resolve()

    const latest = [...windowManager.windows].sort((a, b) => b.zIndex - a.zIndex)[0]
    expect(latest?.id).toBe(child.id)
  })
})
