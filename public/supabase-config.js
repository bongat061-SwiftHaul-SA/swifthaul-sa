// Public browser configuration only. Never place a service-role or secret key here.
// The isolated PR #41 Netlify preview uses the staging project; production hosts retain production.
const isCustomerStagingPreview = typeof window !== 'undefined' && window.location.hostname === 'deploy-preview-41--swifthaul-sa.netlify.app';
export const SUPABASE_URL = isCustomerStagingPreview
  ? 'https://tagkbropgzthsbjlhyvz.supabase.co'
  : 'https://jikstpnvsdjhcibtjilp.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = isCustomerStagingPreview
  ? 'sb_publishable_QWOeGbSVs2nXECI-KsAmWQ_K_Rav892'
  : 'sb_publishable_K1USNabR38GFuMqupYAVNA_6gx3rKH2';
