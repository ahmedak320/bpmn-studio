import { describe, it, expect } from 'vitest'
import {
  createWatchdogState,
  watchdogDecide,
  installDragWatchdog,
  type DocLike,
  type WatchdogEvent
} from '../editor/dragWatchdog'

// ---------------------------------------------------------------------------
// Pure decision core
// ---------------------------------------------------------------------------

/** Feed a sequence of events and collect the actions, for ordering tests. */
function run(events: WatchdogEvent[]): string[] {
  const state = createWatchdogState()
  return events.map((ev) => watchdogDecide(state, ev))
}

describe('watchdogDecide (pure core)', () => {
  it('starts disarmed; hover moves (buttons 0) never rescue while disarmed', () => {
    const state = createWatchdogState()
    expect(state.armed).toBe(false)
    // Ordinary hovering reports buttons === 0 on every single move — the
    // watchdog must be inert until a mousedown inside the scope arms it.
    for (let i = 0; i < 5; i++) {
      expect(watchdogDecide(state, { type: 'move', buttons: 0 })).toBe('none')
    }
    expect(state.armed).toBe(false)
  })

  it('a down inside the scope arms; outside (or unknown) does not', () => {
    const state = createWatchdogState()
    expect(watchdogDecide(state, { type: 'down', insideScope: false })).toBe('none')
    expect(state.armed).toBe(false)
    expect(watchdogDecide(state, { type: 'down' })).toBe('none') // unknown scope: stay inert
    expect(state.armed).toBe(false)
    expect(watchdogDecide(state, { type: 'down', insideScope: true })).toBe('arm')
    expect(state.armed).toBe(true)
  })

  it('any real up disarms; up while disarmed is a no-op', () => {
    const state = createWatchdogState()
    expect(watchdogDecide(state, { type: 'up' })).toBe('none')
    watchdogDecide(state, { type: 'down', insideScope: true })
    expect(watchdogDecide(state, { type: 'up' })).toBe('disarm')
    expect(state.armed).toBe(false)
    expect(watchdogDecide(state, { type: 'up' })).toBe('none')
  })

  it('while armed, moves with a button held do nothing; buttons === 0 rescues + disarms', () => {
    expect(
      run([
        { type: 'down', insideScope: true },
        { type: 'move', buttons: 1 }, // dragging normally
        { type: 'move', buttons: 1 },
        { type: 'move', buttons: 0 } // the release was swallowed
      ])
    ).toEqual(['arm', 'none', 'none', 'rescue'])
  })

  it('a move with UNKNOWN buttons never rescues — missing data must not fire a mouseup', () => {
    const state = createWatchdogState()
    watchdogDecide(state, { type: 'down', insideScope: true })
    expect(watchdogDecide(state, { type: 'move' })).toBe('none')
    expect(state.armed).toBe(true)
  })

  it('after a REAL up, the following hover move does not rescue (up-then-move ordering)', () => {
    // This is the sequence of every normal click/drag: down → up → hover
    // moves with buttons 0. The up must disarm first so those moves are inert.
    expect(
      run([
        { type: 'down', insideScope: true },
        { type: 'up' },
        { type: 'move', buttons: 0 },
        { type: 'move', buttons: 0 }
      ])
    ).toEqual(['arm', 'disarm', 'none', 'none'])
  })

  it('blur and hidden rescue only while armed', () => {
    for (const type of ['blur', 'hidden'] as const) {
      const state = createWatchdogState()
      expect(watchdogDecide(state, { type })).toBe('none') // disarmed: no-op
      watchdogDecide(state, { type: 'down', insideScope: true })
      expect(watchdogDecide(state, { type })).toBe('rescue')
      expect(state.armed).toBe(false)
    }
  })

  it('double-rescue is impossible: a rescue disarms before anything else can fire', () => {
    const state = createWatchdogState()
    watchdogDecide(state, { type: 'down', insideScope: true })
    expect(watchdogDecide(state, { type: 'move', buttons: 0 })).toBe('rescue')
    // Every follow-up trigger — even ones that would rescue while armed —
    // must now be a no-op until the next arming mousedown.
    expect(watchdogDecide(state, { type: 'move', buttons: 0 })).toBe('none')
    expect(watchdogDecide(state, { type: 'blur' })).toBe('none')
    expect(watchdogDecide(state, { type: 'hidden' })).toBe('none')
  })

  it('re-arming after a rescue works (full cycle twice)', () => {
    expect(
      run([
        { type: 'down', insideScope: true },
        { type: 'move', buttons: 0 },
        { type: 'down', insideScope: true },
        { type: 'blur' }
      ])
    ).toEqual(['arm', 'rescue', 'arm', 'rescue'])
  })

  it('arming is idempotent — a second down does not change the outcome', () => {
    expect(
      run([
        { type: 'down', insideScope: true },
        { type: 'down', insideScope: true },
        { type: 'move', buttons: 0 },
        { type: 'move', buttons: 0 }
      ])
    ).toEqual(['arm', 'arm', 'rescue', 'none'])
  })
})

// ---------------------------------------------------------------------------
// DOM installation, exercised against hand-rolled fakes (vitest runs in a
// plain node environment — no jsdom — same style as mockFs.ts).
// ---------------------------------------------------------------------------

type Listener = (ev: Event) => void

/** Minimal EventTarget: records (type, fn, capture) tuples so tests can both
 *  fire events and assert exact registration/removal bookkeeping. */
class FakeTarget {
  listeners: Array<{ type: string; fn: Listener; capture: boolean }> = []

  private static capture(opts?: boolean | AddEventListenerOptions | EventListenerOptions): boolean {
    return typeof opts === 'boolean' ? opts : !!opts?.capture
  }

  addEventListener(type: string, fn: Listener, opts?: boolean | AddEventListenerOptions): void {
    this.listeners.push({ type, fn, capture: FakeTarget.capture(opts) })
  }

  removeEventListener(type: string, fn: Listener, opts?: boolean | EventListenerOptions): void {
    const capture = FakeTarget.capture(opts)
    this.listeners = this.listeners.filter(
      (l) => !(l.type === type && l.fn === fn && l.capture === capture)
    )
  }

  /** Deliver a plain-object event to every listener of `type`. */
  emit(type: string, ev: object): void {
    for (const l of [...this.listeners]) {
      if (l.type === type) l.fn(ev as Event)
    }
  }

  count(type?: string): number {
    return type ? this.listeners.filter((l) => l.type === type).length : this.listeners.length
  }

  has(type: string, capture: boolean): boolean {
    return this.listeners.some((l) => l.type === type && l.capture === capture)
  }
}

/** Stand-in for the realm's MouseEvent constructor: the watchdog builds its
 *  synthetic rescue event via `win.MouseEvent`, so the fake win supplies this. */
class FakeMouseEvent {
  type: string
  bubbles: boolean
  cancelable: boolean
  view: unknown
  button: number
  buttons: number
  clientX: number
  clientY: number
  constructor(type: string, init: MouseEventInit = {}) {
    this.type = type
    this.bubbles = init.bubbles ?? false
    this.cancelable = init.cancelable ?? false
    this.view = init.view
    this.button = init.button ?? 0
    this.buttons = init.buttons ?? 0
    this.clientX = init.clientX ?? 0
    this.clientY = init.clientY ?? 0
  }
}

class FakeWin extends FakeTarget {
  MouseEvent = FakeMouseEvent as unknown as typeof MouseEvent
}

class FakeDoc extends FakeTarget implements DocLike {
  visibilityState = 'visible'
  /** Every event dispatched on the document — the synthetic rescues land here. */
  dispatched: FakeMouseEvent[] = []
  constructor(private winRef?: FakeWin) {
    super()
  }
  dispatchEvent(ev: Event): boolean {
    this.dispatched.push(ev as unknown as FakeMouseEvent)
    // Model real DOM propagation for a document-target event: it traverses
    // WINDOW (where the watchdog's own capture mouseup listener lives — this
    // is what exercises the recursion guard) and then fires the document's
    // listeners (where diagram-js's handlers would run).
    this.winRef?.emit(ev.type, ev)
    this.emit(ev.type, ev)
    return true
  }
}

function makeHarness() {
  const scope = new FakeTarget()
  const win = new FakeWin()
  const doc = new FakeDoc(win)
  const uninstall = installDragWatchdog(scope as unknown as HTMLElement, { doc, win })
  return { scope, win, doc, uninstall }
}

describe('installDragWatchdog (fake doc/win)', () => {
  it('binds capture-phase listeners on scope, window and document', () => {
    const { scope, win, doc } = makeHarness()
    expect(scope.has('mousedown', true)).toBe(true)
    expect(win.has('mousemove', true)).toBe(true)
    expect(win.has('mouseup', true)).toBe(true)
    expect(win.has('pointerup', true)).toBe(true)
    expect(win.has('blur', true)).toBe(true)
    expect(doc.has('visibilitychange', true)).toBe(true)
  })

  it('rescues the real failure sequence with EXACTLY one synthetic mouseup', () => {
    const { scope, win, doc } = makeHarness()

    // down inside the diagram → drag moves → the mouseup is swallowed by the
    // browser → the next move arrives with no button held.
    scope.emit('mousedown', { type: 'mousedown', button: 0, buttons: 1, clientX: 10, clientY: 20 })
    win.emit('mousemove', { type: 'mousemove', buttons: 1, clientX: 50, clientY: 60 })
    win.emit('mousemove', { type: 'mousemove', buttons: 1, clientX: 90, clientY: 100 })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 200, clientY: 150 })

    expect(doc.dispatched).toHaveLength(1)
    const rescue = doc.dispatched[0]
    // Built via the injected win.MouseEvent, in the shape MoveCanvas expects.
    expect(rescue).toBeInstanceOf(FakeMouseEvent)
    expect(rescue.type).toBe('mouseup')
    expect(rescue.bubbles).toBe(true)
    expect(rescue.cancelable).toBe(true)
    expect(rescue.button).toBe(0)
    expect(rescue.buttons).toBe(0)
    // Coordinates are the last known pointer position (the rescuing move's).
    expect(rescue.clientX).toBe(200)
    expect(rescue.clientY).toBe(150)

    // FakeDoc.dispatchEvent re-delivered that mouseup to the watchdog's OWN
    // window capture listener (recursion path) — still exactly one dispatch,
    // and later hover moves stay inert.
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 210, clientY: 160 })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 220, clientY: 170 })
    expect(doc.dispatched).toHaveLength(1)
  })

  it('a normally-completed drag never triggers a rescue', () => {
    const { scope, win, doc } = makeHarness()
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 0, clientY: 0 })
    win.emit('mousemove', { type: 'mousemove', buttons: 1, clientX: 5, clientY: 5 })
    win.emit('mouseup', { type: 'mouseup', buttons: 0 }) // real release
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 6, clientY: 6 })
    expect(doc.dispatched).toHaveLength(0)
  })

  it('a real pointerup also disarms', () => {
    const { scope, win, doc } = makeHarness()
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 0, clientY: 0 })
    win.emit('pointerup', { type: 'pointerup' })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 1, clientY: 1 })
    expect(doc.dispatched).toHaveLength(0)
  })

  it('window blur mid-drag rescues at the last known position; inner-element blur does not', () => {
    const { scope, win, doc } = makeHarness()
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 10, clientY: 10 })
    win.emit('mousemove', { type: 'mousemove', buttons: 1, clientX: 40, clientY: 30 })

    // A focus change BETWEEN elements inside the page also reaches the
    // window's capture listener — it must not end the drag.
    win.emit('blur', { type: 'blur', target: { some: 'input' } })
    expect(doc.dispatched).toHaveLength(0)

    // The window itself losing focus (alt-tab mid-drag) must.
    win.emit('blur', { type: 'blur', target: win })
    expect(doc.dispatched).toHaveLength(1)
    expect(doc.dispatched[0].clientX).toBe(40)
    expect(doc.dispatched[0].clientY).toBe(30)
  })

  it('visibilitychange → hidden rescues; a visible-change does not', () => {
    const { scope, win, doc } = makeHarness()
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 0, clientY: 0 })

    doc.emit('visibilitychange', { type: 'visibilitychange' }) // still 'visible'
    expect(doc.dispatched).toHaveLength(0)

    doc.visibilityState = 'hidden'
    doc.emit('visibilitychange', { type: 'visibilitychange' })
    expect(doc.dispatched).toHaveLength(1)
    expect(doc.dispatched[0].type).toBe('mouseup')
  })

  it('re-arms after a rescue: a fresh drag can be rescued again', () => {
    const { scope, win, doc } = makeHarness()
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 0, clientY: 0 })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 1, clientY: 1 })
    expect(doc.dispatched).toHaveLength(1)

    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 2, clientY: 2 })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 3, clientY: 3 })
    expect(doc.dispatched).toHaveLength(2)
  })

  it('uninstall removes every listener and is idempotent', () => {
    const { scope, win, doc, uninstall } = makeHarness()
    expect(scope.count() + win.count() + doc.count()).toBeGreaterThan(0)

    uninstall()
    expect(scope.count()).toBe(0)
    expect(win.count()).toBe(0)
    expect(doc.count()).toBe(0)

    // Events after uninstall are dead — nothing is armed, nothing dispatches.
    scope.emit('mousedown', { type: 'mousedown', buttons: 1, clientX: 0, clientY: 0 })
    win.emit('mousemove', { type: 'mousemove', buttons: 0, clientX: 1, clientY: 1 })
    expect(doc.dispatched).toHaveLength(0)

    uninstall() // second call must be a harmless no-op
    expect(scope.count()).toBe(0)
  })
})
