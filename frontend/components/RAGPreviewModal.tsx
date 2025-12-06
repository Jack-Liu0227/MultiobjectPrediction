/**
 * RAG 预览模态框组件
 * 显示 RAG 检索结果，帮助用户调整参数
 */

import React, { useState } from 'react';

interface RAGPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId?: string;
  fileId?: string;
  compositionColumns: string[];  // 改为数组
  processingColumn: string[];  // 改为数组，支持多选
  targetColumns: string[];
  trainRatio: number;
  randomSeed?: number;  // 新增：随机种子
  maxRetrievedSamples: number;
  similarityThreshold: number;
  onParamsChange?: (params: { maxRetrievedSamples: number; similarityThreshold: number }) => void;
}

interface PreviewResponse {
  train_count: number;
  test_count: number;
  test_sample_index: number;
  test_sample: Record<string, any>;  // 完整的行数据
  retrieved_samples: Array<Record<string, any>>;  // 完整的行数据 + similarity_score
}

export default function RAGPreviewModal({
  isOpen,
  onClose,
  datasetId,
  fileId,
  compositionColumns,
  processingColumn,
  targetColumns,
  trainRatio,
  randomSeed = 42,
  maxRetrievedSamples: initialMaxSamples,
  similarityThreshold: initialThreshold,
  onParamsChange,
}: RAGPreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);

  // 可调整的参数
  const [maxSamples, setMaxSamples] = useState(initialMaxSamples);
  const [threshold, setThreshold] = useState(initialThreshold);
  const [testSampleIndex, setTestSampleIndex] = useState(0);
  const [localRandomSeed, setLocalRandomSeed] = useState(randomSeed);

  // 执行 RAG 预览
  const handlePreview = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/api/prediction/preview-rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: datasetId,
          file_id: fileId,
          composition_column: compositionColumns,  // 发送所有元素列
          processing_column: processingColumn,
          target_columns: targetColumns,
          train_ratio: trainRatio,
          random_seed: localRandomSeed,  // 使用用户设置的随机种子
          max_retrieved_samples: maxSamples,
          similarity_threshold: threshold,
          test_sample_index: testSampleIndex,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '预览失败');
      }

      const data: PreviewResponse = await response.json();
      setPreviewData(data);
    } catch (err: any) {
      setError(err.message || '预览失败');
    } finally {
      setLoading(false);
    }
  };

  // 应用参数并关闭
  const handleApply = () => {
    if (onParamsChange) {
      onParamsChange({
        maxRetrievedSamples: maxSamples,
        similarityThreshold: threshold,
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">RAG 检索预览</h2>
            <p className="text-sm text-gray-500 mt-1">
              调整参数并查看检索效果，确认后应用到预测配置
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 参数配置区 */}
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                随机种子
              </label>
              <input
                type="number"
                value={localRandomSeed}
                onChange={(e) => setLocalRandomSeed(parseInt(e.target.value) || 42)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                控制数据集划分
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                测试样本索引
              </label>
              <input
                type="number"
                value={testSampleIndex}
                onChange={(e) => setTestSampleIndex(parseInt(e.target.value) || 0)}
                min={0}
                max={previewData ? previewData.test_count - 1 : 999}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                {previewData ? `共 ${previewData.test_count} 个` : '从 0 开始'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                检索样本数 (Top-K)
              </label>
              <input
                type="number"
                value={maxSamples}
                onChange={(e) => setMaxSamples(parseInt(e.target.value))}
                min={1}
                max={50}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                相似度阈值
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                min={0}
                max={1}
                step={0.1}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handlePreview}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? '⏳ 检索中...' : '🔍 开始检索'}
            </button>
            {previewData && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>总样本: {previewData.train_count + previewData.test_count} 个</span>
                <span>|</span>
                <span>训练集: {previewData.train_count} 个</span>
                <span>|</span>
                <span>测试集: {previewData.test_count} 个</span>
                <span>|</span>
                <span>训练集比例：{(trainRatio * 100).toFixed(0)}%</span>
                <span>|</span>
                <span>检索比例：{previewData.train_count > 0 ? ((maxSamples / previewData.train_count) * 100).toFixed(2) : '0.00'}%（占训练集）</span>
                <span>|</span>
                <span>当前测试样本: 第 {previewData.test_sample_index + 1} 个</span>
              </div>
            )}
          </div>
        </div>

        {/* 结果展示区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-800">❌ {error}</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
              <span className="ml-3 text-gray-600">正在检索相似样本...</span>
            </div>
          )}

          {!loading && !previewData && !error && (
            <div className="text-center py-12 text-gray-400">
              <p>点击"开始检索"查看 RAG 检索效果</p>
            </div>
          )}

          {previewData && (
            <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
              {/* 测试样本 */}
              <div className="bg-blue-50 p-4 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">
                  测试样本 #{previewData.test_sample_index + 1}
                </h3>

                {/* 组分元素 */}
                <div className="mb-3">
                  <span className="text-gray-600 text-sm font-medium">组分元素:</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {compositionColumns.map(col => (
                      <span key={col} className="inline-flex items-center px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-mono">
                        {col}: {previewData.test_sample[col] !== undefined ? previewData.test_sample[col] : 'N/A'}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 工艺参数 */}
                <div className="mb-3">
                  <span className="text-gray-600 text-sm">工艺:</span>
                  <span className="ml-2 text-gray-900">{previewData.test_sample[processingColumn]}</span>
                </div>

                {/* 目标属性 */}
                <div className="flex gap-4 text-sm">
                  {targetColumns.map(col => (
                    <div key={col}>
                      <span className="text-gray-600">{col}:</span>
                      <span className="ml-2 font-semibold text-blue-700">
                        {typeof previewData.test_sample[col] === 'number' ? previewData.test_sample[col].toFixed(2) : previewData.test_sample[col]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 检索到的相似样本 */}
              <div className="p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  检索到的相似训练样本 (Top-{previewData.retrieved_samples.length})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-20">ID</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 sticky left-14 bg-gray-50 z-20">#</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 sticky left-24 bg-gray-50 z-20">相似度</th>
                        {/* 元素组分列 */}
                        {compositionColumns.map(col => (
                          <th key={col} className="px-3 py-2 text-left text-xs font-medium text-blue-600">{col}</th>
                        ))}
                        {/* 工艺列 */}
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">工艺</th>
                        {/* 目标属性列 */}
                        {targetColumns.map(col => (
                          <th key={col} className="px-3 py-2 text-left text-xs font-medium text-green-600">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {previewData.retrieved_samples.map((sample, sIdx) => (
                        <tr key={sIdx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-900 font-medium sticky left-0 bg-white z-10">{sample._original_row_id || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 sticky left-14 bg-white z-10">{sIdx + 1}</td>
                          <td className="px-3 py-2 sticky left-24 bg-white z-10">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              sample.similarity_score >= 0.7 ? 'bg-green-100 text-green-700' :
                              sample.similarity_score >= 0.5 ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {(sample.similarity_score * 100).toFixed(1)}%
                            </span>
                          </td>
                          {/* 元素组分列数据 */}
                          {compositionColumns.map(col => (
                            <td key={col} className="px-3 py-2 font-mono text-xs text-blue-900">
                              {typeof sample[col] === 'number' ? sample[col].toFixed(2) : (sample[col] || '-')}
                            </td>
                          ))}
                          {/* 工艺列数据 */}
                          <td className="px-3 py-2 text-xs text-gray-700">{sample[processingColumn] || '-'}</td>
                          {/* 目标属性列数据 */}
                          {targetColumns.map(col => (
                            <td key={col} className="px-3 py-2 font-semibold text-green-900">
                              {typeof sample[col] === 'number' ? sample[col].toFixed(2) : (sample[col] || 'N/A')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleApply}
            disabled={!previewData}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            ✓ 应用参数
          </button>
        </div>
      </div>
    </div>
  );
}

