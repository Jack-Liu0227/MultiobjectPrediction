/**
 * 预测溯源模态框组件
 * 显示单个样本的完整预测过程：组分、工艺、RAG 检索结果、LLM prompt 和响应
 */

import React, { useState, useEffect, useRef } from 'react';
import ExportButton from './ExportButton';
import { exportToCSV, exportToExcel, exportToHTML, exportToPNG, generateFileName } from '@/lib/exportUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PredictionTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  sampleIndex: number;
  sampleData: any;
  allSamples?: any[]; // 所有样本数据（可选）
  allTasks?: any[]; // 所有已完成任务列表
  onTaskChange?: (taskId: string) => void; // 切换任务回调
}

export default function PredictionTraceModal({
  isOpen,
  onClose,
  taskId,
  sampleIndex,
  sampleData,
  allSamples = [],
  allTasks = [],
  onTaskChange,
}: PredictionTraceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'rag' | 'prompt' | 'response' | 'sample_list'>('overview');
  const [promptText, setPromptText] = useState<string>('');
  const [responseText, setResponseText] = useState<string>('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [loadingResponse, setLoadingResponse] = useState(false);
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
      // 优先从文件系统读取 process_details.json（避免数据库字段大小限制）
      let processDetails: any[] | null = null;

      try {
        const fileResponse = await fetch(`http://localhost:8000/api/results/${taskId}/process_details.json`);
        if (fileResponse.ok) {
          processDetails = await fileResponse.json();
          console.log(`从文件系统加载了 ${processDetails?.length || 0} 个样本的溯源数据`);
        }
      } catch (fileErr) {
        console.warn('从文件系统加载 process_details.json 失败，尝试从数据库加载:', fileErr);
      }

      // 如果文件系统加载失败，回退到从数据库加载
      if (!processDetails || !Array.isArray(processDetails)) {
        const response = await fetch(`http://localhost:8000/api/tasks/${taskId}`);
        if (!response.ok) {
          throw new Error('加载溯源数据失败');
        }

        const taskDetailResponse = await response.json();
        // API 返回的是 { task: {...}, config: {...}, logs: [...] }
        processDetails = taskDetailResponse.task?.process_details;
        console.log(`从数据库加载了 ${processDetails?.length || 0} 个样本的溯源数据`);
      }

      if (!processDetails || !Array.isArray(processDetails)) {
        throw new Error('该任务没有溯源数据');
      }

      // 保存所有样本详情（用于侧边栏）
      setAllProcessDetails(processDetails);

      // 查找对应样本的详细信息 - 使用 currentSampleIndex 而不是 sampleIndex
      let sampleTrace = processDetails.find((detail: any) => detail.sample_index === currentSampleIndex);

      if (!sampleTrace) {
        throw new Error(`未找到样本 ${currentSampleIndex} 的溯源数据`);
      }

      setTraceData(sampleTrace);

      // 优先使用 process_details.json 中的数据
      setPromptText(sampleTrace.prompt || '');
      setResponseText(sampleTrace.llm_response || '');

      // 仅在缺失时从独立文件加载（使用 sampleTrace 中的 sample_index）
      const actualSampleIndex = sampleTrace.sample_index;
      const hasPrompt = !!sampleTrace.prompt;
      const hasResponse = !!sampleTrace.llm_response;
      loadPromptAndResponseWithIndex(taskId, actualSampleIndex, hasPrompt, hasResponse);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 从独立文件加载 prompt 和 response（使用实际的 sample_index）
  const loadPromptAndResponseWithIndex = async (
    taskId: string,
    actualSampleIndex: number,
    skipPrompt: boolean,
    skipResponse: boolean
  ) => {
    // Prompt：仅在缺失时尝试从文件加载
    if (!skipPrompt) {
      try {
        setLoadingPrompt(true);
        const promptUrl = `http://localhost:8000/api/results/${taskId}/inputs/sample_${actualSampleIndex}.txt`;
        console.log('Loading prompt from:', promptUrl);
        const promptResponse = await fetch(promptUrl);
        if (promptResponse.ok) {
          const promptContent = await promptResponse.text();
          setPromptText(promptContent);
          console.log('Prompt loaded successfully');
        } else {
          console.warn(`Prompt file not found (${promptResponse.status}), keep process_details prompt if any`);
        }
      } catch (err) {
        console.warn('Failed to load prompt from file, keep process_details prompt if any:', err);
      } finally {
        setLoadingPrompt(false);
      }
    } else {
      setLoadingPrompt(false);
    }

    // Response：仅在缺失时尝试从文件加载
    if (!skipResponse) {
      try {
        setLoadingResponse(true);
        const responseUrl = `http://localhost:8000/api/results/${taskId}/outputs/sample_${actualSampleIndex}.txt`;
        console.log('Loading response from:', responseUrl);
        const responseResponse = await fetch(responseUrl);
        if (responseResponse.ok) {
          const responseContent = await responseResponse.text();
          setResponseText(responseContent);
          console.log('Response loaded successfully');
        } else {
          console.warn(`Response file not found (${responseResponse.status}), keep process_details response if any`);
        }
      } catch (err) {
        console.warn('Failed to load response from file, keep process_details response if any:', err);
      } finally {
        setLoadingResponse(false);
      }
    } else {
      setLoadingResponse(false);
    }
  };

  // 复制到剪贴板
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
      alert('复制失败');
    }
  };

  // 切换样本
  const handleSampleChange = (newSampleIndex: number) => {
    setCurrentSampleIndex(newSampleIndex);
    setActiveSection('overview'); // 切换样本后返回概览页
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* 标题栏 */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
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

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden flex">
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
          <div className="w-48 border-r border-gray-200 p-4 space-y-2">
            <button
              onClick={() => setActiveSection('overview')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'overview'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              📊 样本概览
            </button>
            <button
              onClick={() => setActiveSection('rag')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'rag'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              🔎 RAG 检索结果
            </button>
            <button
              onClick={() => setActiveSection('prompt')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'prompt'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              📝 LLM Prompt
            </button>
            <button
              onClick={() => setActiveSection('response')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${activeSection === 'response'
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
                }`}
            >
              💬 LLM 响应
            </button>
          </div>

          {/* 右侧内容 */}
          {/* 样本列表视图 */}
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {allProcessDetails.map((detail, idx) => {
                        // 获取第一个目标属性的真实值和预测值用于展示
                        const trueValues = detail.true_values || {};
                        const predValues = detail.predicted_values || {};
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
                            onClick={() => {
                              setCurrentSampleIndex(detail.sample_index);
                              setActiveSection('overview');
                            }}
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
                            <td className="px-4 py-4 whitespace-nowrap">
                              <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                                完成
                              </span>
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
            /* 原有的内容显示区域 */
            <div className="flex-1 overflow-y-auto p-6">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                  <span className="ml-3 text-gray-600">加载溯源数据...</span>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-red-800">❌ {error}</p>
                </div>
              )}

              {!loading && !error && traceData && (
                <>
                  {/* 样本概览 */}
                  {activeSection === 'overview' && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">📋 测试样本完整信息</h3>

                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-5 border border-blue-200">
                          <div className="space-y-4">
                            {/* 样本描述（统一格式） */}
                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-2">📋 样本描述（Sample Description）</p>
                              <div className="font-mono text-sm text-gray-900 bg-white rounded px-3 py-2 border border-gray-200 whitespace-pre-line">
                                {traceData.sample_text}
                              </div>
                            </div>

                            {/* 样本索引 */}
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm font-medium text-gray-700 mb-1">样本索引</p>
                                <p className="text-sm text-gray-900 bg-white rounded px-3 py-2 border border-gray-200">
                                  #{traceData.sample_index}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-700 mb-1">目标属性数量</p>
                                <p className="text-sm text-gray-900 bg-white rounded px-3 py-2 border border-gray-200">
                                  {Object.keys(traceData.true_values).length} 个
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 预测结果对比</h3>
                        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
                          <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">目标属性</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">真实值</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">预测值</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">绝对误差</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">相对误差</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {Object.keys(traceData.true_values).map(key => {
                                const trueVal = traceData.true_values[key];
                                const predVal = traceData.predicted_values[key];
                                const absError = Math.abs(predVal - trueVal);
                                const relError = (absError / Math.abs(trueVal)) * 100;

                                return (
                                  <tr key={key} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium text-gray-900">{key}</td>
                                    <td className="px-4 py-3 text-blue-700 font-semibold">{trueVal.toFixed(3)}</td>
                                    <td className="px-4 py-3 text-green-700 font-semibold">{predVal.toFixed(3)}</td>
                                    <td className="px-4 py-3 text-red-600 font-medium">{absError.toFixed(3)}</td>
                                    <td className="px-4 py-3">
                                      <span className={`px-2 py-1 rounded text-xs font-semibold ${relError < 5 ? 'bg-green-100 text-green-800' :
                                        relError < 10 ? 'bg-yellow-100 text-yellow-800' :
                                          relError < 20 ? 'bg-orange-100 text-orange-800' :
                                            'bg-red-100 text-red-800'
                                        }`}>
                                        {relError.toFixed(2)}%
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* RAG 检索结果 */}
                  {activeSection === 'rag' && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold text-gray-900">
                            🔎 RAG 检索到的相似样本
                          </h3>
                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                            共 {traceData.similar_samples?.length || 0} 个
                          </span>
                        </div>
                        {traceData.similar_samples && traceData.similar_samples.length > 0 && (
                          <ExportButton
                            label="导出相似样本"
                            options={[
                              {
                                label: '导出为 CSV',
                                format: 'csv',
                                onClick: () => {
                                  const targetKeys = Object.keys(traceData.true_values);
                                  const exportData = traceData.similar_samples.map((sample: any, idx: number) => {
                                    const row: any = {
                                      序号: idx + 1,
                                      样本描述: sample.sample_text,
                                    };
                                    targetKeys.forEach(key => {
                                      row[key] = typeof sample[key] === 'number' ? sample[key].toFixed(3) : (sample[key] || '-');
                                    });
                                    return row;
                                  });
                                  exportToCSV(
                                    exportData,
                                    generateFileName(`similar_samples_sample_${sampleIndex}`, 'csv')
                                  );
                                },
                              },
                              {
                                label: '导出为 Excel',
                                format: 'excel',
                                onClick: () => {
                                  const targetKeys = Object.keys(traceData.true_values);
                                  const exportData = traceData.similar_samples.map((sample: any, idx: number) => {
                                    const row: any = {
                                      序号: idx + 1,
                                      样本描述: sample.sample_text,
                                    };
                                    targetKeys.forEach(key => {
                                      row[key] = typeof sample[key] === 'number' ? sample[key].toFixed(3) : (sample[key] || '-');
                                    });
                                    return row;
                                  });
                                  exportToExcel(
                                    exportData,
                                    generateFileName(`similar_samples_sample_${sampleIndex}`, 'xlsx'),
                                    '相似样本'
                                  );
                                },
                              },
                              {
                                label: '导出为 HTML',
                                format: 'html',
                                onClick: () => {
                                  const targetKeys = Object.keys(traceData.true_values);
                                  const exportData = traceData.similar_samples.map((sample: any, idx: number) => {
                                    const row: any = {
                                      序号: idx + 1,
                                      样本描述: sample.sample_text,
                                    };
                                    targetKeys.forEach(key => {
                                      row[key] = typeof sample[key] === 'number' ? sample[key].toFixed(3) : (sample[key] || '-');
                                    });
                                    return row;
                                  });
                                  exportToHTML(
                                    exportData,
                                    generateFileName(`similar_samples_sample_${sampleIndex}`, 'html'),
                                    `相似样本 - 样本 #${sampleIndex + 1}`
                                  );
                                },
                              },
                              {
                                label: '导出表格图片 (PNG)',
                                format: 'png',
                                onClick: async () => {
                                  const tableElement = document.querySelector('[data-table-type="similar-samples"]') as HTMLElement;
                                  if (tableElement) {
                                    await exportToPNG(
                                      tableElement,
                                      generateFileName(`similar_samples_table_sample_${sampleIndex}`, 'png'),
                                      { scale: 1.5 }
                                    );
                                  }
                                },
                              },
                            ]}
                          />
                        )}
                      </div>

                      {traceData.similar_samples && traceData.similar_samples.length > 0 ? (
                        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200" data-table-type="similar-samples">
                          <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase sticky left-0 bg-blue-50 z-10">#</th>
                                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase min-w-[300px]">样本描述</th>
                                {Object.keys(traceData.true_values).map(key => (
                                  <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {traceData.similar_samples.map((sample: any, idx: number) => (
                                <tr key={idx} className="hover:bg-blue-50 transition-colors">
                                  <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10">
                                    {idx + 1}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs text-gray-900 max-w-md">
                                    <div className="whitespace-pre-line" title={sample.sample_text}>
                                      {sample.sample_text}
                                    </div>
                                  </td>
                                  {Object.keys(traceData.true_values).map(key => (
                                    <td key={key} className="px-4 py-3 font-semibold text-gray-900">
                                      {typeof sample[key] === 'number' ? sample[key].toFixed(3) : (sample[key] || '-')}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                          <p className="text-gray-500">❌ 没有检索到相似样本</p>
                        </div>
                      )}

                      {/* 说明文字 */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm text-blue-800">
                          <span className="font-semibold">💡 提示：</span>
                          RAG（检索增强生成）系统从训练集中检索出与测试样本最相似的样本，作为 LLM 预测的参考依据。
                          相似度基于组分和工艺的向量嵌入计算得出。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* LLM Prompt */}
                  {activeSection === 'prompt' && (
                    <div className="space-y-4 h-full flex flex-col">
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          📝 发送给 LLM 的 Prompt
                        </h3>
                        <div className="flex items-center gap-3">
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
                          {(promptText || traceData.prompt) && (
                            <button
                              onClick={() => copyToClipboard(promptText || traceData.prompt, 'prompt')}
                              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${copiedPrompt
                                ? 'bg-green-500 text-white'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                            >
                              {copiedPrompt ? '✓ 已复制' : '📋 复制'}
                            </button>
                          )}
                        </div>
                      </div>

                      {loadingPrompt ? (
                        <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                          <span className="ml-3 text-gray-600">加载 Prompt...</span>
                        </div>
                      ) : (promptText || traceData.prompt) ? (
                        <div className="flex-1 bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col">
                          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                            <p className="text-xs text-gray-500 font-mono">
                              来源: {promptText ? `inputs/sample_${traceData.sample_index}.txt` : 'process_details.json'}
                            </p>
                          </div>
                          <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                            {promptViewMode === 'preview' ? (
                              <div className="prose prose-blue max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {promptText || traceData.prompt}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre className="text-sm font-mono text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {promptText || traceData.prompt}
                              </pre>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center">
                          <p className="text-gray-500 text-lg">❌ 没有 Prompt 数据</p>
                        </div>
                      )}

                      {/* 说明文字 */}
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
                        <span className="text-yellow-600 text-lg">💡</span>
                        <p className="text-sm text-yellow-800 pt-0.5">
                          提示：这是发送给 LLM 的完整提示词，包含系统角色、任务描述、参考样本、目标材料信息和分析协议。
                        </p>
                      </div>
                    </div>
                  )}

                  {/* LLM 响应 */}
                  {activeSection === 'response' && (
                    <div className="space-y-4 h-full flex flex-col">
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          💬 LLM 的原始响应
                        </h3>
                        <div className="flex items-center gap-3">
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
                          {(responseText || traceData.llm_response) && (
                            <button
                              onClick={() => copyToClipboard(responseText || traceData.llm_response, 'response')}
                              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${copiedResponse
                                ? 'bg-green-500 text-white'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                            >
                              {copiedResponse ? '✓ 已复制' : '📋 复制'}
                            </button>
                          )}
                        </div>
                      </div>

                      {loadingResponse ? (
                        <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                          <span className="ml-3 text-gray-600">加载响应...</span>
                        </div>
                      ) : (responseText || traceData.llm_response) ? (
                        <div className="flex-1 bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm flex flex-col">
                          <div className="bg-blue-50 px-4 py-2 border-b border-blue-100 flex justify-between items-center">
                            <p className="text-xs text-blue-600 font-mono">
                              来源: {responseText ? `outputs/sample_${traceData.sample_index}.txt` : 'process_details.json'}
                            </p>
                          </div>
                          <div className="flex-1 p-6 overflow-auto custom-scrollbar">
                            {responseViewMode === 'preview' ? (
                              <div className="prose prose-blue max-w-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {responseText || traceData.llm_response}
                                </ReactMarkdown>
                              </div>
                            ) : (
                              <pre className="text-sm font-mono text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {responseText || traceData.llm_response}
                              </pre>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center">
                          <p className="text-gray-500 text-lg">❌ 没有响应数据</p>
                        </div>
                      )}

                      {/* 说明文字 */}
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

        {/* 底部操作栏 */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            关闭
          </button>
        </div>
      </div>
    </div >
  );
}


