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
const DEAD_ANIME_BASE = process.env.DEAD_ANIME_BASE || 'https://api.deadbase.host/api/v2';

// HTTPS agent — rejectUnauthorized reads the env var AT RUNTIME (not at module load)
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV !== 'development',
  timeout: 20000,
  keepAlive: true,
});

// ==================== UTILITY FUNCTIONS ====================

/**
 * Proxy a GET request to the Dead Anime API with retry/backoff.
 * @param {string} endpoint  e.g. '/list'
 * @param {object} queryParams  already-sanitized key/value pairs
 */
const proxyToDeadAnime = async (endpoint, queryParams = {}) => {
  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Remove empty / null / undefined values before building the URL
      const cleanParams = Object.fromEntries(
        Object.entries(queryParams).filter(
          ([, v]) => v !== undefined && v !== null && v !== ''
        )
      );

      const queryString = new URLSearchParams(cleanParams).toString();
      const url = `${DEAD_ANIME_BASE}${endpoint}${queryString ? '?' + queryString : ''}`;

      console.log(`🔄 [Attempt ${attempt + 1}/${maxRetries + 1}] Proxying to: ${url}`);

      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 20000,
        httpsAgent,
        // Treat anything below 500 as a resolved response so we can inspect the body
        validateStatus: (status) => status < 500,
      });

      if (response.status >= 400) {
        const err = new Error(`Upstream API returned ${response.status}`);
        err.response = response;
        throw err;
      }

      console.log(`✅ Success! Status: ${response.status}`);
      return response.data;
    } catch (error) {
      lastError = error;
      console.error(`❌ Attempt ${attempt + 1} failed: ${error.message}`);

      // Do not retry on 4xx — it won't help
      if (error.response && error.response.status < 500) break;

      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`⏳ Waiting ${delay}ms before retry…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error('Request failed after all retries');
};

/**
 * Validate and coerce incoming query-string parameters.
 * Only fields present in `params` are included in the result.
 */
const sanitizeParams = (params) => {
  const s = {};

  if (params.search)     s.search     = String(params.search).trim().slice(0, 200);
  if (params.slug)       s.slug       = String(params.slug).trim();
  if (params.season)     s.season     = Math.max(1, parseInt(params.season)  || 1);
  if (params.episode)    s.episode    = Math.max(1, parseInt(params.episode) || 1);
  if (params.season_id)  s.season_id  = String(params.season_id);
  if (params.start_ep)   s.start_ep   = Math.max(1, parseInt(params.start_ep) || 1);
  if (params.end_ep)     s.end_ep     = Math.min(10000, parseInt(params.end_ep) || 100);
  if (params.limit)      s.limit      = Math.min(100, Math.max(1, parseInt(params.limit) || 12));
  if (params.page)       s.page       = Math.max(1, parseInt(params.page) || 1);

  return s;
};

// ==================== HEALTH CHECK ====================
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'API server is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.json({
    message: '🚀 Anime API Server',
    status: 'running',
    version: '2.1.0',
    endpoints: {
      health: '/api/health',
      stats: '/api/stats',
      deadanime: {
        list: '/api/deadanime/list',
        anime: '/api/deadanime/anime',
        episode: '/api/deadanime/episode',
        movie: '/api/deadanime/movie',
        pack: '/api/deadanime/pack',
      },
    },
  });
});

// ==================== DEAD ANIME API ROUTES ====================

// GET /api/deadanime/list
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
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/deadanime/anime?slug=<slug>
app.get('/api/deadanime/anime', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'Missing required parameter: slug' });

    const params = sanitizeParams(req.query);
    console.log('📺 Fetching anime info for:', slug);
    const data = await proxyToDeadAnime('/anime', params);
    res.json(data);
  } catch (error) {
    console.error('❌ Anime info error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch anime information',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/deadanime/episode?slug=<slug>&season=1&episode=1
app.get('/api/deadanime/episode', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'Missing required parameter: slug' });

    const params = sanitizeParams(req.query);
    console.log(`🎬 Fetching episode: ${slug} S${params.season ?? 1}E${params.episode ?? 1}`);

    const data = await proxyToDeadAnime('/episode', params);

    const episodeData = data.data ?? data;
    if (!episodeData.sources?.length && !episodeData.url) {
      console.warn('⚠️ No streaming sources found for episode');
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Episode endpoint error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch episode links',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/deadanime/movie?slug=<slug>
app.get('/api/deadanime/movie', async (req, res) => {
  try {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'Missing required parameter: slug' });

    const params = sanitizeParams(req.query);
    console.log('🎬 Fetching movie:', slug);

    const data = await proxyToDeadAnime('/movie', params);

    const movieData = data.data ?? data;
    if (!movieData.sources?.length && !movieData.url && !movieData.video_url) {
      console.warn('⚠️ No streaming sources found for movie');
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Movie endpoint error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch movie links',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// GET /api/deadanime/pack?season_id=<id>&start_ep=1&end_ep=100
app.get('/api/deadanime/pack', async (req, res) => {
  try {
    const { season_id } = req.query;
    if (!season_id) return res.status(400).json({ error: 'Missing required parameter: season_id' });

    const params = sanitizeParams(req.query);
    console.log('📦 Fetching episode pack for season:', season_id);
    const data = await proxyToDeadAnime('/pack', params);
    res.json(data);
  } catch (error) {
    console.error('❌ Pack endpoint error:', error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch episode pack',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ==================== STATS ENDPOINT ====================
app.get('/api/stats', async (_req, res) => {
  try {
    console.log('📊 Fetching API statistics');

    // Fetch a large page to approximate totals (upstream may not expose a count field)
    const data = await proxyToDeadAnime('/list', { limit: 100, page: 1 });

    // Safely extract array regardless of response shape
    const raw = data?.data?.results ?? data?.data ?? data?.results ?? data ?? [];
    const animeList = Array.isArray(raw) ? raw : Object.values(raw).filter(v => v && typeof v === 'object');

    res.json({
      total_fetched: animeList.length,
      total_movies:  animeList.filter((a) => a.type === 'movie').length,
      total_series:  animeList.filter((a) => a.type !== 'movie').length,
      note: 'Counts reflect first 100 results only — use pagination for full totals',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Stats endpoint error:', error.message);
    res.status(500).json({ error: 'Failed to fetch statistics', message: error.message });
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('💥 Server Error:', err);
  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    timestamp: new Date().toISOString(),
  });
});

// ==================== SERVER START ====================
if (require.main === module) {
  app.listen(PORT, () => {
    const portStr = String(PORT).padEnd(46);
    const envStr  = (process.env.NODE_ENV || 'development').toUpperCase().padEnd(46);
    const sslStr  = (process.env.NODE_ENV === 'development'
      ? '⚠️  DISABLED (Dev Only)'
      : '✅ ENABLED'
    ).padEnd(46);

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ANIME API SERVER v2.1                                   ║
║                                                               ║
║   Port:        ${portStr}║
║   Status:      ✅ ONLINE                                      ║
║   Environment: ${envStr}║
║   SSL:         ${sslStr}║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

📡 Dead Anime API Endpoints:

   GET  /api/deadanime/list         - Get anime list
        ?search=naruto              - Search anime
        &limit=12                   - Results per page (max 100)
        &page=1                     - Page number

   GET  /api/deadanime/anime        - Get anime details
        ?slug=naruto-shippuden      - Anime slug (required)

   GET  /api/deadanime/episode      - Get episode links
        ?slug=naruto-shippuden      - Anime slug (required)
        &season=1                   - Season number (default 1)
        &episode=1                  - Episode number (default 1)

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
    `);
  });
}

module.exports = app;