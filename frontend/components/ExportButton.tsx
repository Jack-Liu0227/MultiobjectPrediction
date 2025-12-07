/**
 * 导出按钮组件
 * 提供多格式导出下拉菜单（CSV/Excel/HTML/PNG）
 */

import React, { useState, useRef } from 'react';

export interface ExportOption {
  label: string;
  format: 'csv' | 'excel' | 'html' | 'png' | 'json';
  icon?: string;
  onClick: () => void | Promise<void>;
}

interface ExportButtonProps {
  options: ExportOption[];
  label?: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
}

export default function ExportButton({
  options,
  label = '导出',
  className = '',
  disabled = false,
  loading = false,
}: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 关闭下拉菜单
  const closeDropdown = () => {
    setIsOpen(false);
  };

  // 处理导出选项点击
  const handleOptionClick = async (option: ExportOption) => {
    setExportingFormat(option.format);
    closeDropdown();
    
    try {
      await option.onClick();
    } catch (error) {
      console.error(`Export failed for ${option.format}:`, error);
      alert(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setExportingFormat(null);
    }
  };

  // 获取格式图标
  const getFormatIcon = (format: string, customIcon?: string) => {
    if (customIcon) return customIcon;
    
    switch (format) {
      case 'csv':
        return '📄';
      case 'excel':
        return '📊';
      case 'html':
        return '🌐';
      case 'png':
        return '🖼️';
      case 'json':
        return '📋';
      default:
        return '📁';
    }
  };

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading || exportingFormat !== null}
        className={`
          inline-flex items-center gap-2 px-4 py-2 
          bg-blue-600 text-white rounded-lg 
          hover:bg-blue-700 active:bg-blue-800
          disabled:bg-gray-400 disabled:cursor-not-allowed
          transition-colors duration-200
          text-sm font-medium
          ${className}
        `}
      >
        {loading || exportingFormat ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            <span>导出中...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{label}</span>
            <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* 下拉菜单 */}
      {isOpen && !disabled && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 z-10"
            onClick={closeDropdown}
          />
          
          {/* 菜单内容 */}
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-20 overflow-hidden">
            {options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleOptionClick(option)}
                disabled={exportingFormat !== null}
                className="
                  w-full px-4 py-3 text-left text-sm
                  hover:bg-blue-50 active:bg-blue-100
                  disabled:bg-gray-100 disabled:cursor-not-allowed
                  transition-colors duration-150
                  flex items-center gap-3
                  border-b border-gray-100 last:border-b-0
                "
              >
                <span className="text-xl">{getFormatIcon(option.format, option.icon)}</span>
                <div className="flex-1">
                  <div className="font-medium text-gray-900">{option.label}</div>
                  <div className="text-xs text-gray-500 uppercase">{option.format}</div>
                </div>
                {exportingFormat === option.format && (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

