export type OAuthResult={error?:{message:string}|null};
export type OAuthClient={auth:{signInWithOAuth:(options:{provider:'google';options:{redirectTo:string;queryParams:{prompt:'select_account'}}})=>Promise<OAuthResult>;signOut:()=>Promise<{error?:{message:string}|null}>}};
export async function startGoogleSignIn(client:OAuthClient,redirectTo:string){return client.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{prompt:'select_account'}}})}
export async function endSession(client:OAuthClient){return client.auth.signOut()}
