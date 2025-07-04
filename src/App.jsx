import { useState, useEffect } from "react";
import fauxchellaBands from "./data/bands.enriched.json";
import "./App.css";

// --- Helper Functions ---
const getAudioFeatureDistance = (profile1, profile2) => {
  let distance = 0;
  if (!profile1 || !profile2) return 1;
  for (const key in profile1) {
    distance += Math.pow(profile1[key] - profile2[key], 2);
  }
  return Math.sqrt(distance);
};

const getRankedMatches = async (token, timeRange) => {
  const artistsRes = await fetch(
    `https://api.spotify.com/v1/me/top/artists?limit=50&time_range=${timeRange}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const topArtistsData = await artistsRes.json();
  const topArtists = topArtistsData.items || [];

  const tracksRes = await fetch(
    `https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=${timeRange}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const topTracksData = await tracksRes.json();
  const topTracks = topTracksData.items || [];

  const userAudioProfile = {
    danceability: 0,
    energy: 0,
    valence: 0,
    acousticness: 0,
  };

  if (topTracks.length > 0) {
    const trackIds = topTracks.map((track) => track.id).join(",");
    const featuresRes = await fetch(
      `https://api.spotify.com/v1/audio-features?ids=${trackIds}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const featuresData = await featuresRes.json();
    const audioFeatures = featuresData.audio_features.filter(Boolean);

    if (audioFeatures.length > 0) {
      audioFeatures.forEach((feature) => {
        userAudioProfile.danceability += feature.danceability;
        userAudioProfile.energy += feature.energy;
        userAudioProfile.valence += feature.valence;
        userAudioProfile.acousticness += feature.acousticness;
      });
      for (const key in userAudioProfile) {
        userAudioProfile[key] /= audioFeatures.length;
      }
    }
  }

  const userGenres = new Set(topArtists.flatMap((artist) => artist.genres));
  const scoredBands = fauxchellaBands.bands.map((band) => {
    let score = 0;
    let reasons = [];

    if (
      topArtists.some(
        (artist) => artist.name.toLowerCase() === band.name.toLowerCase()
      )
    ) {
      score += 1000;
      reasons.push(`you're already a huge fan of ${band.name}`);
    }

    const bandGenres = band.bandGenre.split(" - ");
    const sharedGenres = bandGenres.filter((genre) => userGenres.has(genre));
    if (sharedGenres.length > 0) {
      score += sharedGenres.length * 50;
      reasons.push(`you love genres like: ${sharedGenres.join(", ")}`);
    }

    if (band.audioProfile && userAudioProfile.energy > 0) {
      const distance = getAudioFeatureDistance(
        userAudioProfile,
        band.audioProfile
      );
      const similarityScore = (1 - distance) * 100;
      if (similarityScore > 0) {
        score += similarityScore;
        reasons.push(
          "their music has a similar sonic vibe to what you listen to"
        );
      }
    }

    let reason = "They're a great band to discover at Faux!";
    if (reasons.length > 0) {
      reason = `Because ${reasons.join(" and ")}.`;
    }

    return { ...band, score, reason };
  });

  return scoredBands.sort((a, b) => b.score - a.score);
};

const loadImage = (src) => {
  return new Promise((resolve) => {
    if (!src) {
      console.warn("No image source provided");
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    const timeout = setTimeout(() => {
      console.warn("Image loading timeout for:", src);
      resolve(null);
    }, 15000); // Increased timeout
    
    img.onload = () => {
      clearTimeout(timeout);
      console.log("Image loaded successfully:", src);
      resolve(img);
    };
    
    img.onerror = (error) => {
      clearTimeout(timeout);
      console.warn("Failed to load image:", src, error);
      resolve(null);
    };
    
    console.log("Starting to load image:", src);
    img.src = src;
  });
};

const createPlaylist = async (token, bandName, spotifyId, matchPercentage) => {
  try {
    // Get user profile
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!userRes.ok) {
      throw new Error(`Failed to get user profile: ${userRes.status}`);
    }

    const userData = await userRes.json();
    const playlistName = `Faux Must-See: ${bandName}`;

    // Check for existing playlists to prevent duplicates
    const existingPlaylistsRes = await fetch(
      `https://api.spotify.com/v1/users/${userData.id}/playlists?limit=50`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (existingPlaylistsRes.ok) {
      const existingPlaylists = await existingPlaylistsRes.json();
      const existingPlaylist = existingPlaylists.items?.find(
        (playlist) => playlist.name === playlistName
      );

      if (existingPlaylist) {
        console.log("Playlist already exists, returning existing URL");
        return existingPlaylist.external_urls.spotify;
      }
    }

    // Create new playlist
    const playlistRes = await fetch(
      `https://api.spotify.com/v1/users/${userData.id}/playlists`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: playlistName,
          description: `Don't miss ${bandName} at Faux! 🎵 ${matchPercentage}% match based on your music taste.`,
          public: false,
        }),
      }
    );

    if (!playlistRes.ok) {
      const errorData = await playlistRes.json();
      throw new Error(
        `Failed to create playlist: ${playlistRes.status} - ${
          errorData.error?.message || "Unknown error"
        }`
      );
    }

    const playlistData = await playlistRes.json();
    console.log("Playlist created successfully:", playlistData.id);

    // Get artist's top tracks
    const tracksRes = await fetch(
      `https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=US`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (tracksRes.ok) {
      const tracksData = await tracksRes.json();
      if (tracksData.tracks && tracksData.tracks.length > 0) {
        const trackUris = tracksData.tracks
          .slice(0, 10)
          .map((track) => track.uri);

        // Add tracks to playlist
        const addTracksRes = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistData.id}/tracks`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ uris: trackUris }),
          }
        );

        if (!addTracksRes.ok) {
          console.error("Failed to add tracks to playlist:", addTracksRes.status);
        } else {
          console.log("Tracks added successfully");
        }
      }
    }

    // Generate and upload custom cover image with better error handling
    try {
      console.log("Generating playlist cover...");
      const coverBlob = await generatePlaylistCover(bandName, matchPercentage, token, { spotifyLink: `https://open.spotify.com/artist/${spotifyId}` });

      if (coverBlob && coverBlob.size > 0) {
        console.log("Cover generated, size:", coverBlob.size);

        // Convert blob to base64 with better method
        const arrayBuffer = await coverBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64String = btoa(String.fromCharCode.apply(null, uint8Array));

        console.log("Base64 string length:", base64String.length);

        // Check if the image is too large (Spotify has a 256KB limit)
        if (base64String.length > 256 * 1024) {
          console.warn("Image too large for Spotify, skipping cover upload");
        } else {
          // Upload cover image to playlist
          const uploadRes = await fetch(
            `https://api.spotify.com/v1/playlists/${playlistData.id}/images`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "image/jpeg",
              },
              body: base64String,
            }
          );

          if (uploadRes.ok) {
            console.log("Successfully uploaded playlist cover");
          } else {
            const errorText = await uploadRes.text();
            console.error(
              "Failed to upload playlist cover:",
              uploadRes.status,
              errorText
            );

            // Don't throw error here - playlist was created successfully
            if (uploadRes.status === 401) {
              console.error(
                "Cover upload failed due to insufficient permissions. The playlist was created without a custom cover."
              );
            }
          }
        }
      } else {
        console.error("Failed to generate cover blob");
      }
    } catch (coverError) {
      console.error("Error with playlist cover:", coverError);
      // Continue without custom cover - playlist was created successfully
    }

    return playlistData.external_urls.spotify;
  } catch (error) {
    console.error("Error creating playlist:", error);
    throw error;
  }
};

const generatePlaylistCover = async (bandName, matchPercentage, token, bandData) => {
  return new Promise(async (resolve) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = 400;
      canvas.height = 400;

      let colors = {
        primary: { r: 255, g: 120, b: 60 },
        secondary: { r: 50, g: 200, b: 100 },
        accent: { r: 255, g: 200, b: 50 }
      };

      if (token && bandData && bandData.spotifyLink) {
        const spotifyId = bandData.spotifyLink.split("/").pop();
        const albumArtUrl = await getAlbumArtFromSpotify(token, spotifyId);
        if (albumArtUrl) {
          colors = await extractColorsFromImage(albumArtUrl);
        }
      }

      // Bright, vibrant gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `rgb(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b})`);
      gradient.addColorStop(0.5, `rgb(${colors.secondary.r}, ${colors.secondary.g}, ${colors.secondary.b})`);
      gradient.addColorStop(1, `rgb(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b})`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Bright pattern
      ctx.fillStyle = `rgba(255, 255, 255, 0.2)`;
      for (let i = 0; i < canvas.width; i += 25) {
        for (let j = 0; j < canvas.height; j += 25) {
          if ((i + j) % 50 === 0) {
            ctx.fillRect(i, j, 10, 10);
          }
        }
      }

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Bright vinyl record with transparency
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 120, 0, Math.PI * 2);
      ctx.fill();

      // Bright vinyl grooves
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 2;
      for (let radius = 30; radius < 120; radius += 15) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bright center
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
      ctx.fill();

      ctx.miterLimit = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      
      // Text with maximum contrast
      ctx.textAlign = "center";
      
      // Strong black outline for all text
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 6;
      ctx.font = "bold 24px Arial, sans-serif";
      ctx.strokeText("FAUX", centerX, 70);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("FAUX", centerX, 70);

      ctx.font = "bold 18px Arial, sans-serif";
      ctx.lineWidth = 6;
      ctx.strokeText("MUST-SEE", centerX, 95);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("MUST-SEE", centerX, 95);

      // Band name with strong outline
      ctx.font = "bold 28px Arial, sans-serif";
      let fontSize = 28;
      while (
        ctx.measureText(bandName.toUpperCase()).width > canvas.width - 40 &&
        fontSize > 16
      ) {
        fontSize -= 2;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      }

      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 5;
      ctx.strokeText(bandName.toUpperCase(), centerX, centerY + 160);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(bandName.toUpperCase(), centerX, centerY + 160);

      // Match percentage with strong contrast
      ctx.font = "bold 20px Arial, sans-serif";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(`${matchPercentage}% MATCH`, centerX, centerY + 190);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${matchPercentage}% MATCH`, centerX, centerY + 190);

      // Bright decorative lines
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.moveTo(centerX - 80, 115);
      ctx.lineTo(centerX + 80, 115);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX - 80, centerY + 210);
      ctx.lineTo(centerX + 80, centerY + 210);
      ctx.stroke();

      canvas.toBlob(
        (blob) => {
          if (blob) {
            console.log("Bright readable playlist cover generated successfully, size:", blob.size);
            resolve(blob);
          } else {
            console.error("Failed to create playlist cover blob");
            resolve(null);
          }
        },
        "image/jpeg",
        0.8
      );
    } catch (error) {
      console.error("Error in generatePlaylistCover:", error);
      resolve(null);
    }
  });
};

const extractColorsFromImage = async (imageUrl) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    const timeout = setTimeout(() => {
      console.warn("Image loading timeout, using fallback colors");
      resolve({
        primary: { r: 255, g: 120, b: 60 },    // Bright coral
        secondary: { r: 50, g: 200, b: 100 },  // Bright green
        accent: { r: 255, g: 200, b: 50 }      // Bright gold
      });
    }, 10000);
    
    img.onload = () => {
      clearTimeout(timeout);
      
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        canvas.width = 100;
        canvas.height = 100;
        
        ctx.drawImage(img, 0, 0, 100, 100);
        
        const imageData = ctx.getImageData(0, 0, 100, 100);
        const data = imageData.data;
        
        const colorMap = new Map();
        
        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          
          if (a < 128) continue;
          
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
          
          // Accept brighter range
          if (brightness < 80 || brightness > 240) continue;
          
          const rGroup = Math.floor(r / 25) * 25;
          const gGroup = Math.floor(g / 25) * 25;
          const bGroup = Math.floor(b / 25) * 25;
          
          const colorKey = `${rGroup},${gGroup},${bGroup}`;
          
          const weight = Math.pow(brightness / 255, 0.2); // Favor brighter colors
          colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + weight);
        }
        
        const sortedColors = Array.from(colorMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([color]) => {
            const [r, g, b] = color.split(',').map(Number);
            return { r, g, b };
          });
        
        if (sortedColors.length === 0) {
          resolve({
            primary: { r: 255, g: 120, b: 60 },
            secondary: { r: 50, g: 200, b: 100 },
            accent: { r: 255, g: 200, b: 50 }
          });
          return;
        }
        
        // Boost colors to be bright and vibrant
        const enhanceColor = (color) => {
          return {
            r: Math.min(255, Math.max(120, color.r + 50)),
            g: Math.min(255, Math.max(120, color.g + 50)),
            b: Math.min(255, Math.max(120, color.b + 50))
          };
        };
        
        const primary = enhanceColor(sortedColors[0]);
        const secondary = sortedColors.length > 1 ? enhanceColor(sortedColors[1]) : primary;
        
        // Create bright complementary accent
        const accent = {
          r: Math.min(255, Math.max(150, 255 - primary.r + 120)),
          g: Math.min(255, Math.max(150, 255 - primary.g + 100)),
          b: Math.min(255, Math.max(150, primary.b + 60))
        };
        
        console.log("Bright balanced colors extracted:", { primary, secondary, accent });
        resolve({ primary, secondary, accent });
        
      } catch (error) {
        console.error('Error extracting colors:', error);
        resolve({
          primary: { r: 255, g: 120, b: 60 },
          secondary: { r: 50, g: 200, b: 100 },
          accent: { r: 255, g: 200, b: 50 }
        });
      }
    };
    
    img.onerror = (error) => {
      clearTimeout(timeout);
      console.warn("Failed to load image for color extraction:", error);
      resolve({
        primary: { r: 255, g: 120, b: 60 },
        secondary: { r: 50, g: 200, b: 100 },
        accent: { r: 255, g: 200, b: 50 }
      });
    };
    
    img.src = imageUrl;
  });
};

const getAlbumArtFromSpotify = async (token, spotifyId) => {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=US`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data.tracks && data.tracks.length > 0) {
        const topTrack = data.tracks[0];
        if (topTrack.album && topTrack.album.images && topTrack.album.images.length > 0) {
          // Get medium size image (usually 300x300)
          const albumArt = topTrack.album.images.find(img => img.width >= 300) || topTrack.album.images[0];
          return albumArt.url;
        }
      }
    }
  } catch (error) {
    console.error('Error fetching album art:', error);
  }
  
  return null;
};

const preloadFonts = async () => {
  const fonts = [
    'Arial',
    'sans-serif',
    'Arial, sans-serif'
  ];
  
  if (document.fonts) {
    try {
      await document.fonts.ready;
      console.log("Fonts loaded successfully");
    } catch (error) {
      console.warn("Font loading failed:", error);
    }
  }
};

// --- Seeded Random Class ---
class SeededRandom {
  constructor(seed) {
    this.seed = this.hashString(seed);
  }
  
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }
  
  next(min = 0, max = 1) {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return min + (this.seed / 233280) * (max - min);
  }
}

// --- Improved Font Loading ---
const ensureFontsLoaded = async () => {
  const testFonts = ['Arial', 'sans-serif'];
  const promises = testFonts.map(font => 
    document.fonts.load(`16px ${font}`).catch(() => null)
  );
  
  try {
    await Promise.allSettled(promises);
    console.log("Fonts loaded successfully");
  } catch (error) {
    console.warn("Font loading issues:", error);
  }
};

// --- Improved Image Loading ---
const loadImageSafe = (src) => {
  return new Promise((resolve) => {
    if (!src) {
      console.warn("No image source provided");
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
    };
    
    const timeout = setTimeout(() => {
      cleanup();
      console.warn("Image loading timeout for:", src);
      resolve(null);
    }, 15000);
    
    img.onload = () => {
      clearTimeout(timeout);
      cleanup();
      console.log("Image loaded successfully:", src);
      resolve(img);
    };
    
    img.onerror = (error) => {
      clearTimeout(timeout);
      cleanup();
      console.warn("Failed to load image:", src, error);
      resolve(null);
    };
    
    console.log("Starting to load image:", src);
    img.src = src;
  });
};

// --- Canvas Creation ---
const createCanvas = () => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  
  if (!ctx) {
    throw new Error("Failed to get canvas context");
  }
  
  canvas.width = 1200;
  canvas.height = 630;
  
  return { canvas, ctx };
};

// --- Exclusion Zone Management ---
const getExclusionZones = (canvas) => {
  const centerX = canvas.width / 2 - 100;
  const centerY = canvas.height / 2 - 40;
  
  return [
    { x: centerX - 200, y: 100, width: 400, height: 300 },
    { x: canvas.width - 320, y: 140, width: 320, height: 320 },
    { x: 0, y: canvas.height - 120, width: canvas.width, height: 120 },
    { x: centerX - 180, y: centerY + 90, width: 360, height: 120 }
  ];
};

const isCirclePositionSafe = (x, y, radius, exclusionZones, margin = 20) => {
  for (const zone of exclusionZones) {
    // Check if circle intersects with rectangle
    const closestX = Math.max(zone.x, Math.min(x, zone.x + zone.width));
    const closestY = Math.max(zone.y, Math.min(y, zone.y + zone.height));
    const distance = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
    
    if (distance < radius + margin) {
      return false;
    }
  }
  return true;
};

// --- Background Drawing ---
const drawBackground = (ctx, canvas, colors, rng) => {
  // Randomize gradient direction and stops
  const gradientVariations = [
    () => ctx.createRadialGradient(
      canvas.width * rng.next(0.2, 0.8), 
      canvas.height * rng.next(0.2, 0.8), 
      0,
      canvas.width * rng.next(0.6, 1.2), 
      canvas.height * rng.next(0.6, 1.2), 
      canvas.width * rng.next(0.8, 1.4)
    ),
    () => ctx.createLinearGradient(
      rng.next(0, canvas.width), 
      rng.next(0, canvas.height),
      rng.next(0, canvas.width), 
      rng.next(0, canvas.height)
    ),
    () => {
      const grad = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.5, 0,
        canvas.width * 0.5, canvas.height * 0.5, canvas.width * 0.8
      );
      return grad;
    }
  ];

  const selectedGradient = gradientVariations[Math.floor(rng.next(0, gradientVariations.length))]();
  
  // Randomize color stops
  const stopPositions = [0, rng.next(0.2, 0.4), rng.next(0.5, 0.7), 1];
  const colorOrder = [colors.primary, colors.secondary, colors.accent];
  
  // Shuffle colors based on rng
  for (let i = colorOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next(0, i + 1));
    [colorOrder[i], colorOrder[j]] = [colorOrder[j], colorOrder[i]];
  }

  selectedGradient.addColorStop(stopPositions[0], `rgba(${colorOrder[0].r}, ${colorOrder[0].g}, ${colorOrder[0].b}, ${rng.next(0.8, 0.95)})`);
  selectedGradient.addColorStop(stopPositions[1], `rgba(${colorOrder[1].r}, ${colorOrder[1].g}, ${colorOrder[1].b}, ${rng.next(0.7, 0.9)})`);
  selectedGradient.addColorStop(stopPositions[2], `rgba(${colorOrder[2].r}, ${colorOrder[2].g}, ${colorOrder[2].b}, ${rng.next(0.8, 0.9)})`);
  selectedGradient.addColorStop(stopPositions[3], `rgba(${colorOrder[0].r * 0.8}, ${colorOrder[0].g * 0.8}, ${colorOrder[0].b * 0.8}, ${rng.next(0.85, 0.95)})`);

  ctx.fillStyle = selectedGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  return colorOrder;
};

// --- Texture Drawing ---
const drawTextures = (ctx, canvas, rng) => {
// Noise
const noiseIntensity = rng.next(0.03, 0.08); // Range: 3%-8% instead of 8%-15%
const noiseSize = rng.next(1, 3);

ctx.save();
ctx.fillStyle = `rgba(255, 255, 255, ${noiseIntensity})`;

for (let i = 0; i < canvas.width; i += Math.floor(rng.next(1, 4))) {
  for (let j = 0; j < canvas.height; j += Math.floor(rng.next(1, 4))) {
    if (rng.next() > 0.91) { // 9% frequency instead of 12%
      const size = rng.next() > 0.5 ? noiseSize : noiseSize * 2;
      ctx.fillRect(i, j, size, size);
    }
  }
}
ctx.restore();

  // Randomized texture lines
  const lineCount = Math.floor(rng.next(15, 35));
  const lineOpacity = rng.next(0.04, 0.08);
  
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${lineOpacity})`;
  ctx.lineWidth = rng.next(0.5, 2);
  
  for (let i = 0; i < lineCount; i++) {
    const startX = rng.next(0, canvas.width);
    const startY = rng.next(0, canvas.height);
    const length = rng.next(30, 150);
    const angle = rng.next(0, Math.PI * 2);
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + Math.cos(angle) * length, startY + Math.sin(angle) * length);
    ctx.stroke();
  }
  ctx.restore();
};

// --- Decorative Elements ---
const drawDecorations = (ctx, canvas, colors, colorOrder, exclusionZones, rng) => {
  // Randomized dark circles
  const darkCircleCount = Math.floor(rng.next(10, 20));
  const darkCircleOpacity = rng.next(0.05, 0.12);
  
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${darkCircleOpacity})`;
  
  for (let i = 0; i < darkCircleCount; i++) {
    let attempts = 0;
    let positioned = false;
    
    while (attempts < 30 && !positioned) {
      const size = rng.next(5, 40);
      const x = rng.next(size, canvas.width - size);
      const y = rng.next(size, canvas.height - size);
      
      if (isCirclePositionSafe(x, y, size, exclusionZones)) {
        ctx.save();
        ctx.globalAlpha = rng.next(0.2, 0.4);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        positioned = true;
      }
      attempts++;
    }
  }
  ctx.restore();

  // Randomized accent circles
  const accentCircleCount = Math.floor(rng.next(5, 12));
  const accentColor = colorOrder[Math.floor(rng.next(0, colorOrder.length))];
  
  ctx.save();
  for (let i = 0; i < accentCircleCount; i++) {
    let attempts = 0;
    let positioned = false;
    
    while (attempts < 30 && !positioned) {
      const size = rng.next(3, 20);
      const x = rng.next(size, canvas.width - size);
      const y = rng.next(size, canvas.height - size);
      
      if (isCirclePositionSafe(x, y, size, exclusionZones)) {
        ctx.save();
        ctx.globalAlpha = rng.next(0.3, 0.5);
        ctx.fillStyle = `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, ${rng.next(0.1, 0.2)})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        positioned = true;
      }
      attempts++;
    }
  }
  ctx.restore();
};

// --- Sound Wave Drawing ---
const drawSoundWaves = (ctx, canvas, colorOrder, rng) => {
  const waveColor = colorOrder[Math.floor(rng.next(0, colorOrder.length))];
  
  ctx.save();
  ctx.strokeStyle = `rgba(${waveColor.r}, ${waveColor.g}, ${waveColor.b}, ${rng.next(0.3, 0.5)})`;
  ctx.lineWidth = rng.next(1, 3);
  ctx.lineCap = "round";
  
  const waveCount = Math.floor(rng.next(3, 7));
  const baseY = rng.next(380, 420);
  
  for (let i = 0; i < waveCount; i++) {
    ctx.beginPath();
    const waveY = baseY + (i * rng.next(8, 15));
    ctx.moveTo(50, waveY);
    
    for (let x = 50; x < canvas.width - 50; x += Math.floor(rng.next(6, 12))) {
      const frequency = rng.next(0.015, 0.025) + (i * 0.005);
      const amplitude = (Math.sin((x + i * rng.next(20, 40)) * frequency) * rng.next(5, 12)) + (rng.next(-4, 4));
      ctx.lineTo(x, waveY + amplitude);
    }
    ctx.stroke();
  }
  ctx.restore();
};

// --- Music Notes Drawing ---
const drawMusicNotes = (ctx, canvas, exclusionZones, rng) => {
  const notes = ['♪', '♫', '♬', '♩', '♭', '♯'];
  const noteCount = Math.floor(rng.next(10, 20));
  
  ctx.save();
  ctx.textAlign = "center";
  
  for (let i = 0; i < noteCount; i++) {
    let attempts = 0;
    let positioned = false;
    
    while (attempts < 20 && !positioned) {
      const x = rng.next(0, canvas.width);
      const y = rng.next(0, canvas.height);
      const size = rng.next(14, 24);
      
      if (isCirclePositionSafe(x, y, size/2, exclusionZones)) {
        const note = notes[Math.floor(rng.next(0, notes.length))];
        const opacity = rng.next(0.05, 0.18);
        
        ctx.font = `${size}px Arial`;
        ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.fillText(note, x, y);
        positioned = true;
      }
      attempts++;
    }
  }
  ctx.restore();
};

// --- Vinyl Records Drawing ---
const drawVinyl = (ctx, x, y, size, opacity, rotation, colorOrder, rng) => {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  
  const vinylColor1 = colorOrder[Math.floor(rng.next(0, colorOrder.length))];
  const vinylColor2 = colorOrder[Math.floor(rng.next(0, colorOrder.length))];
  
  const vinylGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  vinylGradient.addColorStop(0, `rgba(${vinylColor1.r}, ${vinylColor1.g}, ${vinylColor1.b}, 0.3)`);
  vinylGradient.addColorStop(1, `rgba(${vinylColor2.r}, ${vinylColor2.g}, ${vinylColor2.b}, 0.2)`);
  
  ctx.fillStyle = vinylGradient;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();

  const grooveCount = Math.floor(rng.next(3, 8));
  for (let i = 0; i < grooveCount; i++) {
    const radius = size * (0.2 + (i / grooveCount) * 0.6);
    ctx.strokeStyle = `rgba(255, 255, 255, ${rng.next(0.1, 0.3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const centerColor = colorOrder[Math.floor(rng.next(0, colorOrder.length))];
  ctx.fillStyle = `rgba(${centerColor.r}, ${centerColor.g}, ${centerColor.b}, ${rng.next(0.6, 0.9)})`;
  ctx.beginPath();
  ctx.arc(0, 0, size * rng.next(0.08, 0.15), 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
};

// --- Smart Vinyl Placement ---
const placeVinylsSafely = (vinylCount, exclusionZones, canvas, rng) => {
  const vinylPositions = [];
  const maxAttempts = 50;
  
  for (let i = 0; i < vinylCount; i++) {
    let attempts = 0;
    let position = null;
    
    while (attempts < maxAttempts && !position) {
      const size = rng.next(25, 70);
      const x = rng.next(size + 20, canvas.width - size - 20);
      const y = rng.next(size + 20, canvas.height - size - 20);
      
      if (isCirclePositionSafe(x, y, size, exclusionZones)) {
        let tooClose = false;
        for (const existing of vinylPositions) {
          const distance = Math.sqrt(Math.pow(x - existing.x, 2) + Math.pow(y - existing.y, 2));
          const minDistance = size + existing.size + 10;
          if (distance < minDistance) {
            tooClose = true;
            break;
          }
        }
        
        if (!tooClose) {
          position = {
            x,
            y,
            size,
            opacity: rng.next(0.3, 0.6),
            rotation: rng.next(0, Math.PI * 2)
          };
        }
      }
      attempts++;
    }
    
    if (position) {
      vinylPositions.push(position);
    }
  }
  
  return vinylPositions;
};

// --- Band Image Drawing ---
const drawBandImage = async (ctx, canvas, band, colors) => {
  try {
    const bandImage = await loadImageSafe(band.bandImage);
    if (bandImage) {
      const imageSize = 280;
      const imageX = canvas.width - 180;
      const imageY = 280;

      ctx.save();
      
      ctx.shadowColor = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.6)`;
      ctx.shadowBlur = 25;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      
      ctx.beginPath();
      ctx.arc(imageX, imageY, imageSize / 2, 0, Math.PI * 2);
      ctx.clip();
      
      ctx.drawImage(
        bandImage, 
        imageX - imageSize / 2, 
        imageY - imageSize / 2, 
        imageSize, 
        imageSize
      );
      
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(imageX, imageY, imageSize / 2 + 3, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.8)`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(imageX, imageY, imageSize / 2 + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  } catch (bandImageError) {
    console.warn("Band image loading failed:", bandImageError);
  }
};

// --- Text Drawing ---
const drawText = async (ctx, canvas, band, matchPercentage, colors) => {
  const centerX = canvas.width / 2 - 100;
  const centerY = canvas.height / 2 - 40;

  ctx.miterLimit = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  
  const hypeTexts = [
    "BOUT TO GO FERAL FOR",
    "READY TO CRY-SING WITH", 
    "GOBLIN MODE ACTIVATED FOR",
    "BONES READY FOR",
    "EMOTIONAL SUPPORT BAND:",
    "AGGRESSIVELY SWAYING TO",
    "HEART BELONGS TO",
    "RUNNING ON ADRENALINE FOR",
    "GONNA LOSE MY SHIT FOR",
    "SPIRITUAL AWAKENING WITH",
    "FULL SEND MODE FOR",
    "UNHINGED ENERGY FOR"
  ];
  
  const selectedHype = hypeTexts[Math.floor(Math.random() * hypeTexts.length)];
  
  ctx.textAlign = "center";
  
  // Hype text
  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
  ctx.lineWidth = 5;
  ctx.font = "bold 32px Arial, sans-serif";
  ctx.strokeText(selectedHype, centerX, 140);
  
  ctx.fillStyle = "#ffffff";
  ctx.fillText(selectedHype, centerX, 140);
  ctx.restore();

  // Band name
  ctx.save();
  ctx.font = "400 84px Arial, sans-serif";
  let fontSize = 84;
  while (
    ctx.measureText(band.name.toUpperCase()).width > canvas.width - 500 &&
    fontSize > 36
  ) {
    fontSize -= 4;
    ctx.font = `400 ${fontSize}px Arial, sans-serif`;
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.lineWidth = 12;
  ctx.strokeText(band.name.toUpperCase(), centerX + 2, centerY - 20);
  
  ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
  ctx.lineWidth = 8;
  ctx.strokeText(band.name.toUpperCase(), centerX, centerY - 20);
  
  ctx.fillStyle = "#ffffff";
  ctx.fillText(band.name.toUpperCase(), centerX, centerY - 20);
  ctx.restore();

  // Load and draw Faux logo
  try {
    const fauxLogo = await loadImageSafe("https://res.cloudinary.com/dmrkor9s4/image/upload/v1749730814/atfaux8_dl5dzn.png");
    if (fauxLogo) {
      const logoScale = 0.4;
      const logoWidth = 550 * logoScale;
      const logoHeight = 170 * logoScale;
      const logoX = centerX - logoWidth / 2;
      const logoY = centerY + 20;
      
      ctx.drawImage(fauxLogo, logoX, logoY, logoWidth, logoHeight);
    }
  } catch (logoError) {
    console.warn("Faux logo loading failed:", logoError);
  }

  // Match percentage box
  const boxWidth = 320;
  const boxHeight = 80;
  const boxX = centerX - boxWidth / 2;
  const boxY = centerY + 110;

  ctx.save();
  const boxGradient = ctx.createLinearGradient(boxX, boxY, boxX + boxWidth, boxY + boxHeight);
  boxGradient.addColorStop(0, "rgba(0, 0, 0, 0.9)");
  boxGradient.addColorStop(1, "rgba(0, 0, 0, 0.7)");
  
  ctx.fillStyle = boxGradient;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  
  ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.9)`;
  ctx.lineWidth = 3;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  
  ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.4)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 2, boxY + 2, boxWidth - 4, boxHeight - 4);

  ctx.font = "400 42px Arial, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`${matchPercentage}% MATCH`, centerX, centerY + 165);
  ctx.restore();

  const bottomTexts = [
    "Find your Faux must-see at",
    "Find your fest obsession at",
    "Find your weekend destroyer at",
    "Find your pit destiny at",
    "Find your Faux chaos at",
    "Find your must-see mayhem at"
  ];
  
  const selectedBottom = bottomTexts[Math.floor(Math.random() * bottomTexts.length)];
  
  ctx.save();
  ctx.font = "500 24px Arial, sans-serif";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineWidth = 4;
  ctx.strokeText(selectedBottom, canvas.width / 2, canvas.height - 80);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(selectedBottom, canvas.width / 2, canvas.height - 80);

  ctx.font = "400 38px Arial, sans-serif";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.lineWidth = 5;
  ctx.strokeText("dullmace.lol", canvas.width / 2, canvas.height - 35);
  ctx.fillStyle = `rgb(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b})`;
  ctx.fillText("dullmace.lol", canvas.width / 2, canvas.height - 35);
  ctx.restore();

  // Decorative lines
  ctx.save();
  ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.6)`;
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.moveTo(centerX - 120, 170);
  ctx.lineTo(centerX + 120, 170);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(centerX - 120, centerY + 210);
  ctx.lineTo(centerX + 120, centerY + 210);
  ctx.stroke();
  ctx.restore();
};

// --- Canvas to Blob Conversion ---
const canvasToBlob = (canvas) => {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          console.log("Enhanced share image generated successfully, size:", blob.size);
          resolve(blob);
        } else {
          console.error("Failed to create share image blob");
          resolve(null);
        }
      },
      "image/png",
      0.9
    );
  });
};

// --- Main Generate Share Image Function ---
const generateShareImage = async (band, matchPercentage, token, userProfile = null) => {
  try {
    await ensureFontsLoaded();
    
    console.log("Starting share image generation for:", band.name);
    
    const { canvas, ctx } = createCanvas();
    
    // Get colors from Spotify album art
    let colors = {
      primary: { r: 255, g: 120, b: 60 },
      secondary: { r: 50, g: 200, b: 100 },
      accent: { r: 255, g: 200, b: 50 }
    };

    if (token && band.spotifyLink) {
      try {
        const spotifyId = band.spotifyLink.split("/").pop();
        const albumArtUrl = await getAlbumArtFromSpotify(token, spotifyId);
        if (albumArtUrl) {
          colors = await extractColorsFromImage(albumArtUrl);
        }
      } catch (colorError) {
        console.warn("Color extraction failed, using defaults:", colorError);
      }
    }

    // Create randomization seed
    const userSeed = userProfile ? userProfile.id : 'anonymous';
    const timeSeed = Math.floor(Date.now() / (1000 * 60 * 30));
    const bandSeed = band.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const combinedSeed = `${bandSeed}-${userSeed}-${timeSeed}`;
    
    const rng = new SeededRandom(combinedSeed);
    const exclusionZones = getExclusionZones(canvas);

    // Draw all elements
    const colorOrder = drawBackground(ctx, canvas, colors, rng);
    drawTextures(ctx, canvas, rng);
    drawDecorations(ctx, canvas, colors, colorOrder, exclusionZones, rng);
    drawSoundWaves(ctx, canvas, colorOrder, rng);
    drawMusicNotes(ctx, canvas, exclusionZones, rng);

    // Draw vinyl records
    const vinylCount = Math.floor(rng.next(2, 5));
    const vinylPositions = placeVinylsSafely(vinylCount, exclusionZones, canvas, rng);
    vinylPositions.forEach(vinyl => {
      drawVinyl(ctx, vinyl.x, vinyl.y, vinyl.size, vinyl.opacity, vinyl.rotation, colorOrder, rng);
    });

    // Draw band image and text
    await drawBandImage(ctx, canvas, band, colors);
    await drawText(ctx, canvas, band, matchPercentage, colors);

    return await canvasToBlob(canvas);
    
  } catch (error) {
    console.error("Error in generateShareImage:", error);
    return null;
  }
};

// --- React Components ---

const LoginScreen = ({ onLogin }) => (
  <div className="container login-container">
    <div className="logo-section">
      <div className="vinyl-icon">🎵</div>
      <h1>Who's Your Must-See Band at Faux?</h1>
    </div>
    <p className="subtitle">
      With so many incredible acts at Faux, which one should you make sure not
      to miss? Connect with Spotify to find your perfect match.
    </p>

    <button onClick={onLogin} className="spotify-button">
      <span className="spotify-icon">♪</span>
      Connect with Spotify
    </button>
    <div className="features-preview">
      <div className="feature-item">🎯 Find your must-see act</div>
      <div className="feature-item">🎶 Based on your music taste</div>
      <div className="feature-item">📱 Share your pick</div>
    </div>
  </div>
);

const TimeRangeSelector = ({ onSelect }) => (
  <div className="container time-selector">
    <h2>Analyzing Your Taste...</h2>
    <p>First, pick a time frame for your top artists:</p>
    <div className="time-range-buttons">
      <button
        onClick={() => onSelect("short_term")}
        className="time-button short"
      >
        <span className="time-label">Last Month</span>
        <span className="time-desc">Recent obsessions</span>
      </button>
      <button
        onClick={() => onSelect("medium_term")}
        className="time-button medium"
      >
        <span className="time-label">Last 6 Months</span>
        <span className="time-desc">Current favorites</span>
      </button>
      <button
        onClick={() => onSelect("long_term")}
        className="time-button long"
      >
        <span className="time-label">All Time</span>
        <span className="time-desc">Lifetime classics</span>
      </button>
    </div>
    <p className="loading-text">Consulting the punk rock oracle...</p>
  </div>
);

const LoadingSpinner = ({ text }) => (
  <div className="container loading-container">
    <div className="loading-animation">
      <div className="vinyl-record">
        <div className="vinyl-center"></div>
        <div className="vinyl-groove"></div>
      </div>
    </div>
    <h2>{text}</h2>
    <p className="loading-text">Please wait...</p>
  </div>
);

const GenreTags = ({ genres }) => (
  <div className="genre-tags">
    {genres
      .split(" - ")
      .slice(0, 3)
      .map((genre, index) => (
        <span key={index} className="genre-tag">
          {genre}
        </span>
      ))}
  </div>
);

const ShareButtons = ({ band, token }) => { 
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [tweetText, setTweetText] = useState('');
  const [shareImageBlob, setShareImageBlob] = useState(null);
  const [error, setError] = useState(null);
  const shareUrl = "https://dullmace.lol";
  
  // Random tweet messages
  const tweetMessages = [
    `I'm going to go SO hard for ${band.name} at Faux this weekend! Find out who you should lose it for: ${shareUrl}`,
    `I'm gonna lose my shit for ${band.name}! See who the Faux fest gods say you need to see: ${shareUrl}`,
    `Watch out for me in ${band.name}'s pit! Don't miss your own perfect Faux match: ${shareUrl}`,
    `My Spotify just told me to prepare for a spiritual awakening with ${band.name} at Faux. Get your own destiny revealed: ${shareUrl}`,
    `Pretty sure my soulmate is actually ${band.name}, and I'm seeing them at Faux! Discover your true fest love: ${shareUrl}`,
    `Warning: May spontaneously combust during ${band.name}'s set at Faux. Who's gonna make you explode? Find out: ${shareUrl}`,
    `My internal algorithm (and this site) says ${band.name} is about to own my entire weekend at Faux. Uncover your Faux must-see: ${shareUrl}`,
    `Canceling all other plans to be front and center for ${band.name} at Faux. Who's your can't-miss act? See here: ${shareUrl}`,
    `Prepare for maximum headbanging with ${band.name} at Faux. What band is calling your name? Get your match: ${shareUrl}`,
    `My future involves a lot of sweat and ${band.name} at Faux. Who's your fest forecast looking like? Discover now: ${shareUrl}`,
    `My Spotify just exposed me: I'm meant to cry-sing with ${band.name} at Faux. Find your cathartic concert: ${shareUrl}`,
    `I'm not saying ${band.name} is my entire personality, but I'm going to Faux for them. Who are you at Faux for? Find out: ${shareUrl}`,
    `My bones are ready to be rearranged in ${band.name}'s pit at Faux. Find out who's gonna wreck your weekend (in a good way): ${shareUrl}`,
    `Getting my angst on with ${band.name} at Faux. Who's your emotional support band? Discover here: ${shareUrl}`,
    `I've been training for this moment: aggressively swaying to ${band.name} at Faux. Find your workout buddy: ${shareUrl}`,
    `Brace yourselves, because I'm about to go full goblin mode for ${band.name} at Faux. Find your destiny: ${shareUrl}`,
    `This weekend, my heart belongs to ${band.name} at Faux. Who's got your heart? Find out: ${shareUrl}`,
    `I'm ready to shed a single tear (or maybe a lot) during ${band.name}'s set at Faux. Find your tear-jerker: ${shareUrl}`,
    `Forget sleep, I'm running on pure adrenaline and the promise of ${band.name} at Faux. What's fueling you? Discover now: ${shareUrl}`
  ];

  const getRandomTweetMessage = () => {
    return tweetMessages[Math.floor(Math.random() * tweetMessages.length)];
  };

// Generate tweet automatically on component mount
  useEffect(() => {
    const generateInitialContent = async () => {
      setIsGeneratingImage(true);
      setError(null);
      try {
        const randomTweet = getRandomTweetMessage();
        setTweetText(randomTweet);

        console.log("Generating share image for band:", band);
        const matchPercentage = Math.min(Math.round((band.score / 10) * 100), 100);
        const imageBlob = await generateShareImage(band, matchPercentage, token);
        
        if (imageBlob) {
          setShareImageBlob(imageBlob);
          console.log("Share image generated successfully");
        } else {
          console.error("Share image generation returned null");
          setError("Failed to generate share image. Please check the console for details.");
        }
      } catch (error) {
        console.error("Error generating initial content:", error);
        setError(`Error generating content: ${error.message}`);
      } finally {
        setIsGeneratingImage(false);
      }
    };

    generateInitialContent();
  }, [band, token]);

  const regenerateTweet = () => {
    const newTweet = getRandomTweetMessage();
    setTweetText(newTweet);
  };

  const handleTweet = () => {
    if (!tweetText) return;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    window.open(twitterUrl, "_blank");
  };

  const handleSaveImage = () => {
    if (!shareImageBlob) return;
    
    const fileName = `faux-must-see-${band.name
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase()}.png`;
    
    const url = URL.createObjectURL(shareImageBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyTweet = async () => {
    if (!tweetText) return;
    try {
      await navigator.clipboard.writeText(tweetText);
      alert("Tweet copied to clipboard!");
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy tweet. Please try again.");
    }
  };

  return (
    <div className="share-section">
      {isGeneratingImage ? (
        <div className="generating-content">
          <div className="creating-spinner"></div>
          <p>Generating your share content...</p>
        </div>
      ) : error ? (
        <div className="error-content">
          <p className="error-message">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="retry-button"
          >
            Try Again
          </button>
        </div>
      ) : (
        <div className="share-content">
          <div className="tweet-preview">
            <div className="tweet-header">
              <svg className="twitter-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
              </svg>
              <span className="tweet-label">Ready to Tweet</span>
              <button onClick={regenerateTweet} className="regenerate-mini-button" title="Generate new tweet">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
              </button>
            </div>
            <div className="tweet-content">
              <div className="tweet-text">
                {tweetText}
              </div>
            </div>
            <div className="tweet-actions">
              <button onClick={handleTweet} className="tweet-button">
                <svg className="tweet-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/>
                </svg>
                Tweet This
              </button>
              <button onClick={handleCopyTweet} className="copy-tweet-button">
                <svg className="copy-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                </svg>
                Copy Text
              </button>
            </div>
          </div>

          <div className="image-instructions">
            <div className="instruction-header">
              <svg className="image-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              <span className="instruction-label">Add Your Share Image</span>
            </div>
            <p className="instruction-text">
              Copy/paste the share image above into your tweet, or save it to your device first.
            </p>
            <button 
              onClick={handleSaveImage} 
              className="save-image-button"
              disabled={!shareImageBlob}
            >
              <svg className="download-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
              Save Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const TwinCard = ({ band, token }) => {
  const [playlistUrl, setPlaylistUrl] = useState(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState(null);
  const [coverUploadFailed, setCoverUploadFailed] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState(null);
  const [generatingShareImage, setGeneratingShareImage] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [userTopGenres, setUserTopGenres] = useState([]);
  const [artistSpotifyGenres, setArtistSpotifyGenres] = useState([]);

  if (!band) return null;

  const spotifyId = band.spotifyLink.split("/").pop();
  const matchPercentage = Math.min(Math.round((band.score / 10) * 100), 100);

  const reasonsList = band.reason
    .replace("Because ", "")
    .split(" and ")
    .map(
      (reason) =>
        reason.charAt(0).toUpperCase() + reason.slice(1).replace(".", "")
    );

  // Fetch user profile, genres, and generate share image on component mount
  useEffect(() => {
    const fetchUserAndGenerateImage = async () => {
      let profile = null;
      let userGenres = [];
      let spotifyGenres = [];
      
      // Fetch user profile and genres if token is available
      if (token) {
        try {
          const userRes = await fetch("https://api.spotify.com/v1/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (userRes.ok) {
            profile = await userRes.json();
            setUserProfile(profile);
          }

          // Get user's top genres
          const artistsRes = await fetch(
            `https://api.spotify.com/v1/me/top/artists?limit=20&time_range=medium_term`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (artistsRes.ok) {
            const topArtistsData = await artistsRes.json();
            const allGenres = topArtistsData.items?.flatMap(artist => artist.genres) || [];
            // Get top 5 most common genres
            const genreCounts = {};
            allGenres.forEach(genre => {
              genreCounts[genre] = (genreCounts[genre] || 0) + 1;
            });
            userGenres = Object.entries(genreCounts)
              .sort(([,a], [,b]) => b - a)
              .slice(0, 5)
              .map(([genre]) => genre);
            setUserTopGenres(userGenres);
          }

          // Get artist's Spotify genres
          if (band.spotifyLink) {
            const artistRes = await fetch(
              `https://api.spotify.com/v1/artists/${spotifyId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (artistRes.ok) {
              const artistData = await artistRes.json();
              spotifyGenres = artistData.genres || [];
              setArtistSpotifyGenres(spotifyGenres);
            }
          }
        } catch (error) {
          console.error("Error fetching user profile/genres:", error);
        }
      }

      // Generate share image with user profile
      try {
        const imageBlob = await generateShareImage(band, matchPercentage, token, profile);
        if (imageBlob) {
          const imageUrl = URL.createObjectURL(imageBlob);
          setShareImageUrl(imageUrl);
        }
      } catch (error) {
        console.error("Error generating share image:", error);
      } finally {
        setGeneratingShareImage(false);
      }
    };

    fetchUserAndGenerateImage();

    // Cleanup function to revoke object URL
    return () => {
      if (shareImageUrl) {
        URL.revokeObjectURL(shareImageUrl);
      }
    };
  }, [band, matchPercentage, token]);


  const handleCreatePlaylist = async () => {
    if (!token || creatingPlaylist) return;

    setCreatingPlaylist(true);
    setPlaylistError(null);
    setCoverUploadFailed(false);

    try {
      const url = await createPlaylist(token, band.name, spotifyId, matchPercentage, band);

      if (url) {
        setPlaylistUrl(url);
        setTimeout(() => {
          if (console.error.toString().includes("Cover upload failed")) {
            setCoverUploadFailed(true);
          }
        }, 1000);
      } else {
        setPlaylistError("Failed to create playlist");
      }
    } catch (error) {
      console.error("Playlist creation error:", error);
      if (error.message.includes("401")) {
        setPlaylistError("Permission denied. Please log in again.");
      } else {
        setPlaylistError("Failed to create playlist. Please try again.");
      }
    } finally {
      setCreatingPlaylist(false);
    }
  };

  return (
    <div className="result-card">
      <div className="card-header">
        <div className="match-badge">
          <span className="match-percentage">{matchPercentage}% Match</span>
        </div>
      </div>
      
      <div className="band-image-main">
        <img
          src={band.bandImage}
          alt={`Band photo of ${band.name}`}
          className="band-image-hero"
        />
      </div>
      
      <h1 className="band-name">{band.name}</h1>
      <p className="location">{band.bandLocation}</p>
      
      {/* Share image section */}
      <div className="share-image-container">
        {generatingShareImage ? (
          <div className="share-image-loading">
            <div className="creating-spinner"></div>
            <p>Generating your share image...</p>
          </div>
        ) : shareImageUrl ? (
          <img
            src={shareImageUrl}
            alt={`Share image for ${band.name}`}
            className="generated-share-image"
          />
        ) : (
          <div className="share-image-error">
            <p>Share image couldn't be generated</p>
          </div>
        )}
      </div>

      <ShareButtons band={band} token={token} />

      <div className="reason">
        <strong>Why you'll love them:</strong>
        <ul>
          {reasonsList.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
      
      <iframe
        src={`https://open.spotify.com/embed/artist/${spotifyId}?utm_source=generator&theme=0`}
        width="100%"
        height="152"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
      ></iframe>
      <div className="action-buttons">
        {token && (
          <div className="playlist-section">
            <button
              onClick={handleCreatePlaylist}
              disabled={creatingPlaylist}
              className="playlist-button"
            >
              {creatingPlaylist ? (
                <>
                  <div className="creating-spinner"></div>
                  Creating Custom Playlist...
                </>
              ) : playlistUrl ? (
                <>
                  <span className="playlist-icon">✅</span>
                  Playlist Created!
                </>
              ) : (
                <>
                  <span className="playlist-icon"></span>
                  Create Spotify Playlist
                </>
              )}
            </button>

            {playlistUrl && (
              <a
                href={playlistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="open-playlist-button"
              >
                <span className="playlist-icon">🎵</span>
                Open in Spotify
              </a>
            )}

            {coverUploadFailed && (
              <p className="playlist-warning">
                Playlist created successfully, but custom cover couldn't be
                uploaded.
              </p>
            )}

            {playlistError && <p className="playlist-error">{playlistError}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

const ResultScreen = ({ matches, token }) => {
  const [displayedMatchIndex, setDisplayedMatchIndex] = useState(0);
  const [showAllRunners, setShowAllRunners] = useState(false);

  if (!matches || matches.length === 0 || matches[0].score === 0) {
    return (
      <div className="container no-match">
        <div className="no-match-icon">🎸</div>
        <h2>No Clear Match Found...</h2>
        <p>
          Your taste is too underground even for us! But that's what Faux is all
          about. Dive into the lineup and discover a new favorite.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="retry-button"
        >
          Try Different Time Range
        </button>
      </div>
    );
  }

  const currentTwin = matches[displayedMatchIndex];
  const runnersToShow = showAllRunners
    ? matches.slice(1, 10)
    : matches.slice(1, 4);
  const isAlreadyFan = matches[0].score >= 1000;

  const handleFindNewTwin = () => {
    const discoveryIndex = matches.findIndex((band) => band.score < 1000);
    if (discoveryIndex !== -1) {
      setDisplayedMatchIndex(discoveryIndex);
    }
  };

  const handleRunnerUpClick = (band) => {
    const index = matches.indexOf(band);
    setDisplayedMatchIndex(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="container results-container">
      {displayedMatchIndex === 0 ? (
        <h2 className="result-title">You should definitely see...</h2>
      ) : (
        <h2 className="result-title">You should also check out...</h2>
      )}

      <TwinCard band={currentTwin} token={token} />

      {isAlreadyFan && displayedMatchIndex === 0 && (
        <button onClick={handleFindNewTwin} className="discovery-button">
          <span className="discovery-icon">🔍</span>
          Already a fan? Find a new discovery!
        </button>
      )}

      <div className="runners-up">
        <h3>Other Acts You'd Love</h3>
        <div className="runners-grid">
          {runnersToShow.map(
            (band) =>
              band.score > 0 && (
                <div
                  key={band.name}
                  className="runner-up-card"
                  onClick={() => handleRunnerUpClick(band)}
                >
                  <img
                    src={band.bandImage}
                    alt={band.name}
                    className="runner-up-image"
                  />
                  <div className="runner-up-info">
                    <p className="runner-up-name">{band.name}</p>
                    <p className="runner-up-location">{band.bandLocation}</p>
                  </div>
                  <span className="match-score">
                    {Math.min(Math.round((band.score / 10) * 100), 100)}%
                  </span>
                </div>
              )
          )}
        </div>
        {matches.length > 4 && (
          <button
            onClick={() => setShowAllRunners(!showAllRunners)}
            className="show-more-button"
          >
            {showAllRunners ? "Show Less" : "Show More Acts"}
          </button>
        )}
      </div>

      <button
        onClick={() => window.location.reload()}
        className="start-over-button"
      >
        Start Over
      </button>
    </div>
  );
};

// --- Main App Component ---

function App() {
  const [token, setToken] = useState(null);
  const [matches, setMatches] = useState([]);
  const [view, setView] = useState("login");

  const handleLogin = () => {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
    const redirectUri = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
    // Add the ugc-image-upload scope for playlist cover uploads
    const scopes =
      "user-top-read playlist-modify-private playlist-modify-public ugc-image-upload";

    // Generate a random state for security
    const state = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem("spotify_auth_state", state);

    const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${encodeURIComponent(
      scopes
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    window.location.href = authUrl;
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");
    const error = urlParams.get("error");

    if (error) {
      console.error("Spotify authorization error:", error);
      setView("login");
      window.history.replaceState({}, null, "/");
      return;
    }

    if (code && !token) {
      // Validate state parameter
      const savedState = sessionStorage.getItem("spotify_auth_state");
      if (state !== savedState) {
        console.error("State parameter mismatch - possible CSRF attack");
        alert("Authentication failed due to security check. Please try again.");
        setView("login");
        window.history.replaceState({}, null, "/");
        return;
      }

      // Clean up
      sessionStorage.removeItem("spotify_auth_state");
      setView("authenticating");
      window.history.replaceState({}, null, "/");

      fetch(`/api/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code, state }),
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          if (data.access_token) {
            setToken(data.access_token);
            setView("select_time");
          } else {
            console.error("Token exchange failed:", data);
            alert("Authentication failed. Please try again.");
            setView("login");
          }
        })
        .catch((err) => {
          console.error("Callback fetch error:", err);
          alert("Authentication failed. Please try again.");
          setView("login");
        });
    }
  }, [token]);

  const startAnalysis = (timeRange) => {
    if (token) {
      setView("analyzing");
      getRankedMatches(token, timeRange).then((rankedMatches) => {
        setMatches(rankedMatches);
        setView("results");
      });
    } else {
      console.error("Tried to analyze without a token!");
      setView("login");
    }
  };

  const renderView = () => {
    switch (view) {
      case "authenticating":
        return <LoadingSpinner text="Authenticating with Spotify..." />;
      case "select_time":
        return <TimeRangeSelector onSelect={startAnalysis} />;
      case "analyzing":
        return <LoadingSpinner text="Analyzing your musical taste..." />;
      case "results":
        return <ResultScreen matches={matches} token={token} />;
      case "login":
      default:
        return <LoginScreen onLogin={handleLogin} />;
    }
  };

  return <main className="app-main">{renderView()}</main>;
}

export default App;