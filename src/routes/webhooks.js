const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const logger = require('../utils/logger');
const contentProcessor = require('../services/contentProcessor');
const scheduleManager = require('../services/scheduleManager');

const router = express.Router();

// Webhook authentication middleware
const authenticateWebhook = (req, res, next) => {
  const signature = req.headers['x-ntic-signature'];
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  // Verify API key exists and is active
  User.findOne({ 'apiKeys.key': apiKey, 'apiKeys.isActive': true })
    .then(user => {
      if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Update last used timestamp
      const keyIndex = user.apiKeys.findIndex(k => k.key === apiKey);
      if (keyIndex !== -1) {
        user.apiKeys[keyIndex].lastUsed = new Date();
        user.save();
      }

      req.user = user;
      next();
    })
    .catch(error => {
      logger.error('Webhook authentication error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    });
};

// Validate webhook signature (optional but recommended)
const validateSignature = (req, res, next) => {
  const signature = req.headers['x-ntic-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (webhookSecret && signature) {
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (signature !== `sha256=${expectedSignature}`) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }
  
  next();
};

// POST /api/webhooks/content - Receive content from NTIC agents
router.post('/content', authenticateWebhook, validateSignature, [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Content must be 1-10000 characters'),
  body('platforms').isArray({ min: 1 }).withMessage('At least one platform must be specified'),
  body('source.agent').optional().isString(),
  body('source.workflow').optional().isString(),
  body('source.campaign').optional().isString(),
  body('contentType').optional().isIn(['text', 'image', 'video', 'article', 'thread']),
  body('category').optional().isIn(['ai-consulting', 'dp6', 'ai-course', 'general', 'promotional', 'educational']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('scheduledAt').optional().isISO8601(),
  body('autoApprove').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      title,
      content,
      contentType = 'text',
      platforms,
      tags = [],
      category = 'general',
      priority = 'medium',
      source = {},
      scheduledAt,
      autoApprove = false,
      mediaUrls = []
    } = req.body;

    // Validate platforms exist and are active
    const platformNames = platforms.map(p => typeof p === 'string' ? p : p.platform);
    const activePlatforms = await Platform.find({
      name: { $in: platformNames },
      isActive: true
    });

    if (activePlatforms.length !== platformNames.length) {
      const missingPlatforms = platformNames.filter(p => 
        !activePlatforms.find(ap => ap.name === p)
      );
      return res.status(400).json({ 
        error: 'Some platforms are not available',
        missingPlatforms
      });
    }

    // Process platform-specific content
    const platformData = platforms.map(platform => {
      if (typeof platform === 'string') {
        return { platform };
      }
      
      return {
        platform: platform.platform,
        customContent: platform.customContent,
        hashtags: platform.hashtags || [],
        mentions: platform.mentions || [],
        scheduled: !!scheduledAt,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null
      };
    });

    // Download and process media if URLs provided
    const media = [];
    if (mediaUrls.length > 0) {
      try {
        const processedMedia = await contentProcessor.downloadAndProcessMedia(mediaUrls);
        media.push(...processedMedia);
      } catch (mediaError) {
        logger.warn('Failed to process media URLs:', mediaError);
      }
    }

    // Create content document
    const newContent = new Content({
      title,
      content,
      contentType,
      platforms: platformData,
      media,
      tags,
      category,
      priority,
      source: {
        agent: source.agent || 'webhook',
        workflow: source.workflow,
        campaign: source.campaign
      },
      createdBy: req.user._id,
      status: autoApprove ? 'scheduled' : 'draft'
    });

    // Auto-approve if requested and user has permission
    if (autoApprove && req.user.hasPermission('canApproveContent')) {
      newContent.approvedBy = req.user._id;
      newContent.approvedAt = new Date();
    }

    await newContent.save();

    // If scheduled and approved, add to scheduler
    if (newContent.status === 'scheduled' && scheduledAt) {
      await scheduleManager.scheduleContent(newContent._id, new Date(scheduledAt));
    }

    // Emit real-time notification
    if (global.io) {
      global.io.emit('webhookContentReceived', {
        id: newContent._id,
        title: newContent.title,
        source: source.agent || 'webhook',
        status: newContent.status,
        platforms: platformNames
      });
    }

    logger.info(`Webhook content received: ${newContent._id} from ${source.agent || 'unknown'}`);

    res.status(201).json({
      success: true,
      contentId: newContent._id,
      status: newContent.status,
      message: autoApprove ? 'Content received and scheduled' : 'Content received and pending approval'
    });

  } catch (error) {
    logger.error('Webhook content processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process content',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/webhooks/campaign - Create or update campaign
router.post('/campaign', authenticateWebhook, validateSignature, [
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Campaign name must be 1-100 characters'),
  body('type').isIn(['content-series', 'product-launch', 'lead-generation', 'brand-awareness', 'engagement']),
  body('platforms').isArray({ min: 1 }).withMessage('At least one platform must be specified'),
  body('startDate').isISO8601().withMessage('Valid start date required'),
  body('endDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      type,
      platforms,
      startDate,
      endDate,
      content = [],
      targeting = {},
      goals = {},
      budget = {}
    } = req.body;

    // Check if campaign already exists
    let campaign = await Campaign.findOne({ name, 'team.owner': req.user._id });
    
    if (campaign) {
      // Update existing campaign
      campaign.description = description || campaign.description;
      campaign.type = type;
      campaign.platforms = platforms;
      campaign.schedule.startDate = new Date(startDate);
      if (endDate) campaign.schedule.endDate = new Date(endDate);
      campaign.targeting = { ...campaign.targeting, ...targeting };
      campaign.goals = { ...campaign.goals, ...goals };
      campaign.budget = { ...campaign.budget, ...budget };
    } else {
      // Create new campaign
      campaign = new Campaign({
        name,
        description,
        type,
        platforms,
        schedule: {
          startDate: new Date(startDate),
          endDate: endDate ? new Date(endDate) : null
        },
        targeting,
        goals,
        budget,
        team: {
          owner: req.user._id
        }
      });
    }

    // Process content if provided
    if (content.length > 0) {
      for (const contentItem of content) {
        const newContent = new Content({
          title: contentItem.title,
          content: contentItem.content,
          contentType: contentItem.contentType || 'text',
          platforms: contentItem.platforms.map(p => ({ platform: p })),
          category: contentItem.category || 'general',
          createdBy: req.user._id,
          status: 'draft'
        });
        
        await newContent.save();
        
        campaign.content.push({
          contentId: newContent._id,
          scheduledAt: contentItem.scheduledAt ? new Date(contentItem.scheduledAt) : null
        });
      }
    }

    await campaign.save();

    logger.info(`Campaign ${campaign._id} ${campaign.isNew ? 'created' : 'updated'} via webhook`);

    res.status(201).json({
      success: true,
      campaignId: campaign._id,
      message: `Campaign ${campaign.isNew ? 'created' : 'updated'} successfully`
    });

  } catch (error) {
    logger.error('Webhook campaign processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process campaign',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/webhooks/analytics - Receive analytics data
router.post('/analytics', authenticateWebhook, validateSignature, [
  body('contentId').isMongoId().withMessage('Valid content ID required'),
  body('platform').isString().withMessage('Platform name required'),
  body('metrics').isObject().withMessage('Metrics object required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { contentId, platform, metrics } = req.body;

    // Find and update content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Find the platform data
    const platformIndex = content.platforms.findIndex(p => p.platform === platform);
    if (platformIndex === -1) {
      return res.status(404).json({ error: 'Platform not found for this content' });
    }

    // Update engagement metrics
    const engagement = content.platforms[platformIndex].engagement || {};
    Object.assign(engagement, {
      likes: metrics.likes || engagement.likes || 0,
      shares: metrics.shares || engagement.shares || 0,
      comments: metrics.comments || engagement.comments || 0,
      views: metrics.views || engagement.views || 0,
      clicks: metrics.clicks || engagement.clicks || 0,
      lastUpdated: new Date()
    });

    content.platforms[platformIndex].engagement = engagement;
    await content.save();

    // Update platform analytics
    const platformDoc = await Platform.findOne({ name: platform });
    if (platformDoc) {
      platformDoc.analytics.lastAnalyticsUpdate = new Date();
      await platformDoc.save();
    }

    // Emit real-time update
    if (global.io) {
      global.io.emit('analyticsUpdated', {
        contentId,
        platform,
        engagement
      });
    }

    logger.info(`Analytics updated for content ${contentId} on ${platform}`);

    res.json({
      success: true,
      message: 'Analytics updated successfully'
    });

  } catch (error) {
    logger.error('Webhook analytics processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/webhooks/status - Update content publishing status
router.post('/status', authenticateWebhook, validateSignature, [
  body('contentId').isMongoId().withMessage('Valid content ID required'),
  body('platform').isString().withMessage('Platform name required'),
  body('status').isIn(['posted', 'failed']).withMessage('Status must be posted or failed'),
  body('postId').optional().isString(),
  body('error').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { contentId, platform, status, postId, error } = req.body;

    // Find and update content
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Find the platform data
    const platformIndex = content.platforms.findIndex(p => p.platform === platform);
    if (platformIndex === -1) {
      return res.status(404).json({ error: 'Platform not found for this content' });
    }

    // Update status
    content.platforms[platformIndex].posted = status === 'posted';
    content.platforms[platformIndex].postedAt = status === 'posted' ? new Date() : null;
    content.platforms[platformIndex].postId = postId || null;
    content.platforms[platformIndex].error = error || null;

    // Update overall content status
    const allPosted = content.platforms.every(p => p.posted);
    const anyFailed = content.platforms.some(p => p.error);
    
    if (allPosted) {
      content.status = 'published';
    } else if (anyFailed) {
      content.status = 'failed';
    }

    await content.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('contentStatusUpdated', {
        contentId,
        platform,
        status,
        overallStatus: content.status
      });
    }

    logger.info(`Status updated for content ${contentId} on ${platform}: ${status}`);

    res.json({
      success: true,
      message: 'Status updated successfully',
      overallStatus: content.status
    });

  } catch (error) {
    logger.error('Webhook status processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process status update',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/webhooks/health - Health check for webhooks
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/webhooks/content',
      'POST /api/webhooks/campaign', 
      'POST /api/webhooks/analytics',
      'POST /api/webhooks/status'
    ]
  });
});

module.exports = router;