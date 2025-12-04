/**
 * 主页面 - 重定向到预测页面
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // 自动重定向到预测页面
    router.push('/prediction');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">正在跳转到预测页面...</p>
      </div>
    </div>
  );
}

