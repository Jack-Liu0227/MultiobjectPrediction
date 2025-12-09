/**
 * Pareto Front Chart Component
 * Displays Pareto front of actual and predicted values
 */

import React, { useMemo } from 'react';
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
  Line,
  ComposedChart,
} from 'recharts';

interface ParetoFrontChartProps {
  predictions: any[];
  targetColumns: string[];
  paretoIndices?: number[];
  xAxisKey?: string; // First target column
  yAxisKey?: string; // Second target column
  showParetoLine?: boolean;
}

interface DataPoint {
  actual_x: number;
  actual_y: number;
  predicted_x: number;
  predicted_y: number;
  isPareto: boolean;
  index: number;
}

const ParetoFrontChart = React.memo(function ParetoFrontChart({
  predictions,
  targetColumns,
  paretoIndices = [],
  xAxisKey,
  yAxisKey,
  showParetoLine = true,
}: ParetoFrontChartProps) {
  const xKey = xAxisKey || targetColumns[0];
  const yKey = yAxisKey || targetColumns[1];

  // Process data points
  const { actualData, predictedData, paretoLine } = useMemo(() => {
    const actualPoints: DataPoint[] = [];
    const predictedPoints: DataPoint[] = [];
    const paretoSet = new Set(paretoIndices);

    predictions.forEach((row, idx) => {
      const actual_x = row[xKey];
      const actual_y = row[yKey];
      const predicted_x = row[`${xKey}_predicted`];
      const predicted_y = row[`${yKey}_predicted`];
      const isPareto = paretoSet.has(idx);

      if (actual_x != null && actual_y != null) {
        actualPoints.push({
          actual_x,
          actual_y,
          predicted_x: predicted_x ?? actual_x,
          predicted_y: predicted_y ?? actual_y,
          isPareto,
          index: idx,
        });
      }

      if (predicted_x != null && predicted_y != null) {
        predictedPoints.push({
          actual_x: predicted_x,  // Predicted scatter uses predicted coordinates
          actual_y: predicted_y,
          predicted_x,
          predicted_y,
          isPareto,
          index: idx,
        });
      }
    });

    // Calculate Pareto front line (sorted by x)
    const paretoPoints = predictedPoints
      .filter(p => p.isPareto)
      .sort((a, b) => a.predicted_x - b.predicted_x);

    return {
      actualData: actualPoints,
      predictedData: predictedPoints,
      paretoLine: paretoPoints,
    };
  }, [predictions, xKey, yKey, paretoIndices]);

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg text-sm">
          <p className="font-semibold mb-1">Sample #{data.index + 1}</p>
          <p className="text-blue-600">
            Actual: {xKey}={data.actual_x?.toFixed(2)}, {yKey}={data.actual_y?.toFixed(2)}
          </p>
          <p className="text-red-600">
            Predicted: {xKey}={data.predicted_x?.toFixed(2)}, {yKey}={data.predicted_y?.toFixed(2)}
          </p>
          {data.isPareto && (
            <p className="text-green-600 font-medium mt-1">★ Pareto Optimal</p>
          )}
        </div>
      );
    }
    return null;
  };

  if (targetColumns.length < 2) {
    return (
      <div className="p-6 text-center text-gray-500">
        At least 2 target columns are required to display Pareto front chart
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Pareto Front Chart ({xKey} vs {yKey})
      </h3>

      <div className="mb-4 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500"></span>
          <span className="text-gray-600">Actual Values</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          <span className="text-gray-600">Predicted Values</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-0.5 bg-green-500"></span>
          <span className="text-gray-600">Pareto Front</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            type="number"
            dataKey="actual_x"
            name={xKey}
            tick={{ fontSize: 12 }}
            label={{ value: xKey, position: 'insideBottom', offset: -10 }}
          />
          <YAxis
            type="number"
            dataKey="actual_y"
            name={yKey}
            tick={{ fontSize: 12 }}
            label={{ value: yKey, angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />

          {/* Actual value scatter (blue) */}
          <Scatter
            name="Actual Values"
            data={actualData}
            fill="#3b82f6"
            shape="circle"
          />

          {/* Predicted value scatter (red) */}
          <Scatter
            name="Predicted Values"
            data={predictedData}
            fill="#ef4444"
            shape="triangle"
          />

          {/* Pareto front line (green) */}
          {showParetoLine && paretoLine.length > 0 && (
            <Scatter
              name="Pareto Front"
              data={paretoLine}
              fill="#10b981"
              shape="star"
              line={{ stroke: '#10b981', strokeWidth: 2 }}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
});

export default ParetoFrontChart;

