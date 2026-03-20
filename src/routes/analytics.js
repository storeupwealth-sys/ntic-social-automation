const express = require('express');
const Content = require('../models/Content');
const Platform = require('../models/Platform');
const Campaign = require('../models/Campaign');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/analytics/overview - Dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Content metrics
    const contentStats = await Content.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalContent: { $sum: 1 },
          publishedContent: {
            $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] }
          },
          scheduledContent: {
            $sum: { $cond: [{ $eq: ['$status', 'scheduled'] }, 1, 0] }
          },
          draftContent: {
            $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
          },
          failedContent: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Platform performance
    const platforms = await Platform.find({ isActive: true });
    const platformStats = platforms.map(platform => ({
      name: platform.name,
      isConnected: platform.connectionStatus.isConnected,
      totalPosts: platform.analytics.totalPosts || 0,
      totalEngagement: platform.analytics.totalEngagement || 0,
      averageEngagement: platform.analytics.averageEngagement || 0,
      lastUpdate: platform.analytics.lastAnalyticsUpdate
    }));

    // Engagement trends
    const engagementTrends = await Content.aggregate([
      {
        $match: {
          status: 'published',
          'platforms.postedAt': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $unwind: '$platforms'
      },
      {
        $match: {
          'platforms.posted': true,
          'platforms.postedAt': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$platforms.postedAt' } },
            platform: '$platforms.platform'
          },
          totalEngagement: {
            $sum: {
              $add: [
                { $ifNull: ['$platforms.engagement.likes', 0] },
                { $ifNull: ['$platforms.engagement.shares', 0] },
                { $ifNull: ['$platforms.engagement.comments', 0] }
              ]
            }
          },
          posts: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.date': 1 }
      }
    ]);

    // Top performing content
    const topContent = await Content.find({
      status: 'published',
      'platforms.postedAt': { $gte: startDate, $lte: endDate }
    })
    .sort({ 'analytics.totalEngagement': -1 })
    .limit(10)
    .select('title content platforms analytics createdAt');

    const stats = contentStats[0] || {
      totalContent: 0,
      publishedContent: 0,
      scheduledContent: 0,
      draftContent: 0,
      failedContent: 0
    };

    res.json({
      timeRange,
      period: { startDate, endDate },
      overview: {
        totalContent: stats.totalContent,
        publishedContent: stats.publishedContent,
        scheduledContent: stats.scheduledContent,
        draftContent: stats.draftContent,
        failedContent: stats.failedContent,
        publishSuccessRate: stats.totalContent > 0 ? 
          (stats.publishedContent / stats.totalContent) * 100 : 0
      },
      platforms: platformStats,
      engagementTrends,
      topContent
    });

  } catch (error) {
    logger.error('Error fetching analytics overview:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/analytics/platforms - Platform comparison
router.get('/platforms', async (req, res) => {
  try {
    const { timeRange = '30d' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
    }

    const platformAnalytics = await Content.aggregate([
      {
        $match: {
          status: 'published',
          'platforms.postedAt': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $unwind: '$platforms'
      },
      {
        $match: {
          'platforms.posted': true,
          'platforms.postedAt': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$platforms.platform',
          totalPosts: { $sum: 1 },
          totalLikes: { $sum: { $ifNull: ['$platforms.engagement.likes', 0] } },
          totalShares: { $sum: { $ifNull: ['$platforms.engagement.shares', 0] } },
          totalComments: { $sum: { $ifNull: ['$platforms.engagement.comments', 0] } },
          totalViews: { $sum: { $ifNull: ['$platforms.engagement.views', 0] } },
          totalClicks: { $sum: { $ifNull: ['$platforms.engagement.clicks', 0] } },
          errors: {
            $sum: { $cond: [{ $ne: ['$platforms.error', null] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          totalEngagement: { $add: ['$totalLikes', '$totalShares', '$totalComments'] },
          averageEngagement: {
            $cond: [
              { $gt: ['$totalPosts', 0] },
              { $divide: [{ $add: ['$totalLikes', '$totalShares', '$totalComments'] }, '$totalPosts'] },
              0
            ]
          },
          successRate: {
            $cond: [
              { $gt: ['$totalPosts', 0] },
              { $multiply: [{ $divide: [{ $subtract: ['$totalPosts', '$errors'] }, '$totalPosts'] }, 100] },
              0
            ]
          },
          engagementRate: {
            $cond: [
              { $gt: ['$totalViews', 0] },
              { $multiply: [{ $divide: ['$totalEngagement', '$totalViews'] }, 100] },
              0
            ]
          }
        }
      },
      {
        $sort: { totalEngagement: -1 }
      }
    ]);

    res.json({
      timeRange,
      platforms: platformAnalytics
    });

  } catch (error) {
    logger.error('Error fetching platform analytics:', error);
    res.status(500).json({ error: 'Failed to fetch platform analytics' });
  }
});

// GET /api/analytics/content - Content performance analysis
router.get('/content', async (req, res) => {
  try {
    const { 
      timeRange = '30d',
      platform,
      category,
      sortBy = 'engagement',
      limit = 50
    } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
    }

    // Build match criteria
    const matchCriteria = {
      status: 'published',
      'platforms.postedAt': { $gte: startDate, $lte: endDate }
    };

    if (category) {
      matchCriteria.category = category;
    }

    let pipeline = [
      { $match: matchCriteria },
      {
        $addFields: {
          totalEngagement: {
            $sum: {
              $map: {
                input: '$platforms',
                as: 'platform',
                in: {
                  $add: [
                    { $ifNull: ['$$platform.engagement.likes', 0] },
                    { $ifNull: ['$$platform.engagement.shares', 0] },
                    { $ifNull: ['$$platform.engagement.comments', 0] }
                  ]
                }
              }
            }
          },
          totalViews: {
            $sum: {
              $map: {
                input: '$platforms',
                as: 'platform',
                in: { $ifNull: ['$$platform.engagement.views', 0] }
              }
            }
          },
          totalClicks: {
            $sum: {
              $map: {
                input: '$platforms',
                as: 'platform',
                in: { $ifNull: ['$$platform.engagement.clicks', 0] }
              }
            }
          }
        }
      }
    ];

    // Filter by platform if specified
    if (platform) {
      pipeline.push({
        $match: {
          'platforms.platform': platform
        }
      });
    }

    // Sort and limit
    const sortOptions = {
      engagement: { totalEngagement: -1 },
      views: { totalViews: -1 },
      clicks: { totalClicks: -1 },
      recent: { createdAt: -1 }
    };

    pipeline.push(
      { $sort: sortOptions[sortBy] || sortOptions.engagement },
      { $limit: parseInt(limit) }
    );

    const contentAnalytics = await Content.aggregate(pipeline);

    // Calculate summary stats
    const summaryStats = await Content.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          totalContent: { $sum: 1 },
          avgEngagement: {
            $avg: {
              $sum: {
                $map: {
                  input: '$platforms',
                  as: 'platform',
                  in: {
                    $add: [
                      { $ifNull: ['$$platform.engagement.likes', 0] },
                      { $ifNull: ['$$platform.engagement.shares', 0] },
                      { $ifNull: ['$$platform.engagement.comments', 0] }
                    ]
                  }
                }
              }
            }
          },
          avgViews: {
            $avg: {
              $sum: {
                $map: {
                  input: '$platforms',
                  as: 'platform',
                  in: { $ifNull: ['$$platform.engagement.views', 0] }
                }
              }
            }
          }
        }
      }
    ]);

    res.json({
      timeRange,
      filters: { platform, category, sortBy },
      summary: summaryStats[0] || { totalContent: 0, avgEngagement: 0, avgViews: 0 },
      content: contentAnalytics
    });

  } catch (error) {
    logger.error('Error fetching content analytics:', error);
    res.status(500).json({ error: 'Failed to fetch content analytics' });
  }
});

// GET /api/analytics/campaigns - Campaign performance
router.get('/campaigns', async (req, res) => {
  try {
    const { status = 'all' } = req.query;

    // Build match criteria
    const matchCriteria = {};
    if (status !== 'all') {
      matchCriteria.status = status;
    }

    const campaigns = await Campaign.find(matchCriteria)
      .populate('content.contentId', 'title status analytics platforms')
      .sort({ createdAt: -1 });

    const campaignAnalytics = campaigns.map(campaign => {
      const content = campaign.content || [];
      const totalContent = content.length;
      const publishedContent = content.filter(c => c.contentId?.status === 'published').length;
      
      let totalEngagement = 0;
      let totalImpressions = 0;
      
      content.forEach(item => {
        if (item.contentId?.analytics) {
          totalEngagement += item.contentId.analytics.totalEngagement || 0;
          totalImpressions += item.contentId.analytics.totalReach || 0;
        }
      });

      const engagementRate = totalImpressions > 0 ? 
        (totalEngagement / totalImpressions) * 100 : 0;

      const roi = campaign.budget?.spent > 0 ? 
        ((campaign.analytics?.revenue || 0) - campaign.budget.spent) / campaign.budget.spent * 100 : 0;

      return {
        id: campaign._id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
        platforms: campaign.platforms,
        startDate: campaign.schedule?.startDate,
        endDate: campaign.schedule?.endDate,
        metrics: {
          totalContent,
          publishedContent,
          contentCompletionRate: totalContent > 0 ? (publishedContent / totalContent) * 100 : 0,
          totalEngagement,
          totalImpressions,
          engagementRate,
          budget: campaign.budget?.total || 0,
          spent: campaign.budget?.spent || 0,
          revenue: campaign.analytics?.revenue || 0,
          roi
        },
        goals: campaign.goals,
        performance: {
          impressions: {
            target: campaign.goals?.impressions || 0,
            actual: totalImpressions,
            percentage: campaign.goals?.impressions > 0 ? 
              (totalImpressions / campaign.goals.impressions) * 100 : 0
          },
          engagement: {
            target: campaign.goals?.engagement || 0,
            actual: totalEngagement,
            percentage: campaign.goals?.engagement > 0 ? 
              (totalEngagement / campaign.goals.engagement) * 100 : 0
          },
          revenue: {
            target: campaign.goals?.revenue || 0,
            actual: campaign.analytics?.revenue || 0,
            percentage: campaign.goals?.revenue > 0 ? 
              ((campaign.analytics?.revenue || 0) / campaign.goals.revenue) * 100 : 0
          }
        }
      };
    });

    res.json({
      campaigns: campaignAnalytics,
      summary: {
        total: campaigns.length,
        active: campaigns.filter(c => c.status === 'active').length,
        completed: campaigns.filter(c => c.status === 'completed').length,
        paused: campaigns.filter(c => c.status === 'paused').length
      }
    });

  } catch (error) {
    logger.error('Error fetching campaign analytics:', error);
    res.status(500).json({ error: 'Failed to fetch campaign analytics' });
  }
});

// GET /api/analytics/trends - Engagement and performance trends
router.get('/trends', async (req, res) => {
  try {
    const { 
      timeRange = '30d', 
      platform, 
      metric = 'engagement' 
    } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    let groupBy = '%Y-%m-%d';
    
    switch (timeRange) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      case '1y':
        startDate.setDate(endDate.getDate() - 365);
        groupBy = '%Y-%m'; // Group by month for year view
        break;
    }

    const matchCriteria = {
      status: 'published',
      'platforms.postedAt': { $gte: startDate, $lte: endDate }
    };

    let pipeline = [
      { $match: matchCriteria },
      { $unwind: '$platforms' },
      {
        $match: {
          'platforms.posted': true,
          'platforms.postedAt': { $gte: startDate, $lte: endDate }
        }
      }
    ];

    // Filter by platform if specified
    if (platform) {
      pipeline.push({
        $match: { 'platforms.platform': platform }
      });
    }

    pipeline.push(
      {
        $group: {
          _id: {
            date: { $dateToString: { format: groupBy, date: '$platforms.postedAt' } },
            ...(platform ? {} : { platform: '$platforms.platform' })
          },
          posts: { $sum: 1 },
          likes: { $sum: { $ifNull: ['$platforms.engagement.likes', 0] } },
          shares: { $sum: { $ifNull: ['$platforms.engagement.shares', 0] } },
          comments: { $sum: { $ifNull: ['$platforms.engagement.comments', 0] } },
          views: { $sum: { $ifNull: ['$platforms.engagement.views', 0] } },
          clicks: { $sum: { $ifNull: ['$platforms.engagement.clicks', 0] } }
        }
      },
      {
        $addFields: {
          engagement: { $add: ['$likes', '$shares', '$comments'] },
          engagementRate: {
            $cond: [
              { $gt: ['$views', 0] },
              { $multiply: [{ $divide: [{ $add: ['$likes', '$shares', '$comments'] }, '$views'] }, 100] },
              0
            ]
          }
        }
      },
      { $sort: { '_id.date': 1 } }
    );

    const trends = await Content.aggregate(pipeline);

    res.json({
      timeRange,
      metric,
      platform: platform || 'all',
      trends,
      period: { startDate, endDate }
    });

  } catch (error) {
    logger.error('Error fetching trends analytics:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// GET /api/analytics/export - Export analytics data
router.get('/export', async (req, res) => {
  try {
    const { 
      format = 'json', 
      type = 'overview',
      timeRange = '30d' 
    } = req.query;

    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ error: 'Format must be json or csv' });
    }

    let data;
    const timestamp = new Date().toISOString().split('T')[0];

    switch (type) {
      case 'overview':
        data = await getOverviewData(timeRange);
        break;
      case 'content':
        data = await getContentData(timeRange);
        break;
      case 'platforms':
        data = await getPlatformData(timeRange);
        break;
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    if (format === 'csv') {
      const csv = convertToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=ntic-${type}-${timestamp}.csv`);
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=ntic-${type}-${timestamp}.json`);
      res.json(data);
    }

  } catch (error) {
    logger.error('Error exporting analytics:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Helper functions for export
async function getOverviewData(timeRange) {
  // Implementation similar to overview endpoint
  return { message: 'Overview data export' };
}

async function getContentData(timeRange) {
  // Implementation similar to content endpoint
  return { message: 'Content data export' };
}

async function getPlatformData(timeRange) {
  // Implementation similar to platforms endpoint
  return { message: 'Platform data export' };
}

function convertToCSV(data) {
  if (!Array.isArray(data)) {
    data = [data];
  }
  
  if (data.length === 0) {
    return '';
  }

  const headers = Object.keys(data[0]);
  const csvRows = [headers.join(',')];

  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
    });
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}

module.exports = router;