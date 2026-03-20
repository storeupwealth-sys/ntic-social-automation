const axios = require('axios');
const logger = require('../../utils/logger');

class PinterestClient {
  constructor() {
    this.baseURL = 'https://api.pinterest.com/v5';
    this.name = 'pinterest';
  }

  async testConnection(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/user_account`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        connected: true,
        profile: {
          id: response.data.id,
          username: response.data.username,
          profile_image: response.data.profile_image,
          follower_count: response.data.follower_count,
          following_count: response.data.following_count,
          pin_count: response.data.pin_count
        }
      };
    } catch (error) {
      logger.error('Pinterest connection test failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to connect to Pinterest');
    }
  }

  async createPin(credentials, pinData) {
    try {
      const {
        title,
        description,
        imageUrl,
        link,
        boardId,
        altText
      } = pinData;

      const pinPayload = {
        title,
        description,
        link,
        media_source: {
          source_type: 'image_url',
          url: imageUrl
        }
      };

      if (boardId) {
        pinPayload.board_id = boardId;
      }

      if (altText) {
        pinPayload.alt_text = altText;
      }

      const response = await axios.post(`${this.baseURL}/pins`, pinPayload, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        pinId: response.data.id,
        url: `https://www.pinterest.com/pin/${response.data.id}/`,
        platform: 'pinterest'
      };

    } catch (error) {
      logger.error('Pinterest pin creation failed:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create Pinterest pin');
    }
  }

  async post(credentials, content) {
    if (content.media && content.media.length > 0) {
      const imageMedia = content.media.find(m => m.type === 'image');
      if (imageMedia) {
        return this.createPin(credentials, {
          title: content.title || content.text.substring(0, 100),
          description: content.text,
          imageUrl: imageMedia.url,
          link: content.link,
          altText: imageMedia.alt
        });
      }
    }
    
    throw new Error('Pinterest requires image content for posting');
  }

  async getBoards(credentials) {
    try {
      const response = await axios.get(`${this.baseURL}/boards`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          page_size: 25
        }
      });

      return response.data.items || [];

    } catch (error) {
      logger.error('Pinterest boards fetch failed:', error.response?.data || error.message);
      return [];
    }
  }

  async createBoard(credentials, boardData) {
    try {
      const {
        name,
        description,
        privacy = 'PUBLIC'
      } = boardData;

      const response = await axios.post(`${this.baseURL}/boards`, {
        name,
        description,
        privacy
      }, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        boardId: response.data.id,
        board: response.data
      };

    } catch (error) {
      logger.error('Pinterest board creation failed:', error.response?.data || error.message);
      throw new Error('Failed to create Pinterest board');
    }
  }

  async getPins(credentials, boardId = null) {
    try {
      let url = `${this.baseURL}/pins`;
      if (boardId) {
        url = `${this.baseURL}/boards/${boardId}/pins`;
      }

      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          page_size: 25
        }
      });

      return response.data.items || [];

    } catch (error) {
      logger.error('Pinterest pins fetch failed:', error.response?.data || error.message);
      return [];
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      // Get user account analytics
      const analyticsResponse = await axios.get(`${this.baseURL}/user_account/analytics`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          start_date: options.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end_date: options.endDate || new Date().toISOString().split('T')[0],
          metric_types: 'IMPRESSION,OUTBOUND_CLICK,PIN_CLICK,SAVE'
        }
      });

      // Get recent pins for engagement data
      const pins = await this.getPins(credentials);
      
      let totalImpressions = 0;
      let totalClicks = 0;
      let totalSaves = 0;
      let totalPins = pins.length;

      if (analyticsResponse.data.daily_metrics) {
        for (const day of analyticsResponse.data.daily_metrics) {
          for (const metric of day.data_status === 'READY' ? day.metrics : []) {
            switch (metric.metric_type) {
              case 'IMPRESSION':
                totalImpressions += metric.value || 0;
                break;
              case 'OUTBOUND_CLICK':
              case 'PIN_CLICK':
                totalClicks += metric.value || 0;
                break;
              case 'SAVE':
                totalSaves += metric.value || 0;
                break;
            }
          }
        }
      }

      return {
        totalPins,
        totalImpressions,
        totalClicks,
        totalSaves,
        totalEngagement: totalClicks + totalSaves,
        clickThroughRate: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
        saveRate: totalImpressions > 0 ? (totalSaves / totalImpressions) * 100 : 0,
        averageImpressions: totalPins > 0 ? totalImpressions / totalPins : 0
      };

    } catch (error) {
      logger.error('Pinterest analytics failed:', error.response?.data || error.message);
      return {
        totalPins: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalSaves: 0,
        totalEngagement: 0,
        clickThroughRate: 0,
        saveRate: 0,
        averageImpressions: 0
      };
    }
  }

  async deletePin(credentials, pinId) {
    try {
      await axios.delete(`${this.baseURL}/pins/${pinId}`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return { success: true };

    } catch (error) {
      logger.error('Pinterest pin deletion failed:', error.response?.data || error.message);
      throw new Error('Failed to delete Pinterest pin');
    }
  }

  async searchPins(credentials, query, options = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/search/pins`, {
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          terms: query,
          page_size: options.limit || 10
        }
      });

      return response.data.items || [];

    } catch (error) {
      logger.error('Pinterest search failed:', error.response?.data || error.message);
      return [];
    }
  }

  async getTrendingTopics(credentials) {
    try {
      // Pinterest doesn't have a direct trending API, so we'll simulate with popular searches
      const trendingKeywords = [
        'home decor', 'wedding ideas', 'recipes', 'fashion', 'diy projects',
        'travel destinations', 'workout routines', 'art inspiration', 'garden ideas',
        'business tips', 'productivity', 'mindfulness', 'photography', 'design'
      ];

      const trending = [];
      
      for (const keyword of trendingKeywords.slice(0, 5)) {
        try {
          const results = await this.searchPins(credentials, keyword, { limit: 1 });
          if (results.length > 0) {
            trending.push({
              keyword,
              popularity: Math.floor(Math.random() * 1000) + 100, // Simulated popularity
              category: this.categorizeKeyword(keyword)
            });
          }
        } catch (searchError) {
          // Skip failed searches
        }
      }

      return trending;

    } catch (error) {
      logger.error('Pinterest trending topics failed:', error.message);
      return [];
    }
  }

  categorizeKeyword(keyword) {
    const categories = {
      'home decor': 'Home & Garden',
      'wedding ideas': 'Events',
      'recipes': 'Food & Drink',
      'fashion': 'Style',
      'diy projects': 'DIY & Crafts',
      'travel destinations': 'Travel',
      'workout routines': 'Health & Fitness',
      'art inspiration': 'Art',
      'garden ideas': 'Home & Garden',
      'business tips': 'Business',
      'productivity': 'Business',
      'mindfulness': 'Health & Fitness',
      'photography': 'Art',
      'design': 'Design'
    };

    return categories[keyword] || 'General';
  }

  async autoPin(credentials, criteria = {}) {
    try {
      const {
        keywords = [],
        maxPins = 5,
        targetBoards = []
      } = criteria;

      const pinnedContent = [];
      
      for (const keyword of keywords) {
        if (pinnedContent.length >= maxPins) break;

        // Search for relevant content to repin
        const searchResults = await this.searchPins(credentials, keyword, { limit: 3 });
        
        for (const pin of searchResults.slice(0, 2)) {
          if (pinnedContent.length >= maxPins) break;

          try {
            // Create a new pin inspired by the found content
            const newPinData = {
              title: `${keyword} inspiration`,
              description: `Great ${keyword} ideas and inspiration`,
              imageUrl: pin.media?.images?.['564x']?.url || pin.images?.['564x']?.url,
              boardId: targetBoards[0] // Use first target board
            };

            const result = await this.createPin(credentials, newPinData);
            pinnedContent.push({
              pinId: result.pinId,
              keyword,
              sourcePin: pin.id
            });

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (pinError) {
            logger.warn(`Failed to create pin for ${keyword}:`, pinError.message);
          }
        }
      }

      return {
        success: true,
        pinsCreated: pinnedContent.length,
        content: pinnedContent
      };

    } catch (error) {
      logger.error('Pinterest auto-pin failed:', error.message);
      throw new Error('Auto-pin failed: ' + error.message);
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: [
        'pin_creation',
        'board_management',
        'analytics',
        'search',
        'auto_pinning'
      ]
    };
  }

  getRateLimits() {
    return {
      pins: { limit: 150, window: '1d' },
      api: { limit: 1000, window: '1h' },
      search: { limit: 200, window: '1h' }
    };
  }
}

module.exports = PinterestClient;