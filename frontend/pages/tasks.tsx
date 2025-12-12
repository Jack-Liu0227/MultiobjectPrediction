/**
 * 任务历史页面
 * 使用 SWR 实现请求缓存和优化
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { deleteTask, rerunTask, cancelTask } from '../lib/api';
import { taskEvents } from '../lib/taskEvents';
import ExportButton from '@/components/ExportButton';
import { exportToCSV, exportToExcel, exportToHTML, generateFileName } from '@/lib/exportUtils';
import { useTaskList, refreshTaskList } from '../lib/hooks/useSWRApi';

interface Task {
  task_id: string;
  status: string;
  filename: string;
  file_id?: string; // 关联的数据集ID或文件ID
  total_rows?: number; // 测试集样本数（任务完成后更新）
  valid_rows?: number; // 测试集有效样本数（任务完成后更新）
  original_total_rows?: number; // 已废弃：不再使用
  original_valid_rows?: number; // 已废弃：不再使用
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

interface Dataset {
  dataset_id: string;
  filename: string;
  original_filename: string;
  file_path: string;
  row_count: number; // 原始数据集总行数
  column_count: number;
  columns: string[];
  file_size: number;
  file_hash?: string;
  uploaded_at: string;
  last_used_at?: string;
  description?: string;
  tags: string[];
  usage_count: number;
}

export default function TasksPage() {
  const router = useRouter();
  const { id } = router.query; // 获取任务ID参数
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const pageSize = 20;

  // 使用 SWR 获取任务列表（自动缓存和去重）
  const { data, error, isLoading, mutate } = useTaskList({
    page,
    page_size: pageSize,
    status: statusFilter || undefined,
    sort_by: 'created_at',
    sort_order: sortOrder,
  });

  // 从 SWR 响应中提取数据
  const tasks = data?.tasks || [];
  const total = data?.total || 0;
  const loading = isLoading;

  // 确保 error 是字符串类型
  const errorMessage = error ? (typeof error === 'string' ? error : error.message || '加载失败') : null;

  // 编辑状态 - 支持多字段编辑
  const [editingCell, setEditingCell] = useState<{taskId: string, field: 'note' | 'filename' | 'taskId'} | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // 取消任务状态
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 客户端挂载状态（避免 hydration 错误）
  const [mounted, setMounted] = useState(false);

  // 任务详情加载状态（独立于列表加载状态）
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // 批量重新预测状态
  const [showBatchRerunDialog, setShowBatchRerunDialog] = useState(false);
  const [batchRerunTasks, setBatchRerunTasks] = useState<Task[]>([]);
  const [batchRerunLoading, setBatchRerunLoading] = useState(false);
  const [batchRerunNotes, setBatchRerunNotes] = useState<Map<string, string>>(new Map());
  const [batchRerunConfigs, setBatchRerunConfigs] = useState<Map<string, any>>(new Map());

  // 配置编辑对话框状态
  const [showConfigEditDialog, setShowConfigEditDialog] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<any>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [configTab, setConfigTab] = useState<'basic' | 'rag' | 'llm' | 'advanced'>('basic');
  const [editingTaskDataset, setEditingTaskDataset] = useState<Dataset | null>(null); // 当前编辑任务的数据集信息
  const [retrievalRatioInput, setRetrievalRatioInput] = useState<string>(''); // 检索比例输入框的临时值

  // 批量增量预测状态
  const [showBatchIncrementalDialog, setShowBatchIncrementalDialog] = useState(false);

  // 数据集信息缓存（用于批量重新预测对话框）
  const [datasetCache, setDatasetCache] = useState<Map<string, Dataset>>(new Map());
  const [batchIncrementalTasks, setBatchIncrementalTasks] = useState<Task[]>([]);
  const [batchIncrementalLoading, setBatchIncrementalLoading] = useState(false);

  // 批量停止状态
  const [showBatchCancelDialog, setShowBatchCancelDialog] = useState(false);
  const [batchCancelTasks, setBatchCancelTasks] = useState<Task[]>([]);
  const [batchCancelLoading, setBatchCancelLoading] = useState(false);

  // LLM 模型列表状态
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 函数定义必须在所有 hooks 之前或之后，不能在条件返回之后
  const loadTaskDetail = async (taskId: string) => {
    setDetailLoading(true);
    setDetailError(null);

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
      setDetailError(err.message || '加载任务详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  // 加载可用 LLM 模型
  const loadAvailableModels = async () => {
    try {
      setLoadingModels(true);
      const response = await fetch('http://localhost:8000/api/llm/models');
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to load LLM models:', error);
    } finally {
      setLoadingModels(false);
    }
  };

  // 获取数据集信息（带缓存）
  const getDatasetInfo = async (datasetId: string): Promise<Dataset | null> => {
    // 检查缓存
    if (datasetCache.has(datasetId)) {
      return datasetCache.get(datasetId)!;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`);
      if (!response.ok) {
        console.error(`Failed to fetch dataset ${datasetId}: ${response.statusText}`);
        return null;
      }
      const dataset: Dataset = await response.json();

      // 更新缓存
      setDatasetCache(prev => new Map(prev).set(datasetId, dataset));

      return dataset;
    } catch (err: any) {
      console.error(`Error fetching dataset ${datasetId}:`, err);
      return null;
    }
  };

  // 刷新任务列表（使用 SWR mutate）
  const loadTasks = async () => {
    setSelectedTaskIds(new Set()); // 清空选择
    await mutate(); // SWR 重新验证数据
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

  // 批量重新预测 - 打开预览对话框
  const handleBatchRerun = () => {
    if (selectedTaskIds.size === 0) {
      alert('请先选择要重新预测的任务');
      return;
    }

    // 只允许已完成、失败或取消的任务进行重新预测
    const selectedTasks = tasks.filter(t => selectedTaskIds.has(t.task_id));
    const invalidTasks = selectedTasks.filter(t =>
      t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled'
    );

    if (invalidTasks.length > 0) {
      alert(`只能重新预测已完成、失败或已取消的任务。\n当前选中了 ${invalidTasks.length} 个不符合条件的任务。`);
      return;
    }

    setBatchRerunTasks(selectedTasks);

    // 初始化备注状态（使用原任务的备注）
    const initialNotes = new Map<string, string>();
    selectedTasks.forEach(task => {
      if (task.note) {
        initialNotes.set(task.task_id, task.note);
      }
    });
    setBatchRerunNotes(initialNotes);

    // 初始化配置状态（使用原任务的配置）
    const initialConfigs = new Map<string, any>();
    selectedTasks.forEach(task => {
      initialConfigs.set(task.task_id, {
        // LLM 配置
        model_provider: task.model_provider,
        model_name: task.model_name,
        temperature: task.temperature,
        // 基础配置
        sample_size: task.sample_size,
        workers: task.workers,
        train_ratio: task.train_ratio,
        random_seed: task.random_seed || 42,
        // RAG 配置
        max_retrieved_samples: task.max_retrieved_samples,
        similarity_threshold: task.similarity_threshold,
        // 列配置（只读）
        composition_column: task.composition_column,
        processing_column: task.processing_column,
        target_columns: task.target_columns,
        feature_columns: task.feature_columns,
      });
    });
    setBatchRerunConfigs(initialConfigs);

    setShowBatchRerunDialog(true);
  };

  // 确认批量重新预测
  const handleConfirmBatchRerun = async () => {
    setBatchRerunLoading(true);
    try {
      const rerunPromises = batchRerunTasks.map(task => {
        const note = batchRerunNotes.get(task.task_id);
        const config = batchRerunConfigs.get(task.task_id);

        const options: any = {};
        if (note) options.note = note;
        if (config) options.config = config;

        return rerunTask(task.task_id, Object.keys(options).length > 0 ? options : undefined);
      });
      await Promise.all(rerunPromises);

      setShowBatchRerunDialog(false);
      setBatchRerunTasks([]);
      setBatchRerunNotes(new Map());
      setBatchRerunConfigs(new Map());
      setSelectedTaskIds(new Set());

      alert(`成功创建 ${batchRerunTasks.length} 个重新预测任务`);
      loadTasks();
    } catch (err: any) {
      alert(err.message || '批量重新预测失败');
    } finally {
      setBatchRerunLoading(false);
    }
  };

  // 打开配置编辑对话框
  const handleEditConfig = (taskId: string, applyAll: boolean = false) => {
    const config = batchRerunConfigs.get(taskId);
    setEditingTaskId(taskId);
    setEditingConfig({ ...config });
    setApplyToAll(applyAll);
    setShowConfigEditDialog(true);
  };

  // 保存配置编辑
  const handleSaveConfig = () => {
    if (!editingTaskId || !editingConfig) return;

    // 验证配置
    if (editingConfig.temperature < 0 || editingConfig.temperature > 2) {
      alert('温度参数必须在 0-2 之间');
      return;
    }
    if (editingConfig.sample_size <= 0) {
      alert('样本数量必须大于 0');
      return;
    }
    if (editingConfig.workers <= 0 || editingConfig.workers > 20) {
      alert('并发数必须在 1-20 之间');
      return;
    }
    if (editingConfig.train_ratio < 0.5 || editingConfig.train_ratio > 0.9) {
      alert('训练集比例必须在 0.5-0.9 之间');
      return;
    }
    if (editingConfig.max_retrieved_samples < 0) {
      alert('最大检索样本数不能为负数');
      return;
    }
    if (editingConfig.similarity_threshold < 0 || editingConfig.similarity_threshold > 1) {
      alert('相似度阈值必须在 0-1 之间');
      return;
    }
    if (editingConfig.random_seed && (editingConfig.random_seed < 1 || editingConfig.random_seed > 9999)) {
      alert('随机种子必须在 1-9999 之间');
      return;
    }

    const newConfigs = new Map(batchRerunConfigs);

    if (applyToAll) {
      // 应用到所有任务（保留每个任务的列配置）
      batchRerunTasks.forEach(task => {
        const originalConfig = batchRerunConfigs.get(task.task_id);
        newConfigs.set(task.task_id, {
          ...editingConfig,
          // 保留原任务的列配置
          composition_column: originalConfig?.composition_column,
          processing_column: originalConfig?.processing_column,
          target_columns: originalConfig?.target_columns,
          feature_columns: originalConfig?.feature_columns,
        });
      });
    } else {
      // 只应用到当前任务
      newConfigs.set(editingTaskId, { ...editingConfig });
    }

    setBatchRerunConfigs(newConfigs);
    setShowConfigEditDialog(false);
    setEditingTaskId(null);
    setEditingConfig(null);
    setApplyToAll(false);
    setConfigTab('basic');
  };

  // 批量增量预测 - 打开预览对话框
  const handleBatchIncremental = () => {
    if (selectedTaskIds.size === 0) {
      alert('请先选择要增量预测的任务');
      return;
    }

    // 允许所有状态的任务进行增量预测（移除状态限制）
    const selectedTasks = tasks.filter(t => selectedTaskIds.has(t.task_id));

    setBatchIncrementalTasks(selectedTasks);
    setShowBatchIncrementalDialog(true);
  };

  // 确认批量增量预测
  const handleConfirmBatchIncremental = async () => {
    setBatchIncrementalLoading(true);
    try {
      const { incrementalPredictTask } = await import('../lib/api');
      const incrementalPromises = batchIncrementalTasks.map(task => incrementalPredictTask(task.task_id));
      await Promise.all(incrementalPromises);

      setShowBatchIncrementalDialog(false);
      setBatchIncrementalTasks([]);
      setSelectedTaskIds(new Set());

      alert(`成功启动 ${batchIncrementalTasks.length} 个增量预测任务`);
      loadTasks();
    } catch (err: any) {
      alert(err.message || '批量增量预测失败');
    } finally {
      setBatchIncrementalLoading(false);
    }
  };

  // 批量停止 - 打开确认对话框
  const handleBatchCancel = () => {
    if (selectedTaskIds.size === 0) {
      alert('请先选择要停止的任务');
      return;
    }

    // 只允许运行中或等待中的任务被停止
    const selectedTasks = tasks.filter(t => selectedTaskIds.has(t.task_id));
    const cancellableTasks = selectedTasks.filter(t =>
      t.status === 'running' || t.status === 'pending'
    );

    if (cancellableTasks.length === 0) {
      alert('选中的任务中没有可以停止的任务（只能停止运行中或等待中的任务）');
      return;
    }

    if (cancellableTasks.length < selectedTasks.length) {
      const nonCancellable = selectedTasks.length - cancellableTasks.length;
      if (!confirm(`选中的 ${selectedTasks.length} 个任务中，有 ${nonCancellable} 个任务无法停止（状态不是运行中或等待中）。\n是否继续停止其余 ${cancellableTasks.length} 个任务？`)) {
        return;
      }
    }

    setBatchCancelTasks(cancellableTasks);
    setShowBatchCancelDialog(true);
  };

  // 确认批量停止
  const handleConfirmBatchCancel = async () => {
    setBatchCancelLoading(true);
    try {
      const { batchCancelTasks: batchCancelTasksApi } = await import('../lib/api');
      const taskIds = batchCancelTasks.map(t => t.task_id);
      const result = await batchCancelTasksApi(taskIds);

      setShowBatchCancelDialog(false);
      setBatchCancelTasks([]);
      setSelectedTaskIds(new Set());

      if (result.failed > 0) {
        alert(`批量停止完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      } else {
        alert(`成功停止 ${result.success} 个任务`);
      }

      loadTasks();
    } catch (err: any) {
      alert(err.message || '批量停止失败');
    } finally {
      setBatchCancelLoading(false);
    }
  };

  // 文本截断组件 - 带 tooltip
  const TruncatedText = ({ text, maxLength = 50, className = "" }: { text: string; maxLength?: number; className?: string }) => {
    const isTruncated = text && text.length > maxLength;
    const displayText = isTruncated ? text.substring(0, maxLength) + '...' : text;

    if (!isTruncated) {
      return <span className={className}>{text || '-'}</span>;
    }

    return (
      <div className="relative group inline-block">
        <span className={className}>{displayText}</span>
        {/* Tooltip */}
        <div className="absolute z-50 invisible group-hover:visible bg-gray-900 text-white text-xs rounded-lg p-3 w-80 left-0 top-full mt-1 shadow-lg break-words whitespace-pre-wrap">
          {text}
          <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45"></div>
        </div>
      </div>
    );
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
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // 开始编辑单元格
  const handleStartEdit = (task: Task, field: 'note' | 'filename' | 'taskId') => {
    setEditingCell({ taskId: task.task_id, field });
    if (field === 'note') {
      setEditingValue(task.note || '');
    } else if (field === 'filename') {
      setEditingValue(task.filename || '');
    } else if (field === 'taskId') {
      setEditingValue(task.task_id || '');
    }
  };

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingCell) return;

    const { taskId, field } = editingCell;

    try {
      if (field === 'note') {
        // 保存备注
        const response = await fetch(`http://localhost:8000/api/tasks/${taskId}/note`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note: editingValue }),
        });

        if (!response.ok) {
          throw new Error('更新备注失败');
        }

        // 更新本地任务列表（使用 SWR mutate）
        mutate(
          (currentData: any) => {
            if (!currentData) return currentData;
            return {
              ...currentData,
              tasks: currentData.tasks.map((t: Task) =>
                t.task_id === taskId ? { ...t, note: editingValue } : t
              ),
            };
          },
          false // 不重新验证，使用乐观更新
        );

        // 如果当前正在查看此任务详情，也需要更新
        if (selectedTask?.task_id === taskId) {
          setSelectedTask({ ...selectedTask, note: editingValue });
        }

        // 触发事件，通知其他组件更新
        taskEvents.emit('note-updated', {
          taskId,
          field: 'note',
          value: editingValue,
        });
      }
      // TaskID 和 Filename 暂不支持修改（只读展示）
      // 如需支持，需要添加相应的后端 API

      setEditingCell(null);
      setEditingValue('');
    } catch (err: any) {
      alert(err.message || '更新失败');
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditingValue('');
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Hooks 必须在所有函数定义之后，但在任何条件返回之前
  useEffect(() => {
    setMounted(true);
    loadAvailableModels(); // 加载可用模型列表
  }, []);

  // 如果有 id 参数，加载单个任务详情
  useEffect(() => {
    if (!mounted) return; // 等待客户端挂载

    if (id && typeof id === 'string') {
      loadTaskDetail(id);
    }
    // SWR 会自动处理数据加载，不需要手动调用 loadTasks
  }, [id, mounted]);

  // 监听任务更新事件（跨组件同步）
  // 使用 useCallback 确保事件处理器引用稳定，避免重复注册
  const handleNoteUpdate = useCallback((data: { taskId: string; field?: string; value?: any }) => {
    // 使用 SWR mutate 进行乐观更新
    mutate(
      (currentData: any) => {
        if (!currentData) return currentData;
        return {
          ...currentData,
          tasks: currentData.tasks.map((t: Task) =>
            t.task_id === data.taskId ? { ...t, note: data.value } : t
          ),
        };
      },
      false // 不重新验证，使用乐观更新
    );

    // 如果当前正在查看此任务详情，也需要更新
    setSelectedTask(prev =>
      prev && prev.task_id === data.taskId ? { ...prev, note: data.value } : prev
    );
  }, [mutate]);

  useEffect(() => {
    taskEvents.on('note-updated', handleNoteUpdate);

    return () => {
      taskEvents.off('note-updated', handleNoteUpdate);
    };
  }, [handleNoteUpdate]);

  // 当编辑任务时，获取数据集信息
  useEffect(() => {
    if (!editingTaskId) {
      setEditingTaskDataset(null);
      return;
    }

    const currentTask = batchRerunTasks.find(t => t.task_id === editingTaskId);
    if (!currentTask?.file_id) {
      setEditingTaskDataset(null);
      return;
    }

    // 异步获取数据集信息
    getDatasetInfo(currentTask.file_id).then(dataset => {
      setEditingTaskDataset(dataset);
    });
  }, [editingTaskId, batchRerunTasks]);

  // 在客户端挂载之前不渲染任何内容，避免 hydration 错误
  if (!mounted) {
    return null;
  }

  const totalPages = Math.ceil(total / pageSize);

  // 如果是查看单个任务详情
  if (id && selectedTask) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* 顶部导航栏 */}
        <header className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* 返回任务列表按钮 */}
                <button
                  onClick={() => router.push('/tasks')}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="返回任务列表"
                >
                  <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">任务详情</h1>
                  <p className="text-sm text-gray-500 mt-1">任务 ID: {selectedTask.task_id}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push('/prediction')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  🔮 新建预测
                </button>
                <button
                  onClick={() => router.push('/tasks')}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                >
                  📋 任务列表
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* 主内容区域 */}
        <div className="max-w-7xl mx-auto px-4 py-8">

        {/* 错误提示 */}
        {(errorMessage || detailError) && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-red-600">{errorMessage || detailError}</p>
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
                <div className="font-mono text-xs text-gray-800 mt-0.5 break-all bg-white p-2 rounded border border-gray-200">
                  {selectedTask.task_id}
                </div>
              </div>
              <div>
                <span className="text-gray-500 text-xs">文件名:</span>
                <div className="font-medium text-sm mt-0.5 break-words bg-white p-2 rounded border border-gray-200">
                  {selectedTask.filename}
                </div>
              </div>
              {/* 数据统计信息 */}
              {(selectedTask.total_rows !== undefined || selectedTask.valid_rows !== undefined) && (
                <div>
                  <span className="text-gray-500 text-xs">数据统计:</span>
                  <div className="font-medium text-sm mt-0.5 bg-white p-2 rounded border border-gray-200">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-600">总行数: {selectedTask.total_rows ?? '-'}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-green-600">有效行数: {selectedTask.valid_rows ?? '-'}</span>
                    </div>
                  </div>
                </div>
              )}
              {selectedTask.note && (
                <div>
                  <span className="text-gray-500 text-xs">备注:</span>
                  <div className="font-medium text-sm mt-0.5 break-words bg-white p-2 rounded border border-gray-200 whitespace-pre-wrap">
                    {selectedTask.note}
                  </div>
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
      </div>
    );
  }

  // 任务列表视图
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* 返回预测主页面按钮 */}
              <button
                onClick={() => router.push('/prediction')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="返回预测主页面"
              >
                <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">任务历史</h1>
                <p className="text-sm text-gray-500 mt-1">查看和管理所有预测任务 {total > 0 && `(共 ${total} 个)`}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/prediction')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                🔮 新建预测
              </button>
              <button
                onClick={() => router.push('/task-comparison')}
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 transition-colors"
                title="对比多个任务的预测结果"
              >
                📊 任务对比
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区域 */}
      <div className="max-w-7xl mx-auto px-4 py-8">

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

        {tasks.length > 0 && (
          <ExportButton
            label="导出任务列表"
            options={[
              {
                label: '导出为 CSV',
                format: 'csv',
                onClick: () => {
                  const exportData = tasks.map(task => ({
                    任务ID: task.task_id,
                    状态: task.status,
                    文件名: task.filename,
                    备注: task.note || '-',
                    目标列: task.target_columns.join(', '),
                    模型: task.model_name || '-',
                    创建时间: formatDate(task.created_at),
                    完成时间: formatDate(task.completed_at),
                    进度: task.progress !== undefined ? `${Math.round(task.progress * 100)}%` : '-',
                  }));
                  exportToCSV(
                    exportData,
                    generateFileName('task_history', 'csv')
                  );
                },
              },
              {
                label: '导出为 Excel',
                format: 'excel',
                onClick: () => {
                  const exportData = tasks.map(task => ({
                    任务ID: task.task_id,
                    状态: task.status,
                    文件名: task.filename,
                    备注: task.note || '-',
                    目标列: task.target_columns.join(', '),
                    模型: task.model_name || '-',
                    创建时间: formatDate(task.created_at),
                    完成时间: formatDate(task.completed_at),
                    进度: task.progress !== undefined ? `${Math.round(task.progress * 100)}%` : '-',
                  }));
                  exportToExcel(
                    exportData,
                    generateFileName('task_history', 'xlsx'),
                    '任务历史'
                  );
                },
              },
              {
                label: '导出为 HTML',
                format: 'html',
                onClick: () => {
                  const exportData = tasks.map(task => ({
                    任务ID: task.task_id,
                    状态: task.status,
                    文件名: task.filename,
                    备注: task.note || '-',
                    目标列: task.target_columns.join(', '),
                    模型: task.model_name || '-',
                    创建时间: formatDate(task.created_at),
                    完成时间: formatDate(task.completed_at),
                    进度: task.progress !== undefined ? `${Math.round(task.progress * 100)}%` : '-',
                  }));
                  exportToHTML(
                    exportData,
                    generateFileName('task_history', 'html'),
                    '任务历史列表'
                  );
                },
              },
            ]}
          />
        )}

        {selectedTaskIds.size > 0 && (
          <>
            <div className="text-sm text-gray-600">
              已选择 {selectedTaskIds.size} 个任务
            </div>
            <button
              onClick={handleBatchRerun}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-2"
              title="批量重新预测选中的任务（创建新任务）"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              批量重新预测
            </button>
            <button
              onClick={handleBatchIncremental}
              className="px-4 py-2 bg-cyan-500 text-white rounded hover:bg-cyan-600 flex items-center gap-2"
              title="批量增量预测选中的任务（继续预测未完成的样本）"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              批量增量预测
            </button>
            <button
              onClick={handleBatchCancel}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 flex items-center gap-2"
              title="批量停止选中的运行中或等待中的任务"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              批量停止
            </button>
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
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
          <p className="text-red-600">{errorMessage}</p>
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
        <div className="bg-white rounded-lg shadow overflow-x-auto" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left w-12 bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedTaskIds.size === tasks.length && tasks.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24 bg-gray-50">
                  状态
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[200px] bg-gray-50">
                  任务ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[280px] bg-gray-50">
                  文件名
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[140px] bg-gray-50">
                  数据统计
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[250px] bg-gray-50">
                  备注
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[180px] bg-gray-50">
                  目标列
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[160px] bg-gray-50">
                  模型
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[140px] bg-gray-50">
                  配置参数
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[140px] bg-gray-50">
                  创建时间
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[140px] bg-gray-50">
                  完成时间
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[280px] bg-gray-50">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tasks.map((task) => (
                <tr key={task.task_id} className="group hover:bg-gray-50">
                  {/* 复选框 */}
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.has(task.task_id)}
                      onChange={() => toggleSelectTask(task.task_id)}
                      className="rounded border-gray-300"
                    />
                  </td>

                  {/* 状态 */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    {getStatusBadge(task.status)}
                    {task.progress !== undefined && task.status === 'running' && (
                      <div className="mt-1 text-xs text-gray-500">
                        {Math.round(task.progress * 100)}%
                      </div>
                    )}
                    {task.status === 'failed' && task.error && (
                      <div className="text-xs text-red-600 mt-1" title={task.error}>
                        错误
                      </div>
                    )}
                  </td>

                  {/* 任务ID - 完整显示，可双击复制 */}
                  <td className="px-4 py-4">
                    <div
                      className="font-mono text-xs text-gray-700 cursor-pointer hover:bg-blue-50 px-2 py-1 rounded"
                      onDoubleClick={() => {
                        navigator.clipboard.writeText(task.task_id);
                        alert('任务ID已复制到剪贴板');
                      }}
                      title={`双击复制完整任务ID: ${task.task_id}`}
                    >
                      <TruncatedText
                        text={task.task_id}
                        maxLength={24}
                        className="font-mono text-xs text-gray-700"
                      />
                    </div>
                  </td>

                  {/* 文件名 - 使用截断显示 */}
                  <td className="px-4 py-4">
                    <TruncatedText
                      text={task.filename}
                      maxLength={35}
                      className="text-sm font-medium text-gray-900"
                    />
                  </td>

                  {/* 数据统计 */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    {(task.total_rows !== undefined || task.valid_rows !== undefined) ? (
                      <div className="text-xs">
                        <div className="text-blue-600 font-medium">
                          总: {task.total_rows ?? '-'}
                        </div>
                        <div className="text-green-600">
                          有效: {task.valid_rows ?? '-'}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>

                  {/* 备注 - 可双击编辑，使用截断显示 */}
                  <td className="px-4 py-4">
                    {editingCell?.taskId === task.task_id && editingCell?.field === 'note' ? (
                      <div className="flex items-center gap-2">
                        <textarea
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSaveEdit();
                            } else if (e.key === 'Escape') {
                              handleCancelEdit();
                            }
                          }}
                          className="flex-1 px-2 py-1 border border-blue-500 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                          placeholder="输入备注..."
                          maxLength={500}
                          rows={2}
                          autoFocus
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={handleSaveEdit}
                            className="text-green-600 hover:text-green-900 text-lg"
                            title="保存 (Enter)"
                          >
                            ✓
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="text-red-600 hover:text-red-900 text-lg"
                            title="取消 (Esc)"
                          >
                            ✗
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-2 cursor-pointer hover:bg-blue-50 px-2 py-1 rounded min-h-[32px]"
                        onDoubleClick={() => handleStartEdit(task, 'note')}
                        title="双击编辑备注"
                      >
                        <div className="flex-1 text-sm">
                          {task.note ? (
                            <TruncatedText text={task.note} maxLength={30} />
                          ) : (
                            <span className="text-gray-400">点击编辑...</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(task, 'note');
                          }}
                          className="text-blue-600 hover:text-blue-900 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          title="编辑备注"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
                  {/* 目标列 - 使用截断显示 */}
                  <td className="px-4 py-4">
                    <TruncatedText
                      text={task.target_columns?.join(', ') || '-'}
                      maxLength={20}
                      className="text-sm text-gray-900"
                    />
                  </td>

                  {/* 模型 */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {task.model_provider || '-'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {task.model_name || '-'}
                    </div>
                  </td>

                  {/* 配置参数 */}
                  <td className="px-4 py-4 whitespace-nowrap">
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

                  {/* 创建时间 */}
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(task.created_at)}
                  </td>

                  {/* 完成时间 */}
                  <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(task.completed_at)}
                  </td>

                  {/* 操作 */}
                  <td className="px-4 py-4 text-sm font-medium">
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
                      {/* 增量预测按钮：允许所有状态的任务 */}
                      <button
                        onClick={() => handleIncrementalPredict(task.task_id)}
                        className="text-cyan-600 hover:text-cyan-900"
                        title="继续预测未完成的样本"
                      >
                        增量预测
                      </button>
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

      {/* 批量重新预测预览对话框 */}
      {showBatchRerunDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* 对话框标题 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">批量重新预测 - 配置预览</h2>
              <button
                onClick={() => setShowBatchRerunDialog(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 对话框内容 */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>提示：</strong>即将为以下 {batchRerunTasks.length} 个任务创建新的预测任务。
                  每个任务将使用其原始配置从头开始重新预测所有样本。
                </p>
                <p className="text-sm text-blue-800 mt-2">
                  💡 您可以点击"编辑配置"按钮修改每个任务的配置参数，或使用"应用相同配置到所有任务"快速设置。
                </p>
              </div>

              {/* 全局操作按钮 */}
              <div className="mb-4 flex gap-3">
                <button
                  onClick={() => {
                    if (batchRerunTasks.length > 0) {
                      handleEditConfig(batchRerunTasks[0].task_id, true);
                    }
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  应用相同配置到所有任务
                </button>
                <button
                  onClick={() => {
                    setBatchRerunNotes(new Map());
                  }}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  清除所有备注
                </button>
              </div>

              {/* 任务配置预览表格 */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">序号</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[150px]">任务ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[150px]">数据集</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[120px]">模型</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">温度</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">样本</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">训练比</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">检索数</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[150px]">备注</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {batchRerunTasks.map((task, index) => {
                      const config = batchRerunConfigs.get(task.task_id);
                      return (
                        <tr key={task.task_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                          <td className="px-4 py-3 text-xs font-mono text-gray-700">
                            <TruncatedText text={task.task_id} maxLength={15} />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <TruncatedText text={task.filename} maxLength={18} />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div className="truncate text-xs">{config?.model_provider || '-'}</div>
                            <div className="text-xs text-gray-500 truncate">{config?.model_name || '-'}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-center">{config?.temperature ?? '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-center">{config?.sample_size || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-center">
                            {config?.train_ratio ? (config.train_ratio * 100).toFixed(0) + '%' : '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-center">{config?.max_retrieved_samples ?? '-'}</td>
                          <td className="px-4 py-3">
                            <input
                              type="text"
                              value={batchRerunNotes.get(task.task_id) || ''}
                              onChange={(e) => {
                                const newNotes = new Map(batchRerunNotes);
                                if (e.target.value) {
                                  newNotes.set(task.task_id, e.target.value);
                                } else {
                                  newNotes.delete(task.task_id);
                                }
                                setBatchRerunNotes(newNotes);
                              }}
                              placeholder="添加备注..."
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleEditConfig(task.task_id, false)}
                              className="text-blue-600 hover:text-blue-900 text-sm"
                            >
                              编辑配置
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 对话框底部按钮 */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBatchRerunDialog(false)}
                disabled={batchRerunLoading}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                onClick={handleConfirmBatchRerun}
                disabled={batchRerunLoading}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {batchRerunLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>确认创建 {batchRerunTasks.length} 个任务</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量增量预测预览对话框 */}
      {showBatchIncrementalDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* 对话框标题 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">批量增量预测 - 配置预览</h2>
              <button
                onClick={() => setShowBatchIncrementalDialog(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 对话框内容 */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="mb-4 p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
                <p className="text-sm text-cyan-800">
                  <strong>提示：</strong>即将为以下 {batchIncrementalTasks.length} 个任务启动增量预测。
                  增量预测将继续预测未完成的样本，不会重新创建任务。
                </p>
              </div>

              {/* 任务配置预览表格 */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 border border-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">序号</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[180px]">任务ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[200px]">数据集</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[150px]">目标列</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[140px]">模型</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">样本数</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">训练比例</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">检索样本</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">相似度阈值</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-[180px]">备注</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {batchIncrementalTasks.map((task, index) => (
                      <tr key={task.task_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{index + 1}</td>
                        <td className="px-4 py-3 text-xs font-mono text-gray-700">
                          <TruncatedText text={task.task_id} maxLength={20} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <TruncatedText text={task.filename} maxLength={25} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <TruncatedText text={task.target_columns?.join(', ') || '-'} maxLength={18} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <div className="truncate">{task.model_provider || '-'}</div>
                          <div className="text-xs text-gray-500 truncate">{task.model_name || '-'}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">{task.sample_size || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{task.train_ratio || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{task.max_retrieved_samples || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">{task.similarity_threshold || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {task.note ? (
                            <TruncatedText text={task.note} maxLength={22} />
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 对话框底部按钮 */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBatchIncrementalDialog(false)}
                disabled={batchIncrementalLoading}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                onClick={handleConfirmBatchIncremental}
                disabled={batchIncrementalLoading}
                className="px-6 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {batchIncrementalLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>启动中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>确认启动 {batchIncrementalTasks.length} 个增量预测</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配置编辑对话框 */}
      {showConfigEditDialog && editingConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* 对话框标题 */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {applyToAll ? '编辑配置（应用到所有任务）' : '编辑任务配置'}
              </h2>
              <button
                onClick={() => {
                  setShowConfigEditDialog(false);
                  setEditingTaskId(null);
                  setEditingConfig(null);
                  setApplyToAll(false);
                  setConfigTab('basic');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 标签页导航 */}
            <div className="border-b border-gray-200 bg-gray-50">
              <nav className="flex px-6">
                <button
                  onClick={() => setConfigTab('basic')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                    configTab === 'basic'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🤖 基础配置
                </button>
                <button
                  onClick={() => setConfigTab('rag')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                    configTab === 'rag'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🔍 RAG 配置
                </button>
                <button
                  onClick={() => setConfigTab('llm')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                    configTab === 'llm'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  ⚙️ LLM 配置
                </button>
                <button
                  onClick={() => setConfigTab('advanced')}
                  className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                    configTab === 'advanced'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  🔧 高级配置
                </button>
              </nav>
            </div>

            {/* 对话框内容 */}
            <div className="flex-1 overflow-y-auto p-6">
              {applyToAll && (
                <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>提示：</strong>保存后，此配置将应用到所有 {batchRerunTasks.length} 个任务。
                  </p>
                </div>
              )}

              {/* 基础配置标签页 */}
              {configTab === 'basic' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">基础配置</h3>

                  {/* 样本数量 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      测试样本数量
                      <span className="text-xs text-gray-500 ml-2">从测试集中随机抽取的样本数</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editingConfig.sample_size || ''}
                      onChange={(e) => setEditingConfig({ ...editingConfig, sample_size: parseInt(e.target.value) || 1 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>

                  {/* 并发数 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      并发数 (Workers)
                      <span className="text-xs text-gray-500 ml-2">并行预测的工作线程数</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={editingConfig.workers || ''}
                      onChange={(e) => setEditingConfig({ ...editingConfig, workers: parseInt(e.target.value) || 1 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">推荐值: 5-10</p>
                  </div>

                  {/* 训练集比例 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      训练集比例
                      <span className="text-xs text-gray-500 ml-2">范围: 0.5-0.9</span>
                    </label>
                    <input
                      type="number"
                      min={0.5}
                      max={0.9}
                      step={0.05}
                      value={editingConfig.train_ratio ?? ''}
                      onChange={(e) => setEditingConfig({ ...editingConfig, train_ratio: parseFloat(e.target.value) || 0.8 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">推荐值: 0.8 (80%)</p>
                  </div>

                  {/* 随机种子 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      随机种子
                      <span className="text-xs text-gray-500 ml-2">用于数据集划分的随机种子</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={editingConfig.random_seed || 42}
                      onChange={(e) => setEditingConfig({ ...editingConfig, random_seed: parseInt(e.target.value) || 42 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">默认值: 42</p>
                  </div>
                </div>
              )}

              {/* RAG 配置标签页 */}
              {configTab === 'rag' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">RAG 检索配置</h3>

                  {/* 数据集统计信息 */}
                  {(() => {
                    // 从数据集获取原始行数
                    const datasetRowCount = editingTaskDataset?.row_count || 0;
                    const hasDatasetInfo = !!editingTaskDataset;
                    const trainRatio = editingConfig.train_ratio || 0.8;
                    const trainCount = Math.floor(datasetRowCount * trainRatio);
                    const testCount = datasetRowCount - trainCount;
                    const retrievalRatio = trainCount > 0
                      ? ((editingConfig.max_retrieved_samples || 0) / trainCount * 100).toFixed(2)
                      : '0.00';

                    return (
                      <div className="space-y-2">
                        {!hasDatasetInfo && (
                          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-2">
                            <p className="text-sm text-yellow-800">
                              ⚠️ 无法获取数据集信息，请确保任务关联的数据集仍然存在
                            </p>
                          </div>
                        )}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <p className="text-sm text-gray-700">
                            原始数据集：<strong>{datasetRowCount}</strong> 个样本
                            {hasDatasetInfo && editingTaskDataset && (
                              <span className="text-xs text-gray-500 ml-2">
                                （来自数据集: {editingTaskDataset.original_filename}）
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-700 mt-1">
                            训练集：<strong>{trainCount}</strong> 个样本（{(trainRatio * 100).toFixed(0)}%）
                          </p>
                          <p className="text-sm text-gray-700 mt-1">
                            测试集：<strong>{testCount}</strong> 个样本
                          </p>
                          <p className="text-sm text-gray-700 mt-1">
                            检索样本数：<strong>{editingConfig.max_retrieved_samples || 0}</strong> 个（占训练集 <strong>{retrievalRatio}%</strong>）
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 最大检索样本数 - 双输入模式（双向同步） */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      检索样本数量
                    </label>
                    <div className="flex items-center space-x-4">
                      {/* 直接输入数量 */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          min={0}
                          value={editingConfig.max_retrieved_samples ?? ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setEditingConfig({ ...editingConfig, max_retrieved_samples: 0 });
                            } else {
                              const numValue = parseInt(value);
                              if (!isNaN(numValue) && numValue >= 0) {
                                setEditingConfig({ ...editingConfig, max_retrieved_samples: numValue });
                              }
                            }
                          }}
                          className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                          placeholder="数量"
                        />
                        <span className="text-sm text-gray-600">个样本</span>
                      </div>

                      <span className="text-gray-400">或</span>

                      {/* 比例输入 - 双向同步 */}
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={(() => {
                            if (retrievalRatioInput !== '') {
                              return retrievalRatioInput;
                            }
                            const datasetRowCount = editingTaskDataset?.row_count || 0;
                            const trainRatio = editingConfig.train_ratio || 0.8;
                            const trainCount = Math.floor(datasetRowCount * trainRatio);
                            return trainCount > 0
                              ? ((editingConfig.max_retrieved_samples || 0) / trainCount).toFixed(3)
                              : '';
                          })()}
                          onChange={(e) => {
                            const value = e.target.value;
                            setRetrievalRatioInput(value);
                          }}
                          onFocus={(e) => {
                            // 获取焦点时，选中所有文本
                            e.target.select();
                            // 如果当前显示的是计算值，设置为输入状态
                            if (retrievalRatioInput === '') {
                              const datasetRowCount = editingTaskDataset?.row_count || 0;
                              const trainRatio = editingConfig.train_ratio || 0.8;
                              const trainCount = Math.floor(datasetRowCount * trainRatio);
                              if (trainCount > 0) {
                                const currentRatio = ((editingConfig.max_retrieved_samples || 0) / trainCount).toFixed(3);
                                setRetrievalRatioInput(currentRatio);
                              }
                            }
                          }}
                          onBlur={() => {
                            // 失去焦点时，计算并更新样本数
                            const value = retrievalRatioInput;
                            if (value === '') {
                              return; // 如果为空，不做任何操作
                            }
                            const ratio = parseFloat(value);
                            const datasetRowCount = editingTaskDataset?.row_count || 0;
                            const trainRatio = editingConfig.train_ratio || 0.8;
                            const trainCount = Math.floor(datasetRowCount * trainRatio);

                            if (!isNaN(ratio) && ratio >= 0 && trainCount > 0) {
                              // 允许超过 1 的比例
                              const calculated = Math.round(ratio * trainCount);
                              setEditingConfig({
                                ...editingConfig,
                                max_retrieved_samples: calculated >= 0 ? calculated : 0
                              });
                            }
                            // 清空输入框，恢复显示计算值
                            setRetrievalRatioInput('');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur(); // 触发 onBlur 事件
                            }
                          }}
                          className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                          placeholder="0.000"
                          disabled={!editingTaskDataset}
                          title={!editingTaskDataset ? "数据集信息不可用" : ""}
                        />
                        <span className="text-sm text-gray-600">比例 (0-1)</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 可直接输入数量（如50）或比例（如0.8表示80%）。两个输入框自动同步，修改任一字段即可。
                    </p>
                    {editingConfig.max_retrieved_samples === 0 && (
                      <div className="mt-2 text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded p-2">
                        🔮 零样本模式：设置为 0 时，系统将使用零样本提示词模板，不检索参考样本，完全依赖 LLM 的知识进行预测
                      </div>
                    )}
                  </div>

                  {/* 相似度阈值 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      相似度阈值
                      <span className="text-xs text-gray-500 ml-2">范围: 0-1</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={editingConfig.similarity_threshold ?? ''}
                      onChange={(e) => setEditingConfig({ ...editingConfig, similarity_threshold: parseFloat(e.target.value) || 0.3 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      只返回相似度 ≥ 该阈值的样本。推荐值: 0.3
                    </p>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      💡 <strong>参数说明：</strong>
                    </p>
                    <ul className="text-sm text-blue-800 mt-2 space-y-1 list-disc list-inside">
                      <li><strong>检索样本数</strong>：控制返回多少个相似样本（绝对数量）</li>
                      <li><strong>相似度阈值</strong>：过滤低质量样本（余弦相似度 0-1）</li>
                      <li>实际返回数量 = min(满足阈值的样本数, 最大检索样本数)</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* LLM 配置标签页 */}
              {configTab === 'llm' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">LLM 模型配置</h3>

                  {/* 模型选择 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">选择模型</label>
                    {loadingModels ? (
                      <p className="text-sm text-gray-500 italic">加载模型列表中...</p>
                    ) : availableModels.length > 0 ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {availableModels.map((model) => (
                          <div
                            key={model.id}
                            onClick={() => setEditingConfig({
                              ...editingConfig,
                              model_name: model.id,
                              model_provider: model.provider,
                              temperature: model.default_temperature,
                            })}
                            className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                              editingConfig.model_name === model.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <input
                                  type="radio"
                                  checked={editingConfig.model_name === model.id}
                                  onChange={() => {}}
                                  className="w-4 h-4 text-blue-600"
                                />
                                <div>
                                  <h4 className="font-semibold text-gray-900 text-sm">{model.name}</h4>
                                  <p className="text-xs text-gray-600 mt-0.5">{model.description}</p>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    提供商: {model.provider} | 模型: {model.model}
                                  </p>
                                </div>
                              </div>
                              {editingConfig.model_name === model.id && (
                                <span className="text-blue-600 font-medium text-xs">✓ 已选择</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 italic">暂无可用模型</p>
                    )}
                  </div>

                  {/* 温度 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      温度 (Temperature)
                      <span className="text-xs text-gray-500 ml-2">范围: 0-2</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={editingConfig.temperature ?? ''}
                      onChange={(e) => setEditingConfig({ ...editingConfig, temperature: parseFloat(e.target.value) || 0 })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      控制输出的随机性。0 = 完全确定性，1-2 = 更有创造性
                    </p>
                  </div>
                </div>
              )}

              {/* 高级配置标签页 */}
              {configTab === 'advanced' && (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">高级配置</h3>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-sm text-yellow-800">
                      ⚠️ <strong>注意：</strong>以下配置项暂不支持在批量重新预测中修改。
                    </p>
                  </div>

                  {/* 元素列（只读） */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      元素组成列 <span className="text-xs text-gray-500">(只读)</span>
                    </label>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                      {Array.isArray(editingConfig.composition_column)
                        ? editingConfig.composition_column.join(', ')
                        : editingConfig.composition_column || '未设置'}
                    </div>
                  </div>

                  {/* 工艺列（只读） */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      工艺参数列 <span className="text-xs text-gray-500">(只读)</span>
                    </label>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                      {Array.isArray(editingConfig.processing_column)
                        ? editingConfig.processing_column.join(', ') || '未设置'
                        : editingConfig.processing_column || '未设置'}
                    </div>
                  </div>

                  {/* 目标列（只读） */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      目标属性列 <span className="text-xs text-gray-500">(只读)</span>
                    </label>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                      {Array.isArray(editingConfig.target_columns)
                        ? editingConfig.target_columns.join(', ')
                        : '未设置'}
                    </div>
                  </div>

                  {/* 特征列（只读） */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      特征列 <span className="text-xs text-gray-500">(只读)</span>
                    </label>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600">
                      {Array.isArray(editingConfig.feature_columns) && editingConfig.feature_columns.length > 0
                        ? editingConfig.feature_columns.join(', ')
                        : '未设置'}
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                      💡 <strong>提示：</strong>如需修改元素列、工艺列、目标列或特征列，请在新建预测页面重新创建任务。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* 对话框底部按钮 */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {applyToAll && (
                  <span className="text-blue-600 font-medium">
                    ✓ 将应用到所有 {batchRerunTasks.length} 个任务
                  </span>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowConfigEditDialog(false);
                    setEditingTaskId(null);
                    setEditingConfig(null);
                    setApplyToAll(false);
                    setConfigTab('basic');
                  }}
                  className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveConfig}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {applyToAll ? '应用到所有任务' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 批量停止确认对话框 */}
      {showBatchCancelDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">确认批量停止</h2>
            </div>

            <div className="p-6">
              <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <p className="text-sm text-orange-800">
                  <strong>警告：</strong>即将停止以下 {batchCancelTasks.length} 个任务。
                  停止后的任务状态将变为"已取消"。
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">将要停止的任务：</p>
                <div className="max-h-60 overflow-y-auto border border-gray-200 rounded p-3 bg-gray-50">
                  {batchCancelTasks.map((task, index) => (
                    <div key={task.task_id} className="text-sm py-1">
                      <span className="text-gray-600">{index + 1}. </span>
                      <span className="font-mono text-xs text-gray-700">{task.task_id}</span>
                      <span className="ml-2 text-gray-500">({task.status})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBatchCancelDialog(false)}
                disabled={batchCancelLoading}
                className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                onClick={handleConfirmBatchCancel}
                disabled={batchCancelLoading}
                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {batchCancelLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>停止中...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>确认停止 {batchCancelTasks.length} 个任务</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


