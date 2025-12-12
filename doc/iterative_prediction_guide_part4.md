# 迭代预测功能开发文档 - 第4部分：Prompt模板设计

## 4. Prompt模板设计

### 4.1 设计方案分析

#### 4.1.1 为什么选择方案B（统一模板 + 条件渲染）

**问题背景**：
在迭代预测中，第1轮和第2轮及以后的轮次需要不同的 Prompt 结构：
- 第1轮：无历史数据，仅包含参考样本和当前样本
- 第2轮及以后：包含前面轮次的预测值作为历史数据

**方案对比**：

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **方案A：动态选择模板** | 第1轮使用成熟的 UNIFIED_PROTOCOL，保证初始质量 | 两个模板推理风格可能不一致，导致跳变 | ⭐⭐⭐ |
| **方案B：统一模板 + 条件渲染** | 所有轮次推理框架一致，避免跳变；灵活性高 | 第1轮时需要优雅处理空的历史部分 | ⭐⭐⭐⭐⭐ |

**最终选择：方案B**

**理由**：
1. **一致性**：所有轮次使用相同的推理框架，避免第1轮→第2轮的推理风格跳变
2. **灵活性**：使用 Jinja2 模板引擎，可以轻松处理条件渲染
3. **可维护性**：只需维护一个模板，减少代码复杂度
4. **可扩展性**：未来可以轻松添加更多条件（如不同的目标数量、不同的样本类型等）

### 4.2 统一模板实现

#### 4.2.1 ITERATIVE_PROTOCOL 模板

```python
# backend/services/prompt_builder.py

from jinja2 import Template
from textwrap import dedent

ITERATIVE_PROTOCOL = dedent("""
### FEW-SHOT AUGMENTED CORRECTION PROTOCOL FOR ITERATIVE PREDICTION
### System Role
You are a materials science expert specializing in predicting mechanical and physical properties of advanced materials. Your task is to predict material properties based on composition and processing parameters, using reference samples as guidance.

### Task Description
**Objective**: Predict the following properties for the target material:
{{ target_properties_list }}

**Target Material Composition**:
{{ test_sample }}

### Reference Samples (Similar Materials)
The following reference samples have known properties and can guide your prediction:
{{ reference_samples }}

{% if iteration > 1 %}
### Previous Iteration Results
Based on the previous {{ iteration - 1 }} iteration(s), here are the prediction values for this material:

{{ iteration_history }}

**Analysis of Trends**:
- Review the prediction values from previous iterations
- Identify patterns: Are values converging? Oscillating? Trending in a specific direction?
- Consider whether the LLM's previous reasoning was sound or needs adjustment
- Use this information to refine your current prediction

{% else %}
### Initial Prediction Context
This is the first iteration of prediction for this material. There are no previous predictions to compare against. Focus on making the most accurate initial prediction based on the reference samples and the target material's composition.

{% endif %}

### Required Analysis Protocol
1. **Composition Analysis**: Analyze how the target material's composition differs from reference samples
2. **Property Correlation**: Identify which composition elements most strongly influence each target property
3. **Reference Comparison**: Select the most similar reference samples and explain why they are relevant
4. **Prediction Reasoning**: Provide step-by-step reasoning for your prediction
{% if iteration > 1 %}
5. **Iteration Refinement**: Explain how your current prediction differs from the previous iteration and why
6. **Convergence Assessment**: Assess whether the prediction is converging or if further refinement is needed
{% endif %}

### Output Format
Provide your response in the following JSON format:
{
  "analysis": {
    "composition_analysis": "...",
    "property_correlation": "...",
    "reference_comparison": "...",
    "prediction_reasoning": "..."
    {% if iteration > 1 %}
    ,
    "iteration_refinement": "...",
    "convergence_assessment": "..."
    {% endif %}
  },
  "predictions": {
    {% for prop in target_properties %}
    "{{ prop }}": <numeric_value>{{ "," if not loop.last else "" }}
    {% endfor %}
  }
}

### Important Notes
- Provide numeric values only for predictions (no units in the JSON)
- Ensure predictions are physically reasonable for the material system
- If you're uncertain about a prediction, explain your confidence level
- Maintain consistency with previous iterations if applicable
""").strip()
```

#### 4.2.2 模板选择和渲染函数

```python
# backend/services/prompt_builder.py

from jinja2 import Template
from typing import Dict, List, Optional, Any

class PromptBuilder:
    """Prompt 构建器"""
    
    @staticmethod
    def build_prompt(
        test_sample: Dict[str, Any],
        reference_samples: List[Dict[str, Any]],
        target_properties: List[str],
        iteration: int = 1,
        iteration_history: Optional[str] = None,
        llm_provider: str = "gemini"
    ) -> str:
        """
        构建预测 Prompt
        
        Args:
            test_sample: 测试样本数据
            reference_samples: 参考样本列表
            target_properties: 目标属性列表
            iteration: 当前迭代轮数（默认1）
            iteration_history: 迭代历史（Markdown 表格格式）
            llm_provider: LLM 提供商
        
        Returns:
            完整的 Prompt 字符串
        
        Logic:
            1. 对于迭代预测（iteration > 1），使用 ITERATIVE_PROTOCOL
            2. 对于单次预测（iteration == 1），使用 UNIFIED_PROTOCOL
            3. 使用 Jinja2 模板引擎进行条件渲染
        """
        
        # 格式化目标属性列表
        target_properties_list = "\n".join(
            [f"- {prop}" for prop in target_properties]
        )
        
        # 格式化测试样本
        test_sample_str = PromptBuilder._format_sample(test_sample)
        
        # 格式化参考样本
        reference_samples_str = PromptBuilder._format_reference_samples(
            reference_samples
        )
        
        # 选择模板
        if iteration == 1:
            # 第1轮使用 UNIFIED_PROTOCOL（现有模板）
            template_str = UNIFIED_PROTOCOL
            template = Template(template_str)
            
            prompt = template.render(
                target_properties_list=target_properties_list,
                test_sample=test_sample_str,
                reference_samples=reference_samples_str
            )
        else:
            # 第2轮及以后使用 ITERATIVE_PROTOCOL
            template = Template(ITERATIVE_PROTOCOL)
            
            prompt = template.render(
                target_properties_list=target_properties_list,
                test_sample=test_sample_str,
                reference_samples=reference_samples_str,
                iteration=iteration,
                iteration_history=iteration_history or ""
            )
        
        return prompt
    
    @staticmethod
    def _format_sample(sample: Dict[str, Any]) -> str:
        """格式化单个样本"""
        lines = []
        for key, value in sample.items():
            if key not in ["ID", "index"]:
                lines.append(f"- {key}: {value}")
        return "\n".join(lines)
    
    @staticmethod
    def _format_reference_samples(samples: List[Dict[str, Any]]) -> str:
        """格式化参考样本列表"""
        lines = []
        for i, sample in enumerate(samples, 1):
            lines.append(f"**Sample {i}**:")
            for key, value in sample.items():
                if key not in ["index"]:
                    lines.append(f"  - {key}: {value}")
            lines.append("")
        return "\n".join(lines)
```

#### 4.2.3 迭代历史格式化函数

```python
# backend/services/prompt_builder.py

class PromptBuilder:
    """Prompt 构建器"""
    
    @staticmethod
    def format_iteration_history(
        sample_id: str,
        target_properties: List[str],
        iteration_data: Dict[str, List[float]],
        current_iteration: int
    ) -> str:
        """
        将迭代历史格式化为 Markdown 表格
        
        Args:
            sample_id: 样本 ID
            target_properties: 目标属性列表
            iteration_data: 迭代数据，格式：
                {
                    "UTS(MPa)": [850, 855, 857],
                    "El(%)": [15.0, 14.8, 14.7]
                }
            current_iteration: 当前迭代轮数
        
        Returns:
            Markdown 表格字符串
        
        Example:
            >>> sample_id = "Sample_001"
            >>> target_properties = ["UTS(MPa)", "El(%)"]
            >>> iteration_data = {
            ...     "UTS(MPa)": [850, 855, 857],
            ...     "El(%)": [15.0, 14.8, 14.7]
            ... }
            >>> current_iteration = 3
            >>> result = PromptBuilder.format_iteration_history(
            ...     sample_id, target_properties, iteration_data, current_iteration
            ... )
            >>> print(result)
            # Sample_001 - Iteration History
            
            | Iteration | UTS(MPa) | El(%) | Change (UTS) | Change (El) |
            |-----------|----------|-------|--------------|-------------|
            | 1         | 850.0    | 15.0  | -            | -           |
            | 2         | 855.0    | 14.8  | +0.59%       | -1.33%      |
            | 3         | 857.0    | 14.7  | +0.23%       | -0.68%      |
            
            **Trend Analysis**:
            - UTS(MPa): Converging (changes: +0.59% → +0.23%)
            - El(%): Converging (changes: -1.33% → -0.68%)
        """
        
        lines = [f"# {sample_id} - Iteration History\n"]
        
        # 构建表头
        header = "| Iteration |"
        separator = "|-----------|"
        
        for prop in target_properties:
            header += f" {prop} |"
            separator += "----------|"
        
        header += " Change (%) |"
        separator += "------------|"
        
        lines.append(header)
        lines.append(separator)
        
        # 构建数据行
        for iter_num in range(1, current_iteration + 1):
            row = f"| {iter_num} |"
            
            # 添加预测值
            for prop in target_properties:
                value = iteration_data[prop][iter_num - 1]
                row += f" {value:.2f} |"
            
            # 计算变化率
            if iter_num == 1:
                row += " - |"
            else:
                changes = []
                for prop in target_properties:
                    prev_value = iteration_data[prop][iter_num - 2]
                    curr_value = iteration_data[prop][iter_num - 1]
                    
                    # 计算相对变化率
                    denominator = max(abs(prev_value), 0.1)
                    relative_change = (curr_value - prev_value) / denominator
                    
                    changes.append(f"{relative_change * 100:+.2f}%")
                
                row += f" {', '.join(changes)} |"
            
            lines.append(row)
        
        # 添加趋势分析
        lines.append("\n**Trend Analysis**:")
        for prop in target_properties:
            values = iteration_data[prop]
            
            if len(values) == 1:
                lines.append(f"- {prop}: Initial prediction (no trend yet)")
            else:
                # 计算最后两次的变化率
                prev_value = values[-2]
                curr_value = values[-1]
                denominator = max(abs(prev_value), 0.1)
                last_change = abs((curr_value - prev_value) / denominator)
                
                if last_change < 0.01:
                    trend = "✓ Converged"
                elif last_change < 0.05:
                    trend = "→ Converging"
                else:
                    trend = "↗ Still changing"
                
                lines.append(f"- {prop}: {trend} (last change: {last_change * 100:.2f}%)")
        
        return "\n".join(lines)
```

### 4.3 完整示例

#### 4.3.1 示例1：第1轮迭代的完整Prompt（无历史）

```
### FEW-SHOT AUGMENTED CORRECTION PROTOCOL FOR ITERATIVE PREDICTION
### System Role
You are a materials science expert specializing in predicting mechanical and physical properties of advanced materials. Your task is to predict material properties based on composition and processing parameters, using reference samples as guidance.

### Task Description
**Objective**: Predict the following properties for the target material:
- UTS(MPa)
- El(%)

**Target Material Composition**:
- C: 0.5
- Si: 1.2
- Mn: 0.8

### Reference Samples (Similar Materials)
The following reference samples have known properties and can guide your prediction:
**Sample 1**:
  - C: 0.48
  - Si: 1.1
  - Mn: 0.75
  - UTS(MPa): 840
  - El(%): 15.2

**Sample 2**:
  - C: 0.52
  - Si: 1.3
  - Mn: 0.85
  - UTS(MPa): 860
  - El(%): 14.8

### Initial Prediction Context
This is the first iteration of prediction for this material. There are no previous predictions to compare against. Focus on making the most accurate initial prediction based on the reference samples and the target material's composition.

### Required Analysis Protocol
1. **Composition Analysis**: Analyze how the target material's composition differs from reference samples
2. **Property Correlation**: Identify which composition elements most strongly influence each target property
3. **Reference Comparison**: Select the most similar reference samples and explain why they are relevant
4. **Prediction Reasoning**: Provide step-by-step reasoning for your prediction

### Output Format
Provide your response in the following JSON format:
{
  "analysis": {
    "composition_analysis": "...",
    "property_correlation": "...",
    "reference_comparison": "...",
    "prediction_reasoning": "..."
  },
  "predictions": {
    "UTS(MPa)": <numeric_value>,
    "El(%)": <numeric_value>
  }
}

### Important Notes
- Provide numeric values only for predictions (no units in the JSON)
- Ensure predictions are physically reasonable for the material system
- If you're uncertain about a prediction, explain your confidence level
- Maintain consistency with previous iterations if applicable
```

#### 4.3.2 示例2：第2轮迭代的完整Prompt（包含1轮历史）

```
### FEW-SHOT AUGMENTED CORRECTION PROTOCOL FOR ITERATIVE PREDICTION
### System Role
You are a materials science expert specializing in predicting mechanical and physical properties of advanced materials. Your task is to predict material properties based on composition and processing parameters, using reference samples as guidance.

### Task Description
**Objective**: Predict the following properties for the target material:
- UTS(MPa)
- El(%)

**Target Material Composition**:
- C: 0.5
- Si: 1.2
- Mn: 0.8

### Reference Samples (Similar Materials)
The following reference samples have known properties and can guide your prediction:
**Sample 1**:
  - C: 0.48
  - Si: 1.1
  - Mn: 0.75
  - UTS(MPa): 840
  - El(%): 15.2

**Sample 2**:
  - C: 0.52
  - Si: 1.3
  - Mn: 0.85
  - UTS(MPa): 860
  - El(%): 14.8

### Previous Iteration Results
Based on the previous 1 iteration(s), here are the prediction values for this material:

# Sample_001 - Iteration History

| Iteration | UTS(MPa) | El(%) | Change (%) |
|-----------|----------|-------|------------|
| 1         | 850.0    | 15.0  | -          |

**Trend Analysis**:
- UTS(MPa): Initial prediction (no trend yet)
- El(%): Initial prediction (no trend yet)

**Analysis of Trends**:
- Review the prediction values from previous iterations
- Identify patterns: Are values converging? Oscillating? Trending in a specific direction?
- Consider whether the LLM's previous reasoning was sound or needs adjustment
- Use this information to refine your current prediction

### Required Analysis Protocol
1. **Composition Analysis**: Analyze how the target material's composition differs from reference samples
2. **Property Correlation**: Identify which composition elements most strongly influence each target property
3. **Reference Comparison**: Select the most similar reference samples and explain why they are relevant
4. **Prediction Reasoning**: Provide step-by-step reasoning for your prediction
5. **Iteration Refinement**: Explain how your current prediction differs from the previous iteration and why
6. **Convergence Assessment**: Assess whether the prediction is converging or if further refinement is needed

### Output Format
Provide your response in the following JSON format:
{
  "analysis": {
    "composition_analysis": "...",
    "property_correlation": "...",
    "reference_comparison": "...",
    "prediction_reasoning": "...",
    "iteration_refinement": "...",
    "convergence_assessment": "..."
  },
  "predictions": {
    "UTS(MPa)": <numeric_value>,
    "El(%)": <numeric_value>
  }
}

### Important Notes
- Provide numeric values only for predictions (no units in the JSON)
- Ensure predictions are physically reasonable for the material system
- If you're uncertain about a prediction, explain your confidence level
- Maintain consistency with previous iterations if applicable
```

#### 4.3.3 示例3：第5轮迭代的完整Prompt（包含4轮历史）

```
### FEW-SHOT AUGMENTED CORRECTION PROTOCOL FOR ITERATIVE PREDICTION
### System Role
You are a materials science expert specializing in predicting mechanical and physical properties of advanced materials. Your task is to predict material properties based on composition and processing parameters, using reference samples as guidance.

### Task Description
**Objective**: Predict the following properties for the target material:
- UTS(MPa)
- El(%)

**Target Material Composition**:
- C: 0.5
- Si: 1.2
- Mn: 0.8

### Reference Samples (Similar Materials)
The following reference samples have known properties and can guide your prediction:
**Sample 1**:
  - C: 0.48
  - Si: 1.1
  - Mn: 0.75
  - UTS(MPa): 840
  - El(%): 15.2

**Sample 2**:
  - C: 0.52
  - Si: 1.3
  - Mn: 0.85
  - UTS(MPa): 860
  - El(%): 14.8

### Previous Iteration Results
Based on the previous 4 iteration(s), here are the prediction values for this material:

# Sample_001 - Iteration History

| Iteration | UTS(MPa) | El(%) | Change (%) |
|-----------|----------|-------|------------|
| 1         | 850.0    | 15.0  | -          |
| 2         | 855.0    | 14.8  | +0.59%, -1.33% |
| 3         | 857.0    | 14.7  | +0.23%, -0.68% |
| 4         | 858.0    | 14.65 | +0.12%, -0.34% |

**Trend Analysis**:
- UTS(MPa): ✓ Converged (last change: 0.12%)
- El(%): ✓ Converged (last change: 0.34%)

**Analysis of Trends**:
- Review the prediction values from previous iterations
- Identify patterns: Are values converging? Oscillating? Trending in a specific direction?
- Consider whether the LLM's previous reasoning was sound or needs adjustment
- Use this information to refine your current prediction

### Required Analysis Protocol
1. **Composition Analysis**: Analyze how the target material's composition differs from reference samples
2. **Property Correlation**: Identify which composition elements most strongly influence each target property
3. **Reference Comparison**: Select the most similar reference samples and explain why they are relevant
4. **Prediction Reasoning**: Provide step-by-step reasoning for your prediction
5. **Iteration Refinement**: Explain how your current prediction differs from the previous iteration and why
6. **Convergence Assessment**: Assess whether the prediction is converging or if further refinement is needed

### Output Format
Provide your response in the following JSON format:
{
  "analysis": {
    "composition_analysis": "...",
    "property_correlation": "...",
    "reference_comparison": "...",
    "prediction_reasoning": "...",
    "iteration_refinement": "...",
    "convergence_assessment": "..."
  },
  "predictions": {
    "UTS(MPa)": <numeric_value>,
    "El(%)": <numeric_value>
  }
}

### Important Notes
- Provide numeric values only for predictions (no units in the JSON)
- Ensure predictions are physically reasonable for the material system
- If you're uncertain about a prediction, explain your confidence level
- Maintain consistency with previous iterations if applicable
```

### 4.4 Prompt 模板选择逻辑总结

```python
# 伪代码：Prompt 模板选择逻辑

def build_prompt(iteration, enable_iteration):
    if not enable_iteration:
        # 单次预测：使用现有的 UNIFIED_PROTOCOL
        return UNIFIED_PROTOCOL.render(...)
    
    if iteration == 1:
        # 迭代预测的第1轮：使用 UNIFIED_PROTOCOL
        # 原因：第1轮无历史数据，使用成熟的模板保证初始质量
        return UNIFIED_PROTOCOL.render(...)
    
    else:
        # 迭代预测的第2轮及以后：使用 ITERATIVE_PROTOCOL
        # 原因：包含历史数据，需要引导 LLM 进行迭代改进
        iteration_history_str = format_iteration_history(...)
        return ITERATIVE_PROTOCOL.render(
            iteration=iteration,
            iteration_history=iteration_history_str,
            ...
        )
```

**关键设计决策**：
1. **第1轮使用 UNIFIED_PROTOCOL**：虽然 ITERATIVE_PROTOCOL 也可以处理第1轮（通过条件渲染隐藏历史部分），但为了保证初始预测质量，我们复用已验证的 UNIFIED_PROTOCOL
2. **第2轮及以后使用 ITERATIVE_PROTOCOL**：这个模板专门为迭代设计，包含"Iteration Refinement"和"Convergence Assessment"部分，引导 LLM 进行有针对性的改进
3. **Jinja2 条件渲染**：ITERATIVE_PROTOCOL 内部使用 `{% if iteration > 1 %}` 来处理条件逻辑，使模板更灵活

