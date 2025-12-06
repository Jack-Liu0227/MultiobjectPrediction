"""
任务对比分析服务
用于统计和可视化多个任务之间预测结果的一致性
"""

import pandas as pd
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional
import logging
from collections import Counter
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # 使用非交互式后端

# 配置中文字体支持
import platform
if platform.system() == 'Windows':
    plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'SimSun']
elif platform.system() == 'Darwin':  # macOS
    plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'PingFang SC']
else:  # Linux
    plt.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC']
plt.rcParams['axes.unicode_minus'] = False  # 解决负号显示问题

from config import RESULTS_DIR

logger = logging.getLogger(__name__)


class TaskComparisonService:
    """任务对比分析服务"""

    def __init__(self):
        self.results_dir = RESULTS_DIR

    def load_task_predictions(self, task_id: str) -> Optional[pd.DataFrame]:
        """
        加载任务的预测结果

        Args:
            task_id: 任务ID

        Returns:
            预测结果DataFrame，如果不存在则返回None
        """
        try:
            predictions_file = self.results_dir / task_id / "predictions.csv"
            if not predictions_file.exists():
                logger.error(f"任务 {task_id} 的预测结果文件不存在")
                return None

            df = pd.read_csv(predictions_file)
            logger.info(f"成功加载任务 {task_id} 的预测结果，共 {len(df)} 个样本")
            return df
        except Exception as e:
            logger.error(f"加载任务 {task_id} 的预测结果失败: {e}")
            return None

    def compare_tasks(
        self,
        task_ids: List[str],
        target_columns: List[str],
        tolerance: float = 0.0
    ) -> Dict[str, Any]:
        """
        对比多个任务的预测结果一致性（支持多目标属性）

        Args:
            task_ids: 任务ID列表（至少2个）
            target_columns: 要对比的目标列名列表
            tolerance: 容差值（相对误差百分比），默认0表示完全相同

        Returns:
            对比分析结果字典
        """
        if len(task_ids) < 2:
            raise ValueError("至少需要2个任务进行对比")

        if len(target_columns) < 1:
            raise ValueError("至少需要1个目标属性")

        # 加载所有任务的预测结果
        task_dfs = {}
        for task_id in task_ids:
            df = self.load_task_predictions(task_id)
            if df is None:
                raise ValueError(f"无法加载任务 {task_id} 的预测结果")
            task_dfs[task_id] = df

        # 验证所有目标列存在
        for target_column in target_columns:
            pred_col = f"{target_column}_predicted"
            for task_id, df in task_dfs.items():
                if pred_col not in df.columns:
                    raise ValueError(f"任务 {task_id} 中不存在预测列 {pred_col}")

        # 获取样本索引的交集（只对比所有任务都有的样本）
        common_indices = None
        for task_id, df in task_dfs.items():
            if 'sample_index' in df.columns:
                indices = set(df['sample_index'].values)
            else:
                indices = set(df.index.values)

            if common_indices is None:
                common_indices = indices
            else:
                common_indices = common_indices.intersection(indices)

        common_indices = sorted(list(common_indices))
        logger.info(f"共有样本数: {len(common_indices)}")

        # 为每个目标属性提取预测值矩阵
        # predictions_by_target: {target_column: np.array(样本数, 任务数)}
        predictions_by_target = {}
        for target_column in target_columns:
            pred_col = f"{target_column}_predicted"
            predictions_matrix = []
            for task_id in task_ids:
                df = task_dfs[task_id]
                if 'sample_index' in df.columns:
                    df = df.set_index('sample_index')

                pred_values = [df.loc[idx, pred_col] for idx in common_indices]
                predictions_matrix.append(pred_values)

            predictions_by_target[target_column] = np.array(predictions_matrix).T

        # 计算多目标联合一致性
        consistency_stats = self._calculate_multi_target_consistency(
            predictions_by_target,
            task_ids,
            target_columns,
            tolerance
        )

        # 添加样本详情
        consistency_stats['sample_details'] = self._get_multi_target_sample_details(
            predictions_by_target,
            common_indices,
            task_ids,
            target_columns,
            tolerance,
            task_dfs
        )

        # 计算每个目标属性的指标
        consistency_stats['target_metrics'] = self._calculate_target_metrics(
            predictions_by_target,
            task_ids,
            target_columns,
            task_dfs,
            common_indices
        )

        consistency_stats['target_columns'] = target_columns
        consistency_stats['tolerance'] = tolerance
        consistency_stats['total_samples'] = len(common_indices)

        return consistency_stats

    def _calculate_consistency(
        self,
        predictions_matrix: np.ndarray,
        task_ids: List[str],
        tolerance: float
    ) -> Dict[str, Any]:
        """
        计算预测结果的一致性统计

        Args:
            predictions_matrix: 预测值矩阵 (样本数, 任务数)
            task_ids: 任务ID列表
            tolerance: 容差值（相对误差百分比）

        Returns:
            一致性统计结果
        """
        n_tasks = len(task_ids)
        n_samples = predictions_matrix.shape[0]

        # 统计每个样本的一致性级别
        consistency_levels = []
        for sample_preds in predictions_matrix:
            # 计算每对预测值之间的相似度
            level = self._get_consistency_level(sample_preds, tolerance)
            consistency_levels.append(level)

        # 统计各一致性级别的样本数
        level_counts = Counter(consistency_levels)

        # 构建统计结果（从完全一致到完全不一致）
        consistency_distribution = {}
        for level in range(n_tasks, 0, -1):
            count = level_counts.get(level, 0)
            percentage = (count / n_samples * 100) if n_samples > 0 else 0

            if level == n_tasks:
                label = f"全部{n_tasks}个任务一致"
            elif level == 1:
                label = f"全部{n_tasks}个任务都不同"
            else:
                label = f"恰好{level}个任务一致"

            consistency_distribution[label] = {
                'count': count,
                'percentage': percentage,
                'level': level
            }

        return {
            'task_ids': task_ids,
            'n_tasks': n_tasks,
            'consistency_distribution': consistency_distribution,
            'consistency_levels': consistency_levels
        }

    def _get_consistency_level(
        self,
        predictions: np.ndarray,
        tolerance: float
    ) -> int:
        """
        获取一组预测值的一致性级别

        Args:
            predictions: 一个样本在不同任务中的预测值数组
            tolerance: 容差值（相对误差百分比）

        Returns:
            一致性级别（相同预测值的最大数量）
        """
        n = len(predictions)
        if n == 0:
            return 0

        # 构建相似度矩阵
        similar_groups = []
        used = set()

        for i in range(n):
            if i in used:
                continue

            group = [i]
            for j in range(i + 1, n):
                if j in used:
                    continue

                # 判断两个预测值是否相似
                if self._is_similar(predictions[i], predictions[j], tolerance):
                    group.append(j)
                    used.add(j)

            similar_groups.append(len(group))
            used.add(i)

        # 返回最大的相似组大小
        return max(similar_groups) if similar_groups else 1

    def _is_similar(
        self,
        value1: float,
        value2: float,
        tolerance: float
    ) -> bool:
        """
        判断两个预测值是否相似

        Args:
            value1: 预测值1
            value2: 预测值2
            tolerance: 容差值（相对误差百分比）

        Returns:
            是否相似
        """
        if pd.isna(value1) or pd.isna(value2):
            return pd.isna(value1) and pd.isna(value2)

        if tolerance == 0:
            return abs(value1 - value2) < 1e-6  # 浮点数比较

        # 使用相对误差
        avg = (abs(value1) + abs(value2)) / 2
        if avg < 1e-6:  # 避免除以0
            return abs(value1 - value2) < 1e-6

        relative_error = abs(value1 - value2) / avg * 100
        return relative_error <= tolerance

    def _get_sample_details(
        self,
        predictions_matrix: np.ndarray,
        sample_indices: List[int],
        task_ids: List[str],
        tolerance: float,
        task_dfs: Dict[str, pd.DataFrame],
        target_column: str
    ) -> List[Dict[str, Any]]:
        """
        获取每个样本的详细对比信息

        Args:
            predictions_matrix: 预测值矩阵
            sample_indices: 样本索引列表
            task_ids: 任务ID列表
            tolerance: 容差值
            task_dfs: 任务数据框字典
            target_column: 目标列名

        Returns:
            样本详情列表
        """
        details = []

        # 获取第一个任务的数据框来提取实际值
        first_task_df = task_dfs[task_ids[0]]
        if 'sample_index' in first_task_df.columns:
            first_task_df = first_task_df.set_index('sample_index')

        for i, sample_idx in enumerate(sample_indices):
            sample_preds = predictions_matrix[i]
            level = self._get_consistency_level(sample_preds, tolerance)

            # 获取实际值（从第一个任务的数据中）
            actual_value = None
            if target_column in first_task_df.columns:
                actual_value = float(first_task_df.loc[sample_idx, target_column])

            detail = {
                'sample_index': int(sample_idx),
                'consistency_level': level,
                'actual_value': actual_value,
                'predictions': {
                    task_id: float(pred) if not pd.isna(pred) else None
                    for task_id, pred in zip(task_ids, sample_preds)
                }
            }
            details.append(detail)

        return details

    def visualize_comparison(
        self,
        comparison_result: Dict[str, Any],
        output_path: Optional[Path] = None,
        chart_type: str = 'bar'
    ) -> Path:
        """
        可视化任务对比结果

        Args:
            comparison_result: 对比分析结果
            output_path: 输出文件路径，如果为None则自动生成
            chart_type: 图表类型 ('bar', 'pie', 'both')

        Returns:
            图表文件路径
        """
        if output_path is None:
            output_path = self.results_dir / "task_comparison.png"

        distribution = comparison_result['consistency_distribution']
        n_tasks = comparison_result['n_tasks']
        target_column = comparison_result['target_column']

        # 准备数据
        labels = []
        counts = []
        percentages = []
        colors = []

        # 按一致性级别从高到低排序
        sorted_items = sorted(
            distribution.items(),
            key=lambda x: x[1]['level'],
            reverse=True
        )

        for label, data in sorted_items:
            labels.append(label)
            counts.append(data['count'])
            percentages.append(data['percentage'])

            # 根据一致性级别设置颜色（绿色到红色渐变）
            level = data['level']
            if level == n_tasks:
                colors.append('#10b981')  # 绿色 - 完全一致
            elif level >= n_tasks * 0.75:
                colors.append('#84cc16')  # 黄绿色
            elif level >= n_tasks * 0.5:
                colors.append('#eab308')  # 黄色
            elif level >= n_tasks * 0.25:
                colors.append('#f97316')  # 橙色
            else:
                colors.append('#ef4444')  # 红色 - 不一致

        # 创建图表
        if chart_type == 'both':
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
            self._plot_bar_chart(ax1, labels, counts, percentages, colors, target_column, n_tasks)
            self._plot_pie_chart(ax2, labels, counts, colors, target_column, n_tasks)
        elif chart_type == 'pie':
            fig, ax = plt.subplots(figsize=(10, 8))
            self._plot_pie_chart(ax, labels, counts, colors, target_column, n_tasks)
        else:  # bar
            fig, ax = plt.subplots(figsize=(12, 6))
            self._plot_bar_chart(ax, labels, counts, percentages, colors, target_column, n_tasks)

        plt.tight_layout()
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()

        logger.info(f"对比图表已保存到: {output_path}")
        return output_path

    def _plot_bar_chart(
        self,
        ax,
        labels: List[str],
        counts: List[int],
        percentages: List[float],
        colors: List[str],
        target_column: str,
        n_tasks: int
    ):
        """绘制柱状图"""
        x = np.arange(len(labels))
        bars = ax.bar(x, counts, color=colors, alpha=0.8, edgecolor='black', linewidth=1.5)

        # 添加数值标签
        for i, (bar, count, pct) in enumerate(zip(bars, counts, percentages)):
            height = bar.get_height()
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                height,
                f'{count}\n({pct:.1f}%)',
                ha='center',
                va='bottom',
                fontsize=10,
                fontweight='bold'
            )

        ax.set_xlabel('一致性级别', fontsize=12, fontweight='bold')
        ax.set_ylabel('样本数量', fontsize=12, fontweight='bold')
        ax.set_title(
            f'{n_tasks}个任务预测结果一致性分布\n目标属性: {target_column}',
            fontsize=14,
            fontweight='bold',
            pad=20
        )
        ax.set_xticks(x)
        ax.set_xticklabels(labels, rotation=15, ha='right')
        ax.grid(axis='y', alpha=0.3, linestyle='--')
        ax.set_axisbelow(True)

    def _plot_pie_chart(
        self,
        ax,
        labels: List[str],
        counts: List[int],
        colors: List[str],
        target_column: str,
        n_tasks: int
    ):
        """绘制饼图"""
        # 只显示非零的部分
        non_zero_indices = [i for i, c in enumerate(counts) if c > 0]
        if not non_zero_indices:
            ax.text(0.5, 0.5, '无数据', ha='center', va='center', fontsize=14)
            return

        filtered_labels = [labels[i] for i in non_zero_indices]
        filtered_counts = [counts[i] for i in non_zero_indices]
        filtered_colors = [colors[i] for i in non_zero_indices]

        # 计算百分比
        total = sum(filtered_counts)
        percentages = [c / total * 100 for c in filtered_counts]

        # 绘制饼图
        wedges, texts, autotexts = ax.pie(
            filtered_counts,
            labels=filtered_labels,
            colors=filtered_colors,
            autopct='%1.1f%%',
            startangle=90,
            textprops={'fontsize': 10, 'fontweight': 'bold'},
            pctdistance=0.85
        )

        # 设置百分比文字颜色为白色
        for autotext in autotexts:
            autotext.set_color('white')
            autotext.set_fontsize(11)

        ax.set_title(
            f'{n_tasks}个任务预测结果一致性分布\n目标属性: {target_column}',
            fontsize=14,
            fontweight='bold',
            pad=20
        )

    def generate_comparison_report(
        self,
        comparison_result: Dict[str, Any],
        output_path: Optional[Path] = None
    ) -> str:
        """
        生成对比分析文本报告

        Args:
            comparison_result: 对比分析结果
            output_path: 输出文件路径，如果为None则只返回文本

        Returns:
            报告文本
        """
        report_lines = []
        report_lines.append("=" * 80)
        report_lines.append("任务预测结果对比分析报告")
        report_lines.append("=" * 80)
        report_lines.append("")

        # 基本信息
        report_lines.append(f"对比任务数: {comparison_result['n_tasks']}")
        report_lines.append(f"任务ID列表: {', '.join(comparison_result['task_ids'])}")
        report_lines.append(f"目标属性: {comparison_result['target_column']}")
        report_lines.append(f"容差设置: {comparison_result['tolerance']}%")
        report_lines.append(f"共有样本数: {comparison_result['total_samples']}")
        report_lines.append("")

        # 一致性分布统计
        report_lines.append("-" * 80)
        report_lines.append("一致性分布统计")
        report_lines.append("-" * 80)
        report_lines.append(f"{'一致性级别':<30} {'样本数':>10} {'占比':>10}")
        report_lines.append("-" * 80)

        distribution = comparison_result['consistency_distribution']
        sorted_items = sorted(
            distribution.items(),
            key=lambda x: x[1]['level'],
            reverse=True
        )

        for label, data in sorted_items:
            count = data['count']
            percentage = data['percentage']
            report_lines.append(f"{label:<30} {count:>10} {percentage:>9.1f}%")

        report_lines.append("-" * 80)
        report_lines.append("")

        # 关键发现
        report_lines.append("-" * 80)
        report_lines.append("关键发现")
        report_lines.append("-" * 80)

        n_tasks = comparison_result['n_tasks']
        full_agreement = distribution.get(f"全部{n_tasks}个任务一致", {}).get('count', 0)
        full_disagreement = distribution.get(f"全部{n_tasks}个任务都不同", {}).get('count', 0)
        total = comparison_result['total_samples']

        if total > 0:
            report_lines.append(f"• 完全一致的样本: {full_agreement} ({full_agreement/total*100:.1f}%)")
            report_lines.append(f"• 完全不一致的样本: {full_disagreement} ({full_disagreement/total*100:.1f}%)")

            # 计算平均一致性
            levels = comparison_result['consistency_levels']
            avg_level = np.mean(levels)
            report_lines.append(f"• 平均一致性级别: {avg_level:.2f} / {n_tasks}")

        report_lines.append("-" * 80)
        report_lines.append("")

        report_text = "\n".join(report_lines)

        # 保存到文件
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report_text)
            logger.info(f"对比报告已保存到: {output_path}")

        return report_text

    def _calculate_multi_target_consistency(
        self,
        predictions_by_target: Dict[str, np.ndarray],
        task_ids: List[str],
        target_columns: List[str],
        tolerance: float
    ) -> Dict[str, Any]:
        """
        计算多目标属性的联合一致性

        Args:
            predictions_by_target: 每个目标属性的预测矩阵 {target: (样本数, 任务数)}
            task_ids: 任务ID列表
            target_columns: 目标列名列表
            tolerance: 容差值

        Returns:
            一致性统计结果
        """
        n_tasks = len(task_ids)
        n_samples = list(predictions_by_target.values())[0].shape[0]

        # 对每个样本，检查所有目标属性是否都一致
        consistency_levels = []
        for sample_idx in range(n_samples):
            # 获取该样本在所有目标属性上的预测值
            # sample_preds_all_targets: {target: [task1_pred, task2_pred, ...]}
            sample_preds_all_targets = {}
            for target in target_columns:
                sample_preds_all_targets[target] = predictions_by_target[target][sample_idx]

            # 计算该样本的一致性级别（所有目标属性都要一致）
            level = self._get_multi_target_consistency_level(
                sample_preds_all_targets,
                tolerance
            )
            consistency_levels.append(level)

        # 统计各一致性级别的样本数
        level_counts = Counter(consistency_levels)

        # 构建统计结果
        consistency_distribution = {}
        for level in range(n_tasks, 0, -1):
            count = level_counts.get(level, 0)
            percentage = (count / n_samples * 100) if n_samples > 0 else 0

            if level == n_tasks:
                label = f"全部{n_tasks}个任务一致"
            elif level == 1:
                label = f"全部{n_tasks}个任务都不同"
            else:
                label = f"恰好{level}个任务一致"

            consistency_distribution[label] = {
                'count': count,
                'percentage': percentage,
                'level': level
            }

        return {
            'task_ids': task_ids,
            'n_tasks': n_tasks,
            'consistency_distribution': consistency_distribution,
            'consistency_levels': consistency_levels
        }

    def _get_multi_target_consistency_level(
        self,
        sample_preds_all_targets: Dict[str, np.ndarray],
        tolerance: float
    ) -> int:
        """
        计算单个样本在多目标属性下的一致性级别

        只有当所有目标属性的预测值都一致时，才认为两个任务一致

        Args:
            sample_preds_all_targets: {target: [task1_pred, task2_pred, ...]}
            tolerance: 容差值

        Returns:
            一致性级别（最大一致任务数）
        """
        n_tasks = len(list(sample_preds_all_targets.values())[0])

        # 对于每对任务，检查所有目标属性是否都一致
        task_similarity_matrix = np.ones((n_tasks, n_tasks), dtype=bool)

        for i in range(n_tasks):
            for j in range(i + 1, n_tasks):
                # 检查任务i和任务j在所有目标属性上是否都一致
                all_targets_agree = True
                for target, preds in sample_preds_all_targets.items():
                    if not self._is_similar(preds[i], preds[j], tolerance):
                        all_targets_agree = False
                        break

                task_similarity_matrix[i, j] = all_targets_agree
                task_similarity_matrix[j, i] = all_targets_agree

        # 找到最大的一致任务组
        max_group_size = 1
        for i in range(n_tasks):
            # 找到与任务i一致的所有任务（包括自己）
            similar_tasks = [i]
            for j in range(n_tasks):
                if i != j and task_similarity_matrix[i, j]:
                    # 检查j是否与similar_tasks中的所有任务都一致
                    all_agree = all(task_similarity_matrix[j, k] for k in similar_tasks)
                    if all_agree:
                        similar_tasks.append(j)

            max_group_size = max(max_group_size, len(similar_tasks))

        return max_group_size




    def _get_multi_target_sample_details(
        self,
        predictions_by_target: Dict[str, np.ndarray],
        sample_indices: List[int],
        task_ids: List[str],
        target_columns: List[str],
        tolerance: float,
        task_dfs: Dict[str, pd.DataFrame]
    ) -> List[Dict[str, Any]]:
        """
        获取多目标属性对比的样本详情

        Args:
            predictions_by_target: 每个目标属性的预测矩阵
            sample_indices: 样本索引列表
            task_ids: 任务ID列表
            target_columns: 目标列名列表
            tolerance: 容差值
            task_dfs: 任务数据框字典

        Returns:
            样本详情列表
        """
        details = []

        # 获取第一个任务的数据框来提取实际值
        first_task_df = task_dfs[task_ids[0]]
        if 'sample_index' in first_task_df.columns:
            first_task_df = first_task_df.set_index('sample_index')

        for i, sample_idx in enumerate(sample_indices):
            # 获取该样本在所有目标属性上的预测值
            sample_preds_all_targets = {}
            for target in target_columns:
                sample_preds_all_targets[target] = predictions_by_target[target][i]

            # 计算一致性级别
            level = self._get_multi_target_consistency_level(
                sample_preds_all_targets,
                tolerance
            )

            # 构建详情字典
            detail = {
                'sample_index': int(sample_idx),
                'consistency_level': level,
                'targets': {}
            }

            # 为每个目标属性添加实际值和预测值
            for target in target_columns:
                actual_value = None
                if target in first_task_df.columns:
                    actual_value = float(first_task_df.loc[sample_idx, target])

                detail['targets'][target] = {
                    'actual_value': actual_value,
                    'predictions': {
                        task_id: float(pred) if not pd.isna(pred) else None
                        for task_id, pred in zip(task_ids, sample_preds_all_targets[target])
                    }
                }

            details.append(detail)

        return details

    def _calculate_target_metrics(
        self,
        predictions_by_target: Dict[str, np.ndarray],
        task_ids: List[str],
        target_columns: List[str],
        task_dfs: Dict[str, pd.DataFrame],
        common_indices: List[int]
    ) -> Dict[str, Any]:
        """
        计算每个目标属性、每个任务的性能指标

        Args:
            predictions_by_target: 每个目标属性的预测矩阵
            task_ids: 任务ID列表
            target_columns: 目标列名列表
            task_dfs: 任务数据框字典
            common_indices: 共同样本索引

        Returns:
            {target: {task_id: {mae, rmse, r2}}}
        """
        target_metrics = {}

        # 获取第一个任务的数据框来提取实际值
        first_task_df = task_dfs[task_ids[0]]
        if 'sample_index' in first_task_df.columns:
            first_task_df = first_task_df.set_index('sample_index')

        for target in target_columns:
            # 获取实际值
            actual_values = [first_task_df.loc[idx, target] for idx in common_indices]
            actual_values = np.array(actual_values)

            target_metrics[target] = {}

            # 为每个任务计算指标
            for task_idx, task_id in enumerate(task_ids):
                predicted_values = predictions_by_target[target][:, task_idx]

                # 计算MAE
                mae = np.mean(np.abs(predicted_values - actual_values))

                # 计算RMSE
                rmse = np.sqrt(np.mean((predicted_values - actual_values) ** 2))

                # 计算R²
                ss_total = np.sum((actual_values - np.mean(actual_values)) ** 2)
                ss_residual = np.sum((actual_values - predicted_values) ** 2)
                r2 = 1 - (ss_residual / ss_total) if ss_total > 0 else 0

                target_metrics[target][task_id] = {
                    'mae': float(mae),
                    'rmse': float(rmse),
                    'r2': float(r2)
                }

        return target_metrics
