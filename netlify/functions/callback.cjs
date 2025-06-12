// path: netlify/functions/callback.js

exports.handler = async (event, context) => {
  console.log('Callback function started.');
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { code, state } = JSON.parse(event.body);
    
    console.log('Received authorization code:', code ? 'Yes' : 'No');
    console.log('Received state:', state ? 'Yes' : 'No');

    if (!code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Authorization code is required' })
      };
    }

    const clientId = process.env.VITE_SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.VITE_SPOTIFY_REDIRECT_URI;

    console.log('Client ID loaded:', clientId ? 'Yes' : 'No');
    console.log('Client Secret loaded:', clientSecret ? 'Yes' : 'No');
    console.log('Redirect URI loaded:', redirectUri ? 'Yes' : 'No');

    if (!clientId || !clientSecret || !redirectUri) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
    });

    console.log('Attempting to fetch token from Spotify...');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: params.toString(),
    });

    console.log('Spotify response status:', response.status);

    const data = await response.json();

    if (response.ok) {
      console.log('Successfully fetched token. Returning to client.');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          access_token: data.access_token,
          token_type: data.token_type,
          expires_in: data.expires_in,
        }),
      };
    } else {
      console.error('Error from Spotify:', data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: data.error || 'Token exchange failed',
          error_description: data.error_description || 'Unknown error'
        })
      };
    }
  } catch (error) {
    console.error('Callback function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};