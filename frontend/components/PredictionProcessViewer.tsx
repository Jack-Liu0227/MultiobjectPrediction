/**
 * 预测过程查看器组件
 * 显示 RAG+LLM 预测的详细过程
 */

import { useState } from 'react';

interface ProcessDetails {
  data_processing?: {
    total_rows: number;
    train_rows: number;
    test_rows: number;
    sampled_test_rows: number;
    composition_column: string;
    processing_column: string;
    target_columns: string[];
    train_preview?: any[];
    test_preview?: any[];
  };
  rag_retrieval?: {
    test_sample_index: number;
    test_sample: any;
    retrieved_samples: Array<{
      index: number;
      similarity: number;
      composition: string;
      processing: string;
      targets: Record<string, number>;
    }>;
  }[];
  llm_prediction?: {
    test_sample_index: number;
    prompt: string;
    llm_response: string;
    parsed_predictions: Record<string, number>;
    error?: string;
  }[];
}

interface Props {
  processDetails: ProcessDetails | null;
}

export default function PredictionProcessViewer({ processDetails }: Props) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    data: true,
    rag: false,
    llm: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  if (!processDetails) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-500">暂无过程详情</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 数据处理阶段 */}
      {processDetails.data_processing && (
        <div className="bg-white rounded-lg shadow-sm border">
          <button
            onClick={() => toggleSection('data')}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h3 className="text-lg font-semibold text-gray-900">1. 数据处理阶段</h3>
            <svg
              className={`w-5 h-5 transition-transform ${expandedSections.data ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSections.data && (
            <div className="px-6 pb-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">训练集样本数</p>
                  <p className="text-2xl font-bold text-blue-600">{processDetails.data_processing.train_rows}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">测试集样本数（抽样后）</p>
                  <p className="text-2xl font-bold text-green-600">{processDetails.data_processing.sampled_test_rows}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">选中的列：</p>
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">组分列:</span> {processDetails.data_processing.composition_column}</p>
                  <p><span className="font-medium">工艺列:</span> {processDetails.data_processing.processing_column}</p>
                  <p><span className="font-medium">目标列:</span> {processDetails.data_processing.target_columns.join(', ')}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RAG 检索阶段 */}
      {processDetails.rag_retrieval && processDetails.rag_retrieval.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border">
          <button
            onClick={() => toggleSection('rag')}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50"
          >
            <h3 className="text-lg font-semibold text-gray-900">
              2. RAG 检索阶段 ({processDetails.rag_retrieval.length} 个样本)
            </h3>
            <svg
              className={`w-5 h-5 transition-transform ${expandedSections.rag ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expandedSections.rag && (
            <div className="px-6 pb-4 space-y-6">
              {processDetails.rag_retrieval.slice(0, 3).map((retrieval, idx) => (
                <div key={idx} className="border-t pt-4">
                  <h4 className="font-medium text-gray-900 mb-3">
                    测试样本 #{retrieval.test_sample_index + 1}
                  </h4>
                  
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left">排名</th>
                          <th className="px-3 py-2 text-left">相似度</th>
                          <th className="px-3 py-2 text-left">组分</th>
                          <th className="px-3 py-2 text-left">工艺描述</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {retrieval.retrieved_samples.slice(0, 5).map((sample, sIdx) => (
                          <tr key={sIdx} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{sIdx + 1}</td>
                            <td className="px-3 py-2">
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                                {(sample.similarity * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">{sample.composition}</td>
                            <td className="px-3 py-2 text-xs max-w-xs truncate">{sample.processing}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

