import React from 'react';
import { ConfidenceLevel } from '../hooks/useConfidenceFilter';

interface ConfidenceFilterProps {
  value: ConfidenceLevel;
  onChange: (value: ConfidenceLevel) => void;
  stats?: {
    total: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
    filtered: number;
  };
  className?: string;
}

/**
 * 置信度筛选器组件
 * 
 * 提供按钮组样式的筛选器，用于筛选不同置信度级别的数据
 */
export const ConfidenceFilter: React.FC<ConfidenceFilterProps> = ({
  value,
  onChange,
  stats,
  className = '',
}) => {
  const options: { value: ConfidenceLevel; label: string; color: string }[] = [
    { value: 'all', label: 'All Data', color: 'bg-gray-100 hover:bg-gray-200 text-gray-800' },
    { value: 'high', label: 'High Confidence', color: 'bg-green-100 hover:bg-green-200 text-green-800' },
    { value: 'medium', label: 'Medium Confidence', color: 'bg-yellow-100 hover:bg-yellow-200 text-yellow-800' },
    { value: 'low', label: 'Low Confidence', color: 'bg-orange-100 hover:bg-orange-200 text-orange-800' },
  ];

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Filter by Confidence:</span>
        <div className="flex gap-2">
          {options.map((option) => {
            const isActive = value === option.value;
            const count = stats
              ? option.value === 'all'
                ? stats.total
                : stats[option.value]
              : null;

            return (
              <button
                key={option.value}
                onClick={() => onChange(option.value)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-all
                  ${isActive
                    ? `${option.color} ring-2 ring-offset-2 ${
                        option.value === 'all'
                          ? 'ring-gray-400'
                          : option.value === 'high'
                          ? 'ring-green-500'
                          : option.value === 'medium'
                          ? 'ring-yellow-500'
                          : 'ring-orange-500'
                      }`
                    : 'bg-white hover:bg-gray-50 text-gray-600 border border-gray-300'
                  }
                `}
              >
                {option.label}
                {count !== null && (
                  <span className="ml-2 text-xs opacity-75">({count})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      
      {stats && value !== 'all' && (
        <div className="text-xs text-gray-500">
          Showing {stats.filtered} of {stats.total} samples
        </div>
      )}
    </div>
  );
};

