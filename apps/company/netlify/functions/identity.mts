import type {UserValidateEvent,UserSignupEvent,UserModifiedEvent} from '@netlify/functions';
const version='2026-10-30-wallet';
function recordAcceptance(event: UserSignupEvent | UserModifiedEvent) {
  if (event.user.userMetadata?.terms_accepted !== true || event.user.userMetadata?.terms_version !== version || event.user.appMetadata?.terms_version === version) return;
  return {user:{...event.user,appMetadata:{...event.user.appMetadata,terms_version:version,terms_accepted_at:new Date().toISOString()}}};
}
export default {
  userValidate(event: UserValidateEvent) {
    if (!event.user.invitedAt && (event.user.userMetadata?.terms_accepted !== true || event.user.userMetadata?.terms_version !== version)) return event.deny();
  },
  userSignup(event:UserSignupEvent){const accepted=recordAcceptance(event);const referral=event.user.userMetadata?.referral_code;return {user:{...(accepted?.user || event.user),appMetadata:{...(accepted?.user.appMetadata || event.user.appMetadata),signup_referral:typeof referral==='string'&&/^SH[A-Z0-9]{12}$/.test(referral)?referral:null}}};},
  userModified:recordAcceptance,
};
