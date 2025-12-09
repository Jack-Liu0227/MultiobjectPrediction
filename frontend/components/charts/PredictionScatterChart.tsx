/**
 * Predicted vs Actual Scatter Chart Component
 * Displays comparison between predicted and actual values with y=x reference line and evaluation metrics
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
  // Prepare scatter plot data
  const scatterData = useMemo(() => {
    return predictions.map((pred, index) => {
      const trueValue = pred[targetColumn];
      const predictedValue = pred[`${targetColumn}_predicted`];

      return {
        index: pred.sample_index !== undefined ? pred.sample_index : index,
        true: trueValue,
        predicted: predictedValue,
        error: Math.abs(predictedValue - trueValue),
        relativeError: Math.abs((predictedValue - trueValue) / trueValue) * 100,
        ...pred, // Keep complete data for click events
      };
    }).filter(d => d.true !== null && d.predicted !== null);
  }, [predictions, targetColumn]);

  // Calculate evaluation metrics
  const metrics = useMemo(() => {
    if (scatterData.length === 0) {
      return { mae: 0, rmse: 0, r2: 0, count: 0 };
    }

    const trueValues = scatterData.map(d => d.true);
    const predictedValues = scatterData.map(d => d.predicted);

    // Calculate MAE
    const mae = scatterData.reduce((sum, d) => sum + Math.abs(d.predicted - d.true), 0) / scatterData.length;

    // Calculate RMSE
    const mse = scatterData.reduce((sum, d) => sum + Math.pow(d.predicted - d.true, 2), 0) / scatterData.length;
    const rmse = Math.sqrt(mse);

    // Calculate R²
    const trueMean = trueValues.reduce((sum, v) => sum + v, 0) / trueValues.length;
    const ssTotal = trueValues.reduce((sum, v) => sum + Math.pow(v - trueMean, 2), 0);
    const ssResidual = scatterData.reduce((sum, d) => sum + Math.pow(d.true - d.predicted, 2), 0);
    const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    return {
      mae: mae,
      rmse: rmse,
      r2: r2,
      count: scatterData.length,
    };
  }, [scatterData]);

  // Calculate data range (for drawing y=x reference line)
  const allValues = scatterData.flatMap(d => [d.true, d.predicted]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1;

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-2">Sample #{data.index + 1}</p>
          <p className="text-blue-600">Actual: {data.true.toFixed(3)}</p>
          <p className="text-green-600">Predicted: {data.predicted.toFixed(3)}</p>
          <p className="text-red-600">Error: {data.error.toFixed(3)}</p>
          <p className="text-orange-600">Relative Error: {data.relativeError.toFixed(2)}%</p>
        </div>
      );
    }
    return null;
  };

  // Click event handler
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
            name="Actual Value"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `Actual Value (${targetColumn})`,
              position: 'bottom',
              offset: 40,
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />

          <YAxis
            type="number"
            dataKey="predicted"
            name="Predicted Value"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `Predicted Value (${targetColumn})`,
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
          
          {/* y=x reference line (ideal prediction) */}
          <ReferenceLine
            segment={[
              { x: minValue - padding, y: minValue - padding },
              { x: maxValue + padding, y: maxValue + padding },
            ]}
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="5 5"
            label={{
              value: 'y = x (Ideal)',
              position: 'insideTopRight',
              fill: '#6b7280',
              fontSize: 12,
            }}
          />

          {/* Scatter points */}
          <Scatter
            name="Prediction Samples"
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

      {/* Legend */}
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-gray-600">Relative Error &lt; 5%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-500"></div>
          <span className="text-gray-600">5% ≤ Relative Error &lt; 10%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-gray-600">Relative Error ≥ 10%</span>
        </div>
      </div>

      {/* Evaluation Metrics */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Evaluation Metrics (Based on {metrics.count} samples)</h4>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-3 border border-gray-200">
            <div className="text-xs text-gray-500 mb-1">R² Score</div>
            <div className="text-lg font-semibold text-gray-900">
              {metrics.r2.toFixed(4)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {(metrics.r2 * 100).toFixed(2)}%
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-200">
            <div className="text-xs text-gray-500 mb-1">RMSE</div>
            <div className="text-lg font-semibold text-gray-900">
              {metrics.rmse.toFixed(3)}
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-200">
            <div className="text-xs text-gray-500 mb-1">MAE</div>
            <div className="text-lg font-semibold text-gray-900">
              {metrics.mae.toFixed(3)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default PredictionScatterChart;

