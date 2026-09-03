import { ClipboardPaste, Copy, Eraser, Info, Save, Scissors, Trash2 } from 'lucide-react'
import { useClosing } from '../hooks/useClosing'

export interface ContextMenuState {
  x: number
  y: number
  eventId?: string
  worldX?: number
  worldY?: number
}

type MenuAction = 'cut' | 'copy' | 'paste' | 'delete' | 'save' | 'detail'

interface Props {
  menu: ContextMenuState
  canPaste: boolean
  onAction: (action: MenuAction) => void
  onClose: () => void
}

const ITEMS: { action: MenuAction; label: string; icon: typeof Copy }[] = [
  { action: 'cut', label: '剪切', icon: Scissors },
  { action: 'copy', label: '复制', icon: Copy },
  { action: 'paste', label: '粘贴', icon: ClipboardPaste },
  { action: 'delete', label: '删除', icon: Trash2 },
  { action: 'save', label: '保存', icon: Save },
  { action: 'detail', label: '详细信息', icon: Info }
]

export default function ContextMenu({ menu, canPaste, onAction, onClose }: Props): JSX.Element {
  const { closing, close } = useClosing(onClose, 140)
  const items = menu.eventId
    ? ITEMS
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
