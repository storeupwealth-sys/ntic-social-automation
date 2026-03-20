# NTIC Social Media Automation System

A comprehensive multi-platform social media automation system built for NTIC Intelligence Factory. This enterprise-grade solution manages content distribution, scheduling, analytics, and automated engagement across major social media platforms.

## 🚀 Features

### 📱 Multi-Platform Support
- **LinkedIn**: Post scheduling, connection outreach, DM sequences
- **Twitter/X**: Tweet scheduling, thread posting, auto-engagement
- **Facebook/Instagram**: Content distribution and management
- **YouTube**: Video upload and playlist management
- **TikTok**: Video publishing and analytics
- **Pinterest**: Pin creation and board management
- **Upwork/Fiverr**: Automated proposal generation and submission

### 🎯 Core Capabilities
- **Content Management**: Create, schedule, and publish content across platforms
- **AI-Powered Automation**: Smart proposal generation and content optimization
- **Real-time Analytics**: Track engagement, ROI, and performance metrics
- **Campaign Management**: Multi-platform campaigns with goal tracking
- **Webhook Integration**: Seamless integration with NTIC agents
- **Dashboard Interface**: Comprehensive web dashboard for monitoring

### 🔒 Security & Scalability
- JWT-based authentication with role-based access control
- API key management for external integrations
- Rate limiting and security headers
- Comprehensive error handling and logging
- Real-time notifications via WebSocket

## 🛠 Technology Stack

- **Backend**: Node.js + Express
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT with session management
- **File Processing**: Sharp for image optimization
- **Automation**: Puppeteer for browser-based interactions
- **Scheduling**: Node-cron for automated tasks
- **Real-time**: Socket.io for live updates
- **Deployment**: Railway with Docker support

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- MongoDB 4.4+
- Redis (optional, for advanced queue management)

### Local Development

1. **Clone the repository**
```bash
git clone <repository-url>
cd ntic-social-automation
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start MongoDB**
```bash
# Using Docker
docker run -d -p 27017:27017 mongo:latest

# Or use your local MongoDB installation
mongod
```

5. **Run the application**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

6. **Access the application**
- API: `http://localhost:3000/api`
- Health Check: `http://localhost:3000/health`
- Dashboard: `http://localhost:3000/dashboard`

## 🚀 Railway Deployment

### Quick Deploy
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

### Manual Deployment

1. **Create Railway Project**
```bash
npm install -g @railway/cli
railway login
railway init
```

2. **Set Environment Variables**
```bash
# Set required variables
railway variables set NODE_ENV=production
railway variables set MONGODB_URI=your-mongodb-uri
railway variables set JWT_SECRET=your-jwt-secret

# Add social media API keys
railway variables set TWITTER_API_KEY=your-twitter-key
railway variables set LINKEDIN_CLIENT_ID=your-linkedin-id
# ... add other platform credentials
```

3. **Deploy**
```bash
railway up
```

### Environment Variables Setup

Copy `.env.example` to `.env` and configure:

#### Required Variables
```env
NODE_ENV=production
MONGODB_URI=mongodb://localhost:27017/ntic-social
JWT_SECRET=your-super-secure-secret
PORT=3000
```

#### Platform API Keys
```env
# LinkedIn
LINKEDIN_CLIENT_ID=your-client-id
LINKEDIN_CLIENT_SECRET=your-client-secret

# Twitter/X
TWITTER_API_KEY=your-api-key
TWITTER_API_SECRET=your-api-secret
TWITTER_BEARER_TOKEN=your-bearer-token

# Add other platform credentials...
```

## 📚 API Documentation

### Authentication
All API requests require authentication via JWT token:
```bash
Authorization: Bearer <your-jwt-token>
```

### Core Endpoints

#### Content Management
```bash
# List content
GET /api/content

# Create content
POST /api/content
{
  "title": "Content Title",
  "content": "Content body",
  "platforms": ["linkedin", "twitter"],
  "category": "ai-consulting",
  "priority": "high"
}

# Schedule content
POST /api/content/:id/schedule
{
  "scheduledAt": "2024-03-20T10:00:00Z"
}
```

#### Platform Management
```bash
# List platforms
GET /api/platforms

# Connect platform
POST /api/platforms/linkedin/connect
{
  "accessToken": "your-access-token",
  "refreshToken": "your-refresh-token"
}

# Test connection
POST /api/platforms/linkedin/test-connection
```

#### Analytics
```bash
# Dashboard overview
GET /api/analytics/overview?timeRange=30d

# Platform comparison
GET /api/analytics/platforms

# Content performance
GET /api/analytics/content?platform=linkedin&sortBy=engagement
```

### Webhook Endpoints

#### Receive Content from NTIC Agents
```bash
POST /api/webhooks/content
X-API-Key: your-api-key
{
  "title": "Auto-generated Content",
  "content": "Content from NTIC agent",
  "platforms": ["linkedin", "twitter"],
  "source": {
    "agent": "ORACLE",
    "workflow": "content-generation",
    "campaign": "ai-consulting-leads"
  },
  "autoApprove": true,
  "scheduledAt": "2024-03-20T15:30:00Z"
}
```

#### Update Analytics
```bash
POST /api/webhooks/analytics
X-API-Key: your-api-key
{
  "contentId": "content-id",
  "platform": "linkedin",
  "metrics": {
    "likes": 45,
    "shares": 12,
    "comments": 8,
    "views": 1250,
    "clicks": 89
  }
}
```

## 🔧 Configuration

### Platform Setup

#### LinkedIn
1. Create LinkedIn App at https://www.linkedin.com/developers/
2. Set redirect URI to `https://yourdomain.com/auth/linkedin/callback`
3. Request required permissions: `r_liteprofile`, `r_emailaddress`, `w_member_social`

#### Twitter/X
1. Create app at https://developer.twitter.com/
2. Generate API keys and bearer token
3. Set up OAuth 1.0a for user authentication

#### Facebook/Instagram
1. Create Facebook App at https://developers.facebook.com/
2. Add Instagram Basic Display product
3. Configure Business Integration for Instagram Business accounts

#### YouTube
1. Create project in Google Cloud Console
2. Enable YouTube Data API v3
3. Create OAuth 2.0 credentials

### Automation Configuration

#### Content Scheduling
```javascript
// Optimal posting times configuration
const optimalTimes = {
  linkedin: [
    { day: 'tuesday', hours: [8, 12, 17] },
    { day: 'wednesday', hours: [8, 12, 17] },
    { day: 'thursday', hours: [8, 12, 17] }
  ],
  twitter: [
    { day: 'monday', hours: [9, 12, 15, 18] },
    { day: 'tuesday', hours: [9, 12, 15, 18] }
  ]
};
```

#### Rate Limiting
```javascript
// Platform-specific rate limits
const rateLimits = {
  linkedin: { posts: 100, window: '1h' },
  twitter: { posts: 300, window: '15m' },
  facebook: { posts: 200, window: '1h' }
};
```

## 📊 Monitoring & Analytics

### Dashboard Features
- Real-time content performance tracking
- Platform health monitoring
- Engagement rate analytics
- Campaign ROI calculation
- Failed post alerts and retry options

### Logging
- Comprehensive application logging
- Platform interaction logs
- Security event tracking
- Performance monitoring
- Automatic log rotation

### Health Checks
- Platform connection status
- Database connectivity
- Scheduler status
- System resource monitoring

## 🔐 Security

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (Admin, Manager, Agent, Viewer)
- API key management for external integrations
- Session management with expiration

### Security Headers
- CORS protection
- XSS protection
- Content type validation
- Rate limiting per IP/user
- Request size limits

### Data Protection
- Encrypted credential storage
- Secure API key handling
- Input validation and sanitization
- SQL injection prevention
- File upload security

## 🚀 Advanced Features

### AI-Powered Automation
- Intelligent content scheduling based on audience engagement
- Automated hashtag suggestions
- Smart proposal generation for Upwork/Fiverr
- Content optimization recommendations

### Campaign Management
- Multi-platform campaign creation
- Goal tracking and performance monitoring
- Budget allocation and ROI calculation
- A/B testing capabilities

### Integration Ecosystem
- NTIC Agent webhook integration
- Zapier/Make.com compatibility
- Slack notifications
- Email reporting
- Custom webhook endpoints

## 🛠 Maintenance

### Database Maintenance
```bash
# Create database backup
mongodump --db ntic-social --out backup/

# Restore database
mongorestore --db ntic-social backup/ntic-social/
```

### Log Management
```bash
# View application logs
npm run logs

# Clear old logs (automatic daily cleanup)
npm run cleanup-logs
```

### Updates & Patches
```bash
# Update dependencies
npm update

# Security audit
npm audit

# Deploy updates
railway up
```

## 📈 Scaling Considerations

### Performance Optimization
- MongoDB indexing for query optimization
- Redis caching for frequently accessed data
- Image optimization and CDN usage
- Async processing for heavy operations

### Horizontal Scaling
- Stateless application design
- Load balancer compatibility
- Database connection pooling
- Queue-based task processing

## 🐛 Troubleshooting

### Common Issues

#### Platform Connection Failures
```bash
# Test platform connections
curl -X POST https://your-app.railway.app/api/platforms/linkedin/test-connection \
  -H "Authorization: Bearer your-token"
```

#### Webhook Delivery Issues
```bash
# Check webhook logs
tail -f logs/webhook.log

# Validate webhook signature
POST /api/webhooks/content
X-NTIC-Signature: sha256=computed-signature
X-API-Key: your-api-key
```

#### Database Connection Issues
- Check MongoDB URI format
- Verify network connectivity
- Check authentication credentials
- Monitor connection pool status

### Support
For technical support and questions:
- Documentation: See inline API docs at `/api/docs`
- Logs: Check application logs for detailed error information
- Health: Monitor system health at `/health`

## 📄 License

Copyright (c) 2024 NTIC Intelligence Factory. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, modification, distribution, or use of this software is strictly prohibited.

---

**NTIC Social Automation System** - Powering $50K+/month autonomous revenue through intelligent social media automation.