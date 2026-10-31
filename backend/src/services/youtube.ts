import type { Env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import type { TranscriptSegment } from './providers.js';

export type YouTubeVideoInfo = {
  videoId: string;
  canonicalUrl: string;
  title: string;
  authorName: string;
  authorUrl?: string;
  thumbnailUrl: string;
  durationSeconds?: number;
};

export type YouTubeTranscriptResult = {
  available: boolean;
  language?: string;
  segments: TranscriptSegment[];
  reason?: string;
};

export type YouTubeInspection = {
  valid: boolean;
  videoId: string;
  canonicalUrl: string;
  metadata: YouTubeVideoInfo;
  transcript: YouTubeTranscriptResult;
  audiovisualAccess: {
    status: 'requires_source_file' | 'available';
    message: string;
  };
};

/**
 * Extracts the 11-character YouTube video ID from various URL formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtube.com/watch?v=VIDEO_ID
 * - https://m.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 */
export const parseYouTubeUrl = (url: string): { videoId: string; canonicalUrl: string } | null => {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // Pattern matches standard watch, youtu.be, shorts, and embed URLs
  const regExp = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regExp);

  if (!match || !match[1]) return null;
  const videoId = match[1];
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
  };
};

/**
 * Parses an ISO 8601 duration string (e.g. PT1H2M30S or PT15M33S) into seconds.
 */
export const parseIsoDuration = (duration: string): number => {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
};

/**
 * Fetches YouTube video metadata using the official, authorized oEmbed endpoint.
 * If YOUTUBE_API_KEY is configured in env, also queries YouTube Data API v3 for precise duration and details.
 */
export const fetchYouTubeMetadata = async (
  videoId: string,
  env?: Partial<Env>,
  signal?: AbortSignal
): Promise<YouTubeVideoInfo> => {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;

  let title = 'YouTube Video';
  let authorName = 'YouTube Creator';
  let authorUrl: string | undefined;
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let durationSeconds: number | undefined;

  try {
    const oembedRes = await fetch(oembedUrl, { signal });
    if (oembedRes.ok) {
      const data = await oembedRes.json() as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
      };
      if (data.title) title = data.title;
      if (data.author_name) authorName = data.author_name;
      if (data.author_url) authorUrl = data.author_url;
      if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
    }
  } catch {
    // Non-fatal: default fallback values preserved
  }

  // If YouTube API Key is available, fetch exact duration and details
  const apiKey = (env as Record<string, unknown> | undefined)?.YOUTUBE_API_KEY as string | undefined;
  if (apiKey) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`;
      const apiRes = await fetch(apiUrl, { signal });
      if (apiRes.ok) {
        const data = await apiRes.json() as {
          items?: Array<{
            snippet?: { title?: string; channelTitle?: string };
            contentDetails?: { duration?: string };
          }>;
        };
        const item = data.items?.[0];
        if (item?.snippet?.title) title = item.snippet.title;
        if (item?.snippet?.channelTitle) authorName = item.snippet.channelTitle;
        if (item?.contentDetails?.duration) {
          durationSeconds = parseIsoDuration(item.contentDetails.duration);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return {
    videoId,
    canonicalUrl,
    title,
    authorName,
    authorUrl,
    thumbnailUrl,
    durationSeconds
  };
};

/**
 * Parses XML formatted timedtext into TranscriptSegment[]
 */
const parseTimedTextXml = (xml: string): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = [];
  // Match <text start="12.34" dur="3.45">Segment text</text>
  const textTagRegex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = textTagRegex.exec(xml)) !== null) {
    const startSeconds = parseFloat(match[1] || '0');
    const duration = parseFloat(match[2] || '3');
    const endSeconds = startSeconds + duration;
    // Decode HTML entities
    const rawText = (match[3] || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (rawText.length > 0 && Number.isFinite(startSeconds) && endSeconds > startSeconds) {
      segments.push({
        startSeconds: Math.round(startSeconds * 100) / 100,
        endSeconds: Math.round(endSeconds * 100) / 100,
        text: rawText
      });
    }
  }

  return segments;
};

/**
 * Retrieves public, authorized captions/transcripts for a YouTube video.
 * Extracts caption tracks from the video's public watch page player response.
 */
export const fetchYouTubeTranscript = async (
  videoId: string,
  signal?: AbortSignal
): Promise<YouTubeTranscriptResult> => {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetch(watchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal
    });

    if (!pageRes.ok) {
      return {
        available: false,
        segments: [],
        reason: 'Unable to reach YouTube watch page to check for captions.'
      };
    }

    const html = await pageRes.text();

    // Look for captionTracks in ytInitialPlayerResponse
    const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});(?:\s*var\s|\s*<\/script>)/s)
      || html.match(/"captions":\s*({.+?"captionTracks":\s*\[.+?\]})/s);

    let captionTracks: Array<{ baseUrl?: string; languageCode?: string; name?: { simpleText?: string } }> = [];

    if (playerResponseMatch && playerResponseMatch[1]) {
      try {
        const parsed = JSON.parse(playerResponseMatch[1]) as {
          captions?: {
            playerCaptionsTracklistRenderer?: {
              captionTracks?: Array<{ baseUrl?: string; languageCode?: string; name?: { simpleText?: string } }>;
            };
          };
          captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
        };
        captionTracks = parsed.captions?.playerCaptionsTracklistRenderer?.captionTracks || parsed.captionTracks || [];
      } catch {
        // Fallback search below
      }
    }

    // Direct regex fallback for captionTracks if JSON parsing failed
    if (captionTracks.length === 0) {
      const tracksRegexMatch = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
      if (tracksRegexMatch && tracksRegexMatch[1]) {
        try {
          captionTracks = JSON.parse(tracksRegexMatch[1]) as Array<{ baseUrl?: string; languageCode?: string }>;
        } catch {
          // No tracks found
        }
      }
    }

    if (captionTracks.length === 0) {
      return {
        available: false,
        segments: [],
        reason: 'No public captions or transcript tracks were found for this video.'
      };
    }

    // Prefer English or first available track
    const selectedTrack = captionTracks.find((t) => t.languageCode?.startsWith('en')) || captionTracks[0];
    if (!selectedTrack?.baseUrl) {
      return {
        available: false,
        segments: [],
        reason: 'Caption track URL could not be resolved.'
      };
    }

    // Fetch the timedtext XML
    const timedTextRes = await fetch(selectedTrack.baseUrl, { signal });
    if (!timedTextRes.ok) {
      return {
        available: false,
        segments: [],
        reason: 'Failed to retrieve timedtext caption data from YouTube.'
      };
    }

    const timedTextXml = await timedTextRes.text();
    const segments = parseTimedTextXml(timedTextXml);

    if (segments.length === 0) {
      return {
        available: false,
        segments: [],
        language: selectedTrack.languageCode,
        reason: 'Caption track contained no usable timestamped text segments.'
      };
    }

    return {
      available: true,
      language: selectedTrack.languageCode || 'en',
      segments
    };
  } catch (error) {
    return {
      available: false,
      segments: [],
      reason: error instanceof Error ? error.message : 'Error retrieving YouTube captions.'
    };
  }
};

/**
 * Validates a YouTube URL and inspects metadata and transcript availability.
 */
export const inspectYouTubeVideo = async (
  url: string,
  env?: Partial<Env>,
  signal?: AbortSignal
): Promise<YouTubeInspection> => {
  const parsed = parseYouTubeUrl(url);
  if (!parsed) {
    throw new AppError(422, 'INVALID_YOUTUBE_URL', 'The provided URL is not a recognized YouTube video link.');
  }

  const [metadata, transcript] = await Promise.all([
    fetchYouTubeMetadata(parsed.videoId, env, signal),
    fetchYouTubeTranscript(parsed.videoId, signal)
  ]);

  return {
    valid: true,
    videoId: parsed.videoId,
    canonicalUrl: parsed.canonicalUrl,
    metadata,
    transcript,
    audiovisualAccess: {
      status: 'requires_source_file',
      message: 'YouTube metadata and authorized transcript imported successfully. Note that YouTube terms and public APIs do not provide direct MP4 video downloads; ClipForge analyzes the official transcript to identify engaging 15-second moments. Provide the matching authorized MP4 file to render the video clips.'
    }
  };
};
