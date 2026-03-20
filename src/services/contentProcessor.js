const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');

class ContentProcessor {
  constructor() {
    this.uploadPath = process.env.UPLOAD_PATH || 'uploads/';
    this.maxFileSize = this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB');
    this.allowedImageTypes = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
    this.allowedVideoTypes = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
  }

  parseFileSize(sizeStr) {
    const units = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = sizeStr.match(/^(\d+)\s*(KB|MB|GB)$/i);
    if (match) {
      return parseInt(match[1]) * units[match[2].toUpperCase()];
    }
    return parseInt(sizeStr); // Assume bytes if no unit
  }

  async downloadAndProcessMedia(mediaUrls) {
    const processedMedia = [];
    
    try {
      // Ensure upload directory exists
      await fs.mkdir(this.uploadPath, { recursive: true });
      
      for (const url of mediaUrls) {
        try {
          const processedItem = await this.downloadAndProcessSingleMedia(url);
          processedMedia.push(processedItem);
        } catch (error) {
          logger.warn(`Failed to process media from URL ${url}:`, error.message);
        }
      }
      
      return processedMedia;
      
    } catch (error) {
      logger.error('Failed to process media:', error);
      throw new Error('Failed to process media files');
    }
  }

  async downloadAndProcessSingleMedia(url) {
    try {
      // Download the file
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: this.maxFileSize
      });

      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'];
      const fileSize = buffer.length;

      if (fileSize > this.maxFileSize) {
        throw new Error(`File too large: ${fileSize} bytes (max: ${this.maxFileSize} bytes)`);
      }

      // Determine file type
      const mediaType = this.determineMediaType(contentType, buffer);
      if (!mediaType) {
        throw new Error('Unsupported file type');
      }

      // Generate unique filename
      const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
      const timestamp = Date.now();
      const extension = this.getFileExtension(contentType, mediaType.type);
      const filename = `${mediaType.type}_${timestamp}_${hash}.${extension}`;
      const filePath = path.join(this.uploadPath, filename);

      let processedBuffer = buffer;

      // Process based on media type
      if (mediaType.type === 'image') {
        processedBuffer = await this.processImage(buffer, extension);
      } else if (mediaType.type === 'video') {
        // For videos, we'll save as-is but could add processing here
        processedBuffer = buffer;
      }

      // Save the file
      await fs.writeFile(filePath, processedBuffer);

      const mediaItem = {
        type: mediaType.type,
        url: `/static/uploads/${filename}`,
        filename,
        size: processedBuffer.length,
        mimeType: contentType,
        originalUrl: url,
        processed: mediaType.type === 'image' ? true : false
      };

      // Generate thumbnail for videos
      if (mediaType.type === 'video') {
        try {
          const thumbnailPath = await this.generateVideoThumbnail(filePath, filename);
          mediaItem.thumbnail = `/static/uploads/${thumbnailPath}`;
        } catch (thumbError) {
          logger.warn(`Failed to generate video thumbnail for ${filename}:`, thumbError.message);
        }
      }

      logger.info(`Successfully processed media: ${filename} (${mediaType.type}, ${processedBuffer.length} bytes)`);
      return mediaItem;

    } catch (error) {
      logger.error(`Failed to download and process media from ${url}:`, error.message);
      throw error;
    }
  }

  determineMediaType(contentType, buffer) {
    // Check by content type first
    if (contentType) {
      if (contentType.startsWith('image/')) {
        const subtype = contentType.split('/')[1];
        if (this.allowedImageTypes.includes(subtype)) {
          return { type: 'image', subtype };
        }
      } else if (contentType.startsWith('video/')) {
        const subtype = contentType.split('/')[1];
        if (this.allowedVideoTypes.includes(subtype)) {
          return { type: 'video', subtype };
        }
      }
    }

    // Fallback to magic number detection
    return this.detectFileTypeByMagicNumbers(buffer);
  }

  detectFileTypeByMagicNumbers(buffer) {
    if (buffer.length < 4) return null;

    const header = buffer.slice(0, 12).toString('hex').toUpperCase();

    // Image magic numbers
    const imageSignatures = {
      'FFD8FF': { type: 'image', subtype: 'jpeg' },
      '89504E47': { type: 'image', subtype: 'png' },
      '47494638': { type: 'image', subtype: 'gif' },
      '52494646': buffer.slice(8, 12).toString() === 'WEBP' ? { type: 'image', subtype: 'webp' } : null
    };

    // Video magic numbers
    const videoSignatures = {
      '00000018667479706D703432': { type: 'video', subtype: 'mp4' },
      '00000020667479706D703432': { type: 'video', subtype: 'mp4' },
      '000001BA': { type: 'video', subtype: 'mpeg' },
      '000001B3': { type: 'video', subtype: 'mpeg' },
      '1A45DFA3': { type: 'video', subtype: 'webm' }
    };

    // Check image signatures
    for (const [signature, type] of Object.entries(imageSignatures)) {
      if (header.startsWith(signature) && type) {
        return type;
      }
    }

    // Check video signatures
    for (const [signature, type] of Object.entries(videoSignatures)) {
      if (header.startsWith(signature)) {
        return type;
      }
    }

    return null;
  }

  getFileExtension(contentType, mediaType) {
    if (mediaType === 'image') {
      const typeMap = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp'
      };
      return typeMap[contentType] || 'jpg';
    } else if (mediaType === 'video') {
      const typeMap = {
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
        'video/webm': 'webm'
      };
      return typeMap[contentType] || 'mp4';
    }
    return 'bin';
  }

  async processImage(buffer, extension) {
    try {
      let processor = sharp(buffer);

      // Get image metadata
      const metadata = await processor.metadata();
      
      // Optimize based on format and size
      if (metadata.width > 2048 || metadata.height > 2048) {
        processor = processor.resize(2048, 2048, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Format-specific optimization
      switch (extension.toLowerCase()) {
        case 'jpg':
        case 'jpeg':
          return await processor
            .jpeg({ 
              quality: 85,
              progressive: true,
              mozjpeg: true
            })
            .toBuffer();

        case 'png':
          return await processor
            .png({ 
              quality: 85,
              progressive: true,
              palette: true
            })
            .toBuffer();

        case 'webp':
          return await processor
            .webp({ quality: 85 })
            .toBuffer();

        default:
          // Convert to JPEG for unsupported formats
          return await processor
            .jpeg({ quality: 85, progressive: true })
            .toBuffer();
      }

    } catch (error) {
      logger.warn('Image processing failed, using original:', error.message);
      return buffer;
    }
  }

  async generateVideoThumbnail(videoPath, videoFilename) {
    try {
      // This is a simplified implementation
      // In production, you might want to use ffmpeg for video thumbnail generation
      const thumbnailFilename = videoFilename.replace(/\.[^.]+$/, '_thumb.jpg');
      const thumbnailPath = path.join(this.uploadPath, thumbnailFilename);

      // For now, create a placeholder thumbnail
      // In a real implementation, you'd extract a frame from the video
      const placeholderBuffer = await this.createVideoPlaceholder();
      await fs.writeFile(thumbnailPath, placeholderBuffer);

      return thumbnailFilename;

    } catch (error) {
      logger.warn('Video thumbnail generation failed:', error.message);
      return null;
    }
  }

  async createVideoPlaceholder() {
    // Create a simple placeholder image for video thumbnails
    return await sharp({
      create: {
        width: 480,
        height: 270,
        channels: 3,
        background: { r: 30, g: 30, b: 30 }
      }
    })
    .png()
    .composite([{
      input: Buffer.from(`
        <svg width="480" height="270">
          <rect width="480" height="270" fill="#1e1e1e"/>
          <circle cx="240" cy="135" r="40" fill="#ffffff" opacity="0.8"/>
          <polygon points="225,120 225,150 255,135" fill="#1e1e1e"/>
          <text x="240" y="200" text-anchor="middle" fill="#ffffff" font-size="16" font-family="Arial">Video Content</text>
        </svg>
      `),
      top: 0,
      left: 0
    }])
    .png()
    .toBuffer();
  }

  async optimizeForPlatform(mediaItem, platform) {
    try {
      const filePath = path.join(this.uploadPath, mediaItem.filename);
      const buffer = await fs.readFile(filePath);

      if (mediaItem.type !== 'image') {
        return mediaItem; // Only optimize images for now
      }

      const platformSpecs = this.getPlatformImageSpecs(platform);
      if (!platformSpecs) {
        return mediaItem; // No specific optimization needed
      }

      const processor = sharp(buffer);
      const metadata = await processor.metadata();

      // Check if optimization is needed
      const needsOptimization = 
        metadata.width > platformSpecs.maxWidth ||
        metadata.height > platformSpecs.maxHeight ||
        buffer.length > platformSpecs.maxFileSize;

      if (!needsOptimization) {
        return mediaItem;
      }

      // Create optimized version
      const optimizedBuffer = await processor
        .resize(platformSpecs.maxWidth, platformSpecs.maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: platformSpecs.quality || 85 })
        .toBuffer();

      // Save optimized version
      const optimizedFilename = mediaItem.filename.replace(/(\.[^.]+)$/, `_${platform}$1`);
      const optimizedPath = path.join(this.uploadPath, optimizedFilename);
      await fs.writeFile(optimizedPath, optimizedBuffer);

      return {
        ...mediaItem,
        optimizedForPlatform: platform,
        optimizedUrl: `/static/uploads/${optimizedFilename}`,
        optimizedFilename,
        optimizedSize: optimizedBuffer.length
      };

    } catch (error) {
      logger.warn(`Failed to optimize media for ${platform}:`, error.message);
      return mediaItem;
    }
  }

  getPlatformImageSpecs(platform) {
    const specs = {
      twitter: {
        maxWidth: 2048,
        maxHeight: 2048,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        quality: 85
      },
      linkedin: {
        maxWidth: 1200,
        maxHeight: 1200,
        maxFileSize: 8 * 1024 * 1024, // 8MB
        quality: 90
      },
      facebook: {
        maxWidth: 2048,
        maxHeight: 2048,
        maxFileSize: 4 * 1024 * 1024, // 4MB
        quality: 85
      },
      instagram: {
        maxWidth: 1080,
        maxHeight: 1350,
        maxFileSize: 8 * 1024 * 1024, // 8MB
        quality: 90
      },
      pinterest: {
        maxWidth: 1000,
        maxHeight: 1500,
        maxFileSize: 2 * 1024 * 1024, // 2MB
        quality: 85
      }
    };

    return specs[platform];
  }

  async cleanupOldFiles(maxAgeDays = 30) {
    try {
      const files = await fs.readdir(this.uploadPath);
      const now = Date.now();
      const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
      let cleanedCount = 0;

      for (const filename of files) {
        const filePath = path.join(this.uploadPath, filename);
        const stat = await fs.stat(filePath);
        
        if (now - stat.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }

      logger.info(`Cleaned up ${cleanedCount} old media files`);
      return cleanedCount;

    } catch (error) {
      logger.error('Failed to cleanup old files:', error);
      return 0;
    }
  }

  async getStorageStats() {
    try {
      const files = await fs.readdir(this.uploadPath);
      let totalSize = 0;
      let fileCount = 0;
      const typeStats = { image: 0, video: 0, other: 0 };

      for (const filename of files) {
        const filePath = path.join(this.uploadPath, filename);
        const stat = await fs.stat(filePath);
        
        totalSize += stat.size;
        fileCount++;

        if (filename.includes('_thumb') || filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
          typeStats.image++;
        } else if (filename.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
          typeStats.video++;
        } else {
          typeStats.other++;
        }
      }

      return {
        totalSize,
        fileCount,
        typeStats,
        averageFileSize: fileCount > 0 ? totalSize / fileCount : 0
      };

    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      return { totalSize: 0, fileCount: 0, typeStats: {}, averageFileSize: 0 };
    }
  }
}

module.exports = new ContentProcessor();