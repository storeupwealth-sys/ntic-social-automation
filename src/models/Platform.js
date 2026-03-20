const mongoose = require('mongoose');

const platformSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'upwork', 'fiverr'],
    required: true,
    unique: true
  },
  displayName: String,
  isActive: {
    type: Boolean,
    default: true
  },
  credentials: {
    accessToken: String,
    refreshToken: String,
    tokenExpiry: Date,
    clientId: String,
    clientSecret: String,
    username: String,
    profileId: String,
    pageId: String,
    businessAccountId: String
  },
  settings: {
    autoPost: {
      type: Boolean,
      default: false
    },
    requireApproval: {
      type: Boolean,
      default: true
    },
    maxPostsPerDay: {
      type: Number,
      default: 5
    },
    maxPostsPerHour: {
      type: Number,
      default: 1
    },
    optimalTimes: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      hours: [Number] // 0-23
    }],
    hashtagStrategy: {
      type: String,
      enum: ['trending', 'niche', 'branded', 'mixed'],
      default: 'mixed'
    },
    contentFilters: [String],
    engagement: {
      autoLike: Boolean,
      autoComment: Boolean,
      autoFollow: Boolean,
      targetAccounts: [String]
    }
  },
  limits: {
    dailyPosts: {
      type: Number,
      default: 0
    },
    hourlyPosts: {
      type: Number,
      default: 0
    },
    lastReset: Date
  },
  analytics: {
    totalPosts: { type: Number, default: 0 },
    totalEngagement: { type: Number, default: 0 },
    averageEngagement: { type: Number, default: 0 },
    bestPerformingContent: [{
      contentId: mongoose.Schema.Types.ObjectId,
      engagement: Number,
      date: Date
    }],
    lastAnalyticsUpdate: Date
  },
  connectionStatus: {
    isConnected: {
      type: Boolean,
      default: false
    },
    lastChecked: Date,
    lastError: String,
    rateLimitReset: Date,
    apiCallsRemaining: Number
  },
  workflows: {
    onboarding: {
      autoConnect: Boolean,
      autoFollow: [String],
      welcomeMessage: String
    },
    contentDistribution: {
      crossPost: Boolean,
      adaptContent: Boolean,
      platformSpecificHashtags: Map
    },
    engagement: {
      autoReply: Boolean,
      replyTemplates: [String],
      engagementHours: {
        start: Number,
        end: Number
      }
    }
  }
}, {
  timestamps: true
});

// Encrypt sensitive credentials
platformSchema.pre('save', async function(next) {
  if (this.isModified('credentials')) {
    // In production, implement proper encryption
    // For now, this is a placeholder
  }
  next();
});

// Method to check if platform can post now
platformSchema.methods.canPostNow = function() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  // Check daily limit
  if (this.limits.lastReset && this.limits.lastReset.toISOString().split('T')[0] !== today) {
    this.limits.dailyPosts = 0;
    this.limits.hourlyPosts = 0;
    this.limits.lastReset = now;
  }
  
  // Check limits
  if (this.limits.dailyPosts >= this.settings.maxPostsPerDay) {
    return { canPost: false, reason: 'Daily limit reached' };
  }
  
  if (this.limits.hourlyPosts >= this.settings.maxPostsPerHour) {
    return { canPost: false, reason: 'Hourly limit reached' };
  }
  
  return { canPost: true };
};

// Method to increment post counters
platformSchema.methods.incrementPostCount = function() {
  this.limits.dailyPosts += 1;
  this.limits.hourlyPosts += 1;
  this.analytics.totalPosts += 1;
};

module.exports = mongoose.model('Platform', platformSchema);