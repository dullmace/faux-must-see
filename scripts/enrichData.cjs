const fs = require("fs");
const fetch = require("node-fetch");
require("dotenv").config({ path: ".env" }); // Load .env variables

const clientId = process.env.VITE_SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

console.log("Loaded Client ID:", clientId);
console.log("Loaded Client Secret:", clientSecret ? "******" : undefined);

// --- Helper Functions ---

// 1. Get a server-to-server Spotify API token
async function getSpotifyToken() {
  const authString = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authString}`,
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json();
  return data.access_token;
}

// 2. Get a band's audio profile
async function getBandAudioProfile(band, token) {
  try {
    const artistId = band.spotifyLink.split("/").pop();
    if (!artistId) {
      console.log(`Skipping ${band.name}, no Spotify ID found.`);
      return null;
    }

    // Get the artist's top tracks
    const tracksRes = await fetch(
      `https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const tracksData = await tracksRes.json();
    const topTracks = tracksData.tracks;

    if (!topTracks || topTracks.length === 0) {
      console.log(`Skipping ${band.name}, no top tracks found.`);
      return null;
    }

    // Get audio features for those tracks
    const trackIds = topTracks.map((t) => t.id).join(",");
    const featuresRes = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${trackIds}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const featuresData = await featuresRes.json();
    const audioFeatures = featuresData.audio_features.filter(Boolean); // Filter out nulls

    if (audioFeatures.length === 0) {
      console.log(`Skipping ${band.name}, no audio features found.`);
      return null;
    }

    // Calculate the average profile
    const profile = {
      danceability: 0,
      energy: 0,
      valence: 0, // Musical "positiveness"
      acousticness: 0,
    };

    audioFeatures.forEach((f) => {
      profile.danceability += f.danceability;
      profile.energy += f.energy;
      profile.valence += f.valence;
      profile.acousticness += f.acousticness;
    });

    for (const key in profile) {
      profile[key] =
        Math.round((profile[key] / audioFeatures.length) * 1000) / 1000; // Average and round
    }

    return profile;
  } catch (error) {
    console.error(`Error processing ${band.name}:`, error);
    return null;
  }
}

// --- Main Execution ---

async function main() {
  console.log("Starting data enrichment script...");
  const token = await getSpotifyToken();
  if (!token) {
    console.error("Could not retrieve Spotify token. Check credentials.");
    return;
  }

  const bandsData = JSON.parse(
    fs.readFileSync("./src/data/bands.json", "utf-8"),
  );
  const enrichedBands = [];

  for (const band of bandsData.bands) {
    console.log(`Processing: ${band.name}...`);
    const audioProfile = await getBandAudioProfile(band, token);
    enrichedBands.push({ ...band, audioProfile });
    // Small delay to be nice to the API
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const newJsonData = JSON.stringify({ bands: enrichedBands }, null, 2);
  fs.writeFileSync("./src/data/bands.enriched.json", newJsonData);

  console.log(
    "\n✅ Success! Enriched data saved to src/data/bands.enriched.json",
  );
}

main();