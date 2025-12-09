import React, { useState, useEffect } from 'react';
import {
  EXAMPLE_SUPERALLOY_REFERENCES,
  getExampleTestSample,
  getExampleCompositionColumns
} from '../constants/exampleData';

interface PromptTemplate {
  template_id?: string;
  template_name: string;
  template_type: 'unified';  // 仅支持统一格式
  description: string;
  system_role: string;
  task_description: string;
  input_format: string;
  output_format: string;
  reference_format: string;
  analysis_protocol: string;
  predictions_json_template?: string;
  column_name_mapping?: Record<string, string>;  // 列名映射配置
  apply_mapping_to_target?: boolean;  // 是否对 Target Material 应用列名映射
  created_at?: string;  // ISO 8601 格式时间戳
  updated_at?: string;  // ISO 8601 格式时间戳
}

interface PromptTemplateEditorProps {
  onTemplateSelect?: (template: PromptTemplate | null) => void;
}

const PromptTemplateEditor: React.FC<PromptTemplateEditorProps> = ({ onTemplateSelect }) => {
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [currentTemplate, setCurrentTemplate] = useState<PromptTemplate>({
    template_name: '',
    template_type: 'unified',
    description: '',
    system_role: '',
    task_description: 'Predict {target_properties_list} for the target material using systematic analysis.',
    input_format: '**Target Material**:\n{test_sample}',
    output_format: `Provide your systematic analysis and end with EXACTLY this JSON format:

{
  "predictions": {
    {predictions_json_template}
  },
  "confidence": "<high/medium/low>",
  "reasoning": "<your_analysis_summary>"
}`,
    reference_format: '**Reference Samples**:\n\nEach sample shows values for all target properties.\n\n{reference_samples}',
    analysis_protocol: `**Required Analysis Protocol**:

1. **Reference-Driven Baseline Establishment**:
   - **Classification**: First, classify the general family of all materials involved (references and target).
   - **Primary Baseline Selection**: From the provided \`Reference Samples\`, identify the single sample that is the **most analogous** to the \`Target Material\`. This sample and its \`Known True Values\` will serve as your **primary baseline**. Justify your choice.
   - **Sanity Check (Optional but Recommended)**: Use your general knowledge of standard materials as a secondary check.

2. **Plausibility Assessment**:
   - Assess the expected range for each target property based on your selected **primary baseline sample**.
   - Consider the relationships between properties when applicable (e.g., strength-ductility trade-offs).

3. **Interpolative Correction & Justification**:
   - Formulate corrected values for each property.
   - Your reasoning must be an **interpolation or extrapolation** from the primary baseline. Quantify how the **differences in characteristics** between the target and the baseline sample translate into specific property adjustments.
   - Use fundamental materials principles to support *why* these differences lead to your calculated adjustments.`,
    predictions_json_template: '',
    column_name_mapping: {
      'Processing': 'Heat treatment method',
      'Composition': 'Composition'
    },
    apply_mapping_to_target: true,
  });
  const [isEditing, setIsEditing] = useState(true);  // 默认展开编辑状态
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');

  // 新增：数据集和样本选择相关状态
  const [datasets, setDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [selectedDataset, setSelectedDataset] = useState<any>(null);
  const [testSampleIndex, setTestSampleIndex] = useState<number>(0);
  const [useRealData, setUseRealData] = useState<boolean>(true); // 默认使用真实数据预览

  // 新增：特征列选择状态
  const [selectedFeatureColumns, setSelectedFeatureColumns] = useState<string[]>([]);

  // 新增：列选择状态追踪（用于列名映射自动提取）
  const [compositionColumns, setCompositionColumns] = useState<string[]>([]);
  const [processingColumn, setProcessingColumn] = useState<string[]>([]);
  const [targetColumns, setTargetColumns] = useState<string[]>([]);

  // 从全局配置加载列选择（从 localStorage 或 prediction.tsx 传递的配置）
  const [globalColumnConfig, setGlobalColumnConfig] = useState<{
    datasetId: string;
    fileId: string;
    datasetName: string;
    rowCount: number;
    columnCount: number;
    compositionColumns: string[];
    processingColumn: string[];
    targetColumns: string[];
    featureColumns: string[];
  } | null>(null);

  // 从 localStorage 加载全局列配置（prediction.tsx 保存的配置）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedConfig = localStorage.getItem('predictionConfig');
        if (savedConfig) {
          const config = JSON.parse(savedConfig);
          setGlobalColumnConfig({
            datasetId: config.datasetId || '',
            fileId: config.fileId || '',
            datasetName: config.datasetName || '',
            rowCount: config.rowCount || 0,
            columnCount: config.columnCount || 0,
            compositionColumns: config.compositionColumns || [],
            processingColumn: config.processingColumn || [],
            targetColumns: config.targetColumns || [],
            featureColumns: config.featureColumns || [],
          });
          console.log('✓ 从 localStorage 加载全局列配置:', config);
        }
      } catch (error) {
        console.error('加载全局列配置失败:', error);
      }
    }
  }, []);

  // 自动更新列名映射配置（当用户选择列时）
  // 这个 useEffect 会在以下情况触发：
  // 1. 数据集变化时
  // 2. 特征列选择变化时
  // 3. 组分列、工艺列、目标列变化时
  useEffect(() => {
    if (!selectedDataset) return;

    // 初始化映射对象（保留用户已有的自定义映射）
    const newMapping: Record<string, string> = { ...currentTemplate.column_name_mapping };
    let hasChanges = false;

    // 1. 自动检测并设置元素列
    const detectedCompCols = selectedDataset.columns.filter((col: string) =>
      col.includes('at%') || col.includes('wt%')
    );
    if (detectedCompCols.length > 0) {
      setCompositionColumns(detectedCompCols);
      // 元素列汇总为一个 "Composition" 键
      if (!newMapping['Composition']) {
        newMapping['Composition'] = 'Composition';
        hasChanges = true;
      }
    }

    // 2. 自动检测并设置工艺列
    const detectedProcCols = selectedDataset.columns.filter((col: string) =>
      col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment')
    );
    if (detectedProcCols.length > 0) {
      setProcessingColumn(detectedProcCols);
      // 为每个工艺列添加映射（使用实际的列名作为键）
      detectedProcCols.forEach((procCol: string) => {
        if (!newMapping[procCol]) {
          // 默认映射为 "Heat treatment method"
          newMapping[procCol] = 'Heat treatment method';
          hasChanges = true;
        }
      });
    }

    // 3. 自动检测目标属性列（统一格式默认使用多目标）
    const detectedTargetCols = ['UTS(MPa)', 'El(%)'];
    setTargetColumns(detectedTargetCols);
    // 为每个目标属性添加映射（默认映射为自己）
    detectedTargetCols.forEach(col => {
      if (!newMapping[col]) {
        newMapping[col] = col;
        hasChanges = true;
      }
    });

    // 4. 添加特征列映射（每个特征列使用原始列名）
    selectedFeatureColumns.forEach(col => {
      if (!newMapping[col]) {
        newMapping[col] = col;
        hasChanges = true;
      }
    });

    // 只有当映射配置发生变化时才更新
    if (hasChanges) {
      setCurrentTemplate({
        ...currentTemplate,
        column_name_mapping: newMapping
      });
    }
  }, [selectedDataset, selectedFeatureColumns, compositionColumns, processingColumn, targetColumns]);

  // 加载模板列表
  const loadTemplates = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/prompt-templates/');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data);
      }
    } catch (error) {
      console.error('加载模板列表失败:', error);
    }
  };

  useEffect(() => {
    loadTemplates();
    loadDatasets();
  }, []);

  // 加载数据集列表
  const loadDatasets = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/datasets/list?page=1&page_size=100');
      if (response.ok) {
        const data = await response.json();
        setDatasets(data.datasets || []);
      }
    } catch (error) {
      console.error('加载数据集列表失败:', error);
    }
  };

  // 加载选中的数据集详情
  const loadDatasetDetail = async (datasetId: string) => {
    if (!datasetId) {
      setSelectedDataset(null);
      setTestSampleIndex(0);
      setSelectedFeatureColumns([]); // 清空特征列选择
      setCompositionColumns([]); // 清空元素列选择
      setProcessingColumn([]); // 清空工艺列选择
      setTargetColumns([]); // 清空目标属性选择
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedDataset(data);
        setTestSampleIndex(0); // 重置样本索引
        setSelectedFeatureColumns([]); // 清空特征列选择
        // 注意：compositionColumns、processingColumn、targetColumns 会在 useEffect 中自动更新
      }
    } catch (error) {
      console.error('加载数据集详情失败:', error);
    }
  };

  // 加载选中的模板
  const loadTemplate = async (templateId: string) => {
    if (!templateId) {
      setCurrentTemplate({
        template_name: '',
        template_type: 'unified',
        description: '',
        system_role: '',
        task_description: 'Predict {target_properties_list} for the target material using systematic analysis.',
        input_format: '**Target Material**:\n{test_sample}',
        output_format: `Provide your systematic analysis and end with EXACTLY this JSON format:

{
  "predictions": {
    {predictions_json_template}
  },
  "confidence": "<high/medium/low>",
  "reasoning": "<your_analysis_summary>"
}`,
        reference_format: '**Reference Samples**:\n\nEach sample shows values for all target properties.\n\n{reference_samples}',
        analysis_protocol: `**Required Analysis Protocol**:

1. **Reference-Driven Baseline Establishment**:
   - **Classification**: First, classify the general family of all materials involved (references and target).
   - **Primary Baseline Selection**: From the provided \`Reference Samples\`, identify the single sample that is the **most analogous** to the \`Target Material\`. This sample and its \`Known True Values\` will serve as your **primary baseline**. Justify your choice.
   - **Sanity Check (Optional but Recommended)**: Use your general knowledge of standard materials as a secondary check.

2. **Plausibility Assessment**:
   - Assess the expected range for each target property based on your selected **primary baseline sample**.
   - Consider the relationships between properties when applicable (e.g., strength-ductility trade-offs).

3. **Interpolative Correction & Justification**:
   - Formulate corrected values for each property.
   - Your reasoning must be an **interpolation or extrapolation** from the primary baseline. Quantify how the **differences in characteristics** between the target and the baseline sample translate into specific property adjustments.
   - Use fundamental materials principles to support *why* these differences lead to your calculated adjustments.`,
        column_name_mapping: {
          'Processing': 'Heat treatment method',
          'Composition': 'Composition'
        },
        apply_mapping_to_target: true,
      });
      setIsEditing(false);
      if (onTemplateSelect) {
        onTemplateSelect(null);
      }
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/prompt-templates/${templateId}`);
      if (response.ok) {
        const data = await response.json();
        // 确保加载的模板有默认值
        setCurrentTemplate({
          ...data,
          column_name_mapping: data.column_name_mapping || {
            'Processing': 'Heat treatment method',
            'Composition': 'Composition'
          },
          apply_mapping_to_target: data.apply_mapping_to_target ?? true,
        });
        setIsEditing(false);
        if (onTemplateSelect) {
          onTemplateSelect(data);
        }
      }
    } catch (error) {
      console.error('加载模板失败:', error);
    }
  };

  // 生成友好的模板 ID（基于模板名称）
  const generateTemplateId = (templateName: string): string => {
    // 将模板名称转换为 slug 格式
    const slug = templateName
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '_') // 保留中文、字母、数字，其他替换为下划线
      .replace(/^_+|_+$/g, ''); // 去除首尾下划线

    // 添加时间戳避免冲突
    const timestamp = Date.now();
    return `${slug}_${timestamp}`;
  };

  // 保存模板
  const saveTemplate = async () => {
    // 验证必填字段
    const requiredFields = [
      { name: 'template_name', label: '模板名称' },
      { name: 'task_description', label: '任务描述' },
      { name: 'input_format', label: '输入格式' },
      { name: 'output_format', label: '输出格式' },
      { name: 'reference_format', label: '参考样本格式' },
    ];

    for (const field of requiredFields) {
      const value = currentTemplate[field.name as keyof PromptTemplate];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        alert(`请输入${field.label}`);
        return;
      }
    }

    // 确定模板 ID：如果有选中的 ID 则更新，否则创建新模板
    const isNewTemplate = !selectedTemplateId;
    const templateId = selectedTemplateId || generateTemplateId(currentTemplate.template_name);

    try {
      const response = await fetch(`http://localhost:8000/api/prompt-templates/${templateId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentTemplate),
      });

      if (response.ok) {
        alert(isNewTemplate ? '模板创建成功' : '模板更新成功');
        await loadTemplates();
        setSelectedTemplateId(templateId);
        setIsEditing(false);

        // 通知父组件更新模板（重要：保存后需要更新预测配置）
        if (onTemplateSelect) {
          onTemplateSelect(currentTemplate);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(`模板保存失败: ${errorData.detail || '未知错误'}`);
      }
    } catch (error) {
      console.error('保存模板失败:', error);
      alert('模板保存失败');
    }
  };

  // 删除模板
  const deleteTemplate = async () => {
    if (!selectedTemplateId || selectedTemplateId.startsWith('default_')) {
      alert('无法删除默认模板');
      return;
    }

    if (!confirm('确定要删除此模板吗？')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/prompt-templates/${selectedTemplateId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        alert('模板删除成功');
        await loadTemplates();
        setSelectedTemplateId('');
        loadTemplate('');
      } else {
        alert('模板删除失败');
      }
    } catch (error) {
      console.error('删除模板失败:', error);
      alert('模板删除失败');
    }
  };

  // 新建模板
  const createNewTemplate = () => {
    setCurrentTemplate({
      template_name: '',
      template_type: 'unified',
      description: '',
      system_role: '',
      task_description: 'Predict {target_properties_list} for the target material using systematic analysis.',
      input_format: '**Target Material**:\n{test_sample}',
      output_format: `Provide your systematic analysis and end with EXACTLY this JSON format:

{
  "predictions": {
    {predictions_json_template}
  },
  "confidence": "<high/medium/low>",
  "reasoning": "<your_analysis_summary>"
}`,
      reference_format: '**Reference Samples**:\n\nEach sample shows values for all target properties.\n\n{reference_samples}',
      analysis_protocol: `**Required Analysis Protocol**:

1. **Reference-Driven Baseline Establishment**:
   - **Classification**: First, classify the general family of all materials involved (references and target).
   - **Primary Baseline Selection**: From the provided \`Reference Samples\`, identify the single sample that is the **most analogous** to the \`Target Material\`. This sample and its \`Known True Values\` will serve as your **primary baseline**. Justify your choice.
   - **Sanity Check (Optional but Recommended)**: Use your general knowledge of standard materials as a secondary check.

2. **Plausibility Assessment**:
   - Assess the expected range for each target property based on your selected **primary baseline sample**.
   - Consider the relationships between properties when applicable (e.g., strength-ductility trade-offs).

3. **Interpolative Correction & Justification**:
   - Formulate corrected values for each property.
   - Your reasoning must be an **interpolation or extrapolation** from the primary baseline. Quantify how the **differences in characteristics** between the target and the baseline sample translate into specific property adjustments.
   - Use fundamental materials principles to support *why* these differences lead to your calculated adjustments.`,
      predictions_json_template: '',
      column_name_mapping: {
        'Processing': 'Heat treatment method',
        'Composition': 'Composition'
      },
      apply_mapping_to_target: true,
    });
    setSelectedTemplateId(''); // 清空选择，表示创建新模板
    setIsEditing(true);

    // 通知父组件清空模板选择
    if (onTemplateSelect) {
      onTemplateSelect(null);
    }
  };

  // 复制模板
  const duplicateTemplate = () => {
    if (!selectedTemplateId) {
      alert('请先选择要复制的模板');
      return;
    }

    const newTemplate = {
      ...currentTemplate,
      template_name: `${currentTemplate.template_name} (副本)`,
    };

    setCurrentTemplate(newTemplate);
    setSelectedTemplateId(''); // 清空选择，表示创建新模板
    setIsEditing(true);

    // 通知父组件清空模板选择
    if (onTemplateSelect) {
      onTemplateSelect(null);
    }
  };

  // 获取默认 JSON 模板（统一格式）
  const getDefaultJsonTemplate = () => {
    // 统一格式（UNIFIED_PROTOCOL）
    return `"{target_property_1}": {"value": <number>, "unit": "{unit}"},
        "{target_property_2}": {"value": <number>, "unit": "{unit}"}`;
  };

  // 预览模板（使用示例数据或真实数据渲染完整提示词）
  const handlePreview = async () => {
    // 优先使用全局配置
    const configToUse = globalColumnConfig || {
      datasetId: selectedDataset?.dataset_id || '',
      fileId: selectedDataset?.dataset_id || '',
      compositionColumns: compositionColumns || [],
      processingColumn: processingColumn || [],
      targetColumns: targetColumns || [],
      featureColumns: selectedFeatureColumns || [],
    };

    // 调试日志：打印所有相关状态变量
    console.log('预览调试信息:', {
      dataSource: globalColumnConfig ? '全局配置' : '本地数据集',
      datasetId: configToUse.datasetId,
      compositionColumns: configToUse.compositionColumns,
      processingColumn: configToUse.processingColumn,
      targetColumns: configToUse.targetColumns,
      featureColumns: configToUse.featureColumns,
      useRealData,
    });

    try {
      let testSample: Record<string, any>;
      let referenceSamples: any[];
      let compositionColumn: string | string[];
      // 使用本地变量名避免与状态变量冲突
      let localProcessingColumn: string[];
      let localTargetColumns: string[];

      // 如果选择使用真实数据且有可用的数据集配置
      if (useRealData && (globalColumnConfig || selectedDataset)) {
        // 使用全局配置或本地状态中的列选择
        const useCompositionColumns = configToUse.compositionColumns.length > 0
          ? configToUse.compositionColumns
          : (selectedDataset?.columns || []).filter((col: string) =>
              col.includes('at%') || col.includes('wt%')
            );
        const useProcessingColumn = configToUse.processingColumn.length > 0
          ? configToUse.processingColumn
          : (selectedDataset?.columns || []).filter((col: string) =>
              col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment')
            );
        const useTargetColumns = configToUse.targetColumns.length > 0
          ? configToUse.targetColumns
          : ['UTS(MPa)', 'El(%)'];  // 统一格式默认使用多目标

        // 使用 RAG 预览 API 获取真实样本数据
        const ragResponse = await fetch('http://localhost:8000/api/prediction/preview-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: configToUse.datasetId,
            composition_column: useCompositionColumns,
            processing_column: useProcessingColumn.length > 0 ? useProcessingColumn : undefined,
            target_columns: useTargetColumns,
            train_ratio: 0.8,
            random_seed: 42,
            max_retrieved_samples: 5,
            similarity_threshold: 0.3,
            test_sample_index: testSampleIndex,
          }),
        });

        if (!ragResponse.ok) {
          throw new Error('加载真实样本数据失败');
        }

        const ragData = await ragResponse.json();
        testSample = ragData.test_sample;
        referenceSamples = ragData.retrieved_samples || [];
        compositionColumn = useCompositionColumns;
        localProcessingColumn = useProcessingColumn;
        localTargetColumns = useTargetColumns;
      } else {
        // 使用示例数据（从常量文件导入）
        localTargetColumns = ['UTS(MPa)', 'El(%)'];  // 统一格式默认使用多目标

        testSample = getExampleTestSample();
        referenceSamples = EXAMPLE_SUPERALLOY_REFERENCES || [];
        compositionColumn = getExampleCompositionColumns();
        // 示例数据中包含工艺列（改为数组）
        localProcessingColumn = ['Processing_Description'];
      }

      // 使用全局配置或本地状态中的特征列
      const featureColumns = configToUse.featureColumns.length > 0 ? configToUse.featureColumns : undefined;

      // 调用后端预览 API
      const requestBody = {
        // 模板字段（展开到顶层）
        ...currentTemplate,
        // 其他请求字段
        test_sample: testSample,
        reference_samples: referenceSamples,
        composition_column: compositionColumn,
        processing_column: localProcessingColumn.length > 0 ? localProcessingColumn : undefined,
        target_columns: localTargetColumns,
        feature_columns: featureColumns
      };

      console.log('预览请求数据:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('http://localhost:8000/api/prompt-templates/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let detail = '预览请求失败';
        const errorText = await response.text();
        console.error('预览API错误响应:', errorText);
        try {
          const errJson = JSON.parse(errorText);
          // 处理 Pydantic 验证错误（detail 可能是对象数组）
          if (errJson.detail) {
            if (Array.isArray(errJson.detail)) {
              // Pydantic 验证错误：提取每个错误的消息
              detail = errJson.detail.map((err: any) => {
                if (typeof err === 'object' && err !== null) {
                  const loc = Array.isArray(err.loc) ? err.loc.join(' -> ') : 'field';
                  const msg = err.msg || JSON.stringify(err);
                  return `${loc}: ${msg}`;
                }
                return String(err);
              }).join('\n');
            } else if (typeof errJson.detail === 'object' && errJson.detail !== null) {
              detail = JSON.stringify(errJson.detail, null, 2);
            } else {
              detail = String(errJson.detail);
            }
          }
        } catch (parseError) {
          console.error('解析错误响应失败:', parseError);
          if (errorText) detail = errorText;
        }
        // 创建一个包含详细信息的错误对象
        const error = new Error(detail);
        (error as any).rawDetail = detail;
        throw error;
      }

      const result = await response.json();

      console.log('预览响应数据:', result);

      // 检查响应数据是否有效
      if (!result || typeof result.rendered_prompt === 'undefined') {
        throw new Error('预览响应数据无效：rendered_prompt 为 undefined');
      }

      // 显示渲染后的完整提示词
      const dataSource = useRealData && selectedDataset
        ? `真实数据：${selectedDataset.filename}，样本索引 ${testSampleIndex}`
        : '示例数据：高温合金组分 + 热处理工艺';

      // 确保换行符正确显示（如果后端返回的是转义的 \n，需要替换为真实换行符）
      const renderedPrompt = (result.rendered_prompt || '（渲染失败）').replace(/\\n/g, '\n');

      const preview = `
=== 渲染后的完整提示词 ===
（使用${dataSource}）

${renderedPrompt}

=== 模板变量 ===
${JSON.stringify(result.template_variables || {}, null, 2)}
      `.trim();

      setPreviewContent(preview);
      setShowPreview(true);
    } catch (error: any) {
      console.error('预览模板失败:', error);
      console.error('错误详情:', {
        message: error.message,
        rawDetail: error.rawDetail,
        stack: error.stack
      });

      // 格式化值的辅助函数
      const formatValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '（未设置）';
        }
        if (Array.isArray(value)) {
          // 处理数组：检查元素类型
          if (value.length === 0) {
            return '[]';
          }
          // 检查数组中的每个元素
          const formattedItems = value.map((item: any) => {
            if (typeof item === 'object' && item !== null) {
              // 如果是 Pydantic 验证错误对象，提取有用信息
              if (item.loc && item.msg) {
                return `${Array.isArray(item.loc) ? item.loc.join(' -> ') : item.loc}: ${item.msg}`;
              }
              return JSON.stringify(item);
            }
            return String(item);
          });
          return formattedItems.join('\n');
        }
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value, null, 2);
        }
        return String(value);
      };

      // 获取错误消息 - 优先使用 rawDetail
      let errorMessage = '未知错误';
      if (error.rawDetail) {
        errorMessage = error.rawDetail;
      } else if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = JSON.stringify(error, null, 2);
      }

      // 如果 API 调用失败，回退到简单预览
      const fallbackPreview = `
=== 预览失败，显示模板结构 ===
错误: ${errorMessage}

=== 系统角色 ===
${formatValue(currentTemplate.system_role)}

=== 任务描述 ===
${formatValue(currentTemplate.task_description)}

=== 参考样本格式 ===
${formatValue(currentTemplate.reference_format)}

=== 输入格式 ===
${formatValue(currentTemplate.input_format)}

=== 输出格式 ===
${formatValue(currentTemplate.output_format)}

=== 分析协议 ===
${formatValue(currentTemplate.analysis_protocol)}
      `.trim();

      setPreviewContent(fallbackPreview);
      setShowPreview(true);
    }
  };

  return (
    <div className="space-y-4">
      {/* 模板选择和操作按钮 */}
      <div className="flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700">选择模板：</label>
        <select
          value={selectedTemplateId}
          onChange={(e) => {
            setSelectedTemplateId(e.target.value);
            loadTemplate(e.target.value);
          }}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
        >
          <option value="">使用默认模板</option>
          {templates.map((template) => (
            <option key={template.template_id} value={template.template_id}>
              {template.template_name}
              {template.updated_at && ` - 更新于 ${new Date(template.updated_at).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}`}
            </option>
          ))}
        </select>
        <button
          onClick={createNewTemplate}
          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 whitespace-nowrap"
          title="创建一个全新的模板"
        >
          ➕ 新建
        </button>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 whitespace-nowrap"
        >
          {isEditing ? '取消编辑' : '编辑模板'}
        </button>
        {selectedTemplateId && (
          <button
            onClick={duplicateTemplate}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 whitespace-nowrap"
            title="复制当前模板创建新模板"
          >
            📋 复制
          </button>
        )}
        {selectedTemplateId && !selectedTemplateId.startsWith('default_') && (
          <button
            onClick={deleteTemplate}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 whitespace-nowrap"
            title="删除当前模板"
          >
            🗑️ 删除
          </button>
        )}
      </div>

      {/* 当前模式提示 */}
      {isEditing && (
        <div className={`px-4 py-2 rounded-lg ${selectedTemplateId ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
          <p className="text-sm font-medium">
            {selectedTemplateId
              ? `📝 编辑模式：正在编辑 "${currentTemplate.template_name}"`
              : `✨ 创建模式：正在创建新模板`}
          </p>
        </div>
      )}

      {/* 模板编辑表单 */}
      {isEditing && (
        <div className="border border-gray-300 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模板名称</label>
              <input
                type="text"
                value={currentTemplate.template_name}
                onChange={(e) => setCurrentTemplate({ ...currentTemplate, template_name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                placeholder="例如：我的自定义模板"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模板类型</label>
              <select
                value={currentTemplate.template_type}
                onChange={(e) => setCurrentTemplate({ ...currentTemplate, template_type: e.target.value as 'unified' })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
                disabled
              >
                <option value="unified">统一格式（UNIFIED_PROTOCOL）</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                所有模板已统一为 FEW-SHOT AUGMENTED CORRECTION PROTOCOL 格式
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">模板描述</label>
            <input
              type="text"
              value={currentTemplate.description}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2"
              placeholder="简要描述此模板的用途"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">系统角色（可选）</label>
            <textarea
              value={currentTemplate.system_role}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, system_role: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={2}
              placeholder="例如：You are a materials science expert..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              任务描述（支持变量：{'{target_property}'}, {'{target_properties_list}'}）
            </label>
            <textarea
              value={currentTemplate.task_description}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, task_description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={2}
              placeholder="例如：Predict {target_property} for the target material..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              参考样本格式（支持变量：{'{reference_samples}'}, {'{num_targets}'}）
            </label>
            <textarea
              value={currentTemplate.reference_format}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, reference_format: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={2}
              placeholder="例如：**Reference Samples**:\n{reference_samples}"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              输入格式（支持变量：{'{test_sample}'}）
            </label>
            <textarea
              value={currentTemplate.input_format}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, input_format: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              输出格式（支持变量：{'{unit}'}, {'{predictions_json_template}'}）
            </label>
            <textarea
              value={currentTemplate.output_format}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, output_format: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={4}
              placeholder="定义 LLM 输出的 JSON 格式"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              自定义预测 JSON 模板（可选）
              <button
                type="button"
                onClick={() => {
                  const defaultTemplate = getDefaultJsonTemplate();
                  setCurrentTemplate({ ...currentTemplate, predictions_json_template: defaultTemplate });
                }}
                className="ml-2 text-xs text-blue-600 hover:text-blue-800"
              >
                使用默认模板
              </button>
            </label>
            <textarea
              value={currentTemplate.predictions_json_template}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, predictions_json_template: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm bg-gray-50"
              rows={8}
              placeholder={`留空使用默认模板。支持变量：\n单目标：{target_property}, {unit}\n多目标：{target_property_1}, {target_property_2}, ...`}
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 此模板将替换输出格式中的 {'{predictions_json_template}'} 变量
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分析协议（可选）</label>
            <textarea
              value={currentTemplate.analysis_protocol}
              onChange={(e) => setCurrentTemplate({ ...currentTemplate, analysis_protocol: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm"
              rows={6}
              placeholder="定义 LLM 的分析步骤和要求"
            />
          </div>

          {/* 列名映射配置 */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                🔑 列名映射配置
                <span className="ml-2 text-xs text-gray-500">（控制提示词中显示的列名，对预测质量至关重要）</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    // 从全局配置或当前数据集选择自动填充映射配置
                    const newMapping: Record<string, string> = { ...currentTemplate.column_name_mapping };

                    // 优先使用全局配置（从 prediction.tsx 保存的配置）
                    const sourceConfig = globalColumnConfig || {
                      compositionColumns: compositionColumns,
                      processingColumn: processingColumn,
                      targetColumns: targetColumns,
                      featureColumns: selectedFeatureColumns,
                    };

                    console.log('📥 自动填充列名映射，数据源:', globalColumnConfig ? '全局配置' : '当前数据集', sourceConfig);

                    // 添加 Composition 映射（组分列的统一显示名）
                    if (sourceConfig.compositionColumns.length > 0 && !newMapping['Composition']) {
                      newMapping['Composition'] = 'Composition';
                    }

                    // 添加工艺列映射（仅 Processing_Description 映射为 "Heat treatment method"，其他工艺列保持原名）
                    sourceConfig.processingColumn.forEach(col => {
                      if (!newMapping[col]) {
                        if (col === 'Processing_Description') {
                          newMapping[col] = 'Heat treatment method';
                        } else {
                          // 其他工艺列保持原名
                          newMapping[col] = col;
                        }
                      }
                    });

                    // 添加目标列映射（保持原名）
                    sourceConfig.targetColumns.forEach(col => {
                      if (!newMapping[col]) {
                        newMapping[col] = col;
                      }
                    });

                    // 添加特征列映射（保持原名）
                    sourceConfig.featureColumns.forEach(col => {
                      if (!newMapping[col]) {
                        newMapping[col] = col;
                      }
                    });

                    console.log('✓ 自动填充完成，新映射:', newMapping);

                    setCurrentTemplate({
                      ...currentTemplate,
                      column_name_mapping: newMapping
                    });
                  }}
                  className="text-xs px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                  title="从预测配置页面已选择的列自动填充映射配置"
                >
                  📥 从已选列自动填充
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCurrentTemplate({
                      ...currentTemplate,
                      column_name_mapping: {
                        'Processing': 'Heat treatment method',
                        'Composition': 'Composition'
                      }
                    });
                  }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  重置为默认值
                </button>
              </div>
            </div>

            {/* 重要性说明 */}
            <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900 font-medium mb-1">
                ⚠️ 重要：列名映射会影响 LLM 对数据的理解
              </p>
              <p className="text-xs text-blue-700">
                将技术性列名（如 "Processing"）映射为描述性名称（如 "Heat treatment method"）可以显著提高 LLM 的预测准确性。
                映射后的名称会在预览和实际预测的提示词中使用。
              </p>
            </div>

            {/* 当前已选列的状态显示 */}
            {globalColumnConfig ? (
              <div className="mb-3 p-4 bg-blue-50 border border-blue-300 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-blue-900">📊 当前配置（来自预测页面）</p>
                  <span className="text-xs px-2 py-1 bg-blue-200 text-blue-800 rounded font-medium">
                    全局配置
                  </span>
                </div>

                {/* 数据集信息 */}
                <div className="mb-3 pb-3 border-b border-blue-200">
                  <p className="text-xs font-medium text-blue-800 mb-1">数据集：</p>
                  <p className="text-sm text-blue-900">
                    {globalColumnConfig.datasetName} ({globalColumnConfig.rowCount} 行, {globalColumnConfig.columnCount} 列)
                  </p>
                </div>

                {/* 列选择详情 */}
                <div className="space-y-2 text-xs">
                  <div className="flex items-start">
                    <span className="inline-block px-2 py-0.5 bg-purple-100 text-purple-700 rounded mr-2 font-medium">🟣 组分</span>
                    <span className="text-gray-700 flex-1">
                      {globalColumnConfig.compositionColumns.length > 0
                        ? `${globalColumnConfig.compositionColumns.length} 个元素列`
                        : '未选择'}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded mr-2 font-medium">🔵 工艺</span>
                    <span className="text-gray-700 flex-1">
                      {globalColumnConfig.processingColumn.length > 0
                        ? globalColumnConfig.processingColumn.join(', ')
                        : '未选择'}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded mr-2 font-medium">🟢 目标</span>
                    <span className="text-gray-700 flex-1">
                      {globalColumnConfig.targetColumns.length > 0
                        ? globalColumnConfig.targetColumns.join(', ')
                        : '未选择'}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-700 rounded mr-2 font-medium">🟠 特征</span>
                    <span className="text-gray-700 flex-1">
                      {globalColumnConfig.featureColumns.length > 0
                        ? `${globalColumnConfig.featureColumns.length} 个（${globalColumnConfig.featureColumns.slice(0, 3).join(', ')}${globalColumnConfig.featureColumns.length > 3 ? '...' : ''}）`
                        : '未选择'}
                    </span>
                  </div>
                </div>
              </div>
            ) : selectedDataset ? (
              <div className="mb-3 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                <p className="text-xs font-medium text-gray-700 mb-2">📊 当前已选择的列（本地数据集）：</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-medium text-gray-600">组分列：</span>
                    <span className="ml-1 text-gray-700">
                      {compositionColumns.length > 0 ? `${compositionColumns.length} 个元素列` : '未选择'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">工艺列：</span>
                    <span className="ml-1 text-gray-700">
                      {processingColumn.length > 0 ? processingColumn.join(', ') : '未选择'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">目标列：</span>
                    <span className="ml-1 text-gray-700">
                      {targetColumns.length > 0 ? targetColumns.join(', ') : '未选择'}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">特征列：</span>
                    <span className="ml-1 text-gray-700">
                      {selectedFeatureColumns.length > 0 ? `${selectedFeatureColumns.length} 个` : '未选择'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  💡 请先在预测配置页面选择数据集和列，或在下方选择数据集进行预览
                </p>
              </div>
            )}

            {/* 提示信息 */}
            {!globalColumnConfig && selectedDataset && Object.keys(currentTemplate.column_name_mapping || {}).length === 0 && (
              <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  💡 提示：请先在预测配置页面选择列（组分、工艺、目标、特征），系统会自动将已选择的列添加到映射配置中。
                  您也可以点击上方的"📥 从已选列自动填充"按钮手动触发同步。
                </p>
              </div>
            )}

            {globalColumnConfig && Object.keys(currentTemplate.column_name_mapping || {}).length === 0 && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  💡 提示：检测到您在预测配置页面已选择了列。点击上方的"📥 从已选列自动填充"按钮即可导入这些列的映射配置。
                </p>
              </div>
            )}

            {/* 自动同步成功提示 */}
            {Object.keys(currentTemplate.column_name_mapping || {}).length > 0 && (
              <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-800">
                  ✓ 已配置 {Object.keys(currentTemplate.column_name_mapping || {}).length} 个列的映射。
                  {globalColumnConfig && '（来自预测配置页面）'}
                  您可以在下方编辑每个列的显示名称。
                </p>
              </div>
            )}

            <div className="space-y-2 bg-gray-50 p-3 rounded-lg max-h-96 overflow-y-auto">
              {Object.entries(currentTemplate.column_name_mapping || {}).length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  {selectedDataset
                    ? "请先选择特征列，系统将自动填充列名映射配置"
                    : "请先选择数据集"}
                </div>
              ) : (
                Object.entries(currentTemplate.column_name_mapping || {}).map(([key, value], index) => {
                  // 判断列的来源类型（优先使用全局配置）
                  const config = globalColumnConfig || {
                    compositionColumns: compositionColumns,
                    processingColumn: processingColumn,
                    targetColumns: targetColumns,
                    featureColumns: selectedFeatureColumns,
                  };

                  let columnType = '';
                  let columnTypeColor = '';
                  if (key === 'Composition' || config.compositionColumns.includes(key)) {
                    columnType = '组分';
                    columnTypeColor = 'bg-purple-100 text-purple-700';
                  } else if (config.processingColumn.includes(key)) {
                    columnType = '工艺';
                    columnTypeColor = 'bg-blue-100 text-blue-700';
                  } else if (config.targetColumns.includes(key)) {
                    columnType = '目标';
                    columnTypeColor = 'bg-green-100 text-green-700';
                  } else if (config.featureColumns.includes(key)) {
                    columnType = '特征';
                    columnTypeColor = 'bg-orange-100 text-orange-700';
                  } else {
                    columnType = '其他';
                    columnTypeColor = 'bg-gray-100 text-gray-600';
                  }

                  return (
                    <div key={`${key}-${index}`} className="flex gap-3 items-center bg-white p-2 rounded border border-gray-200">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="text-xs text-gray-500">原始列名</div>
                          <span className={`text-xs px-2 py-0.5 rounded ${columnTypeColor}`}>
                            {columnType}
                          </span>
                        </div>
                        <div className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">
                          {key}
                        </div>
                      </div>
                      <div className="text-gray-400">→</div>
                      <div className="flex-1">
                        <div className="text-xs text-gray-500 mb-1">显示名称</div>
                        <input
                          type="text"
                          value={value}
                          onChange={(e) => {
                            const newMapping = { ...currentTemplate.column_name_mapping };
                            newMapping[key] = e.target.value;
                            setCurrentTemplate({ ...currentTemplate, column_name_mapping: newMapping });
                          }}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder={key}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newMapping = { ...currentTemplate.column_name_mapping };
                          delete newMapping[key];
                          setCurrentTemplate({ ...currentTemplate, column_name_mapping: newMapping });
                        }}
                        className="px-2 py-1 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        title="删除此映射"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Target Material 映射控制 */}
            <div className="mt-3 bg-blue-50 p-3 rounded-lg">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTemplate.apply_mapping_to_target ?? true}
                  onChange={(e) => setCurrentTemplate({
                    ...currentTemplate,
                    apply_mapping_to_target: e.target.checked
                  })}
                  className="mt-0.5 w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">
                    对 Target Material 部分应用列名映射
                  </span>
                  <p className="text-xs text-gray-600 mt-1">
                    取消勾选后，Target Material 将保持原始列名，仅 Reference Samples 应用映射
                  </p>
                </div>
              </label>
            </div>

            <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs font-medium text-gray-700 mb-2">💡 列名映射示例：</p>
              <ul className="text-xs text-gray-600 space-y-1 ml-4">
                <li>• "Temperature" → "测试温度" 或 "Test Temperature (K)"</li>
                <li>• "Processing" → "热处理工艺" 或 "Heat treatment method"</li>
                <li>• "Pressure" → "压力 (MPa)" 或 "Applied Pressure"</li>
                <li>• "Aging_Time" → "时效时间 (h)" 或 "Aging Duration"</li>
              </ul>
              <p className="text-xs text-gray-500 mt-2 italic">
                提示：使用描述性名称可以帮助 LLM 更好地理解数据含义，从而提高预测准确性。
              </p>
            </div>
          </div>

          {/* 预览数据源选择 */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="useRealData"
                checked={useRealData}
                onChange={(e) => setUseRealData(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <label htmlFor="useRealData" className="text-sm font-medium text-gray-700">
                使用真实数据预览（从已上传的数据集中选择样本）
              </label>
            </div>

            {useRealData && (
              <div className="pl-6 space-y-3">
                {globalColumnConfig && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                      ✓ 将使用预测配置页面的数据集：<strong>{globalColumnConfig.datasetName}</strong>
                    </p>
                  </div>
                )}

                {!globalColumnConfig && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">选择数据集</label>
                      <select
                        value={selectedDatasetId}
                        onChange={(e) => {
                          setSelectedDatasetId(e.target.value);
                          loadDatasetDetail(e.target.value);
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      >
                        <option value="">请选择数据集</option>
                        {datasets.map((dataset) => (
                          <option key={dataset.dataset_id} value={dataset.dataset_id}>
                            {dataset.filename} ({dataset.row_count} 行)
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedDataset && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          测试样本索引（0 - {Math.floor(selectedDataset.row_count * 0.2) - 1}）
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={Math.floor(selectedDataset.row_count * 0.2) - 1}
                          value={testSampleIndex}
                          onChange={(e) => setTestSampleIndex(parseInt(e.target.value) || 0)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 测试样本索引（当使用全局配置时） */}
                {globalColumnConfig && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      测试样本索引（0 - {Math.floor(globalColumnConfig.rowCount * 0.2) - 1}）
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={Math.floor(globalColumnConfig.rowCount * 0.2) - 1}
                      value={testSampleIndex}
                      onChange={(e) => setTestSampleIndex(parseInt(e.target.value) || 0)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 已选择列显示（来自预测配置） */}
            {useRealData && globalColumnConfig && (
              <div className="pl-6 space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  已选择列（来自预测配置）
                  <span className="ml-2 text-xs text-gray-500">
                    包括组分列、工艺列、目标列和特征列
                  </span>
                </label>
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 space-y-3">
                  {/* 组分列 */}
                  {globalColumnConfig.compositionColumns.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-purple-700 mb-1">🟣 组分列 ({globalColumnConfig.compositionColumns.length} 个)：</p>
                      <div className="flex flex-wrap gap-2">
                        {globalColumnConfig.compositionColumns.map((col: string) => (
                          <span key={col} className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 工艺列 */}
                  {globalColumnConfig.processingColumn.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-blue-700 mb-1">🔵 工艺列 ({globalColumnConfig.processingColumn.length} 个)：</p>
                      <div className="flex flex-wrap gap-2">
                        {globalColumnConfig.processingColumn.map((col: string) => (
                          <span key={col} className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 目标列 */}
                  {globalColumnConfig.targetColumns.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-green-700 mb-1">🟢 目标列 ({globalColumnConfig.targetColumns.length} 个)：</p>
                      <div className="flex flex-wrap gap-2">
                        {globalColumnConfig.targetColumns.map((col: string) => (
                          <span key={col} className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 特征列 */}
                  {globalColumnConfig.featureColumns.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-orange-700 mb-1">🟠 特征列 ({globalColumnConfig.featureColumns.length} 个)：</p>
                      <div className="flex flex-wrap gap-2">
                        {globalColumnConfig.featureColumns.map((col: string) => (
                          <span key={col} className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {useRealData && !globalColumnConfig && selectedDataset && (
              <div className="pl-6 space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  选择特征列（可选）
                  <span className="ml-2 text-xs text-gray-500">
                    （除组分、工艺、目标属性外的其他列）
                  </span>
                </label>
                <div className="bg-gray-50 p-3 rounded-lg max-h-40 overflow-y-auto">
                  {selectedDataset.columns
                    .filter((col: string) => {
                      const isComposition = col.includes('at%') || col.includes('wt%');
                      const isProcessing = col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment');
                      // 统一格式默认使用多目标
                      const defaultTargetColumns = ['UTS(MPa)', 'El(%)'];
                      const isTarget = defaultTargetColumns.includes(col);
                      return !isComposition && !isProcessing && !isTarget;
                    })
                    .map((col: string) => (
                      <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100 px-2 rounded">
                        <input
                          type="checkbox"
                          checked={selectedFeatureColumns.includes(col)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFeatureColumns([...selectedFeatureColumns, col]);
                            } else {
                              setSelectedFeatureColumns(selectedFeatureColumns.filter(c => c !== col));
                            }
                          }}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm text-gray-700">{col}</span>
                      </label>
                    ))}
                </div>
                {selectedFeatureColumns.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                      ✓ 已选择 {selectedFeatureColumns.length} 个特征列，将自动同步到列名映射配置
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFeatureColumns([])}
                      className="text-xs text-red-600 hover:text-red-800"
                    >
                      清空选择
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={handlePreview}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              📋 预览模板
            </button>
            <button
              onClick={saveTemplate}
              className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              💾 保存模板
            </button>
          </div>
        </div>
      )}

      {/* 预览模态框 */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">📋 模板预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-gray-900 text-gray-100 rounded-lg p-4">
                <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{previewContent}</pre>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(previewContent);
                  alert('已复制到剪贴板');
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                📋 复制
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptTemplateEditor;

