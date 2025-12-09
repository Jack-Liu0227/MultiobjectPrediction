"""
为现有的预测结果添加 confidence 字段

功能：
1. 从 process_details.json 中读取每个样本的 llm_response
2. 使用 LLMResponseParser.extract_confidence() 提取 confidence 值
3. 将 confidence 添加到 process_details.json 的每个样本中
4. 将 confidence 添加到 predictions.csv 中
5. 不修改 metrics.json（metrics 是针对整体数据集的，不需要 confidence）

使用方法：
    python scripts/add_confidence_to_existing_results.py <task_id>
    python scripts/add_confidence_to_existing_results.py --all  # 处理所有任务
"""

import sys
import json
from pathlib import Path
import pandas as pd

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from backend.services.simple_rag_engine import LLMResponseParser


def add_confidence_to_task(task_dir: Path, dry_run: bool = False) -> dict:
    """为单个任务添加 confidence 字段
    
    Args:
        task_dir: 任务目录路径
        dry_run: 是否为试运行模式（不实际写入文件）
    
    Returns:
        统计信息字典
    """
    task_id = task_dir.name
    print(f"\n{'='*60}")
    print(f"处理任务: {task_id}")
    print(f"{'='*60}")
    
    stats = {
        'task_id': task_id,
        'total_samples': 0,
        'samples_with_confidence': 0,
        'samples_without_confidence': 0,
        'updated_process_details': False,
        'updated_predictions_csv': False,
    }
    
    # 1. 读取 process_details.json
    process_details_file = task_dir / "process_details.json"
    if not process_details_file.exists():
        print(f"❌ process_details.json 不存在")
        return stats
    
    with open(process_details_file, 'r', encoding='utf-8') as f:
        process_details = json.load(f)
    
    stats['total_samples'] = len(process_details)
    print(f"📊 总样本数: {stats['total_samples']}")
    
    # 2. 为每个样本提取 confidence
    parser = LLMResponseParser()
    updated_count = 0
    
    for detail in process_details:
        llm_response = detail.get('llm_response', '')
        
        # 如果已经有 confidence 字段，跳过
        if 'confidence' in detail and detail['confidence'] is not None:
            stats['samples_with_confidence'] += 1
            continue
        
        # 提取 confidence
        confidence = parser.extract_confidence(llm_response)
        detail['confidence'] = confidence
        
        if confidence:
            stats['samples_with_confidence'] += 1
        else:
            stats['samples_without_confidence'] += 1
        
        updated_count += 1
    
    print(f"✅ 已提取 confidence: {stats['samples_with_confidence']} 个样本有 confidence")
    print(f"⚠️  无 confidence: {stats['samples_without_confidence']} 个样本")
    
    # 3. 保存更新后的 process_details.json
    if not dry_run and updated_count > 0:
        # 创建备份
        backup_file = task_dir / "process_details.json.backup_before_confidence"
        if not backup_file.exists():
            import shutil
            shutil.copy2(process_details_file, backup_file)
            print(f"💾 已创建备份: {backup_file.name}")
        
        with open(process_details_file, 'w', encoding='utf-8') as f:
            json.dump(process_details, f, indent=2, ensure_ascii=False)
        print(f"💾 已更新 process_details.json")
        stats['updated_process_details'] = True
    
    # 4. 更新 predictions.csv（添加 confidence 列）
    predictions_file = task_dir / "predictions.csv"
    if predictions_file.exists():
        df = pd.read_csv(predictions_file)
        
        # 创建 confidence 列（如果不存在）
        if 'confidence' not in df.columns:
            # 根据 sample_index 匹配 confidence
            confidence_map = {detail['sample_index']: detail.get('confidence') for detail in process_details}
            df['confidence'] = df['sample_index'].map(confidence_map)
            
            if not dry_run:
                df.to_csv(predictions_file, index=False, encoding='utf-8')
                print(f"💾 已更新 predictions.csv（添加 confidence 列）")
                stats['updated_predictions_csv'] = True
        else:
            print(f"ℹ️  predictions.csv 已包含 confidence 列")
    
    return stats


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='为现有预测结果添加 confidence 字段')
    parser.add_argument('task_id', nargs='?', help='任务ID（如果不指定，使用 --all 处理所有任务）')
    parser.add_argument('--all', action='store_true', help='处理所有任务')
    parser.add_argument('--dry-run', action='store_true', help='试运行模式（不实际写入文件）')
    
    args = parser.parse_args()
    
    results_dir = project_root / "storage" / "results"
    
    if args.all:
        # 处理所有任务
        task_dirs = [d for d in results_dir.iterdir() if d.is_dir()]
        print(f"找到 {len(task_dirs)} 个任务")
        
        all_stats = []
        for task_dir in task_dirs:
            stats = add_confidence_to_task(task_dir, dry_run=args.dry_run)
            all_stats.append(stats)
        
        # 打印总结
        print(f"\n{'='*60}")
        print("总结")
        print(f"{'='*60}")
        total_tasks = len(all_stats)
        total_samples = sum(s['total_samples'] for s in all_stats)
        total_with_confidence = sum(s['samples_with_confidence'] for s in all_stats)
        total_without_confidence = sum(s['samples_without_confidence'] for s in all_stats)
        
        print(f"处理任务数: {total_tasks}")
        print(f"总样本数: {total_samples}")
        print(f"有 confidence: {total_with_confidence}")
        print(f"无 confidence: {total_without_confidence}")
        
    elif args.task_id:
        # 处理单个任务
        task_dir = results_dir / args.task_id
        if not task_dir.exists():
            print(f"❌ 任务目录不存在: {task_dir}")
            sys.exit(1)
        
        add_confidence_to_task(task_dir, dry_run=args.dry_run)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

