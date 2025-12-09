/**
 * Actual vs Predicted Comparison Chart Component
 * Displays prediction accuracy for each target column
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

// Return color based on error magnitude
const getErrorColor = (errorPercent: number): string => {
  if (errorPercent < 5) return '#22c55e';  // Green - small error
  if (errorPercent < 10) return '#84cc16'; // Yellow-green
  if (errorPercent < 20) return '#eab308'; // Yellow
  if (errorPercent < 30) return '#f97316'; // Orange
  return '#ef4444';  // Red - large error
};

const PredictionComparisonChart = React.memo(function PredictionComparisonChart({
  predictions,
  targetColumn,
  metrics,
}: PredictionComparisonChartProps) {
  // Process data
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

    // Add padding
    const range = max - min;
    const padding = range * 0.1;

    return {
      data: points,
      minVal: min - padding,
      maxVal: max + padding,
    };
  }, [predictions, targetColumn]);

  // Dynamically calculate evaluation metrics (based on filtered data)
  const calculatedMetrics = useMemo(() => {
    if (data.length === 0) {
      return { r2: 0, rmse: 0, mae: 0, mape: 0 };
    }

    const actualValues = data.map(d => d.actual);
    const predictedValues = data.map(d => d.predicted);

    // Calculate MAE
    const mae = data.reduce((sum, d) => sum + d.error, 0) / data.length;

    // Calculate RMSE
    const mse = data.reduce((sum, d) => sum + Math.pow(d.actual - d.predicted, 2), 0) / data.length;
    const rmse = Math.sqrt(mse);

    // Calculate R²
    const actualMean = actualValues.reduce((sum, v) => sum + v, 0) / actualValues.length;
    const ssTotal = actualValues.reduce((sum, v) => sum + Math.pow(v - actualMean, 2), 0);
    const ssResidual = data.reduce((sum, d) => sum + Math.pow(d.actual - d.predicted, 2), 0);
    const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    // Calculate MAPE
    const mape = data.reduce((sum, d) => sum + d.errorPercent, 0) / data.length;

    return { r2, rmse, mae, mape };
  }, [data]);

  // Use dynamically calculated metrics if no external metrics provided
  const displayMetrics = metrics || calculatedMetrics;

  // Custom dot shape (colored by error)
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

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload as DataPoint;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg text-sm">
          <p className="font-semibold mb-1">Sample #{point.index + 1}</p>
          <p>Actual: <span className="font-medium">{point.actual.toFixed(2)}</span></p>
          <p>Predicted: <span className="font-medium">{point.predicted.toFixed(2)}</span></p>
          <p className={point.errorPercent > 10 ? 'text-red-600' : 'text-green-600'}>
            Error: {point.error.toFixed(2)} ({point.errorPercent.toFixed(1)}%)
          </p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        No prediction data available
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{targetColumn}</h3>
        <div className="flex gap-4 text-sm">
          <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded">
            R² = {(displayMetrics.r2 * 100).toFixed(1)}%
          </span>
          <span className="px-2 py-1 bg-green-50 text-green-700 rounded">
            RMSE = {displayMetrics.rmse.toFixed(2)}
          </span>
          <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
            MAE = {displayMetrics.mae.toFixed(2)}
          </span>
          <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded">
            MAPE = {displayMetrics.mape.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Legend */}
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
        <span className="text-gray-400 ml-2">(Error Range)</span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            type="number"
            dataKey="actual"
            name="Actual Value"
            domain={[minVal, maxVal]}
            tick={{ fontSize: 11 }}
            label={{ value: 'Actual Value', position: 'bottom', offset: 0, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="predicted"
            name="Predicted Value"
            domain={[minVal, maxVal]}
            tick={{ fontSize: 11 }}
            label={{ value: 'Predicted Value', angle: -90, position: 'insideLeft', fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Ideal prediction line (y=x) */}
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
});

export default PredictionComparisonChart;

