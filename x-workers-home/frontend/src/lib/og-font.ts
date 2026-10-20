/**
 * OG 图 CJK 字体加载。
 *
 * next/og 自带的默认字体只有拉丁字符（noto-sans-latin），中文会缺字。
 * 这里优先使用 `OG_FONT_PATH` 指定的 ttf/otf，其次尝试常见系统字体路径；
 * 部署到 Linux 时请把中文字体挂进容器并设置 OG_FONT_PATH。
 * 找不到任何字体时返回空数组（图片仍可生成，但中文可能缺字，不会崩溃）。
 */

import { readFile } from 'fs/promises';

const FONT_NAME = 'OG';

const FONT_CANDIDATES: string[] = [
  process.env.OG_FONT_PATH ?? '',
  // Windows（dev / QA 环境）
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/msyh.ttf',
  // Linux 常见中文字体（ttf；satori 不支持 ttc/woff2）
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttf',
].filter((path) => path.length > 0);

interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400;
  style: 'normal';
}

let cached: Promise<ArrayBuffer | null> | null = null;

async function readFirstFont(): Promise<ArrayBuffer | null> {
  for (const path of FONT_CANDIDATES) {
    try {
      const buffer = await readFile(path);
      // Buffer 可能来自共享内存池：切出精确的 ArrayBuffer 片段。
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
    } catch {
      // 尝试下一个候选路径
    }
  }
  return null;
}

/** 进程内缓存（成功与失败都缓存，避免每次请求重复 stat/read）。 */
export function loadOgFont(): Promise<ArrayBuffer | null> {
  if (!cached) cached = readFirstFont();
  return cached;
}

/** 供 ImageResponse 使用的 fonts 配置；无字体时返回空数组。 */
export async function loadOgFonts(): Promise<OgFont[]> {
  const data = await loadOgFont();
  return data ? [{ name: FONT_NAME, data, weight: 400, style: 'normal' }] : [];
}

/** 有字体时统一使用的 family；无字体返回 undefined 走 next/og 默认字体。 */
export function ogFontFamily(fonts: OgFont[]): string | undefined {
  return fonts.length > 0 ? FONT_NAME : undefined;
}
