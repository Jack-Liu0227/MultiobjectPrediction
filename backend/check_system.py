#!/usr/bin/env python3
"""
系统完整性检查脚本
检查所有必要的模块、配置和依赖
"""

import sys
import os
from pathlib import Path

def check_imports():
    """检查关键模块导入"""
    print("=" * 60)
    print("检查 Python 模块...")
    print("=" * 60)
    
    modules = {
        'fastapi': 'FastAPI',
        'uvicorn': 'Uvicorn',
        'pandas': 'Pandas',
        'numpy': 'NumPy',
        'sentence_transformers': 'Sentence Transformers',
        'litellm': 'LiteLLM',
        'pydantic': 'Pydantic',
        'sklearn': 'Scikit-learn',
    }
    
    all_ok = True
    for module, name in modules.items():
        try:
            __import__(module)
            print(f"✓ {name:25s} - 已安装")
        except ImportError:
            print(f"✗ {name:25s} - 未安装")
            all_ok = False
    
    return all_ok

def check_rag_model():
    """检查 RAG 模型"""
    print("\n" + "=" * 60)
    print("检查 RAG 模型...")
    print("=" * 60)
    
    project_root = Path(__file__).parent.parent
    model_path = project_root / "all-MiniLM-L6-v2"
    
    if not model_path.exists():
        print(f"✗ 模型目录不存在: {model_path}")
        return False
    
    print(f"✓ 模型目录存在: {model_path}")
    
    required_files = [
        'config.json',
        'model.safetensors',
        'tokenizer.json',
        'modules.json',
        'config_sentence_transformers.json'
    ]
    
    all_ok = True
    for file in required_files:
        file_path = model_path / file
        if file_path.exists():
            print(f"✓ {file:35s} - 存在")
        else:
            print(f"✗ {file:35s} - 缺失")
            all_ok = False
    
    return all_ok

def check_directories():
    """检查必要的目录"""
    print("\n" + "=" * 60)
    print("检查目录结构...")
    print("=" * 60)
    
    project_root = Path(__file__).parent.parent
    
    directories = [
        'storage',
        'storage/uploads',
        'storage/results',
        'storage/cache',
        'storage/tasks',
        'storage/logs',
        'Logs',
    ]
    
    all_ok = True
    for dir_name in directories:
        dir_path = project_root / dir_name
        if dir_path.exists():
            print(f"✓ {dir_name:30s} - 存在")
        else:
            print(f"⚠ {dir_name:30s} - 不存在（将自动创建）")
            try:
                dir_path.mkdir(parents=True, exist_ok=True)
                print(f"  → 已创建: {dir_path}")
            except Exception as e:
                print(f"  → 创建失败: {e}")
                all_ok = False
    
    return all_ok

def check_services():
    """检查服务模块"""
    print("\n" + "=" * 60)
    print("检查服务模块...")
    print("=" * 60)
    
    backend_dir = Path(__file__).parent
    
    services = [
        'services/simple_rag_engine.py',
        'services/rag_prediction_service.py',
        'services/file_handler.py',
        'services/task_manager.py',
        'services/prompt_builder.py',
        'services/pareto_analyzer.py',
    ]
    
    all_ok = True
    for service in services:
        service_path = backend_dir / service
        if service_path.exists():
            print(f"[OK] {service:40s} - 存在")
        else:
            print(f"[FAIL] {service:40s} - 缺失")
            all_ok = False

    return all_ok

def test_rag_model_loading():
    """测试 RAG 模型加载"""
    print("\n" + "=" * 60)
    print("测试 RAG 模型加载...")
    print("=" * 60)
    
    try:
        from sentence_transformers import SentenceTransformer
        project_root = Path(__file__).parent.parent
        model_path = project_root / "all-MiniLM-L6-v2"
        
        print(f"尝试从本地路径加载: {model_path}")
        model = SentenceTransformer(str(model_path), device='cpu')
        print("✓ 模型加载成功")
        
        # 测试编码
        test_text = ["This is a test sentence"]
        embeddings = model.encode(test_text)
        print(f"✓ 模型编码测试成功 (embedding shape: {embeddings.shape})")
        
        return True
    except Exception as e:
        print(f"✗ 模型加载失败: {e}")
        return False

def main():
    """主函数"""
    print("\n" + "=" * 60)
    print("多目标优化预测系统 - 系统完整性检查")
    print("=" * 60 + "\n")
    
    results = {
        'Python 模块': check_imports(),
        'RAG 模型文件': check_rag_model(),
        '目录结构': check_directories(),
        '服务模块': check_services(),
        'RAG 模型加载': test_rag_model_loading(),
    }
    
    print("\n" + "=" * 60)
    print("检查结果汇总")
    print("=" * 60)
    
    for check_name, result in results.items():
        status = "✓ 通过" if result else "✗ 失败"
        print(f"{check_name:20s}: {status}")
    
    all_passed = all(results.values())
    
    print("\n" + "=" * 60)
    if all_passed:
        print("✓ 所有检查通过，系统就绪！")
        return 0
    else:
        print("✗ 部分检查失败，请修复后再启动系统")
        return 1

if __name__ == "__main__":
    sys.exit(main())

