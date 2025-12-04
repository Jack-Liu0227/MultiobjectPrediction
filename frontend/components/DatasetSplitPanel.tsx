/**
 * 数据集划分和导出面板组件
 * 显示数据集划分预览并提供导出功能
 */

import React, { useState, useEffect } from 'react';

interface DatasetSplitPanelProps {
  fileId?: string;
  datasetId?: string;
  trainRatio: number;
  randomSeed?: number;
  onTrainRatioChange?: (ratio: number) => void;
  onRandomSeedChange?: (seed: number) => void;
  onTrainCountChange?: (count: number) => void; // 新增：训练集数量变化回调
}

interface SplitPreview {
  total_samples: number;
  train_samples: number;
  test_samples: number;
  train_ratio: number;
  train_preview: any[];
  test_preview: any[];
}

export default function DatasetSplitPanel({
  fileId,
  datasetId,
  trainRatio,
  randomSeed = 42,
  onTrainRatioChange,
  onRandomSeedChange,
  onTrainCountChange,
}: DatasetSplitPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [localRatio, setLocalRatio] = useState(trainRatio);
  const [localSeed, setLocalSeed] = useState(randomSeed);

  // 加载预览数据
  const loadPreview = async () => {
    if (!fileId && !datasetId) {
      setError('请先上传或选择数据集');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/api/dataset-split/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          dataset_id: datasetId,
          train_ratio: localRatio,
          random_seed: localSeed,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '加载预览失败');
      }

      const data = await response.json();
      setPreview(data);

      // 通知父组件训练集数量
      if (onTrainCountChange && data.train_samples) {
        onTrainCountChange(data.train_samples);
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 导出训练集
  const handleExportTrain = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/dataset-split/export/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          dataset_id: datasetId,
          train_ratio: localRatio,
          random_seed: localSeed,
        }),
      });

      if (!response.ok) {
        throw new Error('导出失败');
      }

      // 下载文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `train_set.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('导出训练集失败: ' + err.message);
    }
  };

  // 导出测试集
  const handleExportTest = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/dataset-split/export/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: fileId,
          dataset_id: datasetId,
          train_ratio: localRatio,
          random_seed: localSeed,
        }),
      });

      if (!response.ok) {
        throw new Error('导出失败');
      }

      // 下载文件
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `test_set.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('导出测试集失败: ' + err.message);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        📊 数据集划分预览与导出
      </h3>

      {/* 训练集比例设置 */}
      <div className="mb-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            训练集比例: {(localRatio * 100).toFixed(0)}%
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0.5"
              max="0.9"
              step="0.05"
              value={localRatio}
              onChange={(e) => {
                const newRatio = parseFloat(e.target.value);
                setLocalRatio(newRatio);
                if (onTrainRatioChange) {
                  onTrainRatioChange(newRatio);
                }
              }}
              className="flex-1"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">随机种子</label>
          <div className="flex items-center gap-4">
            <input
              type="number"
              min={1}
              max={9999}
              value={localSeed || ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setLocalSeed(0);
                  if (onRandomSeedChange) {
                    onRandomSeedChange(0);
                  }
                } else {
                  const numValue = parseInt(value);
                  if (!isNaN(numValue) && numValue >= 1) {
                    setLocalSeed(numValue);
                    if (onRandomSeedChange) {
                      onRandomSeedChange(numValue);
                    }
                  }
                }
              }}
              className="w-32 border border-gray-300 rounded-lg px-3 py-2"
            />
            <button
              onClick={loadPreview}
              disabled={loading || (!fileId && !datasetId)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {loading ? '⏳ 加载中...' : '🔍 预览划分'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">范围: 1-9999，用于保证数据划分的可复现性</p>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">❌ {error}</p>
        </div>
      )}

      {/* 预览结果 */}
      {preview && (
        <div className="space-y-6">
          {/* 统计信息 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-600 mb-1">总样本数</div>
              <div className="text-2xl font-bold text-gray-900">{preview.total_samples}</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-sm text-blue-600 mb-1">训练集</div>
              <div className="text-2xl font-bold text-blue-900">{preview.train_samples}</div>
              <div className="text-xs text-blue-600 mt-1">
                {((preview.train_samples / preview.total_samples) * 100).toFixed(1)}%
              </div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-sm text-green-600 mb-1">测试集</div>
              <div className="text-2xl font-bold text-green-900">{preview.test_samples}</div>
              <div className="text-xs text-green-600 mt-1">
                {((preview.test_samples / preview.total_samples) * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* 训练集预览 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">训练集预览（前 5 行）</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-blue-50">
                  <tr>
                    {preview.train_preview.length > 0 &&
                      Object.keys(preview.train_preview[0]).map((key) => (
                        <th key={key} className={`px-3 py-2 text-left text-xs font-medium text-blue-700 ${key === '_original_row_id' ? 'sticky left-0 bg-blue-50 z-10' : ''}`}>
                          {key === '_original_row_id' ? 'ID' : key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {preview.train_preview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {Object.entries(row).map(([key, val]: [string, any], i) => (
                        <td key={i} className={`px-3 py-2 text-gray-900 ${key === '_original_row_id' ? 'sticky left-0 bg-white z-10 font-medium' : ''}`}>
                          {key === '_original_row_id' ? val : (typeof val === 'number' ? val.toFixed(3) : val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 测试集预览 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">测试集预览（前 5 行）</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-green-50">
                  <tr>
                    {preview.test_preview.length > 0 &&
                      Object.keys(preview.test_preview[0]).map((key) => (
                        <th key={key} className={`px-3 py-2 text-left text-xs font-medium text-green-700 ${key === '_original_row_id' ? 'sticky left-0 bg-green-50 z-10' : ''}`}>
                          {key === '_original_row_id' ? 'ID' : key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {preview.test_preview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {Object.entries(row).map(([key, val]: [string, any], i) => (
                        <td key={i} className={`px-3 py-2 text-gray-900 ${key === '_original_row_id' ? 'sticky left-0 bg-white z-10 font-medium' : ''}`}>
                          {key === '_original_row_id' ? val : (typeof val === 'number' ? val.toFixed(3) : val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 导出按钮 */}
          <div className="flex gap-4">
            <button
              onClick={handleExportTrain}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              📥 导出训练集 ({preview.train_samples} 样本)
            </button>
            <button
              onClick={handleExportTest}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              📥 导出测试集 ({preview.test_samples} 样本)
            </button>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800">
              💡 <strong>提示：</strong>导出的数据集使用随机种子 {localSeed}，确保每次划分结果一致。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


