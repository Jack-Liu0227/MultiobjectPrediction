/**
 * 右侧任务进度管理栏组件
 * 固定在页面右侧，实时显示任务状态
 */

import React, { useState, useEffect, useCallback } from 'react';
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
  note?: string;
}

interface TaskProgressPanelProps {
  currentTaskId?: string;
  className?: string;
}

// 格式化相对时间
const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  return date.toLocaleDateString('zh-CN');
};

// 状态配置
const statusConfig: Record<string, { icon: string; color: string; bgColor: string; label: string; animate?: boolean }> = {
  pending: { icon: '⏳', color: 'text-gray-600', bgColor: 'bg-gray-100', label: '等待中' },
  running: { icon: '🔵', color: 'text-blue-600', bgColor: 'bg-blue-100', label: '运行中', animate: true },
  completed: { icon: '✅', color: 'text-green-600', bgColor: 'bg-green-100', label: '已完成' },
  failed: { icon: '❌', color: 'text-red-600', bgColor: 'bg-red-100', label: '失败' },
  cancelled: { icon: '🚫', color: 'text-orange-600', bgColor: 'bg-orange-100', label: '已取消' },
};

export default function TaskProgressPanel({ currentTaskId, className = '' }: TaskProgressPanelProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);

  // 加载任务列表
  const loadTasks = useCallback(async () => {
    try {
      const response = await getTaskList({
        page: 1,
        page_size: 10,
        sort_by: 'created_at',
        sort_order: 'desc',
      });
      setTasks(response.tasks);
    } catch (err: any) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载和定时刷新
  useEffect(() => {
    loadTasks();
    // 如果有运行中的任务则每5秒刷新，否则每10秒
    const hasRunning = tasks.some(t => t.status === 'running' || t.status === 'pending');
    const interval = setInterval(loadTasks, hasRunning ? 5000 : 10000);
    return () => clearInterval(interval);
  }, [loadTasks, tasks]);

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
      // 已完成的任务跳转到结果页面
      router.push(`/results/${task.result_id}`);
    } else {
      // 运行中、失败或待处理的任务跳转到任务详情页面
      router.push(`/tasks?id=${task.task_id}`);
    }
  };

  return (
    <div className={`fixed top-0 right-0 h-screen bg-white border-l border-gray-200 shadow-lg transition-all duration-300 z-40 ${
      isCollapsed ? 'w-12' : 'w-80'
    } ${className}`}>
      {/* 折叠/展开按钮 */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -left-3 top-6 w-6 h-6 bg-white border border-gray-300 rounded-full shadow-md hover:bg-gray-50 flex items-center justify-center"
        title={isCollapsed ? '展开任务栏' : '收起任务栏'}
      >
        <span className="text-xs text-gray-600">{isCollapsed ? '◀' : '▶'}</span>
      </button>

      {!isCollapsed && (
        <div className="h-full flex flex-col">
          {/* 头部 */}
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <span>📋</span>
              <span>任务进度</span>
              {tasks.filter(t => t.status === 'running').length > 0 && (
                <span className="ml-auto text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                  {tasks.filter(t => t.status === 'running').length} 运行中
                </span>
              )}
            </h3>
          </div>

          {/* 任务列表 */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-4 text-center">
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
              </div>
            )}

            {!loading && tasks.length === 0 && (
              <div className="p-4 text-center text-gray-400 text-xs">暂无任务</div>
            )}

            {tasks.map((task) => {
              const config = statusConfig[task.status] || statusConfig.pending;
              const isActive = task.task_id === currentTaskId;

              return (
                <div
                  key={task.task_id}
                  onClick={() => handleTaskClick(task)}
                  className={`p-3 border-b border-gray-100 transition-colors ${
                    task.status === 'completed' ? 'cursor-pointer hover:bg-gray-50' : ''
                  } ${isActive ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`text-base ${config.animate ? 'animate-pulse' : ''}`}>
                      {config.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-900 truncate">
                        {task.filename}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {formatRelativeTime(task.created_at)}
                      </div>

                      {/* 进度条 */}
                      {task.status === 'running' && task.progress !== undefined && (
                        <div className="mt-2">
                          <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
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

                      {/* 状态标签 */}
                      <div className="mt-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${config.bgColor} ${config.color}`}>
                          {config.label}
                        </span>
                      </div>

                      {/* 错误信息 */}
                      {task.status === 'failed' && task.error && (
                        <div className="text-xs text-red-600 mt-1 truncate" title={task.error}>
                          {task.error}
                        </div>
                      )}
                    </div>

                    {/* 取消按钮：pending 和 running 状态都可取消 */}
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
              className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
            >
              查看全部任务 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

