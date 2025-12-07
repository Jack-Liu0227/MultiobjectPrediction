/**
 * 预测溯源模态框组件
 * 显示单个样本的完整预测过程：组分、工艺、RAG 检索结果、LLM prompt 和响应
 */

import React, { useState, useEffect } from 'react';
import ExportButton from './ExportButton';
import { exportToCSV, exportToExcel, exportToHTML, exportToPNG, generateFileName } from '@/lib/exportUtils';

interface PredictionTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  sampleIndex: number;
  sampleData: any;
}

export default function PredictionTraceModal({
  isOpen,
  onClose,
  taskId,
  sampleIndex,
  sampleData,
}: PredictionTraceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'rag' | 'prompt' | 'response'>('overview');
  const [promptText, setPromptText] = useState<string>('');
  const [responseText, setResponseText] = useState<string>('');
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [loadingResponse, setLoadingResponse] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);

  useEffect(() => {
    if (isOpen && taskId) {
      loadTraceData();
    }
  }, [isOpen, taskId, sampleIndex]);

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

      // 查找对应样本的详细信息
      // 优先使用 ID 查找，如果失败则使用 sample_index 查找
      const sampleId = sampleData?.ID;
      let sampleTrace = null;

      if (sampleId !== undefined && sampleId !== null) {
        // 优先使用 ID 查找
        sampleTrace = processDetails.find((detail: any) => detail.ID === sampleId);
      }

      if (!sampleTrace) {
        // 回退到使用 sample_index 查找
        sampleTrace = processDetails.find((detail: any) => detail.sample_index === sampleIndex);
      }

      if (!sampleTrace) {
        const identifier = sampleId !== undefined ? `ID=${sampleId}` : `sample_index=${sampleIndex}`;
        throw new Error(`未找到样本 ${identifier} 的溯源数据`);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        {/* 标题栏 */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">
            🔍 预测溯源 - 样本 #{sampleIndex + 1}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 左侧导航 */}
          <div className="w-48 border-r border-gray-200 p-4 space-y-2">
            <button
              onClick={() => setActiveSection('overview')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${
                activeSection === 'overview'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              📊 样本概览
            </button>
            <button
              onClick={() => setActiveSection('rag')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${
                activeSection === 'rag'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              🔎 RAG 检索结果
            </button>
            <button
              onClick={() => setActiveSection('prompt')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${
                activeSection === 'prompt'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              📝 LLM Prompt
            </button>
            <button
              onClick={() => setActiveSection('response')}
              className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium ${
                activeSection === 'response'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              💬 LLM 响应
            </button>
          </div>

          {/* 右侧内容 */}
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
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                      relError < 5 ? 'bg-green-100 text-green-800' :
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
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-900">📝 发送给 LLM 的 Prompt</h3>
                      {(promptText || traceData.prompt) && (
                        <button
                          onClick={() => copyToClipboard(promptText || traceData.prompt, 'prompt')}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            copiedPrompt
                              ? 'bg-green-500 text-white'
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {copiedPrompt ? '✓ 已复制' : '📋 复制 Prompt'}
                        </button>
                      )}
                    </div>

                    {loadingPrompt ? (
                      <div className="flex items-center justify-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                        <span className="ml-3 text-gray-600">加载 Prompt...</span>
                      </div>
                    ) : (promptText || traceData.prompt) ? (
                      <div className="bg-gray-900 text-gray-100 rounded-lg overflow-hidden border border-gray-700">
                        <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
                          <p className="text-xs text-gray-400 font-mono">
                            来源: {promptText ? `inputs/sample_${traceData.sample_index}.txt` : 'process_details.json'}
                          </p>
                        </div>
                        <div className="p-4 overflow-x-auto max-h-[600px] overflow-y-auto">
                          <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{promptText || traceData.prompt}</pre>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                        <p className="text-gray-500">❌ 没有 Prompt 数据</p>
                      </div>
                    )}

                    {/* 说明文字 */}
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-sm text-yellow-800">
                        <span className="font-semibold">💡 提示：</span>
                        这是发送给 LLM 的完整提示词，包含系统角色、任务描述、参考样本、目标材料信息和分析协议。
                      </p>
                    </div>
                  </div>
                )}

                {/* LLM 响应 */}
                {activeSection === 'response' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-900">💬 LLM 的原始响应</h3>
                      {(responseText || traceData.llm_response) && (
                        <button
                          onClick={() => copyToClipboard(responseText || traceData.llm_response, 'response')}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            copiedResponse
                              ? 'bg-green-500 text-white'
                              : 'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {copiedResponse ? '✓ 已复制' : '📋 复制响应'}
                        </button>
                      )}
                    </div>

                    {loadingResponse ? (
                      <div className="flex items-center justify-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
                        <span className="ml-3 text-gray-600">加载响应...</span>
                      </div>
                    ) : (responseText || traceData.llm_response) ? (
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg overflow-hidden border border-blue-200">
                        <div className="bg-blue-100 px-4 py-2 border-b border-blue-200">
                          <p className="text-xs text-blue-700 font-mono">
                            来源: {responseText ? `outputs/sample_${traceData.sample_index}.txt` : 'process_details.json'}
                          </p>
                        </div>
                        <div className="p-4 overflow-x-auto max-h-[600px] overflow-y-auto">
                          <pre className="text-sm whitespace-pre-wrap text-gray-900 leading-relaxed">{responseText || traceData.llm_response}</pre>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                        <p className="text-gray-500">❌ 没有响应数据</p>
                      </div>
                    )}

                    {/* 说明文字 */}
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <p className="text-sm text-green-800">
                        <span className="font-semibold">💡 提示：</span>
                        这是 LLM 返回的原始响应内容，包含详细的分析过程、推理依据和最终预测结果（JSON 格式）。
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
    </div>
  );
}


