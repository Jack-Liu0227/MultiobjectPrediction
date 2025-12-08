/**
 * Consistency Distribution Chart Component
 * Displays bar chart showing distribution of consistency levels
 */

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

interface ConsistencyDistributionChartProps {
  consistencyDistribution: {
    [key: string]: {
      count: number;
      percentage: number;
      level: number;
    };
  };
  nTasks: number;
}

const ConsistencyDistributionChart = React.memo(function ConsistencyDistributionChart({
  consistencyDistribution,
  nTasks,
}: ConsistencyDistributionChartProps) {
  // Prepare chart data
  const chartData = Object.entries(consistencyDistribution)
    .map(([label, data]) => ({
      label: label.replace(/全部|个任务一致|个任务都不同|恰好/g, '').trim(),
      englishLabel: getEnglishLabel(label, nTasks),
      count: data.count,
      percentage: data.percentage,
      level: data.level,
    }))
    .sort((a, b) => b.level - a.level); // Sort by consistency level descending

  // Get English label
  function getEnglishLabel(chineseLabel: string, n: number): string {
    if (chineseLabel.includes('全部') && chineseLabel.includes('一致')) {
      return `All ${n} tasks agree`;
    }
    if (chineseLabel.includes('都不同')) {
      return 'All different';
    }
    // Extract number from label like "恰好3个任务一致"
    const match = chineseLabel.match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1]);
      return `Exactly ${num} tasks agree`;
    }
    return chineseLabel;
  }

  // Color mapping based on consistency level
  const getColor = (level: number) => {
    if (level === nTasks) return '#3b82f6'; // Blue - all tasks agree
    if (level === nTasks - 1) return '#ef4444'; // Red - N-1 tasks agree
    if (level === 2) return '#f59e0b'; // Orange - 2 tasks agree
    return '#10b981'; // Green - low consistency
  };

  // Custom label
  const renderCustomLabel = (props: any) => {
    const { x, y, width, value, percentage } = props;
    return (
      <text
        x={x + width / 2}
        y={y - 5}
        fill="#374151"
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
      >
        {value} ({percentage.toFixed(1)}%)
      </text>
    );
  };

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-1">{data.englishLabel}</p>
          <p className="text-blue-600">Samples: {data.count}</p>
          <p className="text-green-600">Percentage: {data.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={400}>
        <BarChart
          data={chartData}
          margin={{ top: 40, right: 30, bottom: 80, left: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          
          <XAxis
            dataKey="englishLabel"
            angle={-15}
            textAnchor="end"
            height={80}
            tick={{ fontSize: 11 }}
            interval={0}
          />
          
          <YAxis
            label={{
              value: 'Number of Samples',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          <Bar dataKey="count" radius={[8, 8, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getColor(entry.level)} />
            ))}
            <LabelList
              dataKey="count"
              content={(props) => renderCustomLabel({ ...props, percentage: chartData[props.index || 0]?.percentage })}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      
      {/* Summary statistics */}
      <div className="mt-4 text-center text-sm text-gray-600">
        <p>Total samples: {chartData.reduce((sum, d) => sum + d.count, 0)}</p>
      </div>
    </div>
  );
});

export default ConsistencyDistributionChart;

