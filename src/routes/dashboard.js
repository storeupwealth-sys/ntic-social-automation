const express = require('express');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const User = require('../models/User');
const scheduleManager = require('../services/scheduleManager');
const socialMediaClients = require('../services/socialMediaClients');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/dashboard/stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Content statistics
    const [
      totalContent,
      publishedToday,
      scheduledContent,
      draftContent,
      failedContent,
      weeklyGrowth
    ] = await Promise.all([
      Content.countDocuments(),
      Content.countDocuments({
        status: 'published',
        'platforms.postedAt': {
          $gte: new Date(today.getFullYear(), today.getMonth(), today.getDate())
        }
      }),
      Content.countDocuments({ status: 'scheduled' }),
      Content.countDocuments({ status: 'draft' }),
      Content.countDocuments({ status: 'failed' }),
      Content.countDocuments({
        createdAt: { $gte: lastWeek }
      })
    ]);

    // Platform statistics
    const platforms = await Platform.find({ isActive: true });
    const connectedPlatforms = platforms.filter(p => p.connectionStatus.isConnected);
    
    // User activity
    const activeUsers = await User.countDocuments({
      isActive: true,
      'activity.lastLogin': { $gte: lastWeek }
    });

    // Recent activity
    const recentContent = await Content.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'username')
      .select('title status createdAt platforms');

    // Engagement summary
    const engagementData = await Content.aggregate([
      {
        $match: {
          status: 'published',
          'platforms.postedAt': { $gte: lastWeek }
        }
      },
      {
        $unwind: '$platforms'
      },
      {
        $group: {
          _id: null,
          totalEngagement: {
            $sum: {
              $add: [
                { $ifNull: ['$platforms.engagement.likes', 0] },
                { $ifNull: ['$platforms.engagement.shares', 0] },
                { $ifNull: ['$platforms.engagement.comments', 0] }
              ]
            }
          },
          totalViews: { $sum: { $ifNull: ['$platforms.engagement.views', 0] } },
          totalPosts: { $sum: 1 }
        }
      }
    ]);

    const engagement = engagementData[0] || { 
      totalEngagement: 0, 
      totalViews: 0, 
      totalPosts: 0 
    };

    res.json({
      overview: {
        totalContent,
        publishedToday,
        scheduledContent,
        draftContent,
        failedContent,
        weeklyGrowth
      },
      platforms: {
        total: platforms.length,
        connected: connectedPlatforms.length,
        disconnected: platforms.length - connectedPlatforms.length,
        list: platforms.map(p => ({
          name: p.name,
          displayName: p.displayName,
          isConnected: p.connectionStatus.isConnected,
          lastChecked: p.connectionStatus.lastChecked,
          totalPosts: p.analytics.totalPosts || 0
        }))
      },
      engagement: {
        ...engagement,
        engagementRate: engagement.totalViews > 0 ? 
          (engagement.totalEngagement / engagement.totalViews) * 100 : 0
      },
      users: {
        activeUsers,
        totalUsers: await User.countDocuments({ isActive: true })
      },
      recentActivity: recentContent,
      systemStatus: {
        scheduler: scheduleManager.getStatus(),
        timestamp: new Date()
      }
    });

  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// GET /api/dashboard/activity - Recent activity feed
router.get('/activity', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Get recent content activity
    const recentContent = await Content.find()
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .populate('createdBy', 'username')
      .populate('approvedBy', 'username')
      .select('title status createdAt updatedAt platforms');

    // Format activity feed
    const activities = [];

    recentContent.forEach(content => {
      // Content creation
      activities.push({
        id: `content-created-${content._id}`,
        type: 'content_created',
        timestamp: content.createdAt,
        user: content.createdBy?.username || 'Unknown',
        message: `Created content: ${content.title}`,
        details: {
          contentId: content._id,
          platforms: content.platforms.map(p => p.platform)
        }
      });

      // Publishing events
      content.platforms.forEach(platform => {
        if (platform.posted && platform.postedAt) {
          activities.push({
            id: `content-published-${content._id}-${platform.platform}`,
            type: 'content_published',
            timestamp: platform.postedAt,
            message: `Published "${content.title}" to ${platform.platform}`,
            details: {
              contentId: content._id,
              platform: platform.platform,
              postId: platform.postId
            }
          });
        }

        if (platform.error) {
          activities.push({
            id: `content-failed-${content._id}-${platform.platform}`,
            type: 'content_failed',
            timestamp: content.updatedAt,
            message: `Failed to publish "${content.title}" to ${platform.platform}`,
            details: {
              contentId: content._id,
              platform: platform.platform,
              error: platform.error
            }
          });
        }
      });

      // Approval events
      if (content.approvedBy && content.approvedAt) {
        activities.push({
          id: `content-approved-${content._id}`,
          type: 'content_approved',
          timestamp: content.approvedAt,
          user: content.approvedBy?.username || 'Unknown',
          message: `Approved content: ${content.title}`,
          details: {
            contentId: content._id
          }
        });
      }
    });

    // Sort by timestamp and limit
    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit));

    res.json({
      activities: sortedActivities,
      total: activities.length
    });

  } catch (error) {
    logger.error('Error fetching dashboard activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

// GET /api/dashboard/scheduled - Upcoming scheduled content
router.get('/scheduled', async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;

    const scheduledContent = await scheduleManager.getScheduledContent(timeRange);

    // Group by time slots
    const timeSlots = {};
    scheduledContent.forEach(content => {
      content.platforms.forEach(platform => {
        if (platform.scheduled && !platform.posted && platform.scheduledAt) {
          const timeSlot = new Date(platform.scheduledAt).toISOString().slice(0, 13) + ':00:00.000Z';
          
          if (!timeSlots[timeSlot]) {
            timeSlots[timeSlot] = {
              timestamp: timeSlot,
              count: 0,
              content: []
            };
          }
          
          timeSlots[timeSlot].count++;
          timeSlots[timeSlot].content.push({
            id: content._id,
            title: content.title,
            platform: platform.platform,
            scheduledAt: platform.scheduledAt
          });
        }
      });
    });

    // Convert to array and sort
    const slots = Object.values(timeSlots).sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    res.json({
      timeRange,
      totalScheduled: scheduledContent.length,
      upcomingSlots: slots,
      nextPost: slots.length > 0 ? slots[0] : null
    });

  } catch (error) {
    logger.error('Error fetching scheduled content:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled content' });
  }
});

// GET /api/dashboard/health - System health status
router.get('/health', async (req, res) => {
  try {
    // Check platform connections
    const platforms = await Platform.find({ isActive: true });
    const platformHealth = [];

    for (const platform of platforms) {
      const health = {
        name: platform.name,
        status: platform.connectionStatus.isConnected ? 'connected' : 'disconnected',
        lastChecked: platform.connectionStatus.lastChecked,
        lastError: platform.connectionStatus.lastError,
        rateLimitStatus: 'ok'
      };

      // Check rate limits
      if (platform.connectionStatus.rateLimitReset && 
          platform.connectionStatus.rateLimitReset > new Date()) {
        health.rateLimitStatus = 'limited';
        health.rateLimitReset = platform.connectionStatus.rateLimitReset;
      }

      platformHealth.push(health);
    }

    // Check database connectivity
    const dbHealth = {
      status: 'connected', // Simplified - would actually test connection
      responseTime: Math.floor(Math.random() * 10) + 5 // Mock response time
    };

    // Check scheduler status
    const schedulerHealth = scheduleManager.getStatus();

    // Check system resources (simplified)
    const systemHealth = {
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      cpu: {
        load: Math.random() * 100 // Mock CPU load
      }
    };

    // Overall health score
    const connectedPlatforms = platformHealth.filter(p => p.status === 'connected').length;
    const totalPlatforms = platformHealth.length;
    const platformScore = totalPlatforms > 0 ? (connectedPlatforms / totalPlatforms) * 100 : 100;
    
    const overallHealth = {
      score: Math.round(platformScore),
      status: platformScore >= 80 ? 'healthy' : platformScore >= 60 ? 'warning' : 'critical'
    };

    res.json({
      overall: overallHealth,
      platforms: platformHealth,
      database: dbHealth,
      scheduler: schedulerHealth,
      system: systemHealth,
      lastUpdated: new Date()
    });

  } catch (error) {
    logger.error('Error checking system health:', error);
    res.status(500).json({ 
      error: 'Failed to check system health',
      overall: { score: 0, status: 'critical' }
    });
  }
});

// POST /api/dashboard/test-platform/:name - Test platform connection
router.post('/test-platform/:name', async (req, res) => {
  try {
    if (!req.user.hasPermission('canManagePlatforms')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const platformName = req.params.name;
    const platform = await Platform.findOne({ name: platformName });
    
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    const client = socialMediaClients.getClient(platformName);
    
    try {
      const result = await client.testConnection(platform.credentials);
      
      platform.connectionStatus.isConnected = true;
      platform.connectionStatus.lastChecked = new Date();
      platform.connectionStatus.lastError = null;
      
      await platform.save();

      // Emit real-time update
      if (global.io) {
        global.io.emit('platformStatusUpdate', {
          platform: platformName,
          status: 'connected',
          timestamp: new Date()
        });
      }

      res.json({
        platform: platformName,
        status: 'connected',
        result
      });

    } catch (testError) {
      platform.connectionStatus.isConnected = false;
      platform.connectionStatus.lastError = testError.message;
      platform.connectionStatus.lastChecked = new Date();
      
      await platform.save();

      res.status(400).json({
        platform: platformName,
        status: 'failed',
        error: testError.message
      });
    }

  } catch (error) {
    logger.error('Error testing platform connection:', error);
    res.status(500).json({ error: 'Failed to test platform connection' });
  }
});

// GET /api/dashboard/quick-actions - Available quick actions
router.get('/quick-actions', async (req, res) => {
  try {
    const actions = [];

    // Content actions
    if (req.user.hasPermission('canCreateContent')) {
      actions.push({
        id: 'create-content',
        label: 'Create Content',
        icon: 'plus',
        url: '/content/create',
        category: 'content'
      });
    }

    if (req.user.hasPermission('canApproveContent')) {
      const pendingApproval = await Content.countDocuments({ status: 'draft' });
      actions.push({
        id: 'approve-content',
        label: `Approve Content (${pendingApproval})`,
        icon: 'check',
        url: '/content/pending',
        category: 'content',
        badge: pendingApproval > 0 ? pendingApproval : null
      });
    }

    // Platform actions
    if (req.user.hasPermission('canManagePlatforms')) {
      const disconnectedPlatforms = await Platform.countDocuments({
        isActive: true,
        'connectionStatus.isConnected': false
      });

      if (disconnectedPlatforms > 0) {
        actions.push({
          id: 'reconnect-platforms',
          label: `Reconnect Platforms (${disconnectedPlatforms})`,
          icon: 'link',
          url: '/platforms',
          category: 'platforms',
          badge: disconnectedPlatforms,
          priority: 'high'
        });
      }

      actions.push({
        id: 'manage-platforms',
        label: 'Manage Platforms',
        icon: 'settings',
        url: '/platforms',
        category: 'platforms'
      });
    }

    // Analytics actions
    if (req.user.hasPermission('canViewAnalytics')) {
      actions.push({
        id: 'view-analytics',
        label: 'View Analytics',
        icon: 'chart',
        url: '/analytics',
        category: 'analytics'
      });
    }

    // Failed content retry
    const failedContent = await Content.countDocuments({ status: 'failed' });
    if (failedContent > 0) {
      actions.push({
        id: 'retry-failed',
        label: `Retry Failed Posts (${failedContent})`,
        icon: 'refresh',
        url: '/content/failed',
        category: 'content',
        badge: failedContent,
        priority: 'medium'
      });
    }

    res.json({
      actions,
      categories: {
        content: actions.filter(a => a.category === 'content').length,
        platforms: actions.filter(a => a.category === 'platforms').length,
        analytics: actions.filter(a => a.category === 'analytics').length
      }
    });

  } catch (error) {
    logger.error('Error fetching quick actions:', error);
    res.status(500).json({ error: 'Failed to fetch quick actions' });
  }
});

// GET /api/dashboard/notifications - System notifications
router.get('/notifications', async (req, res) => {
  try {
    const notifications = [];

    // Check for failed posts in last 24 hours
    const failedPosts = await Content.countDocuments({
      status: 'failed',
      updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (failedPosts > 0) {
      notifications.push({
        id: 'failed-posts',
        type: 'error',
        title: 'Failed Posts',
        message: `${failedPosts} posts failed to publish in the last 24 hours`,
        action: '/content/failed',
        timestamp: new Date()
      });
    }

    // Check for disconnected platforms
    const disconnectedPlatforms = await Platform.find({
      isActive: true,
      'connectionStatus.isConnected': false
    });

    if (disconnectedPlatforms.length > 0) {
      notifications.push({
        id: 'disconnected-platforms',
        type: 'warning',
        title: 'Platform Connection Issues',
        message: `${disconnectedPlatforms.length} platforms are disconnected: ${disconnectedPlatforms.map(p => p.displayName || p.name).join(', ')}`,
        action: '/platforms',
        timestamp: new Date()
      });
    }

    // Check for pending approvals
    if (req.user.hasPermission('canApproveContent')) {
      const pendingApproval = await Content.countDocuments({ status: 'draft' });
      
      if (pendingApproval > 0) {
        notifications.push({
          id: 'pending-approval',
          type: 'info',
          title: 'Content Awaiting Approval',
          message: `${pendingApproval} pieces of content need approval`,
          action: '/content/pending',
          timestamp: new Date()
        });
      }
    }

    // Check for upcoming scheduled posts
    const upcomingPosts = await Content.countDocuments({
      status: 'scheduled',
      'platforms.scheduledAt': {
        $gte: new Date(),
        $lte: new Date(Date.now() + 60 * 60 * 1000) // Next hour
      }
    });

    if (upcomingPosts > 0) {
      notifications.push({
        id: 'upcoming-posts',
        type: 'success',
        title: 'Posts Scheduled',
        message: `${upcomingPosts} posts scheduled to publish in the next hour`,
        action: '/dashboard/scheduled',
        timestamp: new Date()
      });
    }

    res.json({
      notifications,
      unreadCount: notifications.length
    });

  } catch (error) {
    logger.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

module.exports = router;