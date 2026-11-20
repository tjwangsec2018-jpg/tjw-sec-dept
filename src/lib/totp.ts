import * as OTPAuth from 'otpauth';

export function generateTotpSecret(email: string): { secret: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'QuorumSeal',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: secret,
  });
  return {
    secret: secret.base32,
    uri: totp.toString(),
  };
}

export function verifyTotpToken(token: string, secretBase32: string): boolean {
  if (!token || !secretBase32 || token.trim().length !== 6) return false;
  try {
    const totp = new OTPAuth.TOTP({
      issuer: 'QuorumSeal',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
    const delta = totp.validate({ token: token.trim(), window: 1 });
    return delta !== null;
  } catch (err) {
    console.error('TOTP verification error:', err);
    return false;
  }
}
