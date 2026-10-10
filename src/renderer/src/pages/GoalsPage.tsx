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
import { useAutoAnimate } from '@formkit/auto-animate/react'
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
import { MOTION_EASE, MOTION_MS } from '../lib/motion'
import { useAppStore } from '../state/appStore'

/**
 * 卡片列表的增 / 删 / 让位动画交给 `@formkit/auto-animate`：它观察 `.goal-list`
 * 的 `childList`，对新增项做淡入、对删除项做淡出（并把被删节点临时改成
 * `position: absolute` 覆盖层，所以**兄弟项会让位** —— 也就是「上面的卡消失、
 * 下面的卡滑上来」），全部走 WAAPI 的 `transform` / `opacity`，不触发布局。
 *
 * ⚠️ 这里刻意**不再**保留上一版那套「`.goal-card-slot` 把
 * `grid-template-rows: 1fr → 0fr`」的移出动画：那是布局动画，每帧重算轨道 +
 * 重排整列，用户实测卡顿（2026-10-10）。
 */
const LIST_MOTION = { duration: MOTION_MS, easing: MOTION_EASE } as const


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
   * 这个窗口是**纯展示层**约定：`toggleGoal` 在点击那一刻就落库，窗口只决定
   * 卡片何时从主页摘除（摘除后再由历史列表接管）。窗口到点就直接摘 ——
   * 摘除时机不再取决于任何动画的时长，动画本身由 auto-animate 在节点离场时播。
   */
  const [holding, setHolding] = useState<ReadonlySet<string>>(() => new Set<string>())
  /** 每个目标当前挂着的保持窗口定时器。 */
  const timersRef = useRef(new Map<string, number>())

  const clearTimer = (id: string): void => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timersRef.current.delete(id)
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  /**
   * 保持窗口到点：把它从主页摘掉，交回历史列表。
   *
   * ⚠️ 这里**不做任何主动作画**，也不等任何过渡结束 —— 卡片从 DOM 里消失时
   * auto-animate 会自己播一段 `transform` + `opacity` 的移出动画，同时让下面的
   * 卡片滑上来补位。上一版那套「等 `grid-template-rows` 过渡的 `transitionend`、
   * 再挂一个兜底定时器」的写法（布局动画，实测卡顿）已整体删除。
   */
  const finishLeave = (id: string): void => {
    clearTimer(id)
    setHolding((prev) => withId(prev, id, false))
  }

  /**
   * 主页面的勾选动作 —— **先落库，再安排展示**。
   *
   * 顺序不能反：`toggleGoal` 是唯一的状态真源，保持窗口纯属展示层约定。
   * 先落库也意味着「点完立刻切页/刷新」不会丢状态，只是卡片直接出现在历史里
   * （少了三秒的过渡），这是可接受的降级。
   */
  const toggleWithHold = (id: string): void => {
    clearTimer(id)
    const goal = useAppStore.getState().data.goals.find((g) => g.id === id)
    if (!goal) return
    const willComplete = !goal.done
    toggleGoal(id)

    if (!willComplete) {
      // 窗口内反悔：勾选被取消，卡片原地留下（从未离开主页）。
      setHolding((prev) => withId(prev, id, false))
      return
    }

    setHolding((prev) => withId(prev, id, true))
    timersRef.current.set(
      id,
      window.setTimeout(() => finishLeave(id), COMPLETION_HOLD_MS)
    )
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
          onToggleGoal={toggleWithHold}
          onOpenHistory={() => setHistoryType('long')}
        />
        <GoalColumn
          type="short"
          title="短期目标"
          icon={Calendar}
          accentClass="accent-green"
          holding={holding}
          onToggleGoal={toggleWithHold}
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
  onToggleGoal: (id: string) => void
  onOpenHistory: () => void
}

function GoalColumn({
  type,
  title,
  icon: Icon,
  accentClass,
  holding,
  onToggleGoal,
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
  /** 新增 / 删除 / 完成的卡片动画都挂在列表这一个容器上（见 `LIST_MOTION` 的说明）。 */
  const [listRef] = useAutoAnimate<HTMLDivElement>(LIST_MOTION)



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
      <div className="goal-list" ref={listRef}>
        {goals.map((goal) => (
          <div key={goal.id} className={`goal-card${goal.done ? ' done' : ''}`}>
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
  /*
   * 历史页共用同一套增删动画（删除、以及「取消勾选回主页」都是离场）。
   * 列表为空时 `.goal-list` 会被换成空态文案、整个卸载 —— 那一刻 auto-animate
   * 的移出覆盖层挂在已脱离文档的节点上，看不见也不影响任何东西。
   */
  const [listRef] = useAutoAnimate<HTMLDivElement>(LIST_MOTION)

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
        <div className="goal-list" ref={listRef}>
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
