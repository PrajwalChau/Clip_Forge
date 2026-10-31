export type PlanName = 'free' | 'pro' | 'premium';
export type UserRole = 'user' | 'admin';
export type AccountStatus = 'active' | 'suspended';
export type User = { id: string; email: string; name: string; plan: PlanName; role: UserRole; accountStatus: AccountStatus; createdAt?: string; lastLoginAt?: string };
export type ProjectStatus = 'draft' | 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type EditingStyle = 'clipforge' | 'full_video_active_speaker';
export type Project = {
  _id: string;
  id?: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  sourceAssetId?: string;
  clipCount?: number;
  failureCode?: string;
  failureMessage?: string;
  sourceType?: 'upload' | 'youtube';
  youtubeUrl?: string;
  youtubeVideoId?: string;
  youtubeMetadata?: { title?: string; authorName?: string; thumbnailUrl?: string; durationSeconds?: number };
  settings: { targetDurationSeconds: number; requestedClipCount: number; subtitles: boolean; watermark: boolean; editingStyle: EditingStyle };
};
export type LicenseType = 'unknown' | 'owned' | 'licensed' | 'cc0' | 'cc_by' | 'cc_by_nc' | 'cc_by_nd' | 'other';
export type VideoAsset = { _id: string; id?: string; originalFilename: string; sizeBytes: number; durationSeconds?: number; mimeType: string; state: string; createdAt: string; expiresAt?: string; source?: { type: 'user_upload' | 'youtube_import'; rightsConfirmed: boolean; rightsConfirmedAt?: string; provenance: 'user_declared' | 'youtube_oembed'; sourceUrl?: string; creator?: string; licenseType: LicenseType; licenseUrl?: string; attributionText?: string; commercialUseRestricted: boolean; derivativeWorksRestricted: boolean } };
export type ProcessingJob = { _id: string; id?: string; status: string; step: string; progress: number; cancellationRequestedAt?: string; selectionMode?: 'ai' | 'fallback' | 'mock'; processingConfig?: { editingStyle?: EditingStyle }; errorCode?: string; errorMessage?: string; updatedAt: string };
export type Clip = { _id: string; id?: string; title: string; summary?: string; selectionReason?: string; suggestedCaption?: string; topic?: string; selectionMode?: 'ai' | 'fallback' | 'mock'; score?: number; startSeconds: number; endSeconds: number; state: string; quality?: { status: 'passed' | 'failed' | 'not_run'; checks: Array<{ name: string; passed: boolean; detail: string }>; checkedAt?: string }; output?: { width?: number; height?: number; durationSeconds?: number; hasWatermark?: boolean }; expiresAt?: string };
export type Plan = { id: PlanName; label: string; priceNpr: number; storageBytes: number; processingSeconds: number; generatedClips: number; outputHeight: number; watermark: boolean; retentionDays: number };
export type Usage = { storageBytes: number; reservedBytes: number; processingSeconds: number; generatedClips: number; resetAt: string };
export type Pagination = { page: number; limit: number; total: number; pages: number };

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

export type PlatformInfo = {
  platform: SocialPlatform;
  displayName: string;
  configured: boolean;
  missingFields: string[];
  spec: PlatformSpec;
};

export type SocialAccount = {
  _id: string;
  platform: SocialPlatform;
  accountId: string;
  accountName: string;
  accountHandle?: string;
  avatarUrl?: string;
  status: 'connected' | 'expired' | 'disconnected' | 'error';
  lastError?: string;
  scopes?: string[];
  tokenExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: { isSimulated?: boolean; note?: string };
};

export type ScheduledPost = {
  _id: string;
  ownerId: string;
  clipId: Clip | string;
  socialAccountId: SocialAccount | string;
  platform: SocialPlatform;
  caption: string;
  tags: string[];
  privacy: 'public' | 'unlisted' | 'private';
  scheduledFor: string;
  timezone: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  publishedAt?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  failureReason?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
};

export type YouTubeInspection = {
  valid: boolean;
  videoId: string;
  canonicalUrl: string;
  metadata: {
    videoId: string;
    canonicalUrl: string;
    title: string;
    authorName: string;
    authorUrl?: string;
    thumbnailUrl: string;
    durationSeconds?: number;
  };
  transcript: {
    available: boolean;
    language?: string;
    segments: Array<{ startSeconds: number; endSeconds: number; text: string }>;
    reason?: string;
  };
  audiovisualAccess: {
    status: 'requires_source_file' | 'available';
    message: string;
  };
};
