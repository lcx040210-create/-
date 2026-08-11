import { Injectable, BadRequestException } from '@nestjs/common';
import { createS3Client } from './s3.config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
  async uploadAvatar(file: Express.Multer.File): Promise<string> {
    if (!file) throw new BadRequestException('请选择文件');

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG、WebP 格式');
    }

    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('文件大小不能超过 2MB');
    }

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `avatars/${uuid()}${ext}`;

    const s3 = createS3Client();
    if (s3) {
      const bucket = process.env.S3_BUCKET || 'english-platform';
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }));
      const endpoint = process.env.S3_ENDPOINT;
      return `${endpoint}/${bucket}/${filename}`;
    } else {
      const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filepath = path.join(uploadDir, `${uuid()}${ext}`);
      fs.writeFileSync(filepath, file.buffer);
      return `/uploads/avatars/${path.basename(filepath)}`;
    }
  }
}
