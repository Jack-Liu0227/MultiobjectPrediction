"""批量更新预测结果脚本

完整的预测结果更新工作流程：
1. 从 process_details.json 中读取所有样本的 llm_response
2. 使用 LLMResponseParser 重新解析 llm_response，提取预测值
3. 用重新解析的预测值更新 process_details.json 中的 predicted_values（更新前创建备份）
4. 更新或创建 predictions.csv（如不存在则从 test_set.csv 创建）
5. 重新计算并更新 metrics.json（R², RMSE, MAE, MAPE）

备份策略：
- 仅 process_details.json 在更新前创建带时间戳的备份
- predictions.csv 和 metrics.json 直接覆盖，不创建备份

功能模块:
1. 文件读取模块 - 读取 process_details.json、predictions.csv、test_set.csv
2. LLM 响应解析模块 - 使用优化后的解析逻辑
3. 结果对比验证模块 - 对比解析结果与已保存的预测值
4. CSV/JSON 文件写入模块 - 保存验证报告和更新结果
5. 指标计算模块 - 重新计算评估指标
"""
import sys
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import pandas as pd
import numpy as np

# 添加backend到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from services.simple_rag_engine import SimpleRAGEngine, LLMResponseParser


# ============================================================================
# 模块化组件
# ============================================================================

class FileReader:
    """文件读取模块"""

    @staticmethod
    def read_process_details(task_dir: Path) -> Optional[List[Dict]]:
        """读取 process_details.json

        Args:
            task_dir: 任务目录

        Returns:
            process_details 列表，失败返回 None
        """
        file_path = task_dir / "process_details.json"
        if not file_path.exists():
            return None

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"  ⚠️  读取 process_details.json 失败: {e}")
            return None

    @staticmethod
    def read_predictions_csv(task_dir: Path) -> Optional[pd.DataFrame]:
        """读取 predictions.csv

        Args:
            task_dir: 任务目录

        Returns:
            predictions DataFrame，失败返回 None
        """
        file_path = task_dir / "predictions.csv"
        if not file_path.exists():
            return None

        try:
            return pd.read_csv(file_path)
        except Exception as e:
            print(f"  ⚠️  读取 predictions.csv 失败: {e}")
            return None

    @staticmethod
    def read_test_set_csv(task_dir: Path) -> Optional[pd.DataFrame]:
        """读取 test_set.csv

        Args:
            task_dir: 任务目录

        Returns:
            test_set DataFrame，失败返回 None
        """
        file_path = task_dir / "test_set.csv"
        if not file_path.exists():
            return None

        try:
            return pd.read_csv(file_path)
        except Exception as e:
            print(f"  ⚠️  读取 test_set.csv 失败: {e}")
            return None


class ResponseParser:
    """LLM 响应解析模块"""

    def __init__(self):
        self.parser = LLMResponseParser()

    def parse_response(
        self,
        llm_response: str,
        target_columns: List[str]
    ) -> Dict[str, float]:
        """解析 LLM 响应

        Args:
            llm_response: LLM 响应文本
            target_columns: 目标属性列名列表

        Returns:
            解析后的预测值字典
        """
        return self.parser.parse(llm_response, target_columns)


class ResultComparator:
    """结果对比验证模块"""

    @staticmethod
    def compare_predictions(
        parsed_values: Dict[str, float],
        saved_values: Dict[str, float],
        tolerance: float = 1e-6
    ) -> Dict[str, any]:
        """对比解析结果与已保存的预测值

        Args:
            parsed_values: 解析得到的预测值
            saved_values: 已保存的预测值
            tolerance: 数值比较容差

        Returns:
            对比结果字典，包含 is_match, differences 等信息
        """
        is_match = True
        differences = {}

        for key in parsed_values.keys():
            parsed_val = parsed_values.get(key, 0.0)
            saved_val = saved_values.get(key, 0.0)

            diff = abs(parsed_val - saved_val)
            differences[key] = {
                'parsed': parsed_val,
                'saved': saved_val,
                'diff': diff
            }

            if diff > tolerance:
                is_match = False

        return {
            'is_match': is_match,
            'differences': differences
        }


class MetricsCalculator:
    """指标计算模块"""

    @staticmethod
    def calculate_metrics(
        df: pd.DataFrame,
        target_columns: List[str]
    ) -> Dict[str, Dict[str, float]]:
        """计算预测指标

        Args:
            df: 包含真实值和预测值的 DataFrame
            target_columns: 目标属性列名列表

        Returns:
            指标字典
        """
        from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
        import math

        metrics = {}

        for target_col in target_columns:
            pred_col = f"{target_col}_predicted"

            if pred_col not in df.columns:
                continue

            # 移除空值
            valid_mask = df[target_col].notna() & df[pred_col].notna()
            y_true = df.loc[valid_mask, target_col]
            y_pred = df.loc[valid_mask, pred_col]

            if len(y_true) == 0:
                continue

            # 计算指标
            if len(y_true) >= 2:
                r2 = r2_score(y_true, y_pred)
            else:
                r2 = None

            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            mae = mean_absolute_error(y_true, y_pred)

            # 计算 MAPE
            with np.errstate(divide='ignore', invalid='ignore'):
                mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100

            # 转换为 JSON 兼容的值
            def safe_float(value):
                if value is None:
                    return None
                if isinstance(value, (int, float)):
                    if math.isnan(value) or math.isinf(value):
                        return None
                    return float(value)
                return value

            metrics[target_col] = {
                "r2": safe_float(r2),
                "rmse": safe_float(rmse),
                "mae": safe_float(mae),
                "mape": safe_float(mape)
            }

        return metrics


class PredictionUpdater:
    """预测结果更新器（框架化设计）"""

    def __init__(self, results_dir: Path):
        self.results_dir = results_dir
        self.target_columns = ["UTS(MPa)", "El(%)"]

        # 初始化模块化组件
        self.file_reader = FileReader()
        self.response_parser = ResponseParser()
        self.comparator = ResultComparator()
        self.metrics_calculator = MetricsCalculator()

    def find_all_task_dirs(self) -> List[Path]:
        """查找所有任务目录"""
        task_dirs = []
        if not self.results_dir.exists():
            print(f"❌ 结果目录不存在: {self.results_dir}")
            return task_dirs

        for item in self.results_dir.iterdir():
            if item.is_dir():
                # 检查是否包含必要的文件（只需要 process_details.json）
                process_details_file = item / "process_details.json"
                if process_details_file.exists():
                    task_dirs.append(item)

        return sorted(task_dirs)

    def verify_task_predictions(self, task_dir: Path) -> pd.DataFrame:
        """验证单个任务的预测结果

        Args:
            task_dir: 任务目录

        Returns:
            验证详情 DataFrame
        """
        task_id = task_dir.name
        print(f"\n{'='*80}")
        print(f"验证任务: {task_id}")
        print(f"{'='*80}")

        # 读取 process_details.json
        process_details = self.file_reader.read_process_details(task_dir)
        if not process_details:
            print(f"❌ 无法读取 process_details.json")
            return pd.DataFrame()

        print(f"📋 读取 process_details.json: {len(process_details)} 条记录")

        # 准备验证结果列表
        verification_results = []

        # 遍历每个样本
        for detail in process_details:
            sample_index = detail.get('sample_index')
            llm_response = detail.get('llm_response', '')
            saved_predicted_values = detail.get('predicted_values', {})

            # 解析 LLM 响应
            parsed_values = self.response_parser.parse_response(
                llm_response,
                self.target_columns
            )

            # 对比结果
            comparison = self.comparator.compare_predictions(
                parsed_values,
                saved_predicted_values
            )

            # 构建验证记录
            result = {
                'sample_index': sample_index,
                'is_match': comparison['is_match'],
            }

            # 添加每个目标属性的详细信息
            for target_col in self.target_columns:
                diff_info = comparison['differences'].get(target_col, {})
                result[f'{target_col}_parsed'] = diff_info.get('parsed', 0.0)
                result[f'{target_col}_saved'] = diff_info.get('saved', 0.0)
                result[f'{target_col}_diff'] = diff_info.get('diff', 0.0)

            # 添加匹配到的完整解析结果（JSON 格式字符串）
            import json
            result['parsed_result'] = json.dumps(parsed_values, ensure_ascii=False)
            result['saved_result'] = json.dumps(saved_predicted_values, ensure_ascii=False)

            verification_results.append(result)

        # 转换为 DataFrame
        df_verification = pd.DataFrame(verification_results)

        # 统计信息
        total_samples = len(df_verification)
        matched_samples = df_verification['is_match'].sum()
        mismatched_samples = total_samples - matched_samples

        print(f"✅ 验证完成:")
        print(f"   总样本数: {total_samples}")
        print(f"   匹配样本: {matched_samples}")
        print(f"   不匹配样本: {mismatched_samples}")

        return df_verification

    def update_predictions_and_metrics(
        self,
        task_dir: Path,
        df_verification: pd.DataFrame,
        dry_run: bool = False,
        update_all: bool = False
    ) -> Dict:
        """根据验证结果更新 predictions.csv 和 metrics.json

        Args:
            task_dir: 任务目录
            df_verification: 验证详情 DataFrame
            dry_run: 是否为试运行模式
            update_all: 是否更新所有样本（包括匹配的样本）

        Returns:
            更新统计信息
        """
        task_id = task_dir.name
        stats = {
            'updated_predictions': 0,
            'updated_metrics': False,
            'created_predictions_csv': False
        }

        # 读取 process_details.json
        process_details = self.file_reader.read_process_details(task_dir)
        if not process_details:
            print(f"❌ 无法读取 process_details.json")
            return stats

        # 读取或创建 predictions.csv
        df_predictions = self.file_reader.read_predictions_csv(task_dir)

        if df_predictions is None:
            # predictions.csv 不存在，需要从 test_set.csv 创建
            print(f"📝 predictions.csv 不存在，从 test_set.csv 创建...")
            df_test_set = self.file_reader.read_test_set_csv(task_dir)

            if df_test_set is None:
                print(f"❌ 无法读取 test_set.csv，无法创建 predictions.csv")
                return stats

            # 创建 predictions.csv，包含 test_set.csv 的所有列
            df_predictions = df_test_set.copy()

            # 添加 sample_index 列（如果不存在）
            if 'sample_index' not in df_predictions.columns:
                df_predictions.insert(0, 'sample_index', range(len(df_predictions)))

            # 添加预测值列
            for target_col in self.target_columns:
                pred_col = f"{target_col}_predicted"
                df_predictions[pred_col] = 0.0

            stats['created_predictions_csv'] = True
            print(f"✅ 已创建 predictions.csv 框架，包含 {len(df_predictions)} 行")
        else:
            print(f"📋 读取现有 predictions.csv: {len(df_predictions)} 行")

        # 根据 update_all 参数决定更新哪些样本
        if update_all:
            rows_to_update = df_verification
            print(f"🔄 更新所有 {len(rows_to_update)} 个样本...")
        else:
            rows_to_update = df_verification[~df_verification['is_match']]
            if len(rows_to_update) == 0:
                print(f"✅ 所有样本预测值一致，无需更新")
                return stats
            print(f"🔄 更新 {len(rows_to_update)} 个不匹配样本...")

        for _, row in rows_to_update.iterrows():
            sample_index = row['sample_index']

            # 在 predictions.csv 中查找对应行
            if 'sample_index' in df_predictions.columns:
                mask = df_predictions['sample_index'] == sample_index
            else:
                mask = df_predictions.index == sample_index

            if not mask.any():
                print(f"  ⚠️  未找到样本索引 {sample_index}")
                continue

            row_idx = df_predictions[mask].index[0]

            # 更新预测值
            for target_col in self.target_columns:
                pred_col = f"{target_col}_predicted"
                parsed_value = row[f'{target_col}_parsed']

                if pred_col not in df_predictions.columns:
                    df_predictions[pred_col] = 0.0

                old_value = df_predictions.loc[row_idx, pred_col]
                df_predictions.loc[row_idx, pred_col] = parsed_value

                if update_all or old_value != parsed_value:
                    print(f"  ✓ 样本 {sample_index} - {target_col}: {old_value} → {parsed_value}")

            # 更新 process_details 中的 predicted_values
            for detail in process_details:
                if detail.get('sample_index') == sample_index:
                    detail['predicted_values'] = {
                        target_col: row[f'{target_col}_parsed']
                        for target_col in self.target_columns
                    }
                    break

            stats['updated_predictions'] += 1

        # 保存更新后的文件
        if not dry_run:
            # 创建备份时间戳
            backup_time = datetime.now().strftime("%Y%m%d_%H%M%S")

            # 保存 predictions.csv（不创建备份）
            predictions_file = task_dir / "predictions.csv"
            df_predictions.to_csv(predictions_file, index=False, encoding='utf-8')
            if stats['created_predictions_csv']:
                print(f"💾 已创建 predictions.csv")
            else:
                print(f"💾 已更新 predictions.csv")

            # 备份并保存 process_details.json（仅此文件需要备份）
            process_details_file = task_dir / "process_details.json"
            process_details_backup = task_dir / f"process_details.json.backup"
            shutil.copy2(process_details_file, process_details_backup)

            with open(process_details_file, 'w', encoding='utf-8') as f:
                json.dump(process_details, f, indent=2, ensure_ascii=False)
            print(f"💾 已更新 process_details.json (备份: {process_details_backup.name})")

            # 重新计算并保存 metrics.json（不创建备份）
            metrics = self.metrics_calculator.calculate_metrics(
                df_predictions,
                self.target_columns
            )
            metrics_file = task_dir / "metrics.json"
            with open(metrics_file, 'w', encoding='utf-8') as f:
                json.dump(metrics, f, indent=2, ensure_ascii=False)
            print(f"💾 已{'更新' if metrics_file.exists() else '创建'} metrics.json")
            stats['updated_metrics'] = True

        return stats

    def process_task(self, task_dir: Path, dry_run: bool = False, update_all: bool = False) -> Dict:
        """处理单个任务：验证、对比、更新

        Args:
            task_dir: 任务目录
            dry_run: 是否为试运行模式
            update_all: 是否更新所有样本（包括匹配的样本）

        Returns:
            处理统计信息
        """
        task_id = task_dir.name

        # 步骤1: 验证预测结果
        df_verification = self.verify_task_predictions(task_dir)

        if df_verification.empty:
            return {
                'task_id': task_id,
                'total_samples': 0,
                'matched_samples': 0,
                'mismatched_samples': 0,
                'updated_samples': 0,
                'errors': 1
            }

        # 步骤2: 保存验证报告
        verification_file = task_dir / f"{task_id}_verification_details.csv"
        if not dry_run:
            df_verification.to_csv(verification_file, index=False, encoding='utf-8')
            print(f"📊 已保存验证报告: {verification_file.name}")

        # 步骤3: 更新预测结果和指标
        update_stats = self.update_predictions_and_metrics(
            task_dir,
            df_verification,
            dry_run,
            update_all
        )

        # 汇总统计信息
        total_samples = len(df_verification)
        matched_samples = df_verification['is_match'].sum()
        mismatched_samples = total_samples - matched_samples

        stats = {
            'task_id': task_id,
            'total_samples': total_samples,
            'matched_samples': int(matched_samples),
            'mismatched_samples': int(mismatched_samples),
            'updated_samples': update_stats['updated_predictions'],
            'updated_metrics': update_stats['updated_metrics'],
            'errors': 0
        }

        return stats

    def run_batch_verification(self, dry_run: bool = False, task_filter: str = None, update_all: bool = False):
        """批量验证和更新所有任务

        Args:
            dry_run: 是否为试运行模式
            task_filter: 任务ID过滤器(可选,支持部分匹配)
            update_all: 是否更新所有样本（包括匹配的样本）
        """
        print(f"\n{'='*80}")
        print(f"批量验证和更新预测结果")
        print(f"结果目录: {self.results_dir}")
        print(f"模式: {'试运行(不写入文件)' if dry_run else '正式运行'}")
        print(f"更新策略: {'更新所有样本' if update_all else '仅更新不匹配样本'}")
        if task_filter:
            print(f"过滤器: {task_filter}")
        print(f"{'='*80}")

        # 查找所有任务目录
        task_dirs = self.find_all_task_dirs()

        if task_filter:
            task_dirs = [d for d in task_dirs if task_filter in d.name]

        if not task_dirs:
            print("❌ 未找到任何任务目录")
            return

        print(f"\n找到 {len(task_dirs)} 个任务目录")

        # 统计信息
        all_stats = []
        total_samples = 0
        total_matched = 0
        total_mismatched = 0
        total_updated = 0
        total_errors = 0

        # 处理每个任务
        for i, task_dir in enumerate(task_dirs, 1):
            print(f"\n[{i}/{len(task_dirs)}]", end=" ")
            stats = self.process_task(task_dir, dry_run=dry_run, update_all=update_all)
            all_stats.append(stats)

            total_samples += stats['total_samples']
            total_matched += stats['matched_samples']
            total_mismatched += stats['mismatched_samples']
            total_updated += stats['updated_samples']
            total_errors += stats['errors']

        # 输出总体统计
        print(f"\n{'='*80}")
        print(f"批量验证完成")
        print(f"{'='*80}")
        print(f"处理任务数: {len(task_dirs)}")
        print(f"总样本数: {total_samples}")
        print(f"匹配样本数: {total_matched}")
        print(f"不匹配样本数: {total_mismatched}")
        print(f"更新样本数: {total_updated}")
        print(f"错误数: {total_errors}")

        # 输出详细统计表
        print(f"\n{'='*80}")
        print(f"详细统计")
        print(f"{'='*80}")
        print(f"{'任务ID':<40} {'总数':>8} {'匹配':>8} {'不匹配':>8} {'已更新':>8} {'错误':>8}")
        print(f"{'-'*80}")

        for stats in all_stats:
            if stats['total_samples'] > 0:
                print(
                    f"{stats['task_id']:<40} "
                    f"{stats['total_samples']:>8} "
                    f"{stats['matched_samples']:>8} "
                    f"{stats['mismatched_samples']:>8} "
                    f"{stats['updated_samples']:>8} "
                    f"{stats['errors']:>8}"
                )

        print(f"{'='*80}")

        # 保存统计报告
        if not dry_run:
            report_file = self.results_dir / f"verification_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(report_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'timestamp': datetime.now().isoformat(),
                    'total_tasks': len(task_dirs),
                    'total_samples': total_samples,
                    'total_matched': total_matched,
                    'total_mismatched': total_mismatched,
                    'total_updated': total_updated,
                    'total_errors': total_errors,
                    'task_stats': all_stats
                }, f, indent=2, ensure_ascii=False)
            print(f"\n📊 验证报告已保存: {report_file}")


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(
        description='批量验证和更新预测结果',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
功能说明:
  本脚本实现完整的预测结果更新工作流程：

  1. 数据提取和解析
     - 从 process_details.json 中读取所有样本的 llm_response
     - 使用 LLMResponseParser 重新解析 llm_response，提取预测值
     - 用重新解析的预测值更新 process_details.json 中的 predicted_values

  2. predictions.csv 文件更新
     - 如果 predictions.csv 已存在：读取并更新预测值列
     - 如果 predictions.csv 不存在：从 test_set.csv 创建新文件

  3. metrics.json 文件更新
     - 使用更新后的 predictions.csv 重新计算所有评估指标
     - 计算 R²、RMSE、MAE、MAPE 等指标

  4. 备份策略
     - 仅 process_details.json 在更新前创建带时间戳的备份
     - 备份格式：process_details.json.backup_YYYYMMDD_HHMMSS
     - predictions.csv 和 metrics.json 直接覆盖，不创建备份

  5. 验证报告
     - 保存验证详情到 {task_id}_verification_details.csv
     - 生成总体统计报告

示例:
  # 试运行模式(不实际写入文件，仅显示将要执行的操作)
  python scripts/batch_update_predictions.py --dry-run

  # 正式运行，验证和更新所有任务(仅更新不匹配的样本)
  python scripts/batch_update_predictions.py

  # 更新所有样本(包括解析结果与已保存值一致的样本)
  python scripts/batch_update_predictions.py --update-all

  # 只处理特定任务(支持部分匹配)
  python scripts/batch_update_predictions.py --filter 4610455b

  # 指定结果目录
  python scripts/batch_update_predictions.py --results-dir storage/results

  # 组合使用
  python scripts/batch_update_predictions.py --filter 4610455b --update-all
        """
    )

    parser.add_argument(
        '--results-dir',
        type=str,
        default='storage/results',
        help='结果目录路径 (默认: storage/results)'
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='试运行模式,不实际写入文件'
    )

    parser.add_argument(
        '--filter',
        type=str,
        help='任务ID过滤器(支持部分匹配)'
    )

    parser.add_argument(
        '--update-all',
        action='store_true',
        help='更新所有样本(包括匹配的样本),默认仅更新不匹配的样本'
    )

    args = parser.parse_args()

    # 获取项目根目录
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    results_dir = project_root / args.results_dir

    # 创建更新器并运行
    updater = PredictionUpdater(results_dir)
    updater.run_batch_verification(
        dry_run=args.dry_run,
        task_filter=args.filter,
        update_all=args.update_all
    )


if __name__ == '__main__':
    main()

