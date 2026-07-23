// Watchdog for "stuck" canvas drags in bpmn-js / diagram-js.
//
// diagram-js 15.x `MoveCanvas` (node_modules/diagram-js/lib/navigation/
// movecanvas/MoveCanvas.js) starts a pan by binding `mousemove` + `mouseup` on
// `document` and only ends it when a `mouseup` actually REACHES `document`.
// When the browser swallows that mouseup — release outside the window, over
// devtools, over a cross-origin iframe, alt-tab / focus loss mid-drag, the
// native context menu — its `context` stays set and every later mousemove keeps
// scrolling the canvas: the handler never checks `event.buttons`. The bundled
// diagram-js-minimap has the exact same document-bound pattern for its
// viewport drag. We do NOT fork either library; instead this app-level
// watchdog detects the orphaned drag and ends it.
//
// Detection: a mousedown inside the diagram container arms the watchdog. If,
// while armed, we see a mousemove reporting `buttons === 0` (i.e. no button is
// held any more, so the release must have been swallowed), or the window blurs,
// or the tab is hidden, we "rescue" by dispatching a synthetic `mouseup` on
// `document`. Any real mouseup/pointerup simply disarms.
//
// Why a synthetic mouseup rather than reaching into diagram-js internals:
//  - `MoveCanvas.handleEnd` reads NOTHING from the event — it just unbinds its
//    listeners, clears `context` and resets the cursor — so any mouseup that
//    reaches `document` ends the pan exactly like a real release would.
//  - The core diagram-js `Dragging` service also binds `mouseup` (capture) on
//    `document`, so a stuck ELEMENT drag is likewise ended at its last
//    position, going through the library's own normal cleanup.
//  - The minimap's viewport drag cleans up in its own document `mouseup`
//    handler the same way.
// One synthetic event therefore lets every drag implementation run its OWN
// end-path — no private API, and it keeps working across library upgrades.
//
// The decision logic is a pure state machine (`createWatchdogState` +
// `watchdogDecide`) so it can be unit-tested exhaustively without a DOM;
// `installDragWatchdog` is the thin DOM binding around it.

/** The abstract input events the decision core consumes. */
export interface WatchdogEvent {
  type: 'down' | 'up' | 'move' | 'blur' | 'hidden'
  /** `MouseEvent.buttons` bitmask at the time of a `move` (0 = none held). */
  buttons?: number
  /** For `down`: did the press land inside the watched scope element? */
  insideScope?: boolean
}

/** What the caller must do in response to an event. Only `rescue` requires
 *  action (dispatch the synthetic mouseup); the others are informational. */
export type WatchdogAction = 'none' | 'arm' | 'disarm' | 'rescue'

export interface WatchdogState {
  /** True between a mousedown inside the scope and whatever ends the drag. */
  armed: boolean
}

export function createWatchdogState(): WatchdogState {
  return { armed: false }
}

/**
 * Advance the watchdog state machine by one event and return the action to
 * take. Mutates `state` in place; deterministic and DOM-free.
 *
 * Semantics:
 *  - `down` inside the scope arms (any button — a right-press that opens the
 *    native context menu is one of the very swallow scenarios we guard).
 *  - Any real `up` (mouseup/pointerup, anywhere) disarms. A drag that ended
 *    normally must never be rescued.
 *  - While armed, a `move` with `buttons === 0` means the release was
 *    swallowed → rescue (and disarm FIRST, so a rescue can never re-trigger).
 *    Moves with a button still held, or with unknown `buttons`, do nothing —
 *    missing data must never fire a spurious mouseup.
 *  - While armed, `blur` / `hidden` also rescue: once focus is gone the
 *    browser will not deliver the mouseup to us, so end the drag now rather
 *    than let it resume "glued to the cursor" when the user comes back.
 *  - While DISARMED every event is a no-op — in particular ordinary hover
 *    moves (which always report `buttons === 0`) never rescue.
 */
export function watchdogDecide(state: WatchdogState, event: WatchdogEvent): WatchdogAction {
  switch (event.type) {
    case 'down':
      if (event.insideScope === true) {
        state.armed = true
        return 'arm'
      }
      return 'none'
    case 'up':
      if (state.armed) {
        state.armed = false
        return 'disarm'
      }
      return 'none'
    case 'move':
      if (state.armed && event.buttons === 0) {
        // Disarm BEFORE the caller dispatches anything: even if the synthetic
        // mouseup re-enters our own listeners synchronously, the machine is
        // already at rest and cannot emit a second rescue.
        state.armed = false
        return 'rescue'
      }
      return 'none'
    case 'blur':
    case 'hidden':
      if (state.armed) {
        state.armed = false
        return 'rescue'
      }
      return 'none'
  }
}

// ---------------------------------------------------------------------------
// DOM installation
// ---------------------------------------------------------------------------

type ListenerLike = (ev: Event) => void

/** The slice of `Document` the watchdog touches — injectable so the node-env
 *  tests can hand in a hand-rolled fake (same pattern as mockFs). */
export interface DocLike {
  addEventListener(type: string, listener: ListenerLike, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: ListenerLike, options?: boolean | EventListenerOptions): void
  dispatchEvent(ev: Event): boolean
  readonly visibilityState?: string
}

/** The slice of `Window` the watchdog touches. `MouseEvent` is looked up on
 *  the injected window (a) so tests can substitute a plain fake class and
 *  (b) so the synthetic event is constructed in the same realm as the
 *  document it is dispatched on. */
export interface WinLike {
  addEventListener(type: string, listener: ListenerLike, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: ListenerLike, options?: boolean | EventListenerOptions): void
  MouseEvent: typeof MouseEvent
}

/** Structural view of the mouse fields we read off DOM events — real events
 *  and the tests' plain fake objects both satisfy it. */
interface MouseLike {
  readonly buttons?: number
  readonly clientX?: number
  readonly clientY?: number
}

/** Recursion guard, part two: rescue mouseups we dispatched ourselves. If one
 *  re-enters our own capture `mouseup` listener (it will — the event
 *  propagates through window), it is treated as a plain disarm and NEVER
 *  considered for re-dispatch. Module-scoped so even overlapping installs
 *  (e.g. two editors) recognise each other's synthetic events. */
const syntheticRescueUps = new WeakSet<object>()

/**
 * Bind the watchdog around a diagram container. Listeners are capture-phase
 * so they observe events BEFORE diagram-js's own document handlers: when the
 * poisoned `buttons === 0` mousemove arrives, the synthetic mouseup is
 * dispatched synchronously during its capture phase, which unbinds
 * MoveCanvas's move handler before the bubble phase would have scrolled the
 * canvas one last time.
 *
 * Returns an uninstaller that removes every listener (idempotent).
 */
export function installDragWatchdog(
  scope: HTMLElement,
  opts: { doc?: DocLike; win?: WinLike } = {}
): () => void {
  const doc = opts.doc ?? document
  const win = opts.win ?? window
  const state = createWatchdogState()

  // Last known pointer position, fed into the synthetic mouseup so drag
  // implementations that DO read coordinates (the core Dragging service ends
  // an element move at the event position) finish where the cursor last was.
  let lastX = 0
  let lastY = 0

  const remember = (ev: Event): void => {
    const me = ev as unknown as MouseLike
    if (typeof me.clientX === 'number') lastX = me.clientX
    if (typeof me.clientY === 'number') lastY = me.clientY
  }

  const dispatchRescue = (): void => {
    // `watchdogDecide` has already disarmed (guard part one); now dispatch so
    // MoveCanvas / minimap / Dragging run their own normal end handlers.
    const rescue = new win.MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      view: win as unknown as Window, // WinLike is structurally narrower
      button: 0,
      buttons: 0,
      clientX: lastX,
      clientY: lastY
    })
    syntheticRescueUps.add(rescue)
    doc.dispatchEvent(rescue)
  }

  const decideAndAct = (input: WatchdogEvent): void => {
    if (watchdogDecide(state, input) === 'rescue') dispatchRescue()
  }

  // Bound on the scope itself, so "inside the watched scope" holds by
  // construction; capture-phase so a stopPropagation inside the diagram
  // cannot hide the press from us.
  const onScopeDown = (ev: Event): void => {
    remember(ev)
    decideAndAct({ type: 'down', insideScope: true })
  }

  const onMove = (ev: Event): void => {
    remember(ev)
    const me = ev as unknown as MouseLike
    decideAndAct({ type: 'move', buttons: typeof me.buttons === 'number' ? me.buttons : undefined })
  }

  const onUp = (ev: Event): void => {
    // Our own synthetic mouseup echoing back through the window: plain
    // no-op/disarm, never re-dispatched (the state machine is disarmed
    // already, but the tag makes the guarantee independent of ordering).
    if (syntheticRescueUps.has(ev)) return
    decideAndAct({ type: 'up' })
  }

  const onBlur = (ev: Event): void => {
    // Only the WINDOW losing focus matters. Because we listen capture-phase
    // on window, focus moves BETWEEN elements inside the page (an input
    // blurring when the canvas is clicked, say) also pass through here —
    // those must not kill a drag that is just starting.
    if (ev.target !== (win as unknown)) return
    decideAndAct({ type: 'blur' })
  }

  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') decideAndAct({ type: 'hidden' })
  }

  scope.addEventListener('mousedown', onScopeDown, true)
  win.addEventListener('mousemove', onMove, true)
  win.addEventListener('mouseup', onUp, true)
  win.addEventListener('pointerup', onUp, true)
  win.addEventListener('blur', onBlur, true)
  doc.addEventListener('visibilitychange', onVisibility, true)

  let installed = true
  return () => {
    if (!installed) return
    installed = false
    scope.removeEventListener('mousedown', onScopeDown, true)
    win.removeEventListener('mousemove', onMove, true)
    win.removeEventListener('mouseup', onUp, true)
    win.removeEventListener('pointerup', onUp, true)
    win.removeEventListener('blur', onBlur, true)
    doc.removeEventListener('visibilitychange', onVisibility, true)
  }
}
