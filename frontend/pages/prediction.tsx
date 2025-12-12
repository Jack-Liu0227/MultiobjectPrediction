/**
 * 多目标预测页面
 * 按照设计：数据集选择 → 元素/工艺/目标配置 → 预测
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import FileUpload from '@/components/FileUpload';
import TaskSidebar from '@/components/TaskSidebar';
import TaskProgressPanel from '@/components/TaskProgressPanel';
import RAGPreviewModal from '@/components/RAGPreviewModal';
import DatasetSplitPanel from '@/components/DatasetSplitPanel';
import PromptTemplateEditor from '@/components/PromptTemplateEditor';
import { UploadResponse } from '@/lib/types';
import { startPrediction, getTaskStatus } from '@/lib/api';

// 配置标签页类型
type ConfigTab = 'elements' | 'processing' | 'targets' | 'features' | 'rag' | 'llm' | 'split' | 'template' | 'iteration';

// 预测配置接口
interface PredictionSettings {
  // 元素配置
  compositionColumns: string[];
  // 工艺配置（可选，支持多选）
  processingColumn: string[];
  // 目标属性
  targetColumns: string[];
  // 特征选择
  featureColumns: string[];
  // RAG 配置
  maxRetrievedSamples: number;
  similarityThreshold: number;
  trainRatio: number; // 训练集比例
  randomSeed: number; // 随机种子
  // LLM 配置
  modelProvider: string;
  modelName: string;
  temperature: number;
  sampleSize: number; // 从测试集随机抽取的样本数
  workers: number; // 并行预测的工作线程数
  promptTemplate: any | null; // 自定义提示词模板
  // 迭代预测配置
  enableIteration: boolean;
  maxIterations: number;
  convergenceThreshold: number;
  earlyStop: boolean;
  maxWorkers: number;
}

export default function PredictionPage() {
  const router = useRouter();

  // 上传状态
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [allColumns, setAllColumns] = useState<string[]>([]);

  // 数据集引用状态
  const [useExistingDataset, setUseExistingDataset] = useState(false);
  const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');

  // 配置状态
  const [activeTab, setActiveTab] = useState<ConfigTab>('elements');
  const [taskNote, setTaskNote] = useState('');
  const [continueFromTaskId, setContinueFromTaskId] = useState<string | null>(null);

  // 预测配置
  const [settings, setSettings] = useState<PredictionSettings>({
    compositionColumns: [],
    processingColumn: [],  // 工艺列默认为空数组（可选，支持多选）
    targetColumns: [],
    featureColumns: [],
    maxRetrievedSamples: 50,
    similarityThreshold: 0.3,
    trainRatio: 0.8, // 默认训练集比例 80%
    randomSeed: 42, // 默认随机种子
    modelProvider: 'deepseek', // 使用 DeepSeek API
    modelName: 'deepseek-chat', // DeepSeek 模型名称
    temperature: 0, // 默认温度为0（完全确定性输出）
    sampleSize: 10, // 默认从测试集抽取 10 个样本
    workers: 5, // 默认并行线程数
    promptTemplate: null, // 默认不使用自定义模板
    // 迭代预测配置
    enableIteration: false,
    maxIterations: 5,
    convergenceThreshold: 0.01,
    earlyStop: true,
    maxWorkers: 5,
  });

  // 任务状态
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 数据集划分信息
  const [trainSampleCount, setTrainSampleCount] = useState<number>(0);
  const [retrievalRatioInput, setRetrievalRatioInput] = useState<string>(''); // 检索比例输入框的临时值

  // 侧边栏状态
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // RAG 预览模态框状态
  const [showRAGPreview, setShowRAGPreview] = useState(false);

  // LLM 模型列表状态
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // 自动保存配置到 localStorage（当用户修改列选择时）
  useEffect(() => {
    if (typeof window !== 'undefined' && uploadedFile) {
      // 保存列配置和数据集信息
      const configToSave = {
        datasetId: selectedDatasetId || uploadedFile.file_id,  // 保存数据集 ID（优先使用 selectedDatasetId）
        fileId: uploadedFile.file_id,  // 保存文件 ID
        datasetName: uploadedFile.filename,  // 保存数据集名称
        rowCount: uploadedFile.row_count,  // 保存行数
        columnCount: allColumns.length,  // 保存列数
        compositionColumns: settings.compositionColumns,
        processingColumn: settings.processingColumn,
        targetColumns: settings.targetColumns,
        featureColumns: settings.featureColumns,
      };
      localStorage.setItem('predictionConfig', JSON.stringify(configToSave));
      console.log('✓ 列配置已保存到 localStorage:', configToSave);
    }
  }, [
    settings.compositionColumns,
    settings.processingColumn,
    settings.targetColumns,
    settings.featureColumns,
    uploadedFile,
    selectedDatasetId,
    allColumns.length
  ]);

  // 加载可用 LLM 模型
  const loadAvailableModels = async () => {
    try {
      setLoadingModels(true);
      const response = await fetch('http://localhost:8000/api/llm/models');
      const data = await response.json();
      setAvailableModels(data.models || []);

      // 如果当前没有选择模型，使用默认模型
      if (!settings.modelName && data.default_model) {
        const defaultModel = data.models.find((m: any) => m.id === data.default_model);
        if (defaultModel) {
          setSettings(prev => ({
            ...prev,
            modelName: defaultModel.id,
            modelProvider: defaultModel.provider,
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load LLM models:', error);
    } finally {
      setLoadingModels(false);
    }
  };

  // 加载可用数据集
  const loadAvailableDatasets = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/datasets/list?page=1&page_size=100');
      const data = await response.json();
      setAvailableDatasets(data.datasets || []);
    } catch (error) {
      console.error('Failed to load datasets:', error);
    }
  };

  // 从任务配置加载
  const loadTaskConfig = async (taskId: string, isContinue: boolean = false) => {
    try {
      // 首先尝试从 task_config.json 加载
      const response = await fetch(`http://localhost:8000/api/results/${taskId}/task_config.json`);
      if (!response.ok) {
        throw new Error('无法加载任务配置');
      }
      const taskConfig = await response.json();

      // 配置嵌套在 request_data.config 中
      const requestData = taskConfig.request_data || {};
      const config = requestData.config || {};

      // 加载数据集（优先使用 dataset_id，其次使用 file_id）
      const datasetId = requestData.dataset_id || requestData.file_id;
      if (datasetId) {
        setUseExistingDataset(true);
        setSelectedDatasetId(datasetId);
        await loadDatasetById(datasetId);
      }

      // 恢复配置（从嵌套的 config 对象读取）
      // 处理 processingColumn：确保总是数组（兼容旧数据可能是字符串或 null）
      let processingColumn: string[] = [];
      if (Array.isArray(config.processing_column)) {
        processingColumn = config.processing_column;
      } else if (typeof config.processing_column === 'string' && config.processing_column) {
        processingColumn = [config.processing_column];
      }

      setSettings({
        compositionColumns: config.composition_column || [],
        processingColumn: processingColumn,
        targetColumns: config.target_columns || [],
        featureColumns: config.feature_columns || [],
        maxRetrievedSamples: config.max_retrieved_samples || 50,
        similarityThreshold: config.similarity_threshold || 0.3,
        trainRatio: config.train_ratio || 0.8,
        randomSeed: config.random_seed || 42,
        modelProvider: config.model_provider || 'deepseek',
        modelName: config.model_name || 'deepseek-chat',
        temperature: config.temperature !== undefined ? config.temperature : 0,
        sampleSize: config.sample_size || 10,
        workers: config.workers || 5,
        promptTemplate: config.prompt_template || null,
        // 迭代预测配置
        enableIteration: config.enable_iteration || false,
        maxIterations: config.max_iterations || 5,
        convergenceThreshold: config.convergence_threshold || 0.01,
        earlyStop: config.early_stop !== undefined ? config.early_stop : true,
        maxWorkers: config.max_workers || 5,
      });

      setTaskNote(requestData.task_note || '');

      // 如果是增量预测，设置 continueFromTaskId
      if (isContinue) {
        setContinueFromTaskId(taskId);
        alert('增量预测模式：将继续预测未完成的样本');
      } else {
        setContinueFromTaskId(null);
        alert('任务配置已加载，您可以修改参数后重新提交');
      }
    } catch (error: any) {
      console.error('Failed to load task config:', error);
      alert('加载任务配置失败: ' + error.message);
    }
  };

  // 初始化时加载数据集列表和模型列表
  useEffect(() => {
    loadAvailableDatasets();
    loadAvailableModels();

    // 检查 URL 参数是否有 dataset_id 或 rerun_task_id
    const { dataset_id, rerun_task_id, continue: continueFlag } = router.query;

    if (rerun_task_id && typeof rerun_task_id === 'string') {
      // 重新运行任务或继续预测：加载任务配置
      const isContinue = continueFlag === 'true';
      loadTaskConfig(rerun_task_id, isContinue);
    } else if (dataset_id && typeof dataset_id === 'string') {
      // 从数据集页面跳转
      setUseExistingDataset(true);
      setSelectedDatasetId(dataset_id);
      loadDatasetById(dataset_id);
    }
  }, [router.query]);

  // 根据 ID 加载数据集
  const loadDatasetById = async (datasetId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`);
      const dataset = await response.json();

      // 模拟上传文件的响应格式
      setUploadedFile({
        file_id: dataset.dataset_id,
        filename: dataset.original_filename,
        columns: dataset.columns,
        row_count: dataset.row_count,
        preview: [], // 添加空的 preview 字段
      });
      setAllColumns(dataset.columns);
      autoDetectColumns(dataset.columns);

      // 标记数据集被使用
      await fetch(`http://localhost:8000/api/datasets/${datasetId}/use`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to load dataset:', error);
      setError('加载数据集失败');
    }
  };

  // 处理数据集选择
  const handleDatasetSelect = (datasetId: string) => {
    setSelectedDatasetId(datasetId);
    if (datasetId) {
      loadDatasetById(datasetId);
    }
  };

  // 文件上传完成
  const handleFileUpload = (fileData: UploadResponse) => {
    setUploadedFile(fileData);
    setAllColumns(fileData.columns);
    autoDetectColumns(fileData.columns);
  };

  // 自动检测列类型
  const autoDetectColumns = (cols: string[]) => {
    const compositionCols: string[] = [];
    const processingCols: string[] = [];  // 改为数组，支持多选
    const targetCols: string[] = [];

    cols.forEach(col => {
      const lower = col.toLowerCase();

      // 检测元素组成列（含 wt% 或 at%）
      if (lower.includes('wt%') || lower.includes('at%')) {
        compositionCols.push(col);
      }
      // 检测工艺列（支持多个）
      else if (lower.includes('processing') || lower.includes('treatment') || lower.includes('description')) {
        processingCols.push(col);
      }
      // 检测目标列（含单位）
      else if (col.includes('(') && col.includes(')')) {
        const units = ['MPa', 'GPa', '%', 'HV', 'HRC', 'HB', 'J', 'K'];
        if (units.some(u => col.includes(u)) && !lower.includes('wt%') && !lower.includes('at%')) {
          targetCols.push(col);
        }
      }
    });

    // 默认选择 UTS(MPa) 和 El(%)，如果不存在则选择前2个目标列
    const preferredTargets = ['UTS(MPa)', 'El(%)'];
    const defaultTargets: string[] = [];

    // 优先选择偏好的目标列
    preferredTargets.forEach(preferred => {
      const found = targetCols.find(col => col === preferred);
      if (found) {
        defaultTargets.push(found);
      }
    });

    // 如果偏好的目标列不足2个，补充其他目标列
    if (defaultTargets.length < 2) {
      targetCols.forEach(col => {
        if (!defaultTargets.includes(col) && defaultTargets.length < 2) {
          defaultTargets.push(col);
        }
      });
    }

    setSettings(prev => ({
      ...prev,
      compositionColumns: compositionCols,
      processingColumn: processingCols,  // 使用数组
      targetColumns: defaultTargets,
    }));
  };

  // 启动预测
  const handleStartPrediction = async () => {
    if (!uploadedFile || !isConfigValid()) {
      setError('配置不完整');
      return;
    }

    try {
      setError(null);
      setIsRunning(true);

      // 根据是否启用迭代预测选择不同的API端点
      const apiEndpoint = settings.enableIteration ? '/api/iterative-prediction/start' : '/api/prediction/start';

      const requestBody = {
        file_id: selectedDatasetId ? undefined : uploadedFile.file_id,
        dataset_id: selectedDatasetId || undefined,
        filename: uploadedFile.filename,
        task_note: taskNote || undefined, // 任务备注
        config: {
          composition_column: settings.compositionColumns,  // 发送所有元素列
          processing_column: settings.processingColumn,
          target_columns: settings.targetColumns,
          feature_columns: settings.featureColumns.length > 0 ? settings.featureColumns : undefined, // 特征列（可选）
          train_ratio: settings.trainRatio, // 使用用户设置的训练集比例
          random_seed: settings.randomSeed, // 随机种子
          max_retrieved_samples: settings.maxRetrievedSamples,
          similarity_threshold: settings.similarityThreshold,
          model_provider: settings.modelProvider,
          model_name: settings.modelName,
          temperature: settings.temperature,
          sample_size: settings.sampleSize, // 测试样本数量
          workers: settings.workers, // 并行工作线程数
          prompt_template: settings.promptTemplate, // 自定义提示词模板
          continue_from_task_id: continueFromTaskId, // 增量预测：继续未完成的任务
          // 迭代预测配置
          ...(settings.enableIteration && {
            enable_iteration: true,
            max_iterations: settings.maxIterations,
            convergence_threshold: settings.convergenceThreshold,
            early_stop: settings.earlyStop,
            max_workers: settings.maxWorkers,
          }),
        },
      };

      const response = await fetch(`http://localhost:8000${apiEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '启动预测失败');
      }

      const data = await response.json();

      setTaskId(data.task_id);
      pollTaskStatus(data.task_id);
    } catch (err: any) {
      setError(err.message || '启动预测失败');
      setIsRunning(false);
    }
  };

  // 轮询任务状态
  const pollTaskStatus = async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await getTaskStatus(id);
        setTaskStatus(status);

        if (status.status === 'completed') {
          clearInterval(interval);
          setIsRunning(false);
          router.push(`/results/${status.result_id}`);
        } else if (status.status === 'failed') {
          clearInterval(interval);
          setError(status.error || '预测失败');
          setIsRunning(false);
        }
      } catch (err: any) {
        console.error('Failed to poll task status:', err);
      }
    }, 2000);
  };

  // 验证配置（工艺列现在是可选的）
  const isConfigValid = () => {
    return (
      settings.compositionColumns.length > 0 &&
      settings.targetColumns.length >= 1 &&  // 支持单目标预测
      settings.targetColumns.length <= 5
    );
  };

  // 切换目标列选择
  const toggleTargetColumn = (col: string) => {
    setSettings(prev => {
      const isSelected = prev.targetColumns.includes(col);
      if (isSelected) {
        return { ...prev, targetColumns: prev.targetColumns.filter(c => c !== col) };
      } else if (prev.targetColumns.length < 5) {
        return { ...prev, targetColumns: [...prev.targetColumns, col] };
      }
      return prev;
    });
  };

  // 获取可选的目标列（排除组成列和工艺列）
  const getAvailableTargetColumns = () => {
    return allColumns.filter(col => {
      const lower = col.toLowerCase();
      // 排除组成列和工艺列
      if (settings.compositionColumns.includes(col)) return false;
      if (Array.isArray(settings.processingColumn) && settings.processingColumn.includes(col)) return false;
      if (lower.includes('wt%') || lower.includes('at%')) return false;
      if (lower.includes('processing') || lower.includes('description')) return false;
      // 只保留看起来像数值列的（含括号或单位）
      return true;
    });
  };

  // 配置标签页定义
  const configTabs = [
    { id: 'elements' as ConfigTab, label: '📊 元素选择', icon: '📊' },
    { id: 'processing' as ConfigTab, label: '🔧 工艺参数', icon: '🔧' },
    { id: 'targets' as ConfigTab, label: '🎯 目标属性', icon: '🎯' },
    { id: 'features' as ConfigTab, label: '⚙️ 特征选择', icon: '⚙️' },
    { id: 'split' as ConfigTab, label: '✂️ 数据集划分', icon: '✂️' },
    { id: 'rag' as ConfigTab, label: '🔍 RAG配置', icon: '🔍' },
    { id: 'llm' as ConfigTab, label: '🤖 LLM配置', icon: '🤖' },
    { id: 'iteration' as ConfigTab, label: '🔄 迭代预测', icon: '🔄' },
    { id: 'template' as ConfigTab, label: '📝 提示词模板', icon: '📝' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 任务管理侧边栏（左侧） */}
      <TaskSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentTaskId={taskId || undefined}
      />

      {/* 任务进度管理栏（右侧固定） */}
      <TaskProgressPanel currentTaskId={taskId || undefined} />

      {/* RAG 预览模态框 */}
      <RAGPreviewModal
        isOpen={showRAGPreview}
        onClose={() => setShowRAGPreview(false)}
        datasetId={selectedDatasetId}
        fileId={uploadedFile?.file_id}
        compositionColumns={settings.compositionColumns}
        processingColumn={settings.processingColumn}
        targetColumns={settings.targetColumns}
        trainRatio={settings.trainRatio}
        randomSeed={settings.randomSeed}
        maxRetrievedSamples={settings.maxRetrievedSamples}
        similarityThreshold={settings.similarityThreshold}
        onParamsChange={(params) => {
          setSettings(prev => ({
            ...prev,
            maxRetrievedSamples: params.maxRetrievedSamples,
            similarityThreshold: params.similarityThreshold,
          }));
        }}
      />

      {/* 顶部导航 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* 任务管理按钮 */}
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="任务管理"
              >
                <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">多目标优化预测系统</h1>
                <p className="text-sm text-gray-500 mt-1">支持失败组分重新预测的材料性能预测平台</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // 清空所有配置状态，重置为默认值
                  setContinueFromTaskId(null);
                  setUploadedFile(null);
                  setAllColumns([]);
                  setUseExistingDataset(false);
                  setSelectedDatasetId('');
                  setTaskNote('');
                  setSettings({
                    compositionColumns: [],
                    processingColumn: [],
                    targetColumns: [],
                    featureColumns: [],
                    maxRetrievedSamples: 50,
                    similarityThreshold: 0.3,
                    trainRatio: 0.8,
                    randomSeed: 42,
                    modelProvider: 'deepseek',
                    modelName: 'deepseek-chat',
                    temperature: 0,
                    sampleSize: 10,
                    workers: 5,
                    promptTemplate: null,
                    enableIteration: false,
                    maxIterations: 5,
                    convergenceThreshold: 0.01,
                    earlyStop: true,
                    maxWorkers: 5,
                  });
                  setActiveTab('elements');
                  // 清空 localStorage 中可能存在的配置
                  localStorage.removeItem('predictionConfig');
                  // 清空 URL 参数
                  router.push('/prediction', undefined, { shallow: true });
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                title="清空所有配置，开始新的预测任务"
              >
                🔮 新任务预测
              </button>
              <button
                onClick={() => router.push('/tasks')}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                📋 任务列表
              </button>
              <button
                onClick={() => router.push('/task-comparison')}
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200"
                title="对比多个任务的预测结果"
              >
                📊 任务对比
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 pr-84">
        {/* 文件上传区 */}
        {!uploadedFile ? (
          <div className="space-y-6">
            {/* 数据集选择器 */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">选择数据源</h3>
                <button
                  onClick={() => router.push('/datasets')}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  管理数据集 →
                </button>
              </div>

              <div className="space-y-4">
                {/* 选项1：上传新文件 */}
                <div className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                  !useExistingDataset ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setUseExistingDataset(false)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={!useExistingDataset}
                      onChange={() => setUseExistingDataset(false)}
                      className="w-4 h-4"
                    />
                    <div>
                      <h4 className="font-medium text-gray-900">上传新文件</h4>
                      <p className="text-sm text-gray-500">从本地上传 CSV 文件</p>
                    </div>
                  </div>
                </div>

                {/* 选项2：使用已有数据集 */}
                <div className={`border-2 rounded-lg p-4 cursor-pointer transition-colors ${
                  useExistingDataset ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => setUseExistingDataset(true)}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={useExistingDataset}
                      onChange={() => setUseExistingDataset(true)}
                      className="w-4 h-4"
                    />
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-900">使用已有数据集</h4>
                      <p className="text-sm text-gray-500">从已上传的数据集中选择</p>
                    </div>
                  </div>

                  {useExistingDataset && (
                    <div className="mt-3 ml-7">
                      <select
                        value={selectedDatasetId}
                        onChange={(e) => handleDatasetSelect(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        <option value="">-- 选择数据集 --</option>
                        {availableDatasets.map((ds) => (
                          <option key={ds.dataset_id} value={ds.dataset_id}>
                            {ds.original_filename} ({ds.row_count} 行, {ds.column_count} 列)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 文件上传组件（仅在选择上传新文件时显示） */}
            {!useExistingDataset && (
              <div className="bg-white rounded-xl shadow-sm border p-8">
                <FileUpload onUploadComplete={handleFileUpload} />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* 已上传文件信息 */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📄</span>
                  <div>
                    <h3 className="font-semibold text-blue-900">{uploadedFile.filename}</h3>
                    <p className="text-sm text-blue-700">
                      {uploadedFile.row_count} 行 · {allColumns.length} 列
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setUploadedFile(null);
                    setAllColumns([]);
                  }}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  更换文件
                </button>
              </div>
            </div>

            {/* 任务备注 */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">📝 任务备注</h3>
              <p className="text-sm text-gray-500 mb-3">添加备注以便识别和管理任务（可选）</p>
              <input
                type="text"
                value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
                placeholder="例如：测试铝合金强度优化，目标 UTS > 500 MPa"
                maxLength={200}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">{taskNote.length}/200 字符</p>
            </div>

            {/* 配置标签页 */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {/* 标签导航 */}
              <div className="border-b border-gray-200">
                <nav className="flex">
                  {configTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 py-4 px-4 text-center text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {/* 标签内容 */}
              <div className="p-6">
                {renderTabContent()}
              </div>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800">❌ {error}</p>
              </div>
            )}

            {/* 任务备注 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">📝 任务备注（可选）</h3>
              <textarea
                value={taskNote}
                onChange={(e) => setTaskNote(e.target.value)}
                placeholder="为这个预测任务添加备注，例如：实验目的、数据来源、特殊说明等..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={3}
                maxLength={500}
              />
              <p className="text-sm text-gray-500 mt-2">
                {taskNote.length}/500 字符
              </p>
            </div>

            {/* 开始预测按钮 */}
            <div className="flex justify-end gap-4">
              <button
                onClick={handleStartPrediction}
                disabled={!isConfigValid() || isRunning}
                className={`px-6 py-3 rounded-lg font-medium ${
                  isConfigValid() && !isRunning
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isRunning ? '⏳ 预测中...' : '🚀 开始预测'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );

  // 渲染标签页内容
  function renderTabContent() {
    switch (activeTab) {
      case 'elements':
        const elementColumns = allColumns.filter(col => {
          const lower = col.toLowerCase();
          return lower.includes('wt%') || lower.includes('at%') || lower.includes('composition');
        });

        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">选择元素组成列</h3>
            <p className="text-sm text-gray-500 mb-4">选择包含元素含量（wt% 或 at%）的列</p>

            {/* 全选/取消全选按钮 */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setSettings(prev => ({ ...prev, compositionColumns: elementColumns }))}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                全选
              </button>
              <button
                onClick={() => setSettings(prev => ({ ...prev, compositionColumns: [] }))}
                className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                取消全选
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3">
              {elementColumns.map((col) => (
                <label key={col} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.compositionColumns.includes(col)}
                    onChange={() => {
                      setSettings(prev => ({
                        ...prev,
                        compositionColumns: prev.compositionColumns.includes(col)
                          ? prev.compositionColumns.filter(c => c !== col)
                          : [...prev.compositionColumns, col]
                      }));
                    }}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm">{col}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-blue-600 mt-3">✓ 已选择 {settings.compositionColumns.length} 个元素列</p>
          </div>
        );

      case 'processing':
        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              选择工艺描述列 <span className="text-sm text-gray-500 font-normal">（可选）</span>
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              选择包含热处理或加工工艺描述的列。如果数据集中没有工艺列，可以不选择。
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3">
              {allColumns.map((col) => (
                <label key={col} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Array.isArray(settings.processingColumn) && settings.processingColumn.includes(col)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSettings(prev => ({
                          ...prev,
                          processingColumn: Array.isArray(prev.processingColumn) ? [...prev.processingColumn, col] : [col]
                        }));
                      } else {
                        setSettings(prev => ({
                          ...prev,
                          processingColumn: Array.isArray(prev.processingColumn) ? prev.processingColumn.filter(c => c !== col) : []
                        }));
                      }
                    }}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm">{col}</span>
                  {(col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment')) && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">推荐</span>
                  )}
                </label>
              ))}
            </div>
            {Array.isArray(settings.processingColumn) && settings.processingColumn.length > 0 ? (
              <>
                <p className="text-sm text-green-600 mt-3">✓ 已选择 {settings.processingColumn.length} 个工艺列:</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {settings.processingColumn.map(col => (
                    <span key={col} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      {col}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setSettings(prev => ({ ...prev, processingColumn: [] }))}
                  className="mt-2 text-sm text-red-600 hover:text-red-800"
                >
                  清空所有
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 mt-3">ℹ️ 未选择工艺列，提示词中将不包含工艺相关内容</p>
            )}
          </div>
        );

      case 'targets':
        const availableTargetCols = getAvailableTargetColumns();

        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">选择目标属性列</h3>
            <p className="text-sm text-gray-500 mb-4">选择 1-5 个需要预测的性质列（支持单目标和多目标预测）</p>

            {/* 全选/取消全选按钮 */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setSettings(prev => ({
                  ...prev,
                  targetColumns: availableTargetCols.slice(0, 5) // 最多选5个
                }))}
                className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                全选（最多5个）
              </button>
              <button
                onClick={() => setSettings(prev => ({ ...prev, targetColumns: [] }))}
                className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                取消全选
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3">
              {availableTargetCols.map((col) => (
                <label key={col} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.targetColumns.includes(col)}
                    onChange={() => toggleTargetColumn(col)}
                    disabled={!settings.targetColumns.includes(col) && settings.targetColumns.length >= 5}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="text-sm">{col}</span>
                </label>
              ))}
            </div>
            <p className={`text-sm mt-3 ${settings.targetColumns.length >= 1 ? 'text-green-600' : 'text-orange-600'}`}>
              已选择 {settings.targetColumns.length}/5 个目标列 {settings.targetColumns.length === 0 && '(至少需要1个)'}
            </p>
          </div>
        );

      case 'features':
        // 获取可用的特征列（排除已选择的组分列、工艺列和目标列）
        const getAvailableFeatureColumns = () => {
          const excludedColumns = [
            ...settings.compositionColumns,
            ...(Array.isArray(settings.processingColumn) ? settings.processingColumn : []),
            ...settings.targetColumns
          ].filter(Boolean);

          return allColumns.filter(col => !excludedColumns.includes(col));
        };

        const toggleFeatureColumn = (col: string) => {
          setSettings(prev => {
            const currentFeatures = prev.featureColumns || [];
            return {
              ...prev,
              featureColumns: currentFeatures.includes(col)
                ? currentFeatures.filter(c => c !== col)
                : [...currentFeatures, col]
            };
          });
        };

        const availableFeatureCols = getAvailableFeatureColumns();

        return (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">选择特征列</h3>
            <p className="text-sm text-gray-500 mb-4">
              选择用于 RAG 检索的额外特征列（可选）。默认情况下，系统使用组分和工艺参数进行检索。
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800">
                💡 提示：特征列可以包含任何有助于样本匹配的数值或分类特征，如温度、压力、时间等工艺参数。
              </p>
            </div>

            {/* 全选/取消全选按钮 */}
            {availableFeatureCols.length > 0 && (
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setSettings(prev => ({ ...prev, featureColumns: availableFeatureCols }))}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  全选
                </button>
                <button
                  onClick={() => setSettings(prev => ({ ...prev, featureColumns: [] }))}
                  className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  取消全选
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3">
              {availableFeatureCols.length === 0 ? (
                <p className="text-sm text-gray-500 italic">
                  没有可用的特征列（所有列已被用作组分、工艺或目标列）
                </p>
              ) : (
                availableFeatureCols.map((col) => (
                  <label key={col} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.featureColumns?.includes(col) || false}
                      onChange={() => toggleFeatureColumn(col)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm">{col}</span>
                  </label>
                ))
              )}
            </div>
            <p className="text-sm mt-3 text-gray-600">
              已选择 {settings.featureColumns?.length || 0} 个特征列
            </p>
          </div>
        );

      case 'rag':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">RAG 检索配置</h3>
              <p className="text-sm text-gray-500 mb-4">配置相似样本检索参数</p>
            </div>
            {/* 统计提示：展示数据集规模与检索比例 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-2">
              <p className="text-sm text-gray-700">
                当前数据集共 {uploadedFile?.row_count || 0} 个样本
              </p>
              <p className="text-sm text-gray-700 mt-1">
                训练集：{Math.floor((uploadedFile?.row_count || 0) * settings.trainRatio)} 个样本（{(settings.trainRatio * 100).toFixed(0)}%）
              </p>
              <p className="text-sm text-gray-700 mt-1">
                测试集：{(uploadedFile?.row_count || 0) - Math.floor((uploadedFile?.row_count || 0) * settings.trainRatio)} 个样本
              </p>
              <p className="text-sm text-gray-700 mt-1">
                检索样本数：{settings.maxRetrievedSamples} 个（占训练集 {(() => {
                  const total = uploadedFile?.row_count || 0;
                  const trainCount = Math.floor(total * settings.trainRatio);
                  return trainCount > 0 ? ((settings.maxRetrievedSamples / trainCount) * 100).toFixed(2) : '0.00';
                })()}%）
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">检索样本数量</label>
              <div className="flex items-center space-x-4">
                {/* 直接输入数量 */}
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min={0}
                    value={settings.maxRetrievedSamples ?? ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        setSettings(prev => ({ ...prev, maxRetrievedSamples: 0 }));
                      } else {
                        const numValue = parseInt(value);
                        if (!isNaN(numValue) && numValue >= 0) {
                          setSettings(prev => ({ ...prev, maxRetrievedSamples: numValue }));
                        }
                      }
                    }}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="数量"
                  />
                  <span className="text-sm text-gray-600">个样本</span>
                </div>

                <span className="text-gray-400">或</span>

                {/* 比例输入 - 双向同步 */}
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={
                      retrievalRatioInput !== ''
                        ? retrievalRatioInput
                        : (() => {
                            const datasetRowCount = uploadedFile?.row_count || 0;
                            const trainRatio = settings.trainRatio;
                            const trainCount = Math.floor(datasetRowCount * trainRatio);
                            return trainCount > 0
                              ? ((settings.maxRetrievedSamples || 0) / trainCount).toFixed(3)
                              : '';
                          })()
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setRetrievalRatioInput(value);
                    }}
                    onFocus={(e) => {
                      // 获取焦点时，选中所有文本
                      e.target.select();
                      // 如果当前显示的是计算值，设置为输入状态
                      if (retrievalRatioInput === '') {
                        const datasetRowCount = uploadedFile?.row_count || 0;
                        const trainRatio = settings.trainRatio;
                        const trainCount = Math.floor(datasetRowCount * trainRatio);
                        if (trainCount > 0) {
                          const currentRatio = ((settings.maxRetrievedSamples || 0) / trainCount).toFixed(3);
                          setRetrievalRatioInput(currentRatio);
                        }
                      }
                    }}
                    onBlur={() => {
                      // 失去焦点时，计算并更新样本数
                      const value = retrievalRatioInput;
                      if (value === '') {
                        return; // 如果为空，不做任何操作
                      }
                      const ratio = parseFloat(value);
                      const datasetRowCount = uploadedFile?.row_count || 0;
                      const trainRatio = settings.trainRatio;
                      const trainCount = Math.floor(datasetRowCount * trainRatio);
                      if (!isNaN(ratio) && ratio >= 0 && trainCount > 0) {
                        // 允许超过 1 的比例
                        const calculated = Math.round(ratio * trainCount);
                        setSettings(prev => ({ ...prev, maxRetrievedSamples: calculated >= 0 ? calculated : 0 }));
                      }
                      // 清空输入框，恢复显示计算值
                      setRetrievalRatioInput('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur(); // 触发 onBlur 事件
                      }
                    }}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                    placeholder="0.000"
                    disabled={(() => {
                      const datasetRowCount = uploadedFile?.row_count || 0;
                      const trainRatio = settings.trainRatio;
                      const trainCount = Math.floor(datasetRowCount * trainRatio);
                      return trainCount === 0;
                    })()}
                    title={(() => {
                      const datasetRowCount = uploadedFile?.row_count || 0;
                      const trainRatio = settings.trainRatio;
                      const trainCount = Math.floor(datasetRowCount * trainRatio);
                      return trainCount === 0 ? "请先上传数据集" : "";
                    })()}
                  />
                  <span className="text-sm text-gray-600">比例 (0-1)</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                💡 可直接输入数量（如50）或比例（如0.8表示80%）。两个输入框自动同步，修改任一字段即可。
              </p>
              {settings.maxRetrievedSamples === 0 && (
                <div className="mt-2 text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded p-2">
                  🔮 零样本模式：设置为 0 时，系统将使用零样本提示词模板，不检索参考样本，完全依赖 LLM 的知识进行预测
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">相似度阈值</label>
              <input
                type="number"
                min={0.1}
                max={0.9}
                step={0.1}
                value={settings.similarityThreshold || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setSettings(prev => ({ ...prev, similarityThreshold: 0 }));
                  } else {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                      setSettings(prev => ({ ...prev, similarityThreshold: numValue }));
                    }
                  }
                }}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">范围: 0.1-0.9，推荐值: 0.3</p>
            </div>

            {/* RAG 预览按钮 */}
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={() => setShowRAGPreview(true)}
                disabled={!isConfigValid()}
                className={`px-6 py-3 rounded-lg font-medium flex items-center gap-2 ${
                  isConfigValid()
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                <span>🔍</span>
                <span>预览 RAG 检索效果</span>
              </button>
              <p className="text-xs text-gray-500 mt-2">
                在正式预测前，查看 RAG 检索到的相似样本，帮助您调整参数
              </p>
            </div>
          </div>
        );

      case 'llm':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">LLM 模型配置</h3>
              <p className="text-sm text-gray-500 mb-4">选择大语言模型并配置参数</p>
            </div>

            {/* 模型选择 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">选择模型</label>
              <div className="space-y-3">
                {availableModels.map((model) => (
                  <div
                    key={model.id}
                    onClick={() => setSettings(prev => ({
                      ...prev,
                      modelName: model.id,
                      modelProvider: model.provider,
                      temperature: model.default_temperature,
                    }))}
                    className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                      settings.modelName === model.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          checked={settings.modelName === model.id}
                          onChange={() => {}}
                          className="w-4 h-4 text-blue-600"
                        />
                        <div>
                          <h4 className="font-semibold text-gray-900">{model.name}</h4>
                          <p className="text-sm text-gray-600 mt-1">{model.description}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            提供商: {model.provider} | 模型: {model.model}
                          </p>
                        </div>
                      </div>
                      {settings.modelName === model.id && (
                        <span className="text-blue-600 font-medium text-sm">✓ 已选择</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {availableModels.length === 0 && (
                <p className="text-sm text-gray-500 italic">加载模型列表中...</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Temperature</label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={settings.temperature ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setSettings(prev => ({ ...prev, temperature: 0 }));
                  } else {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                      setSettings(prev => ({ ...prev, temperature: numValue }));
                    }
                  }
                }}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">温度参数（0-2）：0 表示完全确定性输出，2 表示高随机性输出</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                测试样本数量 (Sample Size)
              </label>
              <input
                type="number"
                min={1}
                value={settings.sampleSize || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '') {
                    setSettings(prev => ({ ...prev, sampleSize: 0 }));
                  } else {
                    const numValue = parseInt(value);
                    if (!isNaN(numValue) && numValue >= 1) {
                      setSettings(prev => ({ ...prev, sampleSize: numValue }));
                    }
                  }
                }}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                从测试集中随机抽取的样本数量（无上限限制），推荐值: 10
              </p>
              <div className="mt-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                ⚠️ 注意：样本数越多，预测时间越长，API 调用成本越高
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                并行工作线程数 (Workers)
              </label>
              <input
                type="number"
                min={1}
                value={settings.workers}
                onChange={(e) => setSettings(prev => ({ ...prev, workers: parseInt(e.target.value) || 5 }))}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2"
              />
              <p className="text-xs text-gray-500 mt-1">
                并行预测的线程数（无上限限制），推荐值: 5
              </p>
              <div className="mt-2 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                💡 提示：增加线程数可以加快预测速度，但会增加 API 并发请求数
              </div>
            </div>
          </div>
        );

      case 'split':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">数据集划分与导出</h3>
              <p className="text-sm text-gray-500 mb-4">
                预览训练集和测试集的划分结果，并导出为独立的 CSV 文件
              </p>
            </div>

            <DatasetSplitPanel
              fileId={uploadedFile?.file_id}
              datasetId={selectedDatasetId || undefined}
              trainRatio={settings.trainRatio}
              randomSeed={settings.randomSeed}
              onTrainRatioChange={(ratio) => setSettings(prev => ({ ...prev, trainRatio: ratio }))}
              onRandomSeedChange={(seed) => setSettings(prev => ({ ...prev, randomSeed: seed }))}
              onTrainCountChange={(count) => setTrainSampleCount(count)}
            />
          </div>
        );

      case 'iteration':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">迭代预测配置</h3>
              <p className="text-sm text-gray-500 mb-4">
                启用迭代预测功能，通过多轮预测逐步优化结果直至收敛
              </p>
            </div>

            {/* 启用迭代预测开关 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableIteration}
                  onChange={(e) => setSettings(prev => ({ ...prev, enableIteration: e.target.checked }))}
                  className="w-5 h-5 text-blue-600 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-900">启用迭代预测</span>
                  <p className="text-xs text-gray-600 mt-1">
                    开启后，系统将进行多轮预测，每轮使用上一轮的结果作为参考，直至收敛或达到最大迭代次数
                  </p>
                </div>
              </label>
            </div>

            {settings.enableIteration && (
              <>
                {/* 最大迭代次数 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    最大迭代次数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={settings.maxIterations}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value >= 1 && value <= 10) {
                        setSettings(prev => ({ ...prev, maxIterations: value }));
                      }
                    }}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    范围: 1-10，推荐值: 5。迭代次数越多，预测越精确但耗时越长
                  </p>
                </div>

                {/* 收敛阈值 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    收敛阈值
                  </label>
                  <input
                    type="number"
                    min={0.001}
                    max={0.1}
                    step={0.001}
                    value={settings.convergenceThreshold}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      if (!isNaN(value) && value >= 0.001 && value <= 0.1) {
                        setSettings(prev => ({ ...prev, convergenceThreshold: value }));
                      }
                    }}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    范围: 0.001-0.1，推荐值: 0.01。当相邻两轮预测值的相对变化率小于此阈值时，认为已收敛
                  </p>
                </div>

                {/* 提前停止 */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.earlyStop}
                      onChange={(e) => setSettings(prev => ({ ...prev, earlyStop: e.target.checked }))}
                      className="w-5 h-5 text-blue-600 rounded"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-900">启用提前停止</span>
                      <p className="text-xs text-gray-600 mt-1">
                        当收敛样本数达到80%时自动停止迭代，节省时间和成本
                      </p>
                    </div>
                  </label>
                </div>

                {/* 并行工作线程数 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    并行工作线程数
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.maxWorkers}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (!isNaN(value) && value >= 1 && value <= 20) {
                        setSettings(prev => ({ ...prev, maxWorkers: value }));
                      }
                    }}
                    className="w-32 border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    范围: 1-20，推荐值: 5。增加线程数可加快预测速度，但会增加API并发请求数
                  </p>
                </div>

                {/* 预估信息 */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-amber-900 mb-2">⚠️ 预估信息</h4>
                  <div className="text-xs text-amber-800 space-y-1">
                    <p>• 测试样本数: {(uploadedFile?.row_count || 0) - Math.floor((uploadedFile?.row_count || 0) * settings.trainRatio)} 个</p>
                    <p>• 最大迭代次数: {settings.maxIterations} 轮</p>
                    <p>• 预估最大API调用次数: {((uploadedFile?.row_count || 0) - Math.floor((uploadedFile?.row_count || 0) * settings.trainRatio)) * settings.maxIterations} 次</p>
                    <p>• 预估耗时: {Math.ceil(((uploadedFile?.row_count || 0) - Math.floor((uploadedFile?.row_count || 0) * settings.trainRatio)) * settings.maxIterations / settings.maxWorkers)} 秒（假设每次调用1秒）</p>
                  </div>
                </div>
              </>
            )}
          </div>
        );

      case 'template':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">提示词模板自定义</h3>
              <p className="text-sm text-gray-500 mb-4">
                自定义 LLM 提示词模板，控制预测任务的指令格式和输出要求
              </p>
            </div>

            <PromptTemplateEditor
              onTemplateSelect={(template) => {
                setSettings(prev => ({ ...prev, promptTemplate: template }));
              }}
            />

            {settings.promptTemplate && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  ✅ 当前使用自定义模板：<strong>{settings.promptTemplate.template_name}</strong>
                </p>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  }
}
