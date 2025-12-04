import React, { useState, useEffect } from 'react';
import {
  EXAMPLE_SUPERALLOY_REFERENCES,
  getExampleTestSample,
  getExampleCompositionColumns
} from '../constants/exampleData';

interface PromptTemplate {
  template_id?: string;
  template_name: string;
  template_type: 'single_target' | 'multi_target';
  description: string;
  system_role: string;
  task_description: string;
  input_format: string;
  output_format: string;
  reference_format: string;
  analysis_protocol: string;
  predictions_json_template?: string;
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
    template_type: 'single_target',
    description: '',
    system_role: '',
    task_description: '',
    input_format: '**Target Material**:\n{test_sample}',
    output_format: '',
    reference_format: '{reference_samples}',
    analysis_protocol: '',
    predictions_json_template: '',
  });
  const [isEditing, setIsEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');

  // 新增：数据集和样本选择相关状态
  const [datasets, setDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [selectedDataset, setSelectedDataset] = useState<any>(null);
  const [testSampleIndex, setTestSampleIndex] = useState<number>(0);
  const [useRealData, setUseRealData] = useState<boolean>(false);

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
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/api/datasets/${datasetId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedDataset(data);
        setTestSampleIndex(0); // 重置样本索引
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
        template_type: 'single_target',
        description: '',
        system_role: '',
        task_description: '',
        input_format: '**Target Material**:\n{test_sample}',
        output_format: '',
        reference_format: '{reference_samples}',
        analysis_protocol: '',
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
        setCurrentTemplate(data);
        setIsEditing(false);
        if (onTemplateSelect) {
          onTemplateSelect(data);
        }
      }
    } catch (error) {
      console.error('加载模板失败:', error);
    }
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

    const templateId = selectedTemplateId || `custom_${Date.now()}`;

    try {
      const response = await fetch(`http://localhost:8000/api/prompt-templates/${templateId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(currentTemplate),
      });

      if (response.ok) {
        alert('模板保存成功');
        await loadTemplates();
        setSelectedTemplateId(templateId);
        setIsEditing(false);
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
  };

  // 获取默认 JSON 模板
  const getDefaultJsonTemplate = (templateType: string) => {
    if (templateType === 'single_target') {
      return `{
    "predictions": {
        "{target_property}": {"value": <number>, "unit": "{unit}"}
    },
    "confidence": "<high/medium/low>",
    "reasoning": "<brief explanation>"
}`;
    } else {
      return `{
    "predictions": {
        "{target_property_1}": {"value": <number>, "unit": "{unit}"},
        "{target_property_2}": {"value": <number>, "unit": "{unit}"}
    },
    "confidence": "<high/medium/low>",
    "reasoning": "<brief explanation>"
}`;
    }
  };

  // 预览模板（使用示例数据或真实数据渲染完整提示词）
  const handlePreview = async () => {
    try {
      let testSample: Record<string, any>;
      let referenceSamples: any[];
      let compositionColumn: string | string[];
      let processingColumn: string;
      let targetColumns: string[];

      // 如果选择使用真实数据且已选择数据集
      if (useRealData && selectedDataset) {
        // 使用 RAG 预览 API 获取真实样本数据
        const ragResponse = await fetch('http://localhost:8000/api/prediction/preview-rag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: selectedDataset.dataset_id,
            composition_column: selectedDataset.columns.filter((col: string) =>
              col.includes('at%') || col.includes('wt%')
            ),
            processing_column: selectedDataset.columns.find((col: string) =>
              col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment')
            ) || 'Processing_Description',
            target_columns: currentTemplate.template_type === 'single_target'
              ? ['UTS(MPa)']
              : ['UTS(MPa)', 'El(%)'],
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
        referenceSamples = ragData.retrieved_samples;
        compositionColumn = selectedDataset.columns.filter((col: string) =>
          col.includes('at%') || col.includes('wt%')
        );
        processingColumn = selectedDataset.columns.find((col: string) =>
          col.toLowerCase().includes('processing') || col.toLowerCase().includes('treatment')
        ) || 'Processing_Description';
        targetColumns = currentTemplate.template_type === 'single_target'
          ? ['UTS(MPa)']
          : ['UTS(MPa)', 'El(%)'];
      } else {
        // 使用示例数据（从常量文件导入）
        targetColumns = currentTemplate.template_type === 'single_target'
          ? ['UTS(MPa)']
          : ['UTS(MPa)', 'El(%)'];

        testSample = getExampleTestSample();
        referenceSamples = EXAMPLE_SUPERALLOY_REFERENCES;
        compositionColumn = getExampleCompositionColumns();
        processingColumn = 'Processing_Description';
      }

      // 调用后端预览 API
      const requestBody = {
        // 模板字段（展开到顶层）
        ...currentTemplate,
        // 其他请求字段
        test_sample: testSample,
        reference_samples: referenceSamples,
        composition_column: compositionColumn,
        processing_column: processingColumn,
        target_columns: targetColumns
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

      const preview = `
=== 渲染后的完整提示词 ===
（使用${dataSource}）

${result.rendered_prompt || '（渲染失败）'}

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
      {/* 模板选择 */}
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
              {template.template_name} ({template.template_type === 'single_target' ? '单目标' : '多目标'})
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
          onClick={() => setIsEditing(!isEditing)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          {isEditing ? '取消编辑' : '编辑模板'}
        </button>
        {selectedTemplateId && (
          <button
            onClick={duplicateTemplate}
            className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
          >
            复制
          </button>
        )}
        {selectedTemplateId && !selectedTemplateId.startsWith('default_') && (
          <button
            onClick={deleteTemplate}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            删除
          </button>
        )}
      </div>

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
                onChange={(e) => setCurrentTemplate({ ...currentTemplate, template_type: e.target.value as 'single_target' | 'multi_target' })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                <option value="single_target">单目标</option>
                <option value="multi_target">多目标</option>
              </select>
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
                  const defaultTemplate = getDefaultJsonTemplate(currentTemplate.template_type);
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
              <div className="grid grid-cols-2 gap-4 pl-6">
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

