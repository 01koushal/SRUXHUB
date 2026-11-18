type Identity={email?:string|null;email_confirmed_at?:string|null;app_metadata?:Record<string,unknown>|null}|null|undefined;
type ProfileState={onboarding_complete?:boolean}|null|undefined;
export function isSruEmail(email?:string|null){return typeof email==='string'&&/^[^@]+@sru\.edu\.in$/i.test(email.trim())}
export function isEligibleGoogleAccount(user:Identity){return Boolean(user&&isSruEmail(user.email)&&user.email_confirmed_at&&user.app_metadata?.provider==='google')}
export function canParticipate(user:Identity,profile:ProfileState){return isEligibleGoogleAccount(user)&&profile?.onboarding_complete===true}
