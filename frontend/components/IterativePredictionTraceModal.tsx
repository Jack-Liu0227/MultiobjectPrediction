/**
 * 迭代预测溯源模态框组件
 * 专门用于展示迭代预测任务的详细信息，包括每轮迭代的 prompt、response 和预测值
 */

import React, { useState, useEffect } from 'react';
import ExportButton from './ExportButton';
import { exportToCSV, exportToExcel, exportToHTML, exportToPNG, generateFileName } from '@/lib/exportUtils';

interface IterativePredictionTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  sampleIndex: number;
  sampleData: any;
}

export default function IterativePredictionTraceModal({
  isOpen,
  onClose,
  taskId,
  sampleIndex,
  sampleData,
}: IterativePredictionTraceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<any>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'iterations' | 'history' | 'rag'>('overview');
  const [selectedIteration, setSelectedIteration] = useState<number>(1);
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
      // 从文件系统读取 process_details.json
      const fileResponse = await fetch(`http://localhost:8000/api/results/${taskId}/process_details.json`);
      if (!fileResponse.ok) {
        throw new Error('无法加载预测详情文件');
      }

      const processDetails = await fileResponse.json();
      console.log(`从文件系统加载了 ${processDetails?.length || 0} 个样本的溯源数据`);

      // 查找当前样本的数据
      const sampleTrace = processDetails.find((detail: any) => detail.sample_index === sampleIndex);
      if (!sampleTrace) {
        throw new Error(`未找到样本 ${sampleIndex} 的溯源数据`);
      }

      setTraceData(sampleTrace);

      // 如果有迭代详情，默认选择最后一轮
      if (sampleTrace.iterations_details && sampleTrace.iterations_details.length > 0) {
        setSelectedIteration(sampleTrace.iterations_details.length);
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, type: 'prompt' | 'response') => {
    navigator.clipboard.writeText(text);
    if (type === 'prompt') {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } else {
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    }
  };

  if (!isOpen) return null;

  const iterationsDetails = traceData?.iterations_details || [];
  const currentIterationData = iterationsDetails.find((iter: any) => iter.iteration === selectedIteration);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-blue-50 to-indigo-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              🔍 迭代预测溯源详情
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              样本索引: {sampleIndex} | 任务ID: {taskId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
          >
            ×
          </button>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧导航 */}
          <div className="w-64 border-r border-gray-200 bg-gray-50 p-4 overflow-y-auto">
            <nav className="space-y-2">
              <button
                onClick={() => setActiveSection('overview')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  activeSection === 'overview'
                    ? 'bg-blue-500 text-white font-semibold'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                📋 样本概览
              </button>
              <button
                onClick={() => setActiveSection('iterations')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  activeSection === 'iterations'
                    ? 'bg-blue-500 text-white font-semibold'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                🔄 迭代详情
              </button>
              <button
                onClick={() => setActiveSection('history')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  activeSection === 'history'
                    ? 'bg-blue-500 text-white font-semibold'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                📊 迭代历史
              </button>
              <button
                onClick={() => setActiveSection('rag')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  activeSection === 'rag'
                    ? 'bg-blue-500 text-white font-semibold'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                🔎 RAG 检索
              </button>
            </nav>
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
                          {/* 样本描述 */}
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">📋 样本描述</p>
                            <div className="font-mono text-sm text-gray-900 bg-white rounded px-3 py-2 border border-gray-200 whitespace-pre-line">
                              {traceData.sample_text || '无样本描述'}
                            </div>
                          </div>

                          {/* 真实值 */}
                          {traceData.true_values && Object.keys(traceData.true_values).length > 0 && (
                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-2">✅ 真实值</p>
                              <div className="grid grid-cols-2 gap-3">
                                {Object.entries(traceData.true_values).map(([key, value]: [string, any]) => (
                                  <div key={key} className="bg-white rounded px-3 py-2 border border-gray-200">
                                    <span className="text-xs text-gray-600">{key}</span>
                                    <p className="text-lg font-bold text-green-600">
                                      {typeof value === 'number' ? value.toFixed(3) : value}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 最终预测值 */}
                          {traceData.predicted_values && Object.keys(traceData.predicted_values).length > 0 && (
                            <div>
                              <p className="text-sm font-medium text-gray-700 mb-2">🎯 最终预测值（第{iterationsDetails.length}轮）</p>
                              <div className="grid grid-cols-2 gap-3">
                                {Object.entries(traceData.predicted_values).map(([key, value]: [string, any]) => (
                                  <div key={key} className="bg-white rounded px-3 py-2 border border-gray-200">
                                    <span className="text-xs text-gray-600">{key}</span>
                                    <p className="text-lg font-bold text-blue-600">
                                      {typeof value === 'number' ? value.toFixed(3) : value}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 迭代统计 */}
                          <div>
                            <p className="text-sm font-medium text-gray-700 mb-2">🔄 迭代统计</p>
                            <div className="bg-white rounded px-3 py-2 border border-gray-200">
                              <p className="text-sm text-gray-700">
                                总迭代轮次: <span className="font-bold text-blue-600">{iterationsDetails.length}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 迭代详情 */}
                {activeSection === 'iterations' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-gray-900">🔄 迭代详情</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">选择迭代轮次:</span>
                        <select
                          value={selectedIteration}
                          onChange={(e) => setSelectedIteration(Number(e.target.value))}
                          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {iterationsDetails.map((iter: any) => (
                            <option key={iter.iteration} value={iter.iteration}>
                              第 {iter.iteration} 轮
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {currentIterationData && (
                      <div className="space-y-6">
                        {/* 预测结果 */}
                        {currentIterationData.predictions && (
                          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-5 border border-green-200">
                            <h4 className="text-md font-semibold text-gray-900 mb-3">🎯 第{selectedIteration}轮预测结果</h4>
                            <div className="grid grid-cols-2 gap-3">
                              {Object.entries(currentIterationData.predictions).map(([key, value]: [string, any]) => (
                                <div key={key} className="bg-white rounded px-3 py-2 border border-gray-200">
                                  <span className="text-xs text-gray-600">{key}</span>
                                  <p className="text-lg font-bold text-green-600">
                                    {typeof value === 'number' ? value.toFixed(3) : value}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Prompt */}
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="text-md font-semibold text-gray-900">📝 Prompt（第{selectedIteration}轮）</h4>
                            <button
                              onClick={() => copyToClipboard(currentIterationData.prompt, 'prompt')}
                              className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                            >
                              {copiedPrompt ? '✓ 已复制' : '📋 复制'}
                            </button>
                          </div>
                          <div className="bg-gray-900 text-gray-100 rounded-lg overflow-hidden border border-gray-700">
                            <div className="p-4 overflow-x-auto max-h-[400px] overflow-y-auto">
                              <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                                {currentIterationData.prompt}
                              </pre>
                            </div>
                          </div>
                        </div>

                        {/* LLM Response */}
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="text-md font-semibold text-gray-900">💬 LLM 响应（第{selectedIteration}轮）</h4>
                            <button
                              onClick={() => copyToClipboard(currentIterationData.llm_response, 'response')}
                              className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
                            >
                              {copiedResponse ? '✓ 已复制' : '📋 复制'}
                            </button>
                          </div>
                          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg overflow-hidden border border-blue-200">
                            <div className="p-4 overflow-x-auto max-h-[400px] overflow-y-auto">
                              <pre className="text-sm whitespace-pre-wrap text-gray-900 leading-relaxed">
                                {currentIterationData.llm_response}
                              </pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 迭代历史 */}
                {activeSection === 'history' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900">📊 迭代历史与收敛趋势</h3>

                    {traceData.iteration_history && Object.keys(traceData.iteration_history).length > 0 ? (
                      <div className="space-y-6">
                        {Object.entries(traceData.iteration_history).map(([property, values]: [string, any]) => (
                          <div key={property} className="bg-white rounded-lg border border-gray-200 p-5">
                            <h4 className="text-md font-semibold text-gray-900 mb-4">{property}</h4>

                            {/* 迭代值表格 */}
                            <div className="overflow-x-auto mb-4">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">迭代轮次</th>
                                    {values.map((_: any, idx: number) => (
                                      <th key={idx} className="px-4 py-2 text-center text-xs font-semibold text-gray-700">
                                        第 {idx + 1} 轮
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr className="border-t border-gray-200">
                                    <td className="px-4 py-2 font-medium text-gray-700">预测值</td>
                                    {values.map((value: number, idx: number) => (
                                      <td key={idx} className="px-4 py-2 text-center font-bold text-blue-600">
                                        {value.toFixed(3)}
                                      </td>
                                    ))}
                                  </tr>
                                  <tr className="border-t border-gray-200">
                                    <td className="px-4 py-2 font-medium text-gray-700">变化量</td>
                                    {values.map((value: number, idx: number) => {
                                      if (idx === 0) {
                                        return <td key={idx} className="px-4 py-2 text-center text-gray-400">-</td>;
                                      }
                                      const change = value - values[idx - 1];
                                      const changeColor = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-600';
                                      return (
                                        <td key={idx} className={`px-4 py-2 text-center font-semibold ${changeColor}`}>
                                          {change > 0 ? '+' : ''}{change.toFixed(3)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                  <tr className="border-t border-gray-200">
                                    <td className="px-4 py-2 font-medium text-gray-700">相对变化率</td>
                                    {values.map((value: number, idx: number) => {
                                      if (idx === 0) {
                                        return <td key={idx} className="px-4 py-2 text-center text-gray-400">-</td>;
                                      }
                                      const relChange = Math.abs((value - values[idx - 1]) / values[idx - 1]) * 100;
                                      const isConverged = relChange < 1.0; // 假设1%为收敛阈值
                                      return (
                                        <td key={idx} className={`px-4 py-2 text-center font-semibold ${isConverged ? 'text-green-600' : 'text-orange-600'}`}>
                                          {relChange.toFixed(2)}%
                                          {isConverged && ' ✓'}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                </tbody>
                              </table>
                            </div>

                            {/* 简单的折线图（使用CSS实现） */}
                            <div className="bg-gray-50 rounded-lg p-4">
                              <p className="text-xs text-gray-600 mb-2">预测值趋势</p>
                              <div className="flex items-end justify-between h-32 gap-2">
                                {values.map((value: number, idx: number) => {
                                  const maxValue = Math.max(...values);
                                  const minValue = Math.min(...values);
                                  const range = maxValue - minValue || 1;
                                  const height = ((value - minValue) / range) * 100;
                                  return (
                                    <div key={idx} className="flex-1 flex flex-col items-center">
                                      <div className="w-full bg-blue-500 rounded-t" style={{ height: `${height}%` }}></div>
                                      <p className="text-xs text-gray-600 mt-1">{idx + 1}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ))}

                        {/* 说明文字 */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <p className="text-sm text-blue-800">
                            <span className="font-semibold">💡 提示：</span>
                            迭代历史展示了每个目标属性在各轮迭代中的预测值变化。相对变化率小于1%时标记为收敛（✓）。
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                        <p className="text-gray-500">❌ 没有迭代历史数据</p>
                      </div>
                    )}
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
                    </div>

                    {traceData.similar_samples && traceData.similar_samples.length > 0 ? (
                      <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
                        <table className="w-full text-sm">
                          <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase sticky left-0 bg-blue-50 z-10">#</th>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase min-w-[300px]">样本描述</th>
                              {traceData.true_values && Object.keys(traceData.true_values).map((key: string) => (
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
                                {traceData.true_values && Object.keys(traceData.true_values).map((key: string) => (
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
                        这些相似样本在所有迭代轮次中保持不变。
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

