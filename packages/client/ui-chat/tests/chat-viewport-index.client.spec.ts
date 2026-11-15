// @vitest-environment jsdom

import { expect, it, onTestFinished, vi } from 'vitest'
import { ChatViewport } from '../src/client/chat/use-chat-viewport.ts'

class ResizeObserverStub implements ResizeObserver {
  readonly targets = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void { this.targets.add(target) }
  unobserve(target: Element): void { this.targets.delete(target) }
  disconnect(): void { this.targets.clear() }

  notify(target: Element): void {
    this.callback([{ target } as ResizeObserverEntry], this)
  }
}

function fixture(count = 0) {
  const column = document.createElement('div')
  column.dataset.chatFlow = ''
  document.body.append(column)
  let scrollTop = 0
  let viewportTop = 0
  Object.defineProperties(column, {
    clientHeight: { configurable: true, value: 300 },
    scrollHeight: { configurable: true, value: Math.max(2_000, count * 40) },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value },
    },
  })
  vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, viewportTop, 500, 300))
  const boxes = new Map<HTMLElement, { top: number; height: number }>()
  const makeRow = (turn: number, top: number, height = 30): HTMLElement => {
    const row = document.createElement('div')
    row.dataset.chatTurn = String(turn)
    row.dataset.chatAnchorKey = `turn-${turn}`
    row.textContent = `Turn ${turn}`
    column.append(row)
    boxes.set(row, { top, height })
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
      const box = boxes.get(row)!
      return new DOMRect(0, box.top - scrollTop, 500, box.height)
    })
    return row
  }
  const observers: ResizeObserverStub[] = []
  class Observer extends ResizeObserverStub {
    constructor(callback: ResizeObserverCallback) {
      super(callback)
      observers.push(this)
    }
  }
  vi.stubGlobal('ResizeObserver', Observer)
  const viewport = new ChatViewport()
  viewport.attach(column, column)
  viewport.updateTurns(Array.from({ length: Math.max(count, 8) }, (_, index) => ({
    turn: index + 1,
    anchorKey: `turn-${index + 1}`,
    prompt: '',
    response: '',
  })))
  onTestFinished(() => {
    viewport.detach()
    column.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  return {
    column,
    viewport,
    observers,
    makeRow,
    setSize: (row: HTMLElement, height: number) => { boxes.get(row)!.height = height },
    setViewportTop: (top: number) => { viewportTop = top },
  }
}

it('indexes visible row parts and excludes hidden or zero-height rows', () => {
  const h = fixture()
  h.makeRow(1, 0)
  h.makeRow(1, 24)
  const hidden = h.makeRow(2, 40)
  hidden.setAttribute('hidden', 'until-found')
  h.makeRow(2, 50, 0)
  h.makeRow(3, 100)

  expect(h.viewport.readVisibleTurn()).toBe(1)
  h.column.scrollTop = 40
  expect(h.viewport.readVisibleTurn()).toBe(3)
})

it('recomputes the reading line when the viewport moves at an unchanged scrollTop', () => {
  const h = fixture()
  h.makeRow(1, 0)
  h.makeRow(2, 100)
  expect(h.viewport.readVisibleTurn()).toBe(1)
  expect(h.viewport.scrollToTurn(1)?.turn).toBe(1)

  h.setViewportTop(100)

  expect(h.viewport.readVisibleTurn()).toBe(2)
})

it('consumes a same-task hidden-row mutation before reusing the index', () => {
  const h = fixture()
  h.makeRow(1, 0)
  const second = h.makeRow(2, 40)
  second.setAttribute('hidden', 'until-found')
  h.makeRow(3, 100)
  expect(h.viewport.readVisibleTurn()).toBe(1)

  second.removeAttribute('hidden')

  expect(h.viewport.readVisibleTurn()).toBe(2)
})

it('reindexes a row when ResizeObserver reports a zero-to-visible size change', () => {
  const h = fixture()
  h.makeRow(1, 0)
  const second = h.makeRow(2, 50, 0)
  expect(h.viewport.readVisibleTurn()).toBe(1)
  h.setSize(second, 30)
  const observer = h.observers.find(candidate => candidate.targets.has(second))
  expect(observer).toBeDefined()

  observer!.notify(second)

  expect(h.viewport.readVisibleTurn()).toBe(2)
})

it('keeps stable transcript lookup logarithmic after building the row index', () => {
  const count = 2_048
  const h = fixture(count)
  const rows = Array.from({ length: count }, (_, index) => h.makeRow(index + 1, index * 40))
  h.column.scrollTop = 1_400 * 40 + 10
  expect(h.viewport.readVisibleTurn()).toBe(1_402)
  for (const row of rows) vi.spyOn(row, 'getBoundingClientRect').mockClear()

  expect(h.viewport.readVisibleTurn()).toBe(1_402)

  const reads = rows.reduce((sum, row) => sum + vi.spyOn(row, 'getBoundingClientRect').mock.calls.length, 0)
  expect(reads).toBeLessThanOrEqual(Math.ceil(Math.log2(count)) + 2)
})

it('disconnects row observers and clears the index on detach', () => {
  const h = fixture()
  const row = h.makeRow(1, 0)
  h.viewport.readVisibleTurn()
  const observer = h.observers.find(candidate => candidate.targets.has(row))
  expect(observer).toBeDefined()
  expect(observer!.targets.has(row)).toBe(true)

  h.viewport.detach()

  expect(observer!.targets.size).toBe(0)
  expect(h.viewport.readVisibleTurn()).toBeNull()
})
