# NTIC Social Media Automation - Deployment Guide

This guide provides step-by-step instructions for deploying the NTIC Social Media Automation System to Railway.

## 🚀 Quick Deploy to Railway

### Option 1: One-Click Deploy
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

### Option 2: Manual Deployment

## 📋 Prerequisites

Before deploying, ensure you have:

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **MongoDB Database**: Either:
   - Railway MongoDB plugin
   - MongoDB Atlas account
   - Self-hosted MongoDB instance
3. **Social Media API Keys**: From platforms you want to integrate
4. **Domain Name** (optional): For custom domain setup

## 🔧 Step-by-Step Deployment

### Step 1: Prepare Your Environment

1. **Clone the Repository**
```bash
git clone <your-repository-url>
cd ntic-social-automation
```

2. **Install Railway CLI**
```bash
npm install -g @railway/cli
```

3. **Login to Railway**
```bash
railway login
```

### Step 2: Create Railway Project

1. **Initialize Project**
```bash
railway init
# Select "Empty Project" when prompted
```

2. **Add MongoDB Database**
```bash
railway add mongodb
```

3. **Generate MongoDB Connection String**
```bash
railway variables
# Note the MONGODB_URL that was created
```

### Step 3: Configure Environment Variables

Set up the required environment variables in Railway:

```bash
# Core Configuration
railway variables set NODE_ENV=production
railway variables set PORT=3000
railway variables set JWT_SECRET="$(openssl rand -hex 32)"
railway variables set WEBHOOK_SECRET="$(openssl rand -hex 32)"

# Database (if not using Railway MongoDB plugin)
railway variables set MONGODB_URI="your-mongodb-connection-string"

# CORS Configuration
railway variables set ALLOWED_ORIGINS="https://yourdomain.com,https://dashboard.yourdomain.com"
```

### Step 4: Configure Social Media Platform APIs

#### LinkedIn
```bash
railway variables set LINKEDIN_CLIENT_ID="your-linkedin-client-id"
railway variables set LINKEDIN_CLIENT_SECRET="your-linkedin-client-secret"
```

#### Twitter/X
```bash
railway variables set TWITTER_API_KEY="your-twitter-api-key"
railway variables set TWITTER_API_SECRET="your-twitter-api-secret"
railway variables set TWITTER_BEARER_TOKEN="your-twitter-bearer-token"
```

#### Facebook/Meta
```bash
railway variables set FACEBOOK_APP_ID="your-facebook-app-id"
railway variables set FACEBOOK_APP_SECRET="your-facebook-app-secret"
```

#### YouTube
```bash
railway variables set YOUTUBE_CLIENT_ID="your-youtube-client-id"
railway variables set YOUTUBE_CLIENT_SECRET="your-youtube-client-secret"
```

#### TikTok Business
```bash
railway variables set TIKTOK_CLIENT_ID="your-tiktok-client-id"
railway variables set TIKTOK_CLIENT_SECRET="your-tiktok-client-secret"
```

#### Pinterest
```bash
railway variables set PINTEREST_APP_ID="your-pinterest-app-id"
railway variables set PINTEREST_APP_SECRET="your-pinterest-app-secret"
```

### Step 5: Deploy Application

1. **Deploy to Railway**
```bash
railway up
```

2. **Wait for Deployment**
The deployment process will:
- Install dependencies
- Build the application
- Start the server
- Run health checks

3. **Get Deployment URL**
```bash
railway domain
# This will show your deployment URL
```

### Step 6: Initial Setup

1. **Access Your Application**
Visit your Railway deployment URL (e.g., `https://your-app.railway.app`)

2. **Verify Health**
Check the health endpoint: `https://your-app.railway.app/health`

3. **Create Admin User**
Use the API to create your first admin user:

```bash
curl -X POST https://your-app.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@yourdomain.com",
    "password": "your-secure-password",
    "role": "admin"
  }'
```

4. **Login and Get Token**
```bash
curl -X POST https://your-app.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin@yourdomain.com",
    "password": "your-secure-password"
  }'
```

### Step 7: Configure Social Media Platforms

For each platform you want to use:

1. **Connect Platform**
```bash
curl -X POST https://your-app.railway.app/api/platforms/linkedin/connect \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "platform-access-token",
    "refreshToken": "platform-refresh-token",
    "clientId": "platform-client-id"
  }'
```

2. **Test Connection**
```bash
curl -X POST https://your-app.railway.app/api/platforms/linkedin/test-connection \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🌐 Custom Domain Setup

### Step 1: Add Custom Domain
```bash
railway domain add yourdomain.com
```

### Step 2: Configure DNS
Add the following DNS records to your domain:
- **A Record**: Point to Railway's IP (provided in dashboard)
- **CNAME Record**: Point www.yourdomain.com to yourdomain.com

### Step 3: Update Environment Variables
```bash
railway variables set ALLOWED_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
```

## 🔒 Security Configuration

### SSL Certificate
Railway automatically provides SSL certificates for all deployments.

### Security Headers
The application includes security headers by default:
- X-Content-Type-Options
- X-Frame-Options  
- X-XSS-Protection
- Strict-Transport-Security (production)

### Rate Limiting
Configure rate limiting:
```bash
railway variables set API_RATE_LIMIT=1000
railway variables set API_RATE_WINDOW=1h
```

## 📊 Monitoring Setup

### Application Monitoring
Railway provides built-in monitoring. Additional monitoring can be configured:

```bash
# Error tracking
railway variables set SENTRY_DSN="your-sentry-dsn"

# Application insights
railway variables set GOOGLE_ANALYTICS_ID="your-ga-tracking-id"
```

### Health Checks
The application includes automatic health checks at `/health`

### Logging
Logs are available via Railway dashboard or CLI:
```bash
railway logs --tail
```

## 🔧 Advanced Configuration

### Redis for Queue Management (Optional)
```bash
railway add redis
railway variables set REDIS_URL=$REDIS_URL
```

### Email Notifications
```bash
railway variables set SMTP_HOST="smtp.gmail.com"
railway variables set SMTP_PORT=587
railway variables set SMTP_USER="your-email@gmail.com"
railway variables set SMTP_PASS="your-email-password"
railway variables set FROM_EMAIL="noreply@yourdomain.com"
```

### File Storage Configuration
```bash
railway variables set MAX_FILE_SIZE="50MB"
railway variables set UPLOAD_PATH="/tmp/uploads/"
```

## 🚀 NTIC Integration

### Webhook Setup for NTIC Agents

1. **Generate API Key**
After creating admin user, generate API key for NTIC integration:

```bash
curl -X POST https://your-app.railway.app/api/auth/api-key \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "NTIC-Integration",
    "permissions": ["canCreateContent", "canAccessAPI"]
  }'
```

2. **Configure NTIC Agents**
Update your NTIC agents to use the webhook endpoint:
```
Webhook URL: https://your-app.railway.app/api/webhooks/content
API Key: [Generated API Key]
```

3. **Test Integration**
```bash
curl -X POST https://your-app.railway.app/api/webhooks/content \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Content from NTIC",
    "content": "This is a test post from the NTIC system",
    "platforms": ["linkedin"],
    "source": {
      "agent": "ORACLE",
      "workflow": "test"
    },
    "autoApprove": true
  }'
```

## 📱 Dashboard Access

### Web Dashboard
Access the dashboard at: `https://your-app.railway.app/dashboard`

### Mobile Access
The dashboard is responsive and works on mobile devices.

### API Documentation
Interactive API docs available at: `https://your-app.railway.app/api/docs`

## 🔄 Updates and Maintenance

### Deploying Updates
```bash
git pull origin main
railway up
```

### Database Backups
```bash
# Using Railway CLI
railway connect mongodb
# Then use mongodump/mongorestore commands
```

### Monitoring Logs
```bash
railway logs --tail
```

### Environment Variable Updates
```bash
railway variables set VARIABLE_NAME="new-value"
```

## 🛠 Troubleshooting

### Common Issues

#### 1. MongoDB Connection Issues
```bash
# Check MongoDB connection
railway variables get MONGODB_URI
# Test connection manually
```

#### 2. Platform API Connection Failures
- Verify API keys are correct
- Check platform API rate limits
- Ensure callback URLs are configured

#### 3. File Upload Issues
```bash
# Increase file size limit
railway variables set MAX_FILE_SIZE="100MB"
```

#### 4. Memory Issues
```bash
# Monitor memory usage
railway logs --tail | grep "memory"
```

### Debug Mode
Enable debug logging:
```bash
railway variables set LOG_LEVEL="debug"
```

### Health Check Failures
Check application health:
```bash
curl https://your-app.railway.app/health
```

## 📞 Support

### Railway Support
- Railway Dashboard: https://railway.app/dashboard
- Railway Discord: https://discord.gg/railway

### Application Support
- Check logs: `railway logs`
- Health endpoint: `/health`
- API status: `/api/health`

## ✅ Deployment Checklist

- [ ] Railway project created
- [ ] MongoDB configured
- [ ] Environment variables set
- [ ] Social media API keys configured
- [ ] Application deployed successfully
- [ ] Health check passing
- [ ] Admin user created
- [ ] Platforms connected and tested
- [ ] NTIC webhook integration tested
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active
- [ ] Monitoring configured
- [ ] Backup strategy implemented

## 🎯 Production Optimization

### Performance Tuning
```bash
# Optimize for production
railway variables set NODE_ENV=production
railway variables set LOG_LEVEL=info

# Configure clustering (if needed)
railway variables set WEB_CONCURRENCY=2
```

### Security Hardening
```bash
# Additional security headers
railway variables set SECURITY_HEADERS=strict

# API rate limiting
railway variables set API_RATE_LIMIT=500
```

### Scaling
Railway automatically handles scaling, but you can configure:
```bash
# Set memory limits
railway variables set RAILWAY_MEMORY_LIMIT=2048
```

---

**Deployment Complete!** 🎉

Your NTIC Social Media Automation System is now live and ready to power your $50K+/month autonomous revenue system.