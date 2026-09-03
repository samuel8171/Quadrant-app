import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import type { ReviewRecord } from '../../../../shared/types'
import AlertDialog from '../AlertDialog'
import { getPlatformApi } from '../../lib/platformApi'

function formatModifiedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ReviewRecords(): JSX.Element {
  const [records, setRecords] = useState<ReviewRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getPlatformApi().listReviews().then((list) => {
      if (!alive) return
      setRecords(list)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const open = (record: ReviewRecord): void => {
    void getPlatformApi().openReview(record.filePath).then((res) => {
      if (!res.ok) setError(res.error ?? '无法打开文件')
    })
  }

  return (
    <div className="review-records">
      {!loaded ? (
        <div className="review-records-empty">加载中…</div>
      ) : records.length === 0 ? (
        <div className="review-records-empty">暂无复盘记录</div>
      ) : (
        <div className="review-records-list">
          {records.map((r) => (
            <button
              key={r.filePath}
              className="review-record-row"
              title="双击打开"
              onDoubleClick={() => open(r)}
            >
              <span className="review-record-icon">
                <FileText size={22} />
              </span>
              <span className="review-record-main">
                <span className="review-record-name">{r.fileName}</span>
                <span className="review-record-meta">类型: {r.filePath.startsWith('web-review:') ? '文本文件' : 'Word 文档'}</span>
              </span>
              <span className="review-record-date">{formatModifiedAt(r.modifiedAt)}</span>
              <span className="review-record-size">{formatSize(r.size)}</span>
            </button>
          ))}
        </div>
      )}
      {error && <AlertDialog title="无法打开" message={error} onClose={() => setError(null)} />}
    </div>
  )
}
