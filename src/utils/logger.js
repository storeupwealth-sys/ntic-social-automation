const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Tell winston that we want to use these colors
winston.addColors(colors);

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    )
  }),
  
  // Error log file
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.uncolorize(),
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  
  // Combined log file
  new winston.transports.File({
    filename: path.join(process.cwd(), 'logs', 'combined.log'),
    format: winston.format.combine(
      winston.format.uncolorize(),
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(process.cwd(), 'logs', 'exceptions.log') 
    }),
    new winston.transports.Console()
  ],
  
  // Handle unhandled rejections
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(process.cwd(), 'logs', 'rejections.log') 
    }),
    new winston.transports.Console()
  ]
});

// If we're not in production, add console logging with simple format
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
    level: 'debug'
  }));
}

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Helper functions
logger.logRequest = (req, res, next) => {
  logger.http(`${req.method} ${req.url} - ${req.ip}`);
  next();
};

logger.logError = (error, req = null) => {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    url: req?.url,
    method: req?.method,
    ip: req?.ip,
    userAgent: req?.headers?.['user-agent'],
    timestamp: new Date().toISOString()
  };
  
  logger.error('Application Error', errorInfo);
};

logger.logPlatformActivity = (platform, action, result) => {
  const logData = {
    platform,
    action,
    success: result.success || false,
    error: result.error || null,
    timestamp: new Date().toISOString()
  };
  
  if (result.success) {
    logger.info(`Platform Activity: ${platform} - ${action}`, logData);
  } else {
    logger.error(`Platform Activity Failed: ${platform} - ${action}`, logData);
  }
};

logger.logContentActivity = (contentId, action, details = {}) => {
  const logData = {
    contentId,
    action,
    ...details,
    timestamp: new Date().toISOString()
  };
  
  logger.info(`Content Activity: ${action}`, logData);
};

logger.logUserActivity = (userId, action, details = {}) => {
  const logData = {
    userId,
    action,
    ...details,
    timestamp: new Date().toISOString()
  };
  
  logger.info(`User Activity: ${action}`, logData);
};

logger.logAPICall = (endpoint, method, userId, responseTime, statusCode) => {
  const logData = {
    endpoint,
    method,
    userId,
    responseTime,
    statusCode,
    timestamp: new Date().toISOString()
  };
  
  logger.http(`API Call: ${method} ${endpoint}`, logData);
};

logger.logSchedulerActivity = (action, details = {}) => {
  const logData = {
    scheduler: true,
    action,
    ...details,
    timestamp: new Date().toISOString()
  };
  
  logger.info(`Scheduler: ${action}`, logData);
};

logger.logWebhookActivity = (source, action, details = {}) => {
  const logData = {
    webhook: true,
    source,
    action,
    ...details,
    timestamp: new Date().toISOString()
  };
  
  logger.info(`Webhook: ${source} - ${action}`, logData);
};

// Security logging
logger.logSecurityEvent = (event, details = {}) => {
  const logData = {
    security: true,
    event,
    ...details,
    timestamp: new Date().toISOString(),
    severity: 'high'
  };
  
  logger.warn(`Security Event: ${event}`, logData);
};

// Performance logging
logger.logPerformance = (operation, duration, details = {}) => {
  const logData = {
    performance: true,
    operation,
    duration,
    ...details,
    timestamp: new Date().toISOString()
  };
  
  if (duration > 5000) { // Log slow operations (>5 seconds)
    logger.warn(`Slow Operation: ${operation}`, logData);
  } else {
    logger.debug(`Performance: ${operation}`, logData);
  }
};

// Cleanup old log files
logger.cleanupLogs = () => {
  const fs = require('fs');
  const path = require('path');
  
  const logsDir = path.join(process.cwd(), 'logs');
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  const now = Date.now();
  
  try {
    const files = fs.readdirSync(logsDir);
    
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      
      if (now - stat.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        logger.info(`Cleaned up old log file: ${file}`);
      }
    });
  } catch (error) {
    logger.error('Failed to cleanup old logs:', error);
  }
};

// Schedule log cleanup to run daily
setInterval(() => {
  logger.cleanupLogs();
}, 24 * 60 * 60 * 1000); // Run daily

module.exports = logger;