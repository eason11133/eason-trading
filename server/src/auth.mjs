export function apiAuthorized(provided,configured){const key=String(configured||'');return key.length>=20&&String(provided||'')===key;}
