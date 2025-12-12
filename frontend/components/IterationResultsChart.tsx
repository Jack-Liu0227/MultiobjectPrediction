/**
 * 迭代结果可视化组件
 * 显示每个样本在各轮迭代中的预测值变化曲线
 */

import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { IterationHistory } from '../lib/types';

interface IterationResultsChartProps {
  iterationHistory: IterationHistory;
  targetProperties: string[];
}

export default function IterationResultsChart({ iterationHistory, targetProperties }: IterationResultsChartProps) {
  const [selectedSample, setSelectedSample] = useState<string>('');
  const [selectedProperty, setSelectedProperty] = useState<string>(targetProperties[0] || '');

  const sampleIndices = Object.keys(iterationHistory).sort((a, b) => parseInt(a) - parseInt(b));

  // 如果没有选择样本，默认选择第一个
  React.useEffect(() => {
    if (!selectedSample && sampleIndices.length > 0) {
      setSelectedSample(sampleIndices[0]);
    }
  }, [sampleIndices, selectedSample]);

  if (sampleIndices.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-gray-500 text-center">暂无迭代历史数据</p>
      </div>
    );
  }

  // 准备图表数据
  const chartData = selectedSample && iterationHistory[selectedSample]
    ? Object.keys(iterationHistory[selectedSample][selectedProperty] || {}).map((iterIdx) => {
        const dataPoint: any = {
          iteration: parseInt(iterIdx) + 1,
        };
        
        // 添加所有目标属性的值
        targetProperties.forEach((prop) => {
          const values = iterationHistory[selectedSample][prop];
          if (values && values[parseInt(iterIdx)] !== undefined) {
            dataPoint[prop] = values[parseInt(iterIdx)];
          }
        });
        
        return dataPoint;
      })
    : [];

  // 颜色映射
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h3 className="text-lg font-semibold text-gray-900">📈 迭代收敛曲线</h3>

      {/* 样本选择器 */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">选择样本:</label>
        <select
          value={selectedSample}
          onChange={(e) => setSelectedSample(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          {sampleIndices.map((idx) => (
            <option key={idx} value={idx}>
              样本 #{idx}
            </option>
          ))}
        </select>

        {targetProperties.length > 1 && (
          <>
            <label className="text-sm font-medium text-gray-700 ml-4">目标属性:</label>
            <select
              value={selectedProperty}
              onChange={(e) => setSelectedProperty(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {targetProperties.map((prop) => (
                <option key={prop} value={prop}>
                  {prop}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* 图表 */}
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="iteration"
              label={{ value: '迭代轮次', position: 'insideBottom', offset: -5 }}
            />
            <YAxis label={{ value: '预测值', angle: -90, position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            {targetProperties.map((prop, idx) => (
              <Line
                key={prop}
                type="monotone"
                dataKey={prop}
                stroke={colors[idx % colors.length]}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-64 flex items-center justify-center text-gray-500">
          该样本暂无迭代数据
        </div>
      )}

      {/* 收敛信息 */}
      {chartData.length > 1 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 className="text-sm font-medium text-blue-900 mb-2">收敛分析</h4>
          <div className="text-xs text-blue-800 space-y-1">
            {targetProperties.map((prop) => {
              const values = iterationHistory[selectedSample]?.[prop] || [];
              if (values.length < 2) return null;
              
              const lastValue = values[values.length - 1];
              const prevValue = values[values.length - 2];
              const changeRate = Math.abs((lastValue - prevValue) / prevValue) * 100;
              
              return (
                <p key={prop}>
                  • {prop}: 最后一轮变化率 {changeRate.toFixed(2)}%
                  {changeRate < 1 ? ' ✅ 已收敛' : ' ⏳ 未收敛'}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

