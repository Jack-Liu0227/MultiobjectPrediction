/**
 * Error Distribution Chart Component
 * Displays histogram distribution of prediction errors
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

// Return color based on error range
const getBinColor = (minError: number): string => {
  if (minError < 5) return '#22c55e';   // Green
  if (minError < 10) return '#84cc16';  // Yellow-green
  if (minError < 15) return '#eab308';  // Yellow
  if (minError < 20) return '#f97316';  // Orange
  if (minError < 30) return '#ef4444';  // Red
  return '#991b1b';  // Dark red
};

const ErrorDistributionChart = React.memo(function ErrorDistributionChart({
  predictions,
  targetColumn,
  binCount = 10,
}: ErrorDistributionChartProps) {
  // Calculate error distribution
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

    // Statistical information
    const sorted = [...errors].sort((a, b) => a - b);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const std = Math.sqrt(errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];

    // Create histogram bins (fixed intervals: 0-5, 5-10, 10-15, 15-20, 20-30, 30+)
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

    // Filter out empty bins
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

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const bin = payload[0].payload as BinData;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg text-sm">
          <p className="font-semibold">Error Range: {bin.range}</p>
          <p>Sample Count: {bin.count}</p>
          <p>Percentage: {bin.percentage.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  if (!stats || bins.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        No error data available
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {targetColumn} - Error Distribution
      </h3>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className="bg-blue-50 rounded p-2">
          <div className="text-blue-600 text-xs">Mean Error</div>
          <div className="font-semibold text-blue-900">{stats.mean.toFixed(1)}%</div>
        </div>
        <div className="bg-green-50 rounded p-2">
          <div className="text-green-600 text-xs">Median</div>
          <div className="font-semibold text-green-900">{stats.median.toFixed(1)}%</div>
        </div>
        <div className="bg-purple-50 rounded p-2">
          <div className="text-purple-600 text-xs">Std Dev</div>
          <div className="font-semibold text-purple-900">{stats.std.toFixed(1)}%</div>
        </div>
        <div className="bg-orange-50 rounded p-2">
          <div className="text-orange-600 text-xs">Error &lt;10%</div>
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
            label={{ value: 'Sample Count', angle: -90, position: 'insideLeft', fontSize: 12 }}
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

