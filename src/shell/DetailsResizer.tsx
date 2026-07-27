import { PaneResizer, dragWidth } from '../common/PaneResizer'
import { DEFAULT_DETAILS_WIDTH_BOUNDS, type DetailsWidthBounds } from './detailsPreferences'

export interface DetailsResizeDelta {
  startWidth: number
  startClientX: number
  clientX: number
  direction: 'ltr' | 'rtl'
  bounds?: Pick<DetailsWidthBounds, 'min' | 'max'>
}

export function detailsWidthFromPointerDelta({
  startWidth,
  startClientX,
  clientX,
  direction,
  bounds = DEFAULT_DETAILS_WIDTH_BOUNDS
}: DetailsResizeDelta): number {
  return dragWidth({
    startWidth,
    startClientX,
    clientX,
    edge: 'inline-start',
    dir: direction,
    min: bounds.min,
    max: bounds.max
  })
}

export interface DetailsResizerProps {
  visible: boolean
  width: number
  direction: 'ltr' | 'rtl'
  ariaLabel: string
  onWidthChange: (width: number) => void
  onReset: () => void
  bounds?: Pick<DetailsWidthBounds, 'min' | 'max'>
}

export function DetailsResizer({
  visible,
  width,
  direction,
  ariaLabel,
  onWidthChange,
  onReset,
  bounds = DEFAULT_DETAILS_WIDTH_BOUNDS
}: DetailsResizerProps): JSX.Element | null {
  if (!visible) return null

  return (
    <div className="orbitpm-details-resizer" dir={direction}>
      <PaneResizer
        width={width}
        min={bounds.min}
        max={bounds.max}
        edge="inline-start"
        dir={direction}
        onWidthChange={onWidthChange}
        onReset={onReset}
        ariaLabel={ariaLabel}
      />
    </div>
  )
}

export default DetailsResizer
