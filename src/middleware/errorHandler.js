const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log the error
  logger.logError(err, req);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Invalid resource ID';
    error = { message, statusCode: 400 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate field value: ${field}`;
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = { message, statusCode: 413 };
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    const message = 'Too many files';
    error = { message, statusCode: 413 };
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    error = { message, statusCode: 400 };
  }

  // Rate limiting errors
  if (err.status === 429) {
    const message = 'Too many requests, please try again later';
    error = { message, statusCode: 429 };
  }

  // Platform API errors
  if (err.name === 'PlatformAPIError') {
    const message = `Platform error: ${err.platform} - ${err.message}`;
    error = { message, statusCode: 502, platform: err.platform };
  }

  // Social media client errors
  if (err.name === 'SocialMediaError') {
    const message = `Social media error: ${err.message}`;
    error = { message, statusCode: 502 };
  }

  // Database connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    const message = 'Database connection error';
    error = { message, statusCode: 503 };
  }

  // Default to 500 server error
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Create error response
  const errorResponse = {
    success: false,
    error: message
  };

  // Add additional error details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.details = {
      name: err.name,
      code: err.code,
      platform: error.platform,
      originalError: err
    };
  }

  // Add error ID for tracking
  const errorId = `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  errorResponse.errorId = errorId;

  // Log error with ID
  logger.error(`Error ${errorId}: ${message}`, {
    errorId,
    statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?.id,
    stack: err.stack
  });

  // Send real-time error notification for critical errors
  if (statusCode >= 500 && global.io) {
    global.io.emit('systemError', {
      errorId,
      message,
      statusCode,
      timestamp: new Date(),
      url: req.url,
      severity: statusCode >= 500 ? 'critical' : 'warning'
    });
  }

  // Set security headers for error responses
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  res.status(statusCode).json(errorResponse);
};

// 404 handler
const notFoundHandler = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  
  logger.warn('404 Not Found', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?.id
  });

  res.status(404).json({
    success: false,
    error: message
  });
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode = 500, platform = null) {
    super(message);
    this.statusCode = statusCode;
    this.platform = platform;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class PlatformAPIError extends Error {
  constructor(message, platform, statusCode = 502) {
    super(message);
    this.name = 'PlatformAPIError';
    this.platform = platform;
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class SocialMediaError extends Error {
  constructor(message, platform, operation, statusCode = 502) {
    super(message);
    this.name = 'SocialMediaError';
    this.platform = platform;
    this.operation = operation;
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class AuthenticationError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class AuthorizationError extends Error {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class RateLimitError extends Error {
  constructor(message = 'Rate limit exceeded', platform = null) {
    super(message);
    this.name = 'RateLimitError';
    this.platform = platform;
    this.statusCode = 429;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Error handling for uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
  
  // Graceful shutdown
  process.exit(1);
});

process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Rejection:', {
    error: err?.message || err,
    stack: err?.stack,
    promise: promise.toString(),
    timestamp: new Date().toISOString()
  });
  
  // Close server gracefully
  if (global.server) {
    global.server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  if (global.server) {
    global.server.close(() => {
      logger.info('Process terminated');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  if (global.server) {
    global.server.close(() => {
      logger.info('Process terminated');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  PlatformAPIError,
  SocialMediaError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError
};