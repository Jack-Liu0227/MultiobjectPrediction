---
type: "agent_requested"
description: "代码风格控制管理"
---

# 代码风格控制规范 - 多目标材料性能预测系统

**版本**: v1.0
**生成日期**: 2025-12-09
**适用范围**: 迭代预测功能及所有后续新功能开发

---

## 📋 核心原则

### 1. 框架化/模块化编程思维
- **强制使用分层架构**：API 层 → 服务层 → 数据访问层
- **单一职责原则**：每个模块只负责一个功能
- **依赖注入**：避免硬编码依赖，使用工厂模式或依赖注入
- **接口隔离**：定义清晰的模块边界和接口

### 2. 后端包管理规则（强制）
- **必须使用 `uv` 作为包管理工具**
- 依赖声明在 `requirements.txt` 中
- 使用 `uv pip install -r requirements.txt` 安装依赖
- 禁止手动编辑 `requirements.txt` 后直接使用 `pip install`
- 所有依赖版本必须明确指定（不使用 `*` 或 `>=` 范围过大）

### 3. 代码组织结构
```
backend/
├── api/              # API 路由层（FastAPI 路由）
├── services/         # 业务逻辑层（核心功能实现）
├── models/           # 数据模型层（Pydantic schemas）
├── database/         # 数据访问层（ORM、数据库操作）
├── utils/            # 工具函数层（通用工具）
├── config/           # 配置层（环境变量、常量）
└── routers/          # 额外路由（特殊路由）

frontend/
├── pages/            # Next.js 页面（路由）
├── components/       # React 组件（UI 组件）
├── lib/              # 工具库（API 调用、类型定义）
├── hooks/            # 自定义 Hooks（状态管理）
└── styles/           # 样式文件（Tailwind CSS）
```

---

## 🎯 后端代码规范

### 命名规范
- **文件名**：snake_case（如 `task_manager.py`）
- **类名**：PascalCase（如 `TaskManager`）
- **函数/方法名**：snake_case（如 `create_task`）
- **常量**：UPPER_SNAKE_CASE（如 `MAX_FILE_SIZE`）
- **私有方法**：前缀 `_`（如 `_validate_input`）

### 模块设计模式
1. **服务层模式**：
   - 每个服务类负责一个业务域
   - 使用 `__init__` 进行依赖注入
   - 提供清晰的公共接口

2. **工厂模式**：
   - 使用工厂函数创建单例（如 `get_task_manager()`）
   - 避免全局变量

3. **数据模型**：
   - 使用 Pydantic BaseModel 定义请求/响应
   - 使用 Field 添加验证和文档
   - 使用 validator 装饰器进行自定义验证

### 后端代码示例
```python
# ✅ 正确的服务层设计
class IterativePredictionService:
    """迭代预测服务 - 负责迭代预测的核心逻辑"""

    def __init__(self, task_manager: TaskManager, rag_service: RAGService):
        """依赖注入"""
        self.task_manager = task_manager
        self.rag_service = rag_service

    def start_iteration(self, task_id: str) -> Dict[str, Any]:
        """开始迭代预测"""
        # 实现逻辑
        pass

    def _validate_convergence(self, values: List[float]) -> bool:
        """私有方法：验证收敛"""
        pass
```

---

## 🎨 前端代码规范

### 命名规范
- **文件名**：PascalCase（如 `FileUpload.tsx`）
- **组件名**：PascalCase（如 `FileUpload`）
- **函数/变量**：camelCase（如 `handleUpload`）
- **常量**：UPPER_SNAKE_CASE（如 `MAX_FILE_SIZE`）

### 组件设计模式
1. **函数式组件**：使用 React Hooks
2. **Props 接口**：定义清晰的 Props 类型
3. **状态管理**：使用 useState、useContext
4. **副作用**：使用 useEffect 管理生命周期

### 前端代码示例
```typescript
// ✅ 正确的组件设计
interface IterativePredictionProps {
  taskId: string;
  onComplete?: (result: PredictionResult) => void;
}

export default function IterativePrediction({
  taskId,
  onComplete
}: IterativePredictionProps) {
  const [iterations, setIterations] = useState<Iteration[]>([]);

  useEffect(() => {
    // 初始化逻辑
  }, [taskId]);

  return (
    <div className="space-y-4">
      {/* 组件内容 */}
    </div>
  );
}
```

---

## 📝 文档和注释规范

### Python 文档字符串
```python
def create_iteration(self, task_id: str, iteration_num: int) -> Dict:
    """
    创建新的迭代预测

    Args:
        task_id: 任务 ID
        iteration_num: 迭代轮数

    Returns:
        包含迭代结果的字典

    Raises:
        ValueError: 如果任务不存在
    """
```

### TypeScript 注释
```typescript
/**
 * 处理迭代预测结果
 * @param result - 预测结果
 * @returns 处理后的结果
 */
function processIterationResult(result: PredictionResult): ProcessedResult {
  // 实现逻辑
}
```

---

## ✅ 代码审查清单

在提交代码前，确保：
- [ ] 遵循分层架构（API → 服务 → 数据访问）
- [ ] 使用 `uv` 管理依赖
- [ ] 命名规范一致
- [ ] 有清晰的文档字符串
- [ ] 没有硬编码的配置值
- [ ] 错误处理完善
- [ ] 代码可测试性强
- [ ] 没有循环依赖

---

## 🚀 新功能开发流程

1. **设计阶段**：定义清晰的模块边界和接口
2. **实现阶段**：遵循分层架构，使用依赖注入
3. **测试阶段**：编写单元测试和集成测试
4. **审查阶段**：检查代码规范和架构一致性
5. **文档阶段**：更新相关文档和注释

---

**维护人员**: AI Assistant
**最后更新**: 2025-12-09
