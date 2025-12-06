"""
迁移脚本：应用列名映射到现有的 sample_text 字段

将 "Processing_Description:" 替换为 "Heat treatment method:"
"""

import json
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def apply_column_mapping(text: str) -> str:
    """
    应用列名映射到文本

    Args:
        text: 原始文本

    Returns:
        映射后的文本
    """
    # 默认列名映射
    column_name_mapping = {
        "Processing": "Heat treatment method",
        "Processing_Description": "Heat treatment method"
    }

    result = text
    for old_name, new_name in column_name_mapping.items():
        # 替换 "old_name:" 为 "new_name:"
        if f"{old_name}:" in result:
            result = result.replace(f"{old_name}:", f"{new_name}:")

    return result


def migrate_process_details_file(file_path: Path):
    """
    迁移单个 process_details.json 文件
    
    Args:
        file_path: process_details.json 文件路径
    """
    try:
        # 读取文件
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        modified = False
        
        # 处理每个样本
        for sample in data:
            # 更新主样本的 sample_text
            if 'sample_text' in sample and sample['sample_text']:
                old_text = sample['sample_text']
                new_text = apply_column_mapping(old_text)
                if old_text != new_text:
                    sample['sample_text'] = new_text
                    modified = True
            
            # 更新 similar_samples 中的 sample_text
            if 'similar_samples' in sample:
                for sim_sample in sample['similar_samples']:
                    if 'sample_text' in sim_sample and sim_sample['sample_text']:
                        old_text = sim_sample['sample_text']
                        new_text = apply_column_mapping(old_text)
                        if old_text != new_text:
                            sim_sample['sample_text'] = new_text
                            modified = True
        
        # 如果有修改，保存文件
        if modified:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            logger.info(f"✓ 已更新: {file_path}")
            return True
        else:
            logger.info(f"- 无需更新: {file_path}")
            return False
    
    except Exception as e:
        logger.error(f"✗ 处理文件失败 {file_path}: {e}")
        return False


def main():
    """主函数"""
    # 查找所有 process_details.json 文件
    results_dir = Path("storage/results")
    
    if not results_dir.exists():
        logger.error(f"结果目录不存在: {results_dir}")
        return
    
    process_details_files = list(results_dir.glob("*/process_details.json"))
    
    if not process_details_files:
        logger.warning("未找到任何 process_details.json 文件")
        return
    
    logger.info(f"找到 {len(process_details_files)} 个文件")
    
    # 迁移每个文件
    updated_count = 0
    for file_path in process_details_files:
        if migrate_process_details_file(file_path):
            updated_count += 1
    
    logger.info(f"\n迁移完成:")
    logger.info(f"  - 总文件数: {len(process_details_files)}")
    logger.info(f"  - 已更新: {updated_count}")
    logger.info(f"  - 无需更新: {len(process_details_files) - updated_count}")


if __name__ == "__main__":
    main()

