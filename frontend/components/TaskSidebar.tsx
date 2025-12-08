/**
 * 任务管理侧边栏组件
 * 显示最近任务列表和实时状态
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { getTaskList, cancelTask } from '@/lib/api';

interface Task {
  task_id: string;
  status: string;
  filename: string;
  target_columns: string[];
  created_at: string;
  progress?: number;
  error?: string;
  result_id?: string;
}

interface TaskSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentTaskId?: string;
}

// 格式化相对时间
const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return date.toLocaleDateString('zh-CN');
};

// 状态图标和颜色
const statusConfig: Record<string, { icon: string; color: string; bgColor: string; label: string }> = {
  pending: { icon: '🟡', color: 'text-yellow-600', bgColor: 'bg-yellow-100', label: '等待中' },
  running: { icon: '🔵', color: 'text-blue-600', bgColor: 'bg-blue-100', label: '运行中' },
  completed: { icon: '🟢', color: 'text-green-600', bgColor: 'bg-green-100', label: '已完成' },
  failed: { icon: '🔴', color: 'text-red-600', bgColor: 'bg-red-100', label: '失败' },
  cancelled: { icon: '🚫', color: 'text-orange-600', bgColor: 'bg-orange-100', label: '已取消' },
};

export default function TaskSidebar({ isOpen, onClose, currentTaskId }: TaskSidebarProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    try {
      const response = await getTaskList({
        page: 1,
        page_size: 20,
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      setTasks(response.tasks);
      setError(null);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 清理定时器
  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // 初始加载和定时刷新
  useEffect(() => {
    if (isOpen) {
      loadTasks();

      // 清除旧的定时器
      clearPolling();

      // 每10秒刷新一次（如果有运行中的任务则每5秒）
      const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'pending');
      pollingIntervalRef.current = setInterval(loadTasks, hasRunning ? 5000 : 10000);

      return () => {
        clearPolling();
      };
    } else {
      // 侧边栏关闭时清理定时器
      clearPolling();
    }
  }, [isOpen, loadTasks, clearPolling, tasks]);

  // 处理取消任务
  const handleCancel = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (cancellingTaskId === taskId) return; // 防止重复点击

    if (confirm('确定要取消这个任务吗？')) {
      setCancellingTaskId(taskId);
      try {
        await cancelTask(taskId);
        loadTasks();
      } catch (err: any) {
        alert(err.message || '取消失败');
      } finally {
        setCancellingTaskId(null);
      }
    }
  };

  // 点击任务
  const handleTaskClick = (task: Task) => {
    if (task.status === 'completed' && task.result_id) {
      router.push(`/results/${task.result_id}`);
    } else {
      router.push(`/tasks?id=${task.task_id}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black bg-opacity-30" onClick={onClose} />
      
      {/* 侧边栏 */}
      <div className="relative w-80 bg-white shadow-xl h-full overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">任务列表</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 任务列表 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-4 text-center text-gray-500">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent"></div>
            </div>
          )}

          {error && (
            <div className="p-4 text-red-600 text-sm">{error}</div>
          )}

          {!loading && tasks.length === 0 && (
            <div className="p-4 text-center text-gray-500 text-sm">暂无任务</div>
          )}

          {tasks.map((task) => {
            const config = statusConfig[task.status] || statusConfig.pending;
            const isActive = task.task_id === currentTaskId;

            return (
              <div
                key={task.task_id}
                onClick={() => handleTaskClick(task)}
                className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors
                  ${isActive ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg">{config.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {task.filename}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {task.target_columns.slice(0, 2).join(', ')}
                      {task.target_columns.length > 2 && ` +${task.target_columns.length - 2}`}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${config.bgColor} ${config.color}`}>
                        {config.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatRelativeTime(task.created_at)}
                      </span>
                    </div>
                    
                    {/* 进度条 */}
                    {task.status === 'running' && task.progress !== undefined && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${task.progress * 100}%` }}
                          />
                        </div>
                        <div className="text-xs text-blue-600 mt-0.5">
                          {Math.round(task.progress * 100)}%
                        </div>
                      </div>
                    )}

                    {/* 错误信息 */}
                    {task.status === 'failed' && task.error && (
                      <div className="text-xs text-red-600 mt-1 truncate">
                        {task.error}
                      </div>
                    )}
                  </div>

                  {/* 操作按钮：pending 和 running 状态都可取消 */}
                  {(task.status === 'running' || task.status === 'pending') && (
                    <button
                      onClick={(e) => handleCancel(task.task_id, e)}
                      disabled={cancellingTaskId === task.task_id}
                      className={`p-1 rounded text-xs ${
                        cancellingTaskId === task.task_id
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'hover:bg-red-100 text-red-500'
                      }`}
                      title="取消任务"
                    >
                      {cancellingTaskId === task.task_id ? '...' : '✕'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部链接 */}
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={() => router.push('/tasks')}
            className="w-full py-2 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
          >
            查看全部任务 →
          </button>
        </div>
      </div>
    </div>
  );
}

