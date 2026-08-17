import { useCallback, useEffect, useRef, useState } from 'react'

export function useClosing(onClose: () => void, duration = 160): {
  closing: boolean
  close: () => void
} {
  const [closing, setClosing] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      onClose()
    }, duration)
  }, [closing, duration, onClose])

  return { closing, close }
}
