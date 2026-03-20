const cron = require('node-cron');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const logger = require('../utils/logger');
const socialMediaClients = require('./socialMediaClients');

class ScheduleManager {
  constructor() {
    this.scheduledTasks = new Map();
    this.isInitialized = false;
  }

  initialize() {
    if (this.isInitialized) return;

    // Main scheduler - runs every minute to check for content to publish
    cron.schedule('* * * * *', async () => {
      await this.processScheduledContent();
    });

    // Hourly reset for rate limits
    cron.schedule('0 * * * *', async () => {
      await this.resetHourlyLimits();
    });

    // Daily analytics collection
    cron.schedule('0 6 * * *', async () => {
      await this.collectDailyAnalytics();
    });

    // Weekly platform health checks
    cron.schedule('0 9 * * 1', async () => {
      await this.performHealthChecks();
    });

    logger.info('Schedule Manager initialized');
    this.isInitialized = true;
  }

  async processScheduledContent() {
    try {
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      // Find content scheduled for the next 5 minutes
      const scheduledContent = await Content.find({
        status: 'scheduled',
        'platforms.scheduled': true,
        'platforms.posted': false,
        'platforms.scheduledAt': {
          $gte: now,
          $lte: fiveMinutesFromNow
        }
      }).populate('createdBy', 'username email');

      for (const content of scheduledContent) {
        await this.publishContent(content);
      }

    } catch (error) {
      logger.error('Error processing scheduled content:', error);
    }
  }

  async publishContent(content) {
    try {
      logger.info(`Publishing content: ${content._id} - ${content.title}`);

      let publishedCount = 0;
      let failedCount = 0;

      for (const platformData of content.platforms) {
        if (!platformData.scheduled || platformData.posted) {
          continue;
        }

        const now = new Date();
        if (platformData.scheduledAt > now) {
          continue; // Not yet time to publish
        }

        try {
          await this.publishToPlatform(content, platformData);
          publishedCount++;
        } catch (platformError) {
          logger.error(`Failed to publish to ${platformData.platform}:`, platformError);
          
          // Update platform data with error
          platformData.error = platformError.message;
          platformData.posted = false;
          failedCount++;
        }
      }

      // Update overall content status
      if (publishedCount > 0 && failedCount === 0) {
        content.status = 'published';
      } else if (failedCount > 0) {
        content.status = 'failed';
      }

      await content.save();

      // Emit real-time notification
      if (global.io) {
        global.io.emit('contentPublished', {
          contentId: content._id,
          title: content.title,
          published: publishedCount,
          failed: failedCount,
          status: content.status
        });
      }

      logger.info(`Content ${content._id} published: ${publishedCount} success, ${failedCount} failed`);

    } catch (error) {
      logger.error(`Error publishing content ${content._id}:`, error);
    }
  }

  async publishToPlatform(content, platformData) {
    const platformName = platformData.platform;

    // Get platform configuration
    const platform = await Platform.findOne({ name: platformName });
    if (!platform || !platform.isActive) {
      throw new Error(`Platform ${platformName} is not available`);
    }

    if (!platform.connectionStatus.isConnected) {
      throw new Error(`Platform ${platformName} is not connected`);
    }

    // Check rate limits
    const canPost = platform.canPostNow();
    if (!canPost.canPost) {
      throw new Error(`Rate limit exceeded: ${canPost.reason}`);
    }

    // Get social media client
    const client = socialMediaClients.getClient(platformName);

    // Prepare content for posting
    const postContent = {
      text: platformData.customContent || content.content,
      title: content.title,
      media: content.media,
      hashtags: platformData.hashtags || [],
      mentions: platformData.mentions || []
    };

    // Add platform-specific hashtags
    if (postContent.hashtags.length === 0 && content.tags) {
      postContent.hashtags = content.tags.map(tag => `#${tag}`);
    }

    // Post to platform
    const result = await client.post(platform.credentials, postContent);

    if (result.success) {
      // Update platform data
      platformData.posted = true;
      platformData.postedAt = new Date();
      platformData.postId = result.postId || result.videoId || result.pinId;
      platformData.error = null;

      // Update platform counters
      platform.incrementPostCount();
      await platform.save();

      logger.info(`Successfully posted to ${platformName}: ${result.postId || 'unknown ID'}`);

      return result;
    } else {
      throw new Error(result.error || 'Unknown posting error');
    }
  }

  async scheduleContent(contentId, scheduledTime) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Update platforms with scheduled time
      for (const platformData of content.platforms) {
        if (!platformData.scheduled && !platformData.posted) {
          platformData.scheduled = true;
          platformData.scheduledAt = scheduledTime;
        }
      }

      content.status = 'scheduled';
      await content.save();

      logger.info(`Content ${contentId} scheduled for ${scheduledTime}`);
      return { success: true };

    } catch (error) {
      logger.error('Error scheduling content:', error);
      throw error;
    }
  }

  async rescheduleContent(contentId, newScheduledTime) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Update scheduling for unposted platforms
      for (const platformData of content.platforms) {
        if (platformData.scheduled && !platformData.posted) {
          platformData.scheduledAt = newScheduledTime;
        }
      }

      await content.save();

      logger.info(`Content ${contentId} rescheduled to ${newScheduledTime}`);
      return { success: true };

    } catch (error) {
      logger.error('Error rescheduling content:', error);
      throw error;
    }
  }

  async cancelScheduledContent(contentId) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Cancel scheduling for unposted platforms
      for (const platformData of content.platforms) {
        if (platformData.scheduled && !platformData.posted) {
          platformData.scheduled = false;
          platformData.scheduledAt = null;
        }
      }

      // Check if any platforms are still scheduled
      const hasScheduled = content.platforms.some(p => p.scheduled);
      if (!hasScheduled) {
        content.status = 'draft';
      }

      await content.save();

      logger.info(`Scheduling cancelled for content ${contentId}`);
      return { success: true };

    } catch (error) {
      logger.error('Error cancelling scheduled content:', error);
      throw error;
    }
  }

  async resetHourlyLimits() {
    try {
      await Platform.updateMany(
        {},
        { $set: { 'limits.hourlyPosts': 0 } }
      );

      logger.info('Hourly rate limits reset');
    } catch (error) {
      logger.error('Error resetting hourly limits:', error);
    }
  }

  async collectDailyAnalytics() {
    try {
      const platforms = await Platform.find({ 
        isActive: true, 
        'connectionStatus.isConnected': true 
      });

      for (const platform of platforms) {
        try {
          const client = socialMediaClients.getClient(platform.name);
          const analytics = await client.getAnalytics(platform.credentials);

          // Update platform analytics
          platform.analytics = {
            ...platform.analytics,
            ...analytics,
            lastAnalyticsUpdate: new Date()
          };

          await platform.save();

          logger.info(`Analytics collected for ${platform.name}`);
        } catch (analyticsError) {
          logger.warn(`Failed to collect analytics for ${platform.name}:`, analyticsError.message);
        }
      }

      // Collect content analytics
      await this.updateContentAnalytics();

    } catch (error) {
      logger.error('Error collecting daily analytics:', error);
    }
  }

  async updateContentAnalytics() {
    try {
      // Get content published in the last 7 days
      const recentContent = await Content.find({
        status: 'published',
        'platforms.postedAt': {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      });

      for (const content of recentContent) {
        let totalEngagement = 0;
        let totalReach = 0;

        for (const platformData of content.platforms) {
          if (platformData.posted && platformData.postId) {
            try {
              const platform = await Platform.findOne({ name: platformData.platform });
              if (platform && platform.connectionStatus.isConnected) {
                const client = socialMediaClients.getClient(platformData.platform);
                
                // Get updated engagement metrics (implementation varies by platform)
                // This is a simplified approach - real implementation would fetch specific post metrics
                const engagement = platformData.engagement || {};
                totalEngagement += (engagement.likes || 0) + (engagement.shares || 0) + (engagement.comments || 0);
                totalReach += engagement.reach || engagement.views || 0;
              }
            } catch (platformError) {
              logger.warn(`Failed to update analytics for content ${content._id} on ${platformData.platform}`);
            }
          }
        }

        // Update content analytics
        content.analytics = {
          totalEngagement,
          totalReach,
          conversionRate: 0, // Would be calculated based on tracking
          revenue: 0 // Would be calculated based on attribution
        };

        await content.save();
      }

    } catch (error) {
      logger.error('Error updating content analytics:', error);
    }
  }

  async performHealthChecks() {
    try {
      const platforms = await Platform.find({ isActive: true });

      for (const platform of platforms) {
        if (platform.connectionStatus.isConnected) {
          try {
            const client = socialMediaClients.getClient(platform.name);
            const healthResult = await client.testConnection(platform.credentials);

            platform.connectionStatus.lastChecked = new Date();
            if (healthResult.connected) {
              platform.connectionStatus.lastError = null;
            }

            await platform.save();

            logger.info(`Health check passed for ${platform.name}`);
          } catch (healthError) {
            platform.connectionStatus.isConnected = false;
            platform.connectionStatus.lastError = healthError.message;
            platform.connectionStatus.lastChecked = new Date();
            
            await platform.save();

            logger.warn(`Health check failed for ${platform.name}: ${healthError.message}`);

            // Emit alert
            if (global.io) {
              global.io.emit('platformHealthAlert', {
                platform: platform.name,
                error: healthError.message,
                timestamp: new Date()
              });
            }
          }
        }
      }

    } catch (error) {
      logger.error('Error performing health checks:', error);
    }
  }

  async getScheduledContent(timeRange = '24h') {
    try {
      const now = new Date();
      let endTime;

      switch (timeRange) {
        case '1h':
          endTime = new Date(now.getTime() + 60 * 60 * 1000);
          break;
        case '12h':
          endTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);
          break;
        case '24h':
          endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case '7d':
          endTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      }

      const scheduledContent = await Content.find({
        status: 'scheduled',
        'platforms.scheduled': true,
        'platforms.posted': false,
        'platforms.scheduledAt': {
          $gte: now,
          $lte: endTime
        }
      })
      .populate('createdBy', 'username')
      .sort({ 'platforms.scheduledAt': 1 });

      return scheduledContent;

    } catch (error) {
      logger.error('Error getting scheduled content:', error);
      throw error;
    }
  }

  async retryFailedContent(contentId) {
    try {
      const content = await Content.findById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Reset failed platforms for retry
      for (const platformData of content.platforms) {
        if (platformData.error && !platformData.posted) {
          platformData.error = null;
          platformData.scheduledAt = new Date(); // Schedule for immediate posting
        }
      }

      content.status = 'scheduled';
      await content.save();

      logger.info(`Content ${contentId} scheduled for retry`);
      return { success: true };

    } catch (error) {
      logger.error('Error retrying failed content:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      isInitialized: this.isInitialized,
      scheduledTasksCount: this.scheduledTasks.size,
      nextProcessingTime: 'Every minute',
      healthChecksEnabled: true,
      analyticsEnabled: true
    };
  }
}

module.exports = new ScheduleManager();