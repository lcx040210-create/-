'use client';
import { useState, useRef } from 'react';
import api from '@/lib/api';

interface AvatarUploadProps {
  currentUrl?: string;
  onUploaded: (url: string) => void;
}

export function AvatarUpload({ currentUrl, onUploaded }: AvatarUploadProps) {
  const [preview, setPreview] = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('仅支持 JPG、PNG、WebP');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('文件不能超过 2MB');
      return;
    }

    try {
      const cropped = await cropToSquare(file, 200);
      setPreview(cropped.dataUrl);

      setUploading(true);
      const formData = new FormData();
      const blob = dataURLtoBlob(cropped.dataUrl);
      formData.append('file', blob, 'avatar.jpg');

      const { data } = await api.post('/upload/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data.url);
    } catch (err: any) {
      setError(err.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => fileRef.current?.click()}
        className="w-32 h-32 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer overflow-hidden hover:border-blue-400 transition-colors"
      >
        {preview ? (
          <img src={preview} alt="头像" className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-400 text-xs text-center">点击上传<br/>200×200</span>
        )}
      </div>
      {uploading && <span className="text-xs text-blue-500">上传中...</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

function cropToSquare(file: File, size: number): Promise<{ dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function dataURLtoBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)![1];
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
