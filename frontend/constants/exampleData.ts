/**
 * 示例数据常量
 * 用于提示词模板预览功能
 */

/**
 * 高温合金示例组分数据（与实际数据集一致）
 */
export const EXAMPLE_SUPERALLOY_COMPOSITION = {
  'Al(at%)': 5.2,
  'Co(at%)': 13.85,
  'Cr(at%)': 17.42,
  'Fe(at%)': 0.2,
  'Ni(at%)': 55.84,
  'Mo(at%)': 1.69,
  'Ti(at%)': 5.8
};

/**
 * 高温合金示例工艺描述（使用与实际数据集一致的格式）
 */
export const EXAMPLE_SUPERALLOY_PROCESSING = 'the first heat treatment is Homogenization at 1353K. the second heat treatment is Annealing at 298K. the third heat treatment is Aging at 923K for 24.0 hours.';

/**
 * 高温合金示例参考样本（使用与实际数据集一致的格式）
 */
export const EXAMPLE_SUPERALLOY_REFERENCES = [
  {
    ...EXAMPLE_SUPERALLOY_COMPOSITION,
    'Mo(at%)': 1.69,
    'Processing_Description': 'the first heat treatment is Homogenization at 1353K. the second heat treatment is Annealing at 298K. the third heat treatment is Aging at 923K for 24.0 hours.',
    'UTS(MPa)': 1547.0,
    'El(%)': 27.0
  },
  {
    ...EXAMPLE_SUPERALLOY_COMPOSITION,
    'Mo(at%)': 1.69,
    'Processing_Description': 'the first heat treatment is Homogenization at 1433K. the second heat treatment is Annealing at 298K. the third heat treatment is Aging at 923K for 24.0 hours.',
    'UTS(MPa)': 1186.0,
    'El(%)': 17.0
  },
  {
    'Al(at%)': 3.21,
    'Co(at%)': 9.82,
    'Cr(at%)': 21.43,
    'Fe(at%)': 0.35,
    'Ni(at%)': 57.32,
    'Mo(at%)': 5.0,
    'Ti(at%)': 2.86,
    'Processing_Description': 'the first heat treatment is Homogenization at 1483K. the second heat treatment is Annealing at 1283K for 2.0 hours. the third heat treatment is Aging at 1061K for 8.0 hours.',
    'UTS(MPa)': 1150.0,
    'El(%)': 30.0
  }
];

/**
 * 获取示例测试样本
 */
export function getExampleTestSample() {
  return {
    ...EXAMPLE_SUPERALLOY_COMPOSITION,
    'Processing_Description': EXAMPLE_SUPERALLOY_PROCESSING
  };
}

/**
 * 获取示例组分列名
 */
export function getExampleCompositionColumns() {
  return Object.keys(EXAMPLE_SUPERALLOY_COMPOSITION);
}

