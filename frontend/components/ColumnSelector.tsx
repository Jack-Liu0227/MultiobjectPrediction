/**
 * 列选择组件
 * 支持选择元素组成列、热处理文本列和多个目标预测列
 */

import React, { useState, useEffect } from 'react';

interface ColumnSelectorProps {
  columns: string[];
  onConfigChange: (config: ColumnConfig) => void;
  initialConfig?: Partial<ColumnConfig>;
  trainCount?: number; // 训练集样本数（用于比例计算）
}

export interface ColumnConfig {
  compositionColumn: string;
  processingColumn: string;
  targetColumns: string[];
  maxRetrievedSamples: number;
}

export default function ColumnSelector({
  columns,
  onConfigChange,
  initialConfig,
  trainCount = 0,
}: ColumnSelectorProps) {
  const [compositionColumn, setCompositionColumn] = useState<string>(
    initialConfig?.compositionColumn || ''
  );
  const [processingColumn, setProcessingColumn] = useState<string>(
    initialConfig?.processingColumn || ''
  );
  const [targetColumns, setTargetColumns] = useState<string[]>(
    initialConfig?.targetColumns || []
  );
  const [maxRetrievedSamples, setMaxRetrievedSamples] = useState<number>(
    initialConfig?.maxRetrievedSamples || 20
  );
  const [sampleRatio, setSampleRatio] = useState<string>(''); // 比例输入（0-1之间的小数）
  const [warnings, setWarnings] = useState<string[]>([]);

  // 智能列识别函数
  const detectCompositionColumn = (cols: string[]): string | null => {
    // 优先查找包含 wt% 的列（不区分大小写）
    const wtPercentCol = cols.find((col) =>
      col.toLowerCase().includes('wt%') || col.toLowerCase().includes('wt %')
    );
    if (wtPercentCol) return wtPercentCol;

    // 其次查找包含 at% 的列
    const atPercentCol = cols.find((col) =>
      col.toLowerCase().includes('at%') || col.toLowerCase().includes('at %')
    );
    if (atPercentCol) return atPercentCol;

    // 查找包含元素符号和百分号的列（如 Al(wt%), Ti(wt%)）
    const elementPercentCol = cols.find((col) => {
      const lower = col.toLowerCase();
      return (lower.includes('(wt%') || lower.includes('(at%') ||
              lower.includes('wt%)') || lower.includes('at%)'));
    });
    if (elementPercentCol) return elementPercentCol;

    // 最后查找包含 composition 的列
    const compositionCol = cols.find((col) =>
      col.toLowerCase().includes('composition')
    );
    return compositionCol || null;
  };

  const detectProcessingColumn = (cols: string[]): string | null => {
    // 优先查找 Processing_Description（精确匹配）
    const exactMatch = cols.find((col) => col === 'Processing_Description');
    if (exactMatch) return exactMatch;

    // 查找包含 processing 和 description 的列
    const processingDescCol = cols.find((col) => {
      const lower = col.toLowerCase();
      return lower.includes('processing') && lower.includes('description');
    });
    if (processingDescCol) return processingDescCol;

    // 查找包含 processing 的列
    const processingCol = cols.find((col) =>
      col.toLowerCase().includes('processing')
    );
    if (processingCol) return processingCol;

    // 查找包含 treatment 的列
    const treatmentCol = cols.find((col) =>
      col.toLowerCase().includes('treatment')
    );
    if (treatmentCol) return treatmentCol;

    // 查找包含 description 的列
    const descriptionCol = cols.find((col) =>
      col.toLowerCase().includes('description')
    );
    return descriptionCol || null;
  };

  const detectTargetColumns = (cols: string[]): string[] => {
    const targets: string[] = [];

    // 优先添加 UTS(MPa) 和 El(%)（精确匹配）
    const utsCol = cols.find((col) => col === 'UTS(MPa)' || col === 'UTS (MPa)');
    if (utsCol) targets.push(utsCol);

    const elCol = cols.find((col) => col === 'El(%)' || col === 'El (%)');
    if (elCol) targets.push(elCol);

    // 如果已经有2个目标列，直接返回
    if (targets.length >= 2) return targets;

    // 否则查找其他包含单位的列
    const unitPatterns = ['MPa', 'GPa', '%', 'HV', 'HRC', 'HB', 'J', 'W', 'K', 'Pa', 'N'];
    for (const col of cols) {
      if (targets.includes(col)) continue;

      // 检查是否包含单位或括号（排除组成列和工艺列）
      const lower = col.toLowerCase();
      const isCompositionCol = lower.includes('wt%') || lower.includes('at%');
      const isProcessingCol = lower.includes('processing') || lower.includes('treatment');

      if (!isCompositionCol && !isProcessingCol) {
        if (unitPatterns.some(unit => col.includes(unit)) ||
            (col.includes('(') && col.includes(')'))) {
          targets.push(col);
          if (targets.length >= 2) break;
        }
      }
    }

    return targets;
  };

  // 自动检测推荐列（仅在初始加载时运行一次）
  useEffect(() => {
    if (columns.length === 0) return;

    // 如果已经有初始配置，不执行自动检测
    if (initialConfig?.compositionColumn || initialConfig?.processingColumn ||
        (initialConfig?.targetColumns && initialConfig.targetColumns.length > 0)) {
      return;
    }

    const newWarnings: string[] = [];

    // 自动检测元素组成列
    if (!compositionColumn) {
      const detected = detectCompositionColumn(columns);
      if (detected) {
        setCompositionColumn(detected);
        console.log('✓ 自动识别元素组成列:', detected);
      } else {
        newWarnings.push('未能自动识别元素组成列，请手动选择包含 wt% 或 at% 的列');
      }
    }

    // 自动检测工艺描述列
    if (!processingColumn) {
      const detected = detectProcessingColumn(columns);
      if (detected) {
        setProcessingColumn(detected);
        console.log('✓ 自动识别工艺描述列:', detected);
      } else {
        newWarnings.push('未能自动识别工艺描述列，请手动选择 Processing_Description 或相关列');
      }
    }

    // 自动检测目标列
    if (targetColumns.length === 0) {
      const detected = detectTargetColumns(columns);
      if (detected.length >= 2) {
        setTargetColumns(detected);
        console.log('✓ 自动识别目标列:', detected);
      } else if (detected.length > 0) {
        setTargetColumns(detected);
        newWarnings.push(`仅识别到 ${detected.length} 个目标列，请手动添加更多目标列（至少需要 2 个）`);
      } else {
        newWarnings.push('未能自动识别足够的目标列，请手动选择 2-5 个目标性质列');
      }
    }

    if (newWarnings.length > 0) {
      setWarnings(newWarnings);
    }
  }, [columns]); // 只依赖 columns，确保只在列数据变化时运行

  // 更新配置
  useEffect(() => {
    if (compositionColumn && processingColumn && targetColumns.length >= 2) {
      onConfigChange({
        compositionColumn,
        processingColumn,
        targetColumns,
        maxRetrievedSamples,
      });
    }
  }, [compositionColumn, processingColumn, targetColumns, maxRetrievedSamples]);

  const handleTargetToggle = (column: string) => {
    if (targetColumns.includes(column)) {
      setTargetColumns(targetColumns.filter((col) => col !== column));
    } else {
      if (targetColumns.length < 5) {
        setTargetColumns([...targetColumns, column]);
      } else {
        alert('最多只能选择 5 个目标列');
      }
    }
  };

  // 过滤出可能的目标列（数值型列）
  const potentialTargetColumns = columns.filter((col) => {
    // 排除已选择的组成列和工艺列
    if (col === compositionColumn || col === processingColumn) {
      return false;
    }

    const lower = col.toLowerCase();

    // 排除明显是组成列的列（包含 wt% 或 at%）
    if (lower.includes('wt%') || lower.includes('at%') ||
        lower.includes('wt %') || lower.includes('at %')) {
      return false;
    }

    // 排除明显是工艺列的列
    if (lower.includes('processing') && lower.includes('description')) {
      return false;
    }

    // 包含单位符号或括号的列可能是目标列
    const unitPatterns = ['MPa', 'GPa', '%', 'HV', 'HRC', 'HB', 'J', 'W', 'K', 'Pa', 'N'];
    return unitPatterns.some(unit => col.includes(unit)) ||
           (col.includes('(') && col.includes(')'));
  });

  const isValid =
    compositionColumn && processingColumn && targetColumns.length >= 2;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          列配置
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          请选择元素组成列、热处理描述列和至少 2 个目标预测列（最多 5 个）
        </p>
      </div>

      {/* 自动识别警告 */}
      {warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div className="flex-1">
              <h4 className="text-sm font-medium text-yellow-800 mb-1">自动识别提示</h4>
              <ul className="text-sm text-yellow-700 space-y-1">
                {warnings.map((warning, idx) => (
                  <li key={idx}>• {warning}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 组成列选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          元素组成列 <span className="text-red-500">*</span>
        </label>
        <select
          value={compositionColumn}
          onChange={(e) => setCompositionColumn(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">-- 请选择 --</option>
          {columns.map((col) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </div>

      {/* 热处理列选择 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          热处理描述列 <span className="text-red-500">*</span>
        </label>
        <select
          value={processingColumn}
          onChange={(e) => setProcessingColumn(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">-- 请选择 --</option>
          {columns.map((col) => (
            <option key={col} value={col}>
              {col}
            </option>
          ))}
        </select>
      </div>

      {/* 目标列多选 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          目标预测列 <span className="text-red-500">*</span>
          <span className="text-gray-500 text-xs ml-2">
            (已选择 {targetColumns.length}/5，至少选择 2 个)
          </span>
        </label>
        <div className="border border-gray-300 rounded-lg p-3 max-h-60 overflow-y-auto">
          {potentialTargetColumns.length === 0 ? (
            <p className="text-gray-500 text-sm">
              请先选择组成列和热处理列
            </p>
          ) : (
            <div className="space-y-2">
              {potentialTargetColumns.map((col) => (
                <label
                  key={col}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                >
                  <input
                    type="checkbox"
                    checked={targetColumns.includes(col)}
                    onChange={() => handleTargetToggle(col)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{col}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RAG 检索样本数配置 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          RAG 检索样本数
          <span className="text-gray-500 text-xs ml-2">
            (从训练集中检索最相似的样本数量)
          </span>
        </label>
        <div className="flex items-center space-x-4">
          {/* 直接输入数量 */}
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min="1"
              value={maxRetrievedSamples || ''}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setMaxRetrievedSamples(0);
                  setSampleRatio('');
                } else {
                  const numValue = parseInt(value);
                  if (!isNaN(numValue) && numValue >= 1) {
                    setMaxRetrievedSamples(numValue);
                    setSampleRatio(''); // 清空比例输入
                  }
                }
              }}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="数量"
            />
            <span className="text-sm text-gray-600">个样本</span>
          </div>

          <span className="text-gray-400">或</span>

          {/* 比例输入 */}
          <div className="flex items-center space-x-2">
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={sampleRatio}
              onChange={(e) => {
                const value = e.target.value;
                setSampleRatio(value);
                if (value === '') {
                  // 用户清空了比例输入，不做任何操作
                  return;
                }
                const ratio = parseFloat(value);
                if (!isNaN(ratio) && ratio >= 0 && ratio <= 1 && trainCount > 0) {
                  const calculated = Math.round(ratio * trainCount);
                  setMaxRetrievedSamples(calculated >= 1 ? calculated : 1);
                }
              }}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="0.8"
            />
            <span className="text-sm text-gray-600">比例 (0-1)</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          💡 提示：可直接输入数量（如50）或比例（如0.8表示80%）。样本数越多，预测越准确但速度越慢。
        </p>
        {trainCount > 0 && sampleRatio && (
          <p className="text-xs text-blue-600 mt-1">
            训练集共 {trainCount} 个样本，{(parseFloat(sampleRatio) * 100).toFixed(0)}% = {maxRetrievedSamples} 个样本
          </p>
        )}
      </div>

      {/* 验证提示 */}
      {!isValid && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-sm text-yellow-800">
            ⚠️ 请完成所有必填项的选择
          </p>
        </div>
      )}

      {isValid && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800">
            ✓ 配置完成，可以继续下一步
          </p>
        </div>
      )}
    </div>
  );
}

