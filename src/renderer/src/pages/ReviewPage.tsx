import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, FileDown, FolderOpen } from 'lucide-react'
import AlertDialog from '../components/AlertDialog'
import ReviewRecords from '../components/review/ReviewRecords'
import SegmentedSlider from '../components/review/SegmentedSlider'
import WeekLedger from '../components/money/WeekLedger'
import { REVIEW_GREEN_RED, REVIEW_RED_GREEN } from '../lib/reviewRules'
import { getPlatformApi } from '../lib/platformApi'
import { composeReviewText, latestSettledWeek } from '../../../shared/money'
import { useAppStore } from '../state/appStore'

type ReviewView = 'compose' | 'records'

export default function ReviewPage(): JSX.Element {
  const data = useAppStore((s) => s.data)
  const reviewEdit = useAppStore((s) => s.reviewEdit)
  const setReviewEdit = useAppStore((s) => s.setReviewEdit)
  const saveReviewDraft = useAppStore((s) => s.saveReviewDraft)

  // 复盘汇入的唯一入参（spec §8）：仅当功能启用、且已有周结算时才有值。
  // 「从未启用」（money 缺席）与「已关闭」（enabled !== true）都在这里归为 undefined，
  // 于是 `composeReviewText` 走原样返回的分支 —— 关闭态的字节一致由构造保证，
  // 而不是靠导出层记得别加东西。
  const latestWeek = latestSettledWeek(data.money)

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
      // 唯一的汇入点：把本周账本摘要拼进正文后再交给导出链。
      // 导出层（reviewDoc.ts / platformApi.saveReview）一行不改 —— `ReviewExport`
      // 仍是 { completion, quality, stress, text }，没有 money 字段。
      const record = await getPlatformApi().saveReview({
        ...reviewEdit,
        text: composeReviewText(reviewEdit.text, latestWeek)
      })
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

        {latestWeek && <WeekLedger week={latestWeek} />}

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
