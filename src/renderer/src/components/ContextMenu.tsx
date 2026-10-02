import { Check, ClipboardPaste, Copy, Eraser, ImagePlus, Info, Save, Scissors, Trash2 } from 'lucide-react'
import { useClosing } from '../hooks/useClosing'
import GlassSurface from './glass/GlassSurface'
import { menuGeometry, useMenuRowHeight } from './glass/glassMenu'

export interface ContextMenuState {
  x: number
  y: number
  eventId?: string
  worldX?: number
  worldY?: number
}

type MenuAction = 'complete' | 'cut' | 'copy' | 'paste' | 'delete' | 'save' | 'detail' | 'photo'

interface Props {
  menu: ContextMenuState
  canPaste: boolean
  /** 该事件还能不能再加照片（未达上限）。画布上的空白菜单不显示本项。 */
  canAddPhoto: boolean
  /**
   * 是否显示「标记完成」——**仅当金钱系统开启时**（spec §4.3：关闭时不得弹象限计费气泡）。
   * 关掉开关就要把原程序一字不差地还回去，这个入口因此必须整个消失，而不是禁用。
   */
  canComplete: boolean
  onAction: (action: MenuAction) => void
  onClose: () => void
}

const ITEMS: { action: MenuAction; label: string; icon: typeof Copy }[] = [
  { action: 'complete', label: '标记完成', icon: Check },
  { action: 'cut', label: '剪切', icon: Scissors },
  { action: 'copy', label: '复制', icon: Copy },
  { action: 'paste', label: '粘贴', icon: ClipboardPaste },
  { action: 'photo', label: '添加照片', icon: ImagePlus },
  { action: 'delete', label: '删除', icon: Trash2 },
  { action: 'save', label: '保存', icon: Save },
  { action: 'detail', label: '详细信息', icon: Info }
]

export default function ContextMenu({
  menu,
  canPaste,
  canAddPhoto,
  canComplete,
  onAction,
  onClose
}: Props): JSX.Element {
  const { closing, close } = useClosing(onClose, 140)
  const items = menu.eventId
    ? ITEMS.filter(
        (item) =>
          (item.action !== 'photo' || canAddPhoto) &&
          (item.action !== 'complete' || canComplete)
      )
    : ITEMS.filter((item) => item.action === 'paste')

  /*
   * 菜单不做指针跟随（interactive 默认 false）。
   * 库的弹性位移会让元件朝光标方向平移，而这里的每一行都是即刻生效的操作
   * （含不可撤销的「删除」）——让点击目标在指针接近时轻微移动，是拿误触风险
   * 换一点观感，不划算。玻璃的静态质感已经足够。
   *
   * 行高从 CSS 读（桌面 34 / 手机 48），不能写常量：移动端的
   * `.context-item` 为了触摸目标另有尺寸，写死会让菜单顶部整体偏移。
   */
  const rowH = useMenuRowHeight()
  const geo = menuGeometry(menu.x, menu.y, items.length, rowH)

  return (
    <GlassSurface
      center={geo.center}
      contentWidth={geo.contentWidth}
      padding={geo.padding}
      layerClassName="gs-layer--menu"
      contentRole="menu"
      anim={closing ? 'out' : 'in'}
    >
      {items.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
          role="menuitem"
          className={`context-item${action === 'delete' ? ' danger' : ''}`}
          disabled={action === 'paste' && !canPaste}
          onClick={() => {
            onAction(action)
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
