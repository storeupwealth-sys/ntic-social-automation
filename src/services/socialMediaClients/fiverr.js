const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

class FiverrClient {
  constructor() {
    this.baseURL = 'https://www.fiverr.com';
    this.name = 'fiverr';
    this.browser = null;
    this.page = null;
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: process.env.NODE_ENV === 'production',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.page = await this.browser.newPage();
      
      // Set realistic user agent
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    }
    return this.page;
  }

  async testConnection(credentials) {
    try {
      const page = await this.initBrowser();
      
      // Navigate to Fiverr login
      await page.goto('https://www.fiverr.com/login', {
        waitUntil: 'networkidle2'
      });

      // Login with credentials
      await page.type('input[name="username"]', credentials.username);
      await page.type('input[name="password"]', credentials.password);
      await page.click('button[type="submit"]');
      
      // Wait for redirect
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
      
      const currentUrl = page.url();
      if (currentUrl.includes('/dashboard') || currentUrl === 'https://www.fiverr.com/') {
        return {
          connected: true,
          profile: {
            username: credentials.username,
            loginUrl: currentUrl
          }
        };
      } else {
        throw new Error('Login failed - redirected to unexpected page');
      }

    } catch (error) {
      logger.error('Fiverr connection test failed:', error.message);
      throw new Error('Failed to connect to Fiverr: ' + error.message);
    }
  }

  async searchBuyerRequests(credentials, keywords = [], filters = {}) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to buyer requests
      await page.goto('https://www.fiverr.com/requests', { waitUntil: 'networkidle2' });
      
      // Apply keyword filter if provided
      if (keywords.length > 0) {
        const searchInput = await page.$('input[placeholder*="Search"]');
        if (searchInput) {
          await searchInput.type(keywords[0]);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(2000);
        }
      }
      
      // Extract buyer requests
      const requests = await page.evaluate(() => {
        const requestCards = document.querySelectorAll('[data-qa="request-card"]');
        return Array.from(requestCards).map(card => {
          const titleEl = card.querySelector('[data-qa="request-title"]');
          const descriptionEl = card.querySelector('[data-qa="request-description"]');
          const budgetEl = card.querySelector('[data-qa="request-budget"]');
          const timeEl = card.querySelector('[data-qa="request-delivery-time"]');
          const categoryEl = card.querySelector('[data-qa="request-category"]');
          const offersEl = card.querySelector('[data-qa="request-offers"]');
          const linkEl = card.querySelector('a[href*="/requests/"]');
          
          return {
            title: titleEl?.textContent?.trim(),
            description: descriptionEl?.textContent?.trim(),
            budget: budgetEl?.textContent?.trim(),
            deliveryTime: timeEl?.textContent?.trim(),
            category: categoryEl?.textContent?.trim(),
            offers: offersEl?.textContent?.trim(),
            url: linkEl?.href,
            id: linkEl?.href?.match(/\/requests\/([^\/]+)/)?.[1]
          };
        });
      });
      
      return requests.filter(req => req.title && req.url);
      
    } catch (error) {
      logger.error('Fiverr buyer requests search failed:', error.message);
      return [];
    }
  }

  async submitOffer(credentials, requestId, offer) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to specific request
      const requestUrl = `https://www.fiverr.com/requests/${requestId}`;
      await page.goto(requestUrl, { waitUntil: 'networkidle2' });
      
      // Check if "Send Offer" button exists
      const offerButton = await page.$('[data-qa="send-offer-button"]');
      if (!offerButton) {
        throw new Error('Cannot send offer to this request');
      }
      
      await offerButton.click();
      await page.waitForSelector('[data-qa="offer-description"]', { timeout: 5000 });
      
      // Fill in offer details
      await page.type('[data-qa="offer-description"]', offer.description);
      await page.type('[data-qa="offer-price"]', offer.price.toString());
      await page.select('[data-qa="offer-delivery"]', offer.deliveryDays.toString());
      
      // Submit offer (in dry-run mode for safety)
      if (offer.submit === true && process.env.FIVERR_AUTO_SUBMIT === 'true') {
        const submitButton = await page.$('[data-qa="submit-offer"]');
        await submitButton?.click();
        
        // Wait for confirmation
        await page.waitForSelector('[data-qa="offer-sent"]', { timeout: 10000 });
        
        return {
          success: true,
          requestId,
          message: 'Offer submitted successfully'
        };
      } else {
        return {
          success: true,
          requestId,
          message: 'Offer prepared (dry-run mode)',
          dryRun: true
        };
      }
      
    } catch (error) {
      logger.error('Fiverr offer submission failed:', error.message);
      throw new Error('Failed to submit offer: ' + error.message);
    }
  }

  async generateOffer(requestDetails, templates = {}) {
    try {
      const {
        title,
        description,
        budget,
        deliveryTime,
        category
      } = requestDetails;
      
      // Extract budget amount
      let budgetAmount = 50; // default
      const budgetMatch = budget?.match(/\$(\d+)/);
      if (budgetMatch) {
        budgetAmount = parseInt(budgetMatch[1]);
      }
      
      // Extract delivery days
      let deliveryDays = 3; // default
      const deliveryMatch = deliveryTime?.match(/(\d+)\s*day/i);
      if (deliveryMatch) {
        deliveryDays = parseInt(deliveryMatch[1]);
      }
      
      const template = templates.default || `
Hi there!

I've carefully reviewed your request for "${title}" and I'm excited to help you achieve your goals.

**Why choose me?**
✅ Expert in ${category || 'this field'} with proven track record
✅ High-quality work delivered on time, every time
✅ 100% satisfaction guarantee with unlimited revisions
✅ Fast communication and professional service

**What you'll get:**
• Custom solution tailored to your specific needs
• Professional quality work that exceeds expectations
• Complete source files and documentation
• Ongoing support even after delivery

**My process:**
1. Detailed consultation to understand your requirements
2. Custom strategy development
3. Implementation with regular updates
4. Quality assurance and testing
5. Final delivery with documentation

I can deliver this project within ${deliveryDays} days at a competitive price of $${budgetAmount}.

Ready to get started? Click "Accept" and let's create something amazing together!

Best regards,
[Your Name]
      `.trim();
      
      let customOffer = template
        .replace(/\[Your Name\]/g, process.env.FIVERR_PROFILE_NAME || 'NTIC Team')
        .replace('${title}', title)
        .replace(/\${category \|\| 'this field'}/g, category || 'this field')
        .replace('${deliveryDays}', deliveryDays.toString())
        .replace('${budgetAmount}', budgetAmount.toString());
      
      return {
        description: customOffer,
        price: Math.min(budgetAmount, budgetAmount * 0.9), // Competitive pricing
        deliveryDays: Math.max(deliveryDays, 1),
        revisions: 3
      };
      
    } catch (error) {
      logger.error('Offer generation failed:', error.message);
      throw new Error('Failed to generate offer');
    }
  }

  async autoSendOffers(credentials, criteria = {}) {
    try {
      const {
        keywords = [],
        maxOffers = 5,
        minBudget = 25,
        categories = []
      } = criteria;
      
      const offers = [];
      
      // Search for relevant buyer requests
      const requests = await this.searchBuyerRequests(credentials, keywords);
      
      for (const request of requests.slice(0, maxOffers)) {
        try {
          // Filter by budget
          const budgetMatch = request.budget?.match(/\$(\d+)/);
          if (budgetMatch && parseInt(budgetMatch[1]) < minBudget) {
            continue;
          }
          
          // Filter by category if specified
          if (categories.length > 0 && !categories.includes(request.category)) {
            continue;
          }
          
          // Generate offer
          const offer = await this.generateOffer({
            title: request.title,
            description: request.description,
            budget: request.budget,
            deliveryTime: request.deliveryTime,
            category: request.category
          });
          
          // Submit offer
          const result = await this.submitOffer(credentials, request.id, {
            ...offer,
            submit: criteria.autoSubmit === true
          });
          
          offers.push({
            requestId: request.id,
            requestTitle: request.title,
            result
          });
          
          // Rate limiting - wait between offers
          await new Promise(resolve => setTimeout(resolve, 3000));
          
        } catch (offerError) {
          logger.warn(`Failed to send offer to request ${request.id}:`, offerError.message);
        }
      }
      
      return {
        success: true,
        offersSent: offers.length,
        offers
      };
      
    } catch (error) {
      logger.error('Fiverr auto-send offers failed:', error.message);
      throw new Error('Auto-send offers failed: ' + error.message);
    }
  }

  async ensureLoggedIn(credentials, page) {
    const currentUrl = page.url();
    
    if (!currentUrl.includes('fiverr.com') || currentUrl.includes('/login')) {
      await page.goto('https://www.fiverr.com/login');
      await page.type('input[name="username"]', credentials.username);
      await page.type('input[name="password"]', credentials.password);
      await page.click('button[type="submit"]');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to seller dashboard
      await page.goto('https://www.fiverr.com/seller_dashboard', { waitUntil: 'networkidle2' });
      
      // Extract basic stats
      const stats = await page.evaluate(() => {
        const elements = {
          totalOffers: document.querySelector('[data-qa="total-offers"]')?.textContent?.trim(),
          responseRate: document.querySelector('[data-qa="response-rate"]')?.textContent?.trim(),
          orderCompletion: document.querySelector('[data-qa="order-completion"]')?.textContent?.trim(),
          totalEarnings: document.querySelector('[data-qa="total-earnings"]')?.textContent?.trim()
        };
        
        return {
          totalOffers: elements.totalOffers || '0',
          responseRate: elements.responseRate || '0%',
          orderCompletion: elements.orderCompletion || '0%',
          totalEarnings: elements.totalEarnings || '$0'
        };
      });
      
      return stats;
      
    } catch (error) {
      logger.error('Fiverr analytics failed:', error.message);
      return {
        totalOffers: '0',
        responseRate: '0%',
        orderCompletion: '0%',
        totalEarnings: '$0'
      };
    }
  }

  async manageGigs(credentials, action, gigData = {}) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      switch (action) {
        case 'list':
          await page.goto('https://www.fiverr.com/manage_gigs', { waitUntil: 'networkidle2' });
          
          const gigs = await page.evaluate(() => {
            const gigElements = document.querySelectorAll('[data-qa="gig-card"]');
            return Array.from(gigElements).map(gig => {
              const titleEl = gig.querySelector('[data-qa="gig-title"]');
              const statusEl = gig.querySelector('[data-qa="gig-status"]');
              const ordersEl = gig.querySelector('[data-qa="gig-orders"]');
              const priceEl = gig.querySelector('[data-qa="gig-price"]');
              
              return {
                title: titleEl?.textContent?.trim(),
                status: statusEl?.textContent?.trim(),
                orders: ordersEl?.textContent?.trim(),
                price: priceEl?.textContent?.trim()
              };
            });
          });
          
          return { success: true, gigs };
          
        case 'create':
          // Navigate to gig creation page
          await page.goto('https://www.fiverr.com/gigs/new', { waitUntil: 'networkidle2' });
          
          // Fill in gig details (basic implementation)
          if (gigData.title) {
            await page.type('[data-qa="gig-title"]', gigData.title);
          }
          
          if (gigData.description) {
            await page.type('[data-qa="gig-description"]', gigData.description);
          }
          
          return { 
            success: true, 
            message: 'Gig creation initiated (manual completion required)',
            dryRun: true 
          };
          
        default:
          throw new Error('Unsupported gig action: ' + action);
      }
      
    } catch (error) {
      logger.error('Fiverr gig management failed:', error.message);
      throw new Error('Gig management failed: ' + error.message);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async isHealthy() {
    return {
      healthy: true,
      platform: this.name,
      features: [
        'buyer_requests_search',
        'offer_generation',
        'auto_send_offers',
        'gig_management',
        'analytics'
      ],
      note: 'Requires browser automation due to API limitations'
    };
  }

  getRateLimits() {
    return {
      offers: { limit: 10, window: '1d' },
      search: { limit: 50, window: '1h' },
      gigs: { limit: 5, window: '1d' }
    };
  }
}

module.exports = FiverrClient;