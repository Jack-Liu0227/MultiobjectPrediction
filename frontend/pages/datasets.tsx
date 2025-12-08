/**
 * 数据集管理页面
 * 使用 SWR 实现请求缓存和优化
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useDatasetList } from '../lib/hooks/useSWRApi';

interface Dataset {
  dataset_id: string;
  filename: string;
  original_filename: string;
  row_count: number;
  column_count: number;
  columns: string[];
  file_size: number;
  uploaded_at: string;
  last_used_at?: string;
  description?: string;
  tags: string[];
  usage_count: number;
}

export default function DatasetsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploading, setUploading] = useState(false);

  // 使用 SWR 获取数据集列表（自动缓存和去重）
  const { data, error, isLoading, mutate } = useDatasetList({
    page,
    page_size: 20,
    sort_by: 'uploaded_at',
    sort_order: 'desc',
  });

  // 从 SWR 响应中提取数据
  const datasets = data?.datasets || [];
  const total = data?.total || 0;
  const loading = isLoading;

  // 刷新数据集列表（使用 SWR mutate）
  const loadDatasets = async () => {
    await mutate();
  };

  // 删除数据集
  const handleDelete = async (datasetId: string) => {
    if (!confirm('确定要删除这个数据集吗？')) return;

    try {
      const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        alert('数据集已删除');
        loadDatasets();
      } else {
        alert('删除失败');
      }
    } catch (error) {
      console.error('Failed to delete dataset:', error);
      alert('删除失败');
    }
  };

  // 使用数据集（跳转到预测页面）
  const handleUse = (dataset: Dataset) => {
    router.push(`/prediction?dataset_id=${dataset.dataset_id}`);
  };

  // 上传数据集
  const handleUpload = async () => {
    if (!uploadFile) {
      alert('请选择文件');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      if (uploadDescription) {
        formData.append('description', uploadDescription);
      }
      if (uploadTags) {
        formData.append('tags', uploadTags);
      }

      const response = await fetch('http://localhost:8000/api/datasets/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '上传失败');
      }

      // 重置表单
      setUploadFile(null);
      setUploadDescription('');
      setUploadTags('');
      setShowUploadModal(false);

      // 刷新列表
      loadDatasets();
      alert('上传成功！');
    } catch (error) {
      console.error('上传失败:', error);
      alert(`上传失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setUploading(false);
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // 格式化日期
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/prediction')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="返回预测页面"
              >
                <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">数据集管理</h1>
            </div>
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              上传新数据集
            </button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        ) : datasets.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无数据集</h3>
            <p className="mt-1 text-sm text-gray-500">上传您的第一个数据集开始使用</p>
            <div className="mt-6">
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                上传数据集
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {datasets.map((dataset) => (
              <div key={dataset.dataset_id} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">{dataset.original_filename}</h3>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                        {dataset.usage_count} 次使用
                      </span>
                    </div>

                    {dataset.description && (
                      <p className="mt-2 text-sm text-gray-600">{dataset.description}</p>
                    )}

                    <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">行数:</span>
                        <span className="ml-2 font-medium text-gray-900">{dataset.row_count.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">列数:</span>
                        <span className="ml-2 font-medium text-gray-900">{dataset.column_count}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">文件大小:</span>
                        <span className="ml-2 font-medium text-gray-900">{formatFileSize(dataset.file_size)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">上传时间:</span>
                        <span className="ml-2 font-medium text-gray-900">{formatDate(dataset.uploaded_at)}</span>
                      </div>
                    </div>

                    {dataset.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {dataset.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setSelectedDataset(selectedDataset?.dataset_id === dataset.dataset_id ? null : dataset)}
                      className="mt-3 text-sm text-blue-600 hover:text-blue-800"
                    >
                      {selectedDataset?.dataset_id === dataset.dataset_id ? '隐藏列信息' : '查看列信息'}
                    </button>

                    {selectedDataset?.dataset_id === dataset.dataset_id && (
                      <div className="mt-3 p-3 bg-gray-50 rounded border">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">列名列表:</h4>
                        <div className="flex flex-wrap gap-2">
                          {dataset.columns.map((col, idx) => (
                            <span key={idx} className="px-2 py-1 bg-white border text-xs text-gray-700 rounded">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="ml-4 flex flex-col gap-2">
                    <button
                      onClick={() => handleUse(dataset)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      使用此数据集
                    </button>
                    <button
                      onClick={() => handleDelete(dataset.dataset_id)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* 分页 */}
            {total > 20 && (
              <div className="flex justify-center gap-2 mt-6">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  上一页
                </button>
                <span className="px-4 py-2">
                  第 {page} 页 / 共 {Math.ceil(total / 20)} 页
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= Math.ceil(total / 20)}
                  className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 上传模态框 */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">上传数据集</h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* 文件选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择 CSV 文件 *
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
                {uploadFile && (
                  <p className="mt-1 text-sm text-gray-500">
                    已选择: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(2)} KB)
                  </p>
                )}
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  描述（可选）
                </label>
                <textarea
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="输入数据集描述..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              {/* 标签 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  标签（可选，逗号分隔）
                </label>
                <input
                  type="text"
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="例如: 铝合金, 实验数据"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              {/* 按钮 */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploading}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleUpload}
                  disabled={!uploadFile || uploading}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? '上传中...' : '上传'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

