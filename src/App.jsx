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

  // Extract user genres for later use
  const allUserGenres = topArtists.flatMap((artist) => artist.genres);
  const genreCounts = {};
  allUserGenres.forEach(genre => {
    genreCounts[genre] = (genreCounts[genre] || 0) + 1;
  });
  const userTopGenres = Object.entries(genreCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([genre]) => genre);

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

  return {
    matches: scoredBands.sort((a, b) => b.score - a.score),
    userGenres: userTopGenres,
    timeRange: timeRange
  };
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

const generateShareImage = async (band, matchPercentage, token, userProfile = null) => {
  return new Promise(async (resolve) => {
    try {
      console.log("Starting share image generation for:", band.name);
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        console.error("Failed to get canvas context");
        resolve(null);
        return;
      }

      canvas.width = 1200;
      canvas.height = 630;

      let colors = {
        primary: { r: 255, g: 120, b: 60 },
        secondary: { r: 50, g: 200, b: 100 },
        accent: { r: 255, g: 200, b: 50 }
      };


      // Get colors from Spotify album art
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

      // Create radial gradient background
      const gradient = ctx.createRadialGradient(
        canvas.width * 0.3, canvas.width * 0.3, 0,
        canvas.width * 0.7, canvas.height * 0.7, canvas.width
      );
      gradient.addColorStop(0, `rgba(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b}, 0.9)`);
      gradient.addColorStop(0.3, `rgba(${colors.secondary.r}, ${colors.secondary.g}, ${colors.secondary.b}, 0.8)`);
      gradient.addColorStop(0.6, `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.85)`);
      gradient.addColorStop(1, `rgba(${colors.primary.r * 0.8}, ${colors.primary.g * 0.8}, ${colors.primary.b * 0.8}, 0.9)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Add noise texture pattern
      ctx.fillStyle = `rgba(255, 255, 255, 0.12)`;
      for (let i = 0; i < canvas.width; i += 2) {
        for (let j = 0; j < canvas.height; j += 2) {
          if (Math.random() > 0.88) {
            ctx.fillRect(i, j, Math.random() > 0.5 ? 1 : 2, Math.random() > 0.5 ? 1 : 2);
          }
        }
      }

      // Add random lines for texture
      ctx.strokeStyle = `rgba(255, 255, 255, 0.06)`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        const startX = Math.random() * canvas.width;
        const startY = Math.random() * canvas.height;
        const length = 50 + Math.random() * 100;
        const angle = Math.random() * Math.PI * 2;
        
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(startX + Math.cos(angle) * length, startY + Math.sin(angle) * length);
        ctx.stroke();
      }

      // Add random dark circles for depth
      ctx.fillStyle = `rgba(0, 0, 0, 0.08)`;
      for (let i = 0; i < 15; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const size = 10 + Math.random() * 30;
        
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Add accent colored circles
      ctx.fillStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.15)`;
      for (let i = 0; i < 8; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const size = 5 + Math.random() * 15;
        
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // === DYNAMIC VISUAL ELEMENTS ===
      
      // Add sound wave visualization
      const drawSoundWaves = () => {
        ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.4)`;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          const baseY = 400 + (i * 12);
          ctx.moveTo(50, baseY);
          
          for (let x = 50; x < canvas.width - 50; x += 8) {
            const frequency = 0.02 + (i * 0.005);
            const amplitude = (Math.sin((x + i * 30) * frequency) * (8 + i * 3)) + (Math.random() * 6 - 3);
            ctx.lineTo(x, baseY + amplitude);
          }
          ctx.stroke();
        }
      };

      // Add floating music notes
      const drawMusicNotes = () => {
        const notes = ['♪', '♫', '♬', '♩', '♭', '♯'];
        ctx.font = "20px Arial";
        ctx.textAlign = "center";
        
        for (let i = 0; i < 15; i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          const note = notes[Math.floor(Math.random() * notes.length)];
          const opacity = 0.08 + Math.random() * 0.15;
          const size = 16 + Math.random() * 8;
          
          ctx.font = `${size}px Arial`;
          ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.fillText(note, x, y);
        }
      };

      drawSoundWaves();
      drawMusicNotes();
      
      // Load and draw user profile image and name
      if (userProfile) {
        try {
          // Always show the username, even if no image
          const userName = userProfile.display_name || userProfile.id;
          
          if (userProfile.images && userProfile.images.length > 0) {
            // Try to load and show profile image
            const userImage = await loadImage(userProfile.images[0].url);
            if (userImage) {
              const userImageSize = 80;
              const userImageX = 60;
              const userImageY = 60;

              ctx.save();
              
              ctx.beginPath();
              ctx.arc(userImageX, userImageY, userImageSize / 2, 0, Math.PI * 2);
              ctx.clip();
              
              ctx.drawImage(
                userImage, 
                userImageX - userImageSize / 2, 
                userImageY - userImageSize / 2, 
                userImageSize, 
                userImageSize
              );
              
              ctx.restore();

              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(userImageX, userImageY, userImageSize / 2 + 2, 0, Math.PI * 2);
              ctx.stroke();

              // Username below image
              ctx.font = "600 18px Arial, sans-serif";
              ctx.textAlign = "left";
              ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
              ctx.lineWidth = 3;
              ctx.strokeText(`@${userName}`, 20, 130);
              ctx.fillStyle = "#ffffff";
              ctx.fillText(`@${userName}`, 20, 130);
            } else {
              // No image loaded, show username only with icon
              ctx.font = "600 18px Arial, sans-serif";
              ctx.textAlign = "left";
              
              // Draw a simple user icon
              ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
              ctx.beginPath();
              ctx.arc(40, 60, 25, 0, Math.PI * 2);
              ctx.fill();
              
              ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
              ctx.font = "24px Arial, sans-serif";
              ctx.textAlign = "center";
              ctx.fillText("👤", 40, 68);
              
              // Username
              ctx.font = "600 18px Arial, sans-serif";
              ctx.textAlign = "left";
              ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
              ctx.lineWidth = 3;
              ctx.strokeText(`@${userName}`, 20, 100);
              ctx.fillStyle = "#ffffff";
              ctx.fillText(`@${userName}`, 20, 100);
            }
          } else {
            // No profile image available, show username only with icon
            ctx.font = "600 18px Arial, sans-serif";
            ctx.textAlign = "left";
            
            // Draw a simple user icon
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.beginPath();
            ctx.arc(40, 60, 25, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
            ctx.font = "24px Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("👤", 40, 68);
            
            // Username
            ctx.font = "600 18px Arial, sans-serif";
            ctx.textAlign = "left";
            ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
            ctx.lineWidth = 3;
            ctx.strokeText(`@${userName}`, 20, 100);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(`@${userName}`, 20, 100);
          }
        } catch (userImageError) {
          console.warn("User profile display failed:", userImageError);
        }
      }

      // Load and draw band image
      try {
        const bandImage = await loadImage(band.bandImage);
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
        }
      } catch (bandImageError) {
        console.warn("Band image loading failed:", bandImageError);
      }

      // Draw vinyl records as decorative elements
      const drawVinyl = (x, y, size, opacity, rotation = 0) => {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(x, y);
        ctx.rotate(rotation);
        
        const vinylGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
        vinylGradient.addColorStop(0, `rgba(${colors.secondary.r}, ${colors.secondary.g}, ${colors.secondary.b}, 0.3)`);
        vinylGradient.addColorStop(1, `rgba(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b}, 0.2)`);
        
        ctx.fillStyle = vinylGradient;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();

        for (let radius = size * 0.2; radius < size; radius += size * 0.08) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 - (radius / size) * 0.2})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.8)`;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      };

      drawVinyl(200, 100, 60, 0.5, 0.3);
      drawVinyl(canvas.width - 100, canvas.height - 100, 60, 0.5, -0.5);
      drawVinyl(150, canvas.height - 80, 35, 0.4, 1.2);

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
      
      // Hype text (moved up from 160 to 140)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
      ctx.lineWidth = 5;
      ctx.font = "700 32px Arial, sans-serif";
      ctx.strokeText(selectedHype, centerX, 140);
      
      ctx.fillStyle = "#ffffff";
      ctx.fillText(selectedHype, centerX, 140);

      // Band name
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

      // Load and draw Faux logo
      try {
        const fauxLogo = await loadImage("https://res.cloudinary.com/dmrkor9s4/image/upload/v1749730814/atfaux8_dl5dzn.png");
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

      const bottomTexts = [
        "Find your Faux must-see at",
        "Find your fest obsession at",
        "Find your weekend destroyer at",
        "Find your pit destiny at",
        "Find your Faux chaos at",
        "Find your must-see mayhem at"
      ];
      
      const selectedBottom = bottomTexts[Math.floor(Math.random() * bottomTexts.length)];
      
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

      // Decorative lines (moved up from 190 to 170)
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
    } catch (error) {
      console.error("Error in generateShareImage:", error);
      resolve(null);
    }
  });
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

  // Genre connection logic
  const getGenreConnections = () => {
    const jsonGenres = band.bandGenre ? band.bandGenre.split(' - ') : [];
    const combinedArtistGenres = [...new Set([...jsonGenres, ...artistSpotifyGenres])];
    
    // Find shared genres between user and artist
    const sharedGenres = userTopGenres.filter(userGenre => 
      combinedArtistGenres.some(artistGenre => {
        const userGenreLower = userGenre.toLowerCase();
        const artistGenreLower = artistGenre.toLowerCase();
        
        return artistGenreLower.includes(userGenreLower) || 
               userGenreLower.includes(artistGenreLower) ||
               // Genre keyword matching
               (userGenreLower.includes('rock') && artistGenreLower.includes('rock')) ||
               (userGenreLower.includes('pop') && artistGenreLower.includes('pop')) ||
               (userGenreLower.includes('indie') && artistGenreLower.includes('indie')) ||
               (userGenreLower.includes('electronic') && artistGenreLower.includes('electronic')) ||
               (userGenreLower.includes('metal') && artistGenreLower.includes('metal')) ||
               (userGenreLower.includes('punk') && artistGenreLower.includes('punk')) ||
               (userGenreLower.includes('folk') && artistGenreLower.includes('folk')) ||
               (userGenreLower.includes('jazz') && artistGenreLower.includes('jazz')) ||
               (userGenreLower.includes('hip hop') && artistGenreLower.includes('hip hop')) ||
               (userGenreLower.includes('alternative') && artistGenreLower.includes('alternative')) ||
               // Fest-specific genres
               (userGenreLower.includes('pop punk') && artistGenreLower.includes('pop punk')) ||
               (userGenreLower.includes('pop-punk') && artistGenreLower.includes('pop-punk')) ||
               (userGenreLower.includes('math rock') && artistGenreLower.includes('math rock')) ||
               (userGenreLower.includes('mathrock') && artistGenreLower.includes('mathrock')) ||
               (userGenreLower.includes('emo') && artistGenreLower.includes('emo')) ||
               (userGenreLower.includes('midwest emo') && artistGenreLower.includes('midwest emo')) ||
               (userGenreLower.includes('midwestemo') && artistGenreLower.includes('midwestemo'))
      })
    );

    return {
      sharedGenres,
      artistGenres: combinedArtistGenres,
      userGenres: userTopGenres
    };
  };

  const { sharedGenres, artistGenres, userGenres } = getGenreConnections();

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

      {/* NEW: Stylized Genre Section */}
      <div className="genre-connection-section">
        <div className="genre-grid">
          {/* Artist Genres */}
          <div className="genre-column artist-genres">
            <h4 className="genre-column-title">
              <span className="genre-icon">🎸</span>
              {band.name}'s Sound
            </h4>
            <div className="genre-tags-container">
              {artistGenres.slice(0, 4).map((genre, index) => (
                <span 
                  key={index} 
                  className={`genre-tag artist-tag ${sharedGenres.includes(genre) ? 'shared-genre' : ''}`}
                >
                  {sharedGenres.includes(genre) && <span className="connection-dot">●</span>}
                  {genre}
                </span>
              ))}
            </div>
          </div>

          {/* Connection Indicator */}
          {sharedGenres.length > 0 && (
            <div className="genre-connection-indicator">
              <div className="connection-line"></div>
              <div className="connection-badge">
                <span className="connection-count">{sharedGenres.length}</span>
                <span className="connection-text">
                  {sharedGenres.length === 1 ? 'connection' : 'connections'}
                </span>
              </div>
            </div>
          )}

          {/* User Genres */}
          {userGenres.length > 0 && (
            <div className="genre-column user-genres">
              <h4 className="genre-column-title">
                <span className="genre-icon">🎧</span>
                Your Taste
              </h4>
              <div className="genre-tags-container">
                {userGenres.slice(0, 4).map((genre, index) => (
                  <span 
                    key={index} 
                    className={`genre-tag user-tag ${sharedGenres.includes(genre) ? 'shared-genre' : ''}`}
                  >
                    {sharedGenres.includes(genre) && <span className="connection-dot">●</span>}
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Shared Genres Highlight */}
        {sharedGenres.length > 0 && (
          <div className="shared-genres-highlight">
            <span className="shared-label">Connected by:</span>
            {sharedGenres.slice(0, 3).map((genre, index) => (
              <span key={index} className="shared-genre-pill">
                {genre}
              </span>
            ))}
          </div>
        )}
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

const ResultScreen = ({ matches, token, timeRange, userGenres }) => {
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

      <TwinCard band={currentTwin} token={token} timeRange={timeRange} userGenres={userGenres} />

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
      getRankedMatches(token, timeRange).then((result) => {
        setMatches(result.matches);
        setUserGenres(result.userGenres);
        setTimeRange(result.timeRange);
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