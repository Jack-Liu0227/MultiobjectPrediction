/**
 * 迭代预测进度显示组件
 * 显示当前迭代轮次、收敛样本数、失败样本数等信息
 */

import React from 'react';
import { TaskStatus } from '../lib/types';

interface IterationProgressProps {
  taskStatus: TaskStatus;
}

export default function IterationProgress({ taskStatus }: IterationProgressProps) {
  if (!taskStatus.enable_iteration) {
    return null;
  }

  const currentIteration = taskStatus.current_iteration || 0;
  const maxIterations = taskStatus.max_iterations || 1;
  const progress = taskStatus.progress || 0;
  const failedSamples = taskStatus.failed_samples || [];

  // 计算收敛样本数（从迭代历史中统计）
  const iterationHistory = taskStatus.iteration_history || {};
  const totalSamples = Object.keys(iterationHistory).length;
  const convergedSamples = totalSamples - failedSamples.length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">🔄 迭代预测进度</h3>
        <span className="text-sm text-gray-500">
          第 {currentIteration} / {maxIterations} 轮
        </span>
      </div>

      {/* 进度条 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>整体进度</span>
          <span>{(progress * 100).toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* 迭代轮次进度 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>迭代轮次</span>
          <span>{currentIteration} / {maxIterations}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-green-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(currentIteration / maxIterations) * 100}%` }}
          />
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{totalSamples}</div>
          <div className="text-xs text-gray-500 mt-1">总样本数</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-600">{convergedSamples}</div>
          <div className="text-xs text-gray-500 mt-1">已收敛</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-600">{failedSamples.length}</div>
          <div className="text-xs text-gray-500 mt-1">失败</div>
        </div>
      </div>

      {/* 收敛率 */}
      {totalSamples > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-green-900">收敛率</span>
            <span className="text-lg font-bold text-green-700">
              {((convergedSamples / totalSamples) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-green-200 rounded-full h-2 mt-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(convergedSamples / totalSamples) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 状态消息 */}
      {taskStatus.message && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">{taskStatus.message}</p>
        </div>
      )}

      {/* 失败样本列表 */}
      {failedSamples.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-red-900 mb-2">
            ⚠️ 失败样本 ({failedSamples.length} 个)
          </h4>
          <div className="flex flex-wrap gap-1">
            {failedSamples.slice(0, 20).map((sampleIdx) => (
              <span
                key={sampleIdx}
                className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded"
              >
                #{sampleIdx}
              </span>
            ))}
            {failedSamples.length > 20 && (
              <span className="text-xs text-red-600">
                ... 还有 {failedSamples.length - 20} 个
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

