const LinkedInClient = require('./linkedin');
const TwitterClient = require('./twitter');
const FacebookClient = require('./facebook');
const InstagramClient = require('./instagram');
const YouTubeClient = require('./youtube');
const TikTokClient = require('./tiktok');
const PinterestClient = require('./pinterest');
const UpworkClient = require('./upwork');
const FiverrClient = require('./fiverr');

class SocialMediaClients {
  constructor() {
    this.clients = {
      linkedin: new LinkedInClient(),
      twitter: new TwitterClient(),
      facebook: new FacebookClient(),
      instagram: new InstagramClient(),
      youtube: new YouTubeClient(),
      tiktok: new TikTokClient(),
      pinterest: new PinterestClient(),
      upwork: new UpworkClient(),
      fiverr: new FiverrClient()
    };
  }

  getClient(platform) {
    const client = this.clients[platform];
    if (!client) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return client;
  }

  async testAllConnections() {
    const results = {};
    
    for (const [platform, client] of Object.entries(this.clients)) {
      try {
        results[platform] = await client.isHealthy();
      } catch (error) {
        results[platform] = { 
          healthy: false, 
          error: error.message 
        };
      }
    }
    
    return results;
  }

  getSupportedPlatforms() {
    return Object.keys(this.clients);
  }
}

module.exports = new SocialMediaClients();