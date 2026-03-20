const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true,
    maxlength: 10000
  },
  contentType: {
    type: String,
    enum: ['text', 'image', 'video', 'article', 'thread'],
    required: true
  },
  platforms: [{
    platform: {
      type: String,
      enum: ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest'],
      required: true
    },
    customContent: String,
    hashtags: [String],
    mentions: [String],
    scheduled: Boolean,
    scheduledAt: Date,
    posted: Boolean,
    postedAt: Date,
    postId: String,
    error: String,
    engagement: {
      likes: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      comments: { type: Number, default: 0 },
      views: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      lastUpdated: Date
    }
  }],
  media: [{
    type: {
      type: String,
      enum: ['image', 'video', 'gif'],
      required: true
    },
    url: String,
    filename: String,
    size: Number,
    mimeType: String,
    alt: String
  }],
  tags: [String],
  category: {
    type: String,
    enum: ['ai-consulting', 'dp6', 'ai-course', 'general', 'promotional', 'educational']
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  source: {
    agent: String,
    workflow: String,
    campaign: String
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'published', 'failed', 'archived'],
    default: 'draft'
  },
  analytics: {
    totalEngagement: { type: Number, default: 0 },
    totalReach: { type: Number, default: 0 },
    conversionRate: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date
}, {
  timestamps: true
});

// Indexes for performance
contentSchema.index({ status: 1, createdAt: -1 });
contentSchema.index({ 'platforms.platform': 1, 'platforms.scheduledAt': 1 });
contentSchema.index({ category: 1, priority: 1 });
contentSchema.index({ tags: 1 });

// Virtual for total engagement across platforms
contentSchema.virtual('totalEngagement').get(function() {
  return this.platforms.reduce((total, platform) => {
    const engagement = platform.engagement;
    return total + (engagement.likes || 0) + (engagement.shares || 0) + 
           (engagement.comments || 0) + (engagement.clicks || 0);
  }, 0);
});

module.exports = mongoose.model('Content', contentSchema);