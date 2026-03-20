# NTIC Social Media Automation - API Documentation

Complete API reference for the NTIC Social Media Automation System.

## 📋 Table of Contents

- [Authentication](#authentication)
- [Content Management](#content-management)
- [Platform Management](#platform-management)
- [Analytics](#analytics)
- [Webhooks](#webhooks)
- [Dashboard](#dashboard)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

## 🔐 Authentication

All API endpoints (except auth and webhooks) require authentication via JWT token.

### Register User
```http
POST /api/auth/register
```

**Request Body:**
```json
{
  "username": "string (3-50 chars)",
  "email": "string (valid email)",
  "password": "string (min 8 chars)",
  "role": "admin|manager|agent|viewer (optional, default: viewer)"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "token": "jwt-token-string",
  "user": {
    "id": "user-id",
    "username": "username",
    "email": "email@domain.com",
    "role": "viewer",
    "permissions": { ... }
  }
}
```

### Login
```http
POST /api/auth/login
```

**Request Body:**
```json
{
  "login": "username or email",
  "password": "password"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt-token-string",
  "user": {
    "id": "user-id",
    "username": "username",
    "email": "email@domain.com",
    "role": "viewer",
    "permissions": { ... }
  }
}
```

### Authentication Header
Include in all authenticated requests:
```http
Authorization: Bearer your-jwt-token
```

## 📝 Content Management

### List Content
```http
GET /api/content
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)
- `status`: Filter by status (draft, scheduled, published, failed)
- `platform`: Filter by platform
- `category`: Filter by category
- `priority`: Filter by priority
- `search`: Search in title/content
- `sortBy`: Sort field (createdAt, title, status)
- `sortOrder`: asc or desc (default: desc)

**Response:**
```json
{
  "content": [
    {
      "id": "content-id",
      "title": "Content Title",
      "content": "Content body...",
      "contentType": "text|image|video|article|thread",
      "status": "draft|scheduled|published|failed",
      "platforms": [
        {
          "platform": "linkedin",
          "posted": false,
          "scheduled": true,
          "scheduledAt": "2024-03-20T10:00:00Z",
          "engagement": {
            "likes": 0,
            "shares": 0,
            "comments": 0
          }
        }
      ],
      "createdAt": "2024-03-19T15:30:00Z",
      "createdBy": {
        "username": "creator"
      }
    }
  ],
  "pagination": {
    "current": 1,
    "pages": 5,
    "total": 100,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Create Content
```http
POST /api/content
Content-Type: multipart/form-data
```

**Form Fields:**
- `title`: Content title (required)
- `content`: Content body (required)
- `contentType`: text|image|video|article|thread (required)
- `platforms`: JSON string of platform configurations (required)
- `tags`: JSON array of tags (optional)
- `category`: Content category (optional)
- `priority`: low|medium|high|urgent (optional)
- `source`: JSON object with source info (optional)
- `media[]`: Media files (optional, max 10 files)

**Platform Configuration Example:**
```json
[
  {
    "platform": "linkedin",
    "customContent": "LinkedIn-specific content",
    "hashtags": ["#AI", "#Business"],
    "mentions": ["@company"]
  },
  {
    "platform": "twitter",
    "hashtags": ["#AI", "#Tech"]
  }
]
```

**Response:**
```json
{
  "id": "content-id",
  "title": "Content Title",
  "status": "draft",
  "platforms": [...],
  "media": [
    {
      "type": "image",
      "url": "/static/uploads/filename.jpg",
      "size": 1024000
    }
  ],
  "createdAt": "2024-03-19T15:30:00Z"
}
```

### Schedule Content
```http
POST /api/content/:id/schedule
```

**Request Body:**
```json
{
  "scheduledAt": "2024-03-20T10:00:00Z",
  "platforms": ["linkedin", "twitter"] // optional, schedules all if not specified
}
```

### Approve Content
```http
POST /api/content/:id/approve
```

**Required Permission:** `canApproveContent`

**Response:**
```json
{
  "message": "Content approved successfully",
  "content": { ... }
}
```

### Get Content Analytics
```http
GET /api/content/:id/analytics
```

**Response:**
```json
{
  "totalEngagement": 150,
  "platformBreakdown": [
    {
      "platform": "linkedin",
      "engagement": {
        "likes": 45,
        "shares": 12,
        "comments": 8
      },
      "posted": true,
      "postedAt": "2024-03-20T10:00:00Z"
    }
  ],
  "performanceScore": 75,
  "recommendations": [
    {
      "type": "warning",
      "message": "Consider optimizing content for better engagement."
    }
  ]
}
```

## 🔗 Platform Management

### List Platforms
```http
GET /api/platforms
```

**Response:**
```json
[
  {
    "name": "linkedin",
    "displayName": "LinkedIn",
    "isActive": true,
    "connectionStatus": {
      "isConnected": true,
      "lastChecked": "2024-03-19T15:30:00Z",
      "lastError": null
    },
    "settings": {
      "autoPost": false,
      "requireApproval": true,
      "maxPostsPerDay": 5
    },
    "analytics": {
      "totalPosts": 150,
      "totalEngagement": 2500,
      "averageEngagement": 16.67
    }
  }
]
```

### Connect Platform
```http
POST /api/platforms/:name/connect
```

**Required Permission:** `canManagePlatforms`

**Request Body (varies by platform):**
```json
{
  "accessToken": "platform-access-token",
  "refreshToken": "platform-refresh-token",
  "clientId": "platform-client-id",
  "profileId": "platform-profile-id"
}
```

### Test Platform Connection
```http
POST /api/platforms/:name/test-connection
```

**Response:**
```json
{
  "platform": "linkedin",
  "status": "connected",
  "details": {
    "profile": {
      "id": "profile-id",
      "name": "Profile Name"
    },
    "rateLimitRemaining": 850
  }
}
```

### Update Platform Settings
```http
PUT /api/platforms/:name/settings
```

**Request Body:**
```json
{
  "autoPost": true,
  "requireApproval": false,
  "maxPostsPerDay": 10,
  "maxPostsPerHour": 2,
  "optimalTimes": [
    {
      "day": "monday",
      "hours": [9, 12, 17]
    }
  ]
}
```

## 📊 Analytics

### Dashboard Overview
```http
GET /api/analytics/overview?timeRange=30d
```

**Query Parameters:**
- `timeRange`: 7d, 30d, 90d (default: 30d)

**Response:**
```json
{
  "timeRange": "30d",
  "overview": {
    "totalContent": 150,
    "publishedContent": 120,
    "scheduledContent": 15,
    "publishSuccessRate": 95.5
  },
  "platforms": [
    {
      "name": "linkedin",
      "totalPosts": 45,
      "totalEngagement": 850,
      "isConnected": true
    }
  ],
  "engagementTrends": [...],
  "topContent": [...]
}
```

### Platform Analytics
```http
GET /api/analytics/platforms?timeRange=30d
```

**Response:**
```json
{
  "timeRange": "30d",
  "platforms": [
    {
      "_id": "linkedin",
      "totalPosts": 45,
      "totalEngagement": 850,
      "averageEngagement": 18.89,
      "successRate": 97.78,
      "engagementRate": 3.24
    }
  ]
}
```

### Content Performance
```http
GET /api/analytics/content
```

**Query Parameters:**
- `timeRange`: 7d, 30d, 90d
- `platform`: Filter by platform
- `category`: Filter by category  
- `sortBy`: engagement, views, clicks, recent
- `limit`: Max results (default: 50)

### Export Analytics
```http
GET /api/analytics/export
```

**Query Parameters:**
- `format`: json, csv
- `type`: overview, content, platforms
- `timeRange`: 7d, 30d, 90d

**Response:**
File download with Content-Disposition header

## 🪝 Webhooks

Webhooks allow external systems (like NTIC agents) to interact with the platform.

### Authentication
Use API Key authentication:
```http
X-API-Key: your-api-key
```

Optional signature verification:
```http
X-NTIC-Signature: sha256=computed-signature
```

### Receive Content from NTIC Agents
```http
POST /api/webhooks/content
```

**Request Body:**
```json
{
  "title": "Auto-generated Content",
  "content": "Content body from NTIC agent...",
  "contentType": "text",
  "platforms": [
    {
      "platform": "linkedin",
      "hashtags": ["#AI", "#Business"]
    }
  ],
  "category": "ai-consulting",
  "priority": "high",
  "source": {
    "agent": "ORACLE",
    "workflow": "content-generation",
    "campaign": "ai-consulting-leads"
  },
  "scheduledAt": "2024-03-20T15:30:00Z",
  "autoApprove": true,
  "mediaUrls": [
    "https://example.com/image.jpg"
  ]
}
```

**Response:**
```json
{
  "success": true,
  "contentId": "content-id",
  "status": "scheduled",
  "message": "Content received and scheduled"
}
```

### Update Content Status
```http
POST /api/webhooks/status
```

**Request Body:**
```json
{
  "contentId": "content-id",
  "platform": "linkedin",
  "status": "posted",
  "postId": "platform-post-id",
  "error": null
}
```

### Update Analytics
```http
POST /api/webhooks/analytics
```

**Request Body:**
```json
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

### Create Campaign
```http
POST /api/webhooks/campaign
```

**Request Body:**
```json
{
  "name": "AI Consulting Campaign",
  "type": "lead-generation",
  "platforms": ["linkedin", "twitter"],
  "startDate": "2024-03-20T00:00:00Z",
  "endDate": "2024-04-20T00:00:00Z",
  "content": [
    {
      "title": "Campaign Content 1",
      "content": "Content body...",
      "platforms": ["linkedin"],
      "scheduledAt": "2024-03-21T10:00:00Z"
    }
  ],
  "goals": {
    "impressions": 100000,
    "engagement": 5000,
    "clicks": 500
  }
}
```

## 🎯 Dashboard

### Dashboard Statistics
```http
GET /api/dashboard/stats
```

**Response:**
```json
{
  "overview": {
    "totalContent": 150,
    "publishedToday": 12,
    "scheduledContent": 15,
    "weeklyGrowth": 25
  },
  "platforms": {
    "total": 6,
    "connected": 5,
    "disconnected": 1
  },
  "engagement": {
    "totalEngagement": 2500,
    "totalViews": 75000,
    "engagementRate": 3.33
  },
  "systemStatus": {
    "scheduler": {
      "isInitialized": true,
      "nextProcessingTime": "Every minute"
    }
  }
}
```

### Recent Activity
```http
GET /api/dashboard/activity?limit=20
```

### Scheduled Content
```http
GET /api/dashboard/scheduled?timeRange=24h
```

### System Health
```http
GET /api/dashboard/health
```

**Response:**
```json
{
  "overall": {
    "score": 95,
    "status": "healthy"
  },
  "platforms": [
    {
      "name": "linkedin",
      "status": "connected",
      "lastChecked": "2024-03-19T15:30:00Z",
      "rateLimitStatus": "ok"
    }
  ],
  "database": {
    "status": "connected",
    "responseTime": 8
  },
  "scheduler": {
    "isInitialized": true
  },
  "system": {
    "uptime": 86400,
    "memory": {
      "used": 245,
      "total": 512
    }
  }
}
```

### Quick Actions
```http
GET /api/dashboard/quick-actions
```

### System Notifications
```http
GET /api/dashboard/notifications
```

## ❌ Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": "Error message",
  "errorId": "ERR-1234567890-abc123",
  "details": {
    "field": "validation error details"
  }
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request / Validation Error
- `401` - Unauthorized
- `403` - Forbidden / Insufficient Permissions
- `404` - Not Found
- `413` - Payload Too Large
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error
- `502` - Platform API Error
- `503` - Service Unavailable

### Common Error Types

#### Validation Error
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "title",
      "message": "Title must be 1-200 characters"
    }
  ]
}
```

#### Platform API Error
```json
{
  "success": false,
  "error": "Platform error: LinkedIn - Rate limit exceeded",
  "platform": "linkedin"
}
```

#### Authentication Error
```json
{
  "success": false,
  "error": "Invalid or expired token"
}
```

## 🚦 Rate Limiting

### Default Limits
- **API Endpoints**: 100 requests per 15 minutes per IP
- **Webhook Endpoints**: 500 requests per hour per API key
- **Upload Endpoints**: 10 requests per minute per user

### Rate Limit Headers
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 85
X-RateLimit-Reset: Wed, 20 Mar 2024 16:00:00 GMT
```

### Rate Limit Exceeded Response
```json
{
  "success": false,
  "error": "Too many requests",
  "retryAfter": 900,
  "limit": 100,
  "remaining": 0
}
```

## 🔍 Filtering and Sorting

### Common Query Parameters

#### Pagination
- `page`: Page number (1-based)
- `limit`: Items per page (max 100)

#### Filtering
- `status`: Filter by status
- `platform`: Filter by platform name
- `category`: Filter by category
- `priority`: Filter by priority
- `search`: Search term

#### Sorting
- `sortBy`: Field to sort by
- `sortOrder`: `asc` or `desc`

#### Date Ranges
- `timeRange`: Predefined ranges (7d, 30d, 90d)
- `startDate`: Custom start date (ISO 8601)
- `endDate`: Custom end date (ISO 8601)

## 📊 Webhook Integration Examples

### NTIC Agent Integration

#### Python Example
```python
import requests
import json

def send_content_to_ntic_social(content_data):
    url = "https://your-app.railway.app/api/webhooks/content"
    headers = {
        "X-API-Key": "your-api-key",
        "Content-Type": "application/json"
    }
    
    response = requests.post(url, headers=headers, json=content_data)
    
    if response.status_code == 201:
        result = response.json()
        print(f"Content created: {result['contentId']}")
        return result
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return None

# Example usage
content = {
    "title": "AI Market Insights",
    "content": "Latest trends in AI automation...",
    "platforms": ["linkedin", "twitter"],
    "source": {
        "agent": "ORACLE",
        "workflow": "market-analysis"
    },
    "autoApprove": True
}

send_content_to_ntic_social(content)
```

#### JavaScript/Node.js Example
```javascript
const axios = require('axios');

async function publishToSocial(content) {
    try {
        const response = await axios.post(
            'https://your-app.railway.app/api/webhooks/content',
            content,
            {
                headers: {
                    'X-API-Key': 'your-api-key',
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('Content published:', response.data.contentId);
        return response.data;
    } catch (error) {
        console.error('Publishing failed:', error.response?.data || error.message);
        throw error;
    }
}

// Example usage
publishToSocial({
    title: "Business Automation Update",
    content: "New automation features now available...",
    platforms: [
        {
            platform: "linkedin",
            hashtags: ["#Automation", "#Business", "#AI"]
        }
    ],
    scheduledAt: "2024-03-20T15:00:00Z"
});
```

## 🔧 Advanced Features

### Bulk Operations

#### Bulk Content Creation
```http
POST /api/content/bulk
```

**Request Body:**
```json
{
  "content": [
    {
      "title": "Content 1",
      "content": "Content body 1...",
      "platforms": ["linkedin"]
    },
    {
      "title": "Content 2", 
      "content": "Content body 2...",
      "platforms": ["twitter"]
    }
  ]
}
```

#### Bulk Scheduling
```http
POST /api/content/bulk-schedule
```

**Request Body:**
```json
{
  "contentIds": ["id1", "id2", "id3"],
  "schedule": {
    "startTime": "2024-03-20T09:00:00Z",
    "interval": "1h", // 1h, 2h, 1d, etc.
    "platforms": ["linkedin", "twitter"]
  }
}
```

### Custom Webhooks

#### Subscribe to Events
```http
POST /api/webhooks/subscribe
```

**Request Body:**
```json
{
  "url": "https://your-system.com/webhook",
  "events": ["content.published", "platform.disconnected", "analytics.updated"],
  "secret": "your-webhook-secret"
}
```

---

## 🎯 Production Tips

### API Best Practices
1. **Always use HTTPS** in production
2. **Store API keys securely** (environment variables, not in code)
3. **Implement proper error handling** with retries
4. **Respect rate limits** and implement backoff strategies
5. **Validate webhooks** using signatures when possible
6. **Use pagination** for large result sets
7. **Cache responses** when appropriate

### Performance Optimization
- Use appropriate `limit` values for pagination
- Filter results at the API level rather than client-side
- Use specific field selections when available
- Implement client-side caching for static data
- Batch multiple operations when possible

### Security Considerations
- Never expose JWT tokens in client-side code
- Use API keys for server-to-server communication
- Implement proper CORS policies
- Validate all inputs on both client and server
- Monitor for unusual API usage patterns

This completes the comprehensive API documentation for the NTIC Social Media Automation System. The API provides everything needed to build powerful integrations and automate social media workflows at scale.