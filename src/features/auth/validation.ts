export function validateUsername(value:string){return /^[A-Za-z0-9_]{3,24}$/.test(value.trim())}
export function validateDisplayName(value:string){const name=value.trim();return name.length>=1&&name.length<=60}
