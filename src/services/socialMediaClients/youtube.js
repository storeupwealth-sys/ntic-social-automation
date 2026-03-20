const { google } = require('googleapis');
const axios = require('axios');
const logger = require('../../utils/logger');

class YouTubeClient {
  constructor() {
    this.name = 'youtube';
  }

  getClient(credentials) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken
    });
    
    return google.youtube({
      version: 'v3',
      auth: oauth2Client
    });
  }

  async testConnection(credentials) {
    try {
      const youtube = this.getClient(credentials);
      
      const response = await youtube.channels.list({
        part: 'id,snippet,statistics',
        mine: true
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw new Error('No YouTube channel found');
      }

      const channel = response.data.items[0];
      
      return {
        connected: true,
        profile: {
          id: channel.id,
          title: channel.snippet.title,
          description: channel.snippet.description,
          subscribers: channel.statistics.subscriberCount,
          videos: channel.statistics.videoCount,
          views: channel.statistics.viewCount
        }
      };
    } catch (error) {
      logger.error('YouTube connection test failed:', error.message);
      throw new Error(error.message || 'Failed to connect to YouTube');
    }
  }

  async uploadVideo(credentials, videoData) {
    try {
      const youtube = this.getClient(credentials);
      
      const {
        title,
        description,
        tags = [],
        categoryId = '22', // Default to People & Blogs
        privacyStatus = 'public',
        videoUrl,
        thumbnailUrl
      } = videoData;

      // Download video file
      const videoResponse = await axios.get(videoUrl, { responseType: 'stream' });
      
      const uploadParams = {
        part: 'id,snippet,status',
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId,
            defaultLanguage: 'en',
            defaultAudioLanguage: 'en'
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false
          }
        },
        media: {
          body: videoResponse.data
        }
      };

      const response = await youtube.videos.insert(uploadParams);
      
      // Upload custom thumbnail if provided
      if (thumbnailUrl && response.data.id) {
        try {
          const thumbnailResponse = await axios.get(thumbnailUrl, { responseType: 'stream' });
          
          await youtube.thumbnails.set({
            videoId: response.data.id,
            media: {
              body: thumbnailResponse.data
            }
          });
        } catch (thumbnailError) {
          logger.warn('Failed to upload custom thumbnail:', thumbnailError.message);
        }
      }

      return {
        success: true,
        videoId: response.data.id,
        url: `https://www.youtube.com/watch?v=${response.data.id}`,
        platform: 'youtube'
      };

    } catch (error) {
      logger.error('YouTube video upload failed:', error.message);
      throw new Error(error.message || 'Failed to upload video to YouTube');
    }
  }

  async post(credentials, content) {
    // YouTube doesn't have "posts" like other platforms, but we can upload videos
    if (content.media && content.media.length > 0) {
      const videoMedia = content.media.find(m => m.type === 'video');
      if (videoMedia) {
        return this.uploadVideo(credentials, {
          title: content.title || 'New Video',
          description: content.text,
          videoUrl: videoMedia.url,
          tags: content.hashtags || [],
          privacyStatus: content.privacy || 'public'
        });
      }
    }
    
    throw new Error('YouTube requires video content for posting');
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const youtube = this.getClient(credentials);
      
      // Get channel info
      const channelResponse = await youtube.channels.list({
        part: 'id,statistics',
        mine: true
      });

      if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
        throw new Error('No YouTube channel found');
      }

      const channel = channelResponse.data.items[0];
      const channelId = channel.id;

      // Get recent videos
      const videosResponse = await youtube.search.list({
        part: 'id,snippet',
        channelId,
        type: 'video',
        order: 'date',
        maxResults: 50
      });

      let totalViews = 0;
      let totalLikes = 0;
      let totalComments = 0;

      if (videosResponse.data.items) {
        const videoIds = videosResponse.data.items.map(item => item.id.videoId);
        
        // Get statistics for videos
        const statsResponse = await youtube.videos.list({
          part: 'statistics',
          id: videoIds.join(',')
        });

        if (statsResponse.data.items) {
          for (const video of statsResponse.data.items) {
            const stats = video.statistics;
            totalViews += parseInt(stats.viewCount || 0);
            totalLikes += parseInt(stats.likeCount || 0);
            totalComments += parseInt(stats.commentCount || 0);
          }
        }
      }

      return {
        totalVideos: videosResponse.data.items?.length || 0,
        totalViews,
        totalLikes,
        totalComments,
        totalEngagement: totalLikes + totalComments,
        subscribers: parseInt(channel.statistics.subscriberCount || 0),
        channelViews: parseInt(channel.statistics.viewCount || 0),
        averageViewsPerVideo: videosResponse.data.items?.length > 0 ? 
          totalViews / videosResponse.data.items.length : 0
      };

    } catch (error) {
      logger.error('YouTube analytics failed:', error.message);
      return {
        totalVideos: 0,
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        totalEngagement: 0,
        subscribers: 0,
        channelViews: 0,
        averageViewsPerVideo: 0
      };
    }
  }

  async updateVideo(credentials, videoId, updates) {
    try {
      const youtube = this.getClient(credentials);
      
      const updateParams = {
        part: 'snippet,status',
        requestBody: {
          id: videoId,
          snippet: updates.snippet,
          status: updates.status
        }
      };

      const response = await youtube.videos.update(updateParams);
      
      return {
        success: true,
        videoId: response.data.id
      };

    } catch (error) {
      logger.error('YouTube video update failed:', error.message);
      throw new Error('Failed to update video');
    }
  }

  async deleteVideo(credentials, videoId) {
    try {
      const youtube = this.getClient(credentials);
      
      await youtube.videos.delete({ id: videoId });
      
      return { success: true };
    } catch (error) {
      logger.error('YouTube video deletion failed:', error.message);
      throw new Error('Failed to delete video');
    }
  }

  async createPlaylist(credentials, playlistData) {
    try {
      const youtube = this.getClient(credentials);
      
      const response = await youtube.playlists.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title: playlistData.title,
            description: playlistData.description || '',
            defaultLanguage: 'en'
          },
          status: {
            privacyStatus: playlistData.privacyStatus || 'public'
          }
        }
      });

      return {
        success: true,
        playlistId: response.data.id,
        url: `https://www.youtube.com/playlist?list=${response.data.id}`
      };

    } catch (error) {
      logger.error('YouTube playlist creation failed:', error.message);
      throw new Error('Failed to create playlist');
    }
  }

  async addVideoToPlaylist(credentials, playlistId, videoId) {
    try {
      const youtube = this.getClient(credentials);
      
      await youtube.playlistItems.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            playlistId,
            resourceId: {
              kind: 'youtube#video',
              videoId
            }
          }
        }
      });

      return { success: true };

    } catch (error) {
      logger.error('YouTube playlist add failed:', error.message);
      throw new Error('Failed to add video to playlist');
    }
  }

  async searchVideos(credentials, query, options = {}) {
    try {
      const youtube = this.getClient(credentials);
      
      const searchParams = {
        part: 'id,snippet',
        q: query,
        type: 'video',
        maxResults: options.maxResults || 10,
        order: options.order || 'relevance'
      };

      const response = await youtube.search.list(searchParams);
      
      return response.data.items || [];

    } catch (error) {
      logger.error('YouTube search failed:', error.message);
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
        'playlist_management',
        'video_management',
        'search'
      ]
    };
  }

  getRateLimits() {
    return {
      uploads: { limit: 6, window: '24h' }, // YouTube has strict upload quotas
      api: { limit: 10000, window: '24h' }
    };
  }
}

module.exports = YouTubeClient;