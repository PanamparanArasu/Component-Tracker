const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Set up Socket.IO
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Figma OAuth configuration
const FIGMA_CLIENT_ID = process.env.FIGMA_CLIENT_ID;
const FIGMA_CLIENT_SECRET = process.env.FIGMA_CLIENT_SECRET;
const FIGMA_REDIRECT_URI = process.env.FIGMA_REDIRECT_URI || 'http://localhost:3001/auth/callback';

// Simple caching mechanism
const cache = {
    files: new Map(),
    results: new Map()
};

// Cache expiration time (30 minutes)
const CACHE_TTL = 30 * 60 * 1000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected');

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// OAuth callback endpoint
app.get('/auth/callback', async (req, res) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).send('Authorization code is missing');
        }

        // Exchange authorization code for access token
        const tokenResponse = await axios.post('https://www.figma.com/api/oauth/token', {
            client_id: FIGMA_CLIENT_ID,
            client_secret: FIGMA_CLIENT_SECRET,
            redirect_uri: FIGMA_REDIRECT_URI,
            code,
            grant_type: 'authorization_code'
        });

        const { access_token, refresh_token } = tokenResponse.data;

        // Send a success page with script to communicate with the plugin
        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authentication Successful</title>
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background-color: #F0F0F0;
          }
          .success-card {
            background-color: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            text-align: center;
            max-width: 400px;
          }
          h2 {
            color: #18A0FB;
          }
        </style>
      </head>
      <body>
        <div class="success-card">
          <h2>Authentication Successful!</h2>
          <p>You can now close this window and return to the Figma plugin.</p>
        </div>
        
        <script>
          // Try to send the token back to the plugin window
          if (window.opener) {
            window.opener.postMessage({ 
              token: '${access_token}',
              refreshToken: '${refresh_token || ''}'
            }, '*');
          }
          
          // Close this window after a short delay
          setTimeout(() => {
            window.close();
          }, 3000);
        </script>
      </body>
      </html>
    `);
    } catch (error) {
        console.error('OAuth error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed. Please try again.');
    }
});

// Token refresh endpoint
app.post('/auth/refresh', async (req, res) => {
    try {
        const { refresh_token } = req.body;

        if (!refresh_token) {
            return res.status(400).json({ error: 'Refresh token is required' });
        }

        const tokenResponse = await axios.post('https://www.figma.com/api/oauth/token', {
            client_id: FIGMA_CLIENT_ID,
            client_secret: FIGMA_CLIENT_SECRET,
            refresh_token,
            grant_type: 'refresh_token'
        });

        res.json(tokenResponse.data);
    } catch (error) {
        console.error('Token refresh error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});

// Check if a result is in cache
function getCachedResult(key) {
    if (cache.results.has(key)) {
        const { timestamp, data } = cache.results.get(key);
        if (Date.now() - timestamp < CACHE_TTL) {
            return data;
        }
        cache.results.delete(key);
    }
    return null;
}

// Save result to cache
function cacheResult(key, data) {
    cache.results.set(key, {
        timestamp: Date.now(),
        data
    });
}

// API endpoint to find component usage
app.post('/api/find-usage', async (req, res) => {
    try {
        const {
            componentKey,
            componentTeamId,
            searchTeamId,
            projectId,
            includeInstances,
            fileLimit = 10
        } = req.body;

        const accessToken = req.headers.authorization?.split(' ')[1];

        if (!componentKey || !accessToken || !searchTeamId) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // Check cache for this search
        const cacheKey = `${componentKey}_${searchTeamId}_${projectId}_${includeInstances}`;
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
            console.log('Returning cached results');
            return res.json(cachedResult);
        }

        // Validate the token by making a request to Figma API
        let userInfo;
        try {
            const userResponse = await axios.get('https://api.figma.com/v1/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            userInfo = userResponse.data;
        } catch (error) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Get files to check
        let filesToCheck = [];

        if (projectId) {
            // Get files for a specific project
            const filesResponse = await axios.get(`https://api.figma.com/v1/projects/${projectId}/files`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            filesToCheck = filesResponse.data.files;
        } else if (searchTeamId) {
            // Get team projects for the search team
            const projectsResponse = await axios.get(`https://api.figma.com/v1/teams/${searchTeamId}/projects`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            const projects = projectsResponse.data.projects;

            // For each project, get files
            for (const project of projects.slice(0, 5)) { // Limit to 5 projects
                try {
                    const filesResponse = await axios.get(`https://api.figma.com/v1/projects/${project.id}/files`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });

                    filesToCheck = filesToCheck.concat(filesResponse.data.files);
                } catch (error) {
                    console.error(`Error fetching files for project ${project.id}:`, error.message);
                    // Continue with other projects even if one fails
                }
            }
        } else {
            return res.status(400).json({ error: 'Either searchTeamId or projectId is required' });
        }

        // Process files in batches
        const batchSize = 3;
        const results = [];
        const totalFiles = Math.min(filesToCheck.length, parseInt(fileLimit, 10));

        // Send initial progress update
        io.emit('search-progress', {
            totalFiles,
            filesSearched: 0
        });

        for (let i = 0; i < totalFiles; i += batchSize) {
            const batch = filesToCheck.slice(i, i + batchSize);
            const batchPromises = batch.map(file =>
                checkFileForComponent(file.key, componentKey, accessToken, includeInstances)
            );

            const batchResults = await Promise.allSettled(batchPromises);

            // Update progress via WebSocket
            io.emit('search-progress', {
                totalFiles,
                filesSearched: Math.min(i + batch.length, totalFiles)
            });

            // Filter out rejected promises and null results
            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value) {
                    results.push(result.value);
                }
            }
        }

        // Cache the results
        cacheResult(cacheKey, results);

        res.json(results);
    } catch (error) {
        console.error('Error finding usage:', error);
        res.status(500).json({ error: error.message || 'Failed to find component usage' });
    }
});

// Helper function to check if a file uses a component with timeout
async function checkFileForComponent(fileId, componentKey, accessToken, includeInstances = false) {
    try {
        // Check if result is in cache
        const cacheKey = `file_${fileId}_component_${componentKey}_${includeInstances}`;
        if (cache.files.has(cacheKey)) {
            const { timestamp, data } = cache.files.get(cacheKey);
            if (Date.now() - timestamp < CACHE_TTL) {
                return data;
            }
            cache.files.delete(cacheKey);
        }

        // Set a timeout for the API call
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

        // Get file data from Figma API
        const fileResponse = await axios.get(`https://api.figma.com/v1/files/${fileId}?depth=1`, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const document = fileResponse.data.document;
        let instanceCount = 0;

        // Function to recursively search for component instances
        function findComponentInstances(node) {
            // Check if this node is an instance of the component
            if (includeInstances && node.type === 'INSTANCE' && node.componentId === componentKey) {
                instanceCount++;
            }

            // Check children if they exist
            if (node.children) {
                for (const child of node.children) {
                    findComponentInstances(child);
                }
            }
        }

        // Start the recursive search
        findComponentInstances(document);

        // Return null if no instances found
        if (instanceCount === 0) {
            return null;
        }

        // Return file info with instance count
        const result = {
            id: fileId,
            name: fileResponse.data.name,
            url: `https://www.figma.com/file/${fileId}`,
            instanceCount
        };

        // Cache the result
        cache.files.set(cacheKey, {
            timestamp: Date.now(),
            data: result
        });

        return result;
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error(`Request timeout for file ${fileId}`);
        } else {
            console.error(`Error checking file ${fileId}:`, error);
        }
        return null;
    }
}

// Clear cache endpoint
app.post('/api/clear-cache', (req, res) => {
    cache.files.clear();
    cache.results.clear();
    res.json({ message: 'Cache cleared' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// Start the server using the HTTP server, not the Express app
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`OAuth callback URL: ${FIGMA_REDIRECT_URI}`);
});