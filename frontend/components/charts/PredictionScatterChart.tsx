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
  showTrajectory?: boolean;
}

const ITERATION_COLORS = [
  '#ef4444', // Red (Start)
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#eab308', // Yellow
  '#84cc16', // Lime
  '#22c55e', // Green (End)
  '#10b981', // Emerald
  '#06b6d4', // Cyan
];

const PredictionScatterChart = React.memo(function PredictionScatterChart({
  predictions,
  targetColumn,
  onPointClick,
  showTrajectory = false,
}: PredictionScatterChartProps) {
  // Prepare scatter plot data
  const scatterData = useMemo(() => {
    if (showTrajectory) {
      // Trajectory mode: Create points for each iteration
      const points: any[] = [];

      predictions.forEach((pred, index) => {
        const trueValue = pred[targetColumn];
        const history = pred.iteration_history?.[targetColumn];
        let samplePoints: any[] = [];

        // Strategy 1: Check iteration_history object
        if (history && Array.isArray(history) && history.length > 0) {
          samplePoints = history.map((val, iterIndex) => ({
            index: pred.sample_index !== undefined ? pred.sample_index : index,
            true: trueValue,
            predicted: val,
            error: Math.abs(val - trueValue),
            relativeError: Math.abs((val - trueValue) / trueValue) * 100,
            iteration: iterIndex + 1,
            isFinal: iterIndex === history.length - 1,
            ...pred,
          }));
        } else {
          // Strategy 2: Try to find iteration columns
          const iterationPoints = [];
          let iter = 1;
          while (true) {
            const colName = `${targetColumn}_predicted_Iteration_${iter}`;
            const val = pred[colName];
            if (val !== undefined && val !== null && val !== '') {
              iterationPoints.push({
                index: pred.sample_index !== undefined ? pred.sample_index : index,
                true: trueValue,
                predicted: Number(val),
                error: Math.abs(Number(val) - trueValue),
                relativeError: Math.abs((Number(val) - trueValue) / trueValue) * 100,
                iteration: iter,
                isFinal: false,
                ...pred,
              });
              iter++;
            } else {
              break;
            }
          }

          if (iterationPoints.length > 0) {
            iterationPoints[iterationPoints.length - 1].isFinal = true;
            samplePoints = iterationPoints;
          } else {
            // Strategy 3: Fallback to final prediction
            const predictedValue = pred[`${targetColumn}_predicted`];
            if (trueValue !== null && predictedValue !== null && predictedValue !== undefined) {
              samplePoints = [{
                index: pred.sample_index !== undefined ? pred.sample_index : index,
                true: trueValue,
                predicted: predictedValue,
                error: Math.abs(predictedValue - trueValue),
                relativeError: Math.abs((predictedValue - trueValue) / trueValue) * 100,
                iteration: 1,
                isFinal: true,
                ...pred,
              }];
            }
          }
        }

        if (samplePoints.length > 0) {
          points.push(...samplePoints);
          // Insert a break point (null) to disconnect the line between samples
          points.push({ true: null, predicted: null });
        }
      });

      return points;
    }

    // Normal mode: Only final predictions
    return predictions.map((pred, index) => {
      const trueValue = pred[targetColumn];
      const predictedValue = pred[`${targetColumn}_predicted`];

      return {
        index: pred.sample_index !== undefined ? pred.sample_index : index,
        true: trueValue,
        predicted: predictedValue,
        error: Math.abs(predictedValue - trueValue),
        relativeError: Math.abs((predictedValue - trueValue) / trueValue) * 100,
        iteration: undefined,
        ...pred, // Keep complete data for click events
      };
    }).filter(d => d.true !== null && d.predicted !== null);
  }, [predictions, targetColumn, showTrajectory]);

  // Calculate evaluation metrics
  const metrics = useMemo(() => {
    // Filter out null points (breaks) for metrics calculation
    const validPoints = scatterData.filter(d => d.true !== null && d.predicted !== null);

    if (validPoints.length === 0) {
      return { mae: 0, rmse: 0, r2: 0, count: 0 };
    }

    const trueValues = validPoints.map(d => d.true);
    const predictedValues = validPoints.map(d => d.predicted);

    // Calculate MAE
    const mae = validPoints.reduce((sum, d) => sum + Math.abs(d.predicted - d.true), 0) / validPoints.length;

    // Calculate RMSE
    const mse = validPoints.reduce((sum, d) => sum + Math.pow(d.predicted - d.true, 2), 0) / validPoints.length;
    const rmse = Math.sqrt(mse);

    // Calculate R²
    const trueMean = trueValues.reduce((sum, v) => sum + v, 0) / trueValues.length;
    const ssTotal = trueValues.reduce((sum, v) => sum + Math.pow(v - trueMean, 2), 0);
    const ssResidual = validPoints.reduce((sum, d) => sum + Math.pow(d.true - d.predicted, 2), 0);
    const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    return {
      mae: mae,
      rmse: rmse,
      r2: r2,
      count: validPoints.length,
    };
  }, [scatterData]);

  // Calculate data range (for drawing y=x reference line)
  const validData = scatterData.filter(d => d.true !== null && d.predicted !== null);
  const allValues = validData.flatMap(d => [d.true, d.predicted]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1;

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      // Skip tooltip for break points or invalid data
      if (data.true === null || data.true === undefined || data.predicted === null || data.predicted === undefined) return null;

      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-2">Sample #{data.index + 1}</p>
          <p className="text-blue-600">Actual: {typeof data.true === 'number' ? data.true.toFixed(3) : data.true}</p>
          <p className="text-green-600">Predicted: {typeof data.predicted === 'number' ? data.predicted.toFixed(3) : data.predicted}</p>
          {data.iteration && (
            <p className="text-purple-600 font-medium">Iteration: {data.iteration}</p>
          )}
          <p className="text-red-600">Error: {typeof data.error === 'number' ? data.error.toFixed(3) : '-'}</p>
          <p className="text-orange-600">Relative Error: {typeof data.relativeError === 'number' ? data.relativeError.toFixed(2) : '-'}%</p>
        </div>
      );
    }
    return null;
  };

  // Click event handler
  const handleClick = (data: any) => {
    if (onPointClick && data && data.true !== null) {
      onPointClick(data, data.index);
    }
  };

  // Custom shape for bullseye effect
  const renderShape = (props: any) => {
    const { cx, cy, payload, fill } = props;
    if (payload.true === null || payload.predicted === null) return null;

    // Dynamic radius based on iteration: later iterations are larger
    // Iter 1: r=6, Iter 2: r=9, Iter 3: r=12 ...
    const radius = showTrajectory ? 6 + ((payload.iteration || 1) - 1) * 3 : 6;

    return <circle cx={cx} cy={cy} r={radius} fill={fill} fillOpacity={1} stroke="#fff" strokeWidth={2} />;
  };

  // Calculate max iteration for dynamic legend
  const maxIteration = useMemo(() => {
    if (!showTrajectory) return 0;
    let max = 0;
    scatterData.forEach(d => {
      if (d.iteration && d.iteration > max) max = d.iteration;
    });
    return max || 1;
  }, [scatterData, showTrajectory]);

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
            data={scatterData.sort((a, b) => {
              // Sort by sample index first, then by iteration
              if (a.index !== b.index) return a.index - b.index;
              return (a.iteration || 0) - (b.iteration || 0);
            })}
            fill="#3b82f6"
            onClick={handleClick}
            cursor={onPointClick ? 'pointer' : 'default'}
            line={showTrajectory ? { stroke: '#9ca3af', strokeWidth: 2, strokeDasharray: '5 5' } : false}
            shape={renderShape}
            isAnimationActive={false}
            opacity={1}
          >
            {scatterData.map((entry, index) => {
              if (entry.true === null) return null; // Skip break points

              let fill;
              if (showTrajectory) {
                // Color by iteration using the predefined palette
                // Use modulo to cycle through colors if iterations exceed palette size
                const colorIndex = Math.min((entry.iteration || 1) - 1, ITERATION_COLORS.length - 1);
                fill = ITERATION_COLORS[colorIndex];
              } else {
                // Normal mode: Color by error
                fill = entry.relativeError < 5 ? '#10b981' : entry.relativeError < 10 ? '#f59e0b' : '#ef4444';
              }

              return (
                <Cell
                  key={`cell-${index}`}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={2}
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-4 flex flex-col items-center gap-4">
        {showTrajectory ? (
          <div className="flex flex-col items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Iteration Progress (Color & Size)</span>
            {/* Colorbar for Iterations */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Start</span>
              <div className="flex rounded-md overflow-hidden border border-gray-200 shadow-sm">
                {ITERATION_COLORS.slice(0, Math.min(maxIteration, ITERATION_COLORS.length)).map((color, idx) => (
                  <div
                    key={idx}
                    className="w-12 h-6 flex items-center justify-center text-[10px] text-white font-bold"
                    style={{ backgroundColor: color }}
                    title={`Iteration ${idx + 1}`}
                  >
                    {idx + 1}
                  </div>
                ))}
              </div>
              <span className="text-xs text-gray-500">End</span>
            </div>

            {/* Size Legend */}
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 bg-gray-50 px-3 py-1 rounded-full">
              <span>Size:</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                <span>Early</span>
              </div>
              <span>→</span>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded-full bg-gray-400"></div>
                <span>Late</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center gap-6 text-sm">
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
        )}
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
