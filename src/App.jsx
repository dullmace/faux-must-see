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
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    const timeout = setTimeout(() => {
      console.warn("Image loading timeout");
      resolve(null);
    }, 10000);
    
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    
    img.onerror = () => {
      clearTimeout(timeout);
      console.warn("Failed to load band image");
      resolve(null);
    };
    
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

const generateShareImage = async (band, matchPercentage, token) => {
  return new Promise(async (resolve) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = 1200;
      canvas.height = 630;

      let colors = {
        primary: { r: 255, g: 120, b: 60 },
        secondary: { r: 50, g: 200, b: 100 },
        accent: { r: 255, g: 200, b: 50 }
      };

      if (token && band.spotifyLink) {
        const spotifyId = band.spotifyLink.split("/").pop();
        const albumArtUrl = await getAlbumArtFromSpotify(token, spotifyId);
        if (albumArtUrl) {
          colors = await extractColorsFromImage(albumArtUrl);
        }
      }

      // Bright, vibrant gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `rgba(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b}, 0.85)`);
      gradient.addColorStop(0.3, `rgba(${colors.secondary.r}, ${colors.secondary.g}, ${colors.secondary.b}, 0.9)`);
      gradient.addColorStop(0.7, `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.8)`);
      gradient.addColorStop(1, `rgba(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b}, 0.75)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Load and draw band image
      const bandImage = await loadImage(band.bandImage);
      if (bandImage) {
        // Create circular clipping mask for band image
        const imageSize = 180;
        const imageX = canvas.width - 220; // Position on right side
        const imageY = 180;

        ctx.save();
        
        // Create circular clip
        ctx.beginPath();
        ctx.arc(imageX, imageY, imageSize / 2, 0, Math.PI * 2);
        ctx.clip();
        
        // Draw band image
        ctx.drawImage(
          bandImage, 
          imageX - imageSize / 2, 
          imageY - imageSize / 2, 
          imageSize, 
          imageSize
        );
        
        ctx.restore();

        // Add stylish border around the image
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(imageX, imageY, imageSize / 2 + 3, 0, Math.PI * 2);
        ctx.stroke();

        // Add colored accent border
        ctx.strokeStyle = `rgb(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(imageX, imageY, imageSize / 2 + 8, 0, Math.PI * 2);
        ctx.stroke();

        // Add subtle shadow/glow effect
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = `rgb(${colors.primary.r}, ${colors.primary.g}, ${colors.primary.b})`;
        ctx.beginPath();
        ctx.arc(imageX + 2, imageY + 2, imageSize / 2 + 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Bright pattern overlay (adjusted to not overlap with image)
      ctx.fillStyle = `rgba(255, 255, 255, 0.15)`;
      for (let i = 0; i < canvas.width - 250; i += 30) { // Reduced width to avoid image area
        for (let j = 0; j < canvas.height; j += 30) {
          if (Math.random() > 0.8) {
            ctx.fillRect(i, j, 4, 4);
          }
        }
      }

      // Bright vinyl records (repositioned to work with image)
      const drawVinyl = (x, y, size, opacity) => {
        ctx.save();
        ctx.globalAlpha = opacity;
        
        // Bright vinyl base
        ctx.fillStyle = `rgba(255, 255, 255, 0.25)`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();

        // Colorful grooves
        ctx.strokeStyle = `rgba(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b}, 0.6)`;
        ctx.lineWidth = 2;
        for (let radius = size * 0.3; radius < size; radius += size * 0.12) {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Bright center
        ctx.fillStyle = `rgb(${colors.secondary.r}, ${colors.secondary.g}, ${colors.secondary.b})`;
        ctx.beginPath();
        ctx.arc(x, y, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      drawVinyl(120, 120, 90, 0.7);
      drawVinyl(canvas.width - 120, canvas.height - 120, 70, 0.6);
      drawVinyl(200, canvas.height - 80, 40, 0.5); // Moved third vinyl to avoid image

      const centerX = canvas.width / 2 - 50; // Shift text slightly left to balance with image
      const centerY = canvas.height / 2;

      ctx.miterLimit = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      
      // Title with maximum contrast
      ctx.textAlign = "center";
      
      // Strong black outline
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 6;
      ctx.font = "bold 48px Arial, sans-serif";
      ctx.strokeText("MY FAUX MUST-SEE", centerX, 120);
      
      // White fill
      ctx.fillStyle = "#ffffff";
      ctx.fillText("MY FAUX MUST-SEE", centerX, 120);

      // Band name with excellent contrast
      ctx.font = "bold 72px Arial, sans-serif";
      let fontSize = 72;
      while (
        ctx.measureText(band.name.toUpperCase()).width > canvas.width - 400 && // Account for image space
        fontSize > 32
      ) {
        fontSize -= 4;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      }

      // Thick black outline
      ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
      ctx.lineWidth = 8;
      ctx.strokeText(band.name.toUpperCase(), centerX, centerY - 20);
      
      // White fill
      ctx.fillStyle = "#ffffff";
      ctx.fillText(band.name.toUpperCase(), centerX, centerY - 20);

      // Location with strong contrast
      ctx.font = "32px Arial, sans-serif";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 4;
      ctx.strokeText(band.bandLocation, centerX, centerY + 40);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(band.bandLocation, centerX, centerY + 40);

      // High contrast match percentage box
      ctx.fillStyle = "rgba(0, 0, 0, 0.8)"; // Dark background
      ctx.fillRect(centerX - 140, centerY + 80, 280, 70);
      
      // Bright border
      ctx.strokeStyle = `rgb(${colors.accent.r}, ${colors.accent.g}, ${colors.accent.b})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(centerX - 140, centerY + 80, 280, 70);

      ctx.font = "bold 40px Arial, sans-serif";
      ctx.fillStyle = "#ffffff"; // White text on dark background
      ctx.fillText(`${matchPercentage}% MATCH`, centerX, centerY + 130);

      // Bottom text with strong contrast (centered on full width)
      ctx.font = "28px Arial, sans-serif";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 4;
      ctx.strokeText("Find your must-see band at", canvas.width / 2, canvas.height - 80);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("Find your must-see band at", canvas.width / 2, canvas.height - 80);

      ctx.font = "bold 36px Arial, sans-serif";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.lineWidth = 5;
      ctx.strokeText("dullmace.lol", canvas.width / 2, canvas.height - 35);
      ctx.fillStyle = "#ffffff";
      ctx.fillText("dullmace.lol", canvas.width / 2, canvas.height - 35);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            console.log("Bright readable share image generated successfully, size:", blob.size);
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

    <div className="lineup-image-container">
      <img
        src="https://res.cloudinary.com/dmrkor9s4/image/upload/v1749715839/faux-times.jpg"
        alt="Faux 2025 Lineup Schedule"
        className="lineup-image"
      />
    </div>

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
    `Just got my marching orders: ${band.name} is my Faux anthem. What's yours? Find out your perfect fest pairing: ${shareUrl}`,
    `Prepare for maximum headbanging with ${band.name} at Faux. What band is calling your name? Get your match: ${shareUrl}`,
    `My future involves a lot of sweat and ${band.name} at Faux. Who's your fest forecast looking like? Discover now: ${shareUrl}`
  ];

  const getRandomTweetMessage = () => {
    return tweetMessages[Math.floor(Math.random() * tweetMessages.length)];
  };

  const handleShare = async () => {
    if (isGeneratingImage) return; // Fixed: use correct state variable
    setIsGeneratingImage(true); // Fixed: use correct setter

    try {
      const matchPercentage = Math.min(Math.round((band.score / 10) * 100), 100);
      const shareText = getRandomTweetMessage(); // Fixed: use correct function name

      // We always generate the image first
      const imageBlob = await generateShareImage(band, matchPercentage, token);
      if (!imageBlob) {
        throw new Error("Image generation failed.");
      }

      const fileName = `faux-must-see-${band.name
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()}.png`;
      const shareFile = new File([imageBlob], fileName, { type: "image/png" });

      // --- The Modern Approach: Web Share API ---
      // This is the best experience for mobile users
      if (navigator.share && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          title: "My Faux Must-See",
          text: shareText,
          files: [shareFile],
        });
      } else {
        // --- The Desktop/Fallback Approach ---
        // For browsers that don't support sharing files (like desktop Chrome/Firefox)
        const url = URL.createObjectURL(imageBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Open Twitter in a new tab with the pre-filled text
        const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          shareText,
        )}`;
        window.open(twitterUrl, "_blank");

        alert(
          "Image downloaded! Just drag it into the tweet to share it. 🤘",
        );
      }
    } catch (error) {
      console.error("Error during share:", error);
      // If sharing fails, provide a helpful message.
      // Avoid falling back to a text-only share here, as it's confusing.
      // The user clicked a button expecting an image.
      alert(
        "Whoops! Something went wrong. Please try copying the link instead.",
      );
    } finally {
      setIsGeneratingImage(false); // Fixed: use correct setter
    }
  };

  const handleCopyLink = async () => {
    const shareText = getRandomTweetMessage(); // Fixed: use correct function name
    try {
      await navigator.clipboard.writeText(shareText);
      alert("Copied to clipboard!");
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy link. Please try again.");
    }
  };

  return (
    <div className="share-buttons">
      <button
        onClick={handleShare}
        className="share-button twitter"
        disabled={isGeneratingImage} // Fixed: use correct state variable
      >
        {isGeneratingImage ? ( // Fixed: use correct state variable
          <>
            <div className="creating-spinner"></div>
            Creating...
          </>
        ) : (
          <>
            <span className="share-icon">🚀</span>
            Share Result
          </>
        )}
      </button>
      <button onClick={handleCopyLink} className="share-button native">
        <span className="share-icon">🔗</span>
        Copy Link
      </button>
    </div>
  );
};

const TwinCard = ({ band, token }) => {
  const [playlistUrl, setPlaylistUrl] = useState(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState(null);
  const [coverUploadFailed, setCoverUploadFailed] = useState(false);

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

  const handleCreatePlaylist = async () => {
    if (!token || creatingPlaylist) return;

    setCreatingPlaylist(true);
    setPlaylistError(null);
    setCoverUploadFailed(false);

    try {
      const url = await createPlaylist(token, band.name, spotifyId, matchPercentage, band);

      if (url) {
        setPlaylistUrl(url);
        // Check console for cover upload warnings
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
      <div className="match-badge">
        <span className="match-percentage">{matchPercentage}% Match</span>
      </div>
      <img
        src={band.bandImage}
        alt={`Band photo of ${band.name}`}
        className="band-image"
      />
      <h1 className="band-name">{band.name}</h1>
      <p className="location">{band.bandLocation}</p>
      <GenreTags genres={band.bandGenre} />
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
        <ShareButtons band={band} token={token} />
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