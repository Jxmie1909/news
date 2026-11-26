import crypto from "node:crypto";
export const JWT_SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function jwt(role) {
  const head = b({ alg: "HS256", typ: "JWT" });
  const body = b({ role, iss: "supabase-local", iat: Math.floor(Date.now() / 1000) - 60, exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
export const ANON_KEY = jwt("anon");
export const SERVICE_KEY = jwt("service_role");
if (process.argv[2]) console.log(process.argv[2] === "service" ? SERVICE_KEY : ANON_KEY);
