/**
 * `next/og` 的 ImageResponse 封装（Node runtime）。
 *
 * Next 14.2 内置的 @vercel/og node 包在 Windows 上加载内置字体时使用
 * `fileURLToPath(path.join(import.meta.url, '../font.ttf'))`，path.join 会把
 * `file:///C:/...` 变成 `.\file:\C:\...`，fileURLToPath 随即抛 `Invalid URL`。
 * 这里只在「畸形 file: 路径」出现时做一次兼容修正，合法 file URL 原样交给 Node。
 *
 * 该补丁必须在 require('next/og') 之前生效，因此本模块用运行时 require
 * （webpack 不会静态内联），路由统一从本模块导入 ImageResponse。
 */

import { createRequire } from 'module';

declare const __non_webpack_require__: NodeRequire | undefined;

const nodeRequire: NodeRequire =
  typeof __non_webpack_require__ === 'function'
    ? __non_webpack_require__
    : createRequire(import.meta.url);

interface PatchedUrlModule {
  fileURLToPath: (input: string | URL) => string;
  __xwhFileUrlPatched?: boolean;
}

const nodeUrl = nodeRequire('url') as PatchedUrlModule;

if (!nodeUrl.__xwhFileUrlPatched) {
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

const og = nodeRequire('next/og') as typeof import('next/og');

export const ImageResponse = og.ImageResponse;
