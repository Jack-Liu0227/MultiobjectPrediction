/**
 * Task Comparison Analysis Page
 * Compare prediction results across multiple tasks
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { getTaskList, compareTasksAPI, saveComparisonAPI, getComparisonHistoryAPI, getComparisonDetailAPI, deleteComparisonAPI } from '@/lib/api';
import MultiTargetScatterChart from '@/components/charts/MultiTargetScatterChart';
import ConsistencyDistributionChart from '@/components/charts/ConsistencyDistributionChart';

interface Task {
  task_id: string;
  status: string;
  filename: string;
  created_at: string;
  note?: string;
  config?: any;
}

export default function TaskComparisonPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [tolerance, setTolerance] = useState<number>(0);
  const [availableTargets, setAvailableTargets] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonResults, setComparisonResults] = useState<{[key: string]: any}>({});

  // Save dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false); // Whether to save as new when updating

  // History view state
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Load sidebar state from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('taskComparisonSidebarOpen');
      return saved !== null ? JSON.parse(saved) : true;
    }
    return true;
  });

  // Task display mode: 'id' | 'note' | 'filename' | 'custom'
  const [taskDisplayMode, setTaskDisplayMode] = useState<'id' | 'note' | 'filename' | 'custom'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('taskComparisonDisplayMode');
      return (saved as 'id' | 'note' | 'filename' | 'custom') || 'id';
    }
    return 'id';
  });

  // Custom task names mapping: { taskId: customName }
  const [customTaskNames, setCustomTaskNames] = useState<{ [taskId: string]: string }>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('taskComparisonCustomNames');
      return saved ? JSON.parse(saved) : {};
    }
    return {};
  });

  // Show custom name editor dialog
  const [showCustomNameEditor, setShowCustomNameEditor] = useState(false);

  // Load completed tasks
  useEffect(() => {
    loadTasks();
  }, []);

  // Load history on mount for sidebar
  useEffect(() => {
    if (historyList.length === 0) {
      loadHistoryList();
    }
  }, []);

  // Save sidebar state to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('taskComparisonSidebarOpen', JSON.stringify(sidebarOpen));
    }
  }, [sidebarOpen]);

  // Save task display mode to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('taskComparisonDisplayMode', taskDisplayMode);
    }
  }, [taskDisplayMode]);

  // Save custom task names to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('taskComparisonCustomNames', JSON.stringify(customTaskNames));
    }
  }, [customTaskNames]);

  const loadTasks = async () => {
    try {
      const response = await getTaskList({ status: 'completed' });
      const completedTasks = response.tasks.filter((t: Task) => t.status === 'completed');
      setTasks(completedTasks);

      // Extract available target columns from task results
      const allTargets = new Set<string>();

      // Load predictions from each task to extract target columns
      for (const task of completedTasks) {
        try {
          // Get task results to extract target columns
          const resultId = task.task_id; // Assuming task_id is the result_id
          const resultResponse = await fetch(`/api/results/${resultId}`);

          if (resultResponse.ok) {
            const resultData = await resultResponse.json();

            // Extract columns ending with _predicted
            if (resultData.predictions && resultData.predictions.length > 0) {
              const firstRow = resultData.predictions[0];
              Object.keys(firstRow).forEach(key => {
                if (key.endsWith('_predicted')) {
                  const targetName = key.replace('_predicted', '');
                  allTargets.add(targetName);
                }
              });
            }
          }
        } catch (err) {
          console.warn(`Failed to load results for task ${task.task_id}:`, err);
        }
      }

      const targetsArray = Array.from(allTargets);
      console.log('Extracted target columns:', targetsArray);
      setAvailableTargets(targetsArray);

      // Select first target by default
      if (targetsArray.length > 0) {
        setSelectedTargets([targetsArray[0]]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load tasks');
    }
  };

  // Handle task selection
  const handleTaskToggle = (taskId: string) => {
    setSelectedTaskIds(prev => {
      if (prev.includes(taskId)) {
        return prev.filter(id => id !== taskId);
      } else {
        return [...prev, taskId];
      }
    });
  };

  // Handle target selection
  const handleTargetToggle = (target: string) => {
    setSelectedTargets(prev => {
      if (prev.includes(target)) {
        return prev.filter(t => t !== target);
      } else {
        return [...prev, target];
      }
    });
  };

  // Handle comparison
  const handleCompare = async () => {
    if (selectedTaskIds.length < 2) {
      setError('Please select at least 2 tasks to compare');
      return;
    }

    if (selectedTargets.length === 0) {
      setError('Please select at least one target column');
      return;
    }

    setLoading(true);
    setError(null);
    setComparisonResults({});

    try {
      // 调用新的多目标属性对比API
      const result = await compareTasksAPI({
        task_ids: selectedTaskIds,
        target_columns: selectedTargets,
        tolerance: tolerance,
      });

      // 将结果存储为单个对比结果
      setComparisonResults({ 'multi-target': result });

      // Note: activeHistoryId is kept so user can update the existing comparison
      // It will be cleared when saving or when clicking "Clear & Start New"
    } catch (err: any) {
      setError(err.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  // Download chart
  const handleDownloadChart = () => {
    // TODO: Implement chart download functionality
    alert('Chart download feature coming soon!');
  };

  // Toggle sidebar
  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  // Format relative time
  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  // Get task display name based on display mode
  const getTaskDisplayName = (task: Task): string => {
    switch (taskDisplayMode) {
      case 'custom':
        return customTaskNames[task.task_id] || task.task_id;
      case 'note':
        return task.note || task.task_id;
      case 'filename':
        return task.filename || task.task_id;
      case 'id':
      default:
        return task.task_id;
    }
  };

  // Save comparison result
  const handleSaveComparison = async () => {
    if (!comparisonResults['multi-target']) {
      alert('No comparison results to save');
      return;
    }

    setSaving(true);
    try {
      // If updating an existing comparison and not saving as new, delete the old one first
      if (activeHistoryId && !saveAsNew) {
        await deleteComparisonAPI(activeHistoryId);
      }

      await saveComparisonAPI({
        task_ids: selectedTaskIds,
        target_columns: selectedTargets,
        tolerance: tolerance,
        comparison_results: comparisonResults['multi-target'],
        note: saveNote || undefined,
      });

      setSaveSuccess(true);
      setShowSaveDialog(false);
      setSaveNote('');
      setSaveAsNew(false);

      // Refresh history list
      await loadHistoryList();

      // Clear active history ID if we saved as new or updated
      if (saveAsNew || activeHistoryId) {
        setActiveHistoryId(null);
      }

      // Show success message
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save comparison: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Load history list
  const loadHistoryList = async () => {
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const history = await getComparisonHistoryAPI();
      setHistoryList(history);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Switch to history tab and load history
  const handleOpenHistory = () => {
    setActiveTab('history');
    if (historyList.length === 0) {
      loadHistoryList();
    }
  };

  // Load a specific comparison from history
  const handleLoadComparison = async (comparisonId: string) => {
    try {
      const detail = await getComparisonDetailAPI(comparisonId);

      // Set the comparison results
      setComparisonResults({ 'multi-target': detail.comparison_results });

      // Set the form values
      setSelectedTaskIds(detail.task_ids);
      setSelectedTargets(detail.target_columns);
      setTolerance(detail.tolerance);

      // Set active history ID for highlighting
      setActiveHistoryId(comparisonId);

      // Switch to new comparison tab to show results
      setActiveTab('new');
    } catch (err: any) {
      alert(`Failed to load comparison: ${err.message}`);
    }
  };

  // Delete a comparison
  const handleDeleteComparison = async (comparisonId: string) => {
    try {
      await deleteComparisonAPI(comparisonId);

      // Refresh history list
      await loadHistoryList();

      // Close confirm dialog
      setDeleteConfirmId(null);

      // Show success message briefly
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to delete comparison: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/prediction')}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Back to Prediction"
              >
                <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Task Comparison Analysis</h1>
                <p className="text-sm text-gray-500 mt-1">Compare prediction results across multiple tasks</p>
              </div>
            </div>
          </div>

          {/* Task Display Mode Selector */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Task Display:</label>
              <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setTaskDisplayMode('id')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    taskDisplayMode === 'id'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Task ID
                </button>
                <button
                  onClick={() => setTaskDisplayMode('note')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    taskDisplayMode === 'note'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Note
                </button>
                <button
                  onClick={() => setTaskDisplayMode('filename')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    taskDisplayMode === 'filename'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Filename
                </button>
                <button
                  onClick={() => setTaskDisplayMode('custom')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    taskDisplayMode === 'custom'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Custom
                </button>
              </div>
              {taskDisplayMode === 'custom' && (
                <button
                  onClick={() => setShowCustomNameEditor(true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Names
                </button>
              )}
              <span className="text-xs text-gray-500">
                (How tasks are displayed in charts and lists)
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-4 border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('new')}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'new'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Comparison
                </div>
              </button>
              <button
                onClick={handleOpenHistory}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === 'history'
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                  {historyList.length > 0 && (
                    <span className="ml-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full">
                      {historyList.length}
                    </span>
                  )}
                </div>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* New Comparison Tab */}
        {activeTab === 'new' && (
          <div className="flex gap-6 relative">
            {/* Main Content */}
            <div className={`flex-1 space-y-4 transition-all duration-300 ${sidebarOpen ? 'mr-0' : 'mr-0'}`}>
            {/* History Indicator */}
            {activeHistoryId && (
              <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="font-semibold text-purple-900">Viewing Historical Comparison</p>
                    <p className="text-sm text-purple-700">This is a saved comparison result loaded from history</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setActiveHistoryId(null);
                    setComparisonResults({});
                    setSelectedTaskIds([]);
                    setSelectedTargets([]);
                    setTolerance(0);
                  }}
                  className="px-4 py-2 bg-white hover:bg-purple-100 text-purple-700 border border-purple-300 rounded-lg transition-colors"
                >
                  Clear & Start New
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Panel - Configuration */}
              <div className="lg:col-span-1">
                <div className="bg-white rounded-lg shadow-sm border p-6 sticky top-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Configuration</h2>
              
              {/* Task Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Tasks ({selectedTaskIds.length} selected)
                </label>
                <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                  {tasks.length === 0 ? (
                    <p className="p-4 text-sm text-gray-500 text-center">No completed tasks found</p>
                  ) : (
                    tasks.map(task => (
                      <label
                        key={task.task_id}
                        className="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.includes(task.task_id)}
                          onChange={() => handleTaskToggle(task.task_id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {task.note || task.task_id.substring(0, 8)}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {new Date(task.created_at).toLocaleString()}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Target Column Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Target Columns ({selectedTargets.length} selected)
                </label>
                <div className="max-h-40 overflow-y-auto border rounded-lg divide-y">
                  {availableTargets.length === 0 ? (
                    <p className="p-3 text-sm text-gray-500 text-center">No target columns available</p>
                  ) : (
                    availableTargets.map(target => (
                      <label
                        key={target}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTargets.includes(target)}
                          onChange={() => handleTargetToggle(target)}
                        />
                        <span className="text-sm text-gray-900">{target}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Tolerance Setting */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tolerance (%)
                </label>
                <input
                  type="number"
                  value={tolerance}
                  onChange={(e) => setTolerance(parseFloat(e.target.value) || 0)}
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Relative error threshold for considering predictions as consistent
                </p>
              </div>

              {/* Compare Button */}
              <button
                onClick={handleCompare}
                disabled={loading || selectedTaskIds.length < 2}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {loading ? 'Comparing...' : 'Start Comparison'}
              </button>

              {/* Error Message */}
              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2">
            {Object.keys(comparisonResults).length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Comparison Results</h3>
                <p className="text-gray-500">Select tasks and click "Start Comparison" to view results</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Render results */}
                {Object.entries(comparisonResults).map(([key, result]: [string, any]) => (
                  <div key={key} className="space-y-6">
                    {/* Target Column Header with Save Button */}
                    <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg shadow-sm border-2 border-blue-200 p-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900">
                          📊 {result.target_columns.length > 1
                            ? `Multi-Target Comparison: ${result.target_columns.join(' + ')}`
                            : result.target_columns[0]
                          }
                        </h2>
                        <button
                          onClick={() => setShowSaveDialog(true)}
                          className={`px-4 py-2 text-white rounded-lg transition-colors flex items-center gap-2 ${
                            activeHistoryId
                              ? 'bg-orange-600 hover:bg-orange-700'
                              : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                          </svg>
                          {activeHistoryId ? 'Update & Replace' : 'Save Result'}
                        </button>
                      </div>
                    </div>

                    {/* Summary Card */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Comparison Summary</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-blue-600">{result.n_tasks}</p>
                          <p className="text-sm text-gray-600">Tasks Compared</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-green-600">{result.total_samples}</p>
                          <p className="text-sm text-gray-600">Common Samples</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-purple-600">{result.target_columns.length}</p>
                          <p className="text-sm text-gray-600">Target Attributes</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold text-orange-600">{tolerance}%</p>
                          <p className="text-sm text-gray-600">Tolerance</p>
                        </div>
                      </div>
                    </div>

                    {/* Consistency Distribution Chart */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Consistency Distribution</h3>
                      </div>
                      <ConsistencyDistributionChart
                        consistencyDistribution={result.consistency_distribution}
                        nTasks={result.n_tasks}
                      />
                    </div>

                    {/* Scatter Plots for Each Target Property */}
                    <MultiTargetScatterChart
                      comparisonData={result}
                      taskNames={Object.fromEntries(
                        tasks
                          .filter(t => result.task_ids.includes(t.task_id))
                          .map(t => [t.task_id, getTaskDisplayName(t)])
                      )}
                    />

                    {/* Detailed Statistics Table */}
                    <div className="bg-white rounded-lg shadow-sm border p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Detailed Statistics</h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Consistency Level
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Samples
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Percentage
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {Object.entries(result.consistency_distribution).map(([label, data]: [string, any]) => (
                              <tr key={label}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {label}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {data.count}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  {data.percentage.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            </div>
          </div>

            {/* Sidebar */}
            <div className={`hidden lg:block transition-all duration-300 ${sidebarOpen ? 'w-80' : 'w-12'}`}>
              {sidebarOpen ? (
                <div className="bg-white rounded-lg shadow-sm border p-4 sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
                  {/* Sidebar Header */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">Recent History</h3>
                    <button
                      onClick={toggleSidebar}
                      className="p-1 hover:bg-gray-100 rounded transition-colors"
                      title="Close sidebar"
                    >
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* History List */}
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                    </div>
                  ) : historyList.length === 0 ? (
                    <div className="text-center py-8">
                      <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm text-gray-500">No history yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {historyList.slice(0, 10).map((item) => (
                        <div
                          key={item.id}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            activeHistoryId === item.id
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-purple-300'
                          }`}
                        >
                          <div
                            className="cursor-pointer"
                            onClick={() => handleLoadComparison(item.id)}
                          >
                            {/* Time and Delete Button */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1">
                                <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span className="text-xs text-gray-500">{getRelativeTime(item.created_at)}</span>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(item.id);
                                }}
                                className="p-1 hover:bg-red-50 rounded transition-colors"
                                title="Delete"
                              >
                                <svg className="w-3 h-3 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                            {/* Target Attributes */}
                            <div className="flex flex-wrap gap-1 mb-2">
                              {item.target_columns.slice(0, 2).map((col: string, idx: number) => (
                                <span key={idx} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                  {col}
                                </span>
                              ))}
                              {item.target_columns.length > 2 && (
                                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                  +{item.target_columns.length - 2}
                                </span>
                              )}
                            </div>

                            {/* Stats */}
                            <div className="flex items-center gap-3 text-xs text-gray-600">
                              <span>{item.n_tasks} tasks</span>
                              <span>•</span>
                              <span>{item.total_samples} samples</span>
                            </div>
                          </div>

                          {/* Active Indicator */}
                          {activeHistoryId === item.id && (
                            <div className="mt-2 pt-2 border-t border-purple-200">
                              <span className="text-xs text-purple-600 font-medium">● Viewing</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* View All Button */}
                  {historyList.length > 0 && (
                    <button
                      onClick={() => setActiveTab('history')}
                      className="w-full mt-4 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors text-sm font-medium"
                    >
                      View All History ({historyList.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow-sm border p-2 sticky top-4">
                  <button
                    onClick={toggleSidebar}
                    className="p-2 hover:bg-gray-100 rounded transition-colors"
                    title="Open history sidebar"
                  >
                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Floating Button */}
            <button
              onClick={toggleSidebar}
              className="lg:hidden fixed bottom-6 right-6 p-4 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg z-40"
              title="View history"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>

            {/* Mobile Sidebar Modal */}
            {sidebarOpen && (
              <div className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-50" onClick={toggleSidebar}>
                <div
                  className="absolute right-0 top-0 bottom-0 w-80 bg-white shadow-xl overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-4">
                    {/* Mobile Sidebar Header */}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900">Recent History</h3>
                      <button
                        onClick={toggleSidebar}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {/* Mobile History List */}
                    {loadingHistory ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                      </div>
                    ) : historyList.length === 0 ? (
                      <div className="text-center py-8">
                        <svg className="w-12 h-12 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-gray-500">No history yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {historyList.slice(0, 10).map((item) => (
                          <div
                            key={item.id}
                            className={`p-3 rounded-lg border-2 transition-all ${
                              activeHistoryId === item.id
                                ? 'border-purple-500 bg-purple-50'
                                : 'border-gray-200'
                            }`}
                          >
                            <div
                              className="cursor-pointer"
                              onClick={() => {
                                handleLoadComparison(item.id);
                                toggleSidebar();
                              }}
                            >
                              {/* Time and Delete Button */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1">
                                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  <span className="text-xs text-gray-500">{getRelativeTime(item.created_at)}</span>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmId(item.id);
                                  }}
                                  className="p-1 hover:bg-red-50 rounded transition-colors"
                                  title="Delete"
                                >
                                  <svg className="w-3 h-3 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>

                              <div className="flex flex-wrap gap-1 mb-2">
                                {item.target_columns.slice(0, 2).map((col: string, idx: number) => (
                                  <span key={idx} className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                    {col}
                                  </span>
                                ))}
                                {item.target_columns.length > 2 && (
                                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                    +{item.target_columns.length - 2}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-xs text-gray-600">
                                <span>{item.n_tasks} tasks</span>
                                <span>•</span>
                                <span>{item.total_samples} samples</span>
                              </div>
                            </div>

                            {activeHistoryId === item.id && (
                              <div className="mt-2 pt-2 border-t border-purple-200">
                                <span className="text-xs text-purple-600 font-medium">● Viewing</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Mobile View All Button */}
                    {historyList.length > 0 && (
                      <button
                        onClick={() => {
                          setActiveTab('history');
                          toggleSidebar();
                        }}
                        className="w-full mt-4 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg transition-colors text-sm font-medium"
                      >
                        View All History ({historyList.length})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Search Bar */}
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search by note or target attributes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* History List */}
            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading history...</p>
                </div>
              </div>
            ) : historyError ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {historyError}
              </div>
            ) : historyList.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No saved comparisons yet</h3>
                <p className="text-gray-500">Save a comparison to see it here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historyList
                  .filter(item => {
                    if (!searchQuery) return true;
                    const query = searchQuery.toLowerCase();
                    return (
                      item.note?.toLowerCase().includes(query) ||
                      item.target_columns.some((col: string) => col.toLowerCase().includes(query))
                    );
                  })
                  .map((item) => (
                    <div
                      key={item.id}
                      className={`bg-white rounded-lg shadow-sm border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                        activeHistoryId === item.id
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200 hover:border-purple-300'
                      }`}
                      onClick={() => handleLoadComparison(item.id)}
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs text-gray-500">
                              {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {activeHistoryId === item.id && (
                            <span className="inline-block px-2 py-0.5 text-xs bg-purple-600 text-white rounded-full">
                              Currently Viewing
                            </span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(item.id);
                          }}
                          className="p-1 hover:bg-red-50 rounded transition-colors"
                          title="Delete"
                        >
                          <svg className="w-4 h-4 text-gray-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* Target Attributes */}
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-1">
                          {item.target_columns.map((col: string, idx: number) => (
                            <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                              {col}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.n_tasks}</p>
                          <p className="text-xs text-gray-500">Tasks</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.total_samples}</p>
                          <p className="text-xs text-gray-500">Samples</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-gray-900">{item.tolerance}%</p>
                          <p className="text-xs text-gray-500">Tolerance</p>
                        </div>
                      </div>

                      {/* Note */}
                      {item.note && (
                        <div className="pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-600 line-clamp-2" title={item.note}>
                            💬 {item.note}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {activeHistoryId ? 'Update Comparison Result' : 'Save Comparison Result'}
              </h3>

              {/* Save Mode Selection */}
              {activeHistoryId && (
                <div className="mb-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Save Mode:</p>

                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: !saveAsNew ? '#f97316' : '#d1d5db' }}>
                    <input
                      type="radio"
                      name="saveMode"
                      checked={!saveAsNew}
                      onChange={() => setSaveAsNew(false)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span className="font-medium text-gray-900">Update Existing</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Replace the original comparison with these new results
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: saveAsNew ? '#10b981' : '#d1d5db' }}>
                    <input
                      type="radio"
                      name="saveMode"
                      checked={saveAsNew}
                      onChange={() => setSaveAsNew(true)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        <span className="font-medium text-gray-900">Save as New</span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Keep the original and save this as a new comparison
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {/* Summary */}
              <div className="mb-4 p-4 bg-gray-50 rounded-lg text-sm">
                <p className="text-gray-700 mb-2">
                  <span className="font-medium">Tasks:</span> {selectedTaskIds.length} tasks
                </p>
                <p className="text-gray-700 mb-2">
                  <span className="font-medium">Target Attributes:</span> {selectedTargets.join(', ')}
                </p>
                <p className="text-gray-700">
                  <span className="font-medium">Tolerance:</span> {tolerance}%
                </p>
              </div>

              {/* Note Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note (Optional, max 200 characters)
                </label>
                <textarea
                  value={saveNote}
                  onChange={(e) => setSaveNote(e.target.value.slice(0, 200))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Add a note about this comparison..."
                />
                <p className="text-xs text-gray-500 mt-1">{saveNote.length}/200 characters</p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSaveDialog(false);
                    setSaveNote('');
                    setSaveAsNew(false);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveComparison}
                  className={`flex-1 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50 ${
                    activeHistoryId && !saveAsNew
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                  disabled={saving}
                >
                  {saving
                    ? 'Saving...'
                    : activeHistoryId && !saveAsNew
                      ? 'Update Existing'
                      : 'Save as New'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 z-50">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Comparison saved successfully!
        </div>
      )}



      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Confirm Delete</h3>
            <p className="text-gray-700 mb-6">
              Are you sure you want to delete this comparison? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteComparison(deleteConfirmId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Name Editor Dialog */}
      {showCustomNameEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Edit Custom Task Names</h3>
              <button
                onClick={() => setShowCustomNameEditor(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Set custom display names for your tasks. These names will be used in charts and lists when "Custom" mode is selected.
            </p>

            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.task_id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Task ID: <span className="text-blue-600 font-mono text-xs">{task.task_id}</span>
                      </label>
                      <div className="text-xs text-gray-500 mb-2">
                        File: {task.filename}
                        {task.note && <span className="ml-2">• Note: {task.note}</span>}
                      </div>
                      <input
                        type="text"
                        value={customTaskNames[task.task_id] || ''}
                        onChange={(e) => {
                          setCustomTaskNames({
                            ...customTaskNames,
                            [task.task_id]: e.target.value
                          });
                        }}
                        placeholder="Enter custom name..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {customTaskNames[task.task_id] && (
                      <button
                        onClick={() => {
                          const newNames = { ...customTaskNames };
                          delete newNames[task.task_id];
                          setCustomTaskNames(newNames);
                        }}
                        className="mt-6 text-red-600 hover:text-red-700 transition-colors"
                        title="Clear custom name"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setCustomTaskNames({});
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Clear All
              </button>
              <button
                onClick={() => setShowCustomNameEditor(false)}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

