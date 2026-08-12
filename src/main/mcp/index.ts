import type { AppData } from '../../shared/types'

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'list_goals',
    description: '列出全部目标',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_goal',
    description: '获取单个目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'create_goal',
    description: '创建目标',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { enum: ['long', 'short'] }
      },
      required: ['title', 'type']
    }
  },
  {
    name: 'update_goal',
    description: '修改目标',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'toggle_goal',
    description: '勾选/取消勾选目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'delete_goal',
    description: '删除目标',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'list_events',
    description: '列出全部象限事件',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_event',
    description: '创建象限事件',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        quadrant: { enum: [1, 2, 3, 4] },
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['text', 'quadrant']
    }
  },
  {
    name: 'update_event',
    description: '修改象限事件',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'delete_event',
    description: '删除象限事件',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'list_subtasks',
    description: '列出长期目标的子目标',
    inputSchema: {
      type: 'object',
      properties: { goalId: { type: 'string' } },
      required: ['goalId']
    }
  },
  {
    name: 'add_subtask',
    description: '添加子目标',
    inputSchema: {
      type: 'object',
      properties: {
        goalId: { type: 'string' },
        title: { type: 'string' },
        relation: { enum: ['sequential', 'parallel'] }
      },
      required: ['goalId', 'title', 'relation']
    }
  },
  {
    name: 'toggle_subtask',
    description: '勾选/取消勾选子目标',
    inputSchema: {
      type: 'object',
      properties: { goalId: { type: 'string' }, subtaskId: { type: 'string' } },
      required: ['goalId', 'subtaskId']
    }
  }
]

/**
 * MCP stdio 服务入口（后期实现）。
 * 当前仅注册工具清单；不随主程序启动。
 */
export function startMcpServer(_data: AppData): void {
  // 后期：在此启动 stdio JSON-RPC 服务，工具实现复用 dataStore.ts
  throw new Error('MCP server is reserved for a later milestone')
}
