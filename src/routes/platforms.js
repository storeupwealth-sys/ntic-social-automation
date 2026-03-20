const express = require('express');
const { body, validationResult } = require('express-validator');
const Platform = require('../models/Platform');
const logger = require('../utils/logger');
const socialMediaClients = require('../services/socialMediaClients');

const router = express.Router();

// GET /api/platforms - List all platforms
router.get('/', async (req, res) => {
  try {
    const platforms = await Platform.find().select('-credentials.accessToken -credentials.refreshToken -credentials.clientSecret');
    res.json(platforms);
  } catch (error) {
    logger.error('Error fetching platforms:', error);
    res.status(500).json({ error: 'Failed to fetch platforms' });
  }
});

// GET /api/platforms/:name - Get specific platform
router.get('/:name', async (req, res) => {
  try {
    const platform = await Platform.findOne({ name: req.params.name })
      .select('-credentials.accessToken -credentials.refreshToken -credentials.clientSecret');
    
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    res.json(platform);
  } catch (error) {
    logger.error('Error fetching platform:', error);
    res.status(500).json({ error: 'Failed to fetch platform' });
  }
});

// POST /api/platforms/:name/connect - Connect platform account
router.post('/:name/connect', [
  body('accessToken').optional().isString(),
  body('refreshToken').optional().isString(),
  body('clientId').optional().isString(),
  body('clientSecret').optional().isString(),
  body('username').optional().isString(),
  body('profileId').optional().isString()
], async (req, res) => {
  try {
    if (!req.user.hasPermission('canManagePlatforms')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const platformName = req.params.name;
    const validPlatforms = ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'upwork', 'fiverr'];
    
    if (!validPlatforms.includes(platformName)) {
      return res.status(400).json({ error: 'Invalid platform name' });
    }

    let platform = await Platform.findOne({ name: platformName });
    if (!platform) {
      platform = new Platform({
        name: platformName,
        displayName: capitalizeFirst(platformName)
      });
    }

    // Update credentials
    platform.credentials = {
      ...platform.credentials,
      ...req.body,
      tokenExpiry: req.body.tokenExpiry ? new Date(req.body.tokenExpiry) : null
    };

    // Test connection
    try {
      const client = socialMediaClients.getClient(platformName);
      await client.testConnection(platform.credentials);
      
      platform.connectionStatus.isConnected = true;
      platform.connectionStatus.lastChecked = new Date();
      platform.connectionStatus.lastError = null;
      
      logger.info(`Platform ${platformName} connected successfully by user ${req.user.username}`);
    } catch (connectionError) {
      platform.connectionStatus.isConnected = false;
      platform.connectionStatus.lastError = connectionError.message;
      logger.error(`Platform ${platformName} connection failed:`, connectionError);
      
      return res.status(400).json({ 
        error: 'Failed to connect platform',
        details: connectionError.message
      });
    }

    await platform.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('platformConnected', {
        platform: platformName,
        isConnected: true
      });
    }

    res.json({ 
      message: `${platformName} connected successfully`,
      platform: {
        ...platform.toObject(),
        credentials: undefined // Don't send credentials back
      }
    });

  } catch (error) {
    logger.error('Error connecting platform:', error);
    res.status(500).json({ error: 'Failed to connect platform' });
  }
});

// POST /api/platforms/:name/disconnect - Disconnect platform
router.post('/:name/disconnect', async (req, res) => {
  try {
    if (!req.user.hasPermission('canManagePlatforms')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const platform = await Platform.findOne({ name: req.params.name });
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Clear credentials and connection status
    platform.credentials = {};
    platform.connectionStatus.isConnected = false;
    platform.connectionStatus.lastChecked = new Date();
    platform.connectionStatus.lastError = 'Manually disconnected';

    await platform.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('platformDisconnected', {
        platform: req.params.name,
        isConnected: false
      });
    }

    logger.info(`Platform ${req.params.name} disconnected by user ${req.user.username}`);

    res.json({ message: `${req.params.name} disconnected successfully` });

  } catch (error) {
    logger.error('Error disconnecting platform:', error);
    res.status(500).json({ error: 'Failed to disconnect platform' });
  }
});

// PUT /api/platforms/:name/settings - Update platform settings
router.put('/:name/settings', [
  body('autoPost').optional().isBoolean(),
  body('requireApproval').optional().isBoolean(),
  body('maxPostsPerDay').optional().isInt({ min: 1, max: 50 }),
  body('maxPostsPerHour').optional().isInt({ min: 1, max: 10 })
], async (req, res) => {
  try {
    if (!req.user.hasPermission('canManagePlatforms')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const platform = await Platform.findOne({ name: req.params.name });
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Update settings
    const allowedSettings = [
      'autoPost', 'requireApproval', 'maxPostsPerDay', 'maxPostsPerHour',
      'hashtagStrategy', 'contentFilters', 'optimalTimes'
    ];

    allowedSettings.forEach(setting => {
      if (req.body[setting] !== undefined) {
        platform.settings[setting] = req.body[setting];
      }
    });

    await platform.save();

    logger.info(`Platform ${req.params.name} settings updated by user ${req.user.username}`);

    res.json({
      message: 'Settings updated successfully',
      settings: platform.settings
    });

  } catch (error) {
    logger.error('Error updating platform settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /api/platforms/:name/analytics - Get platform analytics
router.get('/:name/analytics', async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    const platform = await Platform.findOne({ name: req.params.name });
    
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Get analytics data from social media client
    let analyticsData = {
      totalPosts: platform.analytics.totalPosts,
      totalEngagement: platform.analytics.totalEngagement,
      averageEngagement: platform.analytics.averageEngagement,
      followerCount: 0,
      reachGrowth: 0,
      engagementRate: 0
    };

    try {
      if (platform.connectionStatus.isConnected) {
        const client = socialMediaClients.getClient(req.params.name);
        const platformAnalytics = await client.getAnalytics(platform.credentials, {
          startDate,
          endDate
        });
        analyticsData = { ...analyticsData, ...platformAnalytics };
      }
    } catch (analyticsError) {
      logger.warn(`Failed to fetch analytics for ${req.params.name}:`, analyticsError);
    }

    res.json({
      platform: req.params.name,
      timeRange,
      data: analyticsData,
      lastUpdated: platform.analytics.lastAnalyticsUpdate
    });

  } catch (error) {
    logger.error('Error fetching platform analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// POST /api/platforms/:name/test-connection - Test platform connection
router.post('/:name/test-connection', async (req, res) => {
  try {
    const platform = await Platform.findOne({ name: req.params.name });
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    if (!platform.connectionStatus.isConnected) {
      return res.status(400).json({ error: 'Platform is not connected' });
    }

    // Test connection
    try {
      const client = socialMediaClients.getClient(req.params.name);
      const result = await client.testConnection(platform.credentials);
      
      platform.connectionStatus.lastChecked = new Date();
      platform.connectionStatus.lastError = null;
      
      if (result.rateLimitRemaining !== undefined) {
        platform.connectionStatus.apiCallsRemaining = result.rateLimitRemaining;
      }
      
      if (result.rateLimitReset) {
        platform.connectionStatus.rateLimitReset = new Date(result.rateLimitReset);
      }
      
      await platform.save();

      res.json({
        status: 'connected',
        message: 'Connection test successful',
        details: result
      });

    } catch (testError) {
      platform.connectionStatus.lastError = testError.message;
      platform.connectionStatus.lastChecked = new Date();
      await platform.save();

      res.status(400).json({
        status: 'failed',
        message: 'Connection test failed',
        error: testError.message
      });
    }

  } catch (error) {
    logger.error('Error testing platform connection:', error);
    res.status(500).json({ error: 'Failed to test connection' });
  }
});

// GET /api/platforms/:name/optimal-times - Get optimal posting times
router.get('/:name/optimal-times', async (req, res) => {
  try {
    const platform = await Platform.findOne({ name: req.params.name });
    if (!platform) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    let optimalTimes = platform.settings.optimalTimes || [];

    // If no custom times set, use platform defaults
    if (optimalTimes.length === 0) {
      optimalTimes = getDefaultOptimalTimes(req.params.name);
    }

    res.json({
      platform: req.params.name,
      optimalTimes,
      timezone: req.user.profile.timezone || 'America/New_York'
    });

  } catch (error) {
    logger.error('Error fetching optimal times:', error);
    res.status(500).json({ error: 'Failed to fetch optimal times' });
  }
});

// Helper functions
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getDefaultOptimalTimes(platform) {
  const defaults = {
    linkedin: [
      { day: 'monday', hours: [8, 12, 17] },
      { day: 'tuesday', hours: [8, 12, 17] },
      { day: 'wednesday', hours: [8, 12, 17] },
      { day: 'thursday', hours: [8, 12, 17] },
      { day: 'friday', hours: [8, 12] }
    ],
    twitter: [
      { day: 'monday', hours: [9, 12, 15, 18] },
      { day: 'tuesday', hours: [9, 12, 15, 18] },
      { day: 'wednesday', hours: [9, 12, 15, 18] },
      { day: 'thursday', hours: [9, 12, 15, 18] },
      { day: 'friday', hours: [9, 12, 15] },
      { day: 'saturday', hours: [10, 14] },
      { day: 'sunday', hours: [10, 14] }
    ],
    facebook: [
      { day: 'tuesday', hours: [9, 13, 15] },
      { day: 'wednesday', hours: [9, 13, 15] },
      { day: 'thursday', hours: [9, 13, 15] },
      { day: 'friday', hours: [9, 13] },
      { day: 'saturday', hours: [12, 15] }
    ],
    instagram: [
      { day: 'monday', hours: [11, 13, 17] },
      { day: 'tuesday', hours: [11, 13, 17] },
      { day: 'wednesday', hours: [11, 13, 17] },
      { day: 'thursday', hours: [11, 13, 17] },
      { day: 'friday', hours: [11, 13, 17] },
      { day: 'saturday', hours: [10, 14, 16] },
      { day: 'sunday', hours: [10, 14, 16] }
    ]
  };

  return defaults[platform] || [
    { day: 'monday', hours: [9, 12, 15] },
    { day: 'tuesday', hours: [9, 12, 15] },
    { day: 'wednesday', hours: [9, 12, 15] },
    { day: 'thursday', hours: [9, 12, 15] },
    { day: 'friday', hours: [9, 12, 15] }
  ];
}

module.exports = router;