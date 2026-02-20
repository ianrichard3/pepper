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
