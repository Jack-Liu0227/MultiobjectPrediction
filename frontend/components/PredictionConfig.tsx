/**
 * 预测配置组件
 * 配置训练/测试集划分比例、模型参数等
 */

import React, { useState, useEffect } from 'react';
import { PredictionConfig as PredictionConfigType } from '../lib/types';

interface PredictionConfigProps {
  onConfigChange: (config: ModelConfig) => void;
  initialConfig?: Partial<ModelConfig>;
}

export interface ModelConfig {
  trainRatio: number;
  maxRetrievedSamples: number;
  similarityThreshold: number;
  modelProvider: string;
  modelName: string;
  temperature: number;
}

export default function PredictionConfig({
  onConfigChange,
  initialConfig,
}: PredictionConfigProps) {
  const [config, setConfig] = useState<ModelConfig>({
    trainRatio: initialConfig?.trainRatio || 0.8,
    maxRetrievedSamples: initialConfig?.maxRetrievedSamples || 10,
    similarityThreshold: initialConfig?.similarityThreshold || 0.3,
    modelProvider: initialConfig?.modelProvider || 'gemini',
    modelName: initialConfig?.modelName || 'gemini-2.5-flash',
    temperature: initialConfig?.temperature || 1.0,
  });

  // 模型提供商选项
  const modelProviders = [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'openrouter', label: 'OpenRouter' },
    { value: 'oneapi', label: 'OneAPI' },
  ];

  // 模型名称选项（根据提供商）
  const modelNames: Record<string, string[]> = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    openrouter: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash'],
    oneapi: ['gemini-2.5-flash', 'deepseek-chat'],
  };

  useEffect(() => {
    onConfigChange(config);
  }, [config]);

  const handleChange = (key: keyof ModelConfig, value: any) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleProviderChange = (provider: string) => {
    const defaultModel = modelNames[provider]?.[0] || '';
    setConfig((prev) => ({
      ...prev,
      modelProvider: provider,
      modelName: defaultModel,
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          预测参数配置
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          配置训练参数和模型设置
        </p>
      </div>

      {/* 数据划分 */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <h4 className="font-medium text-gray-900">数据划分</h4>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            训练集比例: {(config.trainRatio * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="50"
            max="90"
            step="5"
            value={config.trainRatio * 100}
            onChange={(e) =>
              handleChange('trainRatio', parseInt(e.target.value) / 100)
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>50%</span>
            <span>70%</span>
            <span>90%</span>
          </div>
        </div>
      </div>

      {/* RAG 参数 */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <h4 className="font-medium text-gray-900">RAG 检索参数</h4>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            最大检索样本数: {config.maxRetrievedSamples}
          </label>
          <input
            type="range"
            min="1"
            max="50"
            step="1"
            value={config.maxRetrievedSamples}
            onChange={(e) =>
              handleChange('maxRetrievedSamples', parseInt(e.target.value))
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-xs text-gray-500 mt-1">
            每次预测时检索的相似训练样本数量
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            相似度阈值: {config.similarityThreshold.toFixed(2)}
          </label>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={config.similarityThreshold * 100}
            onChange={(e) =>
              handleChange('similarityThreshold', parseInt(e.target.value) / 100)
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-xs text-gray-500 mt-1">
            最小相似度分数（0-1），低于此值的样本将被过滤
          </p>
        </div>
      </div>

      {/* 模型配置 */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-4">
        <h4 className="font-medium text-gray-900">模型配置</h4>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            模型提供商
          </label>
          <select
            value={config.modelProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {modelProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>
                {provider.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            模型名称
          </label>
          <select
            value={config.modelName}
            onChange={(e) => handleChange('modelName', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {modelNames[config.modelProvider]?.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Temperature: {config.temperature.toFixed(1)}
          </label>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={config.temperature * 10}
            onChange={(e) =>
              handleChange('temperature', parseInt(e.target.value) / 10)
            }
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-xs text-gray-500 mt-1">
            控制模型输出的随机性（0.0 = 确定性，2.0 = 高随机性）
          </p>
        </div>
      </div>

      {/* 配置摘要 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 mb-2">配置摘要</h4>
        <div className="text-sm text-blue-800 space-y-1">
          <p>• 训练集: {(config.trainRatio * 100).toFixed(0)}% | 测试集: {((1 - config.trainRatio) * 100).toFixed(0)}%</p>
          <p>• RAG 检索: 最多 {config.maxRetrievedSamples} 个样本，相似度 ≥ {config.similarityThreshold.toFixed(2)}</p>
          <p>• 模型: {config.modelProvider} / {config.modelName} (T={config.temperature})</p>
        </div>
      </div>
    </div>
  );
}

