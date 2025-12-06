/**
 * 任务历史页面
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getTaskList, deleteTask, rerunTask, cancelTask } from '../lib/api';

interface Task {
  task_id: string;
  status: string;
  filename: string;
  composition_column?: string | string[];
  processing_column?: string | string[];
  target_columns: string[];
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  result_id?: string;
  progress?: number;
  model_provider?: string;
  model_name?: string;
  note?: string; // 任务备注
  // 配置字段
  train_ratio?: number;
  random_seed?: number;
  max_retrieved_samples?: number;
  similarity_threshold?: number;
  temperature?: number;
  sample_size?: number;
  workers?: number;
  feature_columns?: string[];
}

export default function TasksPage() {
  const router = useRouter();
  const { id } = router.query; // 获取任务ID参数
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const pageSize = 20;

  // 备注编辑状态
  const [editingNoteTaskId, setEditingNoteTaskId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState<string>('');

  // 取消任务状态
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 如果有 id 参数，加载单个任务详情
  useEffect(() => {
    if (id && typeof id === 'string') {
      loadTaskDetail(id);
    } else {
      loadTasks();
    }
  }, [id, page, statusFilter]);

  const loadTaskDetail = async (taskId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`http://localhost:8000/api/tasks/${taskId}`);
      if (!response.ok) {
        throw new Error('加载任务详情失败');
      }
      const data = await response.json();
      // API 返回的是 { task: {...}, config: {...}, logs: [...] }
      // 我们需要合并 task 和 config 中的数据
      const taskWithConfig = {
        ...data.task,
        // 如果 config 中有额外的配置信息，也可以合并进来
        ...(data.config || {})
      };
      setSelectedTask(taskWithConfig);
    } catch (err: any) {
      setError(err.message || '加载任务详情失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getTaskList({
        page,
        page_size: pageSize,
        status: statusFilter || undefined,
        sort_by: 'created_at',
        sort_order: sortOrder,
      });

      setTasks(response.tasks);
      setTotal(response.total);
      setSelectedTaskIds(new Set()); // 清空选择
    } catch (err: any) {
      setError(err.message || '加载任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定要删除这个任务吗？')) {
      return;
    }

    try {
      await deleteTask(taskId);
      loadTasks();
    } catch (err: any) {
      alert(err.message || '删除失败');
    }
  };

  const handleIncrementalPredict = async (taskId: string) => {
    // 增量预测：跳转到预测页面，并通过 URL 参数传递任务 ID 和继续标志
    router.push(`/prediction?rerun_task_id=${taskId}&continue=true`);
  };

  // 重新预测（创建新任务，不是增量预测）
  const handleRerun = (taskId: string) => {
    // 跳转到预测配置页面，传递任务ID作为参数
    // 预测页面会加载配置，但不设置 continue_from_task_id（创建新任务）
    router.push(`/prediction?rerun_task_id=${taskId}`);
  };

  // 继续预测（增量预测）
  const handleContinue = (taskId: string) => {
    // 跳转到预测配置页面，传递任务ID和continue标志
    // 预测页面会加载配置，并设置 continue_from_task_id（增量预测）
    router.push(`/prediction?rerun_task_id=${taskId}&continue=true`);
  };

  // 停止任务
  const handleCancel = async (taskId: string) => {
    if (!confirm('确定要停止这个任务吗？')) {
      return;
    }

    // 防止重复点击
    if (cancellingTaskId === taskId) {
      return;
    }

    setCancellingTaskId(taskId);
    setSuccessMessage(null);

    try {
      await cancelTask(taskId);
      loadTasks();
      // 如果当前正在查看此任务详情，也需要刷新
      if (selectedTask?.task_id === taskId) {
        loadTaskDetail(taskId);
      }
      // 显示成功提示
      setSuccessMessage('任务已成功取消');
      // 3秒后自动隐藏提示
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      alert(err.message || '停止任务失败');
    } finally {
      setCancellingTaskId(null);
    }
  };

  const handleViewResult = (resultId: string) => {
    router.push(`/results/${resultId}`);
  };

  // 多选功能
  const toggleSelectTask = (taskId: string) => {
    const newSelected = new Set(selectedTaskIds);
    if (newSelected.has(taskId)) {
      newSelected.delete(taskId);
    } else {
      newSelected.add(taskId);
    }
    setSelectedTaskIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedTaskIds.size === tasks.length) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(tasks.map(t => t.task_id)));
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedTaskIds.size === 0) {
      alert('请先选择要删除的任务');
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedTaskIds.size} 个任务吗？`)) {
      return;
    }

    try {
      const deletePromises = Array.from(selectedTaskIds).map(taskId => deleteTask(taskId));
      await Promise.all(deletePromises);
      alert('批量删除成功');
      loadTasks();
    } catch (err: any) {
      alert(err.message || '批量删除失败');
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      pending: { label: '等待中', color: 'bg-gray-500' },
      running: { label: '运行中', color: 'bg-blue-500' },
      completed: { label: '已完成', color: 'bg-green-500' },
      failed: { label: '失败', color: 'bg-red-500' },
      cancelled: { label: '已取消', color: 'bg-orange-500' },
    };

    const config = statusConfig[status] || { label: status, color: 'bg-gray-500' };

    return (
      <span className={`px-2 py-1 text-xs text-white rounded ${config.color}`}>
        {config.label}
      </span>
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  };

  // 开始编辑备注
  const handleStartEditNote = (task: Task) => {
    setEditingNoteTaskId(task.task_id);
    setEditingNoteValue(task.note || '');
  };

  // 保存备注
  const handleSaveNote = async (taskId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/tasks/${taskId}/note`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note: editingNoteValue }),
      });

      if (!response.ok) {
        throw new Error('更新备注失败');
      }

      // 更新本地任务列表
      setTasks(tasks.map(t =>
        t.task_id === taskId ? { ...t, note: editingNoteValue } : t
      ));

      setEditingNoteTaskId(null);
      setEditingNoteValue('');
    } catch (err: any) {
      alert(err.message || '更新备注失败');
    }
  };

  // 取消编辑备注
  const handleCancelEditNote = () => {
    setEditingNoteTaskId(null);
    setEditingNoteValue('');
  };

  const totalPages = Math.ceil(total / pageSize);

  // 如果是查看单个任务详情
  if (id && selectedTask) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <button
            onClick={() => router.push('/tasks')}
            className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-2"
          >
            ← 返回任务列表
          </button>
          <h1 className="text-3xl font-bold mb-2">任务详情</h1>
          <p className="text-gray-600">任务 ID: {selectedTask.task_id}</p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* 任务状态卡片 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">状态信息</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-600">状态:</span>
              <span className="ml-2">{getStatusBadge(selectedTask.status)}</span>
            </div>
            <div>
              <span className="text-gray-600">进度:</span>
              <span className="ml-2 font-medium">
                {selectedTask.progress !== undefined ? `${Math.round(selectedTask.progress * 100)}%` : '-'}
              </span>
            </div>
            <div>
              <span className="text-gray-600">创建时间:</span>
              <span className="ml-2">{formatDate(selectedTask.created_at)}</span>
            </div>
            <div>
              <span className="text-gray-600">完成时间:</span>
              <span className="ml-2">{formatDate(selectedTask.completed_at)}</span>
            </div>
          </div>
          {/* 只在 failed 状态下显示错误信息，cancelled 状态不显示 */}
          {selectedTask.status === 'failed' && selectedTask.error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
              <p className="text-sm font-medium text-red-800">错误信息:</p>
              <p className="text-sm text-red-600 mt-1">{selectedTask.error}</p>
            </div>
          )}
        </div>

        {/* 配置信息卡片 - 使用醒目的边框和背景 */}
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-lg border-2 border-blue-200 p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚙️</span>
              <h2 className="text-xl font-bold text-gray-800">任务配置参数</h2>
            </div>
            <button
              onClick={() => {
                // 跳转到预测页面，使用 rerun_task_id 参数加载配置
                router.push(`/prediction?rerun_task_id=${selectedTask.task_id}`);
              }}
              className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 flex items-center gap-2 shadow-md transition-all hover:shadow-lg"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
              使用此配置创建新任务
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 基本信息 */}
            <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-700 mb-2 border-b border-blue-200 pb-1">📁 基本信息</h3>
              <div>
                <span className="text-gray-500 text-xs">任务ID:</span>
                <span className="font-mono text-xs text-gray-800 block mt-0.5 truncate" title={selectedTask.task_id}>{selectedTask.task_id}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs">文件名:</span>
                <span className="font-medium text-sm block mt-0.5 truncate" title={selectedTask.filename}>{selectedTask.filename}</span>
              </div>
              {selectedTask.note && (
                <div>
                  <span className="text-gray-500 text-xs">备注:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.note}</span>
                </div>
              )}
            </div>

            {/* 列配置 */}
            <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-green-700 mb-2 border-b border-green-200 pb-1">📊 列配置</h3>
              <div>
                <span className="text-gray-500 text-xs">目标列:</span>
                <span className="font-medium text-sm block mt-0.5">{selectedTask.target_columns?.join(', ') || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs">成分列:</span>
                <span className="font-medium text-xs block mt-0.5">
                  {Array.isArray(selectedTask.composition_column)
                    ? selectedTask.composition_column.join(', ')
                    : (selectedTask.composition_column || '-')}
                </span>
              </div>
              <div>
                <span className="text-gray-500 text-xs">工艺列:</span>
                <span className="font-medium text-xs block mt-0.5">
                  {Array.isArray(selectedTask.processing_column)
                    ? selectedTask.processing_column.join(', ')
                    : (selectedTask.processing_column || '-')}
                </span>
              </div>
            </div>

            {/* 模型配置 */}
            <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-purple-700 mb-2 border-b border-purple-200 pb-1">🤖 模型配置</h3>
              <div>
                <span className="text-gray-500 text-xs">模型提供商:</span>
                <span className="font-medium text-sm block mt-0.5">{selectedTask.model_provider || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs">模型名称:</span>
                <span className="font-medium text-sm block mt-0.5">{selectedTask.model_name || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs">温度参数:</span>
                <span className="font-medium text-sm block mt-0.5">{selectedTask.temperature !== undefined ? selectedTask.temperature : '-'}</span>
              </div>
            </div>

            {/* 数据与执行配置 */}
            <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-orange-700 mb-2 border-b border-orange-200 pb-1">⚙️ 执行配置</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-gray-500 text-xs">样本数:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.sample_size ?? '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">训练比例:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.train_ratio ?? '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">检索数:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.max_retrieved_samples ?? '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">相似度:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.similarity_threshold ?? '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">并发数:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.workers ?? '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500 text-xs">随机种子:</span>
                  <span className="font-medium text-sm block mt-0.5">{selectedTask.random_seed ?? '-'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-4 flex-wrap">
          {selectedTask.result_id && (
            <button
              onClick={() => router.push(`/results/${selectedTask.result_id}`)}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              查看结果
            </button>
          )}
          {/* 停止任务按钮：仅在 pending 或 running 状态时显示 */}
          {(selectedTask.status === 'pending' || selectedTask.status === 'running') && (
            <button
              onClick={() => handleCancel(selectedTask.task_id)}
              disabled={cancellingTaskId === selectedTask.task_id}
              className={`px-6 py-3 text-white rounded-lg ${
                cancellingTaskId === selectedTask.task_id
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-700'
              }`}
            >
              {cancellingTaskId === selectedTask.task_id ? '取消中...' : '停止任务'}
            </button>
          )}
          {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') && (
            <button
              onClick={() => handleContinue(selectedTask.task_id)}
              className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              继续预测
            </button>
          )}
          <button
            onClick={() => handleRerun(selectedTask.task_id)}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            重新运行
          </button>
          <button
            onClick={() => {
              handleDelete(selectedTask.task_id);
              router.push('/tasks');
            }}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            删除任务
          </button>
        </div>
      </div>
    );
  }

  // 任务列表视图
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">任务历史</h1>
          <p className="text-gray-600">查看和管理所有预测任务</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/prediction')}
            className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200"
          >
            🔮 新建预测
          </button>
          <button
            onClick={() => router.push('/task-comparison')}
            className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200"
            title="对比多个任务的预测结果"
          >
            📊 任务对比
          </button>
        </div>
      </div>

      {/* 成功提示消息 */}
      {successMessage && (
        <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg flex items-center justify-between">
          <span>✓ {successMessage}</span>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-green-700 hover:text-green-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* 筛选器和操作栏 */}
      <div className="mb-6 flex gap-4 items-center flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="border border-gray-300 rounded px-4 py-2"
        >
          <option value="">全部状态</option>
          <option value="pending">等待中</option>
          <option value="running">运行中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>

        <select
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value as 'asc' | 'desc');
            setPage(1);
          }}
          className="border border-gray-300 rounded px-4 py-2"
        >
          <option value="desc">最新优先</option>
          <option value="asc">最旧优先</option>
        </select>

        <button
          onClick={loadTasks}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          刷新
        </button>

        {selectedTaskIds.size > 0 && (
          <>
            <div className="text-sm text-gray-600">
              已选择 {selectedTaskIds.size} 个任务
            </div>
            <button
              onClick={handleBatchDelete}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              批量删除
            </button>
            <button
              onClick={() => setSelectedTaskIds(new Set())}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              取消选择
            </button>
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <p className="mt-2 text-gray-600">加载中...</p>
        </div>
      )}

      {/* 任务列表 */}
      {!loading && tasks.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded">
          <p className="text-gray-600">暂无任务记录</p>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.size === tasks.length && tasks.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  文件名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  目标列
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  模型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  配置参数
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  创建时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  完成时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  备注
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tasks.map((task) => (
                <tr key={task.task_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.task_id)}
                      onChange={() => toggleSelectTask(task.task_id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(task.status)}
                    {task.progress !== undefined && task.status === 'running' && (
                      <div className="mt-1 text-xs text-gray-500">
                        {Math.round(task.progress * 100)}%
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {task.filename}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      任务ID: {task.task_id}
                    </div>
                    {/* 只在 failed 状态下显示错误信息 */}
                    {task.status === 'failed' && task.error && (
                      <div className="text-xs text-red-600 mt-1">
                        {task.error}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {task.target_columns?.join(', ') || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {task.model_provider || '-'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {task.model_name || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="relative group">
                      <div className="text-xs text-gray-700 cursor-pointer hover:text-blue-600">
                        <span className="font-medium">{task.sample_size || '-'}</span>
                        <span className="text-gray-400 mx-1">|</span>
                        <span>{task.train_ratio || '-'}</span>
                        <span className="text-gray-400 mx-1">|</span>
                        <span>{task.workers || '-'}线程</span>
                      </div>
                      {/* Tooltip 完整配置 */}
                      <div className="absolute z-10 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg p-3 w-64 left-0 top-full mt-1 shadow-lg">
                        <div className="font-semibold mb-2 text-blue-300">完整配置参数</div>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-gray-400">样本数量:</span>
                            <span>{task.sample_size ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">训练比例:</span>
                            <span>{task.train_ratio ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">检索样本数:</span>
                            <span>{task.max_retrieved_samples ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">相似度阈值:</span>
                            <span>{task.similarity_threshold ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">温度参数:</span>
                            <span>{task.temperature ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">并发线程:</span>
                            <span>{task.workers ?? '-'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">随机种子:</span>
                            <span>{task.random_seed ?? '-'}</span>
                          </div>
                        </div>
                        <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(task.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(task.completed_at)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {editingNoteTaskId === task.task_id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingNoteValue}
                          onChange={(e) => setEditingNoteValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="输入备注..."
                          maxLength={200}
                        />
                        <button
                          onClick={() => handleSaveNote(task.task_id)}
                          className="text-green-600 hover:text-green-900"
                          title="保存"
                        >
                          ✓
                        </button>
                        <button
                          onClick={handleCancelEditNote}
                          className="text-red-600 hover:text-red-900"
                          title="取消"
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="flex-1 truncate" title={task.note || ''}>
                          {task.note || '-'}
                        </span>
                        <button
                          onClick={() => handleStartEditNote(task)}
                          className="text-blue-600 hover:text-blue-900"
                          title="编辑备注"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">
                    <div className="flex gap-2 flex-wrap min-w-[300px]">
                      {task.result_id && (
                        <button
                          onClick={() => handleViewResult(task.result_id!)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          查看结果
                        </button>
                      )}
                      {/* 停止按钮：仅在 pending 或 running 状态时显示 */}
                      {(task.status === 'pending' || task.status === 'running') && (
                        <button
                          onClick={() => handleCancel(task.task_id)}
                          disabled={cancellingTaskId === task.task_id}
                          className={`${cancellingTaskId === task.task_id
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-orange-600 hover:text-orange-900'}`}
                        >
                          {cancellingTaskId === task.task_id ? '取消中...' : '停止'}
                        </button>
                      )}
                      {/* 重新预测按钮：创建新任务，从头开始预测 */}
                      {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                        <button
                          onClick={() => handleRerun(task.task_id)}
                          className="text-green-600 hover:text-green-900"
                          title="创建新任务，从头开始重新预测所有样本"
                        >
                          重新预测
                        </button>
                      )}
                      {/* 增量预测按钮：在已完成或失败状态时显示 */}
                      {(task.status === 'completed' || task.status === 'failed') && (
                        <button
                          onClick={() => handleIncrementalPredict(task.task_id)}
                          className="text-cyan-600 hover:text-cyan-900"
                          title="继续预测未完成的样本"
                        >
                          增量预测
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(task.task_id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            上一页
          </button>
          <span className="px-4 py-2">
            第 {page} / {totalPages} 页（共 {total} 条）
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}


