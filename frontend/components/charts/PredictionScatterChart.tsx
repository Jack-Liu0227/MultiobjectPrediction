/**
 * 预测值 vs 真实值散点图组件
 * 显示预测值与真实值的对比，包含 y=x 参考线
 */

import React from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';

interface PredictionScatterChartProps {
  predictions: Array<{
    [key: string]: any;
  }>;
  targetColumn: string;
  onPointClick?: (dataPoint: any, index: number) => void;
}

const PredictionScatterChart = React.memo(function PredictionScatterChart({
  predictions,
  targetColumn,
  onPointClick,
}: PredictionScatterChartProps) {
  // 准备散点图数据
  const scatterData = predictions.map((pred, index) => {
    const trueValue = pred[targetColumn];
    const predictedValue = pred[`${targetColumn}_predicted`];

    return {
      index: pred.sample_index !== undefined ? pred.sample_index : index,
      true: trueValue,
      predicted: predictedValue,
      error: Math.abs(predictedValue - trueValue),
      relativeError: Math.abs((predictedValue - trueValue) / trueValue) * 100,
      ...pred, // 保留完整数据用于点击事件
    };
  }).filter(d => d.true !== null && d.predicted !== null);

  // 计算数据范围（用于绘制 y=x 参考线）
  const allValues = scatterData.flatMap(d => [d.true, d.predicted]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1;

  // 自定义 Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-2">样本 #{data.index + 1}</p>
          <p className="text-blue-600">真实值: {data.true.toFixed(3)}</p>
          <p className="text-green-600">预测值: {data.predicted.toFixed(3)}</p>
          <p className="text-red-600">误差: {data.error.toFixed(3)}</p>
          <p className="text-orange-600">相对误差: {data.relativeError.toFixed(2)}%</p>
        </div>
      );
    }
    return null;
  };

  // 点击事件处理
  const handleClick = (data: any) => {
    if (onPointClick && data) {
      onPointClick(data, data.index);
    }
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={500}>
        <ScatterChart
          margin={{ top: 20, right: 30, bottom: 60, left: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          
          <XAxis
            type="number"
            dataKey="true"
            name="真实值"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `真实值 (${targetColumn})`,
              position: 'bottom',
              offset: 40,
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />
          
          <YAxis
            type="number"
            dataKey="predicted"
            name="预测值"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `预测值 (${targetColumn})`,
              angle: -90,
              position: 'left',
              offset: 40,
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Legend
            verticalAlign="top"
            height={36}
            wrapperStyle={{ fontSize: 14 }}
          />
          
          {/* y=x 参考线（理想预测线） */}
          <ReferenceLine
            segment={[
              { x: minValue - padding, y: minValue - padding },
              { x: maxValue + padding, y: maxValue + padding },
            ]}
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="5 5"
            label={{
              value: 'y = x (理想预测)',
              position: 'insideTopRight',
              fill: '#6b7280',
              fontSize: 12,
            }}
          />
          
          {/* 散点 */}
          <Scatter
            name="预测样本"
            data={scatterData}
            fill="#3b82f6"
            onClick={handleClick}
            cursor={onPointClick ? 'pointer' : 'default'}
          >
            {scatterData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.relativeError < 5 ? '#10b981' : entry.relativeError < 10 ? '#f59e0b' : '#ef4444'}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      
      {/* 图例说明 */}
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-gray-600">相对误差 &lt; 5%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
          <span className="text-gray-600">5% ≤ 相对误差 &lt; 10%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-gray-600">相对误差 ≥ 10%</span>
        </div>
      </div>
    </div>
  );
});

export default PredictionScatterChart;

