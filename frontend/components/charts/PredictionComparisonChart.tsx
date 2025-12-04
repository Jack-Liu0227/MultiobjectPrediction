/**
 * 真实值 vs 预测值对比图组件
 * 展示每个目标列的预测准确性
 */

import React, { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface PredictionComparisonChartProps {
  predictions: any[];
  targetColumn: string;
  metrics?: {
    r2: number;
    rmse: number;
    mae: number;
    mape: number;
  };
}

interface DataPoint {
  actual: number;
  predicted: number;
  error: number;
  errorPercent: number;
  index: number;
}

// 根据误差大小返回颜色
const getErrorColor = (errorPercent: number): string => {
  if (errorPercent < 5) return '#22c55e';  // 绿色 - 小误差
  if (errorPercent < 10) return '#84cc16'; // 黄绿色
  if (errorPercent < 20) return '#eab308'; // 黄色
  if (errorPercent < 30) return '#f97316'; // 橙色
  return '#ef4444';  // 红色 - 大误差
};

export default function PredictionComparisonChart({
  predictions,
  targetColumn,
  metrics,
}: PredictionComparisonChartProps) {
  // 处理数据
  const { data, minVal, maxVal } = useMemo(() => {
    const points: DataPoint[] = [];
    let min = Infinity;
    let max = -Infinity;

    predictions.forEach((row, idx) => {
      const actual = row[targetColumn];
      const predicted = row[`${targetColumn}_predicted`];

      if (actual != null && predicted != null && !isNaN(actual) && !isNaN(predicted)) {
        const error = Math.abs(actual - predicted);
        const errorPercent = actual !== 0 ? (error / Math.abs(actual)) * 100 : 0;

        points.push({
          actual,
          predicted,
          error,
          errorPercent,
          index: idx,
        });

        min = Math.min(min, actual, predicted);
        max = Math.max(max, actual, predicted);
      }
    });

    // 添加边距
    const range = max - min;
    const padding = range * 0.1;

    return {
      data: points,
      minVal: min - padding,
      maxVal: max + padding,
    };
  }, [predictions, targetColumn]);

  // 自定义散点形状（根据误差着色）
  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    const color = getErrorColor(payload.errorPercent);

    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={color}
        fillOpacity={0.7}
        stroke={color}
        strokeWidth={1}
      />
    );
  };

  // 自定义 Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload as DataPoint;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg text-sm">
          <p className="font-semibold mb-1">样本 #{point.index + 1}</p>
          <p>真实值: <span className="font-medium">{point.actual.toFixed(2)}</span></p>
          <p>预测值: <span className="font-medium">{point.predicted.toFixed(2)}</span></p>
          <p className={point.errorPercent > 10 ? 'text-red-600' : 'text-green-600'}>
            误差: {point.error.toFixed(2)} ({point.errorPercent.toFixed(1)}%)
          </p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        没有可用的预测数据
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{targetColumn}</h3>
        {metrics && (
          <div className="flex gap-4 text-sm">
            <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
              R² = {(metrics.r2 * 100).toFixed(1)}%
            </span>
            <span className="px-2 py-1 bg-green-50 text-green-700 rounded">
              RMSE = {metrics.rmse.toFixed(2)}
            </span>
            <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
              MAE = {metrics.mae.toFixed(2)}
            </span>
            <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded">
              MAPE = {(metrics.mape * 100).toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* 图例 */}
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500"></span> &lt;5%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-500"></span> 5-20%
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500"></span> &gt;20%
        </span>
        <span className="text-gray-400 ml-2">（误差范围）</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            type="number"
            dataKey="actual"
            name="真实值"
            domain={[minVal, maxVal]}
            tick={{ fontSize: 11 }}
            label={{ value: '真实值', position: 'bottom', offset: 0, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="predicted"
            name="预测值"
            domain={[minVal, maxVal]}
            tick={{ fontSize: 11 }}
            label={{ value: '预测值', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          
          {/* 理想预测线 (y=x) */}
          <ReferenceLine
            segment={[{ x: minVal, y: minVal }, { x: maxVal, y: maxVal }]}
            stroke="#9ca3af"
            strokeDasharray="5 5"
            strokeWidth={2}
          />
          
          <Scatter
            name={targetColumn}
            data={data}
            shape={<CustomDot />}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

