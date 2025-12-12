# 迭代预测功能开发文档 - 第7部分：前端界面设计

## 7. 前端界面设计

### 7.1 新增页面：迭代预测页面

**路由**：`/iterative-prediction`

**文件**：`frontend/pages/iterative-prediction.tsx`

**功能**：
- 配置迭代预测参数
- 上传测试样本和参考样本
- 启动迭代预测任务
- 实时显示预测进度
- 查看迭代历史和趋势图

### 7.2 页面组件结构

```
IterativePredictionPage
├── ConfigurationPanel
│   ├── FileUploadSection
│   │   ├── TestSampleUpload
│   │   └── ReferenceSampleUpload
│   ├── TargetPropertiesSection
│   ├── IterationSettingsSection
│   │   ├── MaxIterationsInput
│   │   ├── ConvergenceThresholdInput
│   │   ├── EarlyStopToggle
│   │   └── MaxWorkersInput
│   ├── LLMConfigSection
│   │   ├── ProviderSelect
│   │   ├── ModelSelect
│   │   └── TemperatureSlider
│   └── SubmitButton
├── ProgressPanel
│   ├── ProgressBar
│   ├── IterationCounter
│   ├── ConvergenceStats
│   └── FailedSamplesAlert
└── ResultsPanel
    ├── IterationTrendChart
    ├── ConvergenceHeatmap
    ├── DetailedResultsTable
    └── ExportButton
```

### 7.3 完整实现代码

#### 7.3.1 主页面组件

```typescript
// frontend/pages/iterative-prediction.tsx

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  Container,
  Paper,
  Tabs,
  Tab,
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import ConfigurationPanel from '@/components/iterative-prediction/ConfigurationPanel';
import ProgressPanel from '@/components/iterative-prediction/ProgressPanel';
import ResultsPanel from '@/components/iterative-prediction/ResultsPanel';
import { IterativePredictionTask, IterationHistory } from '@/lib/types';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

export default function IterativePredictionPage() {
  const router = useRouter();
  const [tabValue, setTabValue] = useState(0);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [task, setTask] = useState<IterativePredictionTask | null>(null);
  const [iterationHistory, setIterationHistory] = useState<IterationHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 轮询任务状态
  useEffect(() => {
    if (!taskId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}`);
        if (!response.ok) throw new Error('Failed to fetch task');

        const taskData = await response.json();
        setTask(taskData);

        // 如果任务完成，获取迭代历史
        if (taskData.status === 'completed') {
          const historyResponse = await fetch(
            `/api/results/${taskId}/iterations`
          );
          if (historyResponse.ok) {
            const history = await historyResponse.json();
            setIterationHistory(history);
          }
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Error polling task:', err);
      }
    }, 2000); // 每2秒轮询一次

    return () => clearInterval(pollInterval);
  }, [taskId]);

  const handleStartPrediction = async (config: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/iterative-prediction/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to start prediction');
      }

      const data = await response.json();
      setTaskId(data.task_id);
      setTabValue(1); // 切换到进度标签页
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Paper sx={{ width: '100%' }}>
        <Tabs
          value={tabValue}
          onChange={(e, newValue) => setTabValue(newValue)}
          aria-label="迭代预测标签页"
        >
          <Tab label="配置" id="tab-0" aria-controls="tabpanel-0" />
          <Tab label="进度" id="tab-1" aria-controls="tabpanel-1" disabled={!taskId} />
          <Tab label="结果" id="tab-2" aria-controls="tabpanel-2" disabled={!task || task.status !== 'completed'} />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}

        <TabPanel value={tabValue} index={0}>
          <ConfigurationPanel
            onStartPrediction={handleStartPrediction}
            loading={loading}
          />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          {task && (
            <ProgressPanel
              task={task}
              onRetryFailed={() => {
                // 处理重试失败样本
              }}
            />
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          {iterationHistory && (
            <ResultsPanel
              task={task!}
              iterationHistory={iterationHistory}
            />
          )}
        </TabPanel>
      </Paper>
    </Container>
  );
}
```

#### 7.3.2 配置面板组件

```typescript
// frontend/components/iterative-prediction/ConfigurationPanel.tsx

import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Divider,
  FormControlLabel,
  Grid,
  Select,
  MenuItem,
  Slider,
  Switch,
  TextField,
  Typography,
  Stack,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

interface ConfigurationPanelProps {
  onStartPrediction: (config: any) => void;
  loading: boolean;
}

export default function ConfigurationPanel({
  onStartPrediction,
  loading,
}: ConfigurationPanelProps) {
  const [config, setConfig] = useState({
    task_name: '',
    task_description: '',
    test_file_path: '',
    reference_file_path: '',
    target_properties: ['UTS(MPa)', 'El(%)'],
    llm_provider: 'gemini',
    llm_model: 'gemini-2.0-flash',
    temperature: 0.7,
    enable_iteration: true,
    max_iterations: 5,
    convergence_threshold: 0.01,
    early_stop: true,
    max_workers: 5,
  });

  const handleConfigChange = (field: string, value: any) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = () => {
    onStartPrediction(config);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Grid container spacing={3}>
        {/* 基本信息 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="基本信息" />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  label="任务名称"
                  value={config.task_name}
                  onChange={(e) => handleConfigChange('task_name', e.target.value)}
                  fullWidth
                  required
                />
                <TextField
                  label="任务描述"
                  value={config.task_description}
                  onChange={(e) => handleConfigChange('task_description', e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 文件上传 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="数据文件" />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    测试样本文件
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    component="label"
                  >
                    上传测试样本
                    <input
                      type="file"
                      accept=".csv"
                      hidden
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleConfigChange('test_file_path', e.target.files[0].name);
                        }
                      }}
                    />
                  </Button>
                  {config.test_file_path && (
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                      已选择: {config.test_file_path}
                    </Typography>
                  )}
                </Box>

                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    参考样本文件
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    component="label"
                  >
                    上传参考样本
                    <input
                      type="file"
                      accept=".csv"
                      hidden
                      onChange={(e) => {
                        if (e.target.files?.[0]) {
                          handleConfigChange('reference_file_path', e.target.files[0].name);
                        }
                      }}
                    />
                  </Button>
                  {config.reference_file_path && (
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                      已选择: {config.reference_file_path}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 迭代配置 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="迭代配置" />
            <Divider />
            <CardContent>
              <Stack spacing={3}>
                <Box>
                  <Typography gutterBottom>
                    最大迭代次数: {config.max_iterations}
                  </Typography>
                  <Slider
                    value={config.max_iterations}
                    onChange={(e, value) =>
                      handleConfigChange('max_iterations', value)
                    }
                    min={1}
                    max={10}
                    marks
                    valueLabelDisplay="auto"
                  />
                </Box>

                <Box>
                  <Typography gutterBottom>
                    收敛阈值: {(config.convergence_threshold * 100).toFixed(2)}%
                  </Typography>
                  <Slider
                    value={config.convergence_threshold}
                    onChange={(e, value) =>
                      handleConfigChange('convergence_threshold', value)
                    }
                    min={0.001}
                    max={0.1}
                    step={0.001}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) => `${(value * 100).toFixed(2)}%`}
                  />
                </Box>

                <Box>
                  <Typography gutterBottom>
                    最大并发数: {config.max_workers}
                  </Typography>
                  <Slider
                    value={config.max_workers}
                    onChange={(e, value) =>
                      handleConfigChange('max_workers', value)
                    }
                    min={1}
                    max={20}
                    marks
                    valueLabelDisplay="auto"
                  />
                </Box>

                <FormControlLabel
                  control={
                    <Switch
                      checked={config.early_stop}
                      onChange={(e) =>
                        handleConfigChange('early_stop', e.target.checked)
                      }
                    />
                  }
                  label="启用提前停止（所有样本收敛时）"
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* LLM 配置 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardHeader title="LLM 配置" />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Select
                  value={config.llm_provider}
                  onChange={(e) =>
                    handleConfigChange('llm_provider', e.target.value)
                  }
                  fullWidth
                >
                  <MenuItem value="gemini">Gemini</MenuItem>
                  <MenuItem value="openai">OpenAI</MenuItem>
                </Select>

                <Select
                  value={config.llm_model}
                  onChange={(e) =>
                    handleConfigChange('llm_model', e.target.value)
                  }
                  fullWidth
                >
                  {config.llm_provider === 'gemini' ? (
                    <>
                      <MenuItem value="gemini-2.0-flash">Gemini 2.0 Flash</MenuItem>
                      <MenuItem value="gemini-1.5-pro">Gemini 1.5 Pro</MenuItem>
                    </>
                  ) : (
                    <>
                      <MenuItem value="gpt-4">GPT-4</MenuItem>
                      <MenuItem value="gpt-4-turbo">GPT-4 Turbo</MenuItem>
                    </>
                  )}
                </Select>

                <Box>
                  <Typography gutterBottom>
                    温度: {config.temperature.toFixed(2)}
                  </Typography>
                  <Slider
                    value={config.temperature}
                    onChange={(e, value) =>
                      handleConfigChange('temperature', value)
                    }
                    min={0}
                    max={2}
                    step={0.1}
                    valueLabelDisplay="auto"
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 提交按钮 */}
        <Grid item xs={12}>
          <Button
            variant="contained"
            size="large"
            onClick={handleSubmit}
            disabled={loading || !config.task_name || !config.test_file_path}
            fullWidth
          >
            {loading ? '启动中...' : '启动迭代预测'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
```

#### 7.3.3 进度面板组件

```typescript
// frontend/components/iterative-prediction/ProgressPanel.tsx

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Grid,
  LinearProgress,
  Typography,
  Alert,
  Button,
  Stack,
} from '@mui/material';
import { IterativePredictionTask } from '@/lib/types';

interface ProgressPanelProps {
  task: IterativePredictionTask;
  onRetryFailed: () => void;
}

export default function ProgressPanel({
  task,
  onRetryFailed,
}: ProgressPanelProps) {
  const progressPercent = (task.progress || 0) * 100;

  return (
    <Box sx={{ p: 3 }}>
      <Grid container spacing={3}>
        {/* 进度条 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="预测进度" />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">
                      迭代进度
                    </Typography>
                    <Typography variant="body2">
                      {task.current_iteration} / {task.max_iterations}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={progressPercent}
                    sx={{ height: 10, borderRadius: 5 }}
                  />
                </Box>

                <Typography variant="caption" color="textSecondary">
                  {progressPercent.toFixed(0)}% 完成
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 统计信息 */}
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                总样本数
              </Typography>
              <Typography variant="h5">
                {task.total_samples}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                已收敛
              </Typography>
              <Typography variant="h5" sx={{ color: 'success.main' }}>
                {task.converged_samples}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                失败样本
              </Typography>
              <Typography variant="h5" sx={{ color: 'error.main' }}>
                {task.failed_samples}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="textSecondary" gutterBottom>
                收敛率
              </Typography>
              <Typography variant="h5">
                {task.total_samples > 0
                  ? ((task.converged_samples / task.total_samples) * 100).toFixed(1)
                  : 0}
                %
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* 失败样本提示 */}
        {task.failed_samples > 0 && (
          <Grid item xs={12}>
            <Alert severity="warning">
              有 {task.failed_samples} 个样本预测失败。
              <Button
                size="small"
                onClick={onRetryFailed}
                sx={{ ml: 2 }}
              >
                重试失败样本
              </Button>
            </Alert>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
```

#### 7.3.4 结果面板组件（包含迭代趋势图）

```typescript
// frontend/components/iterative-prediction/ResultsPanel.tsx

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Grid,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Heatmap,
} from 'recharts';
import { IterativePredictionTask, IterationHistory } from '@/lib/types';

interface ResultsPanelProps {
  task: IterativePredictionTask;
  iterationHistory: IterationHistory;
}

export default function ResultsPanel({
  task,
  iterationHistory,
}: ResultsPanelProps) {
  const [tabValue, setTabValue] = React.useState(0);

  // 准备迭代趋势图数据
  const prepareChartData = () => {
    const samples = iterationHistory.samples;
    const firstSample = Object.values(samples)[0];
    if (!firstSample) return [];

    const targetProps = Object.keys(firstSample.targets);
    const iterations = iterationHistory.global_info.total_iterations;

    return Array.from({ length: iterations }, (_, i) => {
      const dataPoint: any = { iteration: i + 1 };

      Object.entries(samples).forEach(([sampleKey, sampleData]) => {
        targetProps.forEach((prop) => {
          const values = sampleData.targets[prop].iterations;
          if (values[i] !== undefined) {
            dataPoint[`${sampleKey}_${prop}`] = values[i];
          }
        });
      });

      return dataPoint;
    });
  };

  const chartData = prepareChartData();

  return (
    <Box sx={{ p: 3 }}>
      <Grid container spacing={3}>
        {/* 迭代趋势图 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="迭代趋势图" />
            <Divider />
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="iteration" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {Object.keys(chartData[0] || {})
                    .filter((key) => key !== 'iteration')
                    .map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={`hsl(${(index * 360) / 10}, 70%, 50%)`}
                        dot={false}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* 详细结果表格 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="详细预测结果" />
            <Divider />
            <CardContent>
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                      <TableCell>样本 ID</TableCell>
                      <TableCell align="right">目标属性</TableCell>
                      <TableCell align="right">初始预测</TableCell>
                      <TableCell align="right">最终预测</TableCell>
                      <TableCell align="right">变化率</TableCell>
                      <TableCell>收敛状态</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(iterationHistory.samples).map(
                      ([sampleKey, sampleData]) => {
                        const targetProps = Object.keys(sampleData.targets);

                        return targetProps.map((prop, propIndex) => {
                          const values = sampleData.targets[prop].iterations;
                          const initialValue = values[0];
                          const finalValue = values[values.length - 1];
                          const changeRate =
                            ((finalValue - initialValue) / Math.max(Math.abs(initialValue), 0.1)) * 100;

                          return (
                            <TableRow key={`${sampleKey}_${prop}`}>
                              {propIndex === 0 && (
                                <TableCell rowSpan={targetProps.length}>
                                  {sampleData.sample_id}
                                </TableCell>
                              )}
                              <TableCell>{prop}</TableCell>
                              <TableCell align="right">
                                {initialValue.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {finalValue.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {changeRate > 0 ? '+' : ''}{changeRate.toFixed(2)}%
                              </TableCell>
                              <TableCell>
                                {sampleData.targets[prop].convergence_status === 'converged'
                                  ? '✓ 已收敛'
                                  : '✗ 未收敛'}
                              </TableCell>
                            </TableRow>
                          );
                        });
                      }
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        {/* 迭代统计 */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title="迭代统计" />
            <Divider />
            <CardContent>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                      <TableCell>迭代轮数</TableCell>
                      <TableCell align="right">处理样本数</TableCell>
                      <TableCell align="right">失败样本数</TableCell>
                      <TableCell align="right">新收敛样本数</TableCell>
                      <TableCell align="right">耗时（秒）</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {iterationHistory.iteration_summaries.map((summary) => (
                      <TableRow key={summary.iteration}>
                        <TableCell>{summary.iteration}</TableCell>
                        <TableCell align="right">
                          {summary.processed_samples}
                        </TableCell>
                        <TableCell align="right">
                          {summary.failed_samples}
                        </TableCell>
                        <TableCell align="right">
                          {summary.newly_converged}
                        </TableCell>
                        <TableCell align="right">
                          {summary.duration_seconds}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
```

### 7.4 状态管理

```typescript
// frontend/hooks/useIterativePrediction.ts

import { useState, useCallback } from 'react';
import { IterativePredictionTask, IterationHistory } from '@/lib/types';

export function useIterativePrediction() {
  const [taskId, setTaskId] = useState<number | null>(null);
  const [task, setTask] = useState<IterativePredictionTask | null>(null);
  const [iterationHistory, setIterationHistory] = useState<IterationHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startPrediction = useCallback(async (config: any) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/iterative-prediction/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to start prediction');
      }

      const data = await response.json();
      setTaskId(data.task_id);
      return data.task_id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTask = useCallback(async (id: number) => {
    try {
      const response = await fetch(`/api/tasks/${id}`);
      if (!response.ok) throw new Error('Failed to fetch task');

      const taskData = await response.json();
      setTask(taskData);
      return taskData;
    } catch (err) {
      console.error('Error fetching task:', err);
      throw err;
    }
  }, []);

  const fetchIterationHistory = useCallback(async (id: number) => {
    try {
      const response = await fetch(`/api/results/${id}/iterations`);
      if (!response.ok) throw new Error('Failed to fetch iteration history');

      const history = await response.json();
      setIterationHistory(history);
      return history;
    } catch (err) {
      console.error('Error fetching iteration history:', err);
      throw err;
    }
  }, []);

  return {
    taskId,
    task,
    iterationHistory,
    loading,
    error,
    startPrediction,
    fetchTask,
    fetchIterationHistory,
  };
}
```

### 7.5 与现有页面的集成

**修改 `frontend/pages/tasks.tsx`**：
- 在任务列表中显示迭代预测任务的迭代状态
- 示例：`🔄 迭代: 3/5 (60%)`

**修改 `frontend/pages/task-comparison.tsx`**：
- 支持对比迭代预测任务
- 显示迭代历史的对比

**修改 `frontend/pages/results/[id].tsx`**：
- 新增"迭代历史"标签页
- 显示迭代趋势图和详细结果表格

