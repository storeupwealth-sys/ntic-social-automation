const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const logger = require('../../utils/logger');

class UpworkClient {
  constructor() {
    this.baseURL = 'https://www.upwork.com/api';
    this.name = 'upwork';
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
      
      // Navigate to Upwork login
      await page.goto('https://www.upwork.com/ab/account-security/login', {
        waitUntil: 'networkidle2'
      });

      // Login with credentials
      await page.type('#login_username', credentials.username);
      await page.type('#login_password', credentials.password);
      await page.click('#login_control_continue');
      
      // Wait for redirect and check if logged in
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
      
      const currentUrl = page.url();
      if (currentUrl.includes('/nx/find-work')) {
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
      logger.error('Upwork connection test failed:', error.message);
      throw new Error('Failed to connect to Upwork: ' + error.message);
    }
  }

  async searchJobs(credentials, query, filters = {}) {
    try {
      const page = await this.initBrowser();
      
      // Ensure we're logged in
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to job search
      const searchUrl = `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2' });
      
      // Apply filters if provided
      if (filters.jobType) {
        await page.click(`[data-test="job-type-${filters.jobType}"]`);
      }
      
      if (filters.experienceLevel) {
        await page.click(`[data-test="experience-level-${filters.experienceLevel}"]`);
      }
      
      // Wait for results to load
      await page.waitForSelector('[data-test="job-tile"]', { timeout: 10000 });
      
      // Extract job listings
      const jobs = await page.evaluate(() => {
        const jobTiles = document.querySelectorAll('[data-test="job-tile"]');
        return Array.from(jobTiles).slice(0, 20).map(tile => {
          const titleEl = tile.querySelector('[data-test="job-title"] a');
          const descriptionEl = tile.querySelector('[data-test="job-description"]');
          const budgetEl = tile.querySelector('[data-test="budget"]');
          const skillsEl = tile.querySelectorAll('[data-test="token-skill"]');
          const postedEl = tile.querySelector('[data-test="posted-on"]');
          
          return {
            title: titleEl?.textContent?.trim(),
            url: titleEl?.href,
            description: descriptionEl?.textContent?.trim(),
            budget: budgetEl?.textContent?.trim(),
            skills: Array.from(skillsEl).map(el => el.textContent?.trim()),
            posted: postedEl?.textContent?.trim(),
            id: titleEl?.href?.match(/~([a-f0-9]+)/)?.[1]
          };
        });
      });
      
      return jobs.filter(job => job.title && job.url);
      
    } catch (error) {
      logger.error('Upwork job search failed:', error.message);
      return [];
    }
  }

  async submitProposal(credentials, jobId, proposal) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to job page
      const jobUrl = `https://www.upwork.com/jobs/~${jobId}`;
      await page.goto(jobUrl, { waitUntil: 'networkidle2' });
      
      // Check if "Apply Now" button exists
      const applyButton = await page.$('[data-test="apply-button"]');
      if (!applyButton) {
        throw new Error('Cannot apply to this job - button not found');
      }
      
      await applyButton.click();
      await page.waitForSelector('[data-test="cover-letter"]', { timeout: 5000 });
      
      // Fill in proposal details
      await page.type('[data-test="cover-letter"]', proposal.coverLetter);
      
      if (proposal.bidAmount) {
        await page.type('[data-test="bid-amount"]', proposal.bidAmount.toString());
      }
      
      if (proposal.timeline) {
        await page.type('[data-test="timeline"]', proposal.timeline);
      }
      
      // Submit proposal (in dry-run mode for safety)
      if (proposal.submit === true && process.env.UPWORK_AUTO_SUBMIT === 'true') {
        const submitButton = await page.$('[data-test="submit-proposal"]');
        await submitButton?.click();
        
        // Wait for confirmation
        await page.waitForSelector('[data-test="proposal-submitted"]', { timeout: 10000 });
        
        return {
          success: true,
          jobId,
          message: 'Proposal submitted successfully'
        };
      } else {
        return {
          success: true,
          jobId,
          message: 'Proposal prepared (dry-run mode)',
          dryRun: true
        };
      }
      
    } catch (error) {
      logger.error('Upwork proposal submission failed:', error.message);
      throw new Error('Failed to submit proposal: ' + error.message);
    }
  }

  async generateProposal(jobDetails, templates = {}) {
    try {
      const {
        title,
        description,
        budget,
        skills = [],
        requirements = []
      } = jobDetails;
      
      // AI-powered proposal generation (simplified version)
      const template = templates.default || `
Dear Client,

I hope this message finds you well. I'm excited to submit my proposal for your "${title}" project.

After reviewing your requirements, I understand you're looking for:
${requirements.slice(0, 3).map(req => `• ${req}`).join('\n')}

Here's why I'm the perfect fit for this project:

✅ **Relevant Experience**: I have extensive experience in ${skills.slice(0, 3).join(', ')}, which aligns perfectly with your needs.

✅ **Quality Delivery**: I focus on delivering high-quality work that exceeds expectations and drives real results.

✅ **Clear Communication**: I believe in transparent communication and will provide regular updates throughout the project.

**My Approach:**
1. Initial consultation to fully understand your requirements
2. Detailed project planning and timeline development  
3. Regular progress updates and feedback incorporation
4. Quality assurance and testing before final delivery

I'm confident I can deliver exceptional results for your project. I'd love to discuss your vision in more detail and answer any questions you might have.

Looking forward to the opportunity to work together!

Best regards,
[Your Name]

P.S. I'm available to start immediately and can accommodate your timezone for seamless communication.
      `.trim();
      
      // Customize template with job-specific details
      let customProposal = template
        .replace(/\[Your Name\]/g, process.env.UPWORK_PROFILE_NAME || 'NTIC Team')
        .replace('${title}', title)
        .replace(/\${requirements\.slice\(0, 3\)\.map\(req => `• \${req}`\)\.join\('\\n'\)}/g, 
          requirements.slice(0, 3).map(req => `• ${req}`).join('\n'))
        .replace(/\${skills\.slice\(0, 3\)\.join\(', '\)}/g, skills.slice(0, 3).join(', '));
      
      // Calculate bid amount (if budget provided)
      let bidAmount = null;
      if (budget) {
        const budgetMatch = budget.match(/\$(\d+(?:,\d+)*)/);
        if (budgetMatch) {
          const budgetValue = parseInt(budgetMatch[1].replace(/,/g, ''));
          bidAmount = Math.floor(budgetValue * 0.85); // Bid 15% below budget
        }
      }
      
      return {
        coverLetter: customProposal,
        bidAmount,
        timeline: '1-2 weeks',
        attachments: []
      };
      
    } catch (error) {
      logger.error('Proposal generation failed:', error.message);
      throw new Error('Failed to generate proposal');
    }
  }

  async autoApply(credentials, criteria = {}) {
    try {
      const {
        keywords = [],
        maxApplications = 5,
        budgetMin = 500,
        experienceLevel = 'intermediate'
      } = criteria;
      
      const applications = [];
      
      for (const keyword of keywords) {
        if (applications.length >= maxApplications) break;
        
        // Search for jobs
        const jobs = await this.searchJobs(credentials, keyword, {
          experienceLevel,
          budgetMin
        });
        
        for (const job of jobs.slice(0, 3)) {
          if (applications.length >= maxApplications) break;
          
          try {
            // Generate proposal
            const proposal = await this.generateProposal({
              title: job.title,
              description: job.description,
              budget: job.budget,
              skills: job.skills
            });
            
            // Submit proposal
            const result = await this.submitProposal(credentials, job.id, {
              ...proposal,
              submit: criteria.autoSubmit === true
            });
            
            applications.push({
              jobId: job.id,
              jobTitle: job.title,
              result
            });
            
            // Rate limiting - wait between applications
            await new Promise(resolve => setTimeout(resolve, 2000));
            
          } catch (applicationError) {
            logger.warn(`Failed to apply to job ${job.id}:`, applicationError.message);
          }
        }
      }
      
      return {
        success: true,
        applicationsSubmitted: applications.length,
        applications
      };
      
    } catch (error) {
      logger.error('Upwork auto-apply failed:', error.message);
      throw new Error('Auto-apply failed: ' + error.message);
    }
  }

  async ensureLoggedIn(credentials, page) {
    const currentUrl = page.url();
    
    if (!currentUrl.includes('upwork.com') || currentUrl.includes('/login')) {
      await page.goto('https://www.upwork.com/ab/account-security/login');
      await page.type('#login_username', credentials.username);
      await page.type('#login_password', credentials.password);
      await page.click('#login_control_continue');
      await page.waitForNavigation({ waitUntil: 'networkidle2' });
    }
  }

  async getAnalytics(credentials, options = {}) {
    try {
      const page = await this.initBrowser();
      await this.ensureLoggedIn(credentials, page);
      
      // Navigate to reports/stats page
      await page.goto('https://www.upwork.com/nx/reports/', { waitUntil: 'networkidle2' });
      
      // Extract basic stats
      const stats = await page.evaluate(() => {
        return {
          totalApplications: 0, // Would extract from DOM
          responseRate: '0%',
          hireRate: '0%',
          totalEarnings: '$0'
        };
      });
      
      return stats;
      
    } catch (error) {
      logger.error('Upwork analytics failed:', error.message);
      return {
        totalApplications: 0,
        responseRate: '0%',
        hireRate: '0%',
        totalEarnings: '$0'
      };
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
        'job_search',
        'proposal_generation',
        'auto_apply',
        'analytics'
      ],
      note: 'Requires browser automation due to API limitations'
    };
  }

  getRateLimits() {
    return {
      applications: { limit: 10, window: '1d' },
      search: { limit: 100, window: '1h' },
      proposals: { limit: 5, window: '1h' }
    };
  }
}

module.exports = UpworkClient;