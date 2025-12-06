/**
 * Multi-Target Scatter Chart Component
 * Displays separate scatter plots for each target property
 * with color-coded consistency levels
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

interface MultiTargetScatterChartProps {
  comparisonData: {
    sample_details: Array<{
      sample_index: number;
      consistency_level: number;
      targets: {
        [targetName: string]: {
          actual_value: number;
          predictions: { [taskId: string]: number };
        };
      };
    }>;
    task_ids: string[];
    target_columns: string[];
    n_tasks: number;
    target_metrics?: {
      [targetName: string]: {
        [taskId: string]: {
          mae: number;
          rmse: number;
          r2: number;
        };
      };
    };
  };
  taskNames?: { [taskId: string]: string }; // Map of task ID to task name
}

// Color mapping based on consistency level
const getConsistencyColor = (level: number, nTasks: number): string => {
  if (level === nTasks) {
    return '#3b82f6'; // Blue - all tasks agree
  } else if (level === nTasks - 1) {
    return '#ef4444'; // Red - N-1 tasks agree
  } else if (level === 2) {
    return '#f59e0b'; // Orange - exactly 2 tasks agree
  } else {
    return '#10b981'; // Green - all tasks disagree (level = 1)
  }
};

const getConsistencyLabel = (level: number, nTasks: number): string => {
  if (level === nTasks) {
    return `All ${nTasks} tasks agree`;
  } else if (level === nTasks - 1) {
    return `${nTasks - 1} tasks agree`;
  } else if (level === 2) {
    return '2 tasks agree';
  } else {
    return 'All tasks disagree';
  }
};

export default function MultiTargetScatterChart({
  comparisonData,
  taskNames,
}: MultiTargetScatterChartProps) {
  const { sample_details, task_ids, target_columns, n_tasks, target_metrics } = comparisonData;

  // Helper function to get task display name
  const getTaskName = (taskId: string, index: number): string => {
    if (taskNames && taskNames[taskId]) {
      return taskNames[taskId];
    }
    return `Task ${index + 1}`;
  };

  // Prepare data for each target property
  // For each target, create one data point per task per sample
  const targetChartData = target_columns.map((targetName) => {
    const chartData: any[] = [];

    sample_details.forEach((sample) => {
      const targetData = sample.targets[targetName];
      if (!targetData) return;

      // Create one point for each task's prediction
      Object.entries(targetData.predictions).forEach(([taskId, predicted]) => {
        chartData.push({
          actual: targetData.actual_value,
          predicted: predicted,
          consistency: sample.consistency_level,
          sampleIndex: sample.sample_index,
          taskId: taskId,
          allPredictions: targetData.predictions, // All predictions for tooltip
        });
      });
    });

    return {
      targetName,
      data: chartData,
    };
  });

  // Custom legend
  const CustomLegend = ({ nTasks }: { nTasks: number }) => {
    const legendItems = [
      { label: `All ${nTasks} tasks agree`, color: '#3b82f6' },
    ];

    if (nTasks > 2) {
      legendItems.push({ label: `${nTasks - 1} tasks agree`, color: '#ef4444' });
    }

    if (nTasks > 3) {
      legendItems.push({ label: '2 tasks agree', color: '#f59e0b' });
    }

    legendItems.push({ label: 'All tasks disagree', color: '#10b981' });

    return (
      <div className="flex justify-center gap-6 mt-2">
        {legendItems.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-sm text-gray-700">{item.label}</span>
          </div>
        ))}
      </div>
    );
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      const taskIndex = task_ids.indexOf(data.taskId);
      const taskDisplayName = getTaskName(data.taskId, taskIndex);
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="font-semibold">Sample {data.sampleIndex}</p>
          <p className="text-sm font-medium text-blue-600">{taskDisplayName}</p>
          <p className="text-sm">Actual: {data.actual?.toFixed(2)}</p>
          <p className="text-sm">Predicted: {data.predicted?.toFixed(2)}</p>
          <p className="text-sm mt-1">
            Consistency: {getConsistencyLabel(data.consistency, n_tasks)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-8">
      {targetChartData.map(({ targetName, data }) => (
        <div key={targetName} className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Prediction vs Actual Values - {targetName}
          </h3>
          
          {/* Scatter Plot */}
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="actual"
                name="Experimental"
                label={{ value: `Experimental ${targetName}`, position: 'insideBottom', offset: -10 }}
              />
              <YAxis
                type="number"
                dataKey="predicted"
                name="Predicted"
                label={{ value: `Predicted ${targetName}`, angle: -90, position: 'insideLeft' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={36}
                content={<CustomLegend nTasks={n_tasks} />}
              />
              
              {/* Reference line y = x */}
              <ReferenceLine
                segment={[
                  { x: Math.min(...data.map(d => d.actual)), y: Math.min(...data.map(d => d.actual)) },
                  { x: Math.max(...data.map(d => d.actual)), y: Math.max(...data.map(d => d.actual)) }
                ]}
                stroke="#666"
                strokeDasharray="5 5"
                label="y = x"
              />

              {/* Scatter points with color coding */}
              <Scatter name="Samples" data={data} fill="#3b82f6">
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={getConsistencyColor(entry.consistency, n_tasks)}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          {/* Performance Metrics */}
          {target_metrics && target_metrics[targetName] && (
            <div className="mt-6">
              <h4 className="text-md font-semibold text-gray-700 mb-3">Performance Metrics by Task</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(target_metrics[targetName]).map(([taskId, metrics]) => {
                  const taskIndex = task_ids.indexOf(taskId);
                  const taskDisplayName = getTaskName(taskId, taskIndex);
                  return (
                    <div key={taskId} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="text-sm font-semibold text-blue-600 mb-2 truncate" title={taskDisplayName}>
                        {taskDisplayName}
                      </div>
                      <div className="space-y-1 text-sm">
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
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

