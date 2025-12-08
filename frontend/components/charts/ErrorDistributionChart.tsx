/**
 * 误差分布图组件
 * 展示预测误差的直方图分布
 */

import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';

interface ErrorDistributionChartProps {
  predictions: any[];
  targetColumn: string;
  binCount?: number;
}

interface BinData {
  range: string;
  count: number;
  percentage: number;
  minError: number;
  maxError: number;
}

// 根据误差范围返回颜色
const getBinColor = (minError: number): string => {
  if (minError < 5) return '#22c55e';   // 绿色
  if (minError < 10) return '#84cc16';  // 黄绿色
  if (minError < 15) return '#eab308';  // 黄色
  if (minError < 20) return '#f97316';  // 橙色
  if (minError < 30) return '#ef4444';  // 红色
  return '#991b1b';  // 深红色
};

const ErrorDistributionChart = React.memo(function ErrorDistributionChart({
  predictions,
  targetColumn,
  binCount = 10,
}: ErrorDistributionChartProps) {
  // 计算误差分布
  const { bins, stats } = useMemo(() => {
    const errors: number[] = [];

    predictions.forEach((row) => {
      const actual = row[targetColumn];
      const predicted = row[`${targetColumn}_predicted`];

      if (actual != null && predicted != null && !isNaN(actual) && !isNaN(predicted) && actual !== 0) {
        const errorPercent = Math.abs((actual - predicted) / actual) * 100;
        errors.push(errorPercent);
      }
    });

    if (errors.length === 0) {
      return { bins: [], stats: null };
    }

    // 统计信息
    const sorted = [...errors].sort((a, b) => a - b);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const std = Math.sqrt(errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];

    // 创建直方图区间（固定区间：0-5, 5-10, 10-15, 15-20, 20-30, 30+）
    const binEdges = [0, 5, 10, 15, 20, 30, 50, 100];
    const binData: BinData[] = [];

    for (let i = 0; i < binEdges.length - 1; i++) {
      const minE = binEdges[i];
      const maxE = binEdges[i + 1];
      const count = errors.filter(e => e >= minE && e < maxE).length;
      
      binData.push({
        range: maxE < 100 ? `${minE}-${maxE}%` : `>${minE}%`,
        count,
        percentage: (count / errors.length) * 100,
        minError: minE,
        maxError: maxE,
      });
    }

    // 过滤掉空的区间
    const nonEmptyBins = binData.filter(b => b.count > 0 || b.minError < 30);

    return {
      bins: nonEmptyBins,
      stats: {
        count: errors.length,
        mean,
        median,
        std,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        q1,
        q3,
        within5: errors.filter(e => e < 5).length,
        within10: errors.filter(e => e < 10).length,
        within20: errors.filter(e => e < 20).length,
      },
    };
  }, [predictions, targetColumn]);

  // 自定义 Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const bin = payload[0].payload as BinData;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg text-sm">
          <p className="font-semibold">误差范围: {bin.range}</p>
          <p>样本数: {bin.count}</p>
          <p>占比: {bin.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  if (!stats || bins.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        没有可用的误差数据
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {targetColumn} - 误差分布
      </h3>

      {/* 统计信息卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 rounded p-2">
          <div className="text-blue-600 text-xs">平均误差</div>
          <div className="font-semibold text-blue-900">{stats.mean.toFixed(1)}%</div>
        </div>
        <div className="bg-green-50 rounded p-2">
          <div className="text-green-600 text-xs">中位数</div>
          <div className="font-semibold text-green-900">{stats.median.toFixed(1)}%</div>
        </div>
        <div className="bg-purple-50 rounded p-2">
          <div className="text-purple-600 text-xs">标准差</div>
          <div className="font-semibold text-purple-900">{stats.std.toFixed(1)}%</div>
        </div>
        <div className="bg-orange-50 rounded p-2">
          <div className="text-orange-600 text-xs">误差&lt;10%</div>
          <div className="font-semibold text-orange-900">
            {((stats.within10 / stats.count) * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={bins} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="range" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            label={{ value: '样本数', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {bins.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBinColor(entry.minError)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default ErrorDistributionChart;

