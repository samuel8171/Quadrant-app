import { ClipboardPaste, Copy, Eraser, ImagePlus, Info, Save, Scissors, Trash2 } from 'lucide-react'
import { useClosing } from '../hooks/useClosing'

export interface ContextMenuState {
  x: number
  y: number
  eventId?: string
  worldX?: number
  worldY?: number
}

type MenuAction = 'cut' | 'copy' | 'paste' | 'delete' | 'save' | 'detail' | 'photo'

interface Props {
  menu: ContextMenuState
  canPaste: boolean
  /** 该事件还能不能再加照片（未达上限）。画布上的空白菜单不显示本项。 */
  canAddPhoto: boolean
  onAction: (action: MenuAction) => void
  onClose: () => void
}

const ITEMS: { action: MenuAction; label: string; icon: typeof Copy }[] = [
  { action: 'cut', label: '剪切', icon: Scissors },
  { action: 'copy', label: '复制', icon: Copy },
  { action: 'paste', label: '粘贴', icon: ClipboardPaste },
  { action: 'photo', label: '添加照片', icon: ImagePlus },
  { action: 'delete', label: '删除', icon: Trash2 },
  { action: 'save', label: '保存', icon: Save },
  { action: 'detail', label: '详细信息', icon: Info }
]

export default function ContextMenu({ menu, canPaste, canAddPhoto, onAction, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose, 140)
  const items = menu.eventId
    ? ITEMS.filter((item) => item.action !== 'photo' || canAddPhoto)
    : ITEMS.filter((item) => item.action === 'paste')

  return (
    <div className={`context-menu${closing ? ' closing' : ''}`} style={{ left: menu.x, top: menu.y }}>
      {items.map(({ action, label, icon: Icon }) => (
        <button
          key={action}
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
    </div>
  )
}
