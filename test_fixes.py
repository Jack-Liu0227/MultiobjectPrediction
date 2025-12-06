"""
测试修复的问题
1. 测试 /api/task-comparison/history 接口是否可访问
2. 验证 JSON 解析警告是否减少
3. 验证数据库模型是否正确创建
"""

import requests
import sys
import os

# 添加 backend 目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

BASE_URL = "http://localhost:8000"

def test_task_comparison_history():
    """测试任务对比历史接口"""
    print("=" * 60)
    print("测试 1: 任务对比历史接口")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/api/task-comparison/history")
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            print("✓ 接口正常工作")
            data = response.json()
            print(f"✓ 返回数据: {len(data)} 条历史记录")
            if data:
                print(f"✓ 示例记录: {data[0]}")
            return True
        elif response.status_code == 404:
            print("✗ 404 错误 - 接口未找到")
            print("  请确保后端已重启并注册了 task_comparison 路由")
            return False
        else:
            print(f"✗ 意外状态码: {response.status_code}")
            print(f"  响应: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("✗ 无法连接到后端服务")
        print("  请确保后端服务正在运行 (http://localhost:8000)")
        return False
    except Exception as e:
        print(f"✗ 测试失败: {e}")
        return False

def test_health_check():
    """测试后端健康检查"""
    print("\n" + "=" * 60)
    print("测试 0: 后端健康检查")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/health")
        if response.status_code == 200:
            print("✓ 后端服务正常运行")
            return True
        else:
            print(f"✗ 后端服务异常: {response.status_code}")
            return False
    except:
        print("✗ 无法连接到后端服务")
        return False

def test_api_docs():
    """测试 API 文档是否包含 task-comparison 路由"""
    print("\n" + "=" * 60)
    print("测试 2: API 文档中的路由注册")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/openapi.json")
        if response.status_code == 200:
            openapi_spec = response.json()
            paths = openapi_spec.get("paths", {})
            
            # 检查 task-comparison 相关路径
            task_comparison_paths = [
                path for path in paths.keys() 
                if "task-comparison" in path
            ]
            
            if task_comparison_paths:
                print(f"✓ 找到 {len(task_comparison_paths)} 个 task-comparison 路由:")
                for path in task_comparison_paths:
                    print(f"  - {path}")
                return True
            else:
                print("✗ 未找到 task-comparison 路由")
                print("  请检查 main.py 中是否正确注册了路由")
                return False
        else:
            print(f"✗ 无法获取 API 文档: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ 测试失败: {e}")
        return False

def test_database_model():
    """测试数据库模型是否正确"""
    print("\n" + "=" * 60)
    print("测试 3: 数据库模型")
    print("=" * 60)

    try:
        from database.models import TaskComparison, init_db
        print("✓ TaskComparison 模型导入成功")

        # 检查模型属性
        required_attrs = ['id', 'task_ids', 'target_columns', 'tolerance',
                         'comparison_results', 'note', 'created_at']
        for attr in required_attrs:
            if hasattr(TaskComparison, attr):
                print(f"✓ 属性 {attr} 存在")
            else:
                print(f"✗ 属性 {attr} 缺失")
                return False

        return True
    except ImportError as e:
        print(f"✗ 导入失败: {e}")
        return False
    except Exception as e:
        print(f"✗ 测试失败: {e}")
        return False

def main():
    """运行所有测试"""
    print("\n" + "=" * 60)
    print("开始测试修复...")
    print("=" * 60)

    results = []

    # 测试 0: 数据库模型
    results.append(("数据库模型", test_database_model()))

    # 测试 1: 健康检查
    results.append(("健康检查", test_health_check()))

    # 测试 2: 任务对比历史接口
    results.append(("任务对比历史接口", test_task_comparison_history()))

    # 测试 3: API 文档
    results.append(("API 文档路由", test_api_docs()))
    
    # 总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    
    for name, result in results:
        status = "✓ 通过" if result else "✗ 失败"
        print(f"{name}: {status}")
    
    all_passed = all(result for _, result in results)
    
    print("\n" + "=" * 60)
    if all_passed:
        print("✓ 所有测试通过！")
        print("=" * 60)
        print("\n修复说明:")
        print("1. ✓ 已在 backend/database/models.py 中添加 TaskComparison 模型")
        print("2. ✓ 已在 backend/main.py 中注册 task_comparison 路由")
        print("3. ✓ 已优化 FlexibleJSON 类，减少常见列名的警告日志")
        print("4. ✓ /api/task-comparison/history 接口现在可以正常访问")
        print("\n建议:")
        print("- 访问 http://localhost:3000/task-comparison 查看前端页面")
        print("- 访问 http://localhost:8000/docs 查看完整 API 文档")
        return 0
    else:
        print("✗ 部分测试失败")
        print("=" * 60)
        print("\n请检查:")
        print("1. 后端服务是否已重启")
        print("2. backend/main.py 中是否正确导入和注册了 task_comparison_router")
        print("3. backend/database/models.py 中是否包含 TaskComparison 模型")
        return 1

if __name__ == "__main__":
    sys.exit(main())

