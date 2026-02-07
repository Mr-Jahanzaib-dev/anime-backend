// ==================== ENVIRONMENT SETUP ====================
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('⚠️  SSL verification disabled (DEVELOPMENT ONLY)');
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL 
    : '*',
  credentials: true
}));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ==================== CONFIGURATION ====================
const DEAD_ANIME_BASE = 'https://api.deadbase.host/api/v2';

// HTTPS agent configuration
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV !== 'development',
  timeout: 20000
});

// ==================== UTILITY FUNCTIONS ====================

// Enhanced proxy function with better error handling
const proxyToDeadAnime = async (endpoint, queryParams = {}) => {
  const maxRetries = 2;
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Clean and build query string
      const cleanParams = Object.entries(queryParams)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});
      
      const queryString = new URLSearchParams(cleanParams).toString();
      const url = `${DEAD_ANIME_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;
      
      console.log(`🔄 [Attempt ${attempt + 1}/${maxRetries + 1}] Proxying to:`, url);
      
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 20000,
        httpsAgent: httpsAgent,
        validateStatus: (status) => status < 500 // Don't throw on 4xx
      });
      
      // Check for valid response
      if (response.status >= 400) {
        throw new Error(`API returned status ${response.status}`);
      }
      
      console.log(`✅ Success! Status: ${response.status}`);
      return response.data;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);
      
      // Don't retry on client errors (4xx)
      if (error.response && error.response.status < 500) {
        break;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`⏳ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // All retries failed
  throw lastError || new Error('Request failed after retries');
};

// Validate and sanitize query parameters
const sanitizeParams = (params) => {
  const sanitized = {};
  
  if (params.search) sanitized.search = params.search.toString().trim();
  if (params.slug) sanitized.slug = params.slug.toString().trim();
  if (params.season) sanitized.season = parseInt(params.season) || 1;
  if (params.episode) sanitized.episode = parseInt(params.episode) || 1;
  if (params.season_id) sanitized.season_id = params.season_id.toString();
  if (params.start_ep) sanitized.start_ep = parseInt(params.start_ep) || 1;
  if (params.end_ep) sanitized.end_ep = parseInt(params.end_ep) || 100;
  if (params.limit) sanitized.limit = Math.min(parseInt(params.limit) || 12, 100);
  if (params.page) sanitized.page = Math.max(parseInt(params.page) || 1, 1);
  
  return sanitized;
};

// ==================== HEALTH CHECK ====================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'API server is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: '🚀 Anime API Server',
    status: 'running',
    version: '2.0.0',
    endpoints: {
      health: '/api/health',
      deadanime: {
        list: '/api/deadanime/list',
        anime: '/api/deadanime/anime',
        episode: '/api/deadanime/episode',
        movie: '/api/deadanime/movie',
        pack: '/api/deadanime/pack'
      }
    }
  });
});

// ==================== DEAD ANIME API ROUTES ====================

// List endpoint - Get anime list with optional search
app.get('/api/deadanime/list', async (req, res) => {
  try {
    const params = sanitizeParams(req.query);
    console.log('📋 Fetching anime list with params:', params);
    
    const data = await proxyToDeadAnime('/list', params);
    
    res.json(data);
  } catch (error) {
    console.error('❌ List endpoint error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch anime list',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Anime info endpoint - Get detailed anime information
app.get('/api/deadanime/anime', async (req, res) => {
  try {
    const { slug } = req.query;
    
    if (!slug) {
      return res.status(400).json({ 
        error: 'Missing required parameter: slug' 
      });
    }
    
    const params = sanitizeParams(req.query);
    console.log('📺 Fetching anime info for:', slug);
    
    const data = await proxyToDeadAnime('/anime', params);
    
    res.json(data);
  } catch (error) {
    console.error('❌ Anime info error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch anime information',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Episode endpoint - Get episode streaming links
app.get('/api/deadanime/episode', async (req, res) => {
  try {
    const { slug, season, episode } = req.query;
    
    if (!slug) {
      return res.status(400).json({ 
        error: 'Missing required parameter: slug' 
      });
    }
    
    const params = sanitizeParams(req.query);
    console.log(`🎬 Fetching episode: ${slug} S${params.season}E${params.episode}`);
    
    const data = await proxyToDeadAnime('/episode', params);
    
    // Validate response has sources
    const episodeData = data.data || data;
    const hasSources = episodeData.sources?.length > 0 || episodeData.url;
    
    if (!hasSources) {
      console.warn('⚠️ No streaming sources found for episode');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Episode endpoint error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch episode links',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Movie endpoint - Get movie streaming links
app.get('/api/deadanime/movie', async (req, res) => {
  try {
    const { slug } = req.query;
    
    if (!slug) {
      return res.status(400).json({ 
        error: 'Missing required parameter: slug' 
      });
    }
    
    const params = sanitizeParams(req.query);
    console.log('🎬 Fetching movie:', slug);
    
    const data = await proxyToDeadAnime('/movie', params);
    
    // Validate response has sources
    const movieData = data.data || data;
    const hasSources = movieData.sources?.length > 0 || 
                       movieData.url || 
                       movieData.video_url;
    
    if (!hasSources) {
      console.warn('⚠️ No streaming sources found for movie');
    }
    
    res.json(data);
  } catch (error) {
    console.error('❌ Movie endpoint error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch movie links',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Pack endpoint - Get episode pack/batch
app.get('/api/deadanime/pack', async (req, res) => {
  try {
    const { season_id } = req.query;
    
    if (!season_id) {
      return res.status(400).json({ 
        error: 'Missing required parameter: season_id' 
      });
    }
    
    const params = sanitizeParams(req.query);
    console.log('📦 Fetching episode pack for season:', season_id);
    
    const data = await proxyToDeadAnime('/pack', params);
    
    res.json(data);
  } catch (error) {
    console.error('❌ Pack endpoint error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: 'Failed to fetch episode pack',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== STATS ENDPOINT ====================
app.get('/api/stats', async (req, res) => {
  try {
    console.log('📊 Fetching API statistics');
    
    const data = await proxyToDeadAnime('/list', { limit: 100 });
    const animeList = Array.isArray(data) ? data : 
                      data.data?.results || data.data || data.results || [];
    
    const stats = {
      total_anime: animeList.length,
      total_movies: animeList.filter(a => a.type === 'movie').length,
      total_series: animeList.filter(a => a.type !== 'movie').length,
      timestamp: new Date().toISOString()
    };
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Stats endpoint error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      message: error.message 
    });
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Server Error:', err);
  
  res.status(err.status || 500).json({ 
    error: 'Internal server error', 
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    timestamp: new Date().toISOString()
  });
});

// ==================== SERVER START ====================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ANIME API SERVER v2.0                                   ║
║                                                               ║
║   Port:        ${PORT.toString().padEnd(48)}║
║   Status:      ✅ ONLINE                                      ║
║   Environment: ${(process.env.NODE_ENV || 'development').toUpperCase().padEnd(48)}║
║   SSL:         ${(process.env.NODE_ENV === 'development' ? '⚠️  DISABLED (Dev Only)' : '✅ ENABLED').padEnd(48)}║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

📡 Dead Anime API Endpoints:
   
   GET  /api/deadanime/list         - Get anime list
        ?search=naruto              - Search anime
        &limit=12                   - Results per page
        &page=1                     - Page number
   
   GET  /api/deadanime/anime        - Get anime details
        ?slug=naruto-shippuden      - Anime slug (required)
   
   GET  /api/deadanime/episode      - Get episode links
        ?slug=naruto-shippuden      - Anime slug (required)
        &season=1                   - Season number
        &episode=1                  - Episode number
   
   GET  /api/deadanime/movie        - Get movie links
        ?slug=demon-slayer-movie    - Movie slug (required)
   
   GET  /api/deadanime/pack         - Get episode pack
        ?season_id=123              - Season ID (required)
        &start_ep=1                 - Start episode
        &end_ep=100                 - End episode

📊 Utility Endpoints:
   
   GET  /api/health                 - Health check
   GET  /api/stats                  - API statistics

════════════════════════════════════════════════════════════════

🌐 Server URL: http://localhost:${PORT}
📝 Request logging enabled
🔧 Ready to handle requests!

════════════════════════════════════════════════════════════════
    `);
  });
}

// ==================== EXPORT ====================
module.exports = app;