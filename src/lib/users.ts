import { randomBytes } from "node:crypto";
import { hashToken } from "./crypto";

// The token is shown once; only its hash is stored.
export function issueToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

