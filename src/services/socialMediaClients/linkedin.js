const axios = require('axios');
const logger = require('../../utils/logger');

class LinkedInClient {
  constructor() {
    this.baseURL = 'https://api.linkedin.com/v2';
    this.name = 'linkedin';
  }

  async testConnection(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/me`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return {
        connected: true,
        profile: response.data,
        rateLimitRemaining: response.headers['x-ratelimit-remaining'],
        rateLimitReset: response.headers['x-ratelimit-reset']
      };
    } catch (error) {
      logger.error('LinkedIn connection test failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to connect to LinkedIn');
    }
  }

  async post(credentials, content) {
    try {
      const postData = {
        author: `urn:li:person:${credentials.profileId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content.text
            },
            shareMediaCategory: content.media && content.media.length > 0 ? 'IMAGE' : 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };

      // Handle media attachments
      if (content.media && content.media.length > 0) {
        const mediaAssets = [];
        
        for (const mediaItem of content.media) {
          if (mediaItem.type === 'image') {
            // Upload image first
            const uploadedAsset = await this.uploadImage(credentials, mediaItem.url);
            mediaAssets.push({
              status: 'READY',
              description: {
                text: mediaItem.alt || ''
              },
              media: uploadedAsset.asset,
              title: {
                text: content.title || ''
              }
            });
          }
        }

        postData.specificContent['com.linkedin.ugc.ShareContent'].media = mediaAssets;
      }

      const response = await axios.post(`${this.baseURL}/ugcPosts`, postData, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return {
        success: true,
        postId: response.data.id,
        url: `https://www.linkedin.com/feed/update/${response.data.id}`,
        platform: 'linkedin'
      };

    } catch (error) {
      logger.error('LinkedIn post failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to post to LinkedIn');
    }
  }

  async uploadImage(credentials, imageUrl) {
    try {
      // Register upload
      const registerData = {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: `urn:li:person:${credentials.profileId}`,
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent'
        }]
      };

      const registerResponse = await axios.post(`${this.baseURL}/assets?action=registerUpload`, registerData, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
      const asset = registerResponse.data.value.asset;

      // Download image data
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Upload image
      await axios.put(uploadUrl, imageBuffer, {
        headers: {
          'Content-Type': imageResponse.headers['content-type'] || 'image/jpeg'
        }
      });

      return { asset };

    } catch (error) {
      logger.error('LinkedIn image upload failed:', error.response?.data || error.message);
      throw new Error('Failed to upload image to LinkedIn');
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const { startDate, endDate } = options;
      
      // Get share statistics
      const response = await axios.get(`${this.baseURL}/shares`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        },
        params: {
          q: 'owners',
          owners: `urn:li:person:${credentials.profileId}`,
          count: 50
        }
      });

      let totalLikes = 0;
      let totalShares = 0;
      let totalComments = 0;

      if (response.data.elements) {
        for (const share of response.data.elements) {
          if (share.totalShareStatistics) {
            const stats = share.totalShareStatistics;
            totalLikes += stats.likeCount || 0;
            totalShares += stats.shareCount || 0;
            totalComments += stats.commentCount || 0;
          }
        }
      }

      return {
        totalPosts: response.data.elements?.length || 0,
        totalEngagement: totalLikes + totalShares + totalComments,
        likes: totalLikes,
        shares: totalShares,
        comments: totalComments,
        averageEngagement: response.data.elements?.length > 0 ? 
          (totalLikes + totalShares + totalComments) / response.data.elements.length : 0
      };

    } catch (error) {
      logger.error('LinkedIn analytics failed:', error.response?.data || error.message);
      return {
        totalPosts: 0,
        totalEngagement: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        averageEngagement: 0
      };
    }
  }

  async schedulePost(credentials, content, scheduledTime) {
    // LinkedIn doesn't support native scheduling via API
    // This would typically be handled by our internal scheduler
    throw new Error('LinkedIn API does not support native post scheduling. Use internal scheduler.');
  }

  async deletePost(credentials, postId) {
    try {
      await axios.delete(`${this.baseURL}/ugcPosts/${postId}`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return { success: true };
    } catch (error) {
      logger.error('LinkedIn post deletion failed:', error.response?.data || error.message);
      throw new Error('Failed to delete LinkedIn post');
    }
  }

  async getConnectionRequests(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/people/~/connections`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return response.data.values || [];
    } catch (error) {
      logger.error('LinkedIn connection requests failed:', error.response?.data || error.message);
      return [];
    }
  }

  async sendMessage(credentials, recipientId, message) {
    try {
      const messageData = {
        recipients: [`urn:li:person:${recipientId}`],
        subject: message.subject || 'Message from NTIC',
        body: message.body
      };

      const response = await axios.post(`${this.baseURL}/messages`, messageData, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return {
        success: true,
        messageId: response.data.id
      };
    } catch (error) {
      logger.error('LinkedIn message failed:', error.response?.data || error.message);
      throw new Error('Failed to send LinkedIn message');
    }
  }

  async searchPeople(credentials, query, filters = {}) {
    try {
      const params = {
        q: 'people',
        keywords: query,
        ...filters
      };

      const response = await axios.get(`${this.baseURL}/people-search`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0'
        },
        params
      });

      return response.data.people?.values || [];
    } catch (error) {
      logger.error('LinkedIn people search failed:', error.response?.data || error.message);
      return [];
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: [
        'posting',
        'analytics',
        'messaging',
        'connection_management',
        'people_search'
      ]
    };
  }

  // Rate limiting helper
  getRateLimits() {
    return {
      posts: { limit: 100, window: '1h' },
      api: { limit: 500, window: '1h' },
      messaging: { limit: 25, window: '1d' }
    };
  }
}

module.exports = LinkedInClient;