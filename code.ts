// Check if user is authenticated
let isAuthenticated = false;

// Define team IDs
const COMPONENT_TEAM_ID = "1274370067380881284"; // Team where components are
const FILES_TEAM_ID = "942111258425873938"; // Team where files are

// Define an interface for the history item
interface SearchHistoryItem {
  id: string;
  key: string;
  name: string;
  timestamp: string;
}

// For authentication UI
const authUI = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Authentication Required</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 20px;
      color: #333;
      margin: 0;
      text-align: center;
    }
    .container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    button {
      background-color: #18A0FB;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      cursor: pointer;
      font-weight: 500;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #0D8EE0;
    }
    .info-box {
      background-color: #F0F0F0;
      padding: 16px;
      border-radius: 6px;
      font-size: 14px;
      max-width: 320px;
      margin: 0 auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Authentication Required</h2>
    
    <div class="info-box">
      <p>This plugin needs access to your Figma account to search for component usage across files.</p>
      <p>You'll be redirected to Figma to authorize this plugin.</p>
    </div>
    
    <button id="auth-button">Authenticate with Figma</button>
  </div>

  <script>
    // Figma Client ID
    const CLIENT_ID = 'HtBJNgdK2wBWQS4UsWkfx9';
    const REDIRECT_URI = 'http://localhost:3001/auth/callback';
    const SCOPE = 'files:read';
    
    document.getElementById('auth-button').onclick = () => {
      // Generate a random state value for security
      const state = Math.random().toString(36).substring(2, 15);
      
      // Store state in localStorage to verify when we get the callback
      localStorage.setItem('figma_auth_state', state);
      
      // Construct the authorization URL
      const authUrl = \`https://www.figma.com/oauth?client_id=\${CLIENT_ID}&redirect_uri=\${encodeURIComponent(REDIRECT_URI)}&scope=\${SCOPE}&state=\${state}&response_type=code\`;
      
      // Open the authorization page
      window.open(authUrl, '_blank');
    };
    
    // Listen for messages from the auth callback
    window.addEventListener('message', (event) => {
      if (event.data && event.data.token) {
        // Send the token to the plugin
        parent.postMessage({
          pluginMessage: {
            type: 'store-token',
            token: event.data.token,
            refreshToken: event.data.refreshToken || ''
          }
        }, '*');
      }
    });
  </script>
</body>
</html>`;

// Show the appropriate UI based on authentication status
async function checkAuthentication() {
  try {
    const accessToken = await figma.clientStorage.getAsync('figma_access_token');
    isAuthenticated = !!accessToken;
    return isAuthenticated;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
}

// Show the appropriate UI
async function showUI() {
  if (await checkAuthentication()) {
    figma.showUI(__html__, { width: 450, height: 550 });
    // Start listening for selection changes immediately
    setupSelectionListener();
  } else {
    figma.showUI(authUI, { width: 400, height: 450 });
  }
}

// Function to refresh token
async function refreshToken() {
  try {
    const refreshToken = await figma.clientStorage.getAsync('figma_refresh_token');
    if (!refreshToken) {
      return false;
    }

    const response = await fetch('http://localhost:3001/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    await figma.clientStorage.setAsync('figma_access_token', data.access_token);

    if (data.refresh_token) {
      await figma.clientStorage.setAsync('figma_refresh_token', data.refresh_token);
    }

    return true;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
}

// Function to save search history
async function saveSearchHistory(component: ComponentNode) {
  try {
    const history = await figma.clientStorage.getAsync('search_history') as SearchHistoryItem[] || [];
    const newEntry: SearchHistoryItem = {
      id: component.id,
      key: component.key,
      name: component.name,
      timestamp: new Date().toISOString()
    };

    // Add to the beginning, remove duplicates, and limit to 10 entries
    const updatedHistory = [
      newEntry,
      ...history.filter((item: SearchHistoryItem) => item.id !== component.id)
    ].slice(0, 10);

    await figma.clientStorage.setAsync('search_history', updatedHistory);
  } catch (error) {
    console.error('Error saving search history:', error);
  }
}

// Function to setup selection change listener
function setupSelectionListener() {
  // We can't remove all listeners generically, so we'll just add a new one
  // If we need to remove a specific listener, we would need to keep a reference to it

  // Add new listener
  figma.on('selectionchange', handleSelectionChange);
}

// Define the selection change handler function
function handleSelectionChange() {
  const selectedNodes = figma.currentPage.selection;

  // Clear previous component if selection is empty
  if (selectedNodes.length === 0) {
    selectedComponent = null;
    return;
  }

  // Check if exactly one node is selected
  if (selectedNodes.length === 1) {
    const node = selectedNodes[0];

    // Check if the selected node is a component
    if (node.type === 'COMPONENT') {
      // Store the selected component
      selectedComponent = node;

      // Save to search history
      void saveSearchHistory(node);

      // Send the component info to the UI
      figma.ui.postMessage({
        type: 'component-selected',
        id: node.id,
        key: node.key,
        name: node.name
      });
    } else {
      // If not a component, notify the user
      figma.notify("Please select a component (not an instance or other object)");
    }
  } else if (selectedNodes.length > 1) {
    figma.notify("Please select only one component");
  }
}

// Start by showing the appropriate UI
void showUI();

// Variable to store the selected component
let selectedComponent: ComponentNode | null = null;

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  // Handle authentication completed
  if (msg.type === 'store-token') {
    // Store the access token securely
    await figma.clientStorage.setAsync('figma_access_token', msg.token);

    // Store refresh token if provided
    if (msg.refreshToken) {
      await figma.clientStorage.setAsync('figma_refresh_token', msg.refreshToken);
    }

    isAuthenticated = true;

    // Show the main UI after successful authentication
    figma.showUI(__html__, { width: 450, height: 550 });

    // Setup selection listener
    setupSelectionListener();
    return;
  }

  // Handle logout request
  if (msg.type === 'logout') {
    // Clear the stored tokens
    await figma.clientStorage.deleteAsync('figma_access_token');
    await figma.clientStorage.deleteAsync('figma_refresh_token');
    isAuthenticated = false;

    // Show the auth UI
    figma.showUI(authUI, { width: 400, height: 450 });
    return;
  }

  // Handle clear selection request
  if (msg.type === 'clear-selection') {
    selectedComponent = null;
    figma.currentPage.selection = [];
  }

  // Handle search history request
  if (msg.type === 'get-search-history') {
    try {
      const history = await figma.clientStorage.getAsync('search_history') || [];
      figma.ui.postMessage({
        type: 'search-history',
        history
      });
    } catch (error) {
      console.error('Error getting search history:', error);
      figma.ui.postMessage({
        type: 'search-history',
        history: []
      });
    }
  }

  // Handle search request with real API call
  if (msg.type === 'find-usage') {
    if (!selectedComponent) {
      figma.ui.postMessage({
        type: 'error',
        message: 'No component selected'
      });
      return;
    }

    try {
      // Get the stored access token
      let accessToken = await figma.clientStorage.getAsync('figma_access_token');

      if (!accessToken) {
        // If no token is found, show the auth UI
        figma.showUI(authUI, { width: 400, height: 450 });
        return;
      }

      // Get the team IDs from UI selection or use defaults
      const componentTeamId = msg.componentTeamId || COMPONENT_TEAM_ID;
      const searchTeamId = msg.searchTeamId || FILES_TEAM_ID;
      const fileLimit = msg.fileLimit || 10;

      // Get current project ID if needed
      const projectId = msg.currentProjectOnly && figma.currentPage.parent ?
          figma.currentPage.parent.id : null;

      // Show search in progress message in UI
      figma.ui.postMessage({
        type: 'search-progress',
        percentage: 10,
        message: 'Starting search...'
      });

      // Call to your server
      let response = await fetch('http://localhost:3001/api/find-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          componentKey: selectedComponent.key,
          componentTeamId,
          searchTeamId,
          projectId,
          includeInstances: msg.includeInstances || false,
          fileLimit
        })
      });

      // If token is invalid, try to refresh it
      if (response.status === 401) {
        const refreshed = await refreshToken();
        if (refreshed) {
          accessToken = await figma.clientStorage.getAsync('figma_access_token');

          // Retry with new token
          response = await fetch('http://localhost:3001/api/find-usage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
              componentKey: selectedComponent.key,
              componentTeamId,
              searchTeamId,
              projectId,
              includeInstances: msg.includeInstances || false,
              fileLimit
            })
          });
        } else {
          // If refresh failed, go back to auth
          await figma.clientStorage.deleteAsync('figma_access_token');
          await figma.clientStorage.deleteAsync('figma_refresh_token');
          figma.showUI(authUI, { width: 400, height: 450 });
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      // Show search in progress message in UI
      figma.ui.postMessage({
        type: 'search-progress',
        percentage: 90,
        message: 'Processing results...'
      });

      const results = await response.json();

      // Send the results to the UI
      figma.ui.postMessage({
        type: 'search-results',
        results
      });

    } catch (error: unknown) {
      // Type guard to safely access the error message
      let errorMessage = 'Failed to find component usage';

      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object' && 'message' in error) {
        errorMessage = String((error as Record<string, unknown>).message);
      }

      figma.ui.postMessage({
        type: 'error',
        message: errorMessage
      });
    }
  }
};