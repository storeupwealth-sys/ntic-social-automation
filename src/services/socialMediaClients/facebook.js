const axios = require('axios');
const logger = require('../../utils/logger');

class FacebookClient {
  constructor() {
    this.baseURL = 'https://graph.facebook.com/v18.0';
    this.name = 'facebook';
  }

  async testConnection(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        params: {
          access_token: credentials.accessToken,
          fields: 'id,name,email'
        }
      });

      return {
        connected: true,
        profile: response.data
      };
    } catch (error) {
      logger.error('Facebook connection test failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to connect to Facebook');
    }
  }

  async post(credentials, content) {
    try {
      const pageId = credentials.pageId;
      const postData = {
        message: content.text,
        access_token: credentials.accessToken
      };

      // Handle media attachments
      if (content.media && content.media.length > 0) {
        const mediaItem = content.media[0]; // Facebook allows one media per post
        
        if (mediaItem.type === 'image') {
          postData.url = mediaItem.url;
        } else if (mediaItem.type === 'video') {
          postData.source = mediaItem.url;
        }
      }

      const endpoint = pageId ? `/${pageId}/posts` : '/me/posts';
      const response = await axios.post(`${this.baseURL}${endpoint}`, postData);

      return {
        success: true,
        postId: response.data.id,
        platform: 'facebook'
      };

    } catch (error) {
      logger.error('Facebook post failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to post to Facebook');
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const pageId = credentials.pageId;
      const endpoint = pageId ? `/${pageId}/posts` : '/me/posts';

      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        params: {
          access_token: credentials.accessToken,
          fields: 'id,message,created_time,insights{name,values}',
          limit: 25
        }
      });

      let totalLikes = 0;
      let totalShares = 0;
      let totalComments = 0;
      let totalReach = 0;

      if (response.data.data) {
        for (const post of response.data.data) {
          if (post.insights && post.insights.data) {
            for (const insight of post.insights.data) {
              const value = insight.values[0]?.value || 0;
              switch (insight.name) {
                case 'post_reactions_like_total':
                  totalLikes += value;
                  break;
                case 'post_shares':
                  totalShares += value;
                  break;
                case 'post_comments':
                  totalComments += value;
                  break;
                case 'post_impressions':
                  totalReach += value;
                  break;
              }
            }
          }
        }
      }

      return {
        totalPosts: response.data.data?.length || 0,
        totalEngagement: totalLikes + totalShares + totalComments,
        likes: totalLikes,
        shares: totalShares,
        comments: totalComments,
        reach: totalReach,
        averageEngagement: response.data.data?.length > 0 ? 
          (totalLikes + totalShares + totalComments) / response.data.data.length : 0
      };

    } catch (error) {
      logger.error('Facebook analytics failed:', error.response?.data || error.message);
      return {
        totalPosts: 0,
        totalEngagement: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        reach: 0,
        averageEngagement: 0
      };
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: ['posting', 'analytics', 'page_management']
    };
  }

  getRateLimits() {
    return {
      posts: { limit: 200, window: '1h' },
      api: { limit: 200, window: '1h' }
    };
  }
}

module.exports = FacebookClient;