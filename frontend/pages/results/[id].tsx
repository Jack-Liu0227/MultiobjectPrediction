/**
 * 结果展示页面
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { getResults, getParetoAnalysis, triggerDownload, getTaskStatus, getTaskList } from '@/lib/api';
import PredictionTraceModal from '@/components/PredictionTraceModal';
import { taskEvents } from '@/lib/taskEvents';
import ExportButton, { ExportOption } from '@/components/ExportButton';
import {
  exportToCSV,
  exportToExcel,
  exportToHTML,
  exportToPNG,
  generateFileName,
  extractChartData,
} from '@/lib/exportUtils';

// 图表加载占位组件
const ChartLoading = ({ height = 'h-80' }: { height?: string }) => (
  <div className={`${height} flex items-center justify-center bg-gray-50 rounded-lg`}>
    <div className="flex flex-col items-center gap-2">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      <span className="text-gray-500 text-sm">加载图表...</span>
    </div>
  </div>
);

// 动态导入图表组件（避免 SSR 问题）
const ParetoFrontChart = dynamic(
  () => import('@/components/charts/ParetoFrontChart'),
  { ssr: false, loading: () => <ChartLoading height="h-96" /> }
);
const PredictionComparisonChart = dynamic(
  () => import('@/components/charts/PredictionComparisonChart'),
  { ssr: false, loading: () => <ChartLoading height="h-80" /> }
);
const ErrorDistributionChart = dynamic(
  () => import('@/components/charts/ErrorDistributionChart'),
  { ssr: false, loading: () => <ChartLoading height="h-64" /> }
);
const PredictionScatterChart = dynamic(
  () => import('@/components/charts/PredictionScatterChart'),
  { ssr: false, loading: () => <ChartLoading height="h-96" /> }
);

// 预加载图表组件（在页面加载后预先下载 JS）
const preloadCharts = () => {
  // 延迟预加载，不阻塞主要内容
  setTimeout(() => {
    import('@/components/charts/ParetoFrontChart');
    import('@/components/charts/PredictionComparisonChart');
    import('@/components/charts/ErrorDistributionChart');
    import('@/components/charts/PredictionScatterChart');
  }, 1000);
};

export default function ResultsPage() {
  const router = useRouter();
  const { id } = router.query;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [paretoAnalysis, setParetoAnalysis] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'predictions' | 'metrics' | 'charts' | 'pareto' | 'scatter'>('predictions');
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  const [selectedPoint, setSelectedPoint] = useState<any>(null);
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [taskStatus, setTaskStatus] = useState<any>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [taskConfig, setTaskConfig] = useState<any>(null);

  // 任务切换相关状态
  const [completedTasks, setCompletedTasks] = useState<any[]>([]);
  const [showTaskSelector, setShowTaskSelector] = useState(false);
  const taskSelectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      checkTaskStatusAndLoadResults(id as string);
      loadTaskConfig();
    }

    // 清理轮询
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [id]);

  // 加载已完成任务列表（用于任务切换）
  useEffect(() => {
    loadCompletedTasks();

    // 点击外部关闭下拉菜单
    const handleClickOutside = (event: MouseEvent) => {
      if (taskSelectorRef.current && !taskSelectorRef.current.contains(event.target as Node)) {
        setShowTaskSelector(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 监听任务更新事件（跨组件同步）
  useEffect(() => {
    const handleNoteUpdate = (data: { taskId: string; field?: string; value?: any }) => {
      // 更新已完成任务列表中的 Note
      setCompletedTasks(prevTasks =>
        prevTasks.map(t =>
          t.task_id === data.taskId ? { ...t, note: data.value } : t
        )
      );

      // 如果当前查看的任务被更新，也更新任务配置
      if (taskConfig?.task_id === data.taskId) {
        setTaskConfig((prev: any) => prev ? { ...prev, note: data.value } : null);
      }
    };

    taskEvents.on('note-updated', handleNoteUpdate);

    return () => {
      taskEvents.off('note-updated', handleNoteUpdate);
    };
  }, [taskConfig]);

  const loadCompletedTasks = async () => {
    try {
      const response = await getTaskList({ status: 'completed', page_size: 50, sort_by: 'created_at', sort_order: 'desc' });
      if (response?.tasks) {
        setCompletedTasks(response.tasks);
      }
    } catch (err) {
      console.warn('Failed to load completed tasks:', err);
    }
  };

  const checkTaskStatusAndLoadResults = async (resultId: string) => {
    try {
      setLoading(true);
      setError(null);

      // 首先尝试获取任务状态
      try {
        const status = await getTaskStatus(resultId);
        setTaskStatus(status);

        // 如果任务正在运行，启动轮询
        if (status.status === 'running' || status.status === 'pending') {
          startPolling(resultId);
          setLoading(false);
          return;
        }

        // 如果任务失败，显示错误
        if (status.status === 'failed') {
          setError(status.message || '任务执行失败');
          setLoading(false);
          return;
        }
      } catch (err) {
        // 如果获取任务状态失败，可能是旧任务，直接尝试加载结果
        console.warn('无法获取任务状态，尝试直接加载结果:', err);
      }

      // 任务已完成，加载结果
      await loadResults(resultId);
    } catch (err: any) {
      setError(err.message || '加载失败');
      setLoading(false);
    }
  };

  const loadResults = async (resultId: string) => {
    try {
      setLoading(true);
      setError(null);

      // 并行加载所有数据（优化加载速度）
      const [processDetailsResponse, resultsData, paretoData] = await Promise.all([
        fetch(`http://localhost:8000/api/results/${resultId}/process_details.json`),
        getResults(resultId),
        getParetoAnalysis(resultId).catch(() => null), // Pareto 可能不存在，忽略错误
      ]);

      // 处理 process_details
      if (!processDetailsResponse.ok) {
        throw new Error('无法加载预测详情数据');
      }
      const processDetails = await processDetailsResponse.json();

      // 从 process_details 构建预测结果数据
      const predictions = processDetails.map((detail: any) => {
        const row: any = {
          sample_index: detail.sample_index,
          ID: detail.ID,
          predicted_at: detail.predicted_at || null,
        };
        // 添加真实值和预测值
        if (detail.true_values) {
          Object.entries(detail.true_values).forEach(([key, value]) => {
            row[key] = value;
          });
        }
        if (detail.predicted_values) {
          Object.entries(detail.predicted_values).forEach(([key, value]) => {
            row[`${key}_predicted`] = value;
          });
        }
        return row;
      });

      // 使用 process_details 构建的 predictions 替换原有的
      resultsData.predictions = predictions;
      setResults(resultsData);

      // 设置 Pareto 分析（如果存在）
      if (paretoData) {
        setParetoAnalysis(paretoData);
      }

      setLoading(false);

      // 数据加载完成后，预加载图表组件
      preloadCharts();
    } catch (err: any) {
      setError(err.message || '加载结果失败');
      setLoading(false);
    }
  };

  const startPolling = (resultId: string) => {
    setIsPolling(true);

    // 清除现有轮询
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // 每3秒轮询一次
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const status = await getTaskStatus(resultId);
        setTaskStatus(status);

        // 如果任务完成或失败，停止轮询并加载结果
        if (status.status === 'completed') {
          stopPolling();
          await loadResults(resultId);
        } else if (status.status === 'failed') {
          stopPolling();
          setError(status.message || '任务执行失败');
          setLoading(false);
        }
      } catch (err) {
        console.error('轮询任务状态失败:', err);
      }
    }, 3000);
  };

  const stopPolling = () => {
    setIsPolling(false);
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const handleDownload = async () => {
    if (id) {
      try {
        await triggerDownload(id as string);
      } catch (err: any) {
        alert('下载失败: ' + err.message);
      }
    }
  };

  // 加载任务配置
  const loadTaskConfig = async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/results/${id}/task_config.json`);
      if (response.ok) {
        const config = await response.json();
        setTaskConfig(config);
      }
    } catch (err) {
      console.error('加载任务配置失败:', err);
    }
  };

  // 重新预测（跳转到配置页面，让用户确认后启动新任务）
  const handleRepredict = () => {
    if (!taskConfig) {
      alert('无法加载任务配置');
      return;
    }

    // 跳转到预测配置页面，传递任务ID作为参数
    // 预测页面会加载配置，但不设置 continue_from_task_id（创建新任务）
    router.push(`/prediction?rerun_task_id=${id}`);
  };

  // 增量预测（跳转到配置页面，让用户确认后继续预测）
  const handleIncrementalPredict = () => {
    if (!taskConfig) {
      alert('无法加载任务配置');
      return;
    }

    // 跳转到预测配置页面，传递任务ID和continue标志
    // 预测页面会加载配置，并设置 continue_from_task_id（增量预测）
    router.push(`/prediction?rerun_task_id=${id}&continue=true`);
  };

  // 编辑配置后重新预测
  const handleEditConfig = () => {
    if (!taskConfig) {
      alert('无法加载任务配置');
      return;
    }

    // 从 task_config.json 中提取正确的配置数据结构
    const requestData = taskConfig.request_data;
    const configForEdit: any = {
      filename: requestData.filename,
      config: requestData.config
    };

    // 处理 file_id 或 dataset_id（优先使用 dataset_id）
    if (requestData.dataset_id) {
      configForEdit.dataset_id = requestData.dataset_id;
    } else if (requestData.file_id) {
      configForEdit.file_id = requestData.file_id;
    }

    // 将配置保存到 localStorage，然后跳转到预测页面
    localStorage.setItem('predictionConfig', JSON.stringify(configForEdit));
    router.push('/prediction?from=edit');
  };

  // 切换到其他任务
  const handleSwitchTask = (taskId: string) => {
    if (taskId !== id) {
      setShowTaskSelector(false);
      // 使用 router.push 保持当前 Tab 状态（通过 shallow routing）
      router.push(`/results/${taskId}`, undefined, { shallow: false });
    }
  };

  // 获取当前任务在列表中的索引
  const currentTaskIndex = completedTasks.findIndex(t => t.task_id === id);

  // 上一个/下一个任务
  const handlePrevTask = () => {
    if (currentTaskIndex > 0) {
      handleSwitchTask(completedTasks[currentTaskIndex - 1].task_id);
    }
  };

  const handleNextTask = () => {
    if (currentTaskIndex < completedTasks.length - 1) {
      handleSwitchTask(completedTasks[currentTaskIndex + 1].task_id);
    }
  };

  // 导出报告
  const handleExportReport = async () => {
    try {
      // 创建一个包含所有信息的 CSV 报告
      let csvContent = '# 预测结果报告\n\n';
      csvContent += `任务ID: ${id}\n`;
      csvContent += `生成时间: ${new Date().toLocaleString()}\n\n`;

      // 添加评估指标
      csvContent += '## 评估指标\n';
      Object.entries(results.metrics || {}).forEach(([target, metrics]: [string, any]) => {
        csvContent += `\n### ${target}\n`;
        Object.entries(metrics).forEach(([metric, value]: [string, any]) => {
          csvContent += `${metric}: ${value}\n`;
        });
      });

      // 添加预测数据
      csvContent += '\n## 预测数据\n';
      const headers = ['ID', '#'];
      const targetCols = Object.keys(results.metrics || {});
      targetCols.forEach(col => {
        headers.push(`${col}(真实)`, `${col}(预测)`);
      });
      csvContent += headers.join(',') + '\n';

      results.predictions.forEach((row: any, idx: number) => {
        const rowData = [
          row.ID !== undefined ? row.ID : (row._original_row_id || '-'),
          idx + 1
        ];
        targetCols.forEach(col => {
          const predCol = `${col}_predicted`;
          rowData.push(row[col] || 'N/A', row[predCol] || 'N/A');
        });
        csvContent += rowData.join(',') + '\n';
      });

      // 下载文件
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${id}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('导出报告失败，请重试');
    }
  };

  // 任务运行中的显示
  if (taskStatus && (taskStatus.status === 'running' || taskStatus.status === 'pending')) {
    const progress = taskStatus.progress || 0;
    const progressPercent = Math.round(progress * 100);

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="inline-block animate-pulse text-6xl mb-4">⚙️</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {taskStatus.status === 'pending' ? '任务准备中' : '任务运行中'}
            </h2>
            <p className="text-gray-600">{taskStatus.message || '正在处理预测任务...'}</p>
          </div>

          {/* 进度条 */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>进度</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>

          {/* 任务信息 */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">任务 ID:</span>
              <span className="font-mono text-gray-900">{id}</span>
            </div>
            {taskStatus.result_id && (
              <div className="flex justify-between">
                <span className="text-gray-600">结果 ID:</span>
                <span className="font-mono text-gray-900">{taskStatus.result_id}</span>
              </div>
            )}
            {taskConfig?.note && (
              <div className="flex flex-col">
                <span className="text-gray-600 mb-1">备注:</span>
                <span className="text-gray-900">{taskConfig.note}</span>
              </div>
            )}
          </div>

          {/* 提示信息 */}
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>页面将自动刷新，请稍候...</p>
            <p className="mt-2">
              {isPolling && (
                <span className="inline-flex items-center">
                  <span className="animate-ping inline-block w-2 h-2 bg-blue-600 rounded-full mr-2"></span>
                  正在监控任务状态
                </span>
              )}
            </p>
          </div>

          {/* 手动刷新按钮 */}
          <button
            onClick={() => id && checkTaskStatusAndLoadResults(id as string)}
            className="mt-4 w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            🔄 手动刷新
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">加载结果中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow p-8 max-w-md">
          <div className="text-red-600 text-6xl mb-4">❌</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">加载失败</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/prediction')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            返回预测页面
          </button>
        </div>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  const targetColumns = Object.keys(results.metrics || {});

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">预测结果</h1>
              <p className="text-gray-600 mt-2">结果 ID: {id}</p>
              {taskConfig?.note && (
                <p className="text-gray-600 mt-1">📝 备注: {taskConfig.note}</p>
              )}

              {/* 任务切换器 - 移到标题下方 */}
              {completedTasks.length > 1 && (
                <div className="mt-4 flex items-center gap-3 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2.5 rounded-lg border border-blue-200 shadow-sm">
                  <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">切换任务</span>

                  {/* 上一个按钮 */}
                  <button
                    onClick={handlePrevTask}
                    disabled={currentTaskIndex <= 0}
                    className="flex items-center justify-center w-8 h-8 rounded-md bg-white border border-blue-300 hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-blue-300 transition-all shadow-sm"
                    title="上一个任务"
                  >
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* 任务选择下拉菜单 */}
                  <div className="relative" ref={taskSelectorRef}>
                    <button
                      onClick={() => setShowTaskSelector(!showTaskSelector)}
                      className="flex items-center gap-3 px-4 py-2 bg-white border-2 border-blue-300 hover:border-blue-400 hover:shadow-md rounded-lg transition-all min-w-[240px] group"
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <span className="text-sm font-medium text-gray-700 truncate">
                          {currentTaskIndex >= 0 ? `第 ${currentTaskIndex + 1} 个任务，共 ${completedTasks.length} 个` : '选择任务'}
                        </span>
                      </div>
                      <svg className={`w-4 h-4 text-blue-600 transition-transform ${showTaskSelector ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showTaskSelector && (
                      <div className="absolute top-full left-0 mt-2 w-96 max-h-96 overflow-y-auto bg-white border-2 border-blue-200 rounded-xl shadow-2xl z-50">
                        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 font-semibold text-sm">
                          选择要查看的任务
                        </div>
                        {completedTasks.map((task, idx) => (
                          <button
                            key={task.task_id}
                            onClick={() => handleSwitchTask(task.task_id)}
                            className={`w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition-all ${
                              task.task_id === id ? 'bg-blue-100 border-l-4 border-l-blue-600' : 'border-l-4 border-l-transparent'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                  task.task_id === id ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                                }`}>
                                  {idx + 1}
                                </span>
                                {task.task_id === id && (
                                  <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded">当前</span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {new Date(task.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="text-sm text-gray-800 font-medium truncate">
                              {task.note || `任务 ${task.task_id.substring(0, 8)}...`}
                            </div>
                            {task.filename && (
                              <div className="text-xs text-gray-500 truncate mt-1 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                {task.filename}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 下一个按钮 */}
                  <button
                    onClick={handleNextTask}
                    disabled={currentTaskIndex >= completedTasks.length - 1}
                    className="flex items-center justify-center w-8 h-8 rounded-md bg-white border border-blue-300 hover:bg-blue-100 hover:border-blue-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-blue-300 transition-all shadow-sm"
                    title="下一个任务"
                  >
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleRepredict}
                disabled={!taskConfig}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="创建新任务，从头开始重新预测所有样本"
              >
                🔄 重新预测
              </button>
              <button
                onClick={handleIncrementalPredict}
                disabled={!taskConfig}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="使用原任务ID，继续预测未完成的样本"
              >
                ➕ 增量预测
              </button>
              <button
                onClick={handleEditConfig}
                disabled={!taskConfig}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title="修改配置后重新预测"
              >
                ✏️ 编辑配置
              </button>
              <button
                onClick={handleExportReport}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium"
                title="导出包含预测结果和分析的完整报告"
              >
                📄 导出报告
              </button>
              <button
                onClick={handleDownload}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
              >
                📥 下载结果
              </button>
              <button
                onClick={() => router.push('/prediction')}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                ← 返回
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-8 px-4">
        {/* 配置信息卡片 - 可展开/折叠 */}
        {taskConfig && (
          <details className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-lg border-2 border-blue-200 mb-6 group">
            <summary className="px-6 py-4 cursor-pointer flex items-center justify-between hover:bg-blue-100/50 rounded-t-lg transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⚙️</span>
                <h2 className="text-lg font-bold text-gray-800">任务配置参数</h2>
                <span className="text-sm text-gray-500 ml-2">
                  ({taskConfig.request_data?.config?.model_provider || '-'} / {taskConfig.request_data?.config?.model_name || '-'})
                </span>
              </div>
              <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
            </summary>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                {/* 基本信息 */}
                <div className="space-y-2 bg-white/70 p-4 rounded-lg border border-blue-100">
                  <h3 className="text-sm font-semibold text-blue-700 border-b border-blue-200 pb-1">📁 基本信息</h3>
                  <div className="text-xs">
                    <span className="text-gray-500">文件名:</span>
                    <span className="ml-1 font-medium truncate block" title={taskConfig.request_data?.filename}>{taskConfig.request_data?.filename || '-'}</span>
                  </div>
                  {taskConfig.note && (
                    <div className="text-xs">
                      <span className="text-gray-500">备注:</span>
                      <span className="ml-1 font-medium">{taskConfig.note}</span>
                    </div>
                  )}
                </div>

                {/* 列配置 */}
                <div className="space-y-2 bg-white/70 p-4 rounded-lg border border-green-100">
                  <h3 className="text-sm font-semibold text-green-700 border-b border-green-200 pb-1">📊 列配置</h3>
                  <div className="text-xs">
                    <span className="text-gray-500">目标列:</span>
                    <span className="ml-1 font-medium">{taskConfig.request_data?.config?.target_columns?.join(', ') || '-'}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-500">成分列数量:</span>
                    <span className="ml-1 font-medium">{taskConfig.request_data?.config?.composition_column?.length || 0}</span>
                  </div>
                </div>

                {/* 模型配置 */}
                <div className="space-y-2 bg-white/70 p-4 rounded-lg border border-purple-100">
                  <h3 className="text-sm font-semibold text-purple-700 border-b border-purple-200 pb-1">🤖 模型配置</h3>
                  <div className="text-xs">
                    <span className="text-gray-500">模型:</span>
                    <span className="ml-1 font-medium">{taskConfig.request_data?.config?.model_provider || '-'} / {taskConfig.request_data?.config?.model_name || '-'}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-500">温度:</span>
                    <span className="ml-1 font-medium">{taskConfig.request_data?.config?.temperature ?? '-'}</span>
                  </div>
                </div>

                {/* 执行配置 */}
                <div className="space-y-2 bg-white/70 p-4 rounded-lg border border-orange-100">
                  <h3 className="text-sm font-semibold text-orange-700 border-b border-orange-200 pb-1">⚙️ 执行配置</h3>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <div><span className="text-gray-500">样本数:</span> <span className="font-medium">{taskConfig.request_data?.config?.sample_size ?? '-'}</span></div>
                    <div><span className="text-gray-500">训练比例:</span> <span className="font-medium">{taskConfig.request_data?.config?.train_ratio ?? '-'}</span></div>
                    <div><span className="text-gray-500">检索数:</span> <span className="font-medium">{taskConfig.request_data?.config?.max_retrieved_samples ?? '-'}</span></div>
                    <div><span className="text-gray-500">相似度:</span> <span className="font-medium">{taskConfig.request_data?.config?.similarity_threshold ?? '-'}</span></div>
                    <div><span className="text-gray-500">并发数:</span> <span className="font-medium">{taskConfig.request_data?.config?.workers ?? '-'}</span></div>
                    <div><span className="text-gray-500">种子:</span> <span className="font-medium">{taskConfig.request_data?.config?.random_seed ?? '-'}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </details>
        )}

        {/* 标签页导航 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('predictions')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'predictions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                预测结果 ({results.predictions.length})
              </button>
              <button
                onClick={() => setActiveTab('metrics')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'metrics'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                评估指标
              </button>
              <button
                onClick={() => setActiveTab('charts')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'charts'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                📊 可视化图表
              </button>
              <button
                onClick={() => {
                  setActiveTab('scatter');
                  if (!selectedTarget && targetColumns.length > 0) {
                    setSelectedTarget(targetColumns[0]);
                  }
                }}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'scatter'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                🎯 预测对比散点图
              </button>
              {paretoAnalysis && (
                <button
                  onClick={() => setActiveTab('pareto')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'pareto'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Pareto 前沿 ({paretoAnalysis.pareto_count})
                </button>
              )}
            </nav>
          </div>

          {/* 标签页内容 */}
          <div className="p-6">
            {activeTab === 'predictions' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      预测数据表格
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      共 {results.predictions.length} 条数据，当前显示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, results.predictions.length)} 条
                    </p>
                  </div>
                  <div className="flex items-center space-x-4">
                    <ExportButton
                      label="导出预测数据"
                      options={[
                        {
                          label: '导出为 CSV',
                          format: 'csv',
                          onClick: () => {
                            exportToCSV(
                              results.predictions,
                              generateFileName('prediction_results_table', 'csv')
                            );
                          },
                        },
                        {
                          label: '导出为 Excel',
                          format: 'excel',
                          onClick: () => {
                            exportToExcel(
                              results.predictions,
                              generateFileName('prediction_results_table', 'xlsx'),
                              '预测结果'
                            );
                          },
                        },
                        {
                          label: '导出为 HTML',
                          format: 'html',
                          onClick: () => {
                            exportToHTML(
                              results.predictions,
                              generateFileName('prediction_results_table', 'html'),
                              `预测结果 - 任务 ${id}`
                            );
                          },
                        },
                      ]}
                    />
                    <div className="flex items-center space-x-2">
                      <label className="text-sm text-gray-600">每页显示：</label>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={results.predictions.length}>全部</option>
                      </select>
                    </div>
                    <p className="text-sm text-blue-600">
                      💡 点击任意行查看详细溯源信息
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50 z-10">
                          ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          #
                        </th>
                        {targetColumns.map((col) => (
                          <React.Fragment key={col}>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              {col} (真实)
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              {col} (预测)
                            </th>
                          </React.Fragment>
                        ))}
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          生成时间
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {results.predictions.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((row: any, idx: number) => (
                        <tr
                          key={idx}
                          className="hover:bg-blue-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setSelectedPoint({ ...row, index: row.sample_index !== undefined ? row.sample_index : idx });
                            setShowTraceModal(true);
                          }}
                        >
                          <td className="px-4 py-3 text-sm text-gray-900 font-medium sticky left-0 bg-white z-10">{row.ID !== undefined ? row.ID : (row._original_row_id || '-')}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{idx + 1}</td>
                          {targetColumns.map((col) => {
                            const predCol = `${col}_predicted`;
                            const actual = row[col];
                            const predicted = row[predCol];
                            const error = actual && predicted ? Math.abs((actual - predicted) / actual) * 100 : null;

                            return (
                              <React.Fragment key={col}>
                                <td className="px-4 py-3 text-sm text-gray-900">
                                  {actual?.toFixed(2) || 'N/A'}
                                </td>
                                <td className="px-4 py-3 text-sm">
                                  <span className={error && error > 10 ? 'text-red-600' : 'text-gray-900'}>
                                    {predicted?.toFixed(2) || 'N/A'}
                                  </span>
                                  {error && (
                                    <span className="text-xs text-gray-500 ml-2">
                                      ({error.toFixed(1)}%)
                                    </span>
                                  )}
                                </td>
                              </React.Fragment>
                            );
                          })}
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {row.predicted_at ? (
                              <span title={row.predicted_at}>
                                {new Date(row.predicted_at).toLocaleString('zh-CN', {
                                  month: '2-digit',
                                  day: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit'
                                })}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPoint({ ...row, index: row.sample_index !== undefined ? row.sample_index : idx });
                                setShowTraceModal(true);
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              查看详情 →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 分页控件 */}
                {results.predictions.length > pageSize && (
                  <div className="flex items-center justify-between mt-4 px-4">
                    <div className="text-sm text-gray-600">
                      显示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, results.predictions.length)} 条，共 {results.predictions.length} 条
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        首页
                      </button>
                      <button
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        上一页
                      </button>
                      <span className="text-sm text-gray-600">
                        第 {currentPage} / {Math.ceil(results.predictions.length / pageSize)} 页
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage >= Math.ceil(results.predictions.length / pageSize)}
                        className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        下一页
                      </button>
                      <button
                        onClick={() => setCurrentPage(Math.ceil(results.predictions.length / pageSize))}
                        disabled={currentPage >= Math.ceil(results.predictions.length / pageSize)}
                        className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                      >
                        末页
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'metrics' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    模型评估指标
                  </h3>
                  <ExportButton
                    label="导出评估指标"
                    options={[
                      {
                        label: '导出为 CSV',
                        format: 'csv',
                        onClick: () => {
                          const metricsData = targetColumns.map(col => ({
                            目标属性: col,
                            R2_Score: results.metrics[col]?.r2?.toFixed(4) || '-',
                            RMSE: results.metrics[col]?.rmse?.toFixed(4) || '-',
                            MAE: results.metrics[col]?.mae?.toFixed(4) || '-',
                            MAPE: results.metrics[col]?.mape?.toFixed(2) || '-',
                          }));
                          exportToCSV(
                            metricsData,
                            generateFileName('prediction_metrics', 'csv')
                          );
                        },
                      },
                      {
                        label: '导出为 Excel',
                        format: 'excel',
                        onClick: () => {
                          const metricsData = targetColumns.map(col => ({
                            目标属性: col,
                            R2_Score: results.metrics[col]?.r2?.toFixed(4) || '-',
                            RMSE: results.metrics[col]?.rmse?.toFixed(4) || '-',
                            MAE: results.metrics[col]?.mae?.toFixed(4) || '-',
                            MAPE: results.metrics[col]?.mape?.toFixed(2) || '-',
                          }));
                          exportToExcel(
                            metricsData,
                            generateFileName('prediction_metrics', 'xlsx'),
                            '评估指标'
                          );
                        },
                      },
                      {
                        label: '导出为 HTML',
                        format: 'html',
                        onClick: () => {
                          const metricsData = targetColumns.map(col => ({
                            目标属性: col,
                            R2_Score: results.metrics[col]?.r2?.toFixed(4) || '-',
                            RMSE: results.metrics[col]?.rmse?.toFixed(4) || '-',
                            MAE: results.metrics[col]?.mae?.toFixed(4) || '-',
                            MAPE: results.metrics[col]?.mape?.toFixed(2) || '-',
                          }));
                          exportToHTML(
                            metricsData,
                            generateFileName('prediction_metrics', 'html'),
                            `评估指标 - 任务 ${id}`
                          );
                        },
                      },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {targetColumns.map((col) => {
                    const metrics = results.metrics[col];
                    if (!metrics) return null;

                    return (
                      <div key={col} className="bg-gray-50 rounded-lg p-6">
                        <h4 className="font-medium text-gray-900 mb-4">{col}</h4>
                        <div className="space-y-3">
                          <MetricRow label="R² Score" value={metrics.r2} format="percent" />
                          <MetricRow label="RMSE" value={metrics.rmse} format="number" />
                          <MetricRow label="MAE" value={metrics.mae} format="number" />
                          <MetricRow label="MAPE" value={metrics.mape} format="percent" suffix="%" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'charts' && (
              <div className="space-y-8">
                {/* 帕累托前沿图 */}
                {targetColumns.length >= 2 && (
                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Pareto 前沿图
                      </h3>
                      <ExportButton
                        label="导出 Pareto 图"
                        options={[
                          {
                            label: '导出图片 (PNG)',
                            format: 'png',
                            onClick: async () => {
                              const chartElement = document.querySelector('[data-chart-type="pareto-charts-tab"]') as HTMLElement;
                              if (chartElement) {
                                await exportToPNG(
                                  chartElement,
                                  generateFileName('pareto_chart_image', 'png')
                                );
                              }
                            },
                          },
                          {
                            label: '导出数据 (CSV)',
                            format: 'csv',
                            onClick: () => {
                              const paretoData = results.predictions.map((pred: any) => {
                                const row: any = {
                                  样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                                };
                                targetColumns.forEach(col => {
                                  row[`${col}_真实值`] = pred[col];
                                  row[`${col}_预测值`] = pred[`${col}_predicted`];
                                });
                                row['是否Pareto最优'] = paretoAnalysis?.pareto_indices?.includes(pred.sample_index !== undefined ? pred.sample_index : pred.ID) ? '是' : '否';
                                return row;
                              });
                              exportToCSV(
                                paretoData,
                                generateFileName('pareto_chart_data', 'csv')
                              );
                            },
                          },
                        ]}
                      />
                    </div>
                    <div data-chart-type="pareto-charts-tab">
                      <ParetoFrontChart
                        predictions={results.predictions}
                        targetColumns={targetColumns}
                        paretoIndices={paretoAnalysis?.pareto_indices || []}
                        showParetoLine={true}
                      />
                    </div>
                  </div>
                )}

                {/* 真实值 vs 预测值对比图 */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">
                      真实值 vs 预测值对比
                    </h3>
                    <ExportButton
                      label="导出所有对比图"
                      options={[
                        {
                          label: '导出所有图片 (PNG)',
                          format: 'png',
                          onClick: async () => {
                            for (const col of targetColumns) {
                              const chartElement = document.querySelector(`[data-chart-type="comparison-${col}"]`) as HTMLElement;
                              if (chartElement) {
                                await exportToPNG(
                                  chartElement,
                                  generateFileName(`comparison_${col}_image`, 'png')
                                );
                                // 添加延迟避免同时导出多个图片
                                await new Promise(resolve => setTimeout(resolve, 500));
                              }
                            }
                          },
                        },
                        {
                          label: '导出所有数据 (CSV)',
                          format: 'csv',
                          onClick: () => {
                            const comparisonData = results.predictions.map((pred: any) => {
                              const row: any = {
                                样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                              };
                              targetColumns.forEach(col => {
                                row[`${col}_真实值`] = pred[col];
                                row[`${col}_预测值`] = pred[`${col}_predicted`];
                                row[`${col}_误差`] = Math.abs(pred[col] - pred[`${col}_predicted`]).toFixed(3);
                              });
                              return row;
                            });
                            exportToCSV(
                              comparisonData,
                              generateFileName('comparison_all_data', 'csv')
                            );
                          },
                        },
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {targetColumns.map((col) => (
                      <div key={col} className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-medium text-gray-900">{col}</h4>
                          <ExportButton
                            label="导出"
                            options={[
                              {
                                label: '导出图片 (PNG)',
                                format: 'png',
                                onClick: async () => {
                                  const chartElement = document.querySelector(`[data-chart-type="comparison-${col}"]`) as HTMLElement;
                                  if (chartElement) {
                                    await exportToPNG(
                                      chartElement,
                                      generateFileName(`comparison_${col}_image`, 'png')
                                    );
                                  }
                                },
                              },
                              {
                                label: '导出数据 (CSV)',
                                format: 'csv',
                                onClick: () => {
                                  const chartData = results.predictions.map((pred: any) => ({
                                    样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                                    真实值: pred[col],
                                    预测值: pred[`${col}_predicted`],
                                    误差: Math.abs(pred[col] - pred[`${col}_predicted`]).toFixed(3),
                                  }));
                                  exportToCSV(
                                    chartData,
                                    generateFileName(`comparison_${col}_data`, 'csv')
                                  );
                                },
                              },
                            ]}
                          />
                        </div>
                        <div data-chart-type={`comparison-${col}`}>
                          <PredictionComparisonChart
                            predictions={results.predictions}
                            targetColumn={col}
                            metrics={results.metrics?.[col]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 误差分布图 */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">
                      预测误差分布
                    </h3>
                    <ExportButton
                      label="导出所有误差图"
                      options={[
                        {
                          label: '导出所有图片 (PNG)',
                          format: 'png',
                          onClick: async () => {
                            for (const col of targetColumns) {
                              const chartElement = document.querySelector(`[data-chart-type="error-${col}"]`) as HTMLElement;
                              if (chartElement) {
                                await exportToPNG(
                                  chartElement,
                                  generateFileName(`error_distribution_${col}_image`, 'png')
                                );
                                await new Promise(resolve => setTimeout(resolve, 500));
                              }
                            }
                          },
                        },
                        {
                          label: '导出所有数据 (CSV)',
                          format: 'csv',
                          onClick: () => {
                            const errorData = results.predictions.map((pred: any) => {
                              const row: any = {
                                样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                              };
                              targetColumns.forEach(col => {
                                const error = pred[col] - pred[`${col}_predicted`];
                                row[`${col}_误差`] = error.toFixed(3);
                                row[`${col}_绝对误差`] = Math.abs(error).toFixed(3);
                                row[`${col}_相对误差`] = ((Math.abs(error) / Math.abs(pred[col])) * 100).toFixed(2) + '%';
                              });
                              return row;
                            });
                            exportToCSV(
                              errorData,
                              generateFileName('error_distribution_all_data', 'csv')
                            );
                          },
                        },
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {targetColumns.map((col) => (
                      <div key={col} className="bg-white rounded-lg p-4 shadow-sm">
                        <div className="flex justify-between items-center mb-2">
                          <h4 className="font-medium text-gray-900">{col}</h4>
                          <ExportButton
                            label="导出"
                            options={[
                              {
                                label: '导出图片 (PNG)',
                                format: 'png',
                                onClick: async () => {
                                  const chartElement = document.querySelector(`[data-chart-type="error-${col}"]`) as HTMLElement;
                                  if (chartElement) {
                                    await exportToPNG(
                                      chartElement,
                                      generateFileName(`error_distribution_${col}_image`, 'png')
                                    );
                                  }
                                },
                              },
                              {
                                label: '导出数据 (CSV)',
                                format: 'csv',
                                onClick: () => {
                                  const chartData = results.predictions.map((pred: any) => {
                                    const error = pred[col] - pred[`${col}_predicted`];
                                    return {
                                      样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                                      误差: error.toFixed(3),
                                      绝对误差: Math.abs(error).toFixed(3),
                                      相对误差: ((Math.abs(error) / Math.abs(pred[col])) * 100).toFixed(2) + '%',
                                    };
                                  });
                                  exportToCSV(
                                    chartData,
                                    generateFileName(`error_distribution_${col}_data`, 'csv')
                                  );
                                },
                              },
                            ]}
                          />
                        </div>
                        <div data-chart-type={`error-${col}`}>
                          <ErrorDistributionChart
                            predictions={results.predictions}
                            targetColumn={col}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'scatter' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900">
                    预测值 vs 真实值散点图
                  </h3>
                  <div className="flex items-center gap-3">
                    <ExportButton
                      label="导出散点图"
                      options={[
                        {
                          label: '导出图片 (PNG)',
                          format: 'png',
                          onClick: async () => {
                            const chartElement = document.querySelector('[data-chart-type="scatter"]') as HTMLElement;
                            if (chartElement) {
                              await exportToPNG(
                                chartElement,
                                generateFileName(`scatter_${selectedTarget}_image`, 'png')
                              );
                            }
                          },
                        },
                        {
                          label: '导出数据 (CSV)',
                          format: 'csv',
                          onClick: () => {
                            const scatterData = results.predictions.map((pred: any) => ({
                              样本索引: pred.sample_index !== undefined ? pred.sample_index : pred.ID,
                              真实值: pred[selectedTarget],
                              预测值: pred[`${selectedTarget}_predicted`],
                              绝对误差: Math.abs(pred[selectedTarget] - pred[`${selectedTarget}_predicted`]).toFixed(3),
                              相对误差: ((Math.abs(pred[selectedTarget] - pred[`${selectedTarget}_predicted`]) / Math.abs(pred[selectedTarget])) * 100).toFixed(2) + '%',
                            }));
                            exportToCSV(
                              scatterData,
                              generateFileName(`scatter_${selectedTarget}_data`, 'csv')
                            );
                          },
                        },
                      ]}
                    />
                    <label className="text-sm font-medium text-gray-700">选择目标属性:</label>
                    <select
                      value={selectedTarget}
                      onChange={(e) => setSelectedTarget(e.target.value)}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      {targetColumns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedTarget && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6" data-chart-type="scatter">
                    <PredictionScatterChart
                      predictions={results.predictions}
                      targetColumn={selectedTarget}
                      onPointClick={(dataPoint, index) => {
                        setSelectedPoint({ ...dataPoint, index });
                        setShowTraceModal(true);
                      }}
                    />
                  </div>
                )}

                <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    💡 <strong>提示：</strong>点击散点图中的任意点可查看该样本的详细溯源信息（组分、工艺、RAG 检索结果、LLM prompt 和响应）
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'pareto' && paretoAnalysis && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Pareto 前沿分析
                  </h3>
                  <ExportButton
                    label="导出 Pareto 分析"
                    options={[
                      {
                        label: '导出图片 (PNG)',
                        format: 'png',
                        onClick: async () => {
                          const chartElement = document.querySelector('[data-chart-type="pareto"]') as HTMLElement;
                          if (chartElement) {
                            await exportToPNG(
                              chartElement,
                              generateFileName('pareto_chart_image', 'png')
                            );
                          }
                        },
                      },
                      {
                        label: '导出坐标数据 (CSV)',
                        format: 'csv',
                        onClick: () => {
                          const paretoData = paretoAnalysis.pareto_points.map((point: any) => ({
                            样本索引: point.index,
                            ...targetColumns.reduce((acc: any, col: string) => {
                              acc[`${col}_真实值`] = point[col];
                              acc[`${col}_预测值`] = point[`${col}_predicted`];
                              return acc;
                            }, {}),
                          }));
                          exportToCSV(
                            paretoData,
                            generateFileName('pareto_chart_data', 'csv')
                          );
                        },
                      },
                      {
                        label: '导出指标 (CSV)',
                        format: 'csv',
                        onClick: () => {
                          const metricsData = [
                            {
                              指标名称: '总样本数',
                              值: paretoAnalysis.total_points,
                            },
                            {
                              指标名称: 'Pareto 最优解数量',
                              值: paretoAnalysis.pareto_count,
                            },
                            {
                              指标名称: 'Pareto 比例',
                              值: (paretoAnalysis.pareto_ratio * 100).toFixed(2) + '%',
                            },
                            {
                              指标名称: 'Spacing (均匀性)',
                              值: paretoAnalysis.metrics.spacing.toFixed(4),
                            },
                            {
                              指标名称: 'Spread (分布范围)',
                              值: paretoAnalysis.metrics.spread.toFixed(4),
                            },
                            {
                              指标名称: 'Hypervolume (超体积)',
                              值: paretoAnalysis.metrics.hypervolume.toFixed(2),
                            },
                          ];
                          exportToCSV(
                            metricsData,
                            generateFileName('pareto_metrics', 'csv')
                          );
                        },
                      },
                    ]}
                  />
                </div>

                {/* Pareto 统计 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-sm text-blue-600 font-medium">总样本数</div>
                    <div className="text-2xl font-bold text-blue-900">
                      {paretoAnalysis.total_points}
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-sm text-green-600 font-medium">Pareto 最优解</div>
                    <div className="text-2xl font-bold text-green-900">
                      {paretoAnalysis.pareto_count}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4">
                    <div className="text-sm text-purple-600 font-medium">Pareto 比例</div>
                    <div className="text-2xl font-bold text-purple-900">
                      {(paretoAnalysis.pareto_ratio * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-4">
                    <div className="text-sm text-orange-600 font-medium">Hypervolume</div>
                    <div className="text-2xl font-bold text-orange-900">
                      {paretoAnalysis.metrics.hypervolume.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Pareto 指标 */}
                <div className="bg-gray-50 rounded-lg p-6 mb-6">
                  <h4 className="font-medium text-gray-900 mb-4">质量指标</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-gray-600">Spacing (均匀性)</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {paretoAnalysis.metrics.spacing.toFixed(4)}
                      </div>
                      <div className="text-xs text-gray-500">值越小越均匀</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Spread (分布范围)</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {paretoAnalysis.metrics.spread.toFixed(4)}
                      </div>
                      <div className="text-xs text-gray-500">值越大覆盖越广</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-600">Hypervolume (超体积)</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {paretoAnalysis.metrics.hypervolume.toFixed(2)}
                      </div>
                      <div className="text-xs text-gray-500">值越大质量越高</div>
                    </div>
                  </div>
                </div>

                {/* Pareto 点列表 */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-4">Pareto 最优解列表</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50 z-10">
                            ID
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                            #
                          </th>
                          {targetColumns.map((col) => (
                            <th key={col} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {paretoAnalysis.pareto_points.slice(0, 20).map((point: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 font-medium sticky left-0 bg-white z-10">{point.ID !== undefined ? point.ID : (point._original_row_id || '-')}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{idx + 1}</td>
                            {targetColumns.map((col) => {
                              const predCol = `${col}_predicted`;
                              const value = point[predCol];
                              return (
                                <td key={col} className="px-4 py-3 text-sm text-gray-900">
                                  {value?.toFixed(2) || 'N/A'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {paretoAnalysis.pareto_points.length > 20 && (
                    <p className="text-sm text-gray-500 mt-4">
                      显示前 20 个 Pareto 最优解，共 {paretoAnalysis.pareto_points.length} 个。
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 溯源模态框 */}
      {showTraceModal && selectedPoint && results.task_id && (
        <PredictionTraceModal
          isOpen={showTraceModal}
          onClose={() => setShowTraceModal(false)}
          taskId={results.task_id}
          sampleIndex={selectedPoint.index}
          sampleData={selectedPoint}
        />
      )}
    </div>
  );
}

// 指标行组件
function MetricRow({
  label,
  value,
  format,
  suffix = '',
}: {
  label: string;
  value: number;
  format: 'number' | 'percent';
  suffix?: string;
}) {
  const displayValue =
    format === 'percent'
      ? (value * 100).toFixed(2)
      : value.toFixed(4);

  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-semibold text-gray-900">
        {displayValue}{suffix}
      </span>
    </div>
  );
}

