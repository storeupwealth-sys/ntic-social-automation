const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'agent', 'viewer'],
    default: 'viewer'
  },
  permissions: {
    canCreateContent: { type: Boolean, default: false },
    canApproveContent: { type: Boolean, default: false },
    canManagePlatforms: { type: Boolean, default: false },
    canViewAnalytics: { type: Boolean, default: true },
    canManageUsers: { type: Boolean, default: false },
    canAccessAPI: { type: Boolean, default: false }
  },
  profile: {
    firstName: String,
    lastName: String,
    avatar: String,
    timezone: { type: String, default: 'America/New_York' },
    notificationPreferences: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      discord: { type: Boolean, default: false },
      telegram: { type: Boolean, default: false }
    }
  },
  apiKeys: [{
    name: String,
    key: String,
    permissions: [String],
    lastUsed: Date,
    expiresAt: Date,
    isActive: { type: Boolean, default: true }
  }],
  sessions: [{
    token: String,
    device: String,
    ip: String,
    userAgent: String,
    expiresAt: Date,
    lastActivity: Date
  }],
  activity: {
    lastLogin: Date,
    loginCount: { type: Number, default: 0 },
    contentCreated: { type: Number, default: 0 },
    contentApproved: { type: Number, default: 0 },
    platformsManaged: [String]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  twoFactorAuth: {
    enabled: { type: Boolean, default: false },
    secret: String,
    backupCodes: [String]
  }
}, {
  timestamps: true
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ 'apiKeys.key': 1 });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate API key
userSchema.methods.generateAPIKey = function(name, permissions = []) {
  const crypto = require('crypto');
  const key = 'ntic_' + crypto.randomBytes(32).toString('hex');
  
  this.apiKeys.push({
    name,
    key,
    permissions,
    lastUsed: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    isActive: true
  });
  
  return key;
};

// Check permissions
userSchema.methods.hasPermission = function(permission) {
  if (this.role === 'admin') return true;
  return this.permissions[permission] === true;
};

// Clean up expired sessions
userSchema.methods.cleanExpiredSessions = function() {
  const now = new Date();
  this.sessions = this.sessions.filter(session => session.expiresAt > now);
};

module.exports = mongoose.model('User', userSchema);