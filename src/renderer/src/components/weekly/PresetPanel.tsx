import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import type { WeekPreset } from '../../../../shared/types'
import { useClosing } from '../../hooks/useClosing'
import { withAlpha } from '../../lib/color'
import { MOTION_EASE, MOTION_MS, MOTION_SETTLE_MS } from '../../lib/motion'
import { QUADRANT_META } from '../../lib/quadrantMath'
import { formatDuration } from '../../lib/weekRules'
import { shouldUsePresetOnTap } from '../../lib/weeklyMobileLayout'
import { PRESET_DRAG_MIME, beginPresetDrag, endPresetDrag } from '../../lib/presetDrag'
import { moveWithin, orderAfterDrop, resolveDropIndex, type Axis, type DropTarget } from '../../lib/presetReorder'

/**
 * 让位/落位的时长与缓动。**这三个字面量同时喂给两个地方**：
 * ① `useAutoAnimate` 的 options（兄弟块让位，由库用 WAAPI 播）；
 * ② 幽灵卡片落位时的内联 transition（见下面的 `ghostStyle`）。
 * 之所以能在 JS 里写死而不用 CSS 变量：幽灵的 transition 也是内联给的，
 * 不需要 CSS 参与。
 *
 * ⭐ 取值本身挪到了 `lib/motion.ts` —— 目标页的增删动画用的是同一套节奏，
 * 两处各写一份就会各自漂移（取值理由也在那里）。
 */
const REORDER_MS = MOTION_MS
const REORDER_EASE = MOTION_EASE
/** 落位比让位略短促一点，避免拖泥带水。 */
const SETTLE_MS = MOTION_SETTLE_MS

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  presets: WeekPreset[]
  onAdd: () => void
  onEdit: (preset: WeekPreset) => void
  onUse: (preset: WeekPreset) => void
  onDelete: (preset: WeekPreset) => void
  /**
   * 提交新的显示顺序（**id 全序列**）。
   *
   * 面板自己不碰 store：其余动作也都由 props 传入，由 `DayView` 接到
   * `setPresetOrder` 上。这样顺序的持久化方式换一种，面板一行都不用改。
   */
  onReorder: (ids: string[]) => void
}

/**
 * 一次拖拽会话里**固定不变**的量。
 *
 * ⭐ 几何一律用**列表内容坐标系**，不是视口坐标。这是为了让"拖动期间滚动了列表"
 * 仍然正确：视口坐标会随 `scrollTop`/`scrollLeft` 整片平移，一旦用户在中途滚动
 * （桌面端滚轮、手机端带惯性的横滑都能发生），按下时记下的那批坐标就全部作废，
 * 表现为"看得见的槽位放不进去"（2026-10-10 用户报告）。
 * 内容坐标下槽位是固定的，只有**指针**需要按当前滚动量重新换算。
 *
 * 换算：`内容 = 视口 − 列表矩形左上角 + 滚动量`。
 */
interface DragSession {
  id: string
  axis: Axis
  /** 按下点相对卡片左上角的偏移，跟手用（视口坐标，会话内不变）。 */
  grabX: number
  grabY: number
  /**
   * 卡片按下时的视口矩形 —— 幽灵卡片的基准框。
   * 幽灵挂在 `document.body` 上用视口坐标跟指针走，与列表滚动无关，所以这里保持视口系。
   */
  base: { left: number; top: number; width: number; height: number }
  /** 槽位左上角，**列表内容坐标系**，按数组顺序（= 按下时的 DOM 顺序 = 槽位顺序）。 */
  slots: { left: number; top: number }[]
  /** 喂给 `resolveDropIndex` 的轴向矩形，同一套内容坐标系。 */
  targets: DropTarget[]
}

type DragPhase = 'dragging' | 'settling'

interface DragState {
  id: string
  pointer: { x: number; y: number }
  /** 插入下标，坐标系是"剔除被拖项之后"（与 `resolveDropIndex` / `orderAfterDrop` 同口径）。 */
  index: number
  phase: DragPhase
  /** `settling` 阶段幽灵飞向的目标槽位左上角（视口坐标）。 */
  settleTo: { left: number; top: number } | null
}

/**
 * 列表的「内容坐标系原点」：视口坐标减去它就得到内容坐标，加上它回到视口坐标。
 *
 * 每次要用时**现读**（`getBoundingClientRect` + `scrollTop/Left`），不要缓存 ——
 * 缓存下来的就是"滚动前的原点"，正是这条 bug 的来源。
 */
function listOrigin(list: HTMLDivElement): { x: number; y: number } {
  const rect = list.getBoundingClientRect()
  return { x: rect.left - list.scrollLeft, y: rect.top - list.scrollTop }
}

export default function PresetPanel({
  presets,
  onAdd,
  onEdit,
  onUse,
  onDelete,
  onReorder
}: Props): JSX.Element {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth
  )
  /*
   * 窄屏默认收起。展开态的抽屉是浮层，会盖住时间轴下部约 190px（实测），
   * 一进来就默认展开等于白送掉这些像素；桌面端面板在侧栏里不遮挡任何东西，仍默认展开。
   */
  const [expanded, setExpanded] = useState(
    () => !shouldUsePresetOnTap(typeof window === 'undefined' ? 1024 : window.innerWidth)
  )
  /** 「调整顺序」模式。开启后卡片不再响应点击/拖到时间轴，只做排序。 */
  const [reorder, setReorder] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const indexRef = useRef(0)
  const settleTimerRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  /*
   * 兄弟块的「让位」动画。库用 `MutationObserver(childList)` 监听 `.preset-list`，
   * 在子元素被移动时对所有位置变化的子元素做 FLIP（WAAPI）。
   *
   * ⚠️ 三件事必须同时成立，否则会让位动画失效或打架：
   * ① 被拖的那张卡片**不能留在被观察的子树里由库去动画**——库的 WAAPI 动画在层叠里
   *    高于内联样式，会盖掉我们的"跟手 transform"。故拖拽期间它 `visibility: hidden`
   *    （仍占槽位 → 它就是那个"空位"），真正跟手的是挂在 `document.body` 上的**幽灵副本**。
   * ② 只有"DOM 顺序真的变了"才会触发补间 ⇒ 拖动期间必须按**草稿顺序**渲染，
   *    不能像以前那样只画一条指示线。
   * ③ ref 必须是**稳定**的：`useAutoAnimate` 返回的是 ref 回调，一旦身份每次渲染都变，
   *    React 会先以 null 再以节点调用它，库就会不停销毁/重建控制器，动画全丢。
   *    所以这里用 `useCallback` 把两个 ref 合成一个。
   */
  const [animateRef] = useAutoAnimate<HTMLDivElement>({ duration: REORDER_MS, easing: REORDER_EASE })
  const attachListRef = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el
      animateRef(el)
    },
    [animateRef]
  )

  useEffect(() => {
    const updateViewportWidth = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateViewportWidth)
    return () => window.removeEventListener('resize', updateViewportWidth)
  }, [])

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    }
  }, [])

  const isMobile = shouldUsePresetOnTap(viewportWidth)
  /** 手机档的排序模式是全屏面板（详见 `.preset-sort-sheet` 的注释）。 */
  const sortSheetOpen = reorder && isMobile

  /*
   * 跨过断点时重置展开态：面板从侧栏变成底部抽屉（或反过来）时，
   * 沿用上一次的展开状态没有意义——手机端一进来就展开会盖掉约 190px 时间轴。
   *
   * **进入排序模式要确保列表可见**（抽屉收起时看不见就谈不上排序）。
   * 反过来，**退出排序模式时不收起**：用户刚整理完顺序，把列表收掉等于把战果藏起来。
   * 所以这里不能简单写 `setExpanded(reorder || !isMobile)` —— 那会在关掉排序时
   * 顺手把抽屉收起；改成"只在断点真的变了"时才重置。
   */
  const prevMobileRef = useRef(isMobile)
  useEffect(() => {
    if (prevMobileRef.current !== isMobile) {
      prevMobileRef.current = isMobile
      setExpanded(!isMobile)
      return
    }
    if (reorder) setExpanded(true)
  }, [isMobile, reorder])

  /*
   * 全屏排序面板的退场。用与三处菜单同一个 `useClosing`：
   * 先播 160ms 的缩小淡出，再真正卸载（直接卸载会让"放大打开"显得有头无尾）。
   */
  const { closing: sheetClosing, close: closeSheet } = useClosing(() => setReorder(false), 160)

  /*
   * 桌面端没有"收起"这个概念：面板在侧栏里不遮挡任何东西，列表恒显、标题不可点。
   * 只有窄屏（抽屉形态）才需要折叠，所以这里把「是否渲染折叠控件」与「列表是否显示」
   * 分开表达，而不是共用一个 expanded。
   */
  const collapsible = isMobile
  const listOpen = !collapsible || expanded

  const ids = presets.map((p) => p.id)
  const byId = new Map(presets.map((p) => [p.id, p]))
  /** `settle` 要在 window 级事件里被调用，必须读**最新**的 id 序列与提交回调，故走 ref。 */
  const idsRef = useRef<string[]>([])
  const onReorderRef = useRef(onReorder)
  idsRef.current = ids
  onReorderRef.current = onReorder
  /**
   * 拖动期间按**草稿顺序**渲染（这是让位动画的唯一触发方式）。
   * `settling` 阶段不动：那时 `onReorder` 已经提交，props 给的就是最终顺序，
   * 再按草稿渲染反而会让 DOM 来回动一次。
   */
  const orderedIds = drag?.phase === 'dragging' ? orderAfterDrop(ids, drag.id, drag.index) : ids
  const rendered = orderedIds.map((id) => byId.get(id)).filter((p): p is WeekPreset => Boolean(p))

  /**
   * 松手：提交顺序 + 让幽灵卡片飞向目标槽位。
   *
   * ⚠️ **`sessionRef` 不能在松手当下就清掉**：幽灵的渲染依赖它（基准框与槽位几何）。
   * 一清，幽灵会在松手的那一帧直接消失 —— 落位动画根本播不出来。它要活到落位结束。
   *
   * 目标槽位直接取**按下时测得的第 `index` 个槽位**，不去 DOM 重新测量：
   * 提交后 React 是异步重排的，此刻读到的是旧位置；而"新顺序里位于 `index` 的那张卡
   * 就落在第 `index` 个槽位"是恒等的（DOM 按序填满槽位），无需测量。
   */
  const settle = useCallback((): void => {
    const session = sessionRef.current
    if (!session) return
    const index = indexRef.current
    /*
     * 槽位是内容坐标，落位目标要的是视口坐标 ⇒ 用**当前**的原点换算回去。
     * 拖动期间用户可能滚动过列表，此刻的原点才是幽灵该落的地方。
     */
    const list = listRef.current
    const origin = list ? listOrigin(list) : null
    const stored = session.slots[Math.min(index, session.slots.length - 1)]
    const slot =
      stored && origin
        ? { left: stored.left + origin.x, top: stored.top + origin.y }
        : { left: session.base.left, top: session.base.top }
    onReorderRef.current(orderAfterDrop(idsRef.current, session.id, index))
    setDrag((prev) => (prev ? { ...prev, phase: 'settling', settleTo: slot } : prev))
    settleTimerRef.current = window.setTimeout(() => {
      sessionRef.current = null
      setDrag(null)
    }, SETTLE_MS + 80)
  }, [])

  /**
   * 由**视口**指针坐标重算落点。
   *
   * 抽成函数是因为它有**两个触发源**：`pointermove`（手指/鼠标在动）与
   * 列表的 `scroll`（指针没动、内容在动）。后者容易漏 —— 拖动期间用户滚动列表时
   * 指针事件一个都不会发，落点必须自己跟着滚动量重算，否则松手会落到旧槽位。
   */
  const pointerRef = useRef({ x: 0, y: 0 })
  const recomputeIndex = useCallback((clientX: number, clientY: number): void => {
    const session = sessionRef.current
    const list = listRef.current
    if (!session || !list) return
    pointerRef.current = { x: clientX, y: clientY }
    const origin = listOrigin(list)
    const pointer = session.axis === 'x' ? clientX - origin.x : clientY - origin.y
    const index = resolveDropIndex(session.targets, session.id, pointer)
    indexRef.current = index
    setDrag((prev) => (prev ? { ...prev, pointer: { x: clientX, y: clientY }, index } : prev))
  }, [])

  /*
   * 指针事件挂在 **window** 上，而不是靠拖柄的 `setPointerCapture`。
   *
   * 原因：拖拽期间被拖的那张卡片是 `visibility: hidden`（见上），而 `setPointerCapture`
   * 的捕获关系会随元素的可见性/挂载状态变得不可靠；window 级监听与 DOM 状态无关，
   * 也不怕中途 React 移动节点。`touch-action: none` 仍写在拖柄上 —— 它在 `pointerdown`
   * 时被浏览器锁存（见 AGENTS.md 的移动端手势结论），整段手势不会退化成滚动。
   *
   * 依赖只有阶段，**不含 `drag` 本身**：否则每次 pointermove 换新 state 都要
   * 拆装一遍监听器（虽然不会丢事件，但纯属白费）。
   */
  useEffect(() => {
    if (drag?.phase !== 'dragging') return
    const list = listRef.current
    const onMove = (e: PointerEvent): void => recomputeIndex(e.clientX, e.clientY)
    /* 指针不动、列表滚动：落点必须跟着滚动量重算（否则松手落到滚动前的槽位）。 */
    const onScroll = (): void => recomputeIndex(pointerRef.current.x, pointerRef.current.y)
    const onUp = (): void => settle()
    const onCancel = (): void => {
      sessionRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    list?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      list?.removeEventListener('scroll', onScroll)
    }
  }, [drag?.phase, settle, recomputeIndex])


  const startDrag = (e: React.PointerEvent, id: string): void => {
    const list = listRef.current
    const card = cardRefs.current.get(id)
    if (!list || !card) return
    e.preventDefault()
    e.stopPropagation()
    /*
     * 轴向由**计算样式**决定，而不是由"是不是手机"决定：桌面端列表是纵向 flex、
     * 手机抽屉里是横向 flex（见 theme.css 的 .preset-list），同一个组件两种排布。
     */
    const axis: Axis = getComputedStyle(list).flexDirection === 'row' ? 'x' : 'y'
    const origin = listOrigin(list)
    const targets: DropTarget[] = []
    const slots: { left: number; top: number }[] = []
    for (const preset of presets) {
      const el = cardRefs.current.get(preset.id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      // 换算到内容坐标系：这一步是"滚动后仍能放进看得见的槽位"的关键。
      const left = rect.left - origin.x
      const top = rect.top - origin.y
      targets.push({
        id: preset.id,
        start: axis === 'x' ? left : top,
        size: axis === 'x' ? rect.width : rect.height
      })
      slots.push({ left, top })
    }
    if (targets.length < 2) return
    const rect = card.getBoundingClientRect()
    // 上一次落位的收尾定时器可能还挂着：不清掉它会把这次的拖拽态一起抹掉。
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    sessionRef.current = {
      id,
      axis,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      base: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      slots,
      targets
    }
    indexRef.current = presets.findIndex((p) => p.id === id)
    // 先种下指针位置：若用户在**第一次 pointermove 之前**就滚动列表，
    // `scroll` 回调读到的必须是按下点，而不是上一轮的残留值。
    pointerRef.current = { x: e.clientX, y: e.clientY }
    setDrag({
      id,
      pointer: { x: e.clientX, y: e.clientY },
      index: indexRef.current,
      phase: 'dragging',
      settleTo: null
    })
  }

  /** 上移/下移：与拖拽提交走同一套顺序语义（见 `presetReorder.moveWithin`）。 */
  const move = (id: string, delta: number): void => {
    const next = moveWithin(ids, id, ids.indexOf(id) + delta)
    if (next === ids) return
    onReorder(next)
  }

  /**
   * 单张预设卡片。抽成函数是为了让**底部抽屉**与**手机全屏排序面板**共用同一份渲染 ——
   * 两处各有自己的 `.preset-list`，但卡片、拖柄、让位/落位的行为必须完全一致
   * （需求：「随后逻辑与桌面端同」）。
   */
  const renderCard = (preset: WeekPreset, index: number): JSX.Element => {
    const quadrant = QUADRANT_META[preset.quadrant]
    const showMeta = preset.durationMin >= 45
    const isSource = drag?.id === preset.id
    return (
      <div
        key={preset.id}
        ref={(el) => {
          if (el) cardRefs.current.set(preset.id, el)
          else cardRefs.current.delete(preset.id)
        }}
        data-preset-id={preset.id}
        className={`preset-card${reorder ? ' reordering' : ''}${isSource ? ' is-drag-source' : ''}`}
        /*
         * 排序模式下关掉原生拖动：那是「拖到时间轴」的载荷，与排序是两回事。
         * 关掉之后 `onDragStart` 也不会被触发（浏览器对 draggable=false 的元素
         * 不启动原生拖拽），所以不需要再在回调里判一次。
         */
        draggable={!reorder}
        title={reorder ? '拖动左侧手柄调整顺序' : '拖到左侧时间轴创建事件'}
        style={{
          background: withAlpha(preset.color, 0.12),
          borderColor: withAlpha(preset.color, 0.45),
          // 高度只在桌面端随预设时长伸缩；手机抽屉里的卡片是固定尺寸的横排条目，
          // 尺寸交给 CSS（theme.css 的 .preset-card），内联高度会盖掉它。
          height: isMobile && !sortSheetOpen
            ? undefined
            : Math.min(260, Math.max(56, 56 + (preset.durationMin / 60) * 24))
        }}
        onDragStart={(e) => {
          // 时间轴在 dragover 阶段读不到 dataTransfer 内容，靠这个登记簿反查预设。
          beginPresetDrag(preset.id)
          e.dataTransfer.setData(PRESET_DRAG_MIME, preset.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        // 拖到画布外松手、或按 Esc 取消时，必须清掉登记簿与预览，
        // 否则时间轴上会残留一个永远不会消失的落点幽灵。
        onDragEnd={() => endPresetDrag()}
        onClick={() => {
          if (reorder) return
          if (isMobile) onUse(preset)
          else onEdit(preset)
        }}
        onDoubleClick={() => {
          if (!reorder && !isMobile) onEdit(preset)
        }}
      >
        {reorder && (
          <span
            className="preset-grip"
            role="button"
            tabIndex={0}
            aria-label={`拖动调整「${preset.title}」的顺序`}
            onPointerDown={(e) => startDrag(e, preset.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                move(preset.id, -1)
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                move(preset.id, 1)
              }
            }}
          >
            <GripVertical size={16} />
          </span>
        )}
        <div className="preset-title">{preset.title}</div>
        {showMeta && (
          <div className="preset-meta">
            <span className="quad-dot" style={{ background: quadrant.color }} />
            <span>{quadrant.label}</span>
          </div>
        )}
        <div className="preset-duration">{formatDuration(preset.durationMin)}</div>
        <div className="preset-actions">
          {reorder ? (
            <>
              <button
                className="icon-btn"
                title="上移"
                aria-label="上移"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  move(preset.id, -1)
                }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-btn"
                title="下移"
                aria-label="下移"
                disabled={index === rendered.length - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  move(preset.id, 1)
                }}
              >
                <ArrowDown size={14} />
              </button>
            </>
          ) : (
            <>
              <button className="icon-btn" title="编辑预设" onClick={(e) => { e.stopPropagation(); onEdit(preset) }}>
                <Pencil size={14} />
              </button>
              <button
                className="icon-btn danger"
                title="删除预设"
                onClick={(e) => { e.stopPropagation(); onDelete(preset) }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  /**
   * 列表本体。两处宿主（抽屉 / 全屏排序面板）共用同一段 JSX，
   * 且共用同一个 `attachListRef` —— auto-animate 的控制器挂在「当前挂载的那个列表」上，
   * 同一时刻只会有一个实例，切换时旧的控制权被库自己的 cleanup 收走。
   */
  const renderList = (extraClass: string): JSX.Element => (
    <div
      className={`preset-list${extraClass}${drag?.phase === 'dragging' ? ' is-dragging' : ''}`}
      ref={attachListRef}
    >
      {presets.length === 0 && <div className="preset-empty">暂无预设，点击 ＋ 新建</div>}
      {rendered.map(renderCard)}
    </div>
  )

  const session = sessionRef.current
  /** 幽灵卡片的位置：跟手阶段用指针，落位阶段用目标槽位。 */
  const ghost = (() => {
    if (!drag || !session) return null
    const target =
      drag.phase === 'settling' && drag.settleTo
        ? drag.settleTo
        : { left: drag.pointer.x - session.grabX, top: drag.pointer.y - session.grabY }
    return {
      preset: byId.get(drag.id),
      left: session.base.left,
      top: session.base.top,
      width: session.base.width,
      height: session.base.height,
      x: target.left - session.base.left,
      y: target.top - session.base.top,
      phase: drag.phase
    }
  })()

  /*
   * 跟手抬起的幽灵卡片。
   *
   * ⭐ **必须 portal 到 `document.body`**，不能就地渲染在面板里：
   * 手机档的 `.preset-panel` 带 `backdrop-filter`，它会成为 fixed 后代的包含块，
   * 于是面板自己的 `overflow: hidden` 会把幽灵裁掉；桌面档虽然能逃出裁剪，
   * 但那样幽灵会落在 `.preset-list` 的滚动容器里、随内容一起被滚走。
   * 挂到 body 之后，两种布局共用一套视口坐标，也彻底避开"玻璃层祖先链"那堆约束。
   */
  const ghostNode =
    ghost && ghost.preset
      ? createPortal(
          <div
            /*
             * `sheet` 只在手机全屏排序面板里加：面板里的卡片换了一套排布
             * （内容垂直居中 + 右侧按钮通道），幽灵作为它的**副本**必须跟着换，
             * 否则起拖那一刻文字会跳一下（本体居中了、副本还顶在上沿）。
             * 桌面侧栏里的卡片没有这套排布，不能加。
             */
            className={`preset-card reordering preset-drag-ghost${sortSheetOpen ? ' sheet' : ''}${ghost.phase === 'settling' ? ' settling' : ''}`}
            aria-hidden="true"
            style={{
              left: ghost.left,
              top: ghost.top,
              width: ghost.width,
              height: ghost.height,
              background: withAlpha(ghost.preset.color, 0.16),
              borderColor: withAlpha(ghost.preset.color, 0.8),
              transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)`,
              // 跟手阶段**不许有过渡**（否则慢半拍）；只有落位阶段才补间。
              transition:
                ghost.phase === 'settling' && !prefersReducedMotion()
                  ? `transform ${SETTLE_MS}ms ${REORDER_EASE}`
                  : 'none'
            }}
          >
            <div className="preset-title">{ghost.preset.title}</div>
            {ghost.preset.durationMin >= 45 && (
              <div className="preset-meta">
                <span
                  className="quad-dot"
                  style={{ background: QUADRANT_META[ghost.preset.quadrant].color }}
                />
                <span>{QUADRANT_META[ghost.preset.quadrant].label}</span>
              </div>
            )}
            <div className="preset-duration">{formatDuration(ghost.preset.durationMin)}</div>
          </div>,
          document.body
        )
      : null

  /*
   * 手机档的排序模式是**全屏面板**，不是抽屉里的行内改造。
   *
   * 理由：抽屉最高只有 `min(300px, 46dvh)`，且列表是横向单行的 —— 在 390px 宽里
   * 排 5~8 张卡片要反复横滑，排序这种"来回比较"的操作在里头非常难受。
   * 全屏之后列表回到**纵向**，与桌面端同一套排布、同一个轴向判定（`renderList`
   * 里没有一行是手机专属的），交互逻辑因此与桌面端完全一致。
   *
   * 打开时播 220ms 的放大（scale .9 → 1）+ 淡入，关闭时 160ms 缩小淡出（见 CSS）。
   */
  if (sortSheetOpen) {
    return (
      <>
        {createPortal(
          <div className={`preset-sort-sheet${sheetClosing ? ' closing' : ''}`}>
            <div className="preset-sort-head">
              <h3>调整顺序</h3>
              <button type="button" className="preset-sort-done" onClick={closeSheet}>
                <Check size={15} />
                完成
              </button>
            </div>
            {renderList(' preset-sort-list')}
          </div>,
          document.body
        )}
        {ghostNode}
      </>
    )
  }

  const headContent = (
    <>
      <h3>事件预设{presets.length > 0 ? ` · ${presets.length}` : ''}</h3>
      {collapsible && <ChevronDown size={16} />}
    </>
  )

  return (
    <aside className={`preset-panel${listOpen ? ' expanded' : ' collapsed'}${reorder ? ' reordering' : ''}`}>
      <div className="preset-head">
        {collapsible ? (
          <button
            className="preset-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {headContent}
          </button>
        ) : (
          <div className="preset-toggle static">{headContent}</div>
        )}
        <span className="preset-head-actions">
          {/* 只有一张卡片时没有"顺序"可言，入口直接不出现（而不是点进去什么都没有）。 */}
          {presets.length > 1 && (
            <button
              className={`icon-btn${reorder ? ' active' : ''}`}
              title={reorder ? '完成排序' : '调整顺序'}
              aria-label={reorder ? '完成排序' : '调整顺序'}
              aria-pressed={reorder}
              onClick={() => setReorder((value) => !value)}
            >
              {reorder ? <Check size={16} /> : <ArrowUpDown size={16} />}
            </button>
          )}
          <button className="icon-btn" title="新建预设" aria-label="新建预设" onClick={onAdd}>
            <Plus size={16} />
          </button>
        </span>
      </div>
      {/*
       * 外层只负责高度过渡，内层负责排列与滚动。
       * 用 grid-template-rows 0fr → 1fr 而不是 max-height：fr 是数值，浏览器可插值，
       * 于是"高度自适应内容"也能有过渡，且时长恒定（max-height 会因猜不准而忽快忽慢）。
       * 内层的 min-height: 0 必须写，否则轨道不会被压到 0，收起等于没反应。
       */}
      <div className="preset-collapse">{renderList('')}</div>
      {ghostNode}
    </aside>
  )
}
