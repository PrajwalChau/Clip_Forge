import { describe, expect, it, vi } from 'vitest';
import {
  fetchYouTubeMetadata,
  inspectYouTubeVideo,
  parseIsoDuration,
  parseYouTubeUrl
} from '../services/youtube.js';

describe('YouTube URL parsing and validation', () => {
  it('parses standard watch URLs correctly', () => {
    const result = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
  });

  it('parses youtu.be short links', () => {
    const result = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(result).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
  });

  it('parses YouTube Shorts URLs', () => {
    const result = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    expect(result).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
  });

  it('parses YouTube embed URLs', () => {
    const result = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(result).toEqual({
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    });
  });

  it('handles query parameters like t=12s and feature=share cleanly', () => {
    const result = parseYouTubeUrl('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s');
    expect(result?.videoId).toBe('dQw4w9WgXcQ');
  });

  it('rejects invalid or non-YouTube URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345678')).toBeNull();
    expect(parseYouTubeUrl('not a url')).toBeNull();
    expect(parseYouTubeUrl('https://youtube.com/invalid')).toBeNull();
  });
});

describe('ISO duration parsing', () => {
  it('parses various ISO 8601 durations to seconds', () => {
    expect(parseIsoDuration('PT15M33S')).toBe(15 * 60 + 33);
    expect(parseIsoDuration('PT1H2M10S')).toBe(3600 + 2 * 60 + 10);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT2H')).toBe(7200);
    expect(parseIsoDuration('invalid')).toBe(0);
  });
});

describe('YouTube metadata fetching', () => {
  it('fetches metadata via oEmbed when available', async () => {
    const mockResponse = {
      title: 'Interview with Founder',
      author_name: 'Tech Podcast',
      author_url: 'https://www.youtube.com/@techpodcast',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    }));

    const meta = await fetchYouTubeMetadata('dQw4w9WgXcQ');
    expect(meta.title).toBe('Interview with Founder');
    expect(meta.authorName).toBe('Tech Podcast');
    expect(meta.videoId).toBe('dQw4w9WgXcQ');

    vi.unstubAllGlobals();
  });

  it('inspects YouTube video and provides clear audiovisual access message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body></body></html>',
      json: async () => ({ title: 'Sample Video', author_name: 'Creator' })
    }));

    const inspection = await inspectYouTubeVideo('https://youtu.be/dQw4w9WgXcQ');
    expect(inspection.valid).toBe(true);
    expect(inspection.videoId).toBe('dQw4w9WgXcQ');
    expect(inspection.audiovisualAccess.status).toBe('requires_source_file');
    expect(inspection.audiovisualAccess.message).toContain('YouTube terms and public APIs do not provide direct MP4 video downloads');

    vi.unstubAllGlobals();
  });
});
