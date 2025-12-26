// ⚠️ DEVELOPMENT ONLY - Disable SSL verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
require('dotenv').config();
const app = express();

// middleware
app.use(cors());
app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.send('🚀 Anime API is running on vercel');
});

const PORT = process.env.PORT || 5000;

// Export for Vercel
module.exports = app;

// API Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'https://your-api-domain.com';
const API_KEY = 'deadtoonszylith';

// Create HTTPS agent that ignores self-signed certificates
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Helper function to validate streaming URL
const isValidStreamingUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  
  // Check if URL is valid
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
    // Accept common streaming domains
    const validDomains = ['vidsrc', 'embed', 'stream', 'player', 'watch'];
    return validDomains.some(domain => urlObj.hostname.includes(domain)) || url.includes('embed');
  } catch {
    return false;
  }
};

// Helper function to clean and validate streaming links
const cleanStreamingLinks = (data) => {
  if (!data) return null;

  // Handle different response structures
  let servers = [];
  
  if (data.servers && Array.isArray(data.servers)) {
    servers = data.servers;
  } else if (data.links && Array.isArray(data.links)) {
    servers = data.links;
  } else if (Array.isArray(data)) {
    servers = data;
  }

  // Filter and clean valid servers
  const validServers = servers
    .filter(server => {
      const url = server.watch || server.url || server.embed || server.link;
      return isValidStreamingUrl(url);
    })
    .map(server => ({
      watch: server.watch || server.url || server.embed || server.link,
      name: server.name || 'Server',
      type: server.type || 'embed'
    }));

  console.log(`✅ Found ${validServers.length} valid streaming servers out of ${servers.length}`);

  return {
    servers: validServers,
    total: validServers.length,
    hasValidLinks: validServers.length > 0
  };
};

// Helper function to fetch from API
const fetchFromAPI = async (endpoint, parameters) => {
  try {
    const hasQuestionMark = parameters.startsWith('?');
    const separator = hasQuestionMark ? '&' : '?';
    const cleanParams = hasQuestionMark ? parameters.substring(1) : parameters;
    const url = `${API_BASE_URL}/${endpoint}${separator}${cleanParams}&key=${API_KEY}`;
    
    console.log('🌐 Requesting:', url);
    
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 20000,
      httpsAgent: httpsAgent
    });
    
    console.log('✅ Success! Status:', response.status);
    return response.data;
  } catch (error) {
    console.error('❌ API Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    return null;
  }
};

// Helper function to organize anime data
const organizeAnime = (anime) => {
  let year = "";
  if (anime.anime_rel_date && anime.anime_rel_date !== "0000-00-00") {
    year = new Date(anime.anime_rel_date).getFullYear().toString();
  }
  
  return {
    id: anime.anime_id,
    deadbase_id: anime.dumy_id,
    name: anime.anime_name,
    slug: anime.slug,
    type: anime.type,
    subOrDub: anime.sub == 0 ? "SUB" : "DUB",
    overview: anime.overview,
    release: anime.anime_rel_date,
    year: year,
    rating: anime.rating,
    complete: anime.anime_com_date === "0000-00-00" ? null : anime.anime_com_date,
    views: anime.total_views,
    duration: anime.duration,
    episodes: anime.total_episodes,
    tags: anime.tags || [],
    age: {
      id: anime.age_id,
      short_name: anime.age_name,
      description: anime.age_des
    },
    image: {
      poster: anime.poster_img,
      backdrop: anime.backdrop_img
    }
  };
};

// ==================== ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'API server is running',
    timestamp: new Date().toISOString()
  });
});

// Search Anime
app.get('/api/search', async (req, res) => {
  const { term, page = 1, limit = 12 } = req.query;
  
  if (!term) {
    return res.status(400).json({ error: 'Search term is required' });
  }

  console.log(`🔍 Searching for: "${term}" - Page: ${page}, Limit: ${limit}`);

  const data = await fetchFromAPI('anime/search.php', `keyword=${term}&limit=${limit}&page=${page}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Found ${response.posts.length} results for "${term}"`);
  res.json(response);
});

// Get Anime by Genre
app.get('/api/genre', async (req, res) => {
  const { genre, page = 1, limit = 12 } = req.query;
  
  if (!genre) {
    return res.status(400).json({ error: 'Genre is required' });
  }

  console.log(`🎭 Fetching ${genre} anime - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/search.php', `keyword=${genre}&limit=${limit}&page=${page}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} ${genre} anime for page ${page}`);
  res.json(response);
});

// Get Anime Info by Slug
app.get('/api/anime/:slug', async (req, res) => {
  const { slug } = req.params;
  
  console.log('🔍 Fetching anime by slug:', slug);
  
  const data = await fetchFromAPI('anime/anime.php', `slug=${slug}`);
  
  if (!data) {
    console.error('❌ Anime not found for slug:', slug);
    return res.status(404).json({ error: 'Anime not found' });
  }

  console.log('✅ Anime found:', data.anime_name);
  res.json(organizeAnime(data));
});

// Get Season Info
app.get('/api/anime/:id/seasons', async (req, res) => {
  const { id } = req.params;
  
  console.log('🔍 Fetching seasons for anime ID:', id);
  
  const data = await fetchFromAPI('anime/my-seasons.php', `animeid=${id}`);
  
  if (!data || !Array.isArray(data)) {
    console.log('⚠️ No seasons found for anime ID:', id);
    return res.json({ seasons_count: 0, seasons: [] });
  }

  const response = {
    seasons_count: data.length,
    seasons: data.map(season => ({
      num: season.my_season_num,
      id: season.my_season_id
    }))
  };

  console.log('✅ Found', response.seasons_count, 'seasons');
  res.json(response);
});

// Get Episodes
app.get('/api/episodes/:seasonId', async (req, res) => {
  const { seasonId } = req.params;
  
  console.log('🔍 Fetching episodes for season ID:', seasonId);
  
  const data = await fetchFromAPI('anime/episodes.php', `seasonid=${seasonId}`);
  
  if (!data || !Array.isArray(data)) {
    console.log('⚠️ No episodes found for season ID:', seasonId);
    return res.json([]);
  }

  const episodes = data.map(ep => ({
    id: ep.episode_id,
    number: ep.epSort,
    name: ep.episode_name,
    image: { backdrop: ep.img },
    note: ep.note
  }));

  console.log('✅ Found', episodes.length, 'episodes');
  res.json(episodes);
});

// Get Episode Links - IMPROVED WITH VALIDATION
app.get('/api/episode/:episodeId/links', async (req, res) => {
  const { episodeId } = req.params;
  
  console.log('🔍 Fetching links for episode ID:', episodeId);
  
  const data = await fetchFromAPI('anime/episode-new.php', `episodeid=${episodeId}`);
  
  if (!data) {
    console.error('❌ Episode links not found for ID:', episodeId);
    return res.status(404).json({ 
      error: 'Episode links not found',
      servers: [],
      hasValidLinks: false
    });
  }

  // Clean and validate streaming links
  const cleanedData = cleanStreamingLinks(data);
  
  if (!cleanedData.hasValidLinks) {
    console.warn('⚠️ No valid streaming links found for episode:', episodeId);
    return res.status(404).json({
      error: 'No valid streaming sources available',
      servers: [],
      hasValidLinks: false
    });
  }

  console.log('✅ Episode links validated and cleaned');
  res.json(cleanedData);
});

// Get Popular Anime
app.get('/api/popular', async (req, res) => {
  const { duration = 'month', page = 1, limit = 12 } = req.query;
  
  console.log(`⭐ Fetching popular anime (${duration}) - Page: ${page}, Limit: ${limit}`);
  
  const popularType = duration === 'month' ? 'popular' : 'today';
  const data = await fetchFromAPI('anime/test.php', `sort=${popularType}&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} popular anime for page ${page}`);
  res.json(response);
});

// Get Series (TV Shows)
app.get('/api/series', async (req, res) => {
  const { page = 1, limit = 12, status } = req.query;
  
  console.log(`📺 Fetching series - Page: ${page}, Limit: ${limit}, Status: ${status || 'all'}`);
  
  let params = `sort=new&type=tv&page=${page}&limit=${limit}`;
  
  if (status === 'ongoing') {
    params += '&status=ongoing';
  } else if (status === 'completed') {
    params += '&status=completed';
  }
  
  const data = await fetchFromAPI('anime/test.php', params);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} series for page ${page}`);
  res.json(response);
});

// Get Movies
app.get('/api/movies', async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  
  console.log(`🎬 Fetching movies - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/test.php', `type=movie&sort=new&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} movies for page ${page}`);
  res.json(response);
});

// Get Random Anime
app.get('/api/random', async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  
  console.log(`🎲 Fetching random anime - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/test.php', `sort=random&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} random anime for page ${page}`);
  res.json(response);
});

// Get Movie Links - IMPROVED WITH VALIDATION
app.get('/api/movie/:slug/links', async (req, res) => {
  const { slug } = req.params;
  
  console.log('🎬 Fetching movie links for slug:', slug);
  
  const data = await fetchFromAPI('anime/movie.php', `slug=${slug}&new=1`);
  
  if (!data) {
    console.error('❌ Movie links not found for slug:', slug);
    return res.status(404).json({ 
      error: 'Movie links not found',
      servers: [],
      hasValidLinks: false
    });
  }

  // Clean and validate streaming links
  const cleanedData = cleanStreamingLinks(data);
  
  if (!cleanedData.hasValidLinks) {
    console.warn('⚠️ No valid streaming links found for movie:', slug);
    return res.status(404).json({
      error: 'No valid streaming sources available',
      servers: [],
      hasValidLinks: false
    });
  }

  console.log('✅ Movie links validated and cleaned');
  res.json(cleanedData);
});

// Get Recently Added
app.get('/api/recent', async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  
  console.log(`🆕 Fetching recent anime - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/test.php', `sort=new&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: data.posts ? data.posts.map(organizeAnime) : []
  };

  console.log(`✅ Returning ${response.posts.length} recent anime for page ${page}`);
  res.json(response);
});

// Get All Content
app.get('/api/all-content', async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  
  try {
    console.log(`🔄 Fetching all content - Page: ${page}, Limit: ${limit}`);
    
    const [seriesData, moviesData, popularData] = await Promise.all([
      fetchFromAPI('anime/test.php', `sort=new&type=tv&page=${page}&limit=${limit}`),
      fetchFromAPI('anime/test.php', `type=movie&sort=new&page=${page}&limit=${limit}`),
      fetchFromAPI('anime/test.php', `sort=popular&page=${page}&limit=${limit}`)
    ]);
    
    const allPosts = [
      ...(seriesData?.posts || []),
      ...(moviesData?.posts || []),
      ...(popularData?.posts || [])
    ];
    
    const uniquePosts = Array.from(
      new Map(allPosts.map(item => [item.anime_id, item])).values()
    );
    
    const response = {
      total_pages: Math.max(
        seriesData?.total_pages || 0,
        moviesData?.total_pages || 0,
        popularData?.total_pages || 0
      ),
      current_page: parseInt(page),
      posts: uniquePosts.map(organizeAnime)
    };
    
    console.log(`✅ Returning ${response.posts.length} unique items for page ${page}`);
    res.json(response);
  } catch (error) {
    console.error('❌ Error in all-content:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Get Ongoing Anime
app.get('/api/ongoing', async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  
  console.log(`▶️ Fetching ongoing anime - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/test.php', `sort=new&type=tv&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const ongoingAnime = data.posts ? data.posts.filter(anime => {
    return !anime.anime_com_date || anime.anime_com_date === "0000-00-00";
  }) : [];

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: ongoingAnime.map(organizeAnime)
  };

  console.log(`✅ Returning ${response.posts.length} ongoing anime for page ${page}`);
  res.json(response);
});

// Get Completed Anime
app.get('/api/completed', async (req, res) => {
  const { page = 1, limit = 12 } = req.query;
  
  console.log(`✅ Fetching completed anime - Page: ${page}, Limit: ${limit}`);
  
  const data = await fetchFromAPI('anime/test.php', `sort=new&type=tv&page=${page}&limit=${limit}`);
  
  if (!data) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }

  const completedAnime = data.posts ? data.posts.filter(anime => {
    return anime.anime_com_date && anime.anime_com_date !== "0000-00-00";
  }) : [];

  const response = {
    total_pages: data.total_pages || 0,
    current_page: parseInt(page),
    posts: completedAnime.map(organizeAnime)
  };

  console.log(`✅ Returning ${response.posts.length} completed anime for page ${page}`);
  res.json(response);
});

// Get API Statistics
app.get('/api/stats', async (req, res) => {
  try {
    const [popularData, seriesData, moviesData] = await Promise.all([
      fetchFromAPI('anime/test.php', 'sort=popular&page=1&limit=1'),
      fetchFromAPI('anime/test.php', 'sort=new&type=tv&page=1&limit=1'),
      fetchFromAPI('anime/test.php', 'type=movie&sort=new&page=1&limit=1')
    ]);

    const stats = {
      total_anime: (popularData?.total_pages || 0) * 12,
      total_series: (seriesData?.total_pages || 0) * 12,
      total_movies: (moviesData?.total_pages || 0) * 12,
      timestamp: new Date().toISOString()
    };

    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('💥 Server Error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path 
  });
});

// Start server (only for local development)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ANIME API SERVER RUNNING                                ║
║                                                               ║
║   Port: ${PORT}                                               
║   Status: ✅ ONLINE                                           ║
║   Environment: DEVELOPMENT                                    ║
║   ⚠️  SSL Verification: DISABLED (Development Only)           ║
║   ✨ Streaming Link Validation: ENABLED                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

📡 Available Endpoints:

📍 General:
   GET  /api/health                     - Health check
   GET  /api/stats                      - API statistics

🔍 Search & Discovery:
   GET  /api/search?term=...&page=1&limit=12
   GET  /api/genre?genre=...&page=1&limit=12
   GET  /api/popular?duration=month&page=1&limit=12
   GET  /api/recent?page=1&limit=12
   GET  /api/random?page=1&limit=12

📺 Content Types:
   GET  /api/series?page=1&limit=12
   GET  /api/movies?page=1&limit=12
   GET  /api/ongoing?page=1&limit=12
   GET  /api/completed?page=1&limit=12
   GET  /api/all-content?page=1&limit=50

📖 Anime Details:
   GET  /api/anime/:slug
   GET  /api/anime/:id/seasons
   GET  /api/episodes/:seasonId
   GET  /api/episode/:episodeId/links   ✨ Validated
   GET  /api/movie/:slug/links          ✨ Validated

════════════════════════════════════════════════════════════════

🌐 Server URL: http://backend-verscel${PORT}
📝 Logs are enabled for all requests
🔧 Ready to handle requests!

════════════════════════════════════════════════════════════════
    `);
  });
}