const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const logger = require('../../utils/logger');

class TwitterClient {
  constructor() {
    this.name = 'twitter';
  }

  getClient(credentials) {
    return new TwitterApi({
      appKey: credentials.clientId,
      appSecret: credentials.clientSecret,
      accessToken: credentials.accessToken,
      accessSecret: credentials.refreshToken // Using refreshToken as accessSecret
    });
  }

  async testConnection(credentials) {
    try {
      const client = this.getClient(credentials);
      const user = await client.currentUser();
      
      return {
        connected: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          followers: user.public_metrics?.followers_count
        }
      };
    } catch (error) {
      logger.error('Twitter connection test failed:', error.message);
      throw new Error(error.message || 'Failed to connect to Twitter');
    }
  }

  async post(credentials, content) {
    try {
      const client = this.getClient(credentials);
      let tweetData = { text: content.text };

      // Handle media attachments
      if (content.media && content.media.length > 0) {
        const mediaIds = [];
        
        for (const mediaItem of content.media) {
          if (mediaItem.type === 'image') {
            const mediaId = await this.uploadMedia(client, mediaItem.url, 'image');
            mediaIds.push(mediaId);
          } else if (mediaItem.type === 'video') {
            const mediaId = await this.uploadMedia(client, mediaItem.url, 'video');
            mediaIds.push(mediaId);
          }
        }

        if (mediaIds.length > 0) {
          tweetData.media = { media_ids: mediaIds };
        }
      }

      // Handle threads
      if (content.thread && Array.isArray(content.thread)) {
        const tweets = [];
        let previousTweetId = null;

        for (let i = 0; i < content.thread.length; i++) {
          const threadTweetData = { text: content.thread[i] };
          
          if (previousTweetId) {
            threadTweetData.reply = { in_reply_to_tweet_id: previousTweetId };
          }

          const tweet = await client.v2.tweet(threadTweetData);
          tweets.push(tweet);
          previousTweetId = tweet.data.id;
        }

        return {
          success: true,
          thread: tweets,
          mainTweetId: tweets[0].data.id,
          url: `https://twitter.com/intent/tweet/${tweets[0].data.id}`,
          platform: 'twitter'
        };
      } else {
        const tweet = await client.v2.tweet(tweetData);
        
        return {
          success: true,
          postId: tweet.data.id,
          url: `https://twitter.com/intent/tweet/${tweet.data.id}`,
          platform: 'twitter'
        };
      }

    } catch (error) {
      logger.error('Twitter post failed:', error.message);
      throw new Error(error.message || 'Failed to post to Twitter');
    }
  }

  async uploadMedia(client, mediaUrl, type) {
    try {
      // Download media
      const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const mediaBuffer = Buffer.from(response.data);

      // Upload to Twitter
      const mediaUpload = await client.v1.uploadMedia(mediaBuffer, { 
        mimeType: response.headers['content-type'],
        type: type === 'image' ? 'image' : 'video'
      });

      return mediaUpload;
    } catch (error) {
      logger.error('Twitter media upload failed:', error.message);
      throw new Error('Failed to upload media to Twitter');
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const client = this.getClient(credentials);
      const user = await client.currentUser();
      
      // Get recent tweets
      const tweets = await client.v2.userTimeline(user.id, {
        max_results: 100,
        'tweet.fields': 'public_metrics,created_at'
      });

      let totalLikes = 0;
      let totalRetweets = 0;
      let totalReplies = 0;
      let totalQuotes = 0;
      let totalImpressions = 0;

      if (tweets.data?.data) {
        for (const tweet of tweets.data.data) {
          const metrics = tweet.public_metrics;
          totalLikes += metrics.like_count || 0;
          totalRetweets += metrics.retweet_count || 0;
          totalReplies += metrics.reply_count || 0;
          totalQuotes += metrics.quote_count || 0;
          totalImpressions += metrics.impression_count || 0;
        }
      }

      return {
        totalPosts: tweets.data?.data?.length || 0,
        totalEngagement: totalLikes + totalRetweets + totalReplies + totalQuotes,
        likes: totalLikes,
        retweets: totalRetweets,
        replies: totalReplies,
        quotes: totalQuotes,
        impressions: totalImpressions,
        followers: user.public_metrics?.followers_count || 0,
        following: user.public_metrics?.following_count || 0,
        averageEngagement: tweets.data?.data?.length > 0 ? 
          (totalLikes + totalRetweets + totalReplies) / tweets.data.data.length : 0
      };

    } catch (error) {
      logger.error('Twitter analytics failed:', error.message);
      return {
        totalPosts: 0,
        totalEngagement: 0,
        likes: 0,
        retweets: 0,
        replies: 0,
        followers: 0,
        following: 0,
        averageEngagement: 0
      };
    }
  }

  async deleteTweet(credentials, tweetId) {
    try {
      const client = this.getClient(credentials);
      await client.v2.deleteTweet(tweetId);
      
      return { success: true };
    } catch (error) {
      logger.error('Twitter deletion failed:', error.message);
      throw new Error('Failed to delete tweet');
    }
  }

  async retweet(credentials, tweetId) {
    try {
      const client = this.getClient(credentials);
      const user = await client.currentUser();
      
      await client.v2.retweet(user.id, tweetId);
      
      return { success: true };
    } catch (error) {
      logger.error('Twitter retweet failed:', error.message);
      throw new Error('Failed to retweet');
    }
  }

  async like(credentials, tweetId) {
    try {
      const client = this.getClient(credentials);
      const user = await client.currentUser();
      
      await client.v2.like(user.id, tweetId);
      
      return { success: true };
    } catch (error) {
      logger.error('Twitter like failed:', error.message);
      throw new Error('Failed to like tweet');
    }
  }

  async follow(credentials, userId) {
    try {
      const client = this.getClient(credentials);
      const currentUser = await client.currentUser();
      
      await client.v2.follow(currentUser.id, userId);
      
      return { success: true };
    } catch (error) {
      logger.error('Twitter follow failed:', error.message);
      throw new Error('Failed to follow user');
    }
  }

  async sendDirectMessage(credentials, recipientId, message) {
    try {
      const client = this.getClient(credentials);
      
      const dm = await client.v1.sendDm({
        recipient_id: recipientId,
        text: message
      });
      
      return {
        success: true,
        messageId: dm.id
      };
    } catch (error) {
      logger.error('Twitter DM failed:', error.message);
      throw new Error('Failed to send direct message');
    }
  }

  async searchTweets(credentials, query, options = {}) {
    try {
      const client = this.getClient(credentials);
      
      const searchParams = {
        query,
        max_results: options.limit || 10,
        'tweet.fields': 'public_metrics,author_id,created_at',
        'user.fields': 'username,name,public_metrics'
      };

      const tweets = await client.v2.search(query, searchParams);
      
      return tweets.data?.data || [];
    } catch (error) {
      logger.error('Twitter search failed:', error.message);
      return [];
    }
  }

  async getTrendingTopics(credentials, location = 1) { // 1 = worldwide
    try {
      const client = this.getClient(credentials);
      const trends = await client.v1.trendsAvailable();
      
      return trends[0]?.trends || [];
    } catch (error) {
      logger.error('Twitter trends failed:', error.message);
      return [];
    }
  }

  async autoEngage(credentials, options = {}) {
    try {
      const client = this.getClient(credentials);
      const {
        targetAccounts = [],
        keywords = [],
        maxActions = 10,
        actionTypes = ['like', 'retweet']
      } = options;

      let actionsPerformed = 0;
      const results = [];

      // Engage with target accounts' recent tweets
      for (const account of targetAccounts) {
        if (actionsPerformed >= maxActions) break;

        try {
          const timeline = await client.v2.userTimeline(account, {
            max_results: 5,
            'tweet.fields': 'public_metrics'
          });

          if (timeline.data?.data) {
            for (const tweet of timeline.data.data.slice(0, 2)) {
              if (actionsPerformed >= maxActions) break;

              if (actionTypes.includes('like')) {
                await this.like(credentials, tweet.id);
                results.push({ action: 'like', tweetId: tweet.id, account });
                actionsPerformed++;
              }

              if (actionTypes.includes('retweet') && actionsPerformed < maxActions) {
                await this.retweet(credentials, tweet.id);
                results.push({ action: 'retweet', tweetId: tweet.id, account });
                actionsPerformed++;
              }
            }
          }
        } catch (accountError) {
          logger.warn(`Auto-engage failed for account ${account}:`, accountError.message);
        }
      }

      // Engage with keyword-based content
      for (const keyword of keywords) {
        if (actionsPerformed >= maxActions) break;

        try {
          const searchResults = await this.searchTweets(credentials, keyword, { limit: 5 });
          
          for (const tweet of searchResults.slice(0, 2)) {
            if (actionsPerformed >= maxActions) break;

            if (actionTypes.includes('like')) {
              await this.like(credentials, tweet.id);
              results.push({ action: 'like', tweetId: tweet.id, keyword });
              actionsPerformed++;
            }
          }
        } catch (keywordError) {
          logger.warn(`Auto-engage failed for keyword ${keyword}:`, keywordError.message);
        }
      }

      return {
        success: true,
        actionsPerformed,
        results
      };

    } catch (error) {
      logger.error('Twitter auto-engage failed:', error.message);
      throw new Error('Auto-engagement failed');
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: [
        'posting',
        'threading',
        'analytics',
        'media_upload',
        'engagement',
        'direct_messages',
        'search',
        'auto_engage'
      ]
    };
  }

  getRateLimits() {
    return {
      posts: { limit: 300, window: '15m' },
      api: { limit: 900, window: '15m' },
      search: { limit: 180, window: '15m' },
      engagement: { limit: 1000, window: '24h' }
    };
  }
}

module.exports = TwitterClient;