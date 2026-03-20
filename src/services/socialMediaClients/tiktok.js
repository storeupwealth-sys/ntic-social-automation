const axios = require('axios');
const logger = require('../../utils/logger');

class TikTokClient {
  constructor() {
    this.baseURL = 'https://business-api.tiktok.com/open_api/v1.3';
    this.name = 'tiktok';
  }

  async testConnection(credentials) {
    try {
      // TikTok Business API endpoint for user info
      const response = await axios.get(`${this.baseURL}/user/info/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'TikTok API error');
      }

      return {
        connected: true,
        profile: response.data.data
      };
    } catch (error) {
      logger.error('TikTok connection test failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to connect to TikTok');
    }
  }

  async uploadVideo(credentials, videoData) {
    try {
      const {
        title,
        description,
        videoUrl,
        privacy = 'PUBLIC_TO_EVERYONE',
        allowComments = true,
        allowDuet = true,
        allowStitch = true
      } = videoData;

      // Step 1: Initialize video upload
      const initResponse = await axios.post(`${this.baseURL}/post/publish/video/init/`, {
        post_info: {
          title: title || description.substring(0, 150),
          description,
          privacy_level: privacy,
          disable_comment: !allowComments,
          disable_duet: !allowDuet,
          disable_stitch: !allowStitch,
          auto_add_music: false
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_url: videoUrl
        }
      }, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (initResponse.data.code !== 0) {
        throw new Error(initResponse.data.message || 'Failed to initialize upload');
      }

      const publishId = initResponse.data.data.publish_id;

      // Step 2: Check upload status
      let uploadComplete = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!uploadComplete && attempts < maxAttempts) {
        const statusResponse = await axios.post(`${this.baseURL}/post/publish/status/fetch/`, {
          publish_id: publishId
        }, {
          headers: {
            'Access-Token': credentials.accessToken,
            'Content-Type': 'application/json'
          }
        });

        if (statusResponse.data.code === 0) {
          const status = statusResponse.data.data.status;
          
          if (status === 'PROCESSING_UPLOAD') {
            // Still uploading, wait and retry
            await new Promise(resolve => setTimeout(resolve, 3000));
            attempts++;
          } else if (status === 'UPLOAD_SUCCESS') {
            uploadComplete = true;
          } else if (status === 'FAILED') {
            throw new Error('Video upload failed');
          }
        }
      }

      if (!uploadComplete) {
        throw new Error('Upload timeout - video may still be processing');
      }

      return {
        success: true,
        publishId,
        platform: 'tiktok',
        message: 'Video uploaded successfully to TikTok'
      };

    } catch (error) {
      logger.error('TikTok video upload failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to upload video to TikTok');
    }
  }

  async post(credentials, content) {
    // TikTok is primarily video-based
    if (content.media && content.media.length > 0) {
      const videoMedia = content.media.find(m => m.type === 'video');
      if (videoMedia) {
        return this.uploadVideo(credentials, {
          title: content.title || content.text.substring(0, 150),
          description: content.text,
          videoUrl: videoMedia.url
        });
      }
    }
    
    throw new Error('TikTok requires video content for posting');
  }

  async getAnalytics(credentials, options = {}) {
    try {
      // Get video list first
      const videosResponse = await axios.get(`${this.baseURL}/post/list/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        },
        params: {
          cursor: 0,
          max_count: 20
        }
      });

      if (videosResponse.data.code !== 0) {
        throw new Error(videosResponse.data.message || 'Failed to fetch videos');
      }

      const videos = videosResponse.data.data.videos || [];
      let totalViews = 0;
      let totalLikes = 0;
      let totalShares = 0;
      let totalComments = 0;

      // Get analytics for each video
      for (const video of videos) {
        try {
          const analyticsResponse = await axios.get(`${this.baseURL}/post/data/`, {
            headers: {
              'Access-Token': credentials.accessToken,
              'Content-Type': 'application/json'
            },
            params: {
              item_id: video.item_id,
              metrics: 'VIEWS,LIKES,SHARES,COMMENTS'
            }
          });

          if (analyticsResponse.data.code === 0 && analyticsResponse.data.data) {
            const metrics = analyticsResponse.data.data.metrics;
            totalViews += metrics.views || 0;
            totalLikes += metrics.likes || 0;
            totalShares += metrics.shares || 0;
            totalComments += metrics.comments || 0;
          }
        } catch (analyticsError) {
          logger.warn(`Failed to get analytics for video ${video.item_id}`);
        }
      }

      return {
        totalVideos: videos.length,
        totalViews,
        totalLikes,
        totalShares,
        totalComments,
        totalEngagement: totalLikes + totalShares + totalComments,
        averageViewsPerVideo: videos.length > 0 ? totalViews / videos.length : 0,
        averageEngagementRate: totalViews > 0 ? 
          ((totalLikes + totalShares + totalComments) / totalViews) * 100 : 0
      };

    } catch (error) {
      logger.error('TikTok analytics failed:', error.response?.data || error.message);
      return {
        totalVideos: 0,
        totalViews: 0,
        totalLikes: 0,
        totalShares: 0,
        totalComments: 0,
        totalEngagement: 0,
        averageViewsPerVideo: 0,
        averageEngagementRate: 0
      };
    }
  }

  async getVideoInfo(credentials, itemId) {
    try {
      const response = await axios.get(`${this.baseURL}/post/info/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        },
        params: {
          item_id: itemId
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to fetch video info');
      }

      return response.data.data;

    } catch (error) {
      logger.error('TikTok video info failed:', error.response?.data || error.message);
      throw new Error('Failed to get video information');
    }
  }

  async deleteVideo(credentials, itemId) {
    try {
      const response = await axios.delete(`${this.baseURL}/post/delete/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        },
        data: {
          item_id: itemId
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to delete video');
      }

      return { success: true };

    } catch (error) {
      logger.error('TikTok video deletion failed:', error.response?.data || error.message);
      throw new Error('Failed to delete video');
    }
  }

  async getComments(credentials, itemId, options = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/comment/list/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        },
        params: {
          item_id: itemId,
          cursor: options.cursor || 0,
          count: options.count || 20
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to fetch comments');
      }

      return response.data.data.comments || [];

    } catch (error) {
      logger.error('TikTok comments fetch failed:', error.response?.data || error.message);
      return [];
    }
  }

  async replyToComment(credentials, commentId, replyText) {
    try {
      const response = await axios.post(`${this.baseURL}/comment/reply/`, {
        comment_id: commentId,
        text: replyText
      }, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to reply to comment');
      }

      return {
        success: true,
        commentId: response.data.data.comment_id
      };

    } catch (error) {
      logger.error('TikTok comment reply failed:', error.response?.data || error.message);
      throw new Error('Failed to reply to comment');
    }
  }

  async getTrendingHashtags(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/research/hashtag/trending/`, {
        headers: {
          'Access-Token': credentials.accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to fetch trending hashtags');
      }

      return response.data.data.hashtags || [];

    } catch (error) {
      logger.error('TikTok trending hashtags failed:', error.response?.data || error.message);
      return [];
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: [
        'video_upload',
        'analytics',
        'video_management',
        'comment_management',
        'trending_research'
      ],
      note: 'Requires TikTok Business API access'
    };
  }

  getRateLimits() {
    return {
      uploads: { limit: 10, window: '24h' },
      api: { limit: 1000, window: '24h' },
      comments: { limit: 50, window: '1h' }
    };
  }
}

module.exports = TikTokClient;