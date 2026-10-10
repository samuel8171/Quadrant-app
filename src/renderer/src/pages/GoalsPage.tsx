import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  History,
  Info,
  Lock,
  MoreHorizontal,
  Mountain,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { GoalType, Subtask } from '../../../shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import GlassSurface from '../components/glass/GlassSurface'
import { clampMenuCenter, MENU_PAD, useMenuRowHeight } from '../components/glass/glassMenu'
import GoalDetailDialog from '../components/GoalDetailDialog'
import { useClosing } from '../hooks/useClosing'
import {
  COMPLETION_HOLD_MS,
  MAX_GROUPS,
  canCheckSubtask,
  groupCountOf,
  groupTitleOf,
  partitionGoals,
  progressOf
} from '../lib/goalRules'
import { useAppStore } from '../state/appStore'

/**
 * 移出动画时长（毫秒），与 `theme.css` 的 `.goal-card-slot` 过渡时长**必须一致**。
 * 过渡结束由 `transitionend` 精确驱动，本常量只作为兜底定时器的依据。
 */
const LEAVE_MS = 200

/**
 * 兜底：`transitionend` 在少数情况下不会到来（`prefers-reduced-motion` 把过渡
 * 时长压成 0、标签页被挂起导致过渡帧丢失、插值未发生等），届时卡片会永远停在
 * 「正在移出」的 0 高状态。这个定时器保证它一定被清掉。
 */
const LEAVE_FALLBACK_MS = LEAVE_MS + 250

/** `Set` 的不可变增删：内容未变时**返回原对象**，避免无谓的重渲染。 */
function withId(set: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  if (set.has(id) === present) return set
  const next = new Set(set)
  if (present) next.add(id)
  else next.delete(id)
  return next
}

export default function GoalsPage(): JSX.Element {
  const activeGoalId = useAppStore((s) => s.activeGoalId)
  const toggleGoal = useAppStore((s) => s.toggleGoal)
  const [returning, setReturning] = useState(false)
  /** 非 null = 正在查看该类型的历史子页面。 */
  const [historyType, setHistoryType] = useState<GoalType | null>(null)
  /**
   * 已经完成、但仍在保持窗口内的目标（卡片留在主页）。
   *
   * 与 `leaving` 的关系：进入 `leaving` 时**仍留在 `holding` 里**，否则卡片会在
   * 动画开始前就被卸载，移出动画根本播不出来；直到动画结束（或兜底定时器到点）
   * 才把 id 从两个集合一起摘掉，卡片转由历史列表渲染。
   */
  const [holding, setHolding] = useState<ReadonlySet<string>>(() => new Set<string>())
  /** 正在播移出动画的目标。只驱动 CSS 类，不决定归属。 */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set<string>())
  /** 每个目标当前挂着的定时器（保持窗口 / 移出兜底）。 */
  const timersRef = useRef(new Map<string, number[]>())

  const clearTimers = (id: string): void => {
    for (const timer of timersRef.current.get(id) ?? []) window.clearTimeout(timer)
    timersRef.current.delete(id)
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const list of timers.values()) for (const timer of list) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  /** 卡片移出动画结束（或兜底到点）：正式从主页摘除，交给历史列表。 */
  const finishLeave = (id: string): void => {
    clearTimers(id)
    setHolding((prev) => withId(prev, id, false))
    setLeaving((prev) => withId(prev, id, false))
  }

  /**
   * 主页面的勾选动作 —— **先落库，再安排展示**。
   *
   * 顺序不能反：`toggleGoal` 是唯一的状态真源，保持窗口纯属展示层约定。
   * 先落库也意味着「点完立刻切页/刷新」不会丢状态，只是卡片直接出现在历史里
   * （少了三秒的过渡），这是可接受的降级。
   */
  const toggleWithHold = (id: string): void => {
    clearTimers(id)
    const goal = useAppStore.getState().data.goals.find((g) => g.id === id)
    if (!goal) return
    const willComplete = !goal.done
    toggleGoal(id)

    if (!willComplete) {
      // 窗口内反悔：勾选被取消，卡片原地留下（从未离开主页）。
      setHolding((prev) => withId(prev, id, false))
      setLeaving((prev) => withId(prev, id, false))
      return
    }

    setHolding((prev) => withId(prev, id, true))
    setLeaving((prev) => withId(prev, id, false))
    const hold = window.setTimeout(() => {
      setLeaving((prev) => withId(prev, id, true))
      const drop = window.setTimeout(() => finishLeave(id), LEAVE_FALLBACK_MS)
      timersRef.current.set(id, [drop])
    }, COMPLETION_HOLD_MS)
    timersRef.current.set(id, [hold])
  }

  if (activeGoalId) {
    return <LongTermDetailPage goalId={activeGoalId} onBeforeClose={() => setReturning(true)} />
  }
  if (historyType) {
    return (
      <GoalHistoryPage
        type={historyType}
        holding={holding}
        onToggle={toggleWithHold}
        onClose={() => {
          setReturning(true)
          setHistoryType(null)
        }}
      />
    )
  }
  return (
    <div className={`page goals-page ${returning ? 'page-enter-left' : ''}`}>
      <header className="page-header">
        <h1>目标</h1>
        <span className="title-underline" />
      </header>
      <div className="goal-columns">
        <GoalColumn
          type="long"
          title="长期目标"
          icon={Mountain}
          accentClass="accent-blue"
          holding={holding}
          leaving={leaving}
          onToggleGoal={toggleWithHold}
          onFinishLeave={finishLeave}
          onOpenHistory={() => setHistoryType('long')}
        />
        <GoalColumn
          type="short"
          title="短期目标"
          icon={Calendar}
          accentClass="accent-green"
          holding={holding}
          leaving={leaving}
          onToggleGoal={toggleWithHold}
          onFinishLeave={finishLeave}
          onOpenHistory={() => setHistoryType('short')}
        />
      </div>
    </div>
  )
}

interface GoalColumnProps {
  type: GoalType
  title: string
  icon: typeof Mountain
  accentClass: string
  holding: ReadonlySet<string>
  leaving: ReadonlySet<string>
  onToggleGoal: (id: string) => void
  onFinishLeave: (id: string) => void
  onOpenHistory: () => void
}

function GoalColumn({
  type,
  title,
  icon: Icon,
  accentClass,
  holding,
  leaving,
  onToggleGoal,
  onFinishLeave,
  onOpenHistory
}: GoalColumnProps): JSX.Element {
  const allGoals = useAppStore((s) => s.data.goals)
  const addGoal = useAppStore((s) => s.addGoal)
  const updateGoalRemark = useAppStore((s) => s.updateGoalRemark)
  const { active: goals, history } = partitionGoals(allGoals, type, holding)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  /** 窄屏上「…」展开的目标，其操作走底部菜单。 */
  const [moreForId, setMoreForId] = useState<string | null>(null)


  const submitNew = (): void => {
    if (draft.trim()) addGoal(type, draft)
    setDraft('')
    setAdding(false)
  }

  const submitEdit = (id: string): void => {
    useAppStore.getState().updateGoalTitle(id, editingText)
    setEditingId(null)
  }

  const detailGoal = detailId ? goals.find((g) => g.id === detailId) : undefined
  const deletePendingGoal = deletePendingId
    ? goals.find((g) => g.id === deletePendingId)
    : undefined
  const moreGoal = moreForId ? goals.find((g) => g.id === moreForId) : undefined

  return (
    <section className={`goal-column ${accentClass}`}>
      <h2 className="goal-column-title">
        <Icon size={18} />
        {title}
        {/*
         * 历史入口按列分设：长期与短期各有一份历史，两列各自独立。
         * 计数用 `history`（已完成且已离开保持窗口），因此刚点完的瞬间
         * 计数还是旧值、卡片也还在下面 —— 两者是一致的。
         */}
        <button
          className="goal-history-btn"
          title={`查看已完成的${title}`}
          aria-haspopup="dialog"
          onClick={onOpenHistory}
        >
          <History size={14} />
          <span>历史{history.length > 0 ? ` · ${history.length}` : ''}</span>
        </button>
      </h2>
      <div className="goal-list">
        {goals.map((goal) => (
          /*
           * 卡片外面套一层「可折叠槽位」：完成后的移出动画靠
           * `grid-template-rows: 1fr → 0fr` 把高度压到 0（与 `.preset-collapse`
           * 同一套手法），间距也一并收掉，所以下面各行的 8px 间距由
           * `.goal-card-slot + .goal-card-slot` 的 margin 承担，而不是 `.goal-list` 的 gap。
           */
          <div
            key={goal.id}
            className={`goal-card-slot${leaving.has(goal.id) ? ' is-leaving' : ''}`}
            onTransitionEnd={(e) => {
              // transitionend 会从子元素冒泡上来，只认槽位自己那一条属性。
              if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-rows') return
              onFinishLeave(goal.id)
            }}
          >
          <div className={`goal-card${goal.done ? ' done' : ''}`}>
            <label className="goal-check">
              <input
                type="checkbox"
                checked={goal.done}
                onChange={() => onToggleGoal(goal.id)}
              />
              <span className="checkmark" />
            </label>

            {editingId === goal.id ? (
              <input
                className="goal-edit-input"
                value={editingText}
                autoFocus
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => submitEdit(goal.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitEdit(goal.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="goal-title">{goal.title}</span>
            )}
            {goal.type === 'long' && goal.subtasks.length > 0 && (
              <span className="goal-progress">
                {progressOf(goal).done}/{progressOf(goal).total}
              </span>
            )}
            {/* 「展开子目标」是长目标的高频入口，按约定留在卡片上；其余三个收进 "…"。 */}
            {goal.type === 'long' && (
              <button
                className="icon-btn"
                title="展开子目标"
                onClick={() => useAppStore.getState().openGoal(goal.id)}
              >
                <ChevronRight size={16} />
              </button>
            )}
            <span className="goal-actions">
              <button className="icon-btn" title="详细信息" onClick={() => setDetailId(goal.id)}>
                <Info size={15} />
              </button>
              <button
                className="icon-btn"
                title="编辑"
                onClick={() => {
                  setEditingId(goal.id)
                  setEditingText(goal.title)
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn danger"
                title="删除"
                onClick={() => setDeletePendingId(goal.id)}
              >
                <Trash2 size={15} />
              </button>
            </span>
            <button
              className="icon-btn goal-more"
              title="更多操作"
              aria-haspopup="menu"
              onClick={() => setMoreForId(goal.id)}
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="add-goal-row">
          <input
            autoFocus
            value={draft}
            placeholder="输入目标名称"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        </div>
      ) : (
        <button className="add-goal-btn" onClick={() => setAdding(true)}>
          <Plus size={16} />
          添加{title}
        </button>
      )}
      {detailGoal && (
        <GoalDetailDialog
          title={detailGoal.title}
          remark={detailGoal.remark}
          onSave={(remark) => updateGoalRemark(detailGoal.id, remark)}
          onClose={() => setDetailId(null)}
        />
      )}
      {deletePendingGoal && (
        <ConfirmDialog
          message={`确定删除目标「${deletePendingGoal.title}」？`}
          onConfirm={() => useAppStore.getState().deleteGoal(deletePendingGoal.id)}
          onCancel={() => setDeletePendingId(null)}
        />
      )}
      {moreGoal && (
        <OverflowMenu
          onClose={() => setMoreForId(null)}
          items={[
            { label: '详细信息', icon: Info, onSelect: () => setDetailId(moreGoal.id) },
            {
              label: '编辑',
              icon: Pencil,
              onSelect: () => {
                setEditingId(moreGoal.id)
                setEditingText(moreGoal.title)
              }
            },
            { label: '删除', icon: Trash2, danger: true, onSelect: () => setDeletePendingId(moreGoal.id) }
          ]}
        />
      )}
    </section>
  )
}

interface GoalHistoryPageProps {
  type: GoalType
  /** 仍在保持窗口内的目标 id：它们此刻属于主页，不属于历史。 */
  holding: ReadonlySet<string>
  onToggle: (id: string) => void
  onClose: () => void
}

/**
 * 已完成目标的归档页（**两列各一份**，入口在各自列标题右侧）。
 *
 * 归属判据与主页完全同源（`partitionGoals`），所以「一张卡片在任一时刻只出现在
 * 一边」这条不变量跨页也成立：正处在保持窗口里的目标不会同时出现在主页与历史。
 *
 * **取消勾选即回主页** —— 走的是主页那一套 `toggleWithHold`，它在「取消完成」
 * 分支里只做集合清理、不排保持窗口，所以卡片回到主页后立刻可见，不会再等三秒。
 *
 * **长期目标的「展开子目标」入口原样保留**：`LongTermDetailPage` 按 `activeGoalId`
 * 取目标、不看 `done`，因此从历史进去管理子目标与从主页进去完全等价（改的也只是
 * 子目标，回到这里时若又被勾满会重新入历史，语义自洽）。
 */
function GoalHistoryPage({ type, holding, onToggle, onClose }: GoalHistoryPageProps): JSX.Element {
  const allGoals = useAppStore((s) => s.data.goals)
  const { history } = partitionGoals(allGoals, type, holding)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null)
  const [moreForId, setMoreForId] = useState<string | null>(null)

  const title = type === 'long' ? '长期目标' : '短期目标'
  const detailGoal = detailId ? history.find((g) => g.id === detailId) : undefined
  const deletePendingGoal = deletePendingId
    ? history.find((g) => g.id === deletePendingId)
    : undefined
  const moreGoal = moreForId ? history.find((g) => g.id === moreForId) : undefined

  return (
    <div className="page goals-page page-enter-right">
      <div className="subtask-topbar">
        <button className="back-btn" onClick={onClose}>
          <ArrowLeft size={16} />
          返回
        </button>
        <header className="subtask-header">
          <h1>{title} · 历史</h1>
          {history.length > 0 && <span className="subtask-progress">已完成 {history.length} 项</span>}
        </header>
      </div>
      {history.length === 0 ? (
        <div className="goal-history-empty">暂无已完成的目标</div>
      ) : (
        <div className="goal-list">
          {history.map((goal) => (
            <div key={goal.id} className="goal-card done">
              <label className="goal-check" title="取消勾选即回到目标主页">
                <input type="checkbox" checked onChange={() => onToggle(goal.id)} />
                <span className="checkmark" />
              </label>
              <span className="goal-title">{goal.title}</span>
              {goal.type === 'long' && goal.subtasks.length > 0 && (
                <span className="goal-progress">
                  {progressOf(goal).done}/{progressOf(goal).total}
                </span>
              )}
              {goal.type === 'long' && (
                <button
                  className="icon-btn"
                  title="展开子目标"
                  onClick={() => useAppStore.getState().openGoal(goal.id)}
                >
                  <ChevronRight size={16} />
                </button>
              )}
              <span className="goal-actions">
                <button
                  className="icon-btn danger"
                  title="删除"
                  onClick={() => setDeletePendingId(goal.id)}
                >
                  <Trash2 size={15} />
                </button>
              </span>
              <button
                className="icon-btn goal-more"
                title="更多操作"
                aria-haspopup="menu"
                onClick={() => setMoreForId(goal.id)}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      {detailGoal && (
        <GoalDetailDialog
          title={detailGoal.title}
          remark={detailGoal.remark}
          onSave={(remark) => useAppStore.getState().updateGoalRemark(detailGoal.id, remark)}
          onClose={() => setDetailId(null)}
        />
      )}
      {deletePendingGoal && (
        <ConfirmDialog
          message={`确定删除目标「${deletePendingGoal.title}」？`}
          onConfirm={() => useAppStore.getState().deleteGoal(deletePendingGoal.id)}
          onCancel={() => setDeletePendingId(null)}
        />
      )}
      {moreGoal && (
        <OverflowMenu
          onClose={() => setMoreForId(null)}
          items={[
            { label: '详细信息', icon: Info, onSelect: () => setDetailId(moreGoal.id) },
            {
              label: '删除',
              icon: Trash2,
              danger: true,
              onSelect: () => setDeletePendingId(moreGoal.id)
            }
          ]}
        />
      )}
    </div>
  )
}

interface OverflowItem {
  label: string
  icon: typeof Info
  danger?: boolean
  onSelect: () => void
}

/**
 * 窄屏卡片操作的弹出菜单。
 *
 * 形态是「贴底弹出的抽屉菜单」，不跟随指针：窄屏上手指按住的是卡片，
 * 菜单出现在底部拇指区比压在指尖下方更好点。因此定位不走 menuGeometry
 * （那是「左上角对齐指针」的语义），而是自己算底部锚点，见下面的 center。
 *
 * 玻璃化之后**不再复用 `.context-menu`**：它的手机档自带一套手搓的
 * backdrop-filter 与 left/right 定位，会和玻璃层抢同一批属性（背景糊两层、
 * 定位被 over-constrain）。行高仍读同一个 `--gs-menu-row`（手机 48px），
 * 与另外两处菜单同源。
 */
function OverflowMenu({
  items,
  onClose
}: {
  items: OverflowItem[]
  onClose: () => void
}): JSX.Element {
  const { closing, close } = useClosing(onClose, 140)

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      /*
       * 判据是玻璃的**定位层**而不是菜单本身。它是菜单的 DOM 祖先，
       * `closest` 沿祖先链上溯即可命中，且不受该层 `pointer-events: none`
       * 的影响（closest 只看树结构，不看命中测试）。
       * 用 .gs-layer--menu 与另外两处菜单保持一致。
       */
      if (target && target.closest('.gs-layer--menu')) return
      close()
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [close])

  const rowH = useMenuRowHeight()
  const panelH = items.length * rowH + MENU_PAD * 2

  return (
    <GlassSurface
      /*
       * 中心点 = 面板底边再上移半个面板高。
       * 底边距底部 `12px + 导航条高 + 安全区`——与改动前 `.context-menu`
       * 手机档的 `bottom` 表达式逐字一致，改一处要同步另一处。
       * 全程 CSS 表达式，不需要测量，因此不会出现"先错位再纠正"的闪动。
       *
       * 外面再套一层 `clampMenuCenter`：这条例子里 `panelH/2` 是"往上退"的量，
       * 菜单项一多（或横屏这类矮视口）就会退到屏幕上方之外 —— 它的底边约束是硬的，
       * 但**上边不是**。钳制后最多与顶部保持 8px 间距，绝不会有一半菜单跑出屏幕。
       */
      center={{
        top: clampMenuCenter(
          `calc(100% - 12px - var(--mobile-nav-height) - env(safe-area-inset-bottom) - ${panelH / 2}px)`,
          panelH / 2
        ),
        left: '50%'
      }}
      /* 改动前是 left/right 各 12px，故内容宽 = 100vw − 24 − 两侧内边距 */
      contentWidth={`calc(100vw - ${24 + MENU_PAD * 2}px)`}
      padding={`${MENU_PAD}px`}
      layerClassName="gs-layer--menu"
      contentRole="menu"
      anim={closing ? 'out' : 'in'}
    >
      {items.map(({ label, icon: Icon, danger, onSelect }) => (
        <button
          key={label}
          role="menuitem"
          className={`context-item${danger ? ' danger' : ''}`}
          onClick={() => {
            onSelect()
            close()
          }}
        >
          <Icon size={15} />
          {label}
        </button>
      ))}
    </GlassSurface>
  )
}

function LongTermDetailPage({
  goalId,
  onBeforeClose
}: {
  goalId: string
  onBeforeClose: () => void
}): JSX.Element {
  const goal = useAppStore((s) => s.data.goals.find((g) => g.id === goalId))
  const closeGoal = useAppStore((s) => s.closeGoal)
  const addGroup = useAppStore((s) => s.addGroup)
  const renameGroup = useAppStore((s) => s.renameGroup)
  const removeGroup = useAppStore((s) => s.removeGroup)
  const addSubtask = useAppStore((s) => s.addSubtask)
  const toggleSubtask = useAppStore((s) => s.toggleSubtask)
  const updateSubtaskTitle = useAppStore((s) => s.updateSubtaskTitle)
  const updateSubtaskRemark = useAppStore((s) => s.updateSubtaskRemark)
  const deleteSubtask = useAppStore((s) => s.deleteSubtask)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [detailSubtaskId, setDetailSubtaskId] = useState<string | null>(null)
  const [deletePendingSubtaskId, setDeletePendingSubtaskId] = useState<string | null>(null)
  const [deletePendingGroup, setDeletePendingGroup] = useState<number | null>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const areaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const update = (): void => {
      setArea({ width: el.clientWidth, height: el.clientHeight })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!goal) {
    return (
      <div className="page page-enter-right">
        <button
          className="back-btn"
          onClick={() => {
            onBeforeClose()
            closeGoal()
          }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
      </div>
    )
  }

  const { done, total } = progressOf(goal)
  const groupCount = groupCountOf(goal)
  const rows = groupCount <= 2 ? 1 : Math.ceil(groupCount / 2)
  const cols = groupCount === 1 ? 1 : 2
  const gap = 16

  let gridStyle: React.CSSProperties
  if (groupCount === 1) {
    gridStyle = { width: 'min(96%, 860px)', height: '96%' }
  } else if (groupCount === 2) {
    gridStyle = { width: '100%', height: '100%' }
  } else {
    const scrollbar = 14
    const cellW = Math.max(140, (area.width - gap - scrollbar) / 2)
    const cellH = Math.max(140, (area.height - gap) / 2)
    gridStyle = {
      width: cellW * 2 + gap,
      height: cellH * rows + (rows - 1) * gap
    }
  }

  const detailSubtask = detailSubtaskId
    ? goal.subtasks.find((s) => s.id === detailSubtaskId)
    : undefined
  const deletePendingSubtask = deletePendingSubtaskId
    ? goal.subtasks.find((s) => s.id === deletePendingSubtaskId)
    : undefined

  return (
    <div className="page subtask-page page-enter-right">
      <div className="subtask-topbar">
        <button
          className="back-btn"
          onClick={() => {
            onBeforeClose()
            closeGoal()
          }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <header className="subtask-header">
          <h1>{goal.title}</h1>
          <span className="subtask-progress">
            进度 {done}/{total}
          </span>
        </header>
        <button
          className="add-group-btn"
          disabled={groupCount >= MAX_GROUPS}
          title={groupCount >= MAX_GROUPS ? `最多 ${MAX_GROUPS} 个分组` : '添加分组'}
          onClick={() => addGroup(goalId)}
        >
          <Plus size={15} />
          添加分组
        </button>
      </div>
      <div ref={areaRef} className="subtask-area">
        <div
          className="group-grid"
          style={{
            ...gridStyle,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
          }}
        >
          {Array.from({ length: groupCount }, (_, i) => i + 1).map((group) => (
            <GroupCard
              key={group}
              group={group}
              title={groupTitleOf(goal, group)}
              showTitle={groupCount > 1}
              subtasks={goal.subtasks.filter((s) => s.group === group)}
              canCheck={(subtask) => canCheckSubtask(goal, subtask)}
              editingId={editingId}
              editingText={editingText}
              onStartEdit={(subtask) => {
                setEditingId(subtask.id)
                setEditingText(subtask.title)
              }}
              onChangeEdit={setEditingText}
              onCommitEdit={(subtask) => {
                updateSubtaskTitle(goalId, subtask.id, editingText)
                setEditingId(null)
              }}
              onCancelEdit={() => setEditingId(null)}
              onToggle={(subtask) => toggleSubtask(goalId, subtask.id)}
              onDelete={(subtask) => setDeletePendingSubtaskId(subtask.id)}
              onDetail={(subtask) => setDetailSubtaskId(subtask.id)}
              onAdd={(text) => addSubtask(goalId, text, group)}
              onRename={(text) => renameGroup(goalId, group, text)}
              canDelete={groupCount > 1}
              onDeleteGroup={() => setDeletePendingGroup(group)}
            />
          ))}
        </div>
      </div>
      {detailSubtask && (
        <GoalDetailDialog
          title={detailSubtask.title}
          remark={detailSubtask.remark}
          onSave={(remark) => updateSubtaskRemark(goalId, detailSubtask.id, remark)}
          onClose={() => setDetailSubtaskId(null)}
        />
      )}
      {deletePendingSubtask && (
        <ConfirmDialog
          message={`确定删除子目标「${deletePendingSubtask.title}」？`}
          onConfirm={() => deleteSubtask(goalId, deletePendingSubtask.id)}
          onCancel={() => setDeletePendingSubtaskId(null)}
        />
      )}
      {deletePendingGroup !== null && (
        <ConfirmDialog
          message={`确定删除「${groupTitleOf(goal, deletePendingGroup)}」？组内 ${
            goal.subtasks.filter((s) => s.group === deletePendingGroup).length
          } 个子目标将一并删除。`}
          onConfirm={() => removeGroup(goalId, deletePendingGroup)}
          onCancel={() => setDeletePendingGroup(null)}
        />
      )}
    </div>
  )
}

interface GroupCardProps {
  group: number
  title: string
  showTitle: boolean
  subtasks: Subtask[]
  canCheck: (subtask: Subtask) => boolean
  editingId: string | null
  editingText: string
  onStartEdit: (subtask: Subtask) => void
  onChangeEdit: (text: string) => void
  onCommitEdit: (subtask: Subtask) => void
  onCancelEdit: () => void
  onToggle: (subtask: Subtask) => void
  onDelete: (subtask: Subtask) => void
  onDetail: (subtask: Subtask) => void
  onAdd: (text: string) => void
  onRename: (text: string) => void
  canDelete: boolean
  onDeleteGroup: () => void
}

function GroupCard({
  title,
  showTitle,
  subtasks,
  canCheck,
  editingId,
  editingText,
  onStartEdit,
  onChangeEdit,
  onCommitEdit,
  onCancelEdit,
  onToggle,
  onDelete,
  onDetail,
  onAdd,
  onRename,
  canDelete,
  onDeleteGroup
}: GroupCardProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [moreSubtaskId, setMoreSubtaskId] = useState<string | null>(null)

  const moreSubtask = moreSubtaskId
    ? subtasks.find((item) => item.id === moreSubtaskId)
    : undefined

  const submit = (): void => {
    if (draft.trim()) onAdd(draft)
    setDraft('')
  }

  return (
    <section className="group-card">
      {showTitle &&
        (renaming ? (
          <div className="group-card-head">
            <input
              className="group-title-input"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                onRename(name)
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRename(name)
                  setRenaming(false)
                }
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          </div>
        ) : (
          <div className="group-card-head">
            <h3
              className="group-card-title"
              title="双击重命名分组"
              onDoubleClick={() => {
                setName(title)
                setRenaming(true)
              }}
            >
              {title}
            </h3>
            <button
              className="icon-btn group-rename-btn"
              title="重命名分组"
              aria-label="重命名分组"
              onClick={() => {
                setName(title)
                setRenaming(true)
              }}
            >
              <Pencil size={15} />
            </button>
            {canDelete && (
              <button
                className="icon-btn danger group-delete-btn"
                title="删除分组"
                onClick={onDeleteGroup}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      <div className="group-card-body">
        {subtasks.map((subtask) => {
          const locked = !canCheck(subtask) && !subtask.done
          return (
            <div key={subtask.id} className={`subtask-card${subtask.done ? ' done' : ''}`}>
              <label
                className={`goal-check${locked ? ' locked' : ''}`}
                title={locked ? '该分组尚未解锁' : undefined}
              >
                <input
                  type="checkbox"
                  checked={subtask.done}
                  disabled={locked}
                  onChange={() => onToggle(subtask)}
                />
                <span className="checkmark" />
              </label>
              {locked && <Lock size={13} className="lock-icon" />}
              {editingId === subtask.id ? (
                <input
                  className="goal-edit-input"
                  value={editingText}
                  autoFocus
                  onChange={(e) => onChangeEdit(e.target.value)}
                  onBlur={() => onCommitEdit(subtask)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onCommitEdit(subtask)
                    if (e.key === 'Escape') onCancelEdit()
                  }}
                />
              ) : (
                <span className="goal-title">{subtask.title}</span>
              )}
              <span className="goal-actions">
                <button className="icon-btn" title="详细信息" onClick={() => onDetail(subtask)}>
                  <Info size={15} />
                </button>
                <button className="icon-btn" title="编辑" onClick={() => onStartEdit(subtask)}>
                  <Pencil size={15} />
                </button>
                <button className="icon-btn danger" title="删除" onClick={() => onDelete(subtask)}>
                  <Trash2 size={15} />
                </button>
              </span>
              <button
                className="icon-btn goal-more"
                title="更多操作"
                aria-haspopup="menu"
                onClick={() => setMoreSubtaskId(subtask.id)}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          )
        })}
        {subtasks.length === 0 && <div className="group-empty">暂无子目标</div>}
      </div>
      <div className="add-subtask-row">
        <input
          value={draft}
          placeholder="新子目标"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="add-goal-btn" onClick={submit}>
          <Plus size={16} />
          添加子目标
        </button>
      </div>
      {moreSubtask && (
        <OverflowMenu
          onClose={() => setMoreSubtaskId(null)}
          items={[
            { label: '详细信息', icon: Info, onSelect: () => onDetail(moreSubtask) },
            { label: '编辑', icon: Pencil, onSelect: () => onStartEdit(moreSubtask) },
            { label: '删除', icon: Trash2, danger: true, onSelect: () => onDelete(moreSubtask) }
          ]}
        />
      )}
    </section>
  )
}
