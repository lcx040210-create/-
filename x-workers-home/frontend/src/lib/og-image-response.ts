/**
 * `next/og` 的 ImageResponse 异步加载封装（Node runtime）。
 *
 * 两个目的：
 * 1. Windows 兼容：Next 14.2 内置的 @vercel/og node 包在加载内置字体时使用
 *    `fileURLToPath(path.join(import.meta.url, '../font.ttf'))`，path.join 会把
 *    `file:///C:/...` 变成 `.\file:\C:\...`，fileURLToPath 随即抛 `Invalid URL`。
 *    这里只在「畸形 file: 路径」出现时做一次兼容修正，合法 file URL 原样交给 Node。
 * 2. 可被 Next output file tracing 收集：`next/og` 必须用**静态说明符的动态 import**
 *    加载（运行时 require 不可见，standalone 镜像会丢依赖）。补丁在 import 之前同步执行，
 *    确保 next/og 模块求值（读取内置字体）时修补已生效。
 */

import { createRequire } from 'module';

declare const __non_webpack_require__: NodeRequire | undefined;

type ImageResponseClass = (typeof import('next/og'))['ImageResponse'];

interface PatchedUrlModule {
  fileURLToPath: (input: string | URL) => string;
  __xwhFileUrlPatched?: boolean;
}

/**
 * 仅在 Windows 上修补 Node 的 url.fileURLToPath，处理 @vercel/og 产生的
 * 畸形 `.\file:\C:\...` 输入；合法 file:/// URL 与其他平台不受影响。
 */
function patchFileUrlToPathOnWindows(): void {
  if (process.platform !== 'win32') return;

  const nodeRequire: NodeRequire =
    typeof __non_webpack_require__ === 'function'
      ? __non_webpack_require__
      : createRequire(import.meta.url);

  const nodeUrl = nodeRequire('url') as PatchedUrlModule;
  if (nodeUrl.__xwhFileUrlPatched) return;

  const original = nodeUrl.fileURLToPath;

  nodeUrl.fileURLToPath = function patchedFileURLToPath(input: string | URL): string {
    const text = typeof input === 'string' ? input : String(input);

    // 合法 file:/// 交给 Node 原生实现（含 URL 编码与平台路径转换）。
    if (!/^file:\/\//i.test(text)) {
      const marker = text.indexOf('file:');
      if (marker >= 0) {
        const rest = text.slice(marker + 5).replace(/^[\\/]+/, '');
        if (/^[A-Za-z]:[\\/]/.test(rest)) return rest;
      }
    }

    return original(input);
  };
  nodeUrl.__xwhFileUrlPatched = true;
}

let imageResponsePromise: Promise<ImageResponseClass> | null = null;

/**
 * 返回 next/og 的 ImageResponse（进程内单例）。
 * 静态说明符 `import('next/og')` 可被 @vercel/nft 追踪进 standalone 输出。
 */
export function getImageResponse(): Promise<ImageResponseClass> {
  if (!imageResponsePromise) {
    patchFileUrlToPathOnWindows();
    imageResponsePromise = import('next/og').then((mod) => mod.ImageResponse);
  }
  return imageResponsePromise;
}
