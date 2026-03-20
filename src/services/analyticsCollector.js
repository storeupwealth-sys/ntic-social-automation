const cron = require('node-cron');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const Campaign = require('../models/Campaign');
const socialMediaClients = require('./socialMediaClients');
const logger = require('../utils/logger');

class AnalyticsCollector {
  constructor() {
    this.isRunning = false;
    this.collectionInterval = null;
    this.lastCollectionTime = null;
  }

  start() {
    if (this.isRunning) {
      logger.warn('Analytics collector already running');
      return;
    }

    // Collect analytics every 2 hours
    this.collectionInterval = cron.schedule('0 */2 * * *', async () => {
      await this.collectAllAnalytics();
    });

    // Collect engagement data every 30 minutes for recent posts
    cron.schedule('*/30 * * * *', async () => {
      await this.collectRecentEngagement();
    });

    // Daily comprehensive analytics collection
    cron.schedule('0 1 * * *', async () => {
      await this.collectDailyAnalytics();
    });

    // Weekly trend analysis
    cron.schedule('0 2 * * 1', async () => {
      await this.analyzeWeeklyTrends();
    });

    this.isRunning = true;
    logger.info('Analytics collector started');
  }

  stop() {
    if (this.collectionInterval) {
      this.collectionInterval.destroy();
      this.collectionInterval = null;
    }
    this.isRunning = false;
    logger.info('Analytics collector stopped');
  }

  async collectAllAnalytics() {
    try {
      logger.info('Starting comprehensive analytics collection');
      
      const startTime = Date.now();
      
      // Collect platform analytics
      await this.collectPlatformAnalytics();
      
      // Collect content performance
      await this.collectContentAnalytics();
      
      // Update campaign metrics
      await this.updateCampaignAnalytics();
      
      // Calculate performance trends
      await this.calculateTrends();
      
      const duration = Date.now() - startTime;
      this.lastCollectionTime = new Date();
      
      logger.info(`Analytics collection completed in ${duration}ms`);
      
      // Emit real-time update
      if (global.io) {
        global.io.emit('analyticsUpdated', {
          timestamp: this.lastCollectionTime,
          duration
        });
      }

    } catch (error) {
      logger.error('Analytics collection failed:', error);
    }
  }

  async collectPlatformAnalytics() {
    try {
      const platforms = await Platform.find({ 
        isActive: true,
        'connectionStatus.isConnected': true 
      });

      for (const platform of platforms) {
        try {
          await this.collectSinglePlatformAnalytics(platform);
        } catch (platformError) {
          logger.warn(`Failed to collect analytics for ${platform.name}:`, platformError.message);
        }
      }

    } catch (error) {
      logger.error('Platform analytics collection failed:', error);
    }
  }

  async collectSinglePlatformAnalytics(platform) {
    try {
      const client = socialMediaClients.getClient(platform.name);
      
      // Get overall platform analytics
      const analytics = await client.getAnalytics(platform.credentials, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        endDate: new Date()
      });

      // Update platform analytics
      platform.analytics = {
        ...platform.analytics,
        totalPosts: analytics.totalPosts || platform.analytics.totalPosts || 0,
        totalEngagement: analytics.totalEngagement || 0,
        averageEngagement: analytics.averageEngagement || 0,
        followers: analytics.followers || analytics.subscribers || 0,
        following: analytics.following || 0,
        reach: analytics.reach || analytics.totalViews || 0,
        impressions: analytics.impressions || analytics.totalViews || 0,
        clickThroughRate: analytics.clickThroughRate || 0,
        engagementRate: analytics.engagementRate || 0,
        lastAnalyticsUpdate: new Date()
      };

      // Store historical data point
      if (!platform.analytics.historicalData) {
        platform.analytics.historicalData = [];
      }

      platform.analytics.historicalData.push({
        date: new Date(),
        engagement: analytics.totalEngagement || 0,
        followers: analytics.followers || analytics.subscribers || 0,
        reach: analytics.reach || analytics.totalViews || 0,
        posts: analytics.totalPosts || 0
      });

      // Keep only last 90 days of historical data
      platform.analytics.historicalData = platform.analytics.historicalData
        .filter(data => data.date > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
        .slice(-90);

      await platform.save();

      logger.info(`Updated analytics for ${platform.name}: ${analytics.totalEngagement} engagement`);

    } catch (error) {
      logger.error(`Platform analytics collection failed for ${platform.name}:`, error.message);
      
      // Update connection status if API error
      if (error.message.includes('unauthorized') || error.message.includes('invalid token')) {
        platform.connectionStatus.isConnected = false;
        platform.connectionStatus.lastError = 'Authentication expired';
        await platform.save();
      }
    }
  }

  async collectContentAnalytics() {
    try {
      // Get published content from last 7 days
      const recentContent = await Content.find({
        status: 'published',
        'platforms.postedAt': {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      });

      for (const content of recentContent) {
        await this.updateContentEngagement(content);
      }

    } catch (error) {
      logger.error('Content analytics collection failed:', error);
    }
  }

  async updateContentEngagement(content) {
    try {
      let totalEngagement = 0;
      let totalReach = 0;
      let hasUpdates = false;

      for (const platformData of content.platforms) {
        if (!platformData.posted || !platformData.postId) continue;

        try {
          const platform = await Platform.findOne({ name: platformData.platform });
          if (!platform || !platform.connectionStatus.isConnected) continue;

          const client = socialMediaClients.getClient(platformData.platform);
          
          // Get specific post metrics (platform-specific implementation needed)
          const postMetrics = await this.getPostMetrics(client, platform.credentials, platformData);
          
          if (postMetrics) {
            // Update engagement data
            const oldEngagement = platformData.engagement || {};
            platformData.engagement = {
              ...oldEngagement,
              ...postMetrics,
              lastUpdated: new Date()
            };

            totalEngagement += (postMetrics.likes || 0) + (postMetrics.shares || 0) + (postMetrics.comments || 0);
            totalReach += postMetrics.reach || postMetrics.views || 0;
            hasUpdates = true;
          }

        } catch (platformError) {
          logger.warn(`Failed to get metrics for content ${content._id} on ${platformData.platform}:`, platformError.message);
        }
      }

      if (hasUpdates) {
        // Update content analytics
        content.analytics = {
          ...content.analytics,
          totalEngagement,
          totalReach,
          lastUpdated: new Date()
        };

        await content.save();
        logger.debug(`Updated engagement for content ${content._id}: ${totalEngagement} total engagement`);
      }

    } catch (error) {
      logger.error(`Failed to update content engagement for ${content._id}:`, error.message);
    }
  }

  async getPostMetrics(client, credentials, platformData) {
    // This would be implemented per platform
    // For now, return mock data or try platform-specific method
    try {
      if (client.getPostMetrics) {
        return await client.getPostMetrics(credentials, platformData.postId);
      }
      
      // Fallback to general analytics if specific post metrics not available
      return null;

    } catch (error) {
      logger.warn(`Failed to get post metrics: ${error.message}`);
      return null;
    }
  }

  async collectRecentEngagement() {
    try {
      // Quick engagement update for posts from last 24 hours
      const recentContent = await Content.find({
        status: 'published',
        'platforms.postedAt': {
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }).limit(20); // Process most recent 20 posts

      for (const content of recentContent) {
        await this.updateContentEngagement(content);
      }

    } catch (error) {
      logger.error('Recent engagement collection failed:', error);
    }
  }

  async updateCampaignAnalytics() {
    try {
      const activeCampaigns = await Campaign.find({
        status: { $in: ['active', 'scheduled'] }
      }).populate('content.contentId', 'analytics platforms status');

      for (const campaign of activeCampaigns) {
        await this.calculateCampaignMetrics(campaign);
      }

    } catch (error) {
      logger.error('Campaign analytics update failed:', error);
    }
  }

  async calculateCampaignMetrics(campaign) {
    try {
      let totalImpressions = 0;
      let totalEngagement = 0;
      let totalClicks = 0;
      let publishedContent = 0;

      for (const contentItem of campaign.content) {
        if (contentItem.contentId && contentItem.contentId.status === 'published') {
          publishedContent++;
          
          const analytics = contentItem.contentId.analytics || {};
          totalEngagement += analytics.totalEngagement || 0;
          totalImpressions += analytics.totalReach || 0;
          
          // Sum clicks from all platforms
          if (contentItem.contentId.platforms) {
            for (const platform of contentItem.contentId.platforms) {
              totalClicks += platform.engagement?.clicks || 0;
            }
          }
        }
      }

      // Calculate rates
      const engagementRate = totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;
      const clickThroughRate = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      
      // Update campaign analytics
      campaign.analytics = {
        ...campaign.analytics,
        impressions: totalImpressions,
        engagement: totalEngagement,
        clicks: totalClicks,
        engagementRate,
        clickThroughRate,
        contentPublished: publishedContent,
        lastUpdated: new Date()
      };

      // Calculate goal progress
      if (campaign.goals) {
        campaign.analytics.goalProgress = {
          impressions: campaign.goals.impressions > 0 ? 
            (totalImpressions / campaign.goals.impressions) * 100 : 0,
          engagement: campaign.goals.engagement > 0 ? 
            (totalEngagement / campaign.goals.engagement) * 100 : 0,
          clicks: campaign.goals.clicks > 0 ? 
            (totalClicks / campaign.goals.clicks) * 100 : 0
        };
      }

      await campaign.save();
      
      logger.info(`Updated campaign analytics for ${campaign.name}: ${totalEngagement} engagement, ${engagementRate.toFixed(2)}% rate`);

    } catch (error) {
      logger.error(`Failed to calculate campaign metrics for ${campaign._id}:`, error.message);
    }
  }

  async calculateTrends() {
    try {
      // Calculate platform performance trends
      const platforms = await Platform.find({ isActive: true });
      
      for (const platform of platforms) {
        if (platform.analytics.historicalData && platform.analytics.historicalData.length >= 2) {
          const recent = platform.analytics.historicalData.slice(-7); // Last 7 data points
          const older = platform.analytics.historicalData.slice(-14, -7); // Previous 7 data points
          
          if (recent.length > 0 && older.length > 0) {
            const recentAvgEngagement = recent.reduce((sum, data) => sum + data.engagement, 0) / recent.length;
            const olderAvgEngagement = older.reduce((sum, data) => sum + data.engagement, 0) / older.length;
            
            const engagementTrend = olderAvgEngagement > 0 ? 
              ((recentAvgEngagement - olderAvgEngagement) / olderAvgEngagement) * 100 : 0;

            const recentAvgFollowers = recent.reduce((sum, data) => sum + data.followers, 0) / recent.length;
            const olderAvgFollowers = older.reduce((sum, data) => sum + data.followers, 0) / older.length;
            
            const followersTrend = olderAvgFollowers > 0 ? 
              ((recentAvgFollowers - olderAvgFollowers) / olderAvgFollowers) * 100 : 0;

            platform.analytics.trends = {
              engagement: engagementTrend,
              followers: followersTrend,
              lastCalculated: new Date()
            };

            await platform.save();
          }
        }
      }

    } catch (error) {
      logger.error('Trend calculation failed:', error);
    }
  }

  async collectDailyAnalytics() {
    try {
      logger.info('Starting daily analytics collection');
      
      // Comprehensive analytics collection
      await this.collectAllAnalytics();
      
      // Generate daily report data
      await this.generateDailyReport();
      
      // Cleanup old analytics data
      await this.cleanupOldAnalytics();

    } catch (error) {
      logger.error('Daily analytics collection failed:', error);
    }
  }

  async generateDailyReport() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date(yesterday);
      today.setDate(today.getDate() + 1);

      // Content published yesterday
      const yesterdayContent = await Content.find({
        status: 'published',
        'platforms.postedAt': {
          $gte: yesterday,
          $lt: today
        }
      });

      // Calculate daily metrics
      let totalEngagement = 0;
      let totalReach = 0;
      let postsPublished = 0;
      const platformBreakdown = {};

      yesterdayContent.forEach(content => {
        content.platforms.forEach(platform => {
          if (platform.posted && platform.postedAt >= yesterday && platform.postedAt < today) {
            postsPublished++;
            
            const engagement = (platform.engagement?.likes || 0) + 
                             (platform.engagement?.shares || 0) + 
                             (platform.engagement?.comments || 0);
            
            totalEngagement += engagement;
            totalReach += platform.engagement?.reach || platform.engagement?.views || 0;
            
            if (!platformBreakdown[platform.platform]) {
              platformBreakdown[platform.platform] = {
                posts: 0,
                engagement: 0,
                reach: 0
              };
            }
            
            platformBreakdown[platform.platform].posts++;
            platformBreakdown[platform.platform].engagement += engagement;
            platformBreakdown[platform.platform].reach += platform.engagement?.reach || platform.engagement?.views || 0;
          }
        });
      });

      const dailyReport = {
        date: yesterday,
        metrics: {
          postsPublished,
          totalEngagement,
          totalReach,
          averageEngagement: postsPublished > 0 ? totalEngagement / postsPublished : 0,
          engagementRate: totalReach > 0 ? (totalEngagement / totalReach) * 100 : 0
        },
        platformBreakdown,
        generated: new Date()
      };

      logger.info('Daily report generated:', {
        date: yesterday.toDateString(),
        posts: postsPublished,
        engagement: totalEngagement,
        reach: totalReach
      });

      // Emit daily report
      if (global.io) {
        global.io.emit('dailyReport', dailyReport);
      }

      return dailyReport;

    } catch (error) {
      logger.error('Daily report generation failed:', error);
    }
  }

  async analyzeWeeklyTrends() {
    try {
      logger.info('Analyzing weekly trends');
      
      // Compare this week vs last week performance
      const thisWeekStart = new Date();
      thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay()); // Start of this week
      thisWeekStart.setHours(0, 0, 0, 0);
      
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      
      const lastWeekEnd = new Date(thisWeekStart);

      // Get content from both weeks
      const [thisWeekContent, lastWeekContent] = await Promise.all([
        Content.find({
          status: 'published',
          'platforms.postedAt': { $gte: thisWeekStart }
        }),
        Content.find({
          status: 'published',
          'platforms.postedAt': { 
            $gte: lastWeekStart,
            $lt: lastWeekEnd
          }
        })
      ]);

      const thisWeekMetrics = this.calculateWeekMetrics(thisWeekContent);
      const lastWeekMetrics = this.calculateWeekMetrics(lastWeekContent);

      // Calculate trends
      const trends = {
        posts: this.calculateTrend(lastWeekMetrics.posts, thisWeekMetrics.posts),
        engagement: this.calculateTrend(lastWeekMetrics.engagement, thisWeekMetrics.engagement),
        reach: this.calculateTrend(lastWeekMetrics.reach, thisWeekMetrics.reach),
        engagementRate: this.calculateTrend(lastWeekMetrics.engagementRate, thisWeekMetrics.engagementRate)
      };

      logger.info('Weekly trends calculated:', trends);

      // Emit weekly trends
      if (global.io) {
        global.io.emit('weeklyTrends', {
          thisWeek: thisWeekMetrics,
          lastWeek: lastWeekMetrics,
          trends,
          period: {
            thisWeekStart,
            lastWeekStart,
            lastWeekEnd
          }
        });
      }

    } catch (error) {
      logger.error('Weekly trend analysis failed:', error);
    }
  }

  calculateWeekMetrics(content) {
    let posts = 0;
    let engagement = 0;
    let reach = 0;

    content.forEach(item => {
      item.platforms.forEach(platform => {
        if (platform.posted) {
          posts++;
          
          const platformEngagement = (platform.engagement?.likes || 0) + 
                                   (platform.engagement?.shares || 0) + 
                                   (platform.engagement?.comments || 0);
          
          engagement += platformEngagement;
          reach += platform.engagement?.reach || platform.engagement?.views || 0;
        }
      });
    });

    return {
      posts,
      engagement,
      reach,
      engagementRate: reach > 0 ? (engagement / reach) * 100 : 0
    };
  }

  calculateTrend(oldValue, newValue) {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue) * 100;
  }

  async cleanupOldAnalytics() {
    try {
      // Remove analytics data older than 1 year
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      // Cleanup platform historical data
      const platforms = await Platform.find({ isActive: true });
      
      for (const platform of platforms) {
        if (platform.analytics.historicalData) {
          const oldLength = platform.analytics.historicalData.length;
          platform.analytics.historicalData = platform.analytics.historicalData
            .filter(data => data.date > oneYearAgo);
          
          if (oldLength !== platform.analytics.historicalData.length) {
            await platform.save();
            logger.info(`Cleaned up ${oldLength - platform.analytics.historicalData.length} old analytics records for ${platform.name}`);
          }
        }
      }

    } catch (error) {
      logger.error('Analytics cleanup failed:', error);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCollectionTime: this.lastCollectionTime,
      nextCollection: this.collectionInterval ? 'Every 2 hours' : 'Not scheduled'
    };
  }

  async forceCollection() {
    logger.info('Forcing analytics collection');
    await this.collectAllAnalytics();
  }
}

module.exports = new AnalyticsCollector();