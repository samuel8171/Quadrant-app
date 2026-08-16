import { useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  colors: string[]
  onChange: (value: number) => void
}

const SEGMENTS = 10

export default function SegmentedSlider({ label, value, colors, onChange }: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const valueFromClientX = (clientX: number): void => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onChange(Math.round(ratio * SEGMENTS))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    trackRef.current?.setPointerCapture(e.pointerId)
    setDragging(true)
    valueFromClientX(e.clientX)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragging) return
    valueFromClientX(e.clientX)
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    trackRef.current?.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(Math.max(0, value - 1))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(Math.min(SEGMENTS, value + 1))
    }
  }

  return (
    <div className="review-slider-row">
      <span className="review-slider-label">{label}</span>
      <div className="review-slider">
        <div className="review-slider-value" style={{ left: `${value * 10}%` }}>
          {value * 10}%
        </div>
        <div
          ref={trackRef}
          className="review-slider-track"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={SEGMENTS}
          aria-valuenow={value}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="review-slider-segments">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span
                key={i}
                className="review-slider-segment"
                style={{
                  backgroundColor: i < value ? colors[i] : 'var(--border)'
                }}
              />
            ))}
          </div>
          <span
            className="review-slider-thumb"
            style={{ left: `${value * 10}%` }}
          />
        </div>
      </div>
    </div>
  )
}
