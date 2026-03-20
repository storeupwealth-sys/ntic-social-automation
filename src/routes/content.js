const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Invalid file type. Only images and videos are allowed.'));
  }
});

// Validation middleware
const contentValidation = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('content').trim().isLength({ min: 1, max: 10000 }).withMessage('Content must be 1-10000 characters'),
  body('contentType').isIn(['text', 'image', 'video', 'article', 'thread']).withMessage('Invalid content type'),
  body('platforms').isArray({ min: 1 }).withMessage('At least one platform must be selected'),
  body('category').optional().isIn(['ai-consulting', 'dp6', 'ai-course', 'general', 'promotional', 'educational']),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent'])
];

// GET /api/content - List all content with filtering and pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      platform,
      category,
      priority,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (priority) filter.priority = priority;
    if (platform) filter['platforms.platform'] = platform;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Calculate skip value for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with population
    const content = await Content.find(filter)
      .populate('createdBy', 'username email')
      .populate('approvedBy', 'username email')
      .sort(sort)
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    // Get total count for pagination
    const total = await Content.countDocuments(filter);

    res.json({
      content,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: skip + content.length < total,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    logger.error('Error fetching content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// GET /api/content/:id - Get single content item
router.get('/:id', async (req, res) => {
  try {
    const content = await Content.findById(req.params.id)
      .populate('createdBy', 'username email')
      .populate('approvedBy', 'username email');

    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    res.json(content);
  } catch (error) {
    logger.error('Error fetching content:', error);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// POST /api/content - Create new content
router.post('/', upload.array('media', 10), contentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      content,
      contentType,
      platforms,
      tags,
      category,
      priority,
      source
    } = req.body;

    // Process platforms data
    const platformData = JSON.parse(platforms);
    
    // Validate that all platforms exist and are active
    const platformNames = platformData.map(p => p.platform);
    const activePlatforms = await Platform.find({
      name: { $in: platformNames },
      isActive: true
    });

    if (activePlatforms.length !== platformNames.length) {
      return res.status(400).json({ 
        error: 'One or more selected platforms are not available' 
      });
    }

    // Process uploaded media files
    const media = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const mediaItem = {
          type: file.mimetype.startsWith('image/') ? 'image' : 'video',
          url: `/static/uploads/${file.filename}`,
          filename: file.filename,
          size: file.size,
          mimeType: file.mimetype
        };

        // Generate thumbnails for videos and optimize images
        if (mediaItem.type === 'image') {
          try {
            await sharp(file.path)
              .resize(1200, 1200, { 
                fit: 'inside',
                withoutEnlargement: true 
              })
              .jpeg({ quality: 85 })
              .toFile(file.path.replace(path.extname(file.path), '_optimized.jpg'));
            
            mediaItem.url = `/static/uploads/${file.filename.replace(path.extname(file.filename), '_optimized.jpg')}`;
          } catch (imgError) {
            logger.warn('Failed to optimize image:', imgError);
          }
        }

        media.push(mediaItem);
      }
    }

    // Create content document
    const newContent = new Content({
      title,
      content,
      contentType,
      platforms: platformData,
      media,
      tags: tags ? JSON.parse(tags) : [],
      category,
      priority,
      source: source ? JSON.parse(source) : {},
      createdBy: req.user.id,
      status: 'draft'
    });

    await newContent.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('contentCreated', {
        id: newContent._id,
        title: newContent.title,
        platforms: newContent.platforms.map(p => p.platform)
      });
    }

    logger.info(`Content created: ${newContent._id} by user ${req.user.username}`);

    res.status(201).json(newContent);

  } catch (error) {
    logger.error('Error creating content:', error);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

// PUT /api/content/:id - Update content
router.put('/:id', upload.array('media', 10), contentValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const content = await Content.findById(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check permissions
    if (content.createdBy.toString() !== req.user.id && !req.user.hasPermission('canApproveContent')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Update fields
    const updateFields = ['title', 'content', 'contentType', 'tags', 'category', 'priority'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        content[field] = req.body[field];
      }
    });

    if (req.body.platforms) {
      content.platforms = JSON.parse(req.body.platforms);
    }

    // Handle new media uploads
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        content.media.push({
          type: file.mimetype.startsWith('image/') ? 'image' : 'video',
          url: `/static/uploads/${file.filename}`,
          filename: file.filename,
          size: file.size,
          mimeType: file.mimetype
        });
      }
    }

    await content.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('contentUpdated', {
        id: content._id,
        title: content.title
      });
    }

    logger.info(`Content updated: ${content._id} by user ${req.user.username}`);

    res.json(content);

  } catch (error) {
    logger.error('Error updating content:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// POST /api/content/:id/approve - Approve content for publishing
router.post('/:id/approve', async (req, res) => {
  try {
    if (!req.user.hasPermission('canApproveContent')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const content = await Content.findById(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    content.status = 'scheduled';
    content.approvedBy = req.user.id;
    content.approvedAt = new Date();

    await content.save();

    // Emit real-time update
    if (global.io) {
      global.io.emit('contentApproved', {
        id: content._id,
        title: content.title
      });
    }

    logger.info(`Content approved: ${content._id} by user ${req.user.username}`);

    res.json({ message: 'Content approved successfully', content });

  } catch (error) {
    logger.error('Error approving content:', error);
    res.status(500).json({ error: 'Failed to approve content' });
  }
});

// DELETE /api/content/:id - Delete content
router.delete('/:id', async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Check permissions
    if (content.createdBy.toString() !== req.user.id && !req.user.hasPermission('canApproveContent')) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    await Content.findByIdAndDelete(req.params.id);

    // Emit real-time update
    if (global.io) {
      global.io.emit('contentDeleted', {
        id: req.params.id
      });
    }

    logger.info(`Content deleted: ${req.params.id} by user ${req.user.username}`);

    res.json({ message: 'Content deleted successfully' });

  } catch (error) {
    logger.error('Error deleting content:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// GET /api/content/:id/analytics - Get content analytics
router.get('/:id/analytics', async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }

    // Calculate analytics
    const analytics = {
      totalEngagement: content.platforms.reduce((sum, platform) => {
        const engagement = platform.engagement || {};
        return sum + (engagement.likes || 0) + (engagement.shares || 0) + 
               (engagement.comments || 0) + (engagement.clicks || 0);
      }, 0),
      platformBreakdown: content.platforms.map(platform => ({
        platform: platform.platform,
        engagement: platform.engagement,
        posted: platform.posted,
        postedAt: platform.postedAt,
        error: platform.error
      })),
      performanceScore: calculatePerformanceScore(content),
      recommendations: generateRecommendations(content)
    };

    res.json(analytics);

  } catch (error) {
    logger.error('Error fetching content analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Helper functions
function calculatePerformanceScore(content) {
  // Simple performance scoring algorithm
  let score = 0;
  const totalPlatforms = content.platforms.length;
  const postedPlatforms = content.platforms.filter(p => p.posted).length;
  
  score += (postedPlatforms / totalPlatforms) * 30; // Publication success
  
  const totalEngagement = content.platforms.reduce((sum, platform) => {
    const engagement = platform.engagement || {};
    return sum + (engagement.likes || 0) + (engagement.shares || 0) + 
           (engagement.comments || 0);
  }, 0);
  
  score += Math.min(totalEngagement / 100, 70); // Engagement score (capped at 70)
  
  return Math.round(score);
}

function generateRecommendations(content) {
  const recommendations = [];
  
  // Check for failed posts
  const failedPosts = content.platforms.filter(p => p.error);
  if (failedPosts.length > 0) {
    recommendations.push({
      type: 'error',
      message: `${failedPosts.length} platform(s) failed to post. Check platform connections.`
    });
  }
  
  // Check engagement
  const lowEngagement = content.platforms.filter(p => {
    const engagement = p.engagement || {};
    const total = (engagement.likes || 0) + (engagement.shares || 0) + (engagement.comments || 0);
    return p.posted && total < 5;
  });
  
  if (lowEngagement.length > 0) {
    recommendations.push({
      type: 'warning',
      message: 'Consider optimizing content for better engagement. Try different hashtags or posting times.'
    });
  }
  
  return recommendations;
}

module.exports = router;