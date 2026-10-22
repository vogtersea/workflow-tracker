import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 手机单机版（Android APK）打包配置
 *
 * webDir 指向静态导出产物（node scripts/build-local.mjs 生成）。
 * 全部业务在 WebView 内完成，不请求任何远程服务器；
 * 数据存于 WebView 的 IndexedDB，随应用卸载而清除。
 */
const config: CapacitorConfig = {
  appId: 'com.workflowtracker.local',
  appName: '工作流程跟踪',
  webDir: 'out-local',
  server: {
    // 用 https 自定义 scheme，保证 IndexedDB / WASM 等能力可用
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
