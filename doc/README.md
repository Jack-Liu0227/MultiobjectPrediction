# 项目文档目录

本目录包含多目标材料性能预测系统的架构文档和设计图。

## 文档列表

### 1. 启动脚本使用说明
**文件**: `启动脚本说明.md`

详细的启动脚本使用指南，包括：
- Windows 批处理脚本（start_all.bat / stop_all.bat）
- Windows PowerShell 脚本（start_all.ps1 / stop_all.ps1）
- Linux/Mac Shell 脚本（start_all.sh）
- 各脚本的功能特点和使用方法
- 常见问题解答
- 脚本对比表
- 手动启动备用方案

### 2. 项目架构文档
**文件**: `project_architecture.md`

详细的项目架构说明文档，包括：
- 系统概览
- 技术栈
- 系统架构图（ASCII 艺术）
- 核心组件说明
- 数据流程
- 目录结构
- 关键技术实现
- 扩展性设计
- 安全性考虑
- 部署建议

### 3. 系统架构图
**文件**: `architecture_diagram.mmd` / `architecture_diagram.md`

Mermaid 格式的系统架构图，展示：
- 前端层组件
- 后端 API 路由层
- 业务逻辑层服务
- 数据访问层
- 外部服务层
- 配置层
- 各层之间的交互关系

### 4. 预测流程时序图
**文件**: `prediction_flow.mmd` / `prediction_flow.md`

Mermaid 格式的预测流程时序图，展示：
- 用户操作流程
- 数据上传过程
- 预测任务创建
- 异步预测执行
- RAG 检索和 LLM 调用
- Pareto 分析
- 结果返回和展示
- 完整的数据流转过程

## 如何查看 Mermaid 图表

### 方法 1：使用 HTML 预览文件（最简单，推荐）

**文件**: `架构图预览.html`

1. 双击打开 `doc/架构图预览.html` 文件
2. 在浏览器中查看交互式架构图
3. 点击标签页切换不同的图表
4. 无需安装任何插件或工具

**特点**：
- ✅ 美观的界面设计
- ✅ 支持标签页切换
- ✅ 彩色节点和连接线
- ✅ 响应式布局，支持移动设备
- ✅ 包含详细说明

### 方法 2：使用在线编辑器

1. 访问 [Mermaid Live Editor](https://mermaid.live/)
2. 复制 `.mmd` 文件内容
3. 粘贴到编辑器中
4. 实时查看渲染结果
5. 可导出为 PNG、SVG 等格式

### 方法 2：使用 VS Code 插件

1. 安装 VS Code 插件：
   - [Mermaid Preview](https://marketplace.visualstudio.com/items?itemName=vstirbu.vscode-mermaid-preview)
   - 或 [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)

2. 打开 `.mmd` 文件
3. 使用预览功能查看图表

### 方法 3：在 Markdown 中嵌入

在 Markdown 文件中使用以下格式：

````markdown
```mermaid
[粘贴 .mmd 文件内容]
```
````

支持 Mermaid 的 Markdown 渲染器（如 GitHub、GitLab）会自动渲染图表。

### 方法 4：使用命令行工具

安装 Mermaid CLI：
```bash
npm install -g @mermaid-js/mermaid-cli
```

生成图片：
```bash
# 生成 PNG
mmdc -i architecture_diagram.mmd -o architecture_diagram.png

# 生成 SVG
mmdc -i architecture_diagram.mmd -o architecture_diagram.svg
```

## 文档维护

### 更新文档

当项目架构发生变化时，请及时更新相关文档：

1. **添加新组件**：
   - 更新 `project_architecture.md` 中的组件说明
   - 在 `architecture_diagram.mmd` 中添加新节点
   - 更新相关的连接关系

2. **修改流程**：
   - 更新 `prediction_flow.mmd` 中的时序图
   - 在 `project_architecture.md` 中更新流程说明

3. **版本控制**：
   - 在文档底部标注版本号和更新日期
   - 重大变更时创建新版本文档

### 文档规范

- 使用中文编写文档
- 保持图表简洁清晰
- 添加必要的注释和说明
- 定期检查文档与代码的一致性

## 相关资源

- [Mermaid 官方文档](https://mermaid.js.org/)
- [Mermaid 语法参考](https://mermaid.js.org/intro/syntax-reference.html)
- [项目主 README](../README.md)

## 联系方式

如有文档相关问题，请联系项目维护团队。

---

**最后更新**: 2025-12-06  
**维护者**: 项目开发团队

