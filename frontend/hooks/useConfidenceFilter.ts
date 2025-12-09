import { useState, useMemo } from 'react';

export type ConfidenceLevel = 'all' | 'high' | 'medium' | 'low';

export interface ConfidenceFilterable {
  confidence?: string | null;
}

/**
 * 可复用的置信度筛选 Hook
 * 
 * @returns {Object} 包含筛选状态和筛选函数的对象
 */
export function useConfidenceFilter<T extends ConfidenceFilterable>() {
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel>('all');

  /**
   * 根据当前筛选条件过滤数据
   * 
   * @param data - 要筛选的数据数组
   * @returns 筛选后的数据数组
   */
  const filterByConfidence = useMemo(() => {
    return (data: T[]): T[] => {
      if (confidenceFilter === 'all') {
        return data;
      }
      
      return data.filter(item => {
        const itemConfidence = item.confidence?.toLowerCase();
        return itemConfidence === confidenceFilter;
      });
    };
  }, [confidenceFilter]);

  /**
   * 获取筛选后的数据统计信息
   * 
   * @param data - 原始数据数组
   * @returns 统计信息对象
   */
  const getFilterStats = (data: T[]) => {
    const total = data.length;
    const high = data.filter(item => item.confidence?.toLowerCase() === 'high').length;
    const medium = data.filter(item => item.confidence?.toLowerCase() === 'medium').length;
    const low = data.filter(item => item.confidence?.toLowerCase() === 'low').length;
    const unknown = total - high - medium - low;

    return {
      total,
      high,
      medium,
      low,
      unknown,
      filtered: filterByConfidence(data).length,
    };
  };

  return {
    confidenceFilter,
    setConfidenceFilter,
    filterByConfidence,
    getFilterStats,
  };
}

