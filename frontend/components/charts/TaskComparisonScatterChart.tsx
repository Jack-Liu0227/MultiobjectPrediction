/**
 * Task Comparison Scatter Chart Component
 * Displays prediction vs actual values with color-coded consistency levels
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

interface TaskComparisonScatterChartProps {
  comparisonData: {
    sample_details: Array<{
      sample_index: number;
      actual_value: number;
      predictions: { [key: string]: number };
      consistency_level: number;
    }>;
    task_ids: string[];
    n_tasks: number;
    target_column: string;
  };
}

export default function TaskComparisonScatterChart({
  comparisonData,
}: TaskComparisonScatterChartProps) {
  const { sample_details, task_ids, n_tasks, target_column } = comparisonData;

  // Prepare scatter plot data grouped by task
  // sample.predictions is an object with task_id as keys and predicted values as values
  const scatterDataByTask = task_ids.map((taskId, taskIndex) => {
    const taskData = sample_details.map((sample) => ({
      actual: sample.actual_value,
      predicted: sample.predictions[taskId],
      consistency: sample.consistency_level,
      sampleIndex: sample.sample_index,
      taskId: taskId,
      taskIndex: taskIndex,
    }));
    return { taskId, taskIndex, data: taskData };
  });

  // Combine all scatter data for plotting
  const scatterData = scatterDataByTask.flatMap(task => task.data);

  // Calculate metrics for each task
  const calculateTaskMetrics = (taskData: any[]) => {
    if (taskData.length === 0) return { mae: 0, rmse: 0, r2: 0 };

    // Calculate MAE
    const mae = taskData.reduce((sum, d) => sum + Math.abs(d.predicted - d.actual), 0) / taskData.length;

    // Calculate RMSE
    const mse = taskData.reduce((sum, d) => sum + Math.pow(d.predicted - d.actual, 2), 0) / taskData.length;
    const rmse = Math.sqrt(mse);

    // Calculate R²
    const actualMean = taskData.reduce((sum, d) => sum + d.actual, 0) / taskData.length;
    const ssTotal = taskData.reduce((sum, d) => sum + Math.pow(d.actual - actualMean, 2), 0);
    const ssResidual = taskData.reduce((sum, d) => sum + Math.pow(d.actual - d.predicted, 2), 0);
    const r2 = 1 - (ssResidual / ssTotal);

    return { mae, rmse, r2 };
  };

  // Calculate metrics for each task
  const taskMetrics = scatterDataByTask.map(task => ({
    taskId: task.taskId,
    taskIndex: task.taskIndex,
    ...calculateTaskMetrics(task.data),
  }));

  // Calculate data range for reference line
  const allValues = scatterData.flatMap(d => [d.actual, d.predicted]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1;

  // Color mapping based on consistency level
  const getConsistencyColor = (level: number) => {
    if (level === n_tasks) return '#3b82f6'; // Blue - all tasks agree
    if (level === n_tasks - 1) return '#ef4444'; // Red - N-1 tasks agree
    if (level === 2) return '#f59e0b'; // Orange - 2 tasks agree
    return '#10b981'; // Green - low consistency or all different
  };

  // Custom Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-sm">
          <p className="font-semibold text-gray-900 mb-2">Sample #{data.sampleIndex}</p>
          <p className="text-blue-600">Actual: {data.actual.toFixed(2)}</p>
          <p className="text-green-600">Predicted: {data.predicted.toFixed(2)}</p>
          <p className="text-purple-600">Consistency: {data.consistency}/{n_tasks} tasks</p>
        </div>
      );
    }
    return null;
  };

  // Legend items
  const getLegendItems = () => {
    const items = [];
    items.push({ label: `All ${n_tasks} tasks agree`, color: '#3b82f6' });
    if (n_tasks > 2) {
      items.push({ label: `${n_tasks - 1} tasks agree`, color: '#ef4444' });
    }
    if (n_tasks > 3) {
      items.push({ label: '2 tasks agree', color: '#f59e0b' });
    }
    items.push({ label: 'Low consistency', color: '#10b981' });
    return items;
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={500}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 60, left: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          
          <XAxis
            type="number"
            dataKey="actual"
            name="Experimental"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `Experimental ${target_column}`,
              position: 'bottom',
              offset: 40,
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />
          
          <YAxis
            type="number"
            dataKey="predicted"
            name="Predicted"
            domain={[minValue - padding, maxValue + padding]}
            label={{
              value: `Predicted ${target_column}`,
              angle: -90,
              position: 'left',
              offset: 40,
              style: { fontSize: 14, fontWeight: 600 },
            }}
            tick={{ fontSize: 12 }}
          />
          
          <Tooltip content={<CustomTooltip />} />
          
          {/* y=x reference line */}
          <ReferenceLine
            segment={[
              { x: minValue - padding, y: minValue - padding },
              { x: maxValue + padding, y: maxValue + padding },
            ]}
            stroke="#9ca3af"
            strokeWidth={2}
            strokeDasharray="5 5"
            label={{
              value: 'y = x',
              position: 'insideTopRight',
              fill: '#6b7280',
              fontSize: 12,
            }}
          />
          
          {/* Scatter points */}
          <Scatter name="Predictions" data={scatterData}>
            {scatterData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getConsistencyColor(entry.consistency)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Legend and metrics */}
      <div className="mt-4 space-y-4">
        {/* Color legend */}
        <div className="flex justify-center gap-6 text-sm flex-wrap">
          {getLegendItems().map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
              <span className="text-gray-600">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Metrics for each task */}
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 text-center">Performance Metrics by Task</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {taskMetrics.map((metrics, idx) => (
              <div key={idx} className="bg-white rounded-lg p-3 border border-gray-300 shadow-sm">
                <div className="text-xs font-semibold text-gray-600 mb-2 truncate" title={metrics.taskId}>
                  Task {idx + 1}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">MAE:</span>
                    <span className="font-medium text-gray-900">{metrics.mae.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">RMSE:</span>
                    <span className="font-medium text-gray-900">{metrics.rmse.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">R²:</span>
                    <span className="font-medium text-gray-900">{metrics.r2.toFixed(3)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

