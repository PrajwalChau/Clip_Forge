export type SocialPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export type PlatformSpec = {
  platform: SocialPlatform;
  displayName: string;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  aspectRatio: string;
  allowedFormats: string[];
  maxCaptionLength: number;
  supportsScheduling: boolean;
};

export const PLATFORM_SPECS: Record<SocialPlatform, PlatformSpec> = {
  youtube: {
    platform: 'youtube',
    displayName: 'YouTube Shorts',
    maxDurationSeconds: 60,
    minDurationSeconds: 3,
    aspectRatio: '9:16',
    allowedFormats: ['video/mp4'],
    maxCaptionLength: 100, // Shorts title/caption limit
    supportsScheduling: true
  },
  tiktok: {
    platform: 'tiktok',
    displayName: 'TikTok',
    maxDurationSeconds: 60,
    minDurationSeconds: 3,
    aspectRatio: '9:16',
    allowedFormats: ['video/mp4'],
    maxCaptionLength: 2200,
    supportsScheduling: true
  },
  instagram: {
    platform: 'instagram',
    displayName: 'Instagram Reels',
    maxDurationSeconds: 90,
    minDurationSeconds: 3,
    aspectRatio: '9:16',
    allowedFormats: ['video/mp4'],
    maxCaptionLength: 2200,
    supportsScheduling: true
  },
  facebook: {
    platform: 'facebook',
    displayName: 'Facebook Reels',
    maxDurationSeconds: 60,
    minDurationSeconds: 3,
    aspectRatio: '9:16',
    allowedFormats: ['video/mp4'],
    maxCaptionLength: 2200,
    supportsScheduling: true
  }
};

export type PublishOptions = {
  title: string;
  caption: string;
  tags?: string[];
  privacy?: 'public' | 'unlisted' | 'private';
};

export type PublishResult = {
  platformPostId: string;
  platformPostUrl: string;
  publishedAt: Date;
};
