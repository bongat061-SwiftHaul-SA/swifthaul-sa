// Public browser configuration only. Never place a service-role or secret key here.
// Production hosts use production Supabase. The isolated Netlify and GitHub Pages previews use staging.
const isNetlifyStagingPreview = typeof window !== 'undefined' && window.location.hostname.endsWith('--swifthaul-sa.netlify.app') && window.location.hostname !== 'swifthaul-sa.netlify.app';
const isGitHubPagesStagingPreview = typeof window !== 'undefined' &&
  window.location.hostname === 'bongat061-swifthaul-sa.github.io' &&
  window.location.pathname.startsWith('/swifthaul-sa-preview/');
const isStagingPreview = isNetlifyStagingPreview || isGitHubPagesStagingPreview;
export const SUPABASE_URL = isStagingPreview
  ? 'https://tagkbropgzthsbjlhyvz.supabase.co'
  : 'https://jikstpnvsdjhcibtjilp.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = isStagingPreview
  ? 'sb_publishable_QWOeGbSVs2nXECI-KsAmWQ_K_Rav892'
  : 'sb_publishable_K1USNabR38GFuMqupYAVNA_6gx3rKH2';
