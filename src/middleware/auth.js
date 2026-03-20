const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

// Main authentication middleware
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      logger.logSecurityEvent('missing_token', { 
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        endpoint: req.path
      });
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ntic-social-secret');
    
    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user || !user.isActive) {
      logger.logSecurityEvent('invalid_user', { 
        userId: decoded.id,
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Check if session exists and is valid
    const session = user.sessions.find(s => s.token === token);
    if (!session || session.expiresAt < new Date()) {
      logger.logSecurityEvent('expired_session', { 
        userId: user._id,
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'Session expired' });
    }

    // Update session activity
    session.lastActivity = new Date();
    await user.save();

    // Attach user to request with helper methods
    req.user = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: user.permissions,
      profile: user.profile,
      hasPermission: (permission) => {
        if (user.role === 'admin') return true;
        return user.permissions[permission] === true;
      }
    };

    // Log successful authentication
    logger.logUserActivity(user._id, 'api_access', {
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });

    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logger.logSecurityEvent('invalid_token', { 
        ip: req.ip,
        error: error.message,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (error.name === 'TokenExpiredError') {
      logger.logSecurityEvent('expired_token', { 
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'Token expired' });
    }

    logger.logError(error, req);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Role-based access control middleware
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole) && userRole !== 'admin') {
      logger.logSecurityEvent('insufficient_role', {
        userId: req.user.id,
        userRole,
        requiredRoles: allowedRoles,
        endpoint: req.path
      });
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
};

// Permission-based access control middleware
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.hasPermission(permission)) {
      logger.logSecurityEvent('insufficient_permission', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredPermission: permission,
        endpoint: req.path
      });
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: permission
      });
    }

    next();
  };
};

// API key authentication middleware (for webhooks)
const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
      logger.logSecurityEvent('missing_api_key', { 
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'API key required' });
    }

    // Find user with this API key
    const user = await User.findOne({ 
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });

    if (!user) {
      logger.logSecurityEvent('invalid_api_key', { 
        apiKey: apiKey.substring(0, 10) + '...',
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check if API key is expired
    const keyData = user.apiKeys.find(k => k.key === apiKey);
    if (keyData.expiresAt && keyData.expiresAt < new Date()) {
      logger.logSecurityEvent('expired_api_key', { 
        userId: user._id,
        keyName: keyData.name,
        ip: req.ip,
        endpoint: req.path
      });
      return res.status(401).json({ error: 'API key expired' });
    }

    // Update last used
    keyData.lastUsed = new Date();
    await user.save();

    // Attach user to request
    req.user = {
      id: user._id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      apiKey: keyData.name,
      hasPermission: (permission) => {
        if (user.role === 'admin') return true;
        // Check if API key has specific permissions
        if (keyData.permissions && keyData.permissions.length > 0) {
          return keyData.permissions.includes(permission);
        }
        return user.permissions[permission] === true;
      }
    };

    logger.logUserActivity(user._id, 'api_key_access', {
      keyName: keyData.name,
      endpoint: req.path,
      method: req.method,
      ip: req.ip
    });

    next();

  } catch (error) {
    logger.logError(error, req);
    return res.status(500).json({ error: 'API key authentication failed' });
  }
};

// Rate limiting middleware
const rateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip + (req.user?.id || 'anonymous');
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or create request log for this key
    if (!requests.has(key)) {
      requests.set(key, []);
    }

    const requestLog = requests.get(key);
    
    // Remove old requests outside the window
    while (requestLog.length && requestLog[0] < windowStart) {
      requestLog.shift();
    }

    // Check if limit exceeded
    if (requestLog.length >= max) {
      logger.logSecurityEvent('rate_limit_exceeded', {
        ip: req.ip,
        userId: req.user?.id,
        endpoint: req.path,
        requestCount: requestLog.length,
        limit: max
      });

      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000),
        limit: max,
        remaining: 0
      });
    }

    // Add current request
    requestLog.push(now);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', max - requestLog.length);
    res.setHeader('X-RateLimit-Reset', new Date(now + windowMs));

    next();
  };
};

// Optional authentication middleware (user can be null)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'ntic-social-secret');
    const user = await User.findById(decoded.id).select('-password');
    
    if (user && user.isActive) {
      req.user = {
        id: user._id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        hasPermission: (permission) => {
          if (user.role === 'admin') return true;
          return user.permissions[permission] === true;
        }
      };
    } else {
      req.user = null;
    }

    next();

  } catch (error) {
    // Don't fail on optional auth errors
    req.user = null;
    next();
  }
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
};

module.exports = {
  authMiddleware,
  requireRole,
  requirePermission,
  apiKeyAuth,
  rateLimit,
  optionalAuth,
  securityHeaders
};