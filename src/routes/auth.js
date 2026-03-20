const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/auth/register - Register new user
router.post('/register', [
  body('username').trim().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').optional().isIn(['admin', 'manager', 'agent', 'viewer']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, role = 'viewer' } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'User already exists',
        field: existingUser.email === email ? 'email' : 'username'
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      role,
      permissions: getDefaultPermissions(role)
    });

    await user.save();

    // Generate JWT token
    const token = generateToken(user);

    logger.info(`New user registered: ${username} (${email})`);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /api/auth/login - User login
router.post('/login', [
  body('login').trim().notEmpty().withMessage('Username or email required'),
  body('password').notEmpty().withMessage('Password required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { login, password } = req.body;

    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { username: login },
        { email: login.toLowerCase() }
      ],
      isActive: true
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update login activity
    user.activity.lastLogin = new Date();
    user.activity.loginCount += 1;
    
    // Clean up expired sessions
    user.cleanExpiredSessions();
    
    // Add new session
    const sessionToken = generateToken(user);
    user.sessions.push({
      token: sessionToken,
      device: req.headers['user-agent'] || 'Unknown',
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      lastActivity: new Date()
    });

    await user.save();

    logger.info(`User logged in: ${user.username}`);

    res.json({
      message: 'Login successful',
      token: sessionToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        profile: user.profile
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// POST /api/auth/logout - User logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (user) {
      // Remove current session
      const token = req.headers.authorization?.split(' ')[1];
      user.sessions = user.sessions.filter(session => session.token !== token);
      await user.save();
    }

    res.json({ message: 'Logged out successfully' });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// POST /api/auth/refresh - Refresh token
router.post('/refresh', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Generate new token
    const newToken = generateToken(user);

    // Update session with new token
    const oldToken = req.headers.authorization?.split(' ')[1];
    const sessionIndex = user.sessions.findIndex(session => session.token === oldToken);
    if (sessionIndex !== -1) {
      user.sessions[sessionIndex].token = newToken;
      user.sessions[sessionIndex].lastActivity = new Date();
      await user.save();
    }

    res.json({
      message: 'Token refreshed',
      token: newToken
    });

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -sessions');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        profile: user.profile,
        activity: user.activity,
        emailVerified: user.emailVerified,
        twoFactorAuth: {
          enabled: user.twoFactorAuth.enabled
        }
      }
    });

  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', authenticateToken, [
  body('firstName').optional().trim().isLength({ max: 50 }),
  body('lastName').optional().trim().isLength({ max: 50 }),
  body('timezone').optional().isString(),
  body('notificationPreferences').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update profile fields
    const allowedFields = ['firstName', 'lastName', 'timezone', 'notificationPreferences'];
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        if (field === 'notificationPreferences') {
          user.profile.notificationPreferences = {
            ...user.profile.notificationPreferences,
            ...req.body[field]
          };
        } else {
          user.profile[field] = req.body[field];
        }
      }
    });

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      profile: user.profile
    });

  } catch (error) {
    logger.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/change-password - Change password
router.post('/change-password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await user.comparePassword(currentPassword);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    
    // Invalidate all sessions except current one
    const currentToken = req.headers.authorization?.split(' ')[1];
    user.sessions = user.sessions.filter(session => session.token === currentToken);
    
    await user.save();

    logger.info(`Password changed for user: ${user.username}`);

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    logger.error('Password change error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// POST /api/auth/api-key - Generate API key
router.post('/api-key', authenticateToken, [
  body('name').trim().notEmpty().withMessage('API key name required'),
  body('permissions').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, permissions = [] } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.hasPermission('canAccessAPI')) {
      return res.status(403).json({ error: 'API access not permitted' });
    }

    // Generate API key
    const apiKey = user.generateAPIKey(name, permissions);
    await user.save();

    logger.info(`API key generated for user: ${user.username}`);

    res.json({
      message: 'API key generated successfully',
      apiKey,
      name
    });

  } catch (error) {
    logger.error('API key generation error:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// DELETE /api/auth/api-key/:keyId - Revoke API key
router.delete('/api-key/:keyId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const keyIndex = user.apiKeys.findIndex(key => key._id.toString() === req.params.keyId);
    if (keyIndex === -1) {
      return res.status(404).json({ error: 'API key not found' });
    }

    user.apiKeys.splice(keyIndex, 1);
    await user.save();

    logger.info(`API key revoked for user: ${user.username}`);

    res.json({ message: 'API key revoked successfully' });

  } catch (error) {
    logger.error('API key revocation error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// Middleware function
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'ntic-social-secret', async (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    try {
      const user = await User.findById(decoded.id);
      if (!user || !user.isActive) {
        return res.status(403).json({ error: 'User not found or inactive' });
      }

      req.user = {
        id: user._id,
        username: user.username,
        role: user.role,
        hasPermission: (permission) => user.hasPermission(permission)
      };
      
      next();
    } catch (error) {
      return res.status(500).json({ error: 'Authentication failed' });
    }
  });
}

// Helper functions
function generateToken(user) {
  return jwt.sign(
    { 
      id: user._id, 
      username: user.username, 
      role: user.role 
    },
    process.env.JWT_SECRET || 'ntic-social-secret',
    { expiresIn: '7d' }
  );
}

function getDefaultPermissions(role) {
  const permissions = {
    admin: {
      canCreateContent: true,
      canApproveContent: true,
      canManagePlatforms: true,
      canViewAnalytics: true,
      canManageUsers: true,
      canAccessAPI: true
    },
    manager: {
      canCreateContent: true,
      canApproveContent: true,
      canManagePlatforms: true,
      canViewAnalytics: true,
      canManageUsers: false,
      canAccessAPI: true
    },
    agent: {
      canCreateContent: true,
      canApproveContent: false,
      canManagePlatforms: false,
      canViewAnalytics: true,
      canManageUsers: false,
      canAccessAPI: true
    },
    viewer: {
      canCreateContent: false,
      canApproveContent: false,
      canManagePlatforms: false,
      canViewAnalytics: true,
      canManageUsers: false,
      canAccessAPI: false
    }
  };

  return permissions[role] || permissions.viewer;
}

module.exports = router;