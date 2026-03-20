const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    maxlength: 100
  },
  description: String,
  type: {
    type: String,
    enum: ['content-series', 'product-launch', 'lead-generation', 'brand-awareness', 'engagement'],
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'],
    default: 'draft'
  },
  platforms: [{
    type: String,
    enum: ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest']
  }],
  schedule: {
    startDate: Date,
    endDate: Date,
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'bi-weekly', 'monthly', 'custom']
    },
    customSchedule: [{
      day: String,
      times: [String]
    }],
    timezone: { type: String, default: 'America/New_York' }
  },
  content: [{
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Content'
    },
    scheduledAt: Date,
    posted: Boolean,
    platformSpecific: Map
  }],
  targeting: {
    demographics: {
      ageRange: String,
      gender: [String],
      location: [String],
      interests: [String]
    },
    keywords: [String],
    hashtags: [String],
    competitors: [String]
  },
  goals: {
    impressions: Number,
    engagement: Number,
    clicks: Number,
    conversions: Number,
    revenue: Number
  },
  budget: {
    total: Number,
    perPlatform: Map,
    spent: { type: Number, default: 0 }
  },
  analytics: {
    impressions: { type: Number, default: 0 },
    reach: { type: Number, default: 0 },
    engagement: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    costPerClick: { type: Number, default: 0 },
    costPerConversion: { type: Number, default: 0 },
    roi: { type: Number, default: 0 },
    platformBreakdown: Map,
    dailyMetrics: [{
      date: Date,
      impressions: Number,
      engagement: Number,
      clicks: Number,
      conversions: Number,
      revenue: Number
    }]
  },
  automation: {
    autoApprove: Boolean,
    autoOptimize: Boolean,
    bidStrategy: String,
    pauseConditions: {
      maxCPC: Number,
      minCTR: Number,
      maxBudget: Number
    }
  },
  team: {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    collaborators: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      role: {
        type: String,
        enum: ['viewer', 'editor', 'manager']
      }
    }]
  },
  templates: {
    contentTemplates: [String],
    hashtagSets: [[String]],
    callToActions: [String]
  },
  integrations: {
    googleAnalytics: {
      enabled: Boolean,
      trackingId: String,
      goals: [String]
    },
    facebookPixel: {
      enabled: Boolean,
      pixelId: String
    },
    salesforce: {
      enabled: Boolean,
      campaignId: String
    }
  }
}, {
  timestamps: true
});

// Indexes
campaignSchema.index({ status: 1, 'schedule.startDate': 1 });
campaignSchema.index({ 'team.owner': 1 });
campaignSchema.index({ platforms: 1, status: 1 });

// Calculate ROI
campaignSchema.methods.calculateROI = function() {
  if (this.budget.spent === 0) return 0;
  return ((this.analytics.revenue - this.budget.spent) / this.budget.spent) * 100;
};

// Check if campaign is active
campaignSchema.methods.isActive = function() {
  const now = new Date();
  return this.status === 'active' && 
         this.schedule.startDate <= now && 
         this.schedule.endDate >= now;
};

module.exports = mongoose.model('Campaign', campaignSchema);