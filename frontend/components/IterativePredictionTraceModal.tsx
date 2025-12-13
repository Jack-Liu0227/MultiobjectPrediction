/**
 * 迭代预测溯源模态框组件
 * 专门用于展示迭代预测任务的详细信息，包括每轮迭代的 prompt、response 和预测值
 */

import React, { useState, useEffect, useRef } from 'react';
import ExportButton from './ExportButton';
import { exportToCSV, exportToExcel, exportToHTML, exportToPNG, generateFileName } from '@/lib/exportUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface IterativePredictionTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  sampleIndex: number;
  sampleData: any;
  allSamples?: any[]; // 所有样本数据（可选）
  allTasks?: any[]; // 所有已完成任务列表
  onTaskChange?: (taskId: string) => void; // 切换任务回调
}

export default function IterativePredictionTraceModal({
  isOpen,
  onClose,
  taskId,
  sampleIndex,
  sampleData,
  allSamples = [],
  allTasks = [],
  onTaskChange,
}: IterativePredictionTraceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'rag' | 'prompt' | 'response' | 'sample_list'>('overview');
  const [selectedIteration, setSelectedIteration] = useState<number>(1);
  const [iterationsDetails, setIterationsDetails] = useState<any[]>([]);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(sampleIndex); // 当前查看的样本索引
  const [allProcessDetails, setAllProcessDetails] = useState<any[]>([]); // 所有样本的详情
  const [promptViewMode, setPromptViewMode] = useState<'preview' | 'raw'>('preview');
  const [responseViewMode, setResponseViewMode] = useState<'preview' | 'raw'>('preview');

  // 任务切换器状态
  const [isTaskSelectorOpen, setIsTaskSelectorOpen] = useState(false);
  const taskSelectorRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (taskSelectorRef.current && !taskSelectorRef.current.contains(event.target as Node)) {
        setIsTaskSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && taskId) {
      loadTraceData();
    }
  }, [isOpen, taskId, currentSampleIndex]); // 监听 currentSampleIndex 变化

  const loadTraceData = async () => {
    setLoading(true);
    setError(null);

    try {
      // 优先从文件系统读取 process_details.json
      let processDetails: any[] | null = null;

      try {
        const fileResponse = await fetch(`http://localhost:8000/api/results/${taskId}/process_details.json`);
        if (fileResponse.ok) {
          processDetails = await fileResponse.json();
        }
      } catch (fileErr) {
        console.warn('从文件系统加载 process_details.json 失败:', fileErr);
      }

      // 回退到从数据库加载
      if (!processDetails || !Array.isArray(processDetails)) {
        const response = await fetch(`http://localhost:8000/api/tasks/${taskId}`);
        if (!response.ok) throw new Error('加载溯源数据失败');
        const taskDetailResponse = await response.json();
        processDetails = taskDetailResponse.task?.process_details;
      }

      if (!processDetails || !Array.isArray(processDetails)) {
        throw new Error('该任务没有溯源数据');
      }

      setAllProcessDetails(processDetails);

      const sampleTrace = processDetails.find((detail: any) => detail.sample_index === currentSampleIndex);
      if (!sampleTrace) {
        throw new Error(`未找到样本 ${currentSampleIndex} 的溯源数据`);
      }

      setTraceData(sampleTrace);

      // 解析迭代详情
      if (sampleTrace.iterations_details) {
        setIterationsDetails(sampleTrace.iterations_details);
        setSelectedIteration(sampleTrace.iterations_details.length); // 默认选中最后一轮
      } else {
        setIterationsDetails([]);
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 切换样本
  const handleSampleChange = (newSampleIndex: number) => {
    setCurrentSampleIndex(newSampleIndex);
    setActiveSection('overview'); // 切换样本后返回概览页
  };

  const copyToClipboard = async (text: string, type: 'prompt' | 'response') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'prompt') {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
      } else {
        setCopiedResponse(true);
        setTimeout(() => setCopiedResponse(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (!isOpen) return null;

  // 获取当前选中轮次的数据
  const currentIterationData = iterationsDetails.find((iter: any) => iter.iteration === selectedIteration);

  // 获取当前轮次的预测值（优先使用当前轮次数据，如果没有则使用最终预测值）
  const currentPredictions = currentIterationData?.predictions || traceData?.predicted_values || {};

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-white">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-900">
              🔍 预测溯源 - 样本 #{currentSampleIndex}
            </h2>

            {/* 任务切换器 */}
            {allTasks && allTasks.length > 1 && onTaskChange && (
              <div className="flex items-center gap-2 ml-4 border-l pl-4 border-gray-300 relative" ref={taskSelectorRef}>
                <span className="text-sm text-gray-500 font-medium">切换任务:</span>

                <button
                  onClick={() => setIsTaskSelectorOpen(!isTaskSelectorOpen)}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 hover:border-blue-300 transition-all text-sm text-gray-700 min-w-[250px] max-w-[400px] group"
                >
                  <span className="font-medium whitespace-normal break-words text-left line-clamp-2">
                    {(() => {
                      const currentTask = allTasks.find(t => t.task_id === taskId);
                      if (!currentTask) return '选择任务';
                      return currentTask.note || (currentTask.filename ? currentTask.filename.split(/[/\\]/).pop() : currentTask.task_id.substring(0, 8));
                    })()}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform duration-200 group-hover:text-blue-500 flex-shrink-0 ${isTaskSelectorOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isTaskSelectorOpen && (
                  <div className="absolute top-full left-0 mt-2 w-96 max-h-[400px] overflow-y-auto bg-white/95 backdrop-blur-sm border border-gray-200 rounded-xl shadow-2xl z-[60] animate-in fade-in zoom-in-95 duration-150 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                    <div className="sticky top-0 bg-gray-50/90 backdrop-blur-sm px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100 z-10">
                      任务列表 ({allTasks.length})
                    </div>
                    <div className="p-1 space-y-0.5">
                      {allTasks.map((task) => {
                        const isSelected = task.task_id === taskId;
                        const date = new Date(task.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        const name = task.note || (task.filename ? task.filename.split(/[/\\]/).pop() : `任务 ${task.task_id.substring(0, 6)}`);

                        return (
                          <button
                            key={task.task_id}
                            onClick={() => {
                              onTaskChange(task.task_id);
                              setIsTaskSelectorOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-200 group relative overflow-hidden ${isSelected
                              ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200'
                              : 'hover:bg-gray-50 text-gray-700 hover:shadow-sm'
                              }`}
                          >
                            {isSelected && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-lg"></div>
                            )}
                            <div className="flex justify-between items-start mb-0.5 pl-1">
                              <span className={`font-medium text-sm whitespace-normal break-words pr-2 ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                                {name}
                              </span>
                              {isSelected && (
                                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <div className="flex justify-between items-center text-xs pl-1 opacity-80 group-hover:opacity-100 transition-opacity">
                              <span className={`${isSelected ? 'text-blue-500' : 'text-gray-500'}`}>{date}</span>
                              <span className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                {task.task_id.substring(0, 6)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 样本选择侧边栏（最左侧）*/}
          {allProcessDetails.length > 1 && (
            <div className="w-56 border-r border-gray-200 bg-gray-50 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-200 bg-white">
                <h3 className="text-sm font-semibold text-gray-700">样本列表</h3>
                <p className="text-xs text-gray-500 mt-1">共 {allProcessDetails.length} 个样本</p>

                <button
                  onClick={() => setActiveSection('sample_list')}
                  className={`mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeSection === 'sample_list'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  所有样本概览
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {allProcessDetails
                  .sort((a, b) => a.sample_index - b.sample_index)
                  .map((detail: any) => {
                    const isActive = detail.sample_index === currentSampleIndex;
                    const displayId = detail.ID !== undefined ? `ID: ${detail.ID}` : `样本 #${detail.sample_index}`;

                    return (
                      <button
                        key={detail.sample_index}
                        onClick={() => handleSampleChange(detail.sample_index)}
                        className={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-all ${isActive
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                          }`}
                      >
                        <div className="text-xs font-medium truncate">{displayId}</div>
                        {detail.predicted_values && (
                          <div className="text-xs opacity-75 truncate mt-0.5">
                            {Object.keys(detail.predicted_values).slice(0, 2).join(', ')}
                          </div>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* 左侧导航 */}
          <div className="w-64 border-r border-gray-200 bg-white p-4 overflow-y-auto">
            <nav className="space-y-1">
              <button
                onClick={() => setActiveSection('overview')}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${activeSection === 'overview'
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <span>📊</span> 样本概览
              </button>
              <button
                onClick={() => setActiveSection('rag')}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${activeSection === 'rag'
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <span>🔍</span> RAG 检索结果
              </button>
              <button
                onClick={() => setActiveSection('prompt')}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${activeSection === 'prompt'
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <span>📝</span> LLM Prompt
              </button>
              <button
                onClick={() => setActiveSection('response')}
                className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${activeSection === 'response'
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
                  }`}
              >
                <span>💬</span> LLM 响应
              </button>
            </nav>
          </div>

          {/* 右侧内容 */}
          {activeSection === 'sample_list' ? (
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                  <h3 className="text-lg font-bold text-gray-900">所有样本概览</h3>
                  <div className="text-sm text-gray-500">
                    点击行查看详情
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">索引</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">真实值 | 预测值</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">相对误差</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">迭代</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {allProcessDetails.map((detail, idx) => {
                        // 获取第一个目标属性的真实值和预测值用于展示
                        const trueValues = detail.true_values || {};
                        const predValues = detail.final_predictions || detail.predicted_values || {};
                        const firstKey = Object.keys(trueValues)[0] || Object.keys(predValues)[0];

                        const trueVal = firstKey ? trueValues[firstKey] : null;
                        const predVal = firstKey ? predValues[firstKey] : null;

                        let errorDisplay = '-';
                        let errorColor = 'text-gray-500';

                        if (trueVal != null && predVal != null && typeof trueVal === 'number' && typeof predVal === 'number') {
                          const error = Math.abs((predVal - trueVal) / trueVal) * 100;
                          errorDisplay = `${error.toFixed(2)}%`;
                          if (error < 5) errorColor = 'text-green-600 font-medium';
                          else if (error < 10) errorColor = 'text-orange-600 font-medium';
                          else errorColor = 'text-red-600 font-medium';
                        }

                        return (
                          <tr
                            key={idx}
                            onClick={() => handleSampleChange(detail.sample_index)}
                            className={`hover:bg-blue-50 cursor-pointer transition-colors ${detail.sample_index === currentSampleIndex ? 'bg-blue-50' : ''}`}
                          >
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                              {detail.ID || '-'}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              #{detail.sample_index}
                            </td>
                            <td className="px-4 py-4 text-sm text-gray-700">
                              <div className="flex flex-col">
                                {firstKey ? (
                                  <>
                                    <span className="text-xs text-gray-400 mb-0.5">{firstKey}</span>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">T: {typeof trueVal === 'number' ? trueVal.toFixed(2) : (trueVal || '-')}</span>
                                      <span className="text-gray-400">|</span>
                                      <span className="font-medium text-blue-600">P: {typeof predVal === 'number' ? predVal.toFixed(2) : (predVal || '-')}</span>
                                    </div>
                                    {Object.keys(trueValues).length > 1 && (
                                      <span className="text-xs text-gray-400 mt-0.5">+{Object.keys(trueValues).length - 1} more</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm">
                              <span className={errorColor}>{errorDisplay}</span>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                              {detail.iterations_details ? detail.iterations_details.length : '-'} 轮
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <button className="text-blue-600 hover:text-blue-900">
                                查看详情
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-red-800">❌ {error}</p>
                </div>
              )}

              {!loading && !error && traceData && (
                <>
                  {/* 样本概览 */}
                  {activeSection === 'overview' && (
                    <div className="space-y-6 max-w-5xl mx-auto">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                          📋 测试样本完整信息
                        </h3>

                        <div className="bg-blue-50 rounded-xl p-6 border border-blue-100">
                          <div className="space-y-6">
                            {/* 样本描述 */}
                            <div>
                              <p className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
                                📋 样本描述 (Sample Description)
                              </p>
                              <div className="font-mono text-sm text-gray-800 bg-white rounded-lg p-4 border border-gray-200 whitespace-pre-line shadow-sm">
                                {traceData.sample_text || '无样本描述'}
                              </div>
                            </div>

                            {/* 样本索引和属性数量 */}
                            <div className="grid grid-cols-2 gap-6">
                              <div>
                                <p className="text-sm font-medium text-gray-600 mb-2">样本索引</p>
                                <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 shadow-sm font-medium text-gray-900">
                                  #{sampleIndex}
                                </div>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-600 mb-2">目标属性数量</p>
                                <div className="bg-white rounded-lg px-4 py-3 border border-gray-200 shadow-sm font-medium text-gray-900">
                                  {traceData.true_values ? Object.keys(traceData.true_values).length : 0} 个
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 预测结果对比 */}
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                          📊 预测结果对比
                        </h3>
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                          <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">目标属性</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">真实值</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">预测值</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">绝对误差</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">相对误差</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {traceData.true_values && Object.entries(traceData.true_values).map(([key, trueVal]: [string, any]) => {
                                const predVal = currentPredictions[key];
                                const hasPred = predVal !== undefined && predVal !== null;
                                const absError = hasPred && typeof trueVal === 'number' ? Math.abs(predVal - trueVal) : null;
                                const relError = hasPred && typeof trueVal === 'number' && trueVal !== 0 ? (Math.abs(predVal - trueVal) / Math.abs(trueVal)) * 100 : null;

                                return (
                                  <tr key={key} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{key}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-blue-600">
                                      {typeof trueVal === 'number' ? trueVal.toFixed(3) : trueVal}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-bold text-green-600">
                                      {hasPred ? (typeof predVal === 'number' ? predVal.toFixed(3) : predVal) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-medium text-red-500">
                                      {absError !== null ? absError.toFixed(3) : '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                      {relError !== null ? (
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${relError < 5 ? 'bg-green-100 text-green-800' :
                                          relError < 15 ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                          }`}>
                                          {relError.toFixed(2)}%
                                        </span>
                                      ) : '-'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>


                      {/* 迭代历史 */}
                      {traceData.iteration_history && Object.keys(traceData.iteration_history).length > 0 && (
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            📈 迭代历史
                          </h3>
                          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                            <table className="w-full">
                              <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">目标属性</th>
                                  {Array.from({ length: Math.max(...Object.values(traceData.iteration_history).map((h: any) => h.length)) }).map((_, i) => (
                                    <th key={i} className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                      第 {i + 1} 轮
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {Object.entries(traceData.iteration_history).map(([key, history]: [string, any]) => (
                                  <tr key={key} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{key}</td>
                                    {history.map((val: number, idx: number) => (
                                      <td key={idx} className="px-6 py-4 text-sm text-gray-700">
                                        {typeof val === 'number' ? val.toFixed(3) : val}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* RAG 检索结果 */}
                  {activeSection === 'rag' && (
                    <div className="space-y-6 max-w-6xl mx-auto">
                      <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          🔎 RAG 检索到的相似样本
                        </h3>
                        <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                          共 {traceData.similar_samples?.length || 0} 个
                        </span>
                      </div>

                      {traceData.similar_samples && traceData.similar_samples.length > 0 ? (
                        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200 shadow-sm">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-200">
                              <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-16">#</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[400px]">样本描述</th>
                                {traceData.true_values && Object.keys(traceData.true_values).map((key: string) => (
                                  <th key={key} className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {traceData.similar_samples.map((sample: any, idx: number) => (
                                <tr key={idx} className="hover:bg-blue-50 transition-colors">
                                  <td className="px-6 py-4 font-medium text-gray-500">
                                    {idx + 1}
                                  </td>
                                  <td className="px-6 py-4 font-mono text-xs text-gray-700 leading-relaxed">
                                    <div className="whitespace-pre-line max-h-32 overflow-y-auto">
                                      {sample.sample_text}
                                    </div>
                                  </td>
                                  {traceData.true_values && Object.keys(traceData.true_values).map((key: string) => (
                                    <td key={key} className="px-6 py-4 font-semibold text-gray-900">
                                      {typeof sample[key] === 'number' ? sample[key].toFixed(3) : (sample[key] || '-')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-12 text-center">
                          <p className="text-gray-500 text-lg">❌ 没有检索到相似样本</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* LLM Prompt */}
                  {activeSection === 'prompt' && (
                    <div className="space-y-4 max-w-6xl mx-auto h-full flex flex-col">
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          📝 发送给 LLM 的 Prompt
                        </h3>
                        <div className="flex items-center gap-4">
                          {/* 视图切换 */}
                          <div className="bg-gray-100 p-1 rounded-lg flex text-sm font-medium">
                            <button
                              onClick={() => setPromptViewMode('preview')}
                              className={`px-3 py-1.5 rounded-md transition-all ${promptViewMode === 'preview'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                              预览
                            </button>
                            <button
                              onClick={() => setPromptViewMode('raw')}
                              className={`px-3 py-1.5 rounded-md transition-all ${promptViewMode === 'raw'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                              源码
                            </button>
                          </div>

                          {/* 迭代轮次选择器 */}
                          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                            <button
                              onClick={() => setSelectedIteration(prev => Math.max(1, prev - 1))}
                              disabled={selectedIteration <= 1}
                              className="p-1.5 text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                              title="上一轮"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                            </button>

                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">选择轮次:</span>
                              <select
                                value={selectedIteration}
                                onChange={(e) => setSelectedIteration(Number(e.target.value))}
                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                              >
                                {iterationsDetails.map((iter: any) => (
                                  <option key={iter.iteration} value={iter.iteration}>
                                    第 {iter.iteration} 轮
                                  </option>
                                ))}
                              </select>
                            </div>

                            <button
                              onClick={() => setSelectedIteration(prev => Math.min(iterationsDetails.length, prev + 1))}
                              disabled={selectedIteration >= iterationsDetails.length}
                              className="p-1.5 text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                              title="下一轮"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </div>
                          <button
                            onClick={() => currentIterationData && copyToClipboard(currentIterationData.prompt, 'prompt')}
                            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors flex items-center gap-2"
                          >
                            {copiedPrompt ? '✓ 已复制' : '📋 复制 Prompt'}
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col">
                        <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                          {currentIterationData ? (
                            promptViewMode === 'preview' ? (
                              <div className="prose prose-blue max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {currentIterationData.prompt}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre className="text-sm font-mono text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {currentIterationData.prompt}
                              </pre>
                            )
                          ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                              无 Prompt 数据
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                        <span className="text-yellow-600 text-lg">💡</span>
                        <p className="text-sm text-yellow-800 pt-0.5">
                          提示：这是发送给 LLM 的完整提示词，包含系统角色、任务描述、参考样本、目标材料信息和分析协议。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* LLM Response */}
                  {activeSection === 'response' && (
                    <div className="space-y-4 max-w-6xl mx-auto h-full flex flex-col">
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          💬 LLM 的原始响应
                        </h3>
                        <div className="flex items-center gap-4">
                          {/* 视图切换 */}
                          <div className="bg-gray-100 p-1 rounded-lg flex text-sm font-medium">
                            <button
                              onClick={() => setResponseViewMode('preview')}
                              className={`px-3 py-1.5 rounded-md transition-all ${responseViewMode === 'preview'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                              预览
                            </button>
                            <button
                              onClick={() => setResponseViewMode('raw')}
                              className={`px-3 py-1.5 rounded-md transition-all ${responseViewMode === 'raw'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                              源码
                            </button>
                          </div>

                          {/* 迭代轮次选择器 */}
                          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                            <button
                              onClick={() => setSelectedIteration(prev => Math.max(1, prev - 1))}
                              disabled={selectedIteration <= 1}
                              className="p-1.5 text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                              title="上一轮"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                              </svg>
                            </button>

                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">选择轮次:</span>
                              <select
                                value={selectedIteration}
                                onChange={(e) => setSelectedIteration(Number(e.target.value))}
                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                              >
                                {iterationsDetails.map((iter: any) => (
                                  <option key={iter.iteration} value={iter.iteration}>
                                    第 {iter.iteration} 轮
                                  </option>
                                ))}
                              </select>
                            </div>

                            <button
                              onClick={() => setSelectedIteration(prev => Math.min(iterationsDetails.length, prev + 1))}
                              disabled={selectedIteration >= iterationsDetails.length}
                              className="p-1.5 text-gray-500 hover:text-blue-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                              title="下一轮"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          </div>
                          <button
                            onClick={() => currentIterationData && copyToClipboard(currentIterationData.llm_response, 'response')}
                            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors flex items-center gap-2"
                          >
                            {copiedResponse ? '✓ 已复制' : '📋 复制响应'}
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col">
                        <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                          {currentIterationData ? (
                            responseViewMode === 'preview' ? (
                              <div className="prose prose-blue max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {currentIterationData.llm_response}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre className="text-sm font-mono text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {currentIterationData.llm_response}
                              </pre>
                            )
                          ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                              无响应数据
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                        <span className="text-green-600 text-lg">💡</span>
                        <p className="text-sm text-green-800 pt-0.5">
                          提示：这是 LLM 返回的原始响应内容，包含详细的分析过程、推理依据和最终预测结果（JSON 格式）。
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
