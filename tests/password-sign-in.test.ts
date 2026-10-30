import { describe, expect, it, vi } from 'vitest';
import { signInWithPassword } from '@/lib/neon/password-sign-in';

describe('password sign-in', () => {
  it('uses the managed auth adapter and returns the signed-in identity', async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'trader@example.com' } }, error: null });
    const user = await signInWithPassword(' trader@example.com ', 'example pass', signIn);
    expect(signIn).toHaveBeenCalledWith({ email: 'trader@example.com', password: 'example pass' });
    expect(user).toEqual({ id: 'user-1', email: 'trader@example.com' });
  });
  it('rejects missing credentials and failed or anonymous sessions without exposing provider errors', async () => {
    const signIn = vi.fn();
    await expect(signInWithPassword('', 'pass', signIn)).rejects.toThrow(/email and password/i);
    expect(signIn).not.toHaveBeenCalled();
    signIn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'internal provider details' } });
    await expect(signInWithPassword('t@example.com', 'pass', signIn)).rejects.not.toThrow(/internal provider details/);
    signIn.mockResolvedValueOnce({ data: { user: { id: 'anon', email: 't@example.com', is_anonymous: true } }, error: null });
    await expect(signInWithPassword('t@example.com', 'pass', signIn)).rejects.toThrow(/sign in/i);
  });
});
