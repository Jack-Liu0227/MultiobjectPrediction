/**
 * Task Comparison Analysis Page
 * Compare prediction results across multiple tasks
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getTaskList, compareTasksAPI, saveComparisonAPI, getComparisonHistoryAPI, getComparisonDetailAPI, deleteComparisonAPI } from '@/lib/api';
import MultiTargetScatterChart from '@/components/charts/MultiTargetScatterChart';
import ConsistencyDistributionChart from '@/components/charts/ConsistencyDistributionChart';
import { taskEvents } from '@/lib/taskEvents';

interface Task {
  task_id: string;
  status: string;
  filename: string;
  created_at: string;
  note?: string;
  config?: any;
}

export default function TaskComparisonPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [tolerance, setTolerance] = useState<number>(0);
  const [availableTargets, setAvailableTargets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonResults, setComparisonResults] = useState<{[key: string]: any}>({});

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false); // Whether to save as new when updating

  // History view state
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Custom task names mapping: { taskId: customName }
  const [customTaskNames, setCustomTaskNames] = useState<{ [taskId: string]: string }>({});

  // Client-side mount state (avoid hydration errors)
  const [mounted, setMounted] = useState(false);

  // 编辑状态
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string>('');

  // 任务表格折叠状态
  const [taskTableCollapsed, setTaskTableCollapsed] = useState(true);

  // 任务显示模式: 'id' | 'note' | 'filename' | 'custom'
  const [taskDisplayMode, setTaskDisplayMode] = useState<'id' | 'note' | 'filename' | 'custom'>('note');

  // Load localStorage values after mount (avoid hydration errors)
  useEffect(() => {
    setMounted(true);

    // Load sidebar state from localStorage
    const savedSidebarOpen = localStorage.getItem('taskComparisonSidebarOpen');
    if (savedSidebarOpen !== null) {
      setSidebarOpen(JSON.parse(savedSidebarOpen));
    }

    // Load custom task names from localStorage
    const savedCustomNames = localStorage.getItem('taskComparisonCustomNames');
    if (savedCustomNames) {
      setCustomTaskNames(JSON.parse(savedCustomNames));
    }

    // Load task table collapsed state from localStorage
    const savedCollapsed = localStorage.getItem('taskComparisonTableCollapsed');
    if (savedCollapsed !== null) {
      setTaskTableCollapsed(JSON.parse(savedCollapsed));
    }

    // Load task display mode from localStorage
    const savedDisplayMode = localStorage.getItem('taskComparisonDisplayMode');
    if (savedDisplayMode) {
      setTaskDisplayMode(savedDisplayMode as 'id' | 'note' | 'filename' | 'custom');
    }
  }, []);

  // Load completed tasks
  useEffect(() => {
    loadTasks();
  }, []);

  // Load history on mount for sidebar
  useEffect(() => {
    if (historyList.length === 0) {
      loadHistoryList();
    }
  }, []);

  // Save task table collapsed state to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('taskComparisonTableCollapsed', JSON.stringify(taskTableCollapsed));
    }
  }, [taskTableCollapsed, mounted]);

  // Save task display mode to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('taskComparisonDisplayMode', taskDisplayMode);
    }
  }, [taskDisplayMode, mounted]);

  // 监听任务更新事件（跨组件同步）
  useEffect(() => {
    const handleNoteUpdate = (data: { taskId: string; field?: string; value?: any }) => {
      // 更新任务列表中的 Note
      setTasks(prevTasks =>
        prevTasks.map(t =>
          t.task_id === data.taskId ? { ...t, note: data.value } : t
        )
      );
    };

    taskEvents.on('note-updated', handleNoteUpdate);

    return () => {
      taskEvents.off('note-updated', handleNoteUpdate);
    };
  }, []);

  // Save sidebar state to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('taskComparisonSidebarOpen', JSON.stringify(sidebarOpen));
    }
  }, [sidebarOpen]);

  // Save custom task names to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('taskComparisonCustomNames', JSON.stringify(customTaskNames));
    }
  }, [customTaskNames]);

  const loadTasks = async () => {
    try {
      const response = await getTaskList({ status: 'completed' });
      const completedTasks = response.tasks.filter((t: Task) => t.status === 'completed');
      setTasks(completedTasks);

      // Extract available target columns from task results
      const allTargets = new Set<string>();

      // Load predictions from each task to extract target columns
      for (const task of completedTasks) {
        try {
          // Get task results to extract target columns
          const resultId = task.task_id; // Assuming task_id is the result_id
          const resultResponse = await fetch(`/api/results/${resultId}`);

          if (resultResponse.ok) {
            const resultData = await resultResponse.json();

            // Extract columns ending with _predicted
            if (resultData.predictions && resultData.predictions.length > 0) {
              const firstRow = resultData.predictions[0];
              Object.keys(firstRow).forEach(key => {
                if (key.endsWith('_predicted')) {
                  const targetName = key.replace('_predicted', '');
                  allTargets.add(targetName);
                }
              });
            }
          }
        } catch (err) {
          console.warn(`Failed to load results for task ${task.task_id}:`, err);
        }
      }

      const targetsArray = Array.from(allTargets);
      console.log('Extracted target columns:', targetsArray);
      setAvailableTargets(targetsArray);

      // Select first target by default
      if (targetsArray.length > 0) {
        setSelectedTargets([targetsArray[0]]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
    }
  };

  // Get task display name based on current mode
  const getTaskDisplayName = (task: Task): string => {
    switch (taskDisplayMode) {
      case 'custom':
        return customTaskNames[task.task_id] || task.note || task.filename || task.task_id.substring(0, 8);
      case 'note':
        return task.note || task.task_id.substring(0, 8);
      case 'filename':
        return task.filename || task.task_id.substring(0, 8);
      case 'id':
      default:
        return task.task_id.substring(0, 8);
    }
  };

  // Get task display info by task_id (for history cards)
  const getTaskDisplayInfo = (taskId: string): { name: string; icon: string } => {
    const task = tasks.find(t => t.task_id === taskId);
    if (!task) {
      return { name: taskId.substring(0, 8), icon: '🔍' };
    }

    const customName = customTaskNames[taskId];
    if (customName && customName.trim() !== '') {
      return { name: customName, icon: '🏷️' };
    }
    if (task.note && task.note.trim() !== '') {
      return { name: task.note, icon: '💬' };
    }
    return { name: task.filename || taskId.substring(0, 8), icon: '📄' };
  };

  // Handle task selection
  const handleTaskToggle = (taskId: string) => {
    setSelectedTaskIds(prev => {
      if (prev.includes(taskId)) {
        return prev.filter(id => id !== taskId);
      } else {
        return [...prev, taskId];
      }
    });
  };

  // Handle target selection
  const handleTargetToggle = (target: string) => {
    setSelectedTargets(prev => {
      if (prev.includes(target)) {
        return prev.filter(t => t !== target);
      } else {
        return [...prev, target];
      }
    });
  };

  // Handle comparison
  const handleCompare = async () => {
    if (selectedTaskIds.length < 2) {
      setError('Please select at least 2 tasks to compare');
      return;
    }

    if (selectedTargets.length === 0) {
      setError('Please select at least one target column');
      return;
    }

    setLoading(true);
    setError(null);
    setComparisonResults({});

    try {
      // 调用新的多目标属性对比API
      const result = await compareTasksAPI({
        task_ids: selectedTaskIds,
        target_columns: selectedTargets,
        tolerance: tolerance,
      });

      // 将结果存储为单个对比结果
      setComparisonResults({ 'multi-target': result });

      // Note: activeHistoryId is kept so user can update the existing comparison
      // It will be cleared when saving or when clicking "Clear & Start New"
    } catch (err: any) {
      setError(err.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  // Download chart
  const handleDownloadChart = () => {
    // TODO: Implement chart download functionality
    alert('Chart download feature coming soon!');
  };

  // Toggle sidebar
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  // Format relative time
  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // 开始编辑备注
  const handleStartEditNote = (taskId: string, currentNote: string) => {
    setEditingTaskId(taskId);
    setEditingNote(currentNote || '');
  };

  // 保存备注
  const handleSaveNote = async (taskId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/tasks/${taskId}/note`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note: editingNote }),
      });

      if (!response.ok) {
        throw new Error('更新备注失败');
      }

      // 更新本地任务列表
      setTasks(tasks.map(t =>
        t.task_id === taskId ? { ...t, note: editingNote } : t
      ));

      // 触发事件，通知其他组件更新
      taskEvents.emit('note-updated', {
        taskId,
        field: 'note',
        value: editingNote,
      });

      // 清除编辑状态
      setEditingTaskId(null);
      setEditingNote('');
    } catch (err: any) {
      alert(err.message || '更新备注失败');
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingTaskId(null);
    setEditingNote('');
  };

  // Save comparison result
  const handleSaveComparison = async () => {
    if (!comparisonResults['multi-target']) {
      alert('No comparison results to save');
      return;
    }

    setSaving(true);
    try {
      // If updating an existing comparison and not saving as new, delete the old one first
      if (activeHistoryId && !saveAsNew) {
        await deleteComparisonAPI(activeHistoryId);
      }

      await saveComparisonAPI({
        task_ids: selectedTaskIds,
        target_columns: selectedTargets,
        tolerance: tolerance,
        comparison_results: comparisonResults['multi-target'],
        note: saveNote || undefined,
      });

      setSaveSuccess(true);
      setShowSaveDialog(false);
      setSaveNote('');
      setSaveAsNew(false);

      // Refresh history list
      await loadHistoryList();

      // Clear active history ID if we saved as new or updated
      if (saveAsNew || activeHistoryId) {
        setActiveHistoryId(null);
      }

      // Show success message
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save comparison: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Load history list
  const loadHistoryList = async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const history = await getComparisonHistoryAPI();
      setHistoryList(history);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Switch to history tab and load history
  const handleOpenHistory = () => {
    setActiveTab('history');
    if (historyList.length === 0) {
      loadHistoryList();
    }
  };

  // Load a specific comparison from history
  const handleLoadComparison = async (comparisonId: string) => {
    try {
      const detail = await getComparisonDetailAPI(comparisonId);

      // Set the comparison results
      setComparisonResults({ 'multi-target': detail.comparison_results });

      // Set the form values
      setSelectedTaskIds(detail.task_ids);
      setSelectedTargets(detail.target_columns);
      setTolerance(detail.tolerance);

      // Set active history ID for highlighting
      setActiveHistoryId(comparisonId);

      // Switch to new comparison tab to show results
      setActiveTab('new');
    } catch (err: any) {
      alert(`Failed to load comparison: ${err.message}`);
    }
  };

  // Delete a comparison
  const handleDeleteComparison = async (comparisonId: string) => {
    try {
      await deleteComparisonAPI(comparisonId);

      // Refresh history list
      await loadHistoryList();

      // Close confirm dialog
      setDeleteConfirmId(null);

      // Show success message briefly
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to delete comparison: ${err.message}`);
    }
  };

  // Prevent rendering until mounted (avoid hydration errors)
  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
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
                <h1 className="text-2xl font-bold text-gray-900">任务对比分析</h1>
                <p className="text-sm text-gray-500 mt-1">对比多个任务的预测结果</p>
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


          {/* Task Selection - Compact Card at Top */}
          <div className="mt-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-sm">
            <div className="p-4">
              {/* Header with collapse button */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <button
                    onClick={() => setTaskTableCollapsed(!taskTableCollapsed)}
                    className="w-8 h-8 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center justify-center transition-colors"
                    title={taskTableCollapsed ? '展开任务列表' : '折叠任务列表'}
                  >
                    <svg
                      className={`w-5 h-5 text-white transition-transform duration-200 ${taskTableCollapsed ? '' : 'rotate-180'}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-gray-900">选择任务</h3>
                    <p className="text-xs text-gray-600">
                      {selectedTaskIds.length > 0 ? (
                        <span className="text-blue-600 font-medium">{selectedTaskIds.length} 个任务已选择</span>
                      ) : (
                        '请选择至少 2 个任务进行对比'
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Display Mode Selector */}
                  {!taskTableCollapsed && (
                    <div className="flex items-center gap-2 bg-white rounded-lg p-1 border border-blue-200">
                      <button
                        onClick={() => setTaskDisplayMode('id')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          taskDisplayMode === 'id'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                        title="显示任务ID"
                      >
                        ID
                      </button>
                      <button
                        onClick={() => setTaskDisplayMode('note')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          taskDisplayMode === 'note'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                        title="显示备注"
                      >
                        备注
                      </button>
                      <button
                        onClick={() => setTaskDisplayMode('filename')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          taskDisplayMode === 'filename'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                        title="显示文件名"
                      >
                        文件名
                      </button>
                      <button
                        onClick={() => setTaskDisplayMode('custom')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          taskDisplayMode === 'custom'
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                        title="显示自定义名称"
                      >
                        自定义
                      </button>
                    </div>
                  )}
                  {tasks.length > 0 && !taskTableCollapsed && (
                    <button
                      onClick={() => {
                        if (selectedTaskIds.length === tasks.length) {
                          setSelectedTaskIds([]);
                        } else {
                          setSelectedTaskIds(tasks.map(t => t.task_id));
                        }
                      }}
                      className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-white hover:bg-blue-50 border border-blue-300 rounded-lg transition-colors"
                    >
                      {selectedTaskIds.length === tasks.length ? '取消全选' : '全选'}
                    </button>
                  )}
                </div>
              </div>

              {/* Collapsed View - Rich Information Cards */}
              {taskTableCollapsed ? (
                tasks.length === 0 ? (
                  <div className="text-center py-4 bg-white rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-500">未找到已完成的任务</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg border border-gray-200 p-3">
                    <div className="flex flex-wrap gap-2.5">
                      {tasks.map((task, index) => {
                        const isSelected = selectedTaskIds.includes(task.task_id);
                        const displayName = getTaskDisplayName(task);
                        const hasNote = task.note && task.note.trim() !== '';
                        const hasCustomName = customTaskNames[task.task_id] && customTaskNames[task.task_id].trim() !== '';

                        return (
                          <button
                            key={task.task_id}
                            onClick={() => handleTaskToggle(task.task_id)}
                            className={`group relative inline-flex flex-col items-start gap-1 px-3 py-2 rounded-lg border-2 transition-all min-w-[200px] max-w-[320px] ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                : 'bg-white border-gray-300 text-gray-700 hover:border-blue-400 hover:shadow-sm'
                            }`}
                          >
                            {/* Top row: Number badge + Main display name */}
                            <div className="flex items-center gap-2 w-full">
                              <div className={`flex-shrink-0 w-5 h-5 rounded text-xs font-bold flex items-center justify-center ${
                                isSelected
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                              }`}>
                                {index + 1}
                              </div>
                              <span className={`text-sm font-semibold truncate flex-1 ${
                                isSelected ? 'text-white' : 'text-gray-900'
                              }`} title={displayName}>
                                {displayName}
                              </span>
                            </div>

                            {/* Secondary information rows */}
                            <div className="flex flex-col gap-0.5 w-full pl-7 text-xs">
                              {/* Show note if exists and not already the main display */}
                              {hasNote && taskDisplayMode !== 'note' && (
                                <div className={`flex items-start gap-1 ${
                                  isSelected ? 'text-blue-100' : 'text-gray-600'
                                }`}>
                                  <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                                  </svg>
                                  <span className="truncate" title={task.note}>
                                    {task.note.length > 30 ? task.note.substring(0, 30) + '...' : task.note}
                                  </span>
                                </div>
                              )}

                              {/* Show custom name if exists and not already the main display */}
                              {hasCustomName && taskDisplayMode !== 'custom' && (
                                <div className={`flex items-start gap-1 ${
                                  isSelected ? 'text-blue-100' : 'text-gray-600'
                                }`}>
                                  <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                  </svg>
                                  <span className="truncate" title={customTaskNames[task.task_id]}>
                                    {customTaskNames[task.task_id].length > 30 ? customTaskNames[task.task_id].substring(0, 30) + '...' : customTaskNames[task.task_id]}
                                  </span>
                                </div>
                              )}

                              {/* Show filename if not already the main display */}
                              {task.filename && taskDisplayMode !== 'filename' && (
                                <div className={`flex items-start gap-1 ${
                                  isSelected ? 'text-blue-100' : 'text-gray-500'
                                }`}>
                                  <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  <span className="truncate font-mono" title={task.filename}>
                                    {task.filename.length > 25 ? task.filename.substring(0, 25) + '...' : task.filename}
                                  </span>
                                </div>
                              )}

                              {/* Always show task ID as reference */}
                              {taskDisplayMode !== 'id' && (
                                <div className={`flex items-start gap-1 ${
                                  isSelected ? 'text-blue-200' : 'text-gray-400'
                                }`}>
                                  <svg className="w-3 h-3 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                  </svg>
                                  <code className="text-xs font-mono">
                                    {task.task_id.substring(0, 8)}
                                  </code>
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              ) : (
                /* Expanded View - Detailed Table */
                tasks.length === 0 ? (
                  <div className="text-center py-8 bg-white rounded-lg border-2 border-dashed border-gray-300">
                    <svg className="w-12 h-12 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p className="text-sm text-gray-500">未找到已完成的任务</p>
                    <p className="text-xs text-gray-400 mt-1">请先完成一些预测任务</p>
                  </div>
                ) : (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100 sticky top-0 z-10">
                        <tr>
                          <th className="w-10 px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.length === tasks.length && tasks.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTaskIds(tasks.map(t => t.task_id));
                                } else {
                                  setSelectedTaskIds([]);
                                }
                              }}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            任务ID
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            备注
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            文件名
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            自定义名称
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {tasks.map((task, index) => (
                          <tr
                            key={task.task_id}
                            className={`transition-all duration-150 ${
                              selectedTaskIds.includes(task.task_id)
                                ? 'bg-blue-50 hover:bg-blue-100'
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={selectedTaskIds.includes(task.task_id)}
                                onChange={() => handleTaskToggle(task.task_id)}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded text-white text-xs font-bold flex items-center justify-center">
                                  {index + 1}
                                </div>
                                <code className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded" title={task.task_id}>
                                  {task.task_id.substring(0, 8)}
                                </code>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {editingTaskId === task.task_id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingNote}
                                    onChange={(e) => setEditingNote(e.target.value)}
                                    className="flex-1 px-3 py-1.5 text-sm border-2 border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="输入备注..."
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveNote(task.task_id);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEdit();
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSaveNote(task.task_id)}
                                    className="p-1.5 text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                                    title="保存 (Enter)"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={handleCancelEdit}
                                    className="p-1.5 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                                    title="取消 (Esc)"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                <div
                                  className="flex items-center gap-2 group cursor-pointer py-1"
                                  onClick={() => handleStartEditNote(task.task_id, task.note || '')}
                                >
                                  {task.note ? (
                                    <>
                                      <span className="flex-1 text-sm text-gray-900 line-clamp-1" title={task.note}>
                                        {task.note}
                                      </span>
                                      <svg className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                    </>
                                  ) : (
                                    <span className="flex-1 text-sm text-gray-400 italic group-hover:text-blue-600 transition-colors">
                                      点击添加备注...
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-sm text-gray-700 truncate max-w-[180px]" title={task.filename}>
                                  {task.filename}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                value={customTaskNames[task.task_id] || ''}
                                onChange={(e) => {
                                  setCustomTaskNames({
                                    ...customTaskNames,
                                    [task.task_id]: e.target.value
                                  });
                                }}
                                placeholder="输入自定义名称..."
                                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:border-blue-400 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </div>
                )
              )}

              {/* Tips - Only show when expanded */}
              {!taskTableCollapsed && (
                <div className="mt-3 flex items-start gap-2 text-xs text-gray-600 bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                  <svg className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-medium text-blue-900">使用提示</p>
                    <ul className="mt-1 space-y-0.5 text-blue-800">
                      <li>• 点击备注单元格可编辑（Enter 保存，Esc 取消）</li>
                      <li>• 自定义名称将用于图表中的任务标识显示</li>
                      <li>• 选择至少 2 个任务后可开始对比分析</li>
                      <li>• 使用上方按钮切换任务显示方式（ID/备注/文件名/自定义）</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-6 border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('new')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'new'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  新建对比
                </div>
              </button>
              <button
                onClick={handleOpenHistory}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'history'
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  历史记录
                  {historyList.length > 0 && (
                    <span className="ml-1 px-2 py-0.5 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">
                      {historyList.length}
                    </span>
                  )}
                </div>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* New Comparison Tab */}
        {activeTab === 'new' && (
          <div className="flex gap-6 relative">
            {/* Main Content */}
            <div className={`flex-1 space-y-4 transition-all duration-300 ${sidebarOpen ? 'mr-0' : 'mr-0'}`}>
            {/* History Indicator */}
            {activeHistoryId && (
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-purple-900">Viewing Historical Comparison</p>
                    <p className="text-sm text-purple-700">This is a saved comparison result loaded from history</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setActiveHistoryId(null);
                    setComparisonResults({});
                    setSelectedTaskIds([]);
                    setSelectedTargets([]);
                    setTolerance(0);
                  }}
                  className="px-4 py-2 bg-white hover:bg-purple-100 text-purple-700 border border-purple-300 rounded-lg transition-colors"
                >
                  Clear & Start New
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Panel - Configuration */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-lg shadow-sm border p-6 sticky top-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                    </svg>
                    对比配置
                  </h2>

              {/* Target Column Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Columns ({selectedTargets.length} selected)
                </label>
                <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                  {availableTargets.length === 0 ? (
                    <p className="p-3 text-sm text-gray-500 text-center">No target columns available</p>
                  ) : (
                    availableTargets.map(target => (
                      <label
                        key={target}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargets.includes(target)}
                          onChange={() => handleTargetToggle(target)}
                        />
                        <span className="text-sm text-gray-900">{target}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Tolerance Setting */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tolerance (%)
                </label>
                <input
                  type="number"
                  value={tolerance}
                  onChange={(e) => setTolerance(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Relative error threshold for considering predictions as consistent
                </p>
              </div>

              {/* Compare Button */}
              <button
                onClick={handleCompare}
                disabled={loading || selectedTaskIds.length < 2}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? 'Comparing...' : 'Start Comparison'}
              </button>

              {/* Error Message */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2">
            {Object.keys(comparisonResults).length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Comparison Results</h3>
                <p className="text-gray-500">Select tasks and click "Start Comparison" to view results</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Render results */}
                {Object.entries(comparisonResults).map(([key, result]: [string, any]) => (
                  <div key={key} className="space-y-6">
                    {/* Target Column Header with Save Button */}
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-sm border-2 border-blue-200 p-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900">
                          📊 {result.target_columns.length > 1
                            ? `Multi-Target Comparison: ${result.target_columns.join(' + ')}`
                            : result.target_columns[0]
                          }
                        </h2>
                        <button
                          onClick={() => setShowSaveDialog(true)}
                          className={`px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 ${
                            activeHistoryId
                              ? 'bg-orange-600 hover:bg-orange-700'
                              : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                          </svg>
                          {activeHistoryId ? 'Update & Replace' : 'Save Result'}
                        </button>
                      </div>
                    </div>

                    {/* Summary Card */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Comparison Summary</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-600">{result.n_tasks}</p>
                          <p className="text-sm text-gray-600">Tasks Compared</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-green-600">{result.total_samples}</p>
                          <p className="text-sm text-gray-600">Common Samples</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-purple-600">{result.target_columns.length}</p>
                          <p className="text-sm text-gray-600">Target Attributes</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-orange-600">{tolerance}%</p>
                          <p className="text-sm text-gray-600">Tolerance</p>
                        </div>
                      </div>
                    </div>

                    {/* Consistency Distribution Chart */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Consistency Distribution</h3>
                      </div>
                      <ConsistencyDistributionChart
                        consistencyDistribution={result.consistency_distribution}
                        nTasks={result.n_tasks}
                      />
                    </div>

                    {/* Scatter Plots for Each Target Property */}
                    <MultiTargetScatterChart
                      comparisonData={result}
                      taskNames={Object.fromEntries(
                        tasks
                          .filter(t => result.task_ids.includes(t.task_id))
                          .map(t => [t.task_id, getTaskDisplayName(t)])
                      )}
                    />

                    {/* Detailed Statistics Table */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed Statistics</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Consistency Level
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Samples
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Percentage
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {Object.entries(result.consistency_distribution).map(([label, data]: [string, any]) => (
                              <tr key={label}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {label}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {data.count}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {data.percentage.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            </div>
          </div>

            {/* Sidebar */}
            <div className={`hidden lg:block transition-all duration-300 ${sidebarOpen ? 'w-80' : 'w-12'}`}>
              {sidebarOpen ? (
                <div className="bg-white rounded-lg shadow-sm border p-4 sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
                  {/* Sidebar Header */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">Recent History</h3>
                    <button
                      onClick={toggleSidebar}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Close sidebar"
                    >
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* History List */}
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                    </div>
                  ) : historyList.length === 0 ? (
                    <div className="text-center py-8">
                      <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm text-gray-500">No history yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {historyList.slice(0, 10).map((item) => (
                        <div
                          key={item.id}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            activeHistoryId === item.id
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div
                            className="cursor-pointer"
                            onClick={() => handleLoadComparison(item.id)}
                          >
                            {/* Time and Delete Button */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1">
                                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-xs text-gray-500">{getRelativeTime(item.created_at)}</span>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(item.id);
                                }}
                                className="p-1 hover:bg-red-50 rounded transition-colors"
                                title="Delete"
                              >
                                <svg className="w-3 h-3 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                            {/* Target Attributes */}
                            <div className="flex flex-wrap gap-1 mb-2">
                              {item.target_columns.slice(0, 2).map((col: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                  {col}
                                </span>
                              ))}
                              {item.target_columns.length > 2 && (
                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                  +{item.target_columns.length - 2}
                                </span>
                              )}
                            </div>

                            {/* Task List */}
                            <div className="mb-2 space-y-1">
                              {item.task_ids.slice(0, 3).map((taskId: string, idx: number) => {
                                const taskInfo = getTaskDisplayInfo(taskId);
                                return (
                                  <div key={idx} className="flex items-center gap-1 text-xs text-gray-700">
                                    <span>{taskInfo.icon}</span>
                                    <span className="truncate" title={taskInfo.name}>
                                      {taskInfo.name.length > 20 ? taskInfo.name.substring(0, 20) + '...' : taskInfo.name}
                                    </span>
                                  </div>
                                );
                              })}
                              {item.task_ids.length > 3 && (
                                <div className="text-xs text-gray-500 pl-4">
                                  等 {item.task_ids.length} 个任务
                                </div>
                              )}
                            </div>

                            {/* Stats */}
                            <div className="flex items-center gap-3 text-xs text-gray-600">
                              <span>{item.n_tasks} tasks</span>
                              <span>•</span>
                              <span>{item.total_samples} samples</span>
                            </div>
                          </div>

                          {/* Active Indicator */}
                          {activeHistoryId === item.id && (
                            <div className="mt-2 pt-2 border-t border-purple-200">
                              <span className="text-xs text-purple-600 font-medium">● Viewing</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* View All Button */}
                  {historyList.length > 0 && (
                    <button
                      onClick={() => setActiveTab('history')}
                      className="w-full mt-4 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors text-sm font-medium"
                    >
                      View All History ({historyList.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border p-2 sticky top-4">
                  <button
                    onClick={toggleSidebar}
                    className="p-2 hover:bg-gray-100 rounded transition-colors"
                    title="Open history sidebar"
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Floating Button */}
            <button
              onClick={toggleSidebar}
              className="lg:hidden fixed bottom-6 right-6 p-4 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg z-40"
              title="View history"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Mobile Sidebar Modal */}
            {sidebarOpen && (
              <div className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-50" onClick={toggleSidebar}>
                <div
                  className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-xl overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-4">
                    {/* Mobile Sidebar Header */}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900">Recent History</h3>
                      <button
                        onClick={toggleSidebar}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Mobile History List */}
                    {loadingHistory ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                      </div>
                    ) : historyList.length === 0 ? (
                      <div className="text-center py-8">
                        <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-gray-500">No history yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {historyList.slice(0, 10).map((item) => (
                          <div
                            key={item.id}
                            className={`p-3 rounded-lg border-2 transition-all ${
                              activeHistoryId === item.id
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200'
                            }`}
                          >
                            <div
                              className="cursor-pointer"
                              onClick={() => {
                                handleLoadComparison(item.id);
                                toggleSidebar();
                              }}
                            >
                              {/* Time and Delete Button */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1">
                                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span className="text-xs text-gray-500">{getRelativeTime(item.created_at)}</span>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmId(item.id);
                                  }}
                                  className="p-1 hover:bg-red-50 rounded transition-colors"
                                  title="Delete"
                                >
                                  <svg className="w-3 h-3 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>

                              <div className="flex flex-wrap gap-1 mb-2">
                                {item.target_columns.slice(0, 2).map((col: string, idx: number) => (
                                  <span key={idx} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                    {col}
                                  </span>
                                ))}
                                {item.target_columns.length > 2 && (
                                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                    +{item.target_columns.length - 2}
                                  </span>
                                )}
                              </div>

                              {/* Task List */}
                              <div className="mb-2 space-y-1">
                                {item.task_ids.slice(0, 3).map((taskId: string, idx: number) => {
                                  const taskInfo = getTaskDisplayInfo(taskId);
                                  return (
                                    <div key={idx} className="flex items-center gap-1 text-xs text-gray-700">
                                      <span>{taskInfo.icon}</span>
                                      <span className="truncate" title={taskInfo.name}>
                                        {taskInfo.name.length > 20 ? taskInfo.name.substring(0, 20) + '...' : taskInfo.name}
                                      </span>
                                    </div>
                                  );
                                })}
                                {item.task_ids.length > 3 && (
                                  <div className="text-xs text-gray-500 pl-4">
                                    等 {item.task_ids.length} 个任务
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs text-gray-600">
                                <span>{item.n_tasks} tasks</span>
                                <span>•</span>
                                <span>{item.total_samples} samples</span>
                              </div>
                            </div>

                            {activeHistoryId === item.id && (
                              <div className="mt-2 pt-2 border-t border-purple-200">
                                <span className="text-xs text-purple-600 font-medium">● Viewing</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Mobile View All Button */}
                    {historyList.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('history');
                          toggleSidebar();
                        }}
                        className="w-full mt-4 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors text-sm font-medium"
                      >
                        View All History ({historyList.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Search Bar */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by note or target attributes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* History List */}
            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading history...</p>
                </div>
              </div>
            ) : historyError ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {historyError}
              </div>
            ) : historyList.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No saved comparisons yet</h3>
                <p className="text-gray-500">Save a comparison to see it here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyList
                  .filter(item => {
                    if (!searchQuery) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      item.note?.toLowerCase().includes(query) ||
                      item.target_columns.some((col: string) => col.toLowerCase().includes(query))
                    );
                  })
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`bg-white rounded-lg shadow-sm border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                        activeHistoryId === item.id
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-300'
                      }`}
                      onClick={() => handleLoadComparison(item.id)}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs text-gray-500">
                              {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {activeHistoryId === item.id && (
                            <span className="inline-block px-2 py-0.5 text-xs bg-purple-600 text-white rounded-full">
                              Currently Viewing
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(item.id);
                          }}
                          className="p-1 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* Target Attributes */}
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-1">
                          {item.target_columns.map((col: string, idx: number) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Task List */}
                      <div className="mb-3 bg-gray-50 rounded-lg p-3">
                        <div className="text-xs font-medium text-gray-700 mb-2">对比任务：</div>
                        <div className="space-y-1.5">
                          {item.task_ids.slice(0, 4).map((taskId: string, idx: number) => {
                            const taskInfo = getTaskDisplayInfo(taskId);
                            return (
                              <div key={idx} className="flex items-center gap-2 text-sm text-gray-700">
                                <span className="text-base">{taskInfo.icon}</span>
                                <span className="truncate" title={taskInfo.name}>
                                  {taskInfo.name.length > 35 ? taskInfo.name.substring(0, 35) + '...' : taskInfo.name}
                                </span>
                              </div>
                            );
                          })}
                          {item.task_ids.length > 4 && (
                            <div className="text-xs text-gray-500 pl-6">
                              等 {item.task_ids.length} 个任务
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.n_tasks}</p>
                          <p className="text-xs text-gray-500">Tasks</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.total_samples}</p>
                          <p className="text-xs text-gray-500">Samples</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.tolerance}%</p>
                          <p className="text-xs text-gray-500">Tolerance</p>
                        </div>
                      </div>

                      {/* Note */}
                      {item.note && (
                        <div className="pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-600 line-clamp-2" title={item.note}>
                            💬 {item.note}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {activeHistoryId ? 'Update Comparison Result' : 'Save Comparison Result'}
              </h3>

              {/* Save Mode Selection */}
              {activeHistoryId && (
                <div className="mb-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Save Mode:</p>

                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: !saveAsNew ? '#f97316' : '#d1d5db' }}>
                    <input
                      type="radio"
                      name="saveMode"
                      checked={!saveAsNew}
                      onChange={() => setSaveAsNew(false)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span className="font-medium text-gray-900">Update Existing</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Replace the original comparison with these new results
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: saveAsNew ? '#10b981' : '#d1d5db' }}>
                    <input
                      type="radio"
                      name="saveMode"
                      checked={saveAsNew}
                      onChange={() => setSaveAsNew(true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="font-medium text-gray-900">Save as New</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Keep the original and save this as a new comparison
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Summary */}
              <div className="mb-4 p-4 bg-gray-50 rounded-lg text-sm">
                <p className="text-gray-700 mb-2">
                  <span className="font-medium">Tasks:</span> {selectedTaskIds.length} tasks
                </p>
                <p className="text-gray-700 mb-2">
                  <span className="font-medium">Target Attributes:</span> {selectedTargets.join(', ')}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium">Tolerance:</span> {tolerance}%
                </p>
              </div>

              {/* Note Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note (Optional, max 200 characters)
                </label>
                <textarea
                  value={saveNote}
                  onChange={(e) => setSaveNote(e.target.value.slice(0, 200))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Add a note about this comparison..."
                />
                <p className="text-xs text-gray-500 mt-1">{saveNote.length}/200 characters</p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSaveDialog(false);
                    setSaveNote('');
                    setSaveAsNew(false);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveComparison}
                  className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${
                    activeHistoryId && !saveAsNew
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                  disabled={saving}
                >
                  {saving
                    ? 'Saving...'
                    : activeHistoryId && !saveAsNew
                      ? 'Update Existing'
                      : 'Save as New'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Comparison saved successfully!
        </div>
      )}



      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Delete</h3>
            <p className="text-gray-700 mb-6">
              Are you sure you want to delete this comparison? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteComparison(deleteConfirmId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

