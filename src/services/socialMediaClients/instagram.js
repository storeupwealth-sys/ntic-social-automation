const axios = require('axios');
const logger = require('../../utils/logger');

class InstagramClient {
  constructor() {
    this.baseURL = 'https://graph.facebook.com/v18.0';
    this.name = 'instagram';
  }

  async testConnection(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/${credentials.businessAccountId}`, {
        params: {
          access_token: credentials.accessToken,
          fields: 'id,username,name,profile_picture_url,followers_count'
        }
      });

      return {
        connected: true,
        profile: response.data
      };
    } catch (error) {
      logger.error('Instagram connection test failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to connect to Instagram');
    }
  }

  async post(credentials, content) {
    try {
      const accountId = credentials.businessAccountId;
      
      // Step 1: Create media container
      const mediaData = {
        access_token: credentials.accessToken
      };

      if (content.media && content.media.length > 0) {
        const mediaItem = content.media[0];
        
        if (mediaItem.type === 'image') {
          mediaData.image_url = mediaItem.url;
          mediaData.caption = content.text;
        } else if (mediaItem.type === 'video') {
          mediaData.video_url = mediaItem.url;
          mediaData.caption = content.text;
          mediaData.media_type = 'VIDEO';
        }
      } else {
        // Text-only posts not supported on Instagram
        throw new Error('Instagram requires media content');
      }

      const containerResponse = await axios.post(
        `${this.baseURL}/${accountId}/media`,
        mediaData
      );

      const containerId = containerResponse.data.id;

      // Step 2: Publish the media
      const publishResponse = await axios.post(
        `${this.baseURL}/${accountId}/media_publish`,
        {
          creation_id: containerId,
          access_token: credentials.accessToken
        }
      );

      return {
        success: true,
        postId: publishResponse.data.id,
        platform: 'instagram'
      };

    } catch (error) {
      logger.error('Instagram post failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to post to Instagram');
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const accountId = credentials.businessAccountId;

      // Get recent media
      const mediaResponse = await axios.get(`${this.baseURL}/${accountId}/media`, {
        params: {
          access_token: credentials.accessToken,
          fields: 'id,media_type,timestamp,insights',
          limit: 25
        }
      });

      let totalLikes = 0;
      let totalComments = 0;
      let totalReach = 0;
      let totalImpressions = 0;

      if (mediaResponse.data.data) {
        for (const media of mediaResponse.data.data) {
          try {
            const insightsResponse = await axios.get(`${this.baseURL}/${media.id}/insights`, {
              params: {
                access_token: credentials.accessToken,
                metric: 'likes,comments,reach,impressions'
              }
            });

            if (insightsResponse.data.data) {
              for (const insight of insightsResponse.data.data) {
                const value = insight.values[0]?.value || 0;
                switch (insight.name) {
                  case 'likes':
                    totalLikes += value;
                    break;
                  case 'comments':
                    totalComments += value;
                    break;
                  case 'reach':
                    totalReach += value;
                    break;
                  case 'impressions':
                    totalImpressions += value;
                    break;
                }
              }
            }
          } catch (insightError) {
            // Some media might not have insights available
            logger.warn(`Failed to get insights for media ${media.id}`);
          }
        }
      }

      return {
        totalPosts: mediaResponse.data.data?.length || 0,
        totalEngagement: totalLikes + totalComments,
        likes: totalLikes,
        comments: totalComments,
        reach: totalReach,
        impressions: totalImpressions,
        averageEngagement: mediaResponse.data.data?.length > 0 ? 
          (totalLikes + totalComments) / mediaResponse.data.data.length : 0
      };

    } catch (error) {
      logger.error('Instagram analytics failed:', error.response?.data || error.message);
      return {
        totalPosts: 0,
        totalEngagement: 0,
        likes: 0,
        comments: 0,
        reach: 0,
        impressions: 0,
        averageEngagement: 0
      };
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: ['posting', 'analytics', 'stories'],
      requirements: 'Business account required'
    };
  }

  getRateLimits() {
    return {
      posts: { limit: 25, window: '1h' },
      api: { limit: 200, window: '1h' }
    };
  }
}

module.exports = InstagramClient;