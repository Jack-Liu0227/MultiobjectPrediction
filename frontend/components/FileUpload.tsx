/**
 * 文件上传组件
 */

import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { uploadFile } from '@/lib/api';
import { UploadResponse } from '@/lib/types';

interface FileUploadProps {
  onUploadComplete: (fileData: UploadResponse) => void;
}

export default function FileUpload({ onUploadComplete }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];

    // 验证文件类型
    if (!file.name.endsWith('.csv')) {
      setError('只支持CSV文件');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await uploadFile(file);
      setPreview(result.preview);
      onUploadComplete(result);
    } catch (err: any) {
      // 确保错误消息是字符串
      const errorMessage = err instanceof Error
        ? err.message
        : (err.response?.data?.detail || '上传失败');
      setError(String(errorMessage));
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    disabled: uploading,
  });

  return (
    <div className="space-y-6">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <div className="text-4xl">📁</div>
          {isDragActive ? (
            <p className="text-blue-600 font-semibold">释放文件以上传</p>
          ) : (
            <>
              <p className="text-gray-700 font-semibold">
                拖拽CSV文件到此处或点击选择
              </p>
              <p className="text-gray-500 text-sm">
                支持最大 50MB 的CSV文件
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {uploading && (
        <div className="flex items-center justify-center space-x-2">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span className="text-gray-600">上传中...</span>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-700 font-semibold">✓ 文件上传成功</p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-gray-900">数据预览</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-300">
                <thead className="bg-gray-100">
                  <tr>
                    {Object.keys(preview[0] || {}).map((col) => (
                      <th key={col} className="border border-gray-300 px-4 py-2 text-left">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {Object.values(row).map((val, valIdx) => (
                        <td key={valIdx} className="border border-gray-300 px-4 py-2">
                          {val === null || val === undefined
                            ? '-'
                            : typeof val === 'object'
                            ? JSON.stringify(val)
                            : String(val)}
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
  );
}

