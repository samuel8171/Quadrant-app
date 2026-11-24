import { memo, useLayoutEffect, useRef, useState } from 'react'
import GlassSurface from '../glass/GlassSurface'

interface CardSize {
  width: number
  height: number
  radius: number
}

const CENTER = { top: '50%', left: '50%' }

function DashboardGlass(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<CardSize | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    // The grid lays out the card. The glass follows its dimensions on all breakpoints.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      const radius = parseFloat(getComputedStyle(host).borderTopLeftRadius)
      setSize((current) => current?.width === width && current.height === height && current.radius === radius
        ? current
        : { width, height, radius })
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="mine-card-glass" aria-hidden="true">
      {size && (
        <GlassSurface
          center={CENTER}
          padding="0"
          mode="standard"
          cornerRadius={size.radius}
          contentWidth={`${size.width}px`}
        >
          <div style={{ height: size.height }} />
        </GlassSurface>
      )}
    </div>
  )
}

export default memo(DashboardGlass)
