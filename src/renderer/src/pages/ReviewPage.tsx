import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, FileDown, FolderOpen } from 'lucide-react'
import AlertDialog from '../components/AlertDialog'
import ReviewRecords from '../components/review/ReviewRecords'
import SegmentedSlider from '../components/review/SegmentedSlider'
import { REVIEW_GREEN_RED, REVIEW_RED_GREEN } from '../lib/reviewRules'
import { useAppStore } from '../state/appStore'

type ReviewView = 'compose' | 'records'

export default function ReviewPage(): JSX.Element {
  const reviewEdit = useAppStore((s) => s.reviewEdit)
  const setReviewEdit = useAppStore((s) => s.setReviewEdit)
  const saveReviewDraft = useAppStore((s) => s.saveReviewDraft)

  const pageRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [view, setView] = useState<ReviewView>('compose')
  const [navDir, setNavDir] = useState<'none' | 'forward' | 'back'>('none')
  const [minH, setMinH] = useState(180)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const showToast = (msg: string): void => {
    setToast(msg)
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200)
  }

  const resizeTextarea = (): void => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(minH, ta.scrollHeight)}px`
  }

  useLayoutEffect(() => {
    const page = pageRef.current
    const ta = taRef.current
    if (!page || !ta) return
    const measure = (): void => {
      const pageRect = page.getBoundingClientRect()
      const taRect = ta.getBoundingClientRect()
      setMinH(Math.max(120, pageRect.bottom - 20 - taRect.top))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(page)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [view])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [reviewEdit.text, minH])

  const saveWord = async (): Promise<void> => {
    try {
      const record = await window.quadrantApi.saveReview(reviewEdit)
      saveReviewDraft()
      showToast(`已保存：${record.fileName}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const goRecords = (): void => {
    setNavDir('forward')
    setView('records')
  }

  const backCompose = (): void => {
    setNavDir('back')
    setView('compose')
  }

  if (view === 'records') {
    return (
      <div ref={pageRef} className="review-page">
        <div className={`review-view ${navDir === 'forward' ? 'page-enter-right' : ''}`}>
          <header className="page-header review-header">
            <button className="back-btn review-back" onClick={backCompose}>
              <ArrowLeft size={16} />
              返回
            </button>
            <h1>复盘记录</h1>
            <span className="title-underline" />
          </header>
          <ReviewRecords />
        </div>
      </div>
    )
  }

  return (
    <div ref={pageRef} className="review-page">
      <div className={`review-view review-compose ${navDir === 'back' ? 'page-enter-left' : ''}`}>
        <header className="page-header review-header">
          <h1>周日复盘</h1>
          <span className="title-underline" />
          <div className="review-header-actions">
            <button className="review-btn ghost" onClick={() => { saveReviewDraft(); showToast('草稿已保存') }}>
              <BookMarked size={15} />
              保存草稿
            </button>
            <button className="review-btn primary" onClick={() => void saveWord()}>
              <FileDown size={15} />
              保存
            </button>
            <button className="review-btn ghost" onClick={goRecords}>
              <FolderOpen size={15} />
              复盘记录
            </button>
          </div>
        </header>

        <div className="review-sliders">
          <SegmentedSlider
            label="计划完成度"
            value={reviewEdit.completion}
            colors={[...REVIEW_RED_GREEN]}
            onChange={(n) => setReviewEdit({ completion: n })}
          />
          <SegmentedSlider
            label="计划完成质量"
            value={reviewEdit.quality}
            colors={[...REVIEW_RED_GREEN]}
            onChange={(n) => setReviewEdit({ quality: n })}
          />
          <SegmentedSlider
            label="压力指数"
            value={reviewEdit.stress}
            colors={[...REVIEW_GREEN_RED]}
            onChange={(n) => setReviewEdit({ stress: n })}
          />
        </div>

        <textarea
          ref={taRef}
          className="review-textarea"
          value={reviewEdit.text}
          placeholder="写下本周的复盘…"
          onChange={(e) => setReviewEdit({ text: e.target.value })}
        />
      </div>

      {toast && <div className="review-toast">{toast}</div>}
      {error && <AlertDialog title="保存失败" message={error} onClose={() => setError(null)} />}
    </div>
  )
}
