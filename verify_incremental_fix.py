"""
验证增量预测修复的脚本

测试场景：
1. 首次预测：sample_size=6，应该选择索引 [0,1,2,3,4,5]
2. 增量预测：sample_size=7，应该只新增索引 6，总共 [0,1,2,3,4,5,6]
3. sample_index 应该是从 0 开始的连续序列
4. 前端应该显示 ID 列（原始数据的 ID）
"""

import pandas as pd
import json
from pathlib import Path

def verify_sample_indices(result_dir: str):
    """验证 sample_index 是否正确"""
    result_path = Path(result_dir)

    print(f"\n{'='*60}")
    print(f"验证结果目录: {result_dir}")
    print(f"{'='*60}\n")

    # 1. 检查 process_details.json
    process_details_file = result_path / "process_details.json"
    if process_details_file.exists():
        with open(process_details_file, 'r', encoding='utf-8') as f:
            process_details = json.load(f)

        print(f"\n--- process_details.json 检查 ---")
        sample_indices = sorted([detail['sample_index'] for detail in process_details])
        print(f"✓ sample_index: {sample_indices}")

        # 验证是否连续且从0开始
        expected_indices = list(range(len(sample_indices)))
        if sample_indices == expected_indices:
            print(f"✓ sample_index 连续且从 0 开始")
        else:
            print(f"✗ sample_index 不连续！期望: {expected_indices}, 实际: {sample_indices}")

        # 检查 ID 字段
        has_id = all('ID' in detail for detail in process_details)
        if has_id:
            id_values = [detail['ID'] for detail in process_details]
            print(f"✓ ID 字段存在，值: {id_values}")
        else:
            print(f"✗ 部分或全部样本缺少 ID 字段")
    else:
        print(f"✗ 未找到 process_details.json")

    # 2. 检查 predictions.csv
    predictions_file = result_path / "predictions.csv"
    if predictions_file.exists():
        predictions_df = pd.read_csv(predictions_file)

        print(f"\n--- predictions.csv 检查 ---")
        print(f"列名: {predictions_df.columns.tolist()[:10]}...")  # 只显示前10列

        if "sample_index" in predictions_df.columns:
            csv_indices = sorted(predictions_df["sample_index"].tolist())
            print(f"✓ sample_index: {csv_indices}")

            # 验证是否连续且从0开始
            expected_indices = list(range(len(csv_indices)))
            if csv_indices == expected_indices:
                print(f"✓ sample_index 连续且从 0 开始")
            else:
                print(f"✗ sample_index 不连续！期望: {expected_indices}, 实际: {csv_indices}")

            # 验证与 process_details.json 一致
            if csv_indices == sample_indices:
                print(f"✓ predictions.csv 与 process_details.json 的 sample_index 一致")
            else:
                print(f"✗ sample_index 不一致！")
        else:
            print(f"✗ predictions.csv 缺少 sample_index 列")

        # 检查 ID 列
        if "ID" in predictions_df.columns:
            id_values = predictions_df["ID"].tolist()
            print(f"✓ ID 列存在，值: {id_values}")
        else:
            print(f"⚠ predictions.csv 缺少 ID 列")
    else:
        print(f"✗ 未找到 predictions.csv")

    # 3. 检查 test_set.csv
    test_set_file = result_path / "test_set.csv"
    if test_set_file.exists():
        test_df = pd.read_csv(test_set_file)
        print(f"\n--- test_set.csv 检查 ---")
        print(f"✓ test_set.csv 存在，共 {len(test_df)} 行")
        print(f"列名: {test_df.columns.tolist()[:10]}...")  # 只显示前10列
    else:
        print(f"\n✗ 未找到 test_set.csv")

    # 4. 检查溯源文件
    inputs_dir = result_path / "inputs"
    outputs_dir = result_path / "outputs"

    print(f"\n--- 溯源文件检查 ---")
    if inputs_dir.exists() and outputs_dir.exists():
        input_files = sorted([f.name for f in inputs_dir.glob("sample_*.txt")])
        output_files = sorted([f.name for f in outputs_dir.glob("sample_*.txt")])

        # 提取文件名中的 sample_index
        input_indices = sorted(set([int(f.split('_')[1]) for f in input_files]))
        output_indices = sorted(set([int(f.split('_')[1]) for f in output_files]))

        print(f"✓ inputs/ 目录中的 sample_index: {input_indices}")
        print(f"✓ outputs/ 目录中的 sample_index: {output_indices}")

        if input_indices == sample_indices and output_indices == sample_indices:
            print(f"✓ 溯源文件的 sample_index 与预测结果一致")
        else:
            print(f"✗ 溯源文件的 sample_index 不一致！")
    else:
        print(f"⚠ 溯源文件目录不存在")

def compare_with_test_set(result_dir: str, test_set_file: str):
    """对比预测结果与测试集的样本是否匹配"""
    result_path = Path(result_dir)
    predictions_file = result_path / "predictions.csv"
    
    if not predictions_file.exists():
        print(f"✗ 未找到 predictions.csv")
        return
    
    predictions_df = pd.read_csv(predictions_file)
    test_df = pd.read_csv(test_set_file)
    
    if "sample_index" not in predictions_df.columns:
        print(f"✗ predictions.csv 缺少 sample_index 列")
        return
    
    print(f"\n对比预测结果与测试集:")
    for _, row in predictions_df.iterrows():
        sample_idx = int(row["sample_index"])
        
        # 从测试集中获取对应索引的样本
        if sample_idx < len(test_df):
            test_row = test_df.iloc[sample_idx]
            
            # 对比组分列（假设前几列是组分）
            match = True
            for col in test_df.columns[:5]:  # 假设前5列是组分
                if col in row.index:
                    if row[col] != test_row[col]:
                        match = False
                        break
            
            if match:
                print(f"  ✓ sample_index={sample_idx} 匹配")
            else:
                print(f"  ✗ sample_index={sample_idx} 不匹配！")
        else:
            print(f"  ✗ sample_index={sample_idx} 超出测试集范围（测试集共 {len(test_df)} 行）")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("用法: python verify_incremental_fix.py <result_dir> [test_set_file]")
        print("示例: python verify_incremental_fix.py storage/results/9855567a-c357-4b21-86b4-4810243ce0ad")
        sys.exit(1)
    
    result_dir = sys.argv[1]
    print(f"验证结果目录: {result_dir}\n")
    
    verify_sample_indices(result_dir)
    
    if len(sys.argv) >= 3:
        test_set_file = sys.argv[2]
        compare_with_test_set(result_dir, test_set_file)

