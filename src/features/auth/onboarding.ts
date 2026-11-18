import{validateDisplayName,validateUsername}from'./validation';
export type OnboardingProfile={user_id:string;username:string;display_name:string;onboarding_complete:true};
export function buildOnboardingProfile(userId:string,username:string,displayName:string):{profile?:OnboardingProfile;error?:string}{if(!validateUsername(username))return{error:'Username must be 3–24 letters, numbers, or underscores.'};if(!validateDisplayName(displayName))return{error:'Display name must be 1–60 characters.'};return{profile:{user_id:userId,username:username.trim(),display_name:displayName.trim(),onboarding_complete:true}}}
export function onboardingInsertError(code:string|undefined,message:string){return code==='23505'?'That username is already taken. Choose another one.':message}
